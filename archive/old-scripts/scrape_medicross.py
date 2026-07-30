import pandas as pd
import requests
from bs4 import BeautifulSoup
import re
import time

CSV_PATH = '/Users/joshting/Desktop/GP Intelligence Platform/GP Platform Code/data/clinics/Corporate Only/NEW Corporate List.csv'

def scrape_clinic(clinic_url):
    """Scrape Medicross clinic data"""
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}

    try:
        response = requests.get(clinic_url, headers=headers, timeout=10)
        if response.status_code != 200:
            return None

        soup = BeautifulSoup(response.content, 'html.parser')
        page_text = soup.get_text()
        page_lower = page_text.lower()

        # Count doctors - full name pattern only
        doc_pattern = r'Dr\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+'
        matches = re.findall(doc_pattern, page_text)
        doctor_count = len(set(matches))

        # Billing - check for various indicators
        unable_to_bulk = 'unable to bulk bill' in page_lower
        has_bulk_and_fees = 'bulk billing & fees' in page_lower
        has_bulk_available = 'bulk bill' in page_lower and not unable_to_bulk
        has_fee_schedule = 'schedule of' in page_lower and 'fee' in page_lower

        if unable_to_bulk:
            billing_type = 'Private'
        elif has_bulk_and_fees:
            billing_type = 'Mixed Billing'
        elif has_bulk_available:
            billing_type = 'Bulk Billing'
        elif has_fee_schedule:
            billing_type = 'Private'
        else:
            billing_type = None

        # For Medicross, assume no pathology, radiology, or allied health unless explicitly listed
        # (they're referenced in disclaimers, not as actual services)
        pathology = 'No'
        radiology = 'No'
        allied_health = 'No'

        return {
            'Doctor Count': doctor_count,
            'Billing Type': billing_type,
            'Pathology': pathology,
            'Radiology/Imaging': radiology,
            'Allied Health': allied_health
        }

    except Exception as e:
        print(f"Error scraping {clinic_url}: {e}")
        return None

# Load CSV
df = pd.read_csv(CSV_PATH)

# Get all Medicross clinics with missing data
medicross_mask = (df['Corporate Chain'] == 'Medicross') & (df['Doctor Count'].isna())
medicross_clinics = df[medicross_mask].copy()

print(f"Found {len(medicross_clinics)} Medicross clinics to scrape")

# Scrape each clinic
for idx, row in medicross_clinics.iterrows():
    clinic_name = row['Clinic Name']
    clinic_url = row['URL']

    if pd.isna(clinic_url) or not clinic_url:
        print(f"Skipping {clinic_name}: no URL")
        continue

    print(f"Scraping {clinic_name}...", end=' ')
    data = scrape_clinic(clinic_url)

    if data:
        for key, value in data.items():
            df.at[idx, key] = value
        print(f"✓ {data['Doctor Count']} docs, {data['Billing Type']}")
    else:
        print(f"✗ Failed")

    time.sleep(0.5)

# Save updated CSV
df.to_csv(CSV_PATH, index=False)
print(f"\n✓ Updated CSV saved")
