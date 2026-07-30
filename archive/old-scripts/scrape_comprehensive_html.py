#!/usr/bin/env python3
"""
Comprehensive HTML scraper - extracts all service data in one pass.
- Doctor names and count
- Pathology presence
- Radiology/imaging presence
- Allied health presence

Parses HTML structure intelligently rather than text patterns.
"""

import asyncio
import pandas as pd
import re
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup

CSV_PATH = 'corporate_chain_csv_exports/corporate_chain_master_database.csv'
CHUNK_SIZE = 50
PARALLEL_BROWSERS = 5
TIMEOUT_MS = 30000


def extract_from_html(html_text):
    """Intelligently extract all data from HTML."""
    if not html_text:
        return {'doctors': [], 'pathology': False, 'radiology': False, 'allied_health': False}

    try:
        soup = BeautifulSoup(html_text, 'html.parser')
    except:
        return {'doctors': [], 'pathology': False, 'radiology': False, 'allied_health': False}

    result = {
        'doctors': [],
        'pathology': False,
        'radiology': False,
        'allied_health': False
    }

    # ===== EXTRACT DOCTORS =====
    doctors = extract_doctors_from_html(soup, html_text)
    result['doctors'] = doctors

    # ===== EXTRACT SERVICES =====
    # Get all text content for service detection
    text = soup.get_text().lower()

    # Pathology detection
    result['pathology'] = bool(re.search(
        r'\bpathology\b|\bblood\s+test|\blaboratory|\blabs?\b',
        text,
        re.IGNORECASE
    ))

    # Radiology/Imaging detection - only strong signals
    result['radiology'] = bool(re.search(
        r'on[\s-]?site\s+(imaging|radiology|ultrasound|x[\s-]?ray)|ultrasound\s+machine|ct\s+scan|mri\s+machine',
        text,
        re.IGNORECASE
    ))

    # Allied health detection
    result['allied_health'] = bool(re.search(
        r'\b(allied\s+health|physiotherapy|physiotherapist|psychology|psychologist|dietetics|dietitian|occupational\s+therapy)\b',
        text,
        re.IGNORECASE
    ))

    return result


def extract_doctors_from_html(soup, html_text):
    """Extract doctor names from HTML structure."""
    doctors = []

    # Strategy 1: Look for doctor cards/divs (common structure)
    doctor_containers = soup.find_all(['div', 'li', 'article'], class_=re.compile(r'doctor|staff|team|provider', re.I))

    for container in doctor_containers:
        # Look for Dr pattern in this container
        text = container.get_text()
        names = re.findall(r'Dr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z\-]+)*)', text)
        doctors.extend(names)

    # Strategy 2: Look for text nodes with "Dr" pattern in the HTML
    if not doctors:
        text = html_text
        names = re.findall(r'Dr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z\-]+)*)', text)
        doctors.extend(names)

    # Strategy 3: Look for specific doctor sections (h2, h3, h4 with "doctor" keyword)
    for heading in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5']):
        if 'doctor' in heading.get_text().lower():
            # Get all text after this heading until next heading
            current = heading.find_next_sibling()
            section_text = heading.get_text() + '\n'
            while current and current.name not in ['h1', 'h2', 'h3', 'h4', 'h5']:
                section_text += current.get_text() + '\n'
                current = current.find_next_sibling()

            # Extract doctors from this section
            names = re.findall(r'Dr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z\-]+)*)', section_text)
            doctors.extend(names)

    # Remove duplicates while preserving order
    seen = set()
    unique_doctors = []
    for doctor in doctors:
        doctor_lower = doctor.lower()
        if doctor_lower not in seen and len(doctor) > 2:
            seen.add(doctor_lower)
            unique_doctors.append(doctor)

    return unique_doctors


