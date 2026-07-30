#!/usr/bin/env python3
"""
Enhanced doctor page scraper for clinics.
Crawls /doctors, /our-doctors, /team, /staff pages to extract detailed GP information.
Outputs: gp_clinic_mapping.csv with GP names, headcount, and FTE attribution.
"""

import pandas as pd
import asyncio
from playwright.async_api import async_playwright
import re
from collections import defaultdict
import os

INPUT_WEBSITES = "data/clinics/Scrape Results/clinic_websites_and_reviews.csv"
OUTPUT_MAPPING = "gp_clinic_mapping.csv"
OUTPUT_CLINIC_GP_COUNT = "clinic_gp_enhanced.csv"

DOCTOR_PATHS = [
    '/doctors',
    '/our-doctors',
    '/team',
    '/staff',
    '/gps',
    '/doctors-team',
    '/meet-our-doctors',
    '/about/doctors',
]

async def scrape_doctor_page(clinic_data, page):
    """
    Scrape doctor/team pages from a clinic website.
    Returns: dict with gp_names, gp_count, source_page
    """
    website_url = clinic_data.get('website_url')
    if not website_url or not isinstance(website_url, str) or not website_url.strip():
        return None

    website = website_url.strip().rstrip('/')
    gp_data = {
        'OBJECTID': clinic_data['OBJECTID'],
        'clinic_name': clinic_data.get('ORGANISATION_NAME', ''),
        'website': website,
        'gp_names': [],
        'gp_count': 0,
        'source_page': None,
        'status': 'no_data'
    }

    # Try each doctor page path
    for path in DOCTOR_PATHS:
        try:
            full_url = website + path
            # Increased timeout to 15 seconds and use load instead of domcontentloaded
            await page.goto(full_url, timeout=15000, wait_until='load')

            # Extract page text
            text = await page.evaluate('() => document.body.innerText')

            # Look for doctor/GP patterns
            # Pattern 1: "Dr. [Name]" or "Dr [Name]"
            dr_pattern = r'(?:Dr\.?|Doctor)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)'
            matches = re.findall(dr_pattern, text)

            if matches:
                gp_names = list(set(matches))[:10]  # Dedupe, limit to 10
                gp_data['gp_names'] = gp_names
                gp_data['gp_count'] = len(gp_names)
                gp_data['source_page'] = path
                gp_data['status'] = 'success'
                return gp_data

        except Exception as e:
            # Silently continue to next path on any error (timeout, network, etc)
            continue

    return gp_data

CHECKPOINT_EVERY = 50   # Save CSV every N clinics
PARALLEL_PAGES   = 8    # Concurrent pages per browser (safe limit)


def flush_to_csv(results, output_path, gp_id_start=1000):
    """Append successful results to CSV. Returns next gp_id."""
    mapping_rows = []
    gp_id = gp_id_start
    for result in results:
        if not result or result['status'] != 'success':
            continue
        fte_per_gp = round(1.0 / result['gp_count'], 2)
        for name in result['gp_names']:
            mapping_rows.append({
                'GP_ID': f'GP_{gp_id}',
                'GP_Name': name,
                'Clinic_OBJECTID': result['OBJECTID'],
                'Clinic_Name': result['clinic_name'],
                'FTE': fte_per_gp,
                'Data_Source': 'enhanced_scrape',
                'Headcount_At_Clinic': result['gp_count'],
            })
            gp_id += 1
    if mapping_rows:
        df = pd.DataFrame(mapping_rows)
        write_header = not os.path.exists(output_path)
        df.to_csv(output_path, mode='a', header=write_header, index=False)
    return gp_id


async def scrape_all_doctors(clinics_df, batch_size=PARALLEL_PAGES):
    """
    Scrape doctor pages in parallel (PARALLEL_PAGES concurrent pages).
    Checkpoints to CSV every CHECKPOINT_EVERY clinics.
    """
    all_results = []
    gp_id_counter = 1000
    total = len(clinics_df)
    pending_checkpoint = []   # accumulates results between checkpoints

    if os.path.exists(OUTPUT_MAPPING):
        os.remove(OUTPUT_MAPPING)

    async with async_playwright() as p:
        browser = await p.chromium.launch()

        for batch_idx in range(0, total, batch_size):
            batch = clinics_df.iloc[batch_idx:batch_idx+batch_size]

            # Create one page per clinic in batch, scrape in parallel
            pages = [await browser.new_page() for _ in range(len(batch))]
            try:
                tasks = [
                    scrape_doctor_page(row.to_dict(), page)
                    for (_, row), page in zip(batch.iterrows(), pages)
                ]
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            finally:
                for page in pages:
                    await page.close()

            # Filter out exceptions, keep valid results
            valid = [r for r in batch_results if r and not isinstance(r, Exception)]
            all_results.extend(valid)
            pending_checkpoint.extend(valid)

            completed = min(batch_idx + batch_size, total)
            print(f"Progress: {completed}/{total} clinics scraped", flush=True)

            # Checkpoint every CHECKPOINT_EVERY clinics
            if completed % CHECKPOINT_EVERY < batch_size or completed == total:
                gp_id_counter = flush_to_csv(pending_checkpoint, OUTPUT_MAPPING, gp_id_counter)
                pending_checkpoint = []
                csv_rows = (sum(1 for _ in open(OUTPUT_MAPPING)) - 1) if os.path.exists(OUTPUT_MAPPING) else 0
                hit = sum(1 for r in all_results if r and r.get('status') == 'success')
                print(f"  ✓ Checkpoint @ {completed}: {hit} clinics with GP data · {csv_rows} CSV rows", flush=True)

        await browser.close()

    return all_results

