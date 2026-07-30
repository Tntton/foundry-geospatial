#!/usr/bin/env python3
"""
Auto-enrich clinic_format for independent clinics using two-stage approach:
Stage 1: GP count thresholds (Big-box 6+, Mid-format 3-5, Small 1-2) - HIGH confidence
Stage 2: Person-name pattern matching (FirstName or FirstName LastName) - MEDIUM confidence
"""

import pandas as pd
import re
from datetime import datetime

COMP_CSV = "data/clinics/Master Sheet/comprehensive_clinic_database.csv"
COMP_BACKUP = f"data/clinics/Master Sheet/comprehensive_clinic_database.csv.backup_clinic_format_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

def is_person_name(clinic_name):
    """
    Check if clinic name is a person name pattern (FirstName or FirstName LastName).
    Returns True if name matches person-name pattern, False otherwise.

    Rules:
    - Single word: Capitalized word without medical keywords → FirstName
    - Two words: Both capitalized without medical keywords → FirstName LastName
    - Exclude common medical/clinic keywords: Medical, Clinic, Centre, Center, Health, Surgery, Practice, etc.
    """
    if not clinic_name or pd.isna(clinic_name):
        return False

    clinic_name = str(clinic_name).strip()

    # Medical/clinic keywords to exclude
    medical_keywords = [
        'medical', 'clinic', 'centre', 'center', 'health', 'surgery', 'practice',
        'hospital', 'dental', 'physio', 'therapy', 'wellness', 'care', 'group',
        'complex', 'suite', 'clinic', 'partners', 'consulting', 'centre', 'care centre'
    ]

    # Check if name contains medical keywords (case-insensitive)
    name_lower = clinic_name.lower()
    for keyword in medical_keywords:
        if keyword in name_lower:
            return False

    # Pattern 1: Single word (FirstName only)
    if ' ' not in clinic_name:
        # Must be capitalized and 2+ characters
        if re.match(r'^[A-Z][a-z]{1,}$', clinic_name):
            return True
        return False

    # Pattern 2: Two words (FirstName LastName)
    words = clinic_name.split()
    if len(words) == 2:
        # Both words must be capitalized (start with capital, rest lowercase)
        word1, word2 = words
        if re.match(r'^[A-Z][a-z]{1,}$', word1) and re.match(r'^[A-Z][a-z]{1,}$', word2):
            return True

    return False

def classify_by_gp_count(gp_count):
    """
    Classify clinic_format based on GP count thresholds.
    Returns (clinic_format, confidence) or (None, None) if gp_count is missing/invalid.
    """
    try:
        if pd.isna(gp_count) or gp_count == '' or str(gp_count).lower() in ['nan', 'none', 'na']:
            return None, None

        gp_count_val = float(gp_count)

        if gp_count_val >= 6:
            return "Big-box", "high"
        elif 3 <= gp_count_val <= 5:
            return "Mid-format", "high"
        elif 1 <= gp_count_val <= 2:
            return "Small", "high"
        else:
            return None, None
    except (ValueError, TypeError):
        return None, None

# Load database
df = pd.read_csv(COMP_CSV)
print(f"Loaded {len(df)} clinics from comprehensive database")

# Create backup
df.to_csv(COMP_BACKUP, index=False)
print(f"Backup created: {COMP_BACKUP}")

# Filter for independent clinics without clinic_format
independent = df[df['ownership'].str.lower() == 'independent']
missing_format = independent[
    (independent['clinic_format'].isna()) |
    (independent['clinic_format'] == '')
]

print(f"\nIndependent clinics: {len(independent)}")
print(f"Missing clinic_format: {len(missing_format)}")

# Stage 1: Apply GP count thresholds
stage1_enriched = 0
for idx, row in missing_format.iterrows():
    clinic_format, confidence = classify_by_gp_count(row.get('gp_count'))
    if clinic_format:
        df.at[idx, 'clinic_format'] = clinic_format
        df.at[idx, 'Format_Confidence'] = confidence
        stage1_enriched += 1
        print(f"[Stage 1] {row['clinic_name']}: {clinic_format} (GP count: {row.get('gp_count')})")

# Stage 2: Person-name pattern matching (for remaining clinics without format)
# Reload missing_format to get updated list after Stage 1
missing_format = df[
    (df['ownership'].str.lower() == 'independent') &
    ((df['clinic_format'].isna()) | (df['clinic_format'] == ''))
]

stage2_enriched = 0
for idx, row in missing_format.iterrows():
    if is_person_name(row.get('clinic_name')):
        df.at[idx, 'clinic_format'] = "Small"
        df.at[idx, 'Format_Confidence'] = "medium"
        stage2_enriched += 1
        print(f"[Stage 2] {row['clinic_name']}: Small (person-name pattern)")

# Save enriched database
df.to_csv(COMP_CSV, index=False)

# Calculate final coverage
total_clinics = len(df)
independent_total = len(df[df['ownership'].str.lower() == 'independent'])
with_format = len(df[
    (df['ownership'].str.lower() == 'independent') &
    ((df['clinic_format'].notna()) & (df['clinic_format'] != ''))
])
independent_with_format = with_format
independent_with_format_pct = (independent_with_format / independent_total * 100) if independent_total > 0 else 0

print(f"\n{'='*50}")
print(f"ENRICHMENT RESULTS")
print(f"{'='*50}")
print(f"Stage 1 (GP count thresholds): {stage1_enriched} clinics enriched")
print(f"Stage 2 (person-name patterns): {stage2_enriched} clinics enriched")
print(f"Total enriched: {stage1_enriched + stage2_enriched} clinics")
print(f"\nCoverage:")
print(f"  Independent clinics with format: {independent_with_format}/{independent_total} ({independent_with_format_pct:.1f}%)")
print(f"  All clinics with format: {len(df[(df['clinic_format'].notna()) & (df['clinic_format'] != '')])}/{total_clinics}")
print(f"\nDatabase saved: {COMP_CSV}")
print(f"Backup: {COMP_BACKUP}")
