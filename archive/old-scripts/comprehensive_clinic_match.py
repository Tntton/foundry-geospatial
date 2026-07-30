#!/usr/bin/env python3
"""
Comprehensive clinic-to-clinic matching: Match ALL corporate clinics in enriched CSV
to corporate CSV and pull ALL available fields: billing, chain name, pathology, radiology, allied health, URL.
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

# Manual chain name mappings (enriched → corporate)
CHAIN_MAPPING = {
    'Myhealth Medical Group': 'MyHealth',
}

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

    # Remove common chain prefixes
    prefixes = [
        'Myhealth ', 'MyHealth ', 'myhealth ',
        'Ochre Medical Centre ', 'Ochre Health ',
        'Eastbrooke ', 'Our Medical ', 'Medicross ',
        'Sonic Health Plus ', 'Medical One - ',
        'Mamu Health Service Limited - ',
        'Katungul Aboriginal Corporation ',
    ]
    for prefix in prefixes:
        if name.lower().startswith(prefix.lower()):
            name = name[len(prefix):]
            break

    return normalize(name)

def match_clinic_to_corporate(enr_row, corp_df, chain_mapping):
    """Match a single enriched clinic to corporate CSV and return matched row or None."""
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
    best_match = None
    best_score = 0

    for _, corp_row in corp_subset.iterrows():
        corp_clinic_name = normalize(corp_row.get('Clinic Name', ''))
        corp_state = str(corp_row.get('State', '')).upper().strip()

        # Scoring: substring match > fuzzy match
        if enr_location in corp_clinic_name or corp_clinic_name in enr_location:
            loc_score = 0.95
        else:
            loc_score = SequenceMatcher(None, enr_location, corp_clinic_name).ratio()

        # State match
        state_match = 1.0 if enr_state == corp_state else 0.2

        combined_score = (loc_score * 0.75) + (state_match * 0.25)

        if combined_score > best_score:
            best_score = combined_score
            best_match = corp_row

    # Return match if above threshold
    if best_score > 0.55 and best_match is not None:
        return best_match
    return None

print("Matching all corporate clinics to corporate CSV...\n")

# Track statistics
matched = 0
fields_updated = {
    'billing_model': 0,
    'corporate_chain_name': 0,
    'has_pathology': 0,
    'has_radiology_imaging': 0,
    'has_allied_health': 0,
    'website': 0,
}

# Process all corporates
for idx, enr_row in enriched.iterrows():
    if enr_row.get('ownership') != 'Corporate':
        continue

    # Try to match to corporate CSV
    corp_match = match_clinic_to_corporate(enr_row, corporate, CHAIN_MAPPING)

    if corp_match is None:
        continue

    matched += 1

    # Pull all fields from corporate CSV

    # 1. Billing type
    billing_type = corp_match.get('Billing Type')
    if pd.notna(billing_type) and billing_type.strip():
        enriched.at[idx, 'billing_model'] = billing_type
        fields_updated['billing_model'] += 1

    # 2. Corporate chain name (use mapped value)
    corp_chain = corp_match.get('Corporate Chain')
    if pd.notna(corp_chain) and corp_chain.strip():
        enriched.at[idx, 'corporate_chain_name'] = corp_chain
        fields_updated['corporate_chain_name'] += 1

    # 3. Pathology
    pathology = corp_match.get('Pathology')
    if pd.notna(pathology):
        path_str = str(pathology).strip().lower()
        if path_str == 'yes':
            enriched.at[idx, 'has_pathology'] = 'Yes'
            fields_updated['has_pathology'] += 1
        elif path_str == 'no':
            enriched.at[idx, 'has_pathology'] = 'No'
            fields_updated['has_pathology'] += 1

    # 4. Radiology/Imaging
    radiology = corp_match.get('Radiology/Imaging')
    if pd.notna(radiology):
        rad_str = str(radiology).strip().lower()
        if rad_str == 'yes':
            enriched.at[idx, 'has_radiology_imaging'] = 'Yes'
            fields_updated['has_radiology_imaging'] += 1
        elif rad_str == 'no':
            enriched.at[idx, 'has_radiology_imaging'] = 'No'
            fields_updated['has_radiology_imaging'] += 1

    # 5. Allied Health
    allied_health = corp_match.get('Allied Health')
    if pd.notna(allied_health):
        ah_str = str(allied_health).strip().lower()
        if ah_str == 'yes':
            enriched.at[idx, 'has_allied_health'] = 'Yes'
            fields_updated['has_allied_health'] += 1
        elif ah_str == 'no':
            enriched.at[idx, 'has_allied_health'] = 'No'
            fields_updated['has_allied_health'] += 1

    # 6. URL/Website
    url = corp_match.get('URL')
    if pd.notna(url) and url.strip() and url.strip() != 'nan':
        enriched.at[idx, 'website'] = url.strip()
        fields_updated['website'] += 1

print(f"✓ Matched {matched} corporates to corporate CSV\n")
print("Fields updated:")
for field, count in fields_updated.items():
    print(f"  {field:30} {count:6}")

print()

# Save
enriched.to_csv(OUTPUT_CSV, index=False)
print(f"✅ Saved to {OUTPUT_CSV}")

# Summary
corporates = enriched[enriched['ownership'] == 'Corporate']

print(f"\n{'='*70}")
print(f"{'COMPREHENSIVE MATCH SUMMARY':^70}")
print(f"{'='*70}")
print(f"Total corporates in enriched:       {len(corporates):6}")
print(f"Matched to corporate CSV:           {matched:6} ({matched/len(corporates)*100:5.1f}%)")
print(f"Still unmatched:                    {len(corporates)-matched:6} ({(len(corporates)-matched)/len(corporates)*100:5.1f}%)")

print(f"\nBilling model coverage:")
classified = (corporates['billing_model'] != 'Unclassified').sum()
print(f"  Classified:                       {classified:6} ({classified/len(corporates)*100:5.1f}%)")

print(f"\nServices coverage (Yes/No/Empty):")
pathology_yes = (corporates['has_pathology'] == 'Yes').sum()
pathology_no = (corporates['has_pathology'] == 'No').sum()
pathology_empty = len(corporates) - pathology_yes - pathology_no
print(f"  Pathology:    Yes:{pathology_yes:4} No:{pathology_no:4} Empty:{pathology_empty:4}")

radiology_yes = (corporates['has_radiology_imaging'] == 'Yes').sum()
radiology_no = (corporates['has_radiology_imaging'] == 'No').sum()
radiology_empty = len(corporates) - radiology_yes - radiology_no
print(f"  Radiology:    Yes:{radiology_yes:4} No:{radiology_no:4} Empty:{radiology_empty:4}")

allied_yes = (corporates['has_allied_health'] == 'Yes').sum()
allied_no = (corporates['has_allied_health'] == 'No').sum()
allied_empty = len(corporates) - allied_yes - allied_no
print(f"  Allied Health: Yes:{allied_yes:4} No:{allied_no:4} Empty:{allied_empty:4}")

website_filled = corporates['website'].notna().sum()
print(f"\nWebsite coverage:                   {website_filled:6} ({website_filled/len(corporates)*100:5.1f}%)")

print(f"{'='*70}\n")
