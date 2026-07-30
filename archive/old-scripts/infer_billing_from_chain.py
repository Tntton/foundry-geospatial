#!/usr/bin/env python3
"""
Infer billing_model for unclassified corporates based on their corporate_chain_name.
Uses the dominant billing model of each chain from classified clinics.
"""

import pandas as pd

INPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"
OUTPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"

df = pd.read_csv(INPUT_CSV)
print(f"Loaded {len(df)} clinics\n")

# Build billing model mapping for each chain
print("Building chain → billing model mapping from classified clinics...\n")
chain_billing_map = {}

classified = df[(df['corporate_chain_name'].notna()) &
                (df['corporate_chain_name'].str.strip() != '') &
                (df['billing_model'] != 'Unclassified')]

for chain in classified['corporate_chain_name'].unique():
    chain_data = classified[classified['corporate_chain_name'] == chain]
    models = chain_data['billing_model'].value_counts()
    dominant_model = models.index[0]  # Most common
    chain_billing_map[chain] = dominant_model

print(f"Mapped {len(chain_billing_map)} chains\n")
for chain, model in sorted(chain_billing_map.items()):
    print(f"  {chain:30} → {model}")

print()

# Apply inference to unclassified corporates with chain names
print("Inferring billing models for unclassified corporates...\n")
inferred = 0

for idx, row in df.iterrows():
    is_corporate = row.get('ownership') == 'Corporate'
    is_unclassified = row.get('billing_model') == 'Unclassified'
    chain_name = row.get('corporate_chain_name')

    if is_corporate and is_unclassified and chain_name and pd.notna(chain_name) and chain_name.strip():
        chain_name = chain_name.strip()
        if chain_name in chain_billing_map:
            df.at[idx, 'billing_model'] = chain_billing_map[chain_name]
            inferred += 1

print(f"✓ Inferred billing model for {inferred} clinics\n")

# Save
df.to_csv(OUTPUT_CSV, index=False)
print(f"✅ Saved to {OUTPUT_CSV}")

# Verify
corporates = df[df['ownership'] == 'Corporate']
still_unclass = corporates[corporates['billing_model'] == 'Unclassified']

print(f"\n{'='*60}")
print(f"{'BILLING INFERENCE SUMMARY':^60}")
print(f"{'='*60}")
print(f"Total corporates:              {len(corporates):6}")
print(f"Still unclassified:            {len(still_unclass):6} ({len(still_unclass)/len(corporates)*100:5.1f}%)")
print(f"  (These lack corporate_chain_name)")
print(f"\nBilling model distribution:")
for model, count in df[df['ownership'] == 'Corporate']['billing_model'].value_counts().items():
    pct = count / len(corporates) * 100
    print(f"  {str(model):20} {count:6} ({pct:5.1f}%)")
print(f"{'='*60}\n")
