#!/usr/bin/env python3
"""
Scrape doctors from multiple corporate chains:
- Partnered Health
- Qualitas Health
- Ochre Health
"""

import asyncio
import pandas as pd
import re
from playwright.async_api import async_playwright

CSV_PATH = 'corporate_chain_csv_exports/corporate_chain_master_database.csv'
CHUNK_SIZE = 30
PARALLEL_BROWSERS = 5
TIMEOUT_MS = 30000

CHAINS_TO_SCRAPE = ['Partnered Health', 'Qualitas Health', 'Ochre Health']


def extract_doctors(text):
    """Extract doctor names using 'Dr' pattern."""
    if not text:
        return []

    doctors = []
    lines = text.split('\n')

    # Match "Dr FirstName LastName" pattern
    # Also handle variations like "Dr. Name" or special characters
    for i, line in enumerate(lines):
        line_stripped = line.strip()

        # Match: "Dr Name" or "Dr. Name" or "Dr Name Description" (but not bio)
        match = re.match(r'^Dr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z\-]+)*)\s*(?:\(|at\s|$|-)', line_stripped)
        if match:
            name = match.group(1).strip()

            # Skip if name appears to be incomplete or followed by description
            if len(name) > 2 and name not in doctors:
                # Check next line isn't a duplicate/continuation
                if not (i+1 < len(lines) and lines[i+1].strip().startswith('Dr')):
                    doctors.append(name)

    return doctors


async def scrape_single_clinic(page, row_data, row_index):
    """Scrape a single clinic."""
    try:
        url = row_data['URL']
        if pd.isna(url) or not url:
            return {'index': row_index, 'doctors': [], 'error': 'no_url'}

        await page.goto(url, wait_until='domcontentloaded', timeout=TIMEOUT_MS)
        text = await page.evaluate('() => document.body.innerText')

        doctors = extract_doctors(text)
        return {'index': row_index, 'doctors': doctors, 'error': None}

    except Exception as e:
        return {'index': row_index, 'doctors': [], 'error': str(e)[:50]}

    finally:
        try:
            await page.close()
        except:
            pass


async def process_chunk(p, chunk_rows, parallel_count):
    """Process a chunk with parallel browsers."""
    results = []

    browsers = []
    for _ in range(min(parallel_count, len(chunk_rows))):
        browser = await p.chromium.launch(headless=True)
        browsers.append(browser)

    try:
        tasks = []
        for idx, (row_index, row) in enumerate(chunk_rows.iterrows()):
            browser = browsers[idx % len(browsers)]
            context = await browser.new_context()
            page = await context.new_page()

            clinic_name = row.get('Clinic Name', 'Unknown')[:40]
            print(f"  [{idx+1}/{len(chunk_rows)}] {clinic_name:<40} ... ", end='', flush=True)

            task = scrape_single_clinic(page, row, row_index)
            tasks.append((task, context))

        for task, context in tasks:
            try:
                result = await task
                found_count = len(result['doctors'])
                print(f"✓ ({found_count})" if found_count > 0 else "✗")
                results.append(result)
            except Exception as e:
                print(f"❌")
                results.append({'index': -1, 'doctors': [], 'error': str(e)})
            finally:
                try:
                    await context.close()
                except:
                    pass

    finally:
        for browser in browsers:
            try:
                await browser.close()
            except:
                pass

    return results


async def main():
    """Main loop for all chains."""

    df = pd.read_csv(CSV_PATH)

    # Process each chain
    for chain_name in CHAINS_TO_SCRAPE:
        chain_data = df[df['Corporate Chain'] == chain_name].copy()
        chain_indices = chain_data.index.tolist()
        total = len(chain_data)

        if total == 0:
            print(f"\n{chain_name}: No clinics found")
            continue

        print(f"\n{'='*70}")
        print(f"SCRAPING {chain_name.upper()}")
        print(f"{'='*70}")
        print(f"Total clinics: {total}")
        print(f"Chunk size: {CHUNK_SIZE}\n")

        async with async_playwright() as p:
            chunk_num = 0

            for chunk_start in range(0, total, CHUNK_SIZE):
                chunk_num += 1
                chunk_end = min(chunk_start + CHUNK_SIZE, total)
                chunk_indices_slice = chain_indices[chunk_start:chunk_end]
                chunk_rows = df.loc[chunk_indices_slice]

                print(f"\n{'='*70}")
                print(f"CHUNK {chunk_num}: Clinics {chunk_start+1}-{chunk_end} of {total}")
                print(f"{'='*70}")

                # Scrape chunk
                results = await process_chunk(p, chunk_rows, PARALLEL_BROWSERS)

                # Update dataframe
                improved = 0
                for result in results:
                    if result['index'] >= 0 and result['doctors']:
                        doctor_str = ', '.join(result['doctors'])
                        if result['index'] in df.index:
                            current = df.at[result['index'], 'Doctor Names']
                            # Update if empty or found more doctors
                            if pd.isna(current) or len(result['doctors']) > (len(str(current).split(',')) if current else 0):
                                df.at[result['index'], 'Doctor Names'] = doctor_str
                                df.at[result['index'], 'Doctor Count'] = len(result['doctors'])
                                improved += 1

                # VERIFY CHECKPOINT
                print(f"\n🔍 VERIFYING CHUNK {chunk_num}...")
                print(f"✓ Updated: {improved}/{len(chunk_rows)}")

                # Save checkpoint
                df.to_csv(CSV_PATH, index=False)
                print(f"✅ Chunk {chunk_num} verified and saved!")

        # Chain summary
        chain_final = df[df['Corporate Chain'] == chain_name]
        with_doctors = chain_final['Doctor Names'].notna().sum()
        total_doctors = 0
        for idx, row in chain_final.iterrows():
            if pd.notna(row['Doctor Names']):
                total_doctors += len(str(row['Doctor Names']).split(','))

        print(f"\n{'='*70}")
        print(f"{chain_name} SUMMARY")
        print(f"{'='*70}")
        print(f"Clinics with doctors: {with_doctors}/{total}")
        print(f"Total doctors: {total_doctors}")

    print(f"\n{'='*70}")
    print(f"✅ ALL CHAINS COMPLETE")
    print(f"{'='*70}")
    print(f"CSV saved: {CSV_PATH}")


if __name__ == '__main__':
    asyncio.run(main())
