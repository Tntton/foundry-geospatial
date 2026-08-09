#!/usr/bin/env python3
"""
GP-count data-integrity remediation, Phase 3 -- quantify the real mismatch
rate between Supabase's `gp_count` and reality, before deciding whether the
Phase 4 discover+scrape pipeline needs to run against every clinic or just
the ones already flagged `likely_undercount` by the Phase 0 view.

Runs the same discover-then-scrape steps as discover_gp_page_urls.py /
scrape_gp_names_from_page.py (via lib_gp_scrape, so the three scripts can't
drift out of sync), just combined into one pass over a sample instead of
writing two separate intermediate CSVs -- this script's job is measurement,
not production data replacement.

Does NOT write back to Supabase. Actually running this against live
external clinic websites is a deliberate action for a human to kick off
when ready, not something to run automatically as part of a code change.

Usage:
    python3 scripts/audit_gp_count_accuracy.py [--sample-size 120] [--out audit_results.csv]

Requires: requests, playwright (`playwright install chromium` once).
"""

import argparse
import asyncio
import csv
import random
from collections import defaultdict
from datetime import datetime, timezone
from urllib.parse import urljoin

import requests

from lib_gp_scrape import extract_doctor_names, pick_best_team_page_link

SUPABASE_URL = 'https://ytervdshmvdawoomhnlp.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_3cXEeYAJg3u3CX_j8ITJQg_jLLPouw-'
HEADERS = {'apikey': SUPABASE_ANON_KEY, 'Authorization': f'Bearer {SUPABASE_ANON_KEY}'}


def fetch_reliability_rows():
    """Pull clinic_id/gp_count/gp_count_reliability from the Phase 0 view."""
    resp = requests.get(
        f'{SUPABASE_URL}/rest/v1/clinic_gp_count_reliability',
        headers=HEADERS,
        params={'select': 'clinic_id,gp_count,gp_count_reliability', 'limit': '5000'},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_clinic_details(clinic_ids):
    if not clinic_ids:
        return {}
    ids_csv = ','.join(str(c) for c in clinic_ids)
    resp = requests.get(
        f'{SUPABASE_URL}/rest/v1/clinics',
        headers=HEADERS,
        params={'select': 'clinic_id,name,website', 'clinic_id': f'in.({ids_csv})'},
        timeout=30,
    )
    resp.raise_for_status()
    return {row['clinic_id']: row for row in resp.json()}


def build_stratified_sample(rows, sample_size):
    """Stratify by reliability flag so the mismatch rate can be reported
    per-stratum (is it concentrated in likely_undercount, or systemic
    across unverified rows too)."""
    by_reliability = defaultdict(list)
    for r in rows:
        by_reliability[r['gp_count_reliability']].append(r)

    per_stratum = max(1, sample_size // max(1, len(by_reliability)))
    sample = []
    for group in by_reliability.values():
        random.shuffle(group)
        sample.extend(group[:per_stratum])
    return sample[:sample_size]


async def audit_one(page, clinic, details):
    website = (details.get('website') or '').strip()
    result = {
        'clinic_id': clinic['clinic_id'],
        'clinic_name': details.get('name', ''),
        'recorded_gp_count': clinic['gp_count'],
        'gp_count_reliability': clinic['gp_count_reliability'],
        'website': website,
        'source_url': None,
        'discovery_method': None,
        'actual_gp_count_found': None,
        'match': None,
        'notes': '',
    }
    if not website:
        result['notes'] = 'no website on file'
        return result

    try:
        # Same two-step logic as discover_gp_page_urls.py -> scrape_gp_names_from_page.py,
        # just done in one pass since this is measurement, not the production pipeline.
        await page.goto(website, timeout=15000, wait_until='load')
        links = await page.eval_on_selector_all(
            'a', 'els => els.map(e => ({href: e.href, text: e.innerText}))'
        )
        best_href = pick_best_team_page_link(links)
        target_url = urljoin(website, best_href) if best_href else website
        result['source_url'] = target_url
        result['discovery_method'] = 'homepage_link_scan' if best_href else 'fallback_homepage'

        if target_url != website:
            await page.goto(target_url, timeout=15000, wait_until='load')
        text = await page.evaluate('() => document.body.innerText')
        names = extract_doctor_names(text)

        result['actual_gp_count_found'] = len(names)
        result['match'] = (result['actual_gp_count_found'] == result['recorded_gp_count'])
    except Exception as e:
        result['notes'] = f'fetch error: {str(e)[:60]}'

    return result


async def run_audit(sample, details_by_id, out_path):
    from playwright.async_api import async_playwright

    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        for clinic in sample:
            details = details_by_id.get(clinic['clinic_id'], {})
            result = await audit_one(page, clinic, details)
            results.append(result)
            print(f"  {result['clinic_id']} ({result['gp_count_reliability']}): "
                  f"recorded={result['recorded_gp_count']} found={result['actual_gp_count_found']} "
                  f"({result['discovery_method']}) match={result['match']} {result['notes']}")
        await browser.close()

    with open(out_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(results[0].keys()) if results else [])
        writer.writeheader()
        writer.writerows(results)

    return results


def print_summary(results):
    by_stratum = defaultdict(lambda: {'total': 0, 'mismatch': 0, 'no_website': 0, 'error': 0})
    for r in results:
        s = by_stratum[r['gp_count_reliability']]
        s['total'] += 1
        if r['match'] is False:
            s['mismatch'] += 1
        elif r['website'] == '':
            s['no_website'] += 1
        elif r['match'] is None:
            s['error'] += 1

    print('\n=== Mismatch rate by stratum ===')
    for stratum, s in by_stratum.items():
        checked = s['total'] - s['no_website'] - s['error']
        rate = round(100 * s['mismatch'] / checked, 1) if checked else None
        print(f"  {stratum}: {s['mismatch']}/{checked} checked mismatched "
              f"({rate}%), {s['no_website']} no website, {s['error']} errors, {s['total']} total")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sample-size', type=int, default=120)
    parser.add_argument('--out', default=f"audit_results_{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv")
    args = parser.parse_args()

    print('Fetching clinic_gp_count_reliability rows...')
    rows = fetch_reliability_rows()
    print(f'{len(rows)} GP-market clinics on file. Building stratified sample of ~{args.sample_size}...')
    sample = build_stratified_sample(rows, args.sample_size)
    details_by_id = fetch_clinic_details([c['clinic_id'] for c in sample])

    print(f'Auditing {len(sample)} clinics against their live websites -- this will take a while...')
    results = asyncio.run(run_audit(sample, details_by_id, args.out))

    print_summary(results)
    print(f'\nFull results written to {args.out}')


if __name__ == '__main__':
    main()
