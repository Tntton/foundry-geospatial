#!/usr/bin/env python3
"""
1. Consolidate duplicate chain names (Myhealth Medical Group → MyHealth)
2. Match remaining unclassified clinics in matched chains with relaxed thresholds
"""

import pandas as pd
from difflib import SequenceMatcher

INPUT_ENRICHED = "data/clinics/Master Sheet/enriched_clinics.csv"
INPUT_CORPORATE = "data/clinics/Corporate Only/corporate_chain_master_database (by clinic).csv"
OUTPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"

enriched = pd.read_csv(INPUT_ENRICHED)
corporate = pd.read_csv(INPUT_CORPORATE)

print(f"Loaded {len(enriched)} enriched clinics\n")

# Step 1: Consolidate chain names
print("Step 1: Consolidating duplicate chain names...\n")

CONSOLIDATIONS = {
    'Myhealth Medical Group': 'MyHealth',
    'Myclinic Group': 'MyClinic',
}

consolidated = 0
for old_name, new_name in CONSOLIDATIONS.items():
    count = (enriched['corporate_chain_name'] == old_name).sum()
    enriched.loc[enriched['corporate_chain_name'] == old_name, 'corporate_chain_name'] = new_name
    if count > 0:
        print(f"  {old_name:30} → {new_name:20} ({count} clinics)")
        consolidated += count

print(f"\n✓ Consolidated {consolidated} clinics\n")

# Step 2: Match remaining unclassified in matchable chains
print("Step 2: Matching remaining unclassified in matchable chains...\n")

def normalize(text):
    if pd.isna(text):
        return ""
    return str(text).lower().strip()

def extract_location(clinic_name):
    if pd.isna(clinic_name):
        return ""
    name = str(clinic_name).strip()

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

# Get matchable chains (in both enriched and corporate)
enriched_chains = set(enriched[enriched['ownership'] == 'Corporate']['corporate_chain_name'].dropna())
corp_chains = set(corporate['Corporate Chain'].dropna())
matchable = enriched_chains & corp_chains

print(f"Matchable chains: {len(matchable)}")
for chain in sorted(matchable):
    enr_count = (enriched[(enriched['corporate_chain_name'] == chain) &
                          (enriched['billing_model'] == 'Unclassified')]).shape[0]
    if enr_count > 0:
        print(f"  {chain:30} has {enr_count:3} unclassified")

print()

matched_now = 0

for idx, enr_row in enriched.iterrows():
    if enr_row.get('ownership') != 'Corporate':
        continue
    if enr_row.get('billing_model') != 'Unclassified':
        continue

    chain_name = enr_row.get('corporate_chain_name')
    if not chain_name or pd.isna(chain_name):
        continue
    if chain_name not in matchable:
        continue

    enr_clinic_name = enr_row.get('clinic_name')
    enr_state = enr_row.get('state_code')
    enr_location = extract_location(enr_clinic_name)

    if not enr_location:
        continue

    # Find best match in corporate CSV
    corp_subset = corporate[corporate['Corporate Chain'] == chain_name]
    best_score = 0
    best_billing = None

    for _, corp_row in corp_subset.iterrows():
        corp_clinic_name = normalize(corp_row.get('Clinic Name', ''))
        corp_state = str(corp_row.get('State', '')).upper().strip()
        corp_billing = corp_row.get('Billing Type')

        if pd.isna(corp_billing):
            continue

        # More relaxed scoring
        if enr_location in corp_clinic_name or corp_clinic_name in enr_location:
            loc_score = 0.95
        else:
            loc_score = SequenceMatcher(None, enr_location, corp_clinic_name).ratio()

        # State match (less strict now)
        state_match = 1.0 if enr_state == corp_state else 0.5

        combined = (loc_score * 0.7) + (state_match * 0.3)

        if combined > best_score:
            best_score = combined
            best_billing = corp_billing

    # Lower threshold from 0.55 to 0.45
    if best_score > 0.45 and best_billing:
        enriched.at[idx, 'billing_model'] = best_billing
        matched_now += 1

print(f"✓ Matched {matched_now} previously unclassified clinics\n")

# Save
enriched.to_csv(OUTPUT_CSV, index=False)
print(f"✅ Saved to {OUTPUT_CSV}\n")

# Summary
corporates = enriched[enriched['ownership'] == 'Corporate']
classified = (corporates['billing_model'] != 'Unclassified').sum()
unclassified = (corporates['billing_model'] == 'Unclassified').sum()

print(f"{'='*70}")
print(f"{'FINAL SUMMARY':^70}")
print(f"{'='*70}")
print(f"Total corporates:                  {len(corporates):6}")
print(f"Classified billing:                {classified:6} ({classified/len(corporates)*100:5.1f}%)")
print(f"Unclassified:                      {unclassified:6} ({unclassified/len(corporates)*100:5.1f}%)")
print(f"{'='*70}\n")

# Show remaining issues
if unclassified > 0:
    print("Remaining unclassified by chain:")
    unclass_df = corporates[corporates['billing_model'] == 'Unclassified']
    for chain in sorted(unclass_df['corporate_chain_name'].dropna().unique()):
        count = (unclass_df['corporate_chain_name'] == chain).sum()
        if count > 0:
            print(f"  {chain:30} {count:3} clinics")
    print()
