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

Does NOT write back to Supabase. Actually running this against live
external clinic websites is a deliberate action for a human to kick off
when ready, not something to run automatically as part of a code change.

Usage:
    python3 scripts/discover_gp_page_urls.py [--limit 500] [--out gp_page_discovery.csv]

Requires: requests, playwright (`playwright install chromium` once).
"""

import argparse
import asyncio
import csv
from datetime import datetime, timezone
from urllib.parse import urljoin

import requests

from lib_gp_scrape import pick_best_team_page_link

SUPABASE_URL = 'https://ytervdshmvdawoomhnlp.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_3cXEeYAJg3u3CX_j8ITJQg_jLLPouw-'
HEADERS = {'apikey': SUPABASE_ANON_KEY, 'Authorization': f'Bearer {SUPABASE_ANON_KEY}'}


def fetch_gp_clinics(limit):
    resp = requests.get(
        f'{SUPABASE_URL}/rest/v1/clinics',
        headers=HEADERS,
        params={
            'select': 'clinic_id,name,website',
            'market_id': 'eq.gp',
            'website': 'not.is.null',
            'limit': str(limit),
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


async def discover_one(page, clinic):
    website = (clinic.get('website') or '').strip()
    result = {
        'clinic_id': clinic['clinic_id'],
        'clinic_name': clinic.get('name', ''),
        'website': website,
        'discovered_gp_page_url': None,
        'discovery_method': None,
        'discovered_at': None,
        'notes': '',
    }
    if not website:
        result['notes'] = 'no website on file'
        return result

    try:
        await page.goto(website, timeout=15000, wait_until='load')
        links = await page.eval_on_selector_all(
            'a', 'els => els.map(e => ({href: e.href, text: e.innerText}))'
        )
        best_href = pick_best_team_page_link(links)
        if best_href:
            result['discovered_gp_page_url'] = urljoin(website, best_href)
            result['discovery_method'] = 'homepage_link_scan'
        else:
            result['discovered_gp_page_url'] = website
            result['discovery_method'] = 'no_team_page_found_fallback_homepage'
        result['discovered_at'] = datetime.now(timezone.utc).isoformat()
    except Exception as e:
        result['notes'] = f'fetch error: {str(e)[:60]}'

    return result


async def run_discovery(clinics, out_path):
    from playwright.async_api import async_playwright

    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        for i, clinic in enumerate(clinics, 1):
            result = await discover_one(page, clinic)
            results.append(result)
            print(f"  [{i}/{len(clinics)}] {result['clinic_id']}: "
                  f"{result['discovery_method']} -> {result['discovered_gp_page_url']} {result['notes']}")
        await browser.close()

    with open(out_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(results[0].keys()) if results else [])
        writer.writeheader()
        writer.writerows(results)

    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=500)
    parser.add_argument('--out', default='gp_page_discovery.csv')
    args = parser.parse_args()

    print('Fetching GP-market clinics with a website on file...')
    clinics = fetch_gp_clinics(args.limit)
    print(f'{len(clinics)} clinics. Discovering team/doctors pages -- this will take a while...')
    results = asyncio.run(run_discovery(clinics, args.out))

    found = sum(1 for r in results if r['discovery_method'] == 'homepage_link_scan')
    print(f'\nFound a dedicated team/doctors page for {found}/{len(results)} clinics.')
    print(f'Everyone else falls back to their homepage for scrape_gp_names_from_page.py.')
    print(f'Written to {args.out} -- feed this into scrape_gp_names_from_page.py next.')


if __name__ == '__main__':
    main()
