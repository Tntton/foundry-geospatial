#!/usr/bin/env python3
"""
Enrich enriched_clinics.csv with billing type and GP count rules:
1. billing_type_corporate → billing_model if billing_model is unclassified/empty
2. gp_count replaces unique_gp_count if both exist
3. gp_count enriches unique_gp_count if it doesn't exist
"""

import pandas as pd
import numpy as np
from pathlib import Path

INPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"
OUTPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"

# Load
df = pd.read_csv(INPUT_CSV)
print(f"Loaded {len(df)} clinics\n")

# Track changes
billing_enriched = 0
gp_count_replaced = 0
gp_count_filled = 0

# Rule 1: billing_type_corporate → billing_model if unclassified/empty
print("Processing billing_model enrichment...")
for idx, row in df.iterrows():
    corporate_type = row.get('billing_type_corporate')
    current_model = row.get('billing_model')

    # Check if corporate_type has value and billing_model is unclassified or empty
    if pd.notna(corporate_type) and corporate_type and corporate_type.strip():
        if pd.isna(current_model) or current_model == '' or str(current_model).strip().lower() == 'unclassified':
            df.at[idx, 'billing_model'] = corporate_type
            billing_enriched += 1

print(f"✓ Enriched {billing_enriched} clinics with billing_type_corporate\n")

# Rule 2 & 3: GP count logic
print("Processing GP count logic...")
for idx, row in df.iterrows():
    gp_count = row.get('gp_count')
    unique_gp_count = row.get('unique_gp_count')

    gp_count_has_value = pd.notna(gp_count) and gp_count != '' and gp_count != 0
    unique_gp_has_value = pd.notna(unique_gp_count) and unique_gp_count != '' and unique_gp_count != 0

    # Both exist: replace unique_gp_count with gp_count
    if gp_count_has_value and unique_gp_has_value:
        if gp_count != unique_gp_count:
            df.at[idx, 'unique_gp_count'] = gp_count
            gp_count_replaced += 1

    # Only unique_gp_count exists: fill gp_count from it
    elif unique_gp_has_value and not gp_count_has_value:
        df.at[idx, 'gp_count'] = unique_gp_count
        gp_count_filled += 1

print(f"✓ Replaced {gp_count_replaced} unique_gp_count values with gp_count")
print(f"✓ Filled {gp_count_filled} empty gp_count from unique_gp_count\n")

# Save
df.to_csv(OUTPUT_CSV, index=False)
print(f"✅ Saved to {OUTPUT_CSV}")

# Summary
print(f"\n{'='*60}")
print(f"{'ENRICHMENT SUMMARY':^60}")
print(f"{'='*60}")
print(f"Billing model enriched:      {billing_enriched:6}")
print(f"GP count replaced:           {gp_count_replaced:6}")
print(f"GP count filled:             {gp_count_filled:6}")
print(f"{'='*60}\n")
