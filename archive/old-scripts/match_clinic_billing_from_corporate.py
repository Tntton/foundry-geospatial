#!/usr/bin/env python3
"""
Match individual clinics from corporate CSV to enriched CSV and apply their specific billing types.
Matches by: location name + state + corporate chain.
"""

import pandas as pd
import numpy as np
from difflib import SequenceMatcher

INPUT_ENRICHED = "data/clinics/Master Sheet/enriched_clinics.csv"
INPUT_CORPORATE = "data/clinics/Corporate Only/corporate_chain_master_database (by clinic).csv"
OUTPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"

enriched = pd.read_csv(INPUT_ENRICHED)
corporate = pd.read_csv(INPUT_CORPORATE)

print(f"Loaded {len(enriched)} enriched clinics")
print(f"Loaded {len(corporate)} corporate clinics\n")

# Manual chain name mappings
CHAIN_MAPPING = {
    'Myhealth Medical Group': 'MyHealth',
}

def normalize(text):
    """Normalize text for matching."""
    if pd.isna(text):
        return ""
    return str(text).lower().strip()

def extract_location_from_name(clinic_name):
    """Extract location from clinic name (e.g., 'Myhealth Darling Square' → 'Darling Square')."""
    if pd.isna(clinic_name):
        return ""

    name = str(clinic_name).strip()

    # Remove common prefixes
    for prefix in ['Myhealth ', 'MyHealth ', 'myhealth ', 'Ochre Medical Centre ', 'Ochre Health ',
                   'Eastbrooke ', 'Our Medical ', 'Medicross ', 'Sonic Health Plus ', 'Medical One - ',
                   'Mamu Health Service Limited - ', 'Katungul Aboriginal Corporation ']:
        if name.lower().startswith(prefix.lower()):
            name = name[len(prefix):]
            break

    return normalize(name)

print("Matching clinics from corporate CSV to enriched...\n")
matched = 0
mismatches = []

for idx, enr_row in enriched.iterrows():
    is_corporate = enr_row.get('ownership') == 'Corporate'
    is_unclassified = enr_row.get('billing_model') == 'Unclassified'
    chain_name = enr_row.get('corporate_chain_name')
    enr_clinic_name = enr_row.get('clinic_name')
    enr_suburb = enr_row.get('suburb')
    enr_state = enr_row.get('state_code')

    if not (is_corporate and is_unclassified and chain_name and pd.notna(chain_name)):
        continue

    # Map chain name
    mapped_chain = CHAIN_MAPPING.get(chain_name, chain_name)

    # Try to find matching clinic in corporate CSV
    corp_subset = corporate[corporate['Corporate Chain'] == mapped_chain]
    if len(corp_subset) == 0:
        continue

    # Extract location from enriched clinic name
    enr_location = extract_location_from_name(enr_clinic_name)

    # Find best match in corporate CSV by location + state
    best_match = None
    best_score = 0
    best_billing = None

    for _, corp_row in corp_subset.iterrows():
        corp_clinic_name_raw = str(corp_row.get('Clinic Name', '')).strip()
        corp_clinic_name = normalize(corp_clinic_name_raw)
        corp_state = str(corp_row.get('State', '')).upper().strip()
        corp_billing = corp_row.get('Billing Type')

        # Skip if no billing type
        if pd.isna(corp_billing):
            continue

        # Score 1: Try substring matching first (location appears in corporate clinic name)
        if enr_location in corp_clinic_name or corp_clinic_name in enr_location:
            loc_score = 0.95
        else:
            # Fall back to fuzzy matching
            loc_score = SequenceMatcher(None, enr_location, corp_clinic_name).ratio()

        # Score 2: Does state match?
        state_match = 1.0 if enr_state == corp_state else 0.2

        combined_score = (loc_score * 0.75) + (state_match * 0.25)

        if combined_score > best_score:
            best_score = combined_score
            best_billing = corp_billing

    # Apply billing type if good match found (>0.55 threshold)
    if best_score > 0.55 and best_billing:
        enriched.at[idx, 'billing_model'] = best_billing
        matched += 1

print(f"✓ Matched {matched} clinics with specific billing types\n")

# Save
enriched.to_csv(OUTPUT_CSV, index=False)
print(f"✅ Saved to {OUTPUT_CSV}")

# Summary
corporates = enriched[enriched['ownership'] == 'Corporate']
still_unclass = corporates[corporates['billing_model'] == 'Unclassified']

print(f"\n{'='*70}")
print(f"{'CLINIC-TO-CLINIC MATCH SUMMARY':^70}")
print(f"{'='*70}")
print(f"Total corporates:                  {len(corporates):6}")
print(f"Still unclassified:                {len(still_unclass):6} ({len(still_unclass)/len(corporates)*100:5.1f}%)")
print(f"\nFinal billing_model distribution:")
for model, count in corporates['billing_model'].value_counts().items():
    pct = count / len(corporates) * 100
    print(f"  {str(model):20} {count:6} ({pct:5.1f}%)")
print(f"{'='*70}\n")

# Show sample matches
print("Sample matches (by chain):")
for chain in CHAIN_MAPPING.keys():
    matched_clinics = enriched[(enriched['corporate_chain_name'] == chain) &
                               (enriched['ownership'] == 'Corporate') &
                               (enriched['billing_model'] != 'Unclassified')]

    if len(matched_clinics) > 0:
        sample = matched_clinics[['clinic_name', 'suburb', 'billing_model']].head(5)
        print(f"\n{chain}:")
        for _, row in sample.iterrows():
            print(f"  {row['clinic_name']:40} ({row['suburb']:20}) → {row['billing_model']}")
