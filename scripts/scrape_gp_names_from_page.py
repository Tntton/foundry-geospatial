#!/usr/bin/env python3
"""
GP-count data-integrity remediation, Phase 4 (Step 2 of 2) -- extraction.

Given discover_gp_page_urls.py's output (each clinic's already-known
`discovered_gp_page_url`), visit exactly that URL and extract the real GP
names on it. Deliberately decoupled from discovery: this step can be
re-run on its own (e.g. once the name-extraction regex improves) without
re-crawling every clinic's homepage to re-find the same URL again.

Output is written to SIBLING columns (gp_count_scraped/doctor_names_scraped/
gp_count_scrape_confidence/...), never overwriting the existing recorded
gp_count/doctor_names -- the scrape's own failure modes (chain-wide pages,
bot-challenge pages, homepage fallbacks) mean it isn't automatically more
correct than what's on file today. A human reviews and merges afterward;
this script does NOT write to Supabase at all.

Robustness, on top of a plain per-row scrape:
  - Rejects non-http(s) discovered URLs (mailto:/tel:/etc slipped through
    discovery's link-scoring) instead of trying to navigate to them.
  - Detects bot-challenge interstitials (Cloudflare etc.) so a 0-match
    result on one of those isn't recorded as if it were a verified zero.
  - For chain-pattern-reuse rows specifically, sanity-checks that the page
    actually mentions *this* clinic (name or suburb) rather than being a
    chain-wide "find a doctor" page that lists every location's GPs at once
    -- the biggest single overcount risk from the discovery step's reuse
    shortcut.
  - One retry with backoff on timeout/network-class errors.
  - Derives a gp_count_scrape_confidence per row (high/medium/low) from the
    above signals, instead of leaving confidence-judgment for later.
  - Writes incrementally (flushed per row) and supports --resume, so a
    crash or kill partway through a multi-hour run doesn't lose everything
    scraped so far.

Usage:
    python3 scripts/scrape_gp_names_from_page.py --in gp_page_discovery.csv [--out gp_names_scraped.csv] [--resume]

Requires: playwright (`playwright install chromium` once).
"""

import argparse
import asyncio
import csv
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

from lib_gp_scrape import (
    DETECT_CARD_GRID_JS,
    classify_card_role,
    classify_fetch_error,
    clean_card_name,
    dedup_key,
    extract_doctor_names,
    is_corporate_chain,
    looks_like_bot_challenge,
)

FIELDNAMES = [
    'clinic_id', 'clinic_name', 'gp_count_scraped', 'doctor_names_scraped',
    'gp_count_scrape_confidence', 'source_url', 'extraction_method',
    'name_extraction_method', 'scraped_at', 'notes',
]

ALLOWED_SCHEMES = {'http', 'https'}

# Tried in order inside scrape_one(): dom_schema_microdata / sibling_class_cluster
# / dom_single_profile (all via DETECT_CARD_GRID_JS) first, and only if none of
# those find anything does this flat-text regex fallback run at all. A single
# toggle so it can be turned off entirely once real tier-1/2/3 coverage is seen,
# without touching the detection code.
ALLOW_FLAT_REGEX_FALLBACK = True

# A single GP clinic having more than this many names on its "our doctors"
# page is unusual enough to be a red flag for a chain-wide/aggregated page
# rather than this one location's actual roster -- not a hard cutoff, just
# a signal that downgrades confidence for manual review.
ANOMALOUS_COUNT_THRESHOLD = 18

RETRYABLE_ERROR_CLASSES = {'timeout', 'connection_error', 'network_error'}


def read_discovery_csv(path):
    with open(path, newline='') as f:
        return list(csv.DictReader(f))


def already_scraped_ids(out_path):
    if not os.path.exists(out_path):
        return set()
    with open(out_path, newline='') as f:
        return {row['clinic_id'] for row in csv.DictReader(f)}


def mentions_own_clinic(text, clinic_name):
    """Cheap check for whether a chain-pattern-reuse page is actually about
    THIS clinic, vs. a chain-wide page listing every location's doctors.
    Matches on any distinctive word (4+ chars, so 'the'/'medical'/'clinic'
    boilerplate doesn't cause false positives) from the clinic's own name."""
    if not clinic_name:
        return True  # nothing to check against -- don't penalize
    haystack = (text or '').lower()
    words = [w for w in re.findall(r"[a-z']+", clinic_name.lower()) if len(w) >= 4]
    if not words:
        return True
    return any(w in haystack for w in words)


