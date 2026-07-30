#!/usr/bin/env python3
"""
Scrape clinic websites to extract format, billing, ownership signals + review counts.
Requires: clinic_websites_and_reviews.csv (output from fetch script)

Auto-runs under caffeinate to prevent Mac sleep during 12-24 hour execution.
"""

import os
import sys
import asyncio
import re
import pandas as pd
from collections import defaultdict
from pathlib import Path

# --- Auto-caffeinate: prevent Mac from sleeping during long scrape ---
if os.environ.get('SCRAPER_CAFFEINATED') != 'true':
    # Re-execute this script under caffeinate to prevent sleep
    os.environ['SCRAPER_CAFFEINATED'] = 'true'
    print("🔋 Starting under caffeinate (prevents Mac sleep)...\n")
    os.execvp('caffeinate', ['caffeinate', '-i', 'python3'] + sys.argv)

try:
    from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("❌ Playwright not installed. Run: pip3 install playwright")
    exit(1)

# --- Config ---
INPUT_CSV = "data/clinics/Scrape Results/clinic_websites_and_reviews.csv"
OUTPUT_CSV = "data/clinics/Scrape Results/clinic_scrape_results.csv"
BATCH_SIZE = 10  # Reduced from 50 to prevent browser accumulation
REQUEST_TIMEOUT = 10000
CHECKPOINT_EVERY = 100
MAX_RETRIES = 1  # Retry once if page load fails


