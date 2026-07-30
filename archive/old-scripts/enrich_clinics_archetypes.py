#!/usr/bin/env python3
"""
Enrich clinics.csv with archetype classifications (Format, Billing Model, Ownership).
Reads: clinic_websites_and_reviews.csv, clinic_scrape_results.csv, clinics.csv
Outputs: enriched_clinics.csv with confidence levels
"""

import pandas as pd
import re
from pathlib import Path
from collections import defaultdict

# --- Config ---
INPUT_CLINICS_CSV = "data/clinics.csv"
INPUT_FETCH_CSV = "data/clinics/Scrape Results/clinic_websites_and_reviews.csv"
INPUT_SCRAPE_CSV = "data/clinics/Scrape Results/clinic_scrape_results.csv"
OUTPUT_CSV = "data/clinics/Master Sheet/enriched_clinics.csv"


def parse_signal_dict(signal_str):
    """Parse string representation of dict (e.g., \"{'bulk_billing': 2}\")"""
    if pd.isna(signal_str) or signal_str == '':
        return {}
    try:
        return eval(signal_str) if isinstance(signal_str, str) else signal_str
    except:
        return {}


def classify_format(row_scraped, row_clinic):
    """
    Classify clinic format per F-01 spec:
      Big-box:    GP count >=6 OR website signals big_box
      Mid-format: GP count 3-5 OR website signals ambiguous
      Small:      GP count 1-2 OR website signals small
      Unclassified: insufficient data

    Tier 1 (high):   Website format keywords + GP count from scrape
    Tier 2 (medium): Clinic name keywords
    Tier 3 (low):    NHSD service type
    """
    has_scrape = row_scraped is not None and row_scraped.get('status') == 'success'

    # Tier 1: Website format keywords (high confidence)
    if has_scrape:
        format_signals = parse_signal_dict(row_scraped.get('format_keywords', {}))
        big_box_score = format_signals.get('big_box', 0)
        small_score   = format_signals.get('small', 0)

        if big_box_score > small_score and big_box_score >= 1:
            return 'Big-box', 'high'
        if small_score > big_box_score and small_score >= 1:
            return 'Small', 'high'

    # Tier 1: GP count from scraper (high confidence, per F-01 spec thresholds)
    if has_scrape:
        doctor_count = int(row_scraped.get('doctor_count', 0) or 0)
        if doctor_count >= 6:
            return 'Big-box', 'high'
        elif 3 <= doctor_count <= 5:
            return 'Mid-format', 'high'
        elif 1 <= doctor_count <= 2:
            return 'Small', 'high'

    # Tier 2: Clinic name keywords (medium confidence)
    # Note: "medical centre/hub" → Mid-format until ancillary services scrape confirms room count
    name = str(row_clinic.get('ORGANISATION_NAME', '')).lower()
    if re.search(r'\b(medical centre|medical center|health hub|medical group|group practice|group medical)\b', name):
        return 'Mid-format', 'medium'
    if re.search(r'\b(family clinic|family doctor|family medicine|family practice)\b', name):
        return 'Small', 'medium'

    # Tier 3: NHSD service type (low confidence)
    nhsd_type = str(row_clinic.get('NHSD_SERVICE_TYPE', '')).lower()
    if re.search(r'walk.?in', nhsd_type):
        return 'Big-box', 'low'
    if re.search(r'(maternal|child|family health|nurse[\s-]?led|aboriginal)', nhsd_type):
        return 'Small', 'low'

    # No signals found
    return 'Unclassified', 'low'


def classify_billing(row_scraped, row_clinic, sa3_bb_pct):
    """Classify billing model (Bulk / Mixed / Private / Unclassified) with confidence."""
    if row_scraped is None or row_scraped.get('status') != 'success':
        # No website data — fall back to SA3-level BB%
        if pd.notna(sa3_bb_pct):
            if sa3_bb_pct > 70:
                return 'Bulk', 'low'
            elif sa3_bb_pct < 30:
                return 'Private', 'low'
            else:
                return 'Mixed', 'low'
        return 'Unclassified', 'low'

    # Have website scrape results
    billing_signals = parse_signal_dict(row_scraped.get('billing_keywords', {}))
    if not billing_signals:
        # No billing signals but have website data — use SA3 fallback
        if pd.notna(sa3_bb_pct):
            if sa3_bb_pct > 70:
                return 'Bulk', 'low'
            elif sa3_bb_pct < 30:
                return 'Private', 'low'
            else:
                return 'Mixed', 'low'
        return 'Unclassified', 'medium'

    # Score billing signals
    bulk_score = billing_signals.get('bulk_billing', 0)
    private_score = billing_signals.get('private', 0)
    mixed_score = billing_signals.get('mixed', 0)

    if bulk_score >= private_score and bulk_score >= mixed_score:
        return 'Bulk', 'high'
    elif private_score >= bulk_score and private_score >= mixed_score:
        return 'Private', 'high'
    elif mixed_score > 0:
        return 'Mixed', 'high'
    else:
        # Ambiguous — fall back to SA3
        if pd.notna(sa3_bb_pct):
            if sa3_bb_pct > 70:
                return 'Bulk', 'medium'
            elif sa3_bb_pct < 30:
                return 'Private', 'medium'
            else:
                return 'Mixed', 'medium'
        return 'Unclassified', 'medium'


