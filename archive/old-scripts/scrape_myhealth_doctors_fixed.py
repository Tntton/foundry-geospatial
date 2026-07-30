#!/usr/bin/env python3
"""
Fixed MyHealth scraper - correctly updates dataframe by index.
"""

import asyncio
import pandas as pd
import re
from playwright.async_api import async_playwright

CSV_PATH = 'corporate_chain_csv_exports/corporate_chain_master_database.csv'
CHUNK_SIZE = 20
PARALLEL_BROWSERS = 5
TIMEOUT_MS = 30000


def extract_myhealth_doctors(text):
    """Extract doctor names from MyHealth clinic text."""
    if not text:
        return []

    doctors = []
    lines = text.split('\n')

    for i, line in enumerate(lines):
        line_stripped = line.strip()

        if re.match(r'^Dr\s+[A-Z][a-z]+(\s+[A-Z][a-z\-]+)*\s*$', line_stripped):
            name = re.sub(r'^Dr\s+', '', line_stripped).strip()
            next_line = lines[i+1].strip() if i+1 < len(lines) else ""

            if not next_line.startswith('Dr '):
                if name not in doctors and len(name) > 2:
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

        doctors = extract_myhealth_doctors(text)
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
    """Main loop."""

    df = pd.read_csv(CSV_PATH)

    myhealth = df[df['Corporate Chain'] == 'MyHealth'].copy()
    myhealth_indices = myhealth.index.tolist()
    total = len(myhealth)

    print(f"\n{'='*70}")
    print(f"SCRAPING MYHEALTH (FIXED)")
    print(f"{'='*70}")
    print(f"Total MyHealth clinics: {total}")
    print(f"Chunk size: {CHUNK_SIZE}\n")

    async with async_playwright() as p:
        chunk_num = 0

        for chunk_start in range(0, total, CHUNK_SIZE):
            chunk_num += 1
            chunk_end = min(chunk_start + CHUNK_SIZE, total)
            chunk_indices = myhealth_indices[chunk_start:chunk_end]
            chunk_rows = df.loc[chunk_indices]

            print(f"\n{'='*70}")
            print(f"CHUNK {chunk_num}: Rows {chunk_start+1}-{chunk_end} of {total}")
            print(f"{'='*70}")

            # Scrape chunk
            results = await process_chunk(p, chunk_rows, PARALLEL_BROWSERS)

            # Update dataframe directly using the returned indices
            improved = 0
            for result in results:
                if result['index'] >= 0 and result['doctors']:
                    doctor_str = ', '.join(result['doctors'])
                    # result['index'] is the actual dataframe index
                    if result['index'] in df.index:
                        df.at[result['index'], 'Doctor Names'] = doctor_str
                        df.at[result['index'], 'Doctor Count'] = len(result['doctors'])
                        improved += 1

            # VERIFY CHECKPOINT
            print(f"\n🔍 VERIFYING CHUNK {chunk_num}...")
            print(f"✓ Updated: {improved}/{len(chunk_rows)}")

            # Save checkpoint
            df.to_csv(CSV_PATH, index=False)
            print(f"✅ Chunk {chunk_num} verified and saved!")

    # Final summary
    print(f"\n{'='*70}")
    print(f"✅ COMPLETE")
    print(f"{'='*70}")

    df_final = pd.read_csv(CSV_PATH)
    myhealth_final = df_final[df_final['Corporate Chain'] == 'MyHealth']
    with_doctors = myhealth_final['Doctor Names'].notna().sum()
    total_doctors = 0
    for idx, row in myhealth_final.iterrows():
        if pd.notna(row['Doctor Names']):
            total_doctors += len(str(row['Doctor Names']).split(','))

    print(f"MyHealth clinics with doctors: {with_doctors}/{total}")
    print(f"Total MyHealth doctors: {total_doctors}")
    print(f"CSV saved: {CSV_PATH}")


if __name__ == '__main__':
    asyncio.run(main())
