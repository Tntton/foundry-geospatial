#!/usr/bin/env python3
"""
Merge SA3 shapefile boundaries with scoring data and export as GeoJSON.
"""

import geopandas as gpd
import pandas as pd

def clean_percentage(val):
    """Convert percentage strings to float (0-100)."""
    if pd.isna(val) or val == '':
        return None
    if isinstance(val, str):
        val = val.replace('%', '').strip()
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

def main():
    # Read shapefile
    print("Reading SA3 shapefile...")
    gdf = gpd.read_file('data/SA3_2021_AUST_SHP_GDA2020/SA3_2021_AUST_GDA2020.shp')
    print(f"  ✓ Loaded {len(gdf)} SA3 regions")

    # Read scores CSV
    print("Reading scores CSV...")
    scores_df = pd.read_csv('sa3_scores.csv', encoding='latin-1')
    print(f"  ✓ Loaded {len(scores_df)} records")

    # Clean and convert score columns from percentages to 0-100 scale
    score_columns = {
        'Demand Score (0Ð100)': 'Demand_Score',
        'Supply Score (0Ð100)': 'Supply_Score',
        'Competition Score (0Ð100)': 'Competition_Score',
        'Economics Score (0Ð100)': 'Economics_Score',
    }

    for csv_col, new_col in score_columns.items():
        if csv_col in scores_df.columns:
            scores_df[new_col] = scores_df[csv_col].apply(clean_percentage)
            print(f"  ✓ Processed {new_col}")

    # Clean Composite Score
    scores_df['Composite_Score'] = scores_df['Composite Score'].apply(clean_percentage)

    # Rename SA3 Code column for matching
    scores_df['SA3_CODE21'] = scores_df['SA3 Code'].astype(str).str.zfill(5)

    # Merge with shapefile
    print("\nMerging data...")
    gdf['SA3_CODE21'] = gdf['SA3_CODE21'].astype(str).str.zfill(5)
    merged = gdf.merge(
        scores_df[['SA3_CODE21', 'Demand_Score', 'Supply_Score', 'Competition_Score', 'Economics_Score', 'Composite_Score', 'Tier (1Ð5)']],
        on='SA3_CODE21',
        how='left'
    )

    print(f"  ✓ Merged {len(merged)} features")

    # Filter to only rows with scoring data
    merged_scored = merged[merged['Composite_Score'].notna()].copy()

    # Rename columns for cleaner output
    merged_scored = merged_scored.rename(columns={
        'SA3_CODE21': 'SA3Code',
        'SA3_NAME21': 'SA3Name',
        'STE_NAME21': 'State',
        'Tier (1Ð5)': 'Tier'
    })

    # Round numeric columns
    for col in ['Demand_Score', 'Supply_Score', 'Competition_Score', 'Economics_Score', 'Composite_Score']:
        merged_scored[col] = merged_scored[col].fillna(0).astype(float).round(2)

    merged_scored['Tier'] = merged_scored['Tier'].fillna(3).astype(int)

    # Select only needed columns
    cols_to_keep = ['SA3Code', 'SA3Name', 'State', 'Demand_Score', 'Supply_Score',
                    'Competition_Score', 'Economics_Score', 'Composite_Score', 'Tier', 'geometry']
    merged_scored = merged_scored[cols_to_keep]

    print(f"  ✓ Filtered to {len(merged_scored)} regions with scores")

    # Save to worktree directory
    output_path = '.claude/worktrees/bold-snyder-3bdcc2/sa3_scored.geojson'
    merged_scored.to_file(output_path, driver='GeoJSON')

    print(f"\n✓ Saved to {output_path}")

    # Print summary
    tier_counts = merged_scored['Tier'].value_counts().sort_index()
    print("\nTier distribution:")
    for tier in tier_counts.index:
        print(f"  Tier {int(tier)}: {int(tier_counts[tier])} regions")

    print(f"\nTotal regions with scores: {len(merged_scored)}")
    print("Ready to use with index.html!")

if __name__ == "__main__":
    main()
