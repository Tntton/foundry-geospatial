#!/usr/bin/env python3
"""
GP-count data-integrity remediation, Phase 4 (Step 1 of 2) -- discovery.

For each GP-market clinic, visit its homepage and find whichever real link
on that page looks like a dedicated "our doctors"/team/staff listing
(scored via lib_gp_scrape.pick_best_team_page_link, based on the link's own
href/text -- not a fixed list of guessed URL paths, since clinic sites vary
a lot in how they structure this). Writes the discovered URL per clinic to
a CSV; does NOT scrape names yet -- that's scrape_gp_names_from_page.py's
job, kept as a separate step so discovery and extraction can each be
re-run/improved independently without redoing the other.

Corporate-chain shortcut: clinics are processed grouped by
`corporate_chain`. The first clinic in each real chain (2+ clinics, not
null/"Independent") is discovered normally; its result's URL *path* (e.g.
"/our-team") is then tried directly against every other clinic in that
same chain before falling back to a full link-scan -- many chains run
every location on the same site template, so this saves a full homepage
crawl for the rest of the chain. Self-correcting: if the guessed path
doesn't load, that clinic just falls back to full discovery.

Does NOT write back to Supabase. Actually running this against live
external clinic websites is a deliberate action for a human to kick off
when ready, not something to run automatically as part of a code change.

Writes incrementally (flushed per clinic) and supports --resume, so a crash
or kill partway through a multi-hour run over thousands of clinics doesn't
lose everything discovered so far.

Usage:
    python3 scripts/discover_gp_page_urls.py [--limit 500] [--out gp_page_discovery.csv] [--resume]

Requires: requests, playwright (`playwright install chromium` once).
"""

import argparse
import asyncio
import csv
import os
from collections import defaultdict
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import requests

from lib_gp_scrape import NON_CHAIN_VALUES, pick_best_team_page_link

SUPABASE_URL = 'https://ytervdshmvdawoomhnlp.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_3cXEeYAJg3u3CX_j8ITJQg_jLLPouw-'
HEADERS = {'apikey': SUPABASE_ANON_KEY, 'Authorization': f'Bearer {SUPABASE_ANON_KEY}'}

FIELDNAMES = [
    'clinic_id', 'clinic_name', 'website', 'corporate_chain',
    'discovered_gp_page_url', 'discovery_method', 'match_score', 'discovered_at', 'notes',
]

# PostgREST caps rows-per-request at 1000 server-side on this project
# regardless of a larger `limit` query param -- confirmed live (a plain
# limit=5000 request came back with exactly 1000 rows). Paginate with the
# Range header to actually get everything.
PAGE_SIZE = 1000


def fetch_all_pages(url, params):
    all_rows = []
    offset = 0
    while True:
        headers = {**HEADERS, 'Range': f'{offset}-{offset + PAGE_SIZE - 1}'}
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        page = resp.json()
        all_rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return all_rows


def fetch_gp_clinics(limit, reliability=None, clinic_ids=None):
    """`reliability`, if given, is a list of clinic_gp_count_reliability
    values (e.g. ['likely_undercount', 'unverified']) -- scopes discovery to
    only the clinics actually in question, instead of every GP clinic.
    `clinic_ids`, if given, scopes to that exact explicit set instead (e.g.
    a targeted re-run against clinics a previous run got wrong) -- takes
    precedence over `reliability` if both are somehow given."""
    clinic_id_filter = None
    if clinic_ids:
        clinic_id_filter = list(clinic_ids)
    elif reliability:
        clinic_id_filter = [r['clinic_id'] for r in fetch_all_pages(
            f'{SUPABASE_URL}/rest/v1/clinic_gp_count_reliability',
            {'select': 'clinic_id', 'gp_count_reliability': f"in.({','.join(reliability)})"},
        )]
        if not clinic_id_filter:
            return []

    params = {
        'select': 'clinic_id,name,website,corporate_chain',
        'market_id': 'eq.gp',
        'website': 'not.is.null',
    }
    if clinic_id_filter:
        params['clinic_id'] = f"in.({','.join(str(c) for c in clinic_id_filter)})"

    rows = fetch_all_pages(f'{SUPABASE_URL}/rest/v1/clinics', params)
    return rows[:limit]


