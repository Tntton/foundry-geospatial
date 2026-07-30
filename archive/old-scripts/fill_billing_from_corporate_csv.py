#!/usr/bin/env python3
"""
Fill billing_model for unclassified corporates by matching against corporate_chain_master_database.
Uses manual mapping for known name mismatches + fuzzy matching for others.
"""

import pandas as pd
import numpy as np
from difflib import SequenceMatcher
from collections import Counter

INPUT_ENRICHED = "data/clinics/Master Sheet/enriched_clinics.csv"
INPUT_CORPORATE = "data/clinics/Corporate Only/corporate_chain_master_database (by clinic).csv"
OUTPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"

enriched = pd.read_csv(INPUT_ENRICHED)
corporate = pd.read_csv(INPUT_CORPORATE)

print(f"Loaded {len(enriched)} enriched clinics")
print(f"Loaded {len(corporate)} corporate clinics\n")

# Manual mapping for known name mismatches
MANUAL_MAPPING = {
    'Myhealth Medical Group': 'MyHealth',
}

# Get unique chains from both
enriched_chains = enriched[enriched['corporate_chain_name'].notna()]['corporate_chain_name'].unique()
corporate_chains = [c for c in corporate['Corporate Chain'].unique() if pd.notna(c)]

print(f"Enriched has {len(enriched_chains)} unique corporate chains")
print(f"Corporate CSV has {len(corporate_chains)} unique corporate chains\n")

# Build chain name mapping with manual overrides + fuzzy matching
def fuzzy_match(enriched_chain, corporate_chains_list):
    """Find best match in corporate CSV chains."""
    if pd.isna(enriched_chain):
        return None

    best_match = None
    best_ratio = 0

    for corp_chain in corporate_chains_list:
        if pd.isna(corp_chain):
            continue
        ratio = SequenceMatcher(None, enriched_chain.lower(), corp_chain.lower()).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_match = corp_chain

    # Only accept matches above 0.6 similarity
    if best_ratio > 0.6:
        return best_match
    return None

print("Building chain name mapping...\n")
chain_mapping = {}
for echain in enriched_chains:
    if pd.notna(echain):
        # Check manual mapping first
        if echain in MANUAL_MAPPING:
            matched = MANUAL_MAPPING[echain]
            chain_mapping[echain] = matched
            print(f"  {echain:30} → {matched} (MANUAL)")
        else:
            matched = fuzzy_match(echain, corporate_chains)
            chain_mapping[echain] = matched
            if matched:
                print(f"  {echain:30} → {matched}")
            else:
                print(f"  {echain:30} → NOT FOUND")

print()

# Build dominant billing type per chain from corporate CSV
chain_dominant_billing = {}
for chain in corporate_chains:
    billing_types = corporate[corporate['Corporate Chain'] == chain]['Billing Type']
    billing_types = billing_types[billing_types.notna()]
    if len(billing_types) > 0:
        counts = Counter(billing_types)
        dominant = counts.most_common(1)[0][0]
        chain_dominant_billing[chain] = dominant

print("Dominant billing type per chain (from corporate CSV):")
for chain in sorted(chain_dominant_billing.keys()):
    billing = chain_dominant_billing[chain]
    count = len(corporate[corporate['Corporate Chain'] == chain])
    print(f"  {chain:30} → {billing:20}")

print()

# Fill billing for unclassified corporates
print("Filling billing_model for unclassified corporates with chain names...\n")
filled = 0

for idx, row in enriched.iterrows():
    is_corporate = row.get('ownership') == 'Corporate'
    is_unclassified = row.get('billing_model') == 'Unclassified'
    chain_name = row.get('corporate_chain_name')

    if is_corporate and is_unclassified and chain_name and pd.notna(chain_name):
        # Look up mapped chain
        mapped_chain = chain_mapping.get(chain_name)
        if mapped_chain and mapped_chain in chain_dominant_billing:
            billing_type = chain_dominant_billing[mapped_chain]
            enriched.at[idx, 'billing_model'] = billing_type
            filled += 1

print(f"✓ Filled {filled} clinics from corporate CSV\n")

# Save
enriched.to_csv(OUTPUT_CSV, index=False)
print(f"✅ Saved to {OUTPUT_CSV}")

# Summary
corporates = enriched[enriched['ownership'] == 'Corporate']
still_unclass = corporates[corporates['billing_model'] == 'Unclassified']
without_chain = still_unclass[(still_unclass['corporate_chain_name'].isna()) |
                              (still_unclass['corporate_chain_name'].str.strip() == '')]

print(f"\n{'='*70}")
print(f"{'BILLING FILL SUMMARY':^70}")
print(f"{'='*70}")
print(f"Total corporates:                  {len(corporates):6}")
print(f"Still unclassified:                {len(still_unclass):6} ({len(still_unclass)/len(corporates)*100:5.1f}%)")
print(f"  Without corporate_chain_name:    {len(without_chain):6}")
print(f"\nFinal billing_model distribution:")
for model, count in corporates['billing_model'].value_counts().items():
    pct = count / len(corporates) * 100
    print(f"  {str(model):20} {count:6} ({pct:5.1f}%)")
print(f"{'='*70}\n")
