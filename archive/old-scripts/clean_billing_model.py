#!/usr/bin/env python3
"""
1. Replace billing_model with billing_type_corporate where both have data
2. Standardize billing_model to: Bulk Billing, Private Billing, Mixed Billing
3. Delete billing_type_corporate column
"""

import pandas as pd
import numpy as np

INPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"
OUTPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"

df = pd.read_csv(INPUT_CSV)
print(f"Loaded {len(df)} clinics\n")

# Rule 1: Replace billing_model with billing_type_corporate where both exist
print("Step 1: Replace billing_model with billing_type_corporate where both have data...")
replaced = 0
for idx, row in df.iterrows():
    corporate_type = row.get('billing_type_corporate')
    current_model = row.get('billing_model')

    # If both have values, replace
    if pd.notna(corporate_type) and corporate_type and corporate_type.strip():
        if pd.notna(current_model) and current_model and current_model.strip() != 'Unclassified':
            df.at[idx, 'billing_model'] = corporate_type
            replaced += 1

print(f"✓ Replaced {replaced} billing_model values\n")

# Rule 2: Standardize billing_model values
print("Step 2: Standardize billing_model to standard format...")
standardization_map = {
    'Bulk': 'Bulk Billing',
    'Bulk Billing': 'Bulk Billing',
    'Private': 'Private Billing',
    'Private Billing': 'Private Billing',
    'Mixed': 'Mixed Billing',
    'Mixed Billing': 'Mixed Billing',
}

before_counts = df['billing_model'].value_counts(dropna=False).to_dict()

for idx, row in df.iterrows():
    model = row.get('billing_model')
    if pd.notna(model) and model and model.strip() in standardization_map:
        df.at[idx, 'billing_model'] = standardization_map[model.strip()]

print("Standardization mapping applied:")
for old, new in standardization_map.items():
    print(f"  {old:20} → {new}")

print(f"\nBilling model values after standardization:")
print(df['billing_model'].value_counts(dropna=False))
print()

# Rule 3: Delete billing_type_corporate column
print("Step 3: Delete billing_type_corporate column...")
df = df.drop(columns=['billing_type_corporate'])
print(f"✓ Deleted billing_type_corporate")
print(f"✓ Column count: {len(df.columns)} (was 42)\n")

# Save
df.to_csv(OUTPUT_CSV, index=False)
print(f"✅ Saved to {OUTPUT_CSV}")

print(f"\n{'='*60}")
print(f"{'BILLING MODEL CLEANUP SUMMARY':^60}")
print(f"{'='*60}")
print(f"Replaced with corporate type:  {replaced:6}")
print(f"Final column count:            {len(df.columns):6}")
print(f"\nFinal billing_model distribution:")
for model, count in df['billing_model'].value_counts(dropna=False).items():
    pct = count / len(df) * 100
    print(f"  {str(model):20} {count:6} ({pct:5.1f}%)")
print(f"{'='*60}\n")
