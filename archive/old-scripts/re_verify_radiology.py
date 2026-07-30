#!/usr/bin/env python3
"""
Re-verify radiology/imaging detection with stricter criteria.
Only marks 'Yes' for strong on-site indicators, not generic mentions.

Uses checkpoint pattern: verify every 50 clinics before continuing.
"""

import asyncio
import pandas as pd
import re
from playwright.async_api import async_playwright
from pathlib import Path

CSV_PATH = 'corporate_chain_csv_exports/corporate_chain_master_database.csv'
CHUNK_SIZE = 50
PARALLEL_BROWSERS = 5
TIMEOUT_MS = 30000


def detect_radiology_strong(text):
    """Only return True for STRONG on-site imaging indicators."""
    if not text or not isinstance(text, str):
        return False

    text_lower = text.lower()

    # Strong positive signals: Clear indicators of ON-SITE imaging
    strong_positive = [
        r'\b(ultrasound|ultrasound\s+machine|ultrasound\s+scan)',
        r'\b(ct\s+scan|ct\s+scanner)',
        r'\b(mri|mri\s+machine|mri\s+scan)',
        r'\b(x[\s-]?ray|x[\s-]?ray\s+machine|x[\s-]?ray\s+suite)',
        r'\b(imaging\s+services?\s+available)',
        r'\b(on[\s-]?site\s+(imaging|ultrasound|radiology))',
        r'\b(radiology\s+technician|imaging\s+technician)',
        r'\bbone\s+density\s+(scan|machine)',
    ]

    for pattern in strong_positive:
        if re.search(pattern, text_lower):
            # Found strong signal, but check for referral context
            if re.search(r'\b(refer.*?imaging|imaging.*?referr)', text_lower):
                continue  # This strong signal is in referral context, skip
            return True

    # If any "radiology" mention without strong signals, it's likely just referral language
    return False


async def scrape_single_clinic(page, row_data, row_index):
    """Scrape and detect radiology for a single clinic."""
    try:
        url = row_data['URL']
        if pd.isna(url) or not url:
            return {'index': row_index, 'has_radiology': None, 'error': 'no_url'}

        await page.goto(url, wait_until='domcontentloaded', timeout=TIMEOUT_MS)
        text = await page.evaluate('() => document.body.innerText')

        has_radiology = detect_radiology_strong(text)
        return {
            'index': row_index,
            'has_radiology': 'Yes' if has_radiology else None,
            'error': None
        }

    except Exception as e:
        return {
            'index': row_index,
            'has_radiology': None,
            'error': str(e)[:50]
        }

    finally:
        try:
            await page.close()
        except:
            pass


async def process_chunk(p, chunk_rows, parallel_count):
    """Process a chunk with parallel browsers."""
    results = []

    # Create multiple browsers
    browsers = []
    for _ in range(min(parallel_count, len(chunk_rows))):
        browser = await p.chromium.launch(headless=True)
        browsers.append(browser)

    try:
        # Create tasks
        tasks = []
        for idx, (row_index, row) in enumerate(chunk_rows.iterrows()):
            browser = browsers[idx % len(browsers)]
            context = await browser.new_context()
            page = await context.new_page()

            clinic_name = row.get('Clinic Name', 'Unknown')[:40]
            print(f"  [{idx+1}/{len(chunk_rows)}] {clinic_name:<40} ... ", end='', flush=True)

            task = scrape_single_clinic(page, row, row_index)
            tasks.append((task, context))

        # Execute all tasks
        for task, context in tasks:
            try:
                result = await task
                print("✓" if result['has_radiology'] else "✗")
                results.append(result)
            except Exception as e:
                print(f"❌ {str(e)[:20]}")
                results.append({'index': -1, 'has_radiology': None, 'error': str(e)})
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


async def re_verify_radiology():
    """Main checkpoint loop."""

    df = pd.read_csv(CSV_PATH)

    # Only re-check clinics marked "Yes"
    to_check = df[df['Radiology/Imaging'] == 'Yes'].copy()
    total = len(to_check)

    print(f"\n{'='*70}")
    print(f"RE-VERIFYING RADIOLOGY DETECTION")
    print(f"{'='*70}")
    print(f"Clinics to re-check: {total}")
    print(f"Chunk size: {CHUNK_SIZE}")
    print(f"Using stricter detection criteria\n")

    async with async_playwright() as p:
        chunk_num = 0

        for chunk_start in range(0, total, CHUNK_SIZE):
            chunk_num += 1
            chunk_end = min(chunk_start + CHUNK_SIZE, total)
            chunk_rows = to_check.iloc[chunk_start:chunk_end]

            print(f"\n{'='*70}")
            print(f"CHUNK {chunk_num}: Clinics {chunk_start+1}-{chunk_end} of {total}")
            print(f"{'='*70}")

            # Scrape chunk
            results = await process_chunk(p, chunk_rows, PARALLEL_BROWSERS)

            # Update dataframe
            confirmed = 0
            for result in results:
                if result['index'] >= 0:
                    new_value = result['has_radiology']
                    df.at[result['index'], 'Radiology/Imaging'] = new_value
                    if new_value == 'Yes':
                        confirmed += 1

            # VERIFY CHECKPOINT
            print(f"\n🔍 VERIFYING CHUNK {chunk_num}...")
            print(f"✓ Confirmed (strong signals): {confirmed}/{len(chunk_rows)}")
            print(f"✓ Removed (no strong signals): {len(chunk_rows) - confirmed}/{len(chunk_rows)}")

            # Save checkpoint
            df.to_csv(CSV_PATH, index=False)
            print(f"✅ Chunk {chunk_num} verified and saved!")

    # Final summary
    print(f"\n{'='*70}")
    print(f"✅ RE-VERIFICATION COMPLETE")
    print(f"{'='*70}")
    confirmed_total = (df['Radiology/Imaging'] == 'Yes').sum()
    print(f"Original count (marked 'Yes'): {total}")
    print(f"After stricter verification: {confirmed_total}")
    print(f"Removed (likely false positives): {total - confirmed_total}")
    print(f"CSV saved: {CSV_PATH}")


if __name__ == '__main__':
    asyncio.run(re_verify_radiology())