def derive_confidence(*, url_rejected, error_class, bot_challenge, extraction_method,
                       possible_shared_chain_page, gp_count, match_score=None,
                       name_extraction_method=None, grid_signal=None):
    if url_rejected or error_class:
        return 'low'
    if bot_challenge:
        return 'low'
    if possible_shared_chain_page:
        return 'low'
    if extraction_method == 'no_team_page_found_fallback_homepage':
        return 'low'
    if gp_count == 0 or (gp_count is not None and gp_count > ANOMALOUS_COUNT_THRESHOLD):
        return 'low'
    if extraction_method == 'chain_pattern_reuse':
        return 'medium'

    # DOM structured-extraction thresholds -- a real per-location doctor-card
    # grid (or schema.org microdata) is a much stronger signal than a
    # keyword-scored link, so this is evaluated before the legacy
    # match_score/flat-regex path below.
    if name_extraction_method in ('dom_schema_microdata', 'sibling_class_cluster'):
        g = grid_signal or {}
        if (g.get('card_count', 0) >= 3 and g.get('name_shape_pass_ratio', 0) >= 0.9
                and g.get('photo_like_ratio', 0) >= 0.8 and g.get('unknown_role_ratio', 1.0) <= 0.3):
            return 'high'
        if (g.get('card_count', 0) == 2 or g.get('photo_like_ratio', 1.0) < 0.5
                or 0.5 <= g.get('name_shape_pass_ratio', 0) < 0.9):
            return 'medium'
        return 'low'
    if name_extraction_method == 'dom_single_profile':
        return 'medium'  # one data point, no cross-validation from repetition
    if name_extraction_method == 'flat_text_regex_fallback':
        # No structured team listing found; unstructured text-regex fallback
        # used -- capped at low regardless of count/match_score so a
        # reviewer never mistakes it for a grid-backed result.
        return 'low'

    # Legacy path (name_extraction_method not set, e.g. no page was ever
    # reached to attempt extraction): a homepage_link_scan hit that only
    # matched a weak keyword (e.g. just "about us", the lowest-scoring
    # phrase in TEAM_PAGE_KEYWORDS) is often a generic corporate bio page,
    # not this location's actual doctor roster -- confirmed live
    # (bettermedical.com.au's "About Us" lists 2 national executives, not
    # any clinic's real GPs) despite extracting a plausible-looking,
    # in-range count. A strong match (score >= 3, e.g. "our doctors") is the
    # real signal "high" is meant to represent.
    if match_score is not None:
        if match_score <= 1:
            return 'low'
        if match_score == 2:
            return 'medium'
    return 'high'


async def goto_with_retry(page, url, *, timeout=15000, retries=1):
    last_exc = None
    for attempt in range(retries + 1):
        try:
            await page.goto(url, timeout=timeout, wait_until='load')
            return None
        except Exception as e:
            last_exc = e
            if attempt < retries and classify_fetch_error(e) in RETRYABLE_ERROR_CLASSES:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            return last_exc
    return last_exc


