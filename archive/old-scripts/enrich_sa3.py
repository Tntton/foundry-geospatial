#!/usr/bin/env python3
"""
Augment sa3_scored.geojson with two new properties per feature:
  - MMM_Dominant   : Modified Monash Model class holding the largest ERP in the SA3
  - Whitespace_Score : 0/25/50/75 — three 25-point buckets (SES proxy + corporate share + demand)

Inputs:
  - sa3_scored.geojson  (existing)
  - SA3-21_MMM-23_mapping.csv (one row per SA3 × MMM portion)
  - enriched_clinics.csv (for corporate-share computation)

Output: sa3_scored.geojson (in place, overwritten)
"""

import json
import pandas as pd
from shapely.geometry import shape, Point


SA3_GEOJSON = 'data/sa3_scored.geojson'
MMM_CSV = 'data/SA3-21_MMM-23_mapping.csv'
CLINICS_CSV = 'data/enriched_clinics.csv'


def read_mmm_dominant():
    """Read MMM CSV, return one row per SA3 with the dominant (highest ERP) MMM class."""
    print(f'Reading {MMM_CSV}...')
    # Header is on row 8 (after 7 metadata rows), and column 0 is blank
    df = pd.read_csv(
        MMM_CSV,
        skiprows=7,
        encoding='latin-1',
        usecols=[1, 5, 6],  # SA3 Code, MMM Code, ERP 2023
        names=['SA3_Code', 'MMM_Code', 'ERP_2023'],
        header=0,
        dtype={'SA3_Code': str},
    ).dropna(subset=['SA3_Code', 'MMM_Code'])

    # Coerce types
    df['SA3_Code'] = df['SA3_Code'].astype(str).str.strip().str.replace('.0', '', regex=False)
    df['MMM_Code'] = pd.to_numeric(df['MMM_Code'], errors='coerce').astype('Int64')
    df['ERP_2023'] = pd.to_numeric(df['ERP_2023'], errors='coerce').fillna(0)
    df = df.dropna(subset=['MMM_Code'])

    print(f'  ✓ {len(df)} (SA3 × MMM) rows for {df["SA3_Code"].nunique()} SA3s')

    # Pick highest-ERP MMM per SA3
    idx = df.groupby('SA3_Code')['ERP_2023'].idxmax()
    dominant = df.loc[idx, ['SA3_Code', 'MMM_Code']].set_index('SA3_Code')
    return dominant['MMM_Code'].to_dict()


def read_clinics():
    print(f'Reading {CLINICS_CSV}...')
    df = pd.read_csv(CLINICS_CSV, low_memory=False)
    df = df.dropna(subset=['LATITUDE', 'LONGITUDE'])
    print(f'  ✓ {len(df)} clinics')
    return df


def main():
    # ---- 1. Load SA3 geojson
    print(f'Reading {SA3_GEOJSON}...')
    with open(SA3_GEOJSON) as f:
        sa3 = json.load(f)
    print(f'  ✓ {len(sa3["features"])} SA3 features')

    # ---- 2. MMM dominant per SA3
    mmm_dominant = read_mmm_dominant()

    # ---- 3. Clinic point-in-polygon → corporate share per SA3
    clinics = read_clinics()
    points = [
        (Point(float(r['LONGITUDE']), float(r['LATITUDE'])), str(r.get('Ownership Type', '')).strip())
        for _, r in clinics.iterrows()
    ]
    print(f'Computing corporate share per SA3 (point-in-polygon over {len(points)} clinics)...')

    # ---- 4. Per-feature enrichment
    n_enriched = 0
    score_dist = {0: 0, 25: 0, 50: 0, 75: 0}
    n_mmm_missing = 0

    for feat in sa3['features']:
        props = feat['properties']
        sa3_code = str(props.get('SA3Code', '')).strip()
        geom = shape(feat['geometry'])

        # MMM_Dominant lookup
        mmm = mmm_dominant.get(sa3_code) or mmm_dominant.get(sa3_code.lstrip('0'))
        if mmm is None:
            n_mmm_missing += 1
            props['MMM_Dominant'] = None
        else:
            props['MMM_Dominant'] = int(mmm)

        # Count clinics in this SA3, split by ownership
        total = 0
        corporate = 0
        for pt, ownership in points:
            if geom.contains(pt):
                total += 1
                if ownership == 'Corporate':
                    corporate += 1
        corporate_share = (corporate / total) if total > 0 else 0.0
        props['Corporate_Share'] = round(corporate_share, 3)

        # Whitespace Score — 3 buckets × 25
        econ = float(props.get('Economics_Score') or 0)
        demand = float(props.get('Demand_Score') or 0)
        score = 0
        if econ <= 50:
            score += 25
        if corporate_share < 0.30:
            score += 25
        if demand >= 60:
            score += 25
        props['Whitespace_Score'] = score
        score_dist[score] += 1
        n_enriched += 1

    print(f'  ✓ enriched {n_enriched} SA3 features')
    if n_mmm_missing:
        print(f'  ⚠ {n_mmm_missing} SA3 features had no MMM mapping')

    print('\nWhitespace Score distribution:')
    for s in (0, 25, 50, 75):
        bar = '█' * (score_dist[s] // 5)
        print(f'  {s:>2}: {score_dist[s]:>4}  {bar}')

    # ---- 5. Write back
    with open(SA3_GEOJSON, 'w') as f:
        json.dump(sa3, f, separators=(',', ':'))
    print(f'\n✓ Updated {SA3_GEOJSON}')


if __name__ == '__main__':
    main()
