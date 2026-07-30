#!/usr/bin/env python3
"""
Cross-reference enriched_clinics.csv against corporate_clinic_chains.csv.
Retags clinics as Corporate where matches are found, and adds corporate_chain field.
Uses CONSERVATIVE matching to minimize false positives.
"""

import pandas as pd
import re
from pathlib import Path

INPUT_CHAINS_CSV = "data/clinics/Corporate Only/corporate_clinic_chains.csv"
INPUT_CLINICS_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"
OUTPUT_CLINICS_CSV = "enriched_clinics_retagged.csv"

def normalize_name(name):
    """Normalize for substring matching: lowercase, but keep word boundaries."""
    if pd.isna(name):
        return ""
    return str(name).lower().strip()

def extract_domain_from_url(url):
    """Extract domain name from URL for brand matching."""
    if pd.isna(url) or url == '':
        return ""
    # Extract domain from URL (e.g., 'www.myhealth.com.au' -> 'myhealth')
    match = re.search(r'(?:https?://)?(?:www\.)?([a-z0-9]+)', url.lower())
    if match:
        return match.group(1)
    return ""

def main():
    # Check input files exist
    for file in [INPUT_CHAINS_CSV, INPUT_CLINICS_CSV]:
        if not Path(file).exists():
            print(f"❌ {file} not found!")
            exit(1)

    # Load data
    print(f"📂 Loading input files...")
    chains_df = pd.read_csv(INPUT_CHAINS_CSV)
    clinics_df = pd.read_csv(INPUT_CLINICS_CSV)

    print(f"   {len(clinics_df)} clinics in enriched database")
    print(f"   {len(chains_df)} corporate chains to cross-reference\n")

    # Add corporate_chain column to clinics_df
    clinics_df['corporate_chain'] = ''

    # Build brand lookup
    print(f"🔍 Building corporate brand lookup...\n")
    brand_list = []  # List of (company_name, brands)

    for idx, chain in chains_df.iterrows():
        company_name = chain['Company Name']
        brands_str = chain['Primary Brand(s)']

        # Parse brands (comma-separated)
        brands = [normalize_name(b) for b in str(brands_str).split(',')]
        # Filter out generic words like "various local brands"
        brands = [b for b in brands if b and b not in ['various', 'various local brands']]

        if brands:
            brand_list.append((company_name, brands))

    print(f"   Indexed {len(brand_list)} companies")
    for company, brands in brand_list[:5]:
        print(f"     • {company}: {brands}")
    print()

    # Match against clinics
    matches_by_type = {
        'name_match': [],
        'url_match': [],
        'updated': 0,
        'no_match': 0
    }

    updates_list = []

    for idx, clinic in clinics_df.iterrows():
        clinic_name = normalize_name(clinic.get('ORGANISATION_NAME', ''))
        clinic_url = str(clinic.get('website_url', ''))
        domain = extract_domain_from_url(clinic_url)

        matched = False
        match_type = None
        matched_company = None
        matched_brand = None

        # Strategy 1: Check if clinic name CONTAINS a brand name (substring match)
        # Only match if brand is substantial (> 3 chars) to avoid matching "our" or "and"
        for company, brands in brand_list:
            for brand in brands:
                if len(brand) > 3:  # Only match substantial brand names
                    # Use word boundary matching to avoid partial word matches
                    pattern = r'\b' + re.escape(brand) + r'\b'
                    if re.search(pattern, clinic_name):
                        matched = True
                        match_type = 'name'
                        matched_company = company
                        matched_brand = brand
                        break
            if matched:
                break

        # Strategy 2: Check if domain matches a brand (exact match)
        if not matched and domain:
            for company, brands in brand_list:
                for brand in brands:
                    # Remove spaces and punctuation from brand for domain comparison
                    brand_domain = re.sub(r'[^a-z0-9]', '', brand)
                    if domain == brand_domain or domain.startswith(brand_domain):
                        matched = True
                        match_type = 'url'
                        matched_company = company
                        matched_brand = brand
                        break
                if matched:
                    break

        if matched:
            # Update ownership and add corporate_chain
            old_ownership = clinic.get('Ownership_Final', 'Unknown')
            clinics_df.at[idx, 'Ownership_Final'] = 'Corporate'
            clinics_df.at[idx, 'Ownership_Confidence'] = 'high'
            clinics_df.at[idx, 'corporate_chain'] = matched_company

            updates_list.append({
                'clinic_name': clinic.get('ORGANISATION_NAME', ''),
                'suburb': clinic.get('SUBURB', ''),
                'old_ownership': old_ownership,
                'match_type': match_type,
                'matched_company': matched_company,
                'matched_brand': matched_brand
            })

            matches_by_type['updated'] += 1
            if match_type == 'name':
                matches_by_type['name_match'].append((clinic_name, matched_brand))
            else:
                matches_by_type['url_match'].append((clinic_name, domain))
        else:
            matches_by_type['no_match'] += 1

    # Save output
    clinics_df.to_csv(OUTPUT_CLINICS_CSV, index=False)
    print(f"✅ Retagging complete! Output saved to {OUTPUT_CLINICS_CSV}\n")

    # Show detailed matches
    if updates_list:
        print(f"{'='*90}")
        print(f"{'MATCHES FOUND':^90}")
        print(f"{'='*90}\n")

        # Group by company
        by_company = {}
        for update in updates_list:
            company = update['matched_company']
            if company not in by_company:
                by_company[company] = []
            by_company[company].append(update)

        for company in sorted(by_company.keys()):
            updates = by_company[company]
            print(f"{company} ({len(updates)} clinics):")
            for u in updates[:5]:  # Show first 5
                print(f"  ✓ {u['clinic_name']} ({u['suburb']}) - via {u['match_type']} match ({u['matched_brand']})")
            if len(updates) > 5:
                print(f"  ... and {len(updates) - 5} more")
            print()

    # Summary
    print(f"{'='*70}")
    print(f"{'OWNERSHIP RETAGGING SUMMARY':^70}")
    print(f"{'='*70}")
    print(f"Total clinics:                {len(clinics_df)}")
    print(f"Matched and retagged:         {matches_by_type['updated']}")
    print(f"  - Via clinic name match:    {len(matches_by_type['name_match'])}")
    print(f"  - Via URL/domain match:     {len(matches_by_type['url_match'])}")
    print(f"No corporate match:           {matches_by_type['no_match']}")
    print()

    # Final ownership breakdown
    print("Final Ownership Breakdown:")
    for own in clinics_df['Ownership_Final'].value_counts().index:
        count = (clinics_df['Ownership_Final'] == own).sum()
        pct = count / len(clinics_df) * 100
        print(f"  {own:20} {count:6} ({pct:5.1f}%)")

    # Corporate chain breakdown
    print("\nCorporate Chain Breakdown:")
    chain_counts = clinics_df[clinics_df['corporate_chain'] != '']['corporate_chain'].value_counts()
    for chain in sorted(chain_counts.index):
        count = chain_counts[chain]
        print(f"  {chain:30} {count:6} clinics")

    print(f"{'='*70}\n")

if __name__ == "__main__":
    main()