async def scrape_one(page, row):
    url = (row.get('discovered_gp_page_url') or '').strip()
    clinic_name = row.get('clinic_name', '')
    discovery_method = row.get('discovery_method')
    raw_match_score = row.get('match_score')
    match_score = int(raw_match_score) if raw_match_score not in (None, '') else None
    result = {
        'clinic_id': row['clinic_id'],
        'clinic_name': clinic_name,
        'source_url': url or None,
        'extraction_method': discovery_method,
        'gp_count_scraped': None,
        'doctor_names_scraped': '',
        'gp_count_scrape_confidence': None,
        'name_extraction_method': None,
        'scraped_at': None,
        'notes': '',
    }
    if not url:
        result['gp_count_scrape_confidence'] = derive_confidence(
            url_rejected=True, error_class=None, bot_challenge=False,
            extraction_method=discovery_method, possible_shared_chain_page=False, gp_count=None,
        )
        result['notes'] = 'no URL from discovery step'
        return result

    scheme = urlparse(url).scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        result['gp_count_scrape_confidence'] = derive_confidence(
            url_rejected=True, error_class=None, bot_challenge=False,
            extraction_method=discovery_method, possible_shared_chain_page=False, gp_count=None,
        )
        result['notes'] = f'skipped -- non-http(s) URL scheme ({scheme or "none"})'
        return result

    exc = await goto_with_retry(page, url)
    if exc is not None:
        error_class = classify_fetch_error(exc)
        result['gp_count_scrape_confidence'] = derive_confidence(
            url_rejected=False, error_class=error_class, bot_challenge=False,
            extraction_method=discovery_method, possible_shared_chain_page=False, gp_count=None,
        )
        result['notes'] = f'{error_class}: {str(exc)[:80]}'
        return result

    try:
        text = await page.evaluate('() => document.body.innerText')
    except Exception as e:
        # A page that redirects itself client-side (JS/meta-refresh) right
        # after `load` fires destroys the execution context out from under
        # this read -- caught here instead of letting it propagate and kill
        # the entire multi-hour run over one flaky site.
        error_class = classify_fetch_error(e)
        result['gp_count_scrape_confidence'] = derive_confidence(
            url_rejected=False, error_class=error_class, bot_challenge=False,
            extraction_method=discovery_method, possible_shared_chain_page=False, gp_count=None,
        )
        result['notes'] = f'{error_class}: {str(e)[:80]}'
        return result

    bot_challenge = looks_like_bot_challenge(text)

    possible_shared_chain_page = (
        discovery_method == 'chain_pattern_reuse' and not mentions_own_clinic(text, clinic_name)
    )

    try:
        dom_result = await page.evaluate(DETECT_CARD_GRID_JS)
    except Exception:
        dom_result = None  # detection is best-effort; falls through to regex below

    grid_signal = None
    name_extraction_method = None

    if dom_result and dom_result.get('card_count', 0) >= 1:
        cards = dom_result['cards']
        for c in cards:
            c['role_class'] = classify_card_role(c.get('role_text'))
        gp_cards = [c for c in cards if c['role_class'] != 'non_gp' and c.get('name_shape_ok')]
        names, seen = [], set()
        for c in gp_cards:
            name = clean_card_name(c.get('name'))
            if not name:
                continue
            key = dedup_key(name)
            if key in seen:
                continue
            seen.add(key)
            names.append(name)
        name_extraction_method = dom_result['method']
        n = len(cards)
        grid_signal = {
            'card_count': dom_result['card_count'],
            'name_shape_pass_ratio': sum(1 for c in cards if c.get('name_shape_ok')) / n,
            'photo_like_ratio': sum(1 for c in cards if c.get('photo_like')) / n,
            'unknown_role_ratio': sum(1 for c in cards if c['role_class'] == 'unknown') / n,
        }
    elif ALLOW_FLAT_REGEX_FALLBACK:
        names = extract_doctor_names(text)
        name_extraction_method = 'flat_text_regex_fallback'
    else:
        names = []
        name_extraction_method = 'no_structure_found'

    result['gp_count_scraped'] = len(names)
    result['doctor_names_scraped'] = ', '.join(names)
    result['name_extraction_method'] = name_extraction_method
    result['scraped_at'] = datetime.now(timezone.utc).isoformat()
    result['gp_count_scrape_confidence'] = derive_confidence(
        url_rejected=False, error_class=None, bot_challenge=bot_challenge,
        extraction_method=discovery_method, possible_shared_chain_page=possible_shared_chain_page,
        gp_count=result['gp_count_scraped'], match_score=match_score,
        name_extraction_method=name_extraction_method, grid_signal=grid_signal,
    )
    notes = []
    if bot_challenge:
        notes.append('bot challenge page suspected')
    if possible_shared_chain_page:
        notes.append("page doesn't mention this clinic -- possible chain-wide page")
    if result['gp_count_scraped'] and result['gp_count_scraped'] > ANOMALOUS_COUNT_THRESHOLD:
        notes.append(f'anomalously high count (>{ANOMALOUS_COUNT_THRESHOLD}) -- verify not aggregated')
    if name_extraction_method == 'flat_text_regex_fallback':
        notes.append('no structured team listing found; unstructured text-regex fallback used -- verify manually')
    elif match_score is not None and match_score <= 2:
        notes.append(f'weak page match (score={match_score}) -- may be a generic/corporate page, not a real roster')
    result['notes'] = '; '.join(notes)
    return result


