import pandas as pd
import requests
from bs4 import BeautifulSoup
import time

CSV_PATH = '/Users/joshting/Desktop/GP Intelligence Platform/GP Platform Code/data/clinics/Corporate Only/NEW Corporate List.csv'

def scrape_clinic(clinic_url):
    """Scrape Top Health clinic data"""
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}

    try:
        response = requests.get(clinic_url, headers=headers, timeout=10)
        if response.status_code != 200:
            return None

        soup = BeautifulSoup(response.content, 'html.parser')
        page_text = soup.get_text()

        # Count doctors via booking buttons (each doctor has a "Book Appointment" button)
        # Subtract 1 for the hero section "Book an Appointment" button
        booking_links = soup.find_all('a', href=lambda x: x and '/doctors/' in x)
        doctor_count = max(0, len([b for b in booking_links if 'book' in b.get_text().lower()]) - 1)

        # Check for services
        page_lower = page_text.lower()

        # Billing type
        has_bulk = 'bulk bill' in page_lower
        has_private = 'private' in page_lower

        if has_bulk and has_private:
            billing_type = 'Mixed Billing'
        elif has_bulk:
            billing_type = 'Bulk Billing'
        elif has_private:
            billing_type = 'Private'
        else:
            billing_type = None

        # Services
        has_pathology = 'pathology' in page_lower
        pathology = 'Yes' if has_pathology else 'No'

        has_radiology = 'radiology' in page_lower or 'imaging' in page_lower or 'x-ray' in page_lower
        radiology = 'Yes' if has_radiology else 'No'

        # Allied health - check if there's an actual "Our Allied Health" page or section
        has_allied_health = False
        if 'allied health' in page_lower or 'physiotherapist' in page_lower or 'psychologist' in page_lower:
            # More strict check - must have actual practitioners listed, not just mention
            allied_keywords = ['physiotherapist', 'psychologist', 'dietitian', 'occupational therapist',
                             'speech pathologist', 'social worker', 'integrative physician', 'speech therapist']

            allied_section_idx = page_lower.find('allied')
            if allied_section_idx > 0:
                section = page_text[allied_section_idx:allied_section_idx+2000]
                for keyword in allied_keywords:
                    if keyword in section.lower():
                        has_allied_health = True
                        break

        allied_health = 'Yes' if has_allied_health else 'No'

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

# Get all Top Health clinics with missing data
top_health_mask = (df['Corporate Chain'] == 'Top Health') & (df['Doctor Count'].isna())
top_health_clinics = df[top_health_mask].copy()

print(f"Found {len(top_health_clinics)} Top Health clinics to scrape")

# Scrape each clinic
for idx, row in top_health_clinics.iterrows():
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

    time.sleep(1)

# Save updated CSV
df.to_csv(CSV_PATH, index=False)
print(f"\n✓ Updated CSV saved")
