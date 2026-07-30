#!/usr/bin/env python3
"""
Optimize sa3_scored.geojson for web delivery:
- Simplify polygon geometries (reduce vertices)
- Round coordinates to 5 decimal places (~1 meter precision)
- Drop unnecessary properties
"""

import geopandas as gpd
import pandas as pd
import json
import os

def clean_percentage(val):
    if pd.isna(val) or val == '':
        return None
    if isinstance(val, str):
        val = val.replace('%', '').strip()
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

def main():
    print("Reading SA3 shapefile...")
    gdf = gpd.read_file('data/SA3_2021_AUST_SHP_GDA2020/SA3_2021_AUST_GDA2020.shp')
    print(f"  ✓ Loaded {len(gdf)} SA3 regions")

    print("Reading scores CSV...")
    scores_df = pd.read_csv('sa3_scores.csv', encoding='latin-1')

    score_columns = {
        'Demand Score (0Ð100)': 'Demand_Score',
        'Supply Score (0Ð100)': 'Supply_Score',
        'Competition Score (0Ð100)': 'Competition_Score',
        'Economics Score (0Ð100)': 'Economics_Score',
    }
    for csv_col, new_col in score_columns.items():
        if csv_col in scores_df.columns:
            scores_df[new_col] = scores_df[csv_col].apply(clean_percentage)
    scores_df['Composite_Score'] = scores_df['Composite Score'].apply(clean_percentage)
    scores_df['SA3_CODE21'] = scores_df['SA3 Code'].astype(str).str.zfill(5)

    print("Merging...")
    gdf['SA3_CODE21'] = gdf['SA3_CODE21'].astype(str).str.zfill(5)
    merged = gdf.merge(
        scores_df[['SA3_CODE21', 'Demand_Score', 'Supply_Score', 'Competition_Score',
                   'Economics_Score', 'Composite_Score', 'Tier (1Ð5)']],
        on='SA3_CODE21',
        how='left'
    )

    merged_scored = merged[merged['Composite_Score'].notna()].copy()
    print(f"  ✓ {len(merged_scored)} regions with scores")

    # Reproject to a projected CRS for accurate simplification (meters), then back to WGS84
    print("Simplifying geometries (tolerance: ~100m)...")
    merged_scored_projected = merged_scored.to_crs('EPSG:3577')  # GDA94 Albers (meters)
    # Simplify with 100m tolerance — preserves shape, drops detail
    merged_scored_projected['geometry'] = merged_scored_projected.geometry.simplify(
        tolerance=100, preserve_topology=True
    )
    merged_scored = merged_scored_projected.to_crs('EPSG:4326')  # back to lon/lat

    # Rename columns
    merged_scored = merged_scored.rename(columns={
        'SA3_CODE21': 'SA3Code',
        'SA3_NAME21': 'SA3Name',
        'STE_NAME21': 'State',
        'Tier (1Ð5)': 'Tier'
    })

    for col in ['Demand_Score', 'Supply_Score', 'Competition_Score', 'Economics_Score', 'Composite_Score']:
        merged_scored[col] = merged_scored[col].fillna(0).astype(float).round(2)
    merged_scored['Tier'] = merged_scored['Tier'].fillna(3).astype(int)

    cols_to_keep = ['SA3Code', 'SA3Name', 'State', 'Demand_Score', 'Supply_Score',
                    'Competition_Score', 'Economics_Score', 'Composite_Score', 'Tier', 'geometry']
    merged_scored = merged_scored[cols_to_keep]

    # Build GeoJSON manually with rounded coordinates
    print("Building GeoJSON with rounded coordinates (5 decimal places)...")

    def round_coords(coords, precision=5):
        if isinstance(coords[0], (list, tuple)):
            return [round_coords(c, precision) for c in coords]
        return [round(c, precision) for c in coords]

    features = []
    for _, row in merged_scored.iterrows():
        geom = row.geometry.__geo_interface__
        geom['coordinates'] = round_coords(geom['coordinates'], 5)

        feature = {
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "SA3Code": row['SA3Code'],
                "SA3Name": row['SA3Name'],
                "State": row['State'],
                "Demand_Score": row['Demand_Score'],
                "Supply_Score": row['Supply_Score'],
                "Competition_Score": row['Competition_Score'],
                "Economics_Score": row['Economics_Score'],
                "Composite_Score": row['Composite_Score'],
                "Tier": int(row['Tier'])
            }
        }
        features.append(feature)

    geojson = {"type": "FeatureCollection", "features": features}

    # Save without indentation to minimize file size
    output_path = '.claude/worktrees/bold-snyder-3bdcc2/sa3_scored.geojson'
    with open(output_path, 'w') as f:
        json.dump(geojson, f, separators=(',', ':'))

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"\n✓ Saved {len(features)} regions to {output_path}")
    print(f"  File size: {size_mb:.2f} MB (was 133 MB)")

if __name__ == "__main__":
    main()
