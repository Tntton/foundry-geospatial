import pandas as pd
import requests
from bs4 import BeautifulSoup
import re

CSV_PATH = '/Users/joshting/Desktop/GP Intelligence Platform/GP Platform Code/data/clinics/Corporate Only/NEW Corporate List.csv'

def scrape_clinic(clinic_url):
    """Scrape My Health clinic data with improved allied health detection"""
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}

    try:
        response = requests.get(clinic_url, headers=headers, timeout=10)
        if response.status_code != 200:
            return None

        soup = BeautifulSoup(response.content, 'html.parser')
        page_text = soup.get_text()

        # Check for allied health by looking for "Allied Health & Specialists" section
        has_allied_health = False
        if 'allied health' in page_text.lower():
            # Look for the Allied Health section and check if there are actual practitioners
            allied_keywords = ['physiotherapist', 'psychologist', 'dietitian', 'occupational therapist',
                             'speech pathologist', 'social worker', 'integrative physician']

            # Find the index of "Allied Health" text
            page_lower = page_text.lower()
            allied_idx = page_lower.find('allied health')

            if allied_idx > 0:
                # Get text after "Allied Health" to check for actual practitioners
                section_text = page_text[allied_idx:allied_idx+1000]

                # Check if any allied health keyword appears after the heading
                for keyword in allied_keywords:
                    if keyword in section_text.lower():
                        has_allied_health = True
                        break

        allied_health = 'Yes' if has_allied_health else 'No'

        return {
            'Allied Health': allied_health
        }

    except Exception as e:
        print(f"Error scraping {clinic_url}: {e}")
        return None

# Load CSV
df = pd.read_csv(CSV_PATH)

# Get all My Health clinics
my_health_mask = (df['Corporate Chain'] == 'My Health')
my_health_clinics = df[my_health_mask].copy()

print(f"Checking allied health for {len(my_health_clinics)} My Health clinics")

updated_count = 0

# Scrape each clinic
for idx, row in my_health_clinics.iterrows():
    clinic_name = row['Clinic Name']
    clinic_url = row['URL']

    if pd.isna(clinic_url) or not clinic_url:
        continue

    data = scrape_clinic(clinic_url)

    if data:
        current_allied = df.at[idx, 'Allied Health']
        new_allied = data['Allied Health']

        if pd.isna(current_allied) or (current_allied != new_allied):
            df.at[idx, 'Allied Health'] = new_allied
            updated_count += 1
            if current_allied != new_allied:
                print(f"{clinic_name}: {current_allied} → {new_allied}")

print(f"\n✓ Updated {updated_count} clinics")

# Save updated CSV
df.to_csv(CSV_PATH, index=False)
print(f"✓ CSV saved")