def extract_billing_keywords(text: str) -> dict:
    """Extract billing model signals."""
    billing_signals = defaultdict(int)

    # Bulk billing signals — be specific about context
    if re.search(r'\bbulk[\s-]?billing\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 2
    if re.search(r'\b100%\s*bulk[\s-]?billing\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 1
    if re.search(r'\bno\s*(out.?of.?pocket|gap)\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 1
    if re.search(r'\bgap.?free\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 1

    # Private billing signals — exclude "private practice" format signal
    if re.search(r'\bfee[\s-]?for[\s-]?service\b', text, re.IGNORECASE):
        billing_signals['private'] += 2
    if re.search(r'\bprivate\s*fees?\b', text, re.IGNORECASE):
        billing_signals['private'] += 1
    if re.search(r'\bprivate\s+billing\b', text, re.IGNORECASE):
        billing_signals['private'] += 2

    # Mixed billing signals
    if re.search(r'\b(both|accept|offer).*?(bulk|private).*?(bulk|private)', text, re.IGNORECASE):
        billing_signals['mixed'] += 1
    if re.search(r'\bmixed[\s-]?billing\b', text, re.IGNORECASE):
        billing_signals['mixed'] += 2

    return dict(billing_signals)


def extract_format_keywords(text: str) -> dict:
    """Extract format signals."""
    format_signals = defaultdict(int)

    # Big-box signals: multi-location, chain, network, corporate structure
    if re.search(r'\b(multi[\s-]?clinic|multi[\s-]?provider|clinic\s+chain|network|group\s+practice)\b', text, re.IGNORECASE):
        format_signals['big_box'] += 2
    if re.search(r'\bmedical\s*(centre|center|hub|group)\b', text, re.IGNORECASE):
        format_signals['big_box'] += 1
    if re.search(r'\b(multiple\s+locations?|branch|franchise|locations?\s+across|across.*locations?)\b', text, re.IGNORECASE):
        format_signals['big_box'] += 2

    # Small practice signals — independent, neighbourhood, family
    if re.search(r'\b(family\s+(clinic|doctor|medicine|practice))\b', text, re.IGNORECASE):
        format_signals['small'] += 1
    if re.search(r'\b(neighbourhood|local\s+gp|independent\s+practice|sole\s+trader|independent[\s-]?run)\b', text, re.IGNORECASE):
        format_signals['small'] += 1

    return dict(format_signals)


def extract_ownership_keywords(text: str) -> dict:
    """Extract ownership signals."""
    ownership_signals = defaultdict(int)

    # Corporate brands — major GP operators in Australia
    corporate_brands = [
        'MyHealth', 'Healius', 'Sonic', 'IPN', 'Eastbrooke', 'ForHealth',
        'Primary Care', 'Medicore', 'Tristar', 'Affiliated Doctors', 'Pulse',
        'ProMedico', 'Doctors Lounge', 'Healthpoint'
    ]

    for brand in corporate_brands:
        if re.search(rf'\b{brand}\b', text, re.IGNORECASE):
            ownership_signals['corporate'] += 1

    # Corporate structure indicators — Pty Ltd, Limited company
    if re.search(r'\b(pty[\s.]?ltd|pty[\s.]?limited|proprietary\s+limited)\b', text, re.IGNORECASE):
        ownership_signals['corporate'] += 1

    # Network/group affiliation language
    if re.search(r'\b(part of|affiliate|network of|group of|member of)\s+', text, re.IGNORECASE):
        # Count only if followed by a known corporate brand or "practice"
        if re.search(r'\b(?:part of|affiliate|network of|group of|member of)\s+(?:' + '|'.join(corporate_brands) + r')\b', text, re.IGNORECASE):
            ownership_signals['corporate'] += 1

    return dict(ownership_signals)


def extract_doctor_names(text: str) -> list:
    """Extract doctor/GP names from website text."""
    # Common title patterns for doctors
    title_patterns = [
        r'Dr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',  # Dr. Name or Dr. First Last
        r'Dr\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',      # Dr Name
        r'GP:\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',     # GP: Name
        r'(?:Doctor|Practitioner)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',  # Doctor Name
    ]

    doctor_names = []
    seen = set()  # Avoid duplicates

    for pattern in title_patterns:
        matches = re.finditer(pattern, text, re.IGNORECASE | re.MULTILINE)
        for match in matches:
            name = match.group(1).strip()
            # Filter out common false positives
            if name and len(name) > 2 and name.lower() not in seen and not name.isdigit():
                seen.add(name.lower())
                doctor_names.append(name)

    # Return first 5 unique doctor names (avoid too much data)
    return doctor_names[:5]


async def scrape_clinic_website(browser, website_url: str, clinic_name: str) -> dict:
    """Extract signals from clinic website using shared browser instance."""
    if not website_url or website_url != website_url:
        return None

    result = {
        'website_url': website_url,
        'billing_keywords': {},
        'format_keywords': {},
        'ownership_keywords': {},
        'doctor_names': [],
        'doctor_count': 0,
        'status': 'error',
    }

    page = None
    try:
        page = await browser.new_page()

        try:
            await page.goto(website_url, timeout=REQUEST_TIMEOUT, wait_until='networkidle')

            html_content = await page.content()
            text_content = await page.evaluate('() => document.body.innerText')

            doctor_names = extract_doctor_names(text_content)
            result.update({
                'billing_keywords': extract_billing_keywords(text_content),
                'format_keywords': extract_format_keywords(text_content),
                'ownership_keywords': extract_ownership_keywords(text_content),
                'doctor_names': doctor_names,
                'doctor_count': len(doctor_names),
                'status': 'success',
            })

        except PlaywrightTimeout:
            result['status'] = 'timeout'
        except Exception as e:
            result['status'] = f'error: {str(e)[:30]}'

    except Exception as e:
        result['status'] = f'page_error: {str(e)[:30]}'

    finally:
        if page:
            try:
                await page.close()
            except:
                pass

    return result


async def scrape_batch(batch_df: pd.DataFrame) -> list:
    """Scrape a batch of clinics in parallel using a shared browser instance."""
    browser = None
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            tasks = []
            for _, row in batch_df.iterrows():
                task = scrape_clinic_website(browser, row['website_url'], row['ORGANISATION_NAME'])
                tasks.append(task)

            return await asyncio.gather(*tasks)
    finally:
        if browser:
            try:
                await browser.close()
            except:
                pass


def load_progress(output_path: str) -> set:
    """Load already-processed websites."""
    if Path(output_path).exists():
        df = pd.read_csv(output_path)
        return set(df['website_url'].dropna().tolist())
    return set()


async def main():
    # Check input file exists
    if not Path(INPUT_CSV).exists():
        print(f"❌ {INPUT_CSV} not found!")
        print("Run fetch_clinic_websites_with_reviews.py first")
        exit(1)

    clinics_df = pd.read_csv(INPUT_CSV)
    print(f"📂 Loaded {len(clinics_df)} clinics from {INPUT_CSV}")

    # Filter to clinics with websites
    clinics_with_sites = clinics_df[clinics_df['status'] == 'found'].copy()
    print(f"🌐 {len(clinics_with_sites)} clinics have websites\n")

    # Resume from checkpoint
    processed_urls = load_progress(OUTPUT_CSV)
    if processed_urls:
        print(f"⏸️  Resuming — {len(processed_urls)} already scraped")
        clinics_with_sites = clinics_with_sites[~clinics_with_sites['website_url'].isin(processed_urls)]
        print(f"⏳ Remaining: {len(clinics_with_sites)}\n")

    results = []

    # Process in batches
    for batch_start in range(0, len(clinics_with_sites), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(clinics_with_sites))
        batch = clinics_with_sites.iloc[batch_start:batch_end]

        print(f"Batch {batch_start // BATCH_SIZE + 1}: {batch_start}-{batch_end}...")
        batch_results = await scrape_batch(batch)

        for idx, (_, clinic_row) in enumerate(batch.iterrows()):
            if batch_results[idx]:
                batch_results[idx]['OBJECTID'] = clinic_row['OBJECTID']
                batch_results[idx]['ORGANISATION_NAME'] = clinic_row['ORGANISATION_NAME']
                batch_results[idx]['review_count'] = clinic_row['review_count']
                batch_results[idx]['rating'] = clinic_row['rating']
                results.append(batch_results[idx])

        if len(results) >= CHECKPOINT_EVERY or batch_end == len(clinics_with_sites):
            if results:
                save_results(results, OUTPUT_CSV, append=bool(processed_urls))
                print(f"  💾 Saved {len(results)} results\n")
                results = []

    print(f"\n✅ Scraping complete! Output saved to {OUTPUT_CSV}")
    summarise(OUTPUT_CSV)


def save_results(results: list, output_path: str, append: bool = False):
    """Save results to CSV."""
    df = pd.DataFrame(results)
    mode = "a" if append and Path(output_path).exists() else "w"
    header = not (append and Path(output_path).exists())
    df.to_csv(output_path, mode=mode, header=header, index=False)


def summarise(output_path: str):
    """Print summary statistics."""
    df = pd.read_csv(output_path)
    success = (df['status'] == 'success').sum()
    timeout = (df['status'] == 'timeout').sum()
    errors = df['status'].str.contains('error', case=False, na=False).sum()

    print(f"\n{'='*60}")
    print(f"{'SCRAPE RESULTS':^60}")
    print(f"{'='*60}")
    print(f"Total scraped:        {len(df)}")
    print(f"Successful:           {success} ({success/len(df)*100:.1f}%)")
    print(f"Timeouts:             {timeout} ({timeout/len(df)*100:.1f}%)")
    print(f"Errors:               {errors} ({errors/len(df)*100:.1f}%)")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
