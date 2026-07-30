import asyncio
import pandas as pd
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import re

CSV_PATH = '/Users/joshting/Desktop/GP Intelligence Platform/GP Platform Code/corporate_chain_csv_exports/corporate_chain_master_database.csv'

async def extract_external_link(page, clinic_url):
    """Extract the external clinic link from Better Medical page"""
    try:
        await page.goto(clinic_url, wait_until='domcontentloaded', timeout=10000)
    except:
        await page.goto(clinic_url, timeout=10000)

    content = await page.content()
    soup = BeautifulSoup(content, 'html.parser')

    # Look for clinic info links - they usually appear in a link pointing to the clinic's own website
    # Common patterns: direct links in clinic info, "Visit Website" buttons, etc.
    links = soup.find_all('a')

    # Filter for links that look like clinic websites (not bettermedical.com.au)
    for link in links:
        href = link.get('href', '')
        text = link.get_text(strip=True)

        # Skip internal Better Medical links and social media
        if 'bettermedical.com.au' not in href and href.startswith('http'):
            if any(x in href for x in ['.com.au', '.com']):
                return href

    return None

async def scrape_doctors(page, external_url):
    """Scrape doctor names from the external clinic URL"""
    try:
        doctors_url = external_url.rstrip('/') + '/the-practice/doctors'
        try:
            await page.goto(doctors_url, wait_until='domcontentloaded', timeout=10000)
        except:
            await page.goto(doctors_url, timeout=10000)

        content = await page.content()
        soup = BeautifulSoup(content, 'html.parser')

        # Look for doctor names - common patterns
        doctor_names = []

        # Pattern 1: Look for elements with doctor-related classes/attributes
        doctor_sections = soup.find_all(['div', 'section'], class_=re.compile(r'doctor|staff|team|practitioner|gp|provider', re.I))

        for section in doctor_sections:
            names = section.find_all(['h2', 'h3', 'h4', 'p', 'span'])
            for name_elem in names:
                text = name_elem.get_text(strip=True)
                # Filter out common junk
                if text and len(text) > 3 and not any(x in text.lower() for x in ['read more', 'book', 'appointment', 'services', 'home']):
                    doctor_names.append(text)

        # Remove duplicates and clean
        doctor_names = list(set([n for n in doctor_names if len(n) < 100]))
        return doctor_names if doctor_names else []

    except Exception as e:
        print(f"Error scraping doctors: {e}")
        return []

async def check_allied_health(page, external_url):
    """Check if allied health services are mentioned"""
    try:
        # Try common paths for allied health
        paths = [
            '/what-we-offer/allied-health',
            '/services/allied-health',
            '/allied-health',
            '/other-services',
            '/allied-health-services',
            '/team',
            '/services'
        ]

        for path in paths:
            try:
                ah_url = external_url.rstrip('/') + path
                try:
                    await page.goto(ah_url, wait_until='domcontentloaded', timeout=8000)
                except:
                    await page.goto(ah_url, timeout=8000)

                content = await page.content()

                # Check if we got a valid page (not 404)
                if 'page not found' not in content.lower() and '404' not in content:
                    # Check for allied health keywords
                    if any(x in content.lower() for x in ['allied health', 'physiotherapy', 'dietitian', 'psychologist', 'occupational therapist', 'allied']):
                        return True
            except:
                continue

        return False
    except Exception as e:
        print(f"Error checking allied health: {e}")
        return False

async def process_clinic(clinic_name, clinic_url, row_index, df):
    """Process one clinic and return updated data"""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        try:
            print(f"\n📍 Processing: {clinic_name}")
            print(f"   URL: {clinic_url}")

            # Extract external link
            external_link = await extract_external_link(page, clinic_url)
            if not external_link:
                print(f"   ❌ No external link found")
                return None

            print(f"   🔗 External link: {external_link}")

            # Scrape doctors
            doctors = await scrape_doctors(page, external_link)
            doctor_count = len(doctors)
            print(f"   👨‍⚕️  Doctors ({doctor_count}): {', '.join(doctors[:5]) if doctors else 'None'}")

            # Check allied health
            has_allied_health = await check_allied_health(page, external_link)
            print(f"   💼 Allied Health: {'Yes' if has_allied_health else 'No'}")

            return {
                'row_index': row_index,
                'doctor_names': ', '.join(doctors),
                'doctor_count': doctor_count,
                'allied_health': 'Yes' if has_allied_health else 'No'
            }

        except Exception as e:
            print(f"   ❌ Error: {e}")
            return None
        finally:
            await browser.close()

async def main():
    # Read CSV
    df = pd.read_csv(CSV_PATH)

    # Find Better Medical clinics (excluding SmartClinics)
    better_medical = df[(df['Corporate Chain'] == 'Better Medical') & (~df['Clinic Name'].str.contains('SmartClinics', na=False))]

    print(f"Found {len(better_medical)} Better Medical clinics to process\n")

    # Process first clinic as a test
    if len(better_medical) > 0:
        first_clinic = better_medical.iloc[0]
        row_index = df[(df['Clinic Name'] == first_clinic['Clinic Name']) & (df['Corporate Chain'] == first_clinic['Corporate Chain'])].index[0]

        result = await process_clinic(
            first_clinic['Clinic Name'],
            first_clinic['URL'],
            row_index,
            df
        )

        if result:
            # Update CSV
            df.at[result['row_index'], 'Doctor Names Clean'] = result['doctor_names']
            df.at[result['row_index'], 'Doctor Count'] = result['doctor_count']
            df.at[result['row_index'], 'Allied Health'] = result['allied_health']

            df.to_csv(CSV_PATH, index=False)
            print(f"\n✅ Saved. Ready for next clinic.")
        else:
            print(f"\n⏸️  Failed. Waiting for user guidance.")

if __name__ == '__main__':
    asyncio.run(main())
