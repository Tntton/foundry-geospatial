"""
Scrape clinic websites to extract:
- Billing model (bulk, private, mixed)
- Format (big-box, mid-format, small)
- Ownership indicators
- Google review count

Requires: fetch_clinic_websites_with_reviews.py to be run first (produces clinic_websites_and_reviews.csv)
"""

import asyncio
import re
import pandas as pd
from collections import defaultdict
from pathlib import Path
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

# --- Config ---
INPUT_CSV = "data/clinics/Scrape Results/clinic_websites_and_reviews.csv"
OUTPUT_CSV = "data/clinics/Scrape Results/clinic_scrape_results.csv"
BATCH_SIZE = 50  # Number of parallel Playwright instances
REQUEST_TIMEOUT = 10000  # 10 seconds
CHECKPOINT_EVERY = 100


def extract_billing_keywords(text: str) -> dict:
    """Extract billing model signals from clinic website text."""
    billing_signals = defaultdict(int)

    # Bulk billing indicators
    if re.search(r'\bbulk\s*billing\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 2
    if re.search(r'\bno\s*gap\b|\bgap.?free\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 1
    if re.search(r'\b(bulk|gap-free)\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 1

    # Private practice indicators
    if re.search(r'\bprivate\s*(practice|clinic)\b', text, re.IGNORECASE):
        billing_signals['private'] += 2
    if re.search(r'\bfee.?for.?service\b', text, re.IGNORECASE):
        billing_signals['private'] += 1
    if re.search(r'\bprivate\b', text, re.IGNORECASE):
        billing_signals['private'] += 1

    # Mixed billing indicators
    if re.search(r'\bmixed\s*billing\b', text, re.IGNORECASE):
        billing_signals['mixed'] += 2
    if re.search(r'\baahpra\b|\baemd\b', text, re.IGNORECASE):  # Australian health refs
        billing_signals['private'] += 1

    return dict(billing_signals)


def extract_format_keywords(text: str) -> dict:
    """Extract format signals from clinic website text."""
    format_signals = defaultdict(int)

    # Big-box indicators
    if re.search(r'\bmedical\s*(centre|center|hub|group)\b', text, re.IGNORECASE):
        format_signals['big_box'] += 1
    if re.search(r'\b(multi-clinic|chain|network|group practice)\b', text, re.IGNORECASE):
        format_signals['big_box'] += 2
    if re.search(r'\b(\d+)\s*(gp|doctor|physician)s?\b', text, re.IGNORECASE):
        match = re.search(r'\b(\d+)\s*(gp|doctor)', text, re.IGNORECASE)
        if match:
            gp_count = int(match.group(1))
            if gp_count >= 5:
                format_signals['big_box'] += 1
            elif gp_count >= 3:
                format_signals['mid_format'] += 1

    # Mid-format indicators
    if re.search(r'\b(integrated|multidisciplinary|allied health)\b', text, re.IGNORECASE):
        format_signals['mid_format'] += 1

    # Family clinic indicators
    if re.search(r'\bfamily\s*(clinic|doctor|medicine|practice)\b', text, re.IGNORECASE):
        format_signals['small'] += 1
    if re.search(r'\b(family gp|family medicine)\b', text, re.IGNORECASE):
        format_signals['small'] += 1

    return dict(format_signals)


def extract_ownership_keywords(text: str) -> dict:
    """Extract ownership signals from clinic website text."""
    ownership_signals = defaultdict(int)

    # Known corporate brands
    corporate_brands = [
        'MyHealth', 'Healius', 'Sonic', 'IPN', 'Eastbrooke', 'ForHealth',
        'Primary Care', 'Medicore', 'Zime', 'Southern Cross', 'Garvan'
    ]

    for brand in corporate_brands:
        if re.search(rf'\b{brand}\b', text, re.IGNORECASE):
            ownership_signals['corporate'] += 1

    # Corporate structure indicators
    if re.search(r'\b(pty\s*ltd|limited|corporation|incorporated|group)\b', text, re.IGNORECASE):
        ownership_signals['corporate'] += 1
    if re.search(r'\b(&\s*(co|associates|partners))\b', text, re.IGNORECASE):
        ownership_signals['corporate'] += 1

    return dict(ownership_signals)


def count_gp_profiles(html: str) -> int:
    """Estimate number of GPs from doctor profile sections on website."""
    # Look for common patterns
    patterns = [
        r'<h[23].*?doctor\b',  # Doctor in heading
        r'class=["\'].*?(doctor|profile|team)',  # Profile divs
        r'<div.*?doctor.*?</div>',  # Doctor sections
    ]

    count = 0
    for pattern in patterns:
        matches = len(re.findall(pattern, html, re.IGNORECASE))
        count = max(count, matches)

    return min(count, 10)  # Cap at 10 (rough estimate)


async def scrape_clinic_website(website_url: str, clinic_name: str) -> dict:
    """
    Extract signals from clinic website.
    Returns dict with billing, format, ownership keywords and GP count estimate.
    """
    if not website_url or website_url != website_url:  # Check for NaN
        return None

    result = {
        'website_url': website_url,
        'billing_keywords': {},
        'format_keywords': {},
        'ownership_keywords': {},
        'gp_profiles_found': 0,
        'status': 'error',
    }

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()

            try:
                await page.goto(website_url, timeout=REQUEST_TIMEOUT, wait_until='networkidle')

                # Extract full HTML and text
                html_content = await page.content()
                text_content = await page.evaluate('() => document.body.innerText')

                # Parse for signals
                billing = extract_billing_keywords(text_content)
                format_sigs = extract_format_keywords(text_content)
                ownership = extract_ownership_keywords(text_content)
                gp_count = count_gp_profiles(html_content)

                result.update({
                    'billing_keywords': billing,
                    'format_keywords': format_sigs,
                    'ownership_keywords': ownership,
                    'gp_profiles_found': gp_count,
                    'status': 'success',
                })

            except PlaywrightTimeout:
                result['status'] = 'timeout'
            except Exception as e:
                result['status'] = f'scrape_error: {str(e)[:30]}'

            finally:
                await browser.close()

    except Exception as e:
        result['status'] = f'browser_error: {str(e)[:30]}'

    return result


async def scrape_batch(batch_df: pd.DataFrame) -> list:
    """Scrape a batch of clinics in parallel."""
    tasks = []
    for _, row in batch_df.iterrows():
        task = scrape_clinic_website(row['website_url'], row['ORGANISATION_NAME'])
        tasks.append(task)

    return await asyncio.gather(*tasks)


def load_progress(output_path: str) -> set:
    """Load already-processed website URLs from existing output file."""
    if Path(output_path).exists():
        df = pd.read_csv(output_path)
        return set(df['website_url'].dropna().tolist())
    return set()


async def main():
    # Load clinic data
    clinics_df = pd.read_csv(INPUT_CSV)
    print(f"📂 Loaded {len(clinics_df)} clinics from {INPUT_CSV}")

    # Filter to clinics with websites
    clinics_with_sites = clinics_df[clinics_df['status'] == 'found'].copy()
    print(f"🌐 {len(clinics_with_sites)} clinics have websites\n")

    # Resume from checkpoint if output exists
    processed_urls = load_progress(OUTPUT_CSV)
    if processed_urls:
        print(f"⏸️  Resuming — {len(processed_urls)} clinics already scraped")
        clinics_with_sites = clinics_with_sites[~clinics_with_sites['website_url'].isin(processed_urls)]
        print(f"⏳ Remaining: {len(clinics_with_sites)}\n")

    results = []
    total_processed = len(processed_urls)

    # Process in batches
    for batch_start in range(0, len(clinics_with_sites), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(clinics_with_sites))
        batch = clinics_with_sites.iloc[batch_start:batch_end]

        print(f"Processing batch {batch_start // BATCH_SIZE + 1}... ({batch_start}-{batch_end})")
        batch_results = await scrape_batch(batch)

        # Enrich with clinic info
        for idx, (_, clinic_row) in enumerate(batch.iterrows()):
            if batch_results[idx]:
                batch_results[idx]['OBJECTID'] = clinic_row['OBJECTID']
                batch_results[idx]['ORGANISATION_NAME'] = clinic_row['ORGANISATION_NAME']
                batch_results[idx]['review_count'] = clinic_row['review_count']
                batch_results[idx]['rating'] = clinic_row['rating']
                results.append(batch_results[idx])

        # Checkpoint save
        if (batch_end - batch_start) >= BATCH_SIZE or batch_end == len(clinics_with_sites):
            if results:
                save_results(results, OUTPUT_CSV, append=bool(processed_urls))
                print(f"  💾 Saved {len(results)} results\n")
                results = []
                total_processed += batch_end - batch_start

    print(f"\n✅ Scraping complete! Output saved to {OUTPUT_CSV}")
    summarise(OUTPUT_CSV)


def save_results(results: list, output_path: str, append: bool = False):
    """Save results to CSV, appending if file exists."""
    df = pd.DataFrame(results)
    mode = "a" if append and Path(output_path).exists() else "w"
    header = not (append and Path(output_path).exists())
    df.to_csv(output_path, mode=mode, header=header, index=False)


def summarise(output_path: str):
    """Print summary statistics of scraping results."""
    df = pd.read_csv(output_path)

    success = (df['status'] == 'success').sum()
    timeout = (df['status'] == 'timeout').sum()
    errors = df['status'].str.contains('error', case=False, na=False).sum()

    # Analyze keyword extraction
    has_billing = df['billing_keywords'].apply(lambda x: bool(eval(x) if isinstance(x, str) else x)).sum()
    has_format = df['format_keywords'].apply(lambda x: bool(eval(x) if isinstance(x, str) else x)).sum()
    has_ownership = df['ownership_keywords'].apply(lambda x: bool(eval(x) if isinstance(x, str) else x)).sum()

    print(f"\n{'='*50}")
    print(f"{'SCRAPING SUMMARY':^50}")
    print(f"{'='*50}")
    print(f"Total websites scraped:   {len(df)}")
    print(f"Successful extractions:   {success} ({success/len(df)*100:.1f}%)")
    print(f"Timeouts:                 {timeout} ({timeout/len(df)*100:.1f}%)")
    print(f"Errors:                   {errors} ({errors/len(df)*100:.1f}%)")
    print(f"\nKeyword extraction:")
    print(f"  Billing signals found:  {has_billing} ({has_billing/len(df)*100:.1f}%)")
    print(f"  Format signals found:   {has_format} ({has_format/len(df)*100:.1f}%)")
    print(f"  Ownership signals:      {has_ownership} ({has_ownership/len(df)*100:.1f}%)")
    print(f"\nReview data:")
    avg_reviews = df['review_count'].mean()
    avg_rating = df['rating'].dropna().mean()
    print(f"  Avg reviews per clinic: {avg_reviews:.0f}")
    print(f"  Avg rating:             {avg_rating:.2f}⭐")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    asyncio.run(main())