def is_plausible_team_page(links, text):
    """Cheap sanity check for a guessed chain-pattern URL: does this page
    actually look like a team/doctors listing, not a 404 or an unrelated
    page that happened to return 200? Requires either a real doctor-name
    match or at least one link that itself still looks team/doctors-like
    (some team pages are just a list of profile-photo links)."""
    from lib_gp_scrape import extract_doctor_names, score_team_page_link
    if extract_doctor_names(text):
        return True
    return any(score_team_page_link(l.get('href'), l.get('text')) >= 3 for l in links)


async def discover_one(page, clinic, chain_pattern_path=None):
    website = (clinic.get('website') or '').strip()
    result = {
        'clinic_id': clinic['clinic_id'],
        'clinic_name': clinic.get('name', ''),
        'website': website,
        'corporate_chain': clinic.get('corporate_chain') or '',
        'discovered_gp_page_url': None,
        'discovery_method': None,
        'match_score': None,
        'discovered_at': None,
        'notes': '',
    }
    if not website:
        result['notes'] = 'no website on file'
        return result

    try:
        # Chain shortcut: try the sibling-derived path directly first --
        # skips a full homepage crawl if this clinic's site follows the
        # same template as the rest of its chain.
        if chain_pattern_path:
            try:
                guess_url = urljoin(website, chain_pattern_path)
                await page.goto(guess_url, timeout=15000, wait_until='load')
                text = await page.evaluate('() => document.body.innerText')
                links = await page.eval_on_selector_all(
                    'a', 'els => els.map(e => ({href: e.href, text: e.innerText}))'
                )
                if is_plausible_team_page(links, text):
                    result['discovered_gp_page_url'] = guess_url
                    result['discovery_method'] = 'chain_pattern_reuse'
                    result['discovered_at'] = datetime.now(timezone.utc).isoformat()
                    return result
            except Exception:
                pass  # fall through to full discovery below

        await page.goto(website, timeout=15000, wait_until='load')
        links = await page.eval_on_selector_all(
            'a', 'els => els.map(e => ({href: e.href, text: e.innerText}))'
        )
        best_href, best_score = pick_best_team_page_link(links)
        if best_href:
            result['discovered_gp_page_url'] = urljoin(website, best_href)
            result['discovery_method'] = 'homepage_link_scan'
            result['match_score'] = best_score
        else:
            result['discovered_gp_page_url'] = website
            result['discovery_method'] = 'no_team_page_found_fallback_homepage'
        result['discovered_at'] = datetime.now(timezone.utc).isoformat()
    except Exception as e:
        result['notes'] = f'fetch error: {str(e)[:60]}'

    return result


def path_of(url):
    """Extract just the path+query of a discovered URL, for reuse against
    a sibling clinic's own domain (e.g. 'https://a.com/our-team' -> '/our-team')."""
    if not url:
        return None
    parsed = urlparse(url)
    return parsed.path + (f'?{parsed.query}' if parsed.query else '')


def group_by_chain(clinics):
    """Real, reusable chains only (2+ clinics, not null/'Independent') go
    through the pathfinder-then-reuse flow; everyone else is discovered
    individually in one 'no chain' bucket, in original order."""
    by_chain = defaultdict(list)
    for c in clinics:
        chain = (c.get('corporate_chain') or '').strip()
        key = chain if chain.lower() not in NON_CHAIN_VALUES else None
        by_chain[key].append(c)

    real_chains = {k: v for k, v in by_chain.items() if k is not None and len(v) >= 2}
    solo = [c for k, v in by_chain.items() if k is None or len(v) < 2 for c in v]
    return real_chains, solo


def load_existing(out_path):
    if not os.path.exists(out_path):
        return {}
    with open(out_path, newline='') as f:
        return {row['clinic_id']: row for row in csv.DictReader(f)}