def classify_ownership(row_scraped, row_clinic):
    """Classify ownership (Corporate / Independent / Unclassified) with confidence."""
    if row_scraped is None or row_scraped.get('status') != 'success':
        # No website data — use name keywords as fallback
        name = str(row_clinic.get('ORGANISATION_NAME', '')).lower()
        corporate_brands = [
            # Major chains from website scraping
            'myhealth', 'healius', 'sonic', 'ipn', 'eastbrooke', 'forhealth',
            'primary care', 'medicore',
            # Brands missing from first enrichment pass (found via reconciliation)
            'ochre health', 'ochre medical', 'family doctor network',
            'our medical', 'smartclinics', 'atticus health', 'next practice',
            'medicross', 'sia medical', 'tlc primary care', 'qualitas health',
            'medical one', 'medi7', 'dpv health', 'ipc health', 'genesicare'
        ]
        if any(brand in name for brand in corporate_brands):
            return 'Corporate', 'medium'
        if re.search(r'\b(pty\s*ltd|limited|corporation)\b', name):
            return 'Corporate', 'medium'
        return 'Independent', 'medium'

    # Have website scrape results
    ownership_signals = parse_signal_dict(row_scraped.get('ownership_keywords', {}))
    if ownership_signals.get('corporate', 0) > 0:
        return 'Corporate', 'high'

    # No corporate signals — assume independent
    return 'Independent', 'high'


def main():
    # Check input files exist
    for file in [INPUT_CLINICS_CSV, INPUT_FETCH_CSV, INPUT_SCRAPE_CSV]:
        if not Path(file).exists():
            print(f"❌ {file} not found!")
            exit(1)

    # Load data
    print(f"📂 Loading input files...")
    clinics_df = pd.read_csv(INPUT_CLINICS_CSV)
    fetch_df = pd.read_csv(INPUT_FETCH_CSV).set_index('OBJECTID')
    scrape_df = pd.read_csv(INPUT_SCRAPE_CSV).set_index('OBJECTID')

    print(f"   {len(clinics_df)} clinics")
    print(f"   {len(fetch_df)} fetch results")
    print(f"   {len(scrape_df)} scrape results\n")

    # Enrich each clinic
    results = []
    for idx, clinic in clinics_df.iterrows():
        obj_id = clinic['OBJECTID']

        # Get scrape results if available
        if obj_id in scrape_df.index:
            row_scraped = scrape_df.loc[obj_id].to_dict() if isinstance(scrape_df.loc[obj_id], pd.Series) else scrape_df.loc[obj_id].iloc[0].to_dict()
        else:
            row_scraped = None

        # Get SA3-level BB% (if available in original data)
        sa3_bb_pct = clinic.get('BB%') if 'BB%' in clinic else None

        # Classify format
        format_val, format_conf = classify_format(row_scraped, clinic)

        # Classify billing
        billing_val, billing_conf = classify_billing(row_scraped, clinic, sa3_bb_pct)

        # Classify ownership
        ownership_val, ownership_conf = classify_ownership(row_scraped, clinic)

        # Build enriched row
        enriched = {
            'OBJECTID': obj_id,
            'ORGANISATION_NAME': clinic['ORGANISATION_NAME'],
            'SUBURB': clinic.get('SUBURB', ''),
            'STATE': clinic.get('STATE', ''),
            'Format': format_val,
            'Format_Confidence': format_conf,
            'Billing_Model': billing_val,
            'Billing_Confidence': billing_conf,
            'Ownership_Final': ownership_val,
            'Ownership_Confidence': ownership_conf,
        }

        # Add original columns
        for col in clinic.index:
            if col not in enriched:
                enriched[col] = clinic[col]

        results.append(enriched)

        if (idx + 1) % 500 == 0:
            print(f"Enriched {idx + 1} / {len(clinics_df)}...")

    # Save output
    enriched_df = pd.DataFrame(results)
    enriched_df.to_csv(OUTPUT_CSV, index=False)
    print(f"\n✅ Enrichment complete! Output saved to {OUTPUT_CSV}")

    # Summary stats
    print(f"\n{'='*60}")
    print(f"{'ENRICHMENT SUMMARY':^60}")
    print(f"{'='*60}")
    print(f"Total clinics: {len(enriched_df)}\n")

    print("Format Classification:")
    for fmt in enriched_df['Format'].value_counts().index:
        count = (enriched_df['Format'] == fmt).sum()
        pct = count / len(enriched_df) * 100
        print(f"  {fmt:20} {count:6} ({pct:5.1f}%)")

    print("\nBilling Model Classification:")
    for model in enriched_df['Billing_Model'].value_counts().index:
        count = (enriched_df['Billing_Model'] == model).sum()
        pct = count / len(enriched_df) * 100
        print(f"  {model:20} {count:6} ({pct:5.1f}%)")

    print("\nOwnership Classification:")
    for own in enriched_df['Ownership_Final'].value_counts().index:
        count = (enriched_df['Ownership_Final'] == own).sum()
        pct = count / len(enriched_df) * 100
        print(f"  {own:20} {count:6} ({pct:5.1f}%)")

    print("\nConfidence Levels:")
    for col in ['Format_Confidence', 'Billing_Confidence', 'Ownership_Confidence']:
        print(f"  {col}:")
        for conf in enriched_df[col].value_counts().index:
            count = (enriched_df[col] == conf).sum()
            pct = count / len(enriched_df) * 100
            print(f"    {conf:10} {count:6} ({pct:5.1f}%)")

    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