async def scrape_single_clinic(page, row_data, row_index):
    """Scrape a single clinic - get HTML and extract all data."""
    try:
        url = row_data['URL']
        if pd.isna(url) or not url:
            return {
                'index': row_index,
                'doctors': [],
                'pathology': False,
                'radiology': False,
                'allied_health': False,
                'error': 'no_url'
            }

        await page.goto(url, wait_until='domcontentloaded', timeout=TIMEOUT_MS)

        # Get full HTML
        html = await page.content()

        # Extract all data from HTML
        data = extract_from_html(html)

        return {
            'index': row_index,
            'doctors': data['doctors'],
            'pathology': data['pathology'],
            'radiology': data['radiology'],
            'allied_health': data['allied_health'],
            'error': None
        }

    except Exception as e:
        return {
            'index': row_index,
            'doctors': [],
            'pathology': False,
            'radiology': False,
            'allied_health': False,
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

            clinic_name = row.get('Clinic Name', 'Unknown')[:35]
            print(f"  [{idx+1:2d}/{len(chunk_rows):2d}] {clinic_name:<35} ... ", end='', flush=True)

            task = scrape_single_clinic(page, row, row_index)
            tasks.append((task, context))

        for task, context in tasks:
            try:
                result = await task
                has_data = len(result['doctors']) > 0 or result['pathology'] or result['radiology'] or result['allied_health']
                print("✓" if has_data else "✗")
                results.append(result)
            except Exception as e:
                print(f"❌")
                results.append({
                    'index': -1,
                    'doctors': [],
                    'pathology': False,
                    'radiology': False,
                    'allied_health': False,
                    'error': str(e)
                })
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
    print(f"COMPREHENSIVE HTML SCRAPING")
    print(f"{'='*70}")
    print(f"Total clinics: {total}")
    print(f"Extracting: Doctors, Pathology, Radiology, Allied Health")
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

            # Update dataframe with all four columns at once
            doctors_improved = 0
            pathology_improved = 0
            radiology_improved = 0
            allied_improved = 0

            for result in results:
                if result['index'] >= 0:
                    idx = result['index']

                    # Update doctors
                    if result['doctors']:
                        doctor_str = ', '.join(result['doctors'])
                        current = df.at[idx, 'Doctor Names']
                        if pd.isna(current) or len(result['doctors']) > (len(str(current).split(',')) if current else 0):
                            df.at[idx, 'Doctor Names'] = doctor_str
                            df.at[idx, 'Doctor Count'] = len(result['doctors'])
                            doctors_improved += 1

                    # Update pathology
                    if result['pathology']:
                        current = df.at[idx, 'Pathology']
                        if pd.isna(current) or current != 'Yes':
                            df.at[idx, 'Pathology'] = 'Yes'
                            pathology_improved += 1

                    # Update radiology
                    if result['radiology']:
                        current = df.at[idx, 'Radiology/Imaging']
                        if pd.isna(current) or current != 'Yes':
                            df.at[idx, 'Radiology/Imaging'] = 'Yes'
                            radiology_improved += 1

                    # Update allied health
                    if result['allied_health']:
                        current = df.at[idx, 'Allied Health']
                        if pd.isna(current) or current != 'Yes':
                            df.at[idx, 'Allied Health'] = 'Yes'
                            allied_improved += 1

            # VERIFY CHECKPOINT
            print(f"\n🔍 VERIFYING CHUNK {chunk_num}...")
            print(f"✓ Doctors updated: {doctors_improved}")
            print(f"✓ Pathology updated: {pathology_improved}")
            print(f"✓ Radiology updated: {radiology_improved}")
            print(f"✓ Allied Health updated: {allied_improved}")

            # Save checkpoint
            df.to_csv(CSV_PATH, index=False)
            print(f"✅ Chunk {chunk_num} verified and saved!")

    # Final summary
    print(f"\n{'='*70}")
    print(f"✅ COMPREHENSIVE SCRAPING COMPLETE")
    print(f"{'='*70}")

    df_final = pd.read_csv(CSV_PATH)
    print(f"Clinics with doctors: {df_final['Doctor Names'].notna().sum()}")
    print(f"Clinics with pathology: {(df_final['Pathology'] == 'Yes').sum()}")
    print(f"Clinics with radiology: {(df_final['Radiology/Imaging'] == 'Yes').sum()}")
    print(f"Clinics with allied health: {(df_final['Allied Health'] == 'Yes').sum()}")
    print(f"\nCSV saved: {CSV_PATH}")


if __name__ == '__main__':
    asyncio.run(main())
