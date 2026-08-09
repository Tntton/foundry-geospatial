#!/usr/bin/env python3
"""
GP-count data-integrity remediation, Phase 4 (Step 2 of 2) -- extraction.

Given discover_gp_page_urls.py's output (each clinic's already-known
`discovered_gp_page_url`), visit exactly that URL and extract the real GP
names on it. Deliberately decoupled from discovery: this step can be
re-run on its own (e.g. once the name-extraction regex improves) without
re-crawling every clinic's homepage to re-find the same URL again.

Writes a CSV with `gp_count`/`doctor_names`/`source_url`/`scraped_at` per
clinic -- for a human to review before importing into Supabase's
`clinics.gp_count` / `doctor_names` / `gp_count_source_url` /
`gp_count_last_scraped_at` / `gp_count_confidence` (see
scripts/supabase_migration/schema.sql's Phase 1 columns). This script does
NOT write to Supabase itself, and actually running it against live
external clinic websites is a deliberate action for a human to kick off
when ready.

Usage:
    python3 scripts/scrape_gp_names_from_page.py --in gp_page_discovery.csv [--out gp_names_scraped.csv]

Requires: playwright (`playwright install chromium` once).
"""

import argparse
import asyncio
import csv
from datetime import datetime, timezone

from lib_gp_scrape import extract_doctor_names


def read_discovery_csv(path):
    with open(path, newline='') as f:
        return list(csv.DictReader(f))


async def scrape_one(page, row):
    url = row.get('discovered_gp_page_url')
    result = {
        'clinic_id': row['clinic_id'],
        'clinic_name': row.get('clinic_name', ''),
        'source_url': url,
        'extraction_method': row.get('discovery_method'),
        'gp_count': None,
        'doctor_names': '',
        'scraped_at': None,
        'notes': '',
    }
    if not url:
        result['notes'] = 'no URL from discovery step'
        return result

    try:
        await page.goto(url, timeout=15000, wait_until='load')
        text = await page.evaluate('() => document.body.innerText')
        names = extract_doctor_names(text)
        result['gp_count'] = len(names)
        result['doctor_names'] = ', '.join(names)
        result['scraped_at'] = datetime.now(timezone.utc).isoformat()
    except Exception as e:
        result['notes'] = f'fetch error: {str(e)[:60]}'

    return result


async def run_scrape(rows, out_path):
    from playwright.async_api import async_playwright

    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        for i, row in enumerate(rows, 1):
            result = await scrape_one(page, row)
            results.append(result)
            print(f"  [{i}/{len(rows)}] {result['clinic_id']}: "
                  f"gp_count={result['gp_count']} ({result['extraction_method']}) {result['notes']}")
        await browser.close()

    with open(out_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(results[0].keys()) if results else [])
        writer.writeheader()
        writer.writerows(results)

    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--in', dest='in_path', required=True, help='CSV from discover_gp_page_urls.py')
    parser.add_argument('--out', default='gp_names_scraped.csv')
    args = parser.parse_args()

    rows = read_discovery_csv(args.in_path)
    print(f'{len(rows)} clinics to scrape from their already-discovered URL...')
    results = asyncio.run(run_scrape(rows, args.out))

    scraped = sum(1 for r in results if r['gp_count'] is not None)
    print(f'\nSuccessfully scraped {scraped}/{len(results)} clinics.')
    print(f'Written to {args.out} -- review before importing into Supabase '
          f'(gp_count, doctor_names, gp_count_source_url, gp_count_last_scraped_at, '
          f'gp_count_confidence=\'high\').')


if __name__ == '__main__':
    main()
