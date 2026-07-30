#!/usr/bin/env python3
"""Enrich sa3_scored.geojson with Workforce fields and recompute Whitespace_Score."""
import json
import geopandas as gpd
from shapely.geometry import shape

# ── Load benchmark ────────────────────────────────────────────────────────────
with open('data/mmm_benchmark.json') as f:
    benchmark = json.load(f)

# ── Load DPA shapefiles ───────────────────────────────────────────────────────
print('Loading DPA shapefiles...')
bonded = gpd.read_file('zip://dpa_2020_bonded.zip')
bonded = bonded[bonded['DPA_Nat'] == 'Y'].to_crs('EPSG:4326')
bonded_union = bonded.unary_union

gp_img = gpd.read_file('zip://dpa_2020_gp.zip')
gp_img = gp_img[gp_img['DPA_MM2'] == 'Y'].to_crs('EPSG:4326')
gp_img_union = gp_img.unary_union

print(f'  Bonded polygons (Y): {len(bonded)}')
print(f'  GP/IMG polygons (Y): {len(gp_img)}')

# ── Normalisation ranges (from benchmark across all 7 MM classes) ─────────────
ftes = [v['gpfte_per_10k'] for v in benchmark.values()]
ages = [v['pct_55plus']    for v in benchmark.values()]
fte_min, fte_max = min(ftes), max(ftes)
age_min, age_max = min(ages), max(ages)

# ── Load + enrich GeoJSON ─────────────────────────────────────────────────────
with open('data/sa3_scored.geojson') as f:
    gj = json.load(f)

dpa_bonded_count = dpa_gpimg_count = 0

for feat in gj['features']:
    p = feat['properties']
    mmm = str(int(p.get('MMM_Dominant') or 1))
    bm  = benchmark.get(mmm, benchmark['1'])

    this_fte = bm['gpfte_per_10k']
    this_pct = bm['pct_55plus']

    # MMM benchmark values
    p['MMM_GPFTE_per_10k']  = round(this_fte, 2)
    p['MMM_Pct_GP_55plus']  = round(this_pct, 2)

    # DPA spatial join
    geom = shape(feat['geometry'])
    is_bonded = bool(geom.intersects(bonded_union))
    is_gpimg  = bool(geom.intersects(gp_img_union))
    p['DPA_Bonded'] = is_bonded
    p['DPA_GP_IMG'] = is_gpimg
    if is_bonded: dpa_bonded_count += 1
    if is_gpimg:  dpa_gpimg_count  += 1

    # Normalise supply (lower FTE → higher risk)
    supply_norm = 100 * (fte_max - this_fte) / (fte_max - fte_min) if fte_max != fte_min else 0
    # Normalise age (higher % → higher risk)
    age_norm    = 100 * (this_pct - age_min) / (age_max - age_min) if age_max != age_min else 0
    # DPA score: both=100, one=50, neither=0
    dpa_score = (100 if (is_bonded and is_gpimg) else 50 if (is_bonded or is_gpimg) else 0)

    workforce_risk = round(0.40 * supply_norm + 0.30 * age_norm + 0.30 * dpa_score)
    p['Workforce_Risk_Score'] = workforce_risk

    # Recompute Whitespace_Score (now 0–100, 4 buckets of 25)
    ws = 0
    if (p.get('Economics_Score') or 0) <= 50:  ws += 25
    if (p.get('Corporate_Share') or 1) < 0.30:  ws += 25
    if (p.get('Demand_Score') or 0) >= 60:       ws += 25
    if workforce_risk >= 60:                      ws += 25
    p['Whitespace_Score'] = ws

print(f'  DPA Bonded SA3s: {dpa_bonded_count}/336')
print(f'  DPA GP/IMG SA3s: {dpa_gpimg_count}/336')

# ── Write back ────────────────────────────────────────────────────────────────
with open('data/sa3_scored.geojson', 'w') as f:
    json.dump(gj, f, separators=(',', ':'))

print('\nWrote sa3_scored.geojson')

# ── Sanity stats ──────────────────────────────────────────────────────────────
scores = [f['properties']['Workforce_Risk_Score'] for f in gj['features']]
ws_scores = [f['properties']['Whitespace_Score'] for f in gj['features']]

print(f'\nWorkforce Risk Score distribution:')
buckets = [(0,20,'0–19'),(20,40,'20–39'),(40,60,'40–59'),(60,80,'60–79'),(80,101,'80+')]
for lo, hi, label in buckets:
    cnt = sum(1 for s in scores if lo <= s < hi)
    print(f'  {label}: {cnt}')

print(f'\nWhitespace Score distribution:')
for v in [0, 25, 50, 75, 100]:
    cnt = sum(1 for s in ws_scores if s == v)
    print(f'  {v}: {cnt}')

# Spot checks
spot = ['Sydney - City and Inner South', 'Outback - North and East', 'Northern Beaches']
for feat in gj['features']:
    if feat['properties']['SA3Name'] in spot:
        p = feat['properties']
        print(f"\n{p['SA3Name']} ({p['State']}):")
        print(f"  MMM={p.get('MMM_Dominant')}, FTE/10k={p.get('MMM_GPFTE_per_10k')}, %55+={p.get('MMM_Pct_GP_55plus')}")
        print(f"  DPA_Bonded={p.get('DPA_Bonded')}, DPA_GP_IMG={p.get('DPA_GP_IMG')}")
        print(f"  Workforce_Risk={p.get('Workforce_Risk_Score')}, Whitespace={p.get('Whitespace_Score')}")
