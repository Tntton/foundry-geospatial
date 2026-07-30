#!/usr/bin/env python3
"""
Market Data Preparation Script

Prepares clinic data for a market by:
1. Validating against market schema
2. Adding SA3 mappings if missing
3. Normalizing field names
4. Generating market_config.json

Usage:
  python3 prepare_market_data.py <market_name>

Example:
  python3 prepare_market_data.py physio
"""

import json
import pandas as pd
from shapely.geometry import Point, shape
import sys

def load_schema():
    """Load the market schema"""
    with open('data/market-schema.json') as f:
        return json.load(f)

def prepare_market_data(market_name):
    """Prepare data for a market"""
    schema = load_schema()
    
    if market_name not in schema['markets']:
        print(f"Error: Market '{market_name}' not found in schema")
        return False
    
    market_def = schema['markets'][market_name]
    csv_path = market_def['csv_file']
    
    print(f"Preparing data for {market_name}...")
    print(f"  CSV: {csv_path}")
    
    # Load CSV
    df = pd.read_csv(csv_path)
    print(f"  Loaded {len(df)} clinics")
    
    # Check for SA3 mapping
    if 'sa3_code' not in df.columns or df['sa3_code'].isna().sum() > len(df) * 0.9:
        print("  Adding SA3 mappings...")
        df = add_sa3_mappings(df, market_def)
        df.to_csv(csv_path, index=False)
        print(f"    Saved to {csv_path}")
    else:
        print("  SA3 mappings already present")
    
    # Generate market_config.json
    generate_market_config(market_name, market_def)
    print("  Generated market_config.json")
    
    print(f"✓ {market_name} data preparation complete")
    return True

def add_sa3_mappings(df, market_def):
    """Add SA3 code and name mappings via point-in-polygon"""
    with open('data/shared/geographic/processed/sa3_scored.geojson') as f:
        sa3_data = json.load(f)
    
    sa3_polys = []
    for feature in sa3_data['features']:
        try:
            poly = shape(feature['geometry'])
            sa3_code = feature['properties'].get('SA3Code')
            sa3_name = feature['properties'].get('SA3Name')
            sa3_polys.append((sa3_code, sa3_name, poly))
        except:
            pass
    
    # Get latitude/longitude column names from schema
    schema = load_schema()
    lat_col = None
    lon_col = None
    for canonical, csv_col in market_def['canonical_fields'].items():
        if canonical == 'latitude':
            lat_col = csv_col
        elif canonical == 'longitude':
            lon_col = csv_col
    
    if not lat_col or not lon_col:
        print("    Error: Could not find latitude/longitude columns")
        return df
    
    results = {'sa3_code': [], 'sa3_name': []}
    matched = 0
    
    for _, row in df.iterrows():
        try:
            lat = float(row[lat_col])
            lon = float(row[lon_col])
            point = Point(lon, lat)
            
            sa3_code = None
            sa3_name = None
            for code, name, poly in sa3_polys:
                try:
                    if poly.contains(point):
                        sa3_code = code
                        sa3_name = name
                        matched += 1
                        break
                except:
                    pass
            
            results['sa3_code'].append(sa3_code)
            results['sa3_name'].append(sa3_name)
        except:
            results['sa3_code'].append(None)
            results['sa3_name'].append(None)
    
    df['sa3_code'] = results['sa3_code']
    df['sa3_name'] = results['sa3_name']
    
    print(f"    Matched {matched}/{len(df)} clinics to SA3 regions")
    return df

def generate_market_config(market_name, market_def):
    """Generate market_config.json from schema"""
    config = {
        "market_id": market_name,
        "market_name": market_def['name'],
        "colors": {
            "tier1": "#0066CC",
            "tier2": "#3385E6",
            "tier3": "#66A3FF",
            "tier4": "#99CCFF",
            "tier5": "#CCE5FF"
        },
        "ownership_colors": {
            "Corporate": "#0066CC",
            "Independent": "#3385E6",
            "NGO": "#9A9A9A"
        },
        "scoring": {
            "pillars": ["demand", "supply", "competition", "economics"],
            "weights": {
                "demand": 30,
                "supply": 35,
                "competition": 20,
                "economics": 15
            }
        },
        "clinics_file": market_def['csv_file'],
        "clinic_fields": {}
    }
    
    # Build clinic_fields from canonical_fields
    for canonical, csv_col in market_def['canonical_fields'].items():
        if csv_col is not None:
            config['clinic_fields'][canonical] = csv_col
    
    # Write config
    market_dir = f"data/markets/{market_name}"
    config_path = f"{market_dir}/market_config.json"
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python3 prepare_market_data.py <market_name>")
        sys.exit(1)
    
    market_name = sys.argv[1]
    success = prepare_market_data(market_name)
    sys.exit(0 if success else 1)
