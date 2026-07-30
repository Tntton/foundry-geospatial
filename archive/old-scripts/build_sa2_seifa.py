#!/usr/bin/env python3
"""
Build sa2_seifa.geojson:
  - SA2 polygons from SA2_2021_AUST_SHP_GDA2020.zip
  - SEIFA IRSAD score + decile per SA2 from SA2_SEIFA.csv
  - State name carried through from the shapefile
  - Geometry simplified to ~100 m tolerance (Albers) + 5-dp coords for web

Run from project root after `pip install geopandas pandas`.
"""

import os
import json
import pandas as pd
import geopandas as gpd


SHAPEFILE_ZIP = 'zip://SA2_2021_AUST_SHP_GDA2020.zip'
SEIFA_CSV = 'data/SA2_SEIFA.csv'
OUTPUT = 'data/sa2_seifa.geojson'


def read_seifa():
    """SA2_SEIFA.csv has 6 metadata rows above the data."""
    print(f'Reading {SEIFA_CSV}...')
    df = pd.read_csv(
        SEIFA_CSV,
        skiprows=6,
        header=None,
        usecols=[0, 1, 4, 5, 10],  # SA2 code, name, IRSAD score, IRSAD decile, population
        names=['SA2_CODE', 'SA2_NAME', 'IRSAD_Score', 'IRSAD_Decile', 'Population'],
        dtype={'SA2_CODE': str},
        encoding='latin-1',
    ).dropna(subset=['SA2_CODE'])
    # Strip whitespace + cast numerics
    df['SA2_CODE'] = df['SA2_CODE'].astype(str).str.strip().str.zfill(9)
    df['IRSAD_Score'] = pd.to_numeric(df['IRSAD_Score'], errors='coerce')
    df['IRSAD_Decile'] = pd.to_numeric(df['IRSAD_Decile'], errors='coerce').astype('Int64')
    df['Population'] = pd.to_numeric(df['Population'], errors='coerce').astype('Int64')
    print(f'  ✓ {len(df)} SA2 SEIFA rows')
    return df


def read_polygons():
    print(f'Reading SA2 polygons from {SHAPEFILE_ZIP}...')
    gdf = gpd.read_file(SHAPEFILE_ZIP)
    print(f'  ✓ {len(gdf)} SA2 features ({gdf.crs})')

    # Reproject to Albers (meters) for accurate simplification
    print('Simplifying geometries (100 m tolerance)...')
    gdf_proj = gdf.to_crs('EPSG:3577')
    gdf_proj['geometry'] = gdf_proj.geometry.simplify(
        tolerance=100, preserve_topology=True
    )
    gdf = gdf_proj.to_crs('EPSG:4326')
    return gdf


def main():
    seifa = read_seifa()
    gdf = read_polygons()

    print('Merging SEIFA onto polygons...')
    gdf['SA2_CODE21'] = gdf['SA2_CODE21'].astype(str).str.strip().str.zfill(9)
    merged = gdf.merge(seifa, left_on='SA2_CODE21', right_on='SA2_CODE', how='left')

    missing = merged['IRSAD_Decile'].isna().sum()
    if missing:
        print(f'  ⚠ {missing} SA2 features have no SEIFA data (will appear as null)')

    # Build output GeoJSON manually so we can round coordinates and keep properties tight
    print('Building GeoJSON with 5-dp coordinates...')

    def round_coords(coords, p=5):
        if isinstance(coords[0], (list, tuple)):
            return [round_coords(c, p) for c in coords]
        return [round(c, p) for c in coords]

    features = []
    for _, row in merged.iterrows():
        if row.geometry is None or row.geometry.is_empty:
            continue
        geom = json.loads(json.dumps(row.geometry.__geo_interface__))
        geom['coordinates'] = round_coords(geom['coordinates'], 5)

        decile = row['IRSAD_Decile']
        score = row['IRSAD_Score']
        pop = row['Population']
        feature = {
            'type': 'Feature',
            'geometry': geom,
            'properties': {
                'SA2Code': row['SA2_CODE21'],
                'SA2Name': row['SA2_NAME21'],
                'State': row['STE_NAME21'],
                'SA3Code': row['SA3_CODE21'],
                'IRSAD_Score': int(score) if pd.notna(score) else None,
                'IRSAD_Decile': int(decile) if pd.notna(decile) else None,
                'Population': int(pop) if pd.notna(pop) else None,
            },
        }
        features.append(feature)

    out = {'type': 'FeatureCollection', 'features': features}

    with open(OUTPUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))

    size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
    print(f'\n✓ Wrote {OUTPUT} ({len(features)} features, {size_mb:.2f} MB)')

    # Decile distribution sanity check
    deciles = pd.Series([f['properties']['IRSAD_Decile'] for f in features])
    print('\nIRSAD decile distribution:')
    for d in range(1, 11):
        n = int((deciles == d).sum())
        bar = '█' * (n // 20)
        print(f'  Decile {d:>2}: {n:>4}  {bar}')
    print(f'  (n/a)   : {int(deciles.isna().sum()):>4}')


if __name__ == '__main__':
    main()
