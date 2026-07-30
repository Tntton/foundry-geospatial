#!/usr/bin/env python3
"""
Assign SA3 regions to clinic data based on latitude/longitude coordinates.

Usage:
    python3 assign_sa3_to_clinics.py <clinics_csv> <output_csv>

Example:
    python3 assign_sa3_to_clinics.py data/markets/dental/dental_clinics.csv data/markets/dental/dental_clinics_with_sa3.csv

This script:
1. Reads clinic CSV with latitude/longitude columns
2. Loads SA3 GeoJSON boundaries
3. Uses point-in-polygon lookup to match each clinic to an SA3 region
4. Writes output CSV with added columns: sa3_code, sa3_name, sa3_state
"""

import sys
import json
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point, shape

def load_sa3_geometries(geojson_path):
    """Load SA3 GeoJSON and extract geometries."""
    print(f"Loading SA3 GeoJSON from {geojson_path}...")
    with open(geojson_path, 'r') as f:
        geojson = json.load(f)

    geometries = []
    for feature in geojson['features']:
        geom = shape(feature['geometry'])
        props = feature['properties']
        geometries.append({
            'geometry': geom,
            'sa3_code': str(props.get('SA3_CODE21', '')).strip(),
            'sa3_name': props.get('SA3Name', ''),
            'sa3_state': props.get('State', '')
        })

    print(f"✓ Loaded {len(geometries)} SA3 regions")
    return geometries

def assign_sa3_to_clinics(clinics_df, sa3_geometries):
    """Match clinic points to SA3 regions using point-in-polygon."""
    print(f"Matching {len(clinics_df)} clinics to SA3 regions...")

    matched = 0
    unmatched = 0

    # Add SA3 columns
    clinics_df['sa3_code'] = ''
    clinics_df['sa3_name'] = ''
    clinics_df['sa3_state'] = ''

    for idx, row in clinics_df.iterrows():
        if idx % 1000 == 0:
            print(f"  Processed {idx}/{len(clinics_df)}...")

        try:
            lat = float(row['latitude'])
            lon = float(row['longitude'])
        except (ValueError, TypeError):
            unmatched += 1
            continue

        # Create point
        point = Point(lon, lat)

        # Find matching SA3
        for sa3 in sa3_geometries:
            if sa3['geometry'].contains(point):
                clinics_df.at[idx, 'sa3_code'] = sa3['sa3_code']
                clinics_df.at[idx, 'sa3_name'] = sa3['sa3_name']
                clinics_df.at[idx, 'sa3_state'] = sa3['sa3_state']
                matched += 1
                break
        else:
            unmatched += 1

    print(f"✓ Matched {matched} clinics, {unmatched} unmatched")
    return clinics_df

def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <clinics_csv> <output_csv>")
        print("")
        print("Example:")
        print(f"  {sys.argv[0]} data/markets/dental/dental_clinics.csv data/markets/dental/dental_clinics_with_sa3.csv")
        sys.exit(1)

    clinics_path = sys.argv[1]
    output_path = sys.argv[2]
    geojson_path = 'data/shared/geographic/processed/sa3_scored.geojson'

    try:
        # Load clinics
        print(f"Loading clinics from {clinics_path}...")
        clinics_df = pd.read_csv(clinics_path)
        print(f"✓ Loaded {len(clinics_df)} clinics")

        # Check required columns
        if 'latitude' not in clinics_df.columns or 'longitude' not in clinics_df.columns:
            print("Error: CSV must have 'latitude' and 'longitude' columns")
            sys.exit(1)

        # Load SA3 geometries
        sa3_geometries = load_sa3_geometries(geojson_path)

        # Assign SA3 codes
        clinics_df = assign_sa3_to_clinics(clinics_df, sa3_geometries)

        # Write output
        print(f"Writing output to {output_path}...")
        clinics_df.to_csv(output_path, index=False)
        print(f"✓ Done!")
        print("")
        print("Summary:")
        print(f"  Total clinics: {len(clinics_df)}")
        print(f"  With SA3 code: {(clinics_df['sa3_code'] != '').sum()}")
        print(f"  Without SA3 code: {(clinics_df['sa3_code'] == '').sum()}")

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
