#!/usr/bin/env python3
"""
Fetch 15-minute drive-time isochrones from Mapbox API for clinic coordinates.

Usage:
    python3 fetch_isochrones.py <market> <clinics_csv>

Example:
    python3 fetch_isochrones.py physio data/markets/physio/physio_clinics.csv
    python3 fetch_isochrones.py dental data/markets/dental/dental_clinics.csv

This script:
1. Reads clinic CSV with latitude/longitude columns
2. Fetches 15-min drive-time isochrone from Mapbox API for each clinic
3. Saves each isochrone as isochrone_{clinic_id}.geojson in data/markets/{market}/isochrones/
"""

import sys
import json
import os
import time
import pandas as pd
import requests

MAPBOX_TOKEN = os.environ.get('MAPBOX_TOKEN')
if not MAPBOX_TOKEN:
    print("ERROR: MAPBOX_TOKEN environment variable not set!")
    print("Run: export MAPBOX_TOKEN='pk...'")
    sys.exit(1)
MAPBOX_ISOCHRONE_URL = 'https://api.mapbox.com/isochrone/v1/mapbox/driving/{lon},{lat}'

def validate_isochrone(path):
    """Verify a saved isochrone file is valid GeoJSON with a polygon feature.
    Returns (ok: bool, detail: str)."""
    try:
        with open(path) as f:
            data = json.load(f)
        feats = data.get('features', [])
        if data.get('type') != 'FeatureCollection' or not feats:
            return False, 'no features'
        geom = feats[0].get('geometry', {})
        if geom.get('type') != 'Polygon' or not geom.get('coordinates'):
            return False, f"bad geometry: {geom.get('type')}"
        ring = geom['coordinates'][0]
        return True, f"polygon with {len(ring)} points"
    except Exception as e:
        return False, f"invalid: {e}"


def fetch_isochrone(lon, lat):
    """Fetch 15-minute driving isochrone from Mapbox API."""
    try:
        base = MAPBOX_ISOCHRONE_URL.format(lon=lon, lat=lat)
        url = f"{base}?contours_minutes=15&polygons=true&access_token={MAPBOX_TOKEN}"
        response = requests.get(url)

        if response.status_code == 200:
            return response.json()
        else:
            print(f"  ✗ API error {response.status_code}: {response.text}")
            return None
    except Exception as e:
        print(f"  ✗ Fetch error: {e}")
        return None

def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <market> <clinics_csv>")
        print("")
        print("Example:")
        print(f"  {sys.argv[0]} physio data/markets/physio/physio_clinics.csv")
        sys.exit(1)

    market = sys.argv[1]
    clinics_path = sys.argv[2]
    output_dir = f'data/markets/{market}/isochrones'

    try:
        # Create output directory
        os.makedirs(output_dir, exist_ok=True)
        print(f"Output directory: {output_dir}")

        # Load clinics
        print(f"Loading clinics from {clinics_path}...")
        clinics_df = pd.read_csv(clinics_path)
        print(f"✓ Loaded {len(clinics_df)} clinics")

        # Check for required columns
        has_lat = 'latitude' in clinics_df.columns or 'Lat' in clinics_df.columns
        has_lon = 'longitude' in clinics_df.columns or 'Lon' in clinics_df.columns
        has_id = 'clinic_id' in clinics_df.columns or 'PracticeID' in clinics_df.columns or 'id' in clinics_df.columns

        if not (has_lat and has_lon and has_id):
            print("Error: CSV must have latitude/longitude and ID columns")
            print(f"Found columns: {list(clinics_df.columns)}")
            sys.exit(1)

        # Map column names
        lat_col = 'Lat' if 'Lat' in clinics_df.columns else 'latitude'
        lon_col = 'Lon' if 'Lon' in clinics_df.columns else 'longitude'
        id_col = 'PracticeID' if 'PracticeID' in clinics_df.columns else ('clinic_id' if 'clinic_id' in clinics_df.columns else 'id')

        print(f"Using columns: ID={id_col}, Lat={lat_col}, Lon={lon_col}")
        print("")

        # Fetch isochrones
        success = 0
        failed = 0
        skipped = 0
        last_saved = None  # most recent successfully-saved file (for checkpoint verify)
        total = len(clinics_df)
        CHECKPOINT_EVERY = 200
        # Mapbox Isochrone free tier allows 300 req/min (5/sec). 0.25s = 4/sec,
        # a comfortable margin under the limit.
        REQUEST_DELAY = 0.25

        for idx, row in clinics_df.iterrows():
            clinic_id = row[id_col]
            clinic_name = row.get('clinic_name') or row.get('PracticeName') or row.get('name') or str(clinic_id)

            output_file = f"{output_dir}/isochrone_{clinic_id}.geojson"

            # Skip if already exists
            if os.path.exists(output_file):
                print(f"[{idx+1}/{total}] {clinic_name} — already exists, skipping")
                skipped += 1
                continue

            try:
                lat = float(row[lat_col])
                lon = float(row[lon_col])
            except (ValueError, TypeError):
                print(f"[{idx+1}/{total}] {clinic_name} — invalid coordinates, skipping")
                failed += 1
                continue

            print(f"[{idx+1}/{total}] {clinic_name} ({lat:.4f}, {lon:.4f})...", end=' ')

            iso = fetch_isochrone(lon, lat)

            if iso:
                with open(output_file, 'w') as f:
                    json.dump(iso, f)
                # Verify the file we just wrote is valid before counting it
                ok, detail = validate_isochrone(output_file)
                if ok:
                    print("✓")
                    success += 1
                    last_saved = output_file
                else:
                    print(f"✗ (saved but invalid: {detail})")
                    failed += 1
            else:
                print("✗")
                failed += 1

            # Rate limit (well under Mapbox's 300 req/min ceiling)
            time.sleep(REQUEST_DELAY)

            # Checkpoint: every CHECKPOINT_EVERY clinics, report progress and
            # re-verify the most recent download so we know it's really working.
            if (idx + 1) % CHECKPOINT_EVERY == 0:
                on_disk = len([n for n in os.listdir(output_dir) if n.endswith('.geojson')])
                if last_saved:
                    ok, detail = validate_isochrone(last_saved)
                    verify = f"last file {os.path.basename(last_saved)} → {'OK' if ok else 'FAIL'} ({detail})"
                else:
                    verify = "no new file saved yet"
                print(f"--- CHECKPOINT [{idx+1}/{total}] "
                      f"success={success} failed={failed} skipped={skipped} "
                      f"| on disk={on_disk} | verify: {verify} ---", flush=True)

        print("")
        print("Summary:")
        print(f"  Fetched: {success}")
        print(f"  Failed: {failed}")
        print(f"  Skipped (already exist): {skipped}")
        print(f"  Total: {len(clinics_df)}")

        if success > 0:
            print(f"\n✓ Isochrones saved to {output_dir}/")

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
