# GP Clinic Investment Intelligence Map

Geospatial investment intelligence tool for private equity focused on Australian
GP clinic markets. Renders 336 SA3 regions as a choropleth coloured by a
composite score (Demand · Supply · Competition · Economics) and overlays 7,880
clinic locations classified by ownership (Corporate / Independent / Public / NGO).

## Running locally

The app is a single static HTML file. Serve it via any local HTTP server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly via `file://` will not work — the browser blocks
`fetch()` of local files.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The map application (Mapbox GL JS, PapaParse, Turf.js — all CDN) |
| `sa3_scored.geojson` | 336 SA3 polygon boundaries joined with scoring data |
| `clinics.csv` | 7,880 GP clinic locations with ownership type |
| `sa3_raw.csv` | Underlying raw metrics surfaced in the profile-card tabs |
| `sa3_scores.csv` | Source scoring spreadsheet (input to `merge_sa3_data.py`) |
| `SA3_2021_AUST_SHP_GDA2020.zip` | ABS SA3 2021 boundary shapefile |
| `merge_sa3_data.py` | Joins the shapefile + scores CSV → `sa3_scored.geojson` |
| `optimize_geojson.py` | Re-runs the join with geometry simplification for web delivery |

## Features

- **Choropleth** of 336 SA3 regions, coloured Tier 1 (best) → Tier 5 (worst)
- **Clinic pins** (visible from zoom 6+) coloured by ownership type
- **Profile card** with circular composite-score ring, score bars, and tabs
  showing raw demand/supply/competition/economics metrics
- **Adjust weights** panel — slide to re-weight the composite score; the map
  re-colours and tiers recompute on the fly
- **State filter** to focus on one state at a time
- **Summary bar** at the top showing live counts of SA3s shown, Tier 1 + 2
  markets, average composite, and total acquirable (independent) clinics
- **Mobile-optimised** layout — bottom panels stack horizontally

## Mapbox token

The Mapbox token in `index.html` is a public (`pk.*`) token, which is designed
to be exposed in client-side code. For production, set URL restrictions on the
token in the Mapbox dashboard so only your domain can use it.
