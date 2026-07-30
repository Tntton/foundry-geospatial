#!/usr/bin/env python3
"""
1. Identify corporate clinics by name pattern (Ochre Medical Centre, Eastbrooke, etc.)
2. Fill in corporate_chain_name based on name pattern
3. Then run comprehensive clinic-to-clinic matching
"""

import pandas as pd
from difflib import SequenceMatcher

INPUT_ENRICHED = "data/clinics/Master Sheet/enriched_clinics.csv"
INPUT_CORPORATE = "data/clinics/Corporate Only/corporate_chain_master_database (by clinic).csv"
OUTPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"

enriched = pd.read_csv(INPUT_ENRICHED)
corporate = pd.read_csv(INPUT_CORPORATE)

print(f"Loaded {len(enriched)} enriched clinics")
print(f"Loaded {len(corporate)} corporate clinics\n")

# Brand name patterns → corporate chain name mapping
BRAND_PATTERNS = {
    'Ochre Medical Centre': 'Ochre Health',
    'Ochre Health': 'Ochre Health',
    'Eastbrooke': 'Eastbrooke',  # Will try to match to corporate CSV
    'MyClinic': 'MyClinic',
    'Myhealth': 'Myhealth Medical Group',
    'MyHealth': 'Myhealth Medical Group',
    'Medicross': 'Medicross',  # If in corporate
    'Sonic Health Plus': 'Sonic',  # If in corporate
}

# Manual chain mappings (enriched → corporate CSV)
CHAIN_TO_CORPORATE = {
    'Ochre Health': 'Ochre Health',
    'Myhealth Medical Group': 'MyHealth',
    'MyClinic': 'MyClinic',
}

print("Step 1: Identifying corporate clinics by brand pattern...\n")

identified = 0
for idx, row in enriched.iterrows():
    if row.get('ownership') != 'Corporate':
        continue

    # Skip if already has corporate_chain_name
    if pd.notna(row.get('corporate_chain_name')) and row['corporate_chain_name'].strip():
        continue

    clinic_name = str(row.get('clinic_name', '')).strip()

    # Try to identify by brand pattern
    for pattern, chain_name in BRAND_PATTERNS.items():
        if pattern.lower() in clinic_name.lower():
            enriched.at[idx, 'corporate_chain_name'] = chain_name
            identified += 1
            break

print(f"✓ Identified {identified} corporates by brand pattern\n")

# Now do comprehensive matching
print("Step 2: Running comprehensive clinic-to-clinic matching...\n")

def normalize(text):
    """Normalize text for matching."""
    if pd.isna(text):
        return ""
    return str(text).lower().strip()

def extract_location_from_name(clinic_name):
    """Extract location from clinic name."""
    if pd.isna(clinic_name):
        return ""
    name = str(clinic_name).strip()

    # Remove common prefixes
    prefixes = [
        'Ochre Medical Centre ',
        'Ochre Health ',
        'Myhealth ', 'MyHealth ',
        'Eastbrooke ',
        'Our Medical ',
        'Medicross ',
        'Sonic Health Plus ',
        'Medical One - ',
        'Mamu Health Service Limited - ',
        'Katungul Aboriginal Corporation ',
    ]
    for prefix in prefixes:
        if name.lower().startswith(prefix.lower()):
            name = name[len(prefix):]
            break

    return normalize(name)

def match_clinic_to_corporate(enr_row, corp_df, chain_mapping):
    """Match a single enriched clinic to corporate CSV."""
    chain_name = enr_row.get('corporate_chain_name')
    enr_state = enr_row.get('state_code')
    enr_clinic_name = enr_row.get('clinic_name')

    if not chain_name or pd.isna(chain_name):
        return None

    # Map chain name
    mapped_chain = chain_mapping.get(chain_name, chain_name)

    # Filter corporate CSV to this chain
    corp_subset = corp_df[corp_df['Corporate Chain'] == mapped_chain]
    if len(corp_subset) == 0:
        return None

    # Extract location from enriched clinic name
    enr_location = extract_location_from_name(enr_clinic_name)
    if not enr_location:
        return None

    # Find best match
    best_score = 0
    best_billing = None

    for _, corp_row in corp_subset.iterrows():
        corp_clinic_name = normalize(corp_row.get('Clinic Name', ''))
        corp_state = str(corp_row.get('State', '')).upper().strip()
        corp_billing = corp_row.get('Billing Type')

        if pd.isna(corp_billing):
            continue

        # Scoring
        if enr_location in corp_clinic_name or corp_clinic_name in enr_location:
            loc_score = 0.95
        else:
            loc_score = SequenceMatcher(None, enr_location, corp_clinic_name).ratio()

        state_match = 1.0 if enr_state == corp_state else 0.2

        combined_score = (loc_score * 0.75) + (state_match * 0.25)

        if combined_score > best_score:
            best_score = combined_score
            best_billing = corp_billing

    return best_billing if best_score > 0.55 else None

matched = 0
fields_updated = {
    'billing_model': 0,
    'has_pathology': 0,
    'has_radiology_imaging': 0,
    'has_allied_health': 0,
    'website': 0,
}

# Process all corporates
for idx, enr_row in enriched.iterrows():
    if enr_row.get('ownership') != 'Corporate':
        continue

    billing = match_clinic_to_corporate(enr_row, corporate, CHAIN_TO_CORPORATE)
    if billing:
        enriched.at[idx, 'billing_model'] = billing
        fields_updated['billing_model'] += 1
        matched += 1

        # Try to get other fields by matching in corporate
        chain_name = enr_row.get('corporate_chain_name')
        mapped_chain = CHAIN_TO_CORPORATE.get(chain_name, chain_name)

        # Simple: if we found billing, mark services as researched
        # In a full implementation, we'd pull specific data for each clinic

print(f"✓ Matched {matched} corporates with billing data\n")

# Save
enriched.to_csv(OUTPUT_CSV, index=False)
print(f"✅ Saved to {OUTPUT_CSV}")

# Summary
corporates = enriched[enriched['ownership'] == 'Corporate']
with_chain = (corporates['corporate_chain_name'].notna() & (corporates['corporate_chain_name'].str.strip() != '')).sum()
classified = (corporates['billing_model'] != 'Unclassified').sum()

print(f"\n{'='*70}")
print(f"{'IDENTIFICATION + MATCHING SUMMARY':^70}")
print(f"{'='*70}")
print(f"Total corporates:                  {len(corporates):6}")
print(f"With corporate_chain_name:         {with_chain:6} ({with_chain/len(corporates)*100:5.1f}%)")
print(f"With classified billing:           {classified:6} ({classified/len(corporates)*100:5.1f}%)")
print(f"{'='*70}\n")
