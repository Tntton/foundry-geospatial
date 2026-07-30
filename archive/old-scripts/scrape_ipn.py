import pandas as pd
import requests
from bs4 import BeautifulSoup
import re
import time

CSV_PATH = '/Users/joshting/Desktop/GP Intelligence Platform/GP Platform Code/data/clinics/Corporate Only/NEW Corporate List.csv'

def scrape_clinic(clinic_url):
    """Scrape IPN clinic data from subpages"""
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}

    # Remove trailing slash and any /our-doctors/ or similar
    base_url = clinic_url.rstrip('/')
    if '/our-doctors/' in base_url:
        base_url = base_url.split('/our-doctors/')[0]
    if '/fees-information/' in base_url:
        base_url = base_url.split('/fees-information/')[0]

    try:
        # Get doctor count from /our-doctors/
        response = requests.get(f"{base_url}/our-doctors/", headers=headers, timeout=10)
        if response.status_code != 200:
            return None

        soup = BeautifulSoup(response.content, 'html.parser')
        page_text = soup.get_text()

        doc_pattern = r'Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?'
        matches = re.findall(doc_pattern, page_text)
        doctor_count = len(set(matches))

        # Get billing from /fees-information/
        response = requests.get(f"{base_url}/fees-information/", headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        page_text = soup.get_text()
        page_lower = page_text.lower()

        has_bulk = 'bulk bill' in page_lower
        has_private = 'private' in page_lower or 'fee' in page_lower

        if has_bulk and has_private:
            billing_type = 'Mixed Billing'
        elif has_bulk:
            billing_type = 'Bulk Billing'
        elif has_private:
            billing_type = 'Private'
        else:
            billing_type = None

        # Get services from main page
        response = requests.get(base_url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        page_text = soup.get_text()
        page_lower = page_text.lower()

        pathology = 'Yes' if 'pathology' in page_lower else 'No'
        radiology = 'Yes' if 'radiology' in page_lower or 'imaging' in page_lower or 'x-ray' in page_lower else 'No'
        allied_health = 'Yes' if 'allied health' in page_lower else 'No'

        return {
            'Doctor Count': doctor_count,
            'Billing Type': billing_type,
            'Pathology': pathology,
            'Radiology/Imaging': radiology,
            'Allied Health': allied_health
        }

    except Exception as e:
        print(f"Error scraping {base_url}: {e}")
        return None

# Load CSV
df = pd.read_csv(CSV_PATH)

# Get all IPN clinics with missing data
ipn_mask = (df['Corporate Chain'] == 'IPN') & (df['Doctor Count'].isna())
ipn_clinics = df[ipn_mask].copy()

print(f"Found {len(ipn_clinics)} IPN clinics to scrape")

# Scrape each clinic
for idx, row in ipn_clinics.iterrows():
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
        print(f"✓ {data['Doctor Count']} docs, {data['Billing Type']}, Path: {data['Pathology']}, Rad: {data['Radiology/Imaging']}, AH: {data['Allied Health']}")
    else:
        print(f"✗ Failed")

    time.sleep(0.5)

# Save updated CSV
df.to_csv(CSV_PATH, index=False)
print(f"\n✓ Updated CSV saved")