async def run_discovery(clinics, out_path, resume):
    from playwright.async_api import async_playwright

    existing = load_existing(out_path) if resume else {}
    if existing:
        print(f'--resume: {len(existing)} clinics already in {out_path}, skipping those.')

    real_chains, solo_clinics = group_by_chain(clinics)
    total = len(clinics)
    done = 0
    mode = 'a' if existing else 'w'

    with open(out_path, mode, newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if mode == 'w':
            writer.writeheader()
            f.flush()

        def emit(result, label):
            nonlocal done
            done += 1
            writer.writerow(result)
            f.flush()
            os.fsync(f.fileno())
            print(f"  [{done}/{total}] {result['clinic_id']} {label}: "
                  f"{result['discovery_method']} -> {result['discovered_gp_page_url']} {result['notes']}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()

            for chain_name, members in real_chains.items():
                pathfinder, siblings = members[0], members[1:]
                pathfinder_id = str(pathfinder['clinic_id'])
                if pathfinder_id in existing:
                    result = existing[pathfinder_id]
                    done += 1
                else:
                    result = await discover_one(page, pathfinder)
                    emit(result, f'({chain_name}, pathfinder)')

                pattern_path = path_of(result['discovered_gp_page_url']) \
                    if result['discovery_method'] == 'homepage_link_scan' else None
                pathfinder_domain = urlparse((pathfinder.get('website') or '').strip()).netloc.lower()

                for sibling in siblings:
                    sibling_id = str(sibling['clinic_id'])
                    if sibling_id in existing:
                        done += 1
                        continue
                    # Chains where every location lives on ONE shared domain
                    # (location-as-URL-path, e.g. bettermedical.com.au/clinics/<slug>/)
                    # can't use path reuse at all: urljoin-ing an absolute path
                    # against a shared domain just resolves back to the
                    # PATHFINDER's own URL for every sibling, silently attributing
                    # one location's page (and GP count) to every other location
                    # in the chain. Detected live during the 100-clinic validation
                    # run (Smart Clinics/Better Medical, My Health chains) -- falls
                    # back to a full per-clinic homepage crawl instead, same as a
                    # clinic with no chain at all.
                    sibling_domain = urlparse((sibling.get('website') or '').strip()).netloc.lower()
                    use_pattern = pattern_path if (sibling_domain and sibling_domain != pathfinder_domain) else None

                    sib_result = await discover_one(page, sibling, chain_pattern_path=use_pattern)
                    emit(sib_result, f'({chain_name})')

            for clinic in solo_clinics:
                clinic_id = str(clinic['clinic_id'])
                if clinic_id in existing:
                    done += 1
                    continue
                result = await discover_one(page, clinic)
                emit(result, '')

            await browser.close()

    with open(out_path, newline='') as f:
        return list(csv.DictReader(f))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=500)
    parser.add_argument('--out', default='gp_page_discovery.csv')
    parser.add_argument('--reliability', default=None,
                         help="Comma-separated clinic_gp_count_reliability values to scope to "
                              "(e.g. 'likely_undercount,unverified') -- omit to run against all GP clinics.")
    parser.add_argument('--resume', action='store_true',
                         help='Skip clinic_ids already present in --out and append to it, '
                              'instead of starting over -- for resuming after a crash/kill.')
    parser.add_argument('--clinic-ids-file', default=None,
                         help='Path to a text file of one clinic_id per line -- scopes discovery '
                              'to exactly this set (e.g. a targeted re-run against clinics a '
                              'previous run got wrong), overriding --reliability and --limit.')
    args = parser.parse_args()
    reliability = args.reliability.split(',') if args.reliability else None
    clinic_ids = None
    if args.clinic_ids_file:
        with open(args.clinic_ids_file) as f:
            clinic_ids = [line.strip() for line in f if line.strip()]

    print('Fetching GP-market clinics with a website on file...')
    limit = len(clinic_ids) if clinic_ids else args.limit
    clinics = fetch_gp_clinics(limit, reliability=reliability, clinic_ids=clinic_ids)
    print(f'{len(clinics)} clinics. Discovering team/doctors pages -- this will take a while...')
    results = asyncio.run(run_discovery(clinics, args.out, args.resume))

    found = sum(1 for r in results if r['discovery_method'] == 'homepage_link_scan')
    reused = sum(1 for r in results if r['discovery_method'] == 'chain_pattern_reuse')
    print(f'\nFound a dedicated team/doctors page for {found}/{len(results)} clinics via link scan, '
          f'{reused} more via chain-pattern reuse ({found + reused}/{len(results)} total).')
    print(f'Everyone else falls back to their homepage for scrape_gp_names_from_page.py.')
    print(f'Written to {args.out} -- feed this into scrape_gp_names_from_page.py next.')


if __name__ == '__main__':
    main()
