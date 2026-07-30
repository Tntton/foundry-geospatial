#!/usr/bin/env python3
"""
Scrape dedicated doctor/staff sections from clinic websites.
Specifically targets doctor listing pages/sections.
Updates the Doctor Names column in the CSV.

Uses checkpoint pattern: verify every 50 clinics.
"""

import asyncio
import pandas as pd
import re
from playwright.async_api import async_playwright

CSV_PATH = 'corporate_chain_csv_exports/corporate_chain_master_database.csv'
CHUNK_SIZE = 50
PARALLEL_BROWSERS = 5
TIMEOUT_MS = 30000


def extract_doctor_names_from_page(text):
    """Extract doctor names from page text (from dedicated doctor sections)."""
    if not text:
        return []

    text_lower = text.lower()

    # Find the doctor section
    doctor_section = None

    # Look for "doctors", "staff", "team", "our team" sections
    section_patterns = [
        r'doctors?\s*\n(.*?)(?=\n\n(?:services?|pricing|appointment|about|additional|contact))',
        r'our\s+(?:medical\s+)?team\s*\n(.*?)(?=\n\n(?:services?|pricing|appointment|about|additional|contact))',
        r'bulk\s+billing\s+doctors?\s*\n(.*?)(?=\n\n(?:appointment|services?|pricing|about))',
        r'staff\s*\n(.*?)(?=\n\n(?:services?|pricing|appointment|about|additional))',
    ]

    for pattern in section_patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            doctor_section = match.group(1)
            break

    if not doctor_section:
        return []

    # Extract doctor names from section
    # Look for patterns like "Dr Name" or just "Name"
    doctor_names = []

    # Pattern 1: "Dr FirstName LastName" or "Dr. FirstName LastName"
    dr_pattern = r'Dr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z\-]+)*)'
    matches = re.finditer(dr_pattern, doctor_section)
    for match in matches:
        name = match.group(1).strip()
        if name and len(name) > 2:
            doctor_names.append(name)

    # Pattern 2: Names in lines followed by gender/qualifications
    # "FirstName LastName" on one line, followed by "Male" or "Female"
    lines = doctor_section.split('\n')
    for i, line in enumerate(lines):
        line = line.strip()

        # Skip if it's a qualification or gender line
        if re.match(r'^(MBBS|MD|FRACGP|Male|Female|Telephone|Phone|Qualifications)', line, re.IGNORECASE):
            continue

        # Skip if too short
        if len(line) < 3:
            continue

        # Check if next line is Male/Female (common pattern)
        next_line = lines[i+1].strip() if i+1 < len(lines) else ""
        if next_line in ['Male', 'Female']:
            # This line is likely a name
            # Validate it looks like a name (2-4 words, starting with capital)
            words = line.split()
            if 2 <= len(words) <= 4:
                if all(w[0].isupper() for w in words if w):
                    if line not in doctor_names:  # Avoid duplicates
                        doctor_names.append(line)

    # Remove duplicates while preserving order
    seen = set()
    unique_names = []
    for name in doctor_names:
        name_lower = name.lower()
        if name_lower not in seen:
            seen.add(name_lower)
            unique_names.append(name)

    return unique_names


async def scrape_single_clinic(page, row_data, row_index):
    """Scrape doctor names from a single clinic website."""
    try:
        url = row_data['URL']
        if pd.isna(url) or not url:
            return {'index': row_index, 'doctors': [], 'error': 'no_url'}

        await page.goto(url, wait_until='domcontentloaded', timeout=TIMEOUT_MS)
        text = await page.evaluate('() => document.body.innerText')

        doctors = extract_doctor_names_from_page(text)
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
                print("✓" if found_count > 0 else "✗")
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
    """Main checkpoint loop."""

    df = pd.read_csv(CSV_PATH)
    total = len(df)

    print(f"\n{'='*70}")
    print(f"SCRAPING DEDICATED DOCTOR SECTIONS")
    print(f"{'='*70}")
    print(f"Total clinics: {total}")
    print(f"Chunk size: {CHUNK_SIZE}\n")

    async with async_playwright() as p:
        chunk_num = 0

        for chunk_start in range(0, total, CHUNK_SIZE):
            chunk_num += 1
            chunk_end = min(chunk_start + CHUNK_SIZE, total)
            chunk_rows = df.iloc[chunk_start:chunk_end]

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
                    current = df.at[result['index'], 'Doctor Names']

                    # Update if:
                    # 1. Currently empty, or
                    # 2. We found significantly more doctors
                    if pd.isna(current) or len(result['doctors']) > (len(str(current).split(',')) if current else 0):
                        df.at[result['index'], 'Doctor Names'] = doctor_str
                        df.at[result['index'], 'Doctor Count'] = len(result['doctors'])
                        improved += 1

            # VERIFY CHECKPOINT
            print(f"\n🔍 VERIFYING CHUNK {chunk_num}...")
            print(f"✓ Improved/found: {improved}/{len(chunk_rows)}")

            # Save checkpoint
            df.to_csv(CSV_PATH, index=False)
            print(f"✅ Chunk {chunk_num} verified and saved!")

    # Final summary
    print(f"\n{'='*70}")
    print(f"✅ SCRAPING COMPLETE")
    print(f"{'='*70}")
    clinics_with_doctors = df['Doctor Names'].notna().sum()
    total_doctors = df['Doctor Count'].sum()
    print(f"Clinics with doctor names: {clinics_with_doctors}/{total}")
    print(f"Total doctors: {total_doctors:.0f}")
    print(f"CSV saved: {CSV_PATH}")


if __name__ == '__main__':
    asyncio.run(main())