def build_gp_mapping(doctor_results):
    """
    Build GP-to-clinic mapping from doctor scrape results.
    Outputs: gp_clinic_mapping.csv with rows for each GP-clinic relationship.
    """
    mapping_rows = []
    gp_id_counter = 1000

    for result in doctor_results:
        if not result or result['status'] != 'success':
            continue

        clinic_objectid = result['OBJECTID']
        clinic_name = result['clinic_name']
        gp_count = result['gp_count']
        gp_names = result['gp_names']

        if gp_count == 0:
            continue

        # Assume even FTE distribution across GPs at clinic
        fte_per_gp = 1.0 / gp_count

        for gp_name in gp_names:
            mapping_rows.append({
                'GP_ID': f'GP_{gp_id_counter}',
                'GP_Name': gp_name,
                'Clinic_OBJECTID': clinic_objectid,
                'Clinic_Name': clinic_name,
                'FTE': round(fte_per_gp, 2),
                'Data_Source': 'enhanced_scrape',
                'Headcount_At_Clinic': gp_count
            })
            gp_id_counter += 1

    return pd.DataFrame(mapping_rows)

def enrich_clinics_with_gp_data(doctor_results, clinics_df):
    """
    Add GP headcount and names to enriched_clinics.csv
    """
    gp_summary = {}

    for result in doctor_results:
        if result and result['status'] == 'success':
            objectid = result['OBJECTID']
            gp_summary[objectid] = {
                'doctor_count_enhanced': result['gp_count'],
                'doctor_names_enhanced': result['gp_names'],
                'source_page': result['source_page']
            }

    # Add to clinics
    clinics_df['doctor_count_enhanced'] = clinics_df['OBJECTID'].map(
        lambda x: gp_summary.get(x, {}).get('doctor_count_enhanced', None)
    )
    clinics_df['doctor_names_enhanced'] = clinics_df['OBJECTID'].map(
        lambda x: str(gp_summary.get(x, {}).get('doctor_names_enhanced', ''))
    )

    return clinics_df

async def main():
    print("="*70)
    print("ENHANCED DOCTOR PAGE SCRAPER")
    print("="*70)

    # Load clinics with websites — filter to only those with valid URLs
    print(f"\nLoading {INPUT_WEBSITES}...")
    all_df = pd.read_csv(INPUT_WEBSITES)
    websites_df = all_df[all_df['website_url'].notna() & (all_df['website_url'].str.strip() != '')].copy()
    print(f"Loaded {len(all_df)} fetch results → {len(websites_df)} with valid website URLs (skipping {len(all_df) - len(websites_df)} with no URL)\n")

    # Scrape doctor pages
    print(f"Scraping doctor pages for {len(websites_df)} clinics...")
    doctor_results = await scrape_all_doctors(websites_df)

    successful = sum(1 for r in doctor_results if r and r['status'] == 'success')
    print(f"\n✅ Successfully scraped: {successful} clinics")
    print(f"❌ No doctor data found: {len(doctor_results) - successful} clinics")

    # Build GP-to-clinic mapping
    print("\nBuilding GP-to-clinic mapping...")
    gp_mapping = build_gp_mapping(doctor_results)
    gp_mapping.to_csv(OUTPUT_MAPPING, index=False)
    print(f"✅ Saved {len(gp_mapping)} GP-clinic relationships to {OUTPUT_MAPPING}")

    # Enrich clinics CSV with doctor data
    print("\nEnriching clinics with GP data...")
    enriched_df = pd.read_csv('data/enriched_clinics.csv')
    enriched_df = enrich_clinics_with_gp_data(doctor_results, enriched_df)
    enriched_df.to_csv('data/enriched_clinics.csv', index=False)
    print(f"✅ Updated enriched_clinics.csv with enhanced doctor data")

    # Summary stats
    print("\n" + "="*70)
    print("SUMMARY")
    print("="*70)

    gp_totals = gp_mapping.groupby('Clinic_OBJECTID')['GP_Name'].count()
    print(f"\nGP Headcount Distribution:")
    print(f"  Average GPs per clinic: {gp_totals.mean():.1f}")
    print(f"  Median: {gp_totals.median():.0f}")
    print(f"  Max: {gp_totals.max():.0f}")
    print(f"  Min: {gp_totals.min():.0f}")

    print(f"\nOutput files:")
    print(f"  - {OUTPUT_MAPPING}: {len(gp_mapping)} rows (GP-clinic pairs)")
    print(f"  - enriched_clinics.csv: updated with doctor_count_enhanced & doctor_names_enhanced")

if __name__ == "__main__":
    asyncio.run(main())