async def run_scrape(rows, out_path, resume):
    from playwright.async_api import async_playwright

    skip_ids = already_scraped_ids(out_path) if resume else set()
    if skip_ids:
        print(f'--resume: skipping {len(skip_ids)} clinics already in {out_path}')

    pending = [r for r in rows if r['clinic_id'] not in skip_ids]
    mode = 'a' if (resume and skip_ids) else 'w'
    confidence_counts = {'high': 0, 'medium': 0, 'low': 0}

    with open(out_path, mode, newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if mode == 'w':
            writer.writeheader()
            f.flush()

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (compatible; FoundryHealthDataAudit/1.0; +https://foundry.health)'
            )
            page = await context.new_page()

            for i, row in enumerate(pending, 1):
                # Recycle the browser context periodically on a long run --
                # avoids unbounded memory growth / cross-site state buildup
                # across thousands of sequential navigations in one page.
                if i > 1 and i % 200 == 1:
                    await page.close()
                    await context.close()
                    context = await browser.new_context(
                        user_agent='Mozilla/5.0 (compatible; FoundryHealthDataAudit/1.0; +https://foundry.health)'
                    )
                    page = await context.new_page()

                try:
                    result = await scrape_one(page, row)
                except Exception as e:
                    # Last-resort net: scrape_one already catches every
                    # navigation/extraction failure mode we know about, but a
                    # multi-hour unattended run over thousands of unpredictable
                    # external sites isn't a place to bet that's exhaustive --
                    # one clinic's unforeseen failure must not take down the
                    # whole job.
                    result = {
                        'clinic_id': row['clinic_id'], 'clinic_name': row.get('clinic_name', ''),
                        'source_url': row.get('discovered_gp_page_url'),
                        'extraction_method': row.get('discovery_method'),
                        'gp_count_scraped': None, 'doctor_names_scraped': '',
                        'gp_count_scrape_confidence': 'low', 'name_extraction_method': None,
                        'scraped_at': None, 'notes': f'unexpected error: {str(e)[:80]}',
                    }
                confidence_counts[result['gp_count_scrape_confidence']] = (
                    confidence_counts.get(result['gp_count_scrape_confidence'], 0) + 1
                )
                writer.writerow(result)
                f.flush()
                os.fsync(f.fileno())
                print(f"  [{i}/{len(pending)}] {result['clinic_id']}: "
                      f"gp_count_scraped={result['gp_count_scraped']} "
                      f"confidence={result['gp_count_scrape_confidence']} "
                      f"({result['extraction_method']}) {result['notes']}")

            await context.close()
            await browser.close()

    return len(pending), confidence_counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--in', dest='in_path', required=True, help='CSV from discover_gp_page_urls.py')
    parser.add_argument('--out', default='gp_names_scraped.csv')
    parser.add_argument('--resume', action='store_true',
                         help='Skip clinic_ids already present in --out and append to it, '
                              'instead of starting over -- for resuming after a crash/kill.')
    parser.add_argument('--exclude-corporate', action='store_true',
                         help='Skip clinics whose corporate_chain is a real chain (not '
                              "independent/none) -- corporate-chain gp_count is out of scope "
                              'for scrape-based correction (see lib_gp_scrape.is_corporate_chain).')
    args = parser.parse_args()

    rows = read_discovery_csv(args.in_path)
    if args.exclude_corporate:
        before = len(rows)
        rows = [r for r in rows if not is_corporate_chain(r.get('corporate_chain'))]
        print(f'--exclude-corporate: {before - len(rows)} corporate-chain clinics skipped, {len(rows)} independents remain.')
    print(f'{len(rows)} clinics in discovery input.')
    processed, confidence_counts = asyncio.run(run_scrape(rows, args.out, args.resume))

    print(f'\nProcessed {processed} clinics this run.')
    print(f"Confidence breakdown: high={confidence_counts.get('high', 0)} "
          f"medium={confidence_counts.get('medium', 0)} low={confidence_counts.get('low', 0)}")
    print(f'Written to {args.out} -- review before merging any values into Supabase '
          f'(gp_count/doctor_names stay untouched; scraped values are in the '
          f'gp_count_scraped/doctor_names_scraped sibling columns for comparison).')


if __name__ == '__main__':
    main()
