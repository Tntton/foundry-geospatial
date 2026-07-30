import pandas as pd
import requests
from bs4 import BeautifulSoup
import time

CSV_PATH = '/Users/joshting/Desktop/GP Intelligence Platform/GP Platform Code/data/clinics/Corporate Only/NEW Corporate List.csv'

def scrape_clinic(clinic_url):
    """Scrape My Health clinic data"""
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}

    try:
        response = requests.get(clinic_url, headers=headers, timeout=10)
        if response.status_code != 200:
            return None

        soup = BeautifulSoup(response.content, 'html.parser')

        # Extract doctors from /doctors/ links
        doctor_links = soup.find_all('a', href=lambda x: x and '/doctors/' in x)
        doctor_names = []
        for link in doctor_links:
            name = link.get_text(strip=True)
            if name and name not in doctor_names and len(name.split()) >= 2:
                doctor_names.append(name)

        doctor_count = len(doctor_names)
        doctors_str = ', '.join(doctor_names) if doctor_names else ''

        # Check for billing type
        page_text = soup.get_text().lower()
        has_bulk_bill = 'bulk bill' in page_text
        has_private = 'private' in page_text

        if has_bulk_bill and not has_private:
            billing_type = 'Bulk Billing'
        elif has_private and not has_bulk_bill:
            billing_type = 'Private'
        elif has_bulk_bill and has_private:
            billing_type = 'Mixed Billing'
        else:
            billing_type = None

        # Check for services
        has_pathology = 'pathology' in page_text
        pathology = 'Yes' if has_pathology else 'No'

        has_radiology = 'radiology' in page_text or 'imaging' in page_text or 'x-ray' in page_text
        radiology = 'Yes' if has_radiology else 'No'

        # Check for allied health in provider cards
        allied_health_div = soup.find_all('div', class_='provider-card-wrapper')
        allied_keywords = ['physiotherapist', 'psychologist', 'dietitian', 'occupational therapist',
                          'speech pathologist', 'social worker', 'integrative physician']

        has_allied_health = False
        for div in allied_health_div:
            div_text = div.get_text().lower()
            # Check if this is a doctor (skip doctor cards)
            if '/doctors/' not in div.get('onclick', ''):
                if any(keyword in div_text for keyword in allied_keywords):
                    has_allied_health = True
                    break

        allied_health = 'Yes' if has_allied_health else 'No'

        return {
            'Doctor Count': doctor_count,
            'Doctor Names Clean': doctors_str,
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

# Get all My Health clinics with missing data
my_health_mask = (df['Corporate Chain'] == 'My Health') & (df['Doctor Count'].isna())
my_health_clinics = df[my_health_mask].copy()

print(f"Found {len(my_health_clinics)} My Health clinics to scrape")

# Scrape each clinic
for idx, row in my_health_clinics.iterrows():
    clinic_name = row['Clinic Name']
    clinic_url = row['URL']

    if pd.isna(clinic_url) or not clinic_url:
        print(f"Skipping {clinic_name}: no URL")
        continue

    print(f"\nScraping {clinic_name}...")
    data = scrape_clinic(clinic_url)

    if data:
        for key, value in data.items():
            df.at[idx, key] = value
        print(f"  ✓ {data['Doctor Count']} doctors, {data['Billing Type']}, Pathology: {data['Pathology']}, Radiology: {data['Radiology/Imaging']}, Allied Health: {data['Allied Health']}")
    else:
        print(f"  ✗ Failed to scrape")

    time.sleep(1)  # Be respectful to the server

# Save updated CSV
df.to_csv(CSV_PATH, index=False)
print(f"\n✓ Updated CSV saved to {CSV_PATH}")
