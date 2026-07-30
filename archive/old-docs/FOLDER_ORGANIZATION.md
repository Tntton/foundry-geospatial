# Folder Organization — GP Clinic Investment Map

**Last Updated:** June 7, 2026  
**Status:** ✅ Clean & Optimized

---

## 📁 Project Structure

```
gp-clinic-map/
├── index.html                 # Main app (Mapbox GL, Turf.js, PapaParse CDN)
├── app.js                     # Core app logic (6.2KB, 6,264 lines)
├── right-rail.js             # Right panel logic (489 lines)
├── targets-tab.js            # Targets view module (640 lines)
├── styles.css                # Main styling (113 KB)
├── targets-tab.css           # Targets view styling (9.2 KB)
├── .claude/                   # Claude Code configuration
│   ├── launch.json           # Dev server config
│   └── settings.local.json   # Local settings
├── data/                      # All data files (organized by type)
│   ├── geographic/           # Spatial data (SA1, SA2, SA3, isochrones)
│   ├── clinics/              # Clinic-specific data (locations, websites, reviews)
│   ├── workforce/            # GP workforce supply data
│   ├── government/           # Government regulatory data
│   └── logs/                 # Processing logs
├── scripts/                   # Data processing & utility scripts
│   ├── [enrich_*.py]         # SA3/clinic/billing enrichment
│   ├── [scrape_*.py]         # Website scraping utilities
│   ├── [csv_viewer*.py]      # Data inspection tools
│   └── [other utilities]     # Duplicate fixer, URL editor, etc.
├── docs/                      # Documentation & guides
└── Plans/                     # Implementation plans

```

---

## 🎯 Core App Files (Root Level)

**Served to Browser (CDN Only)**
- `index.html` — Single-page app (121 KB, gzipped ~20 KB)
- `app.js` — Main application logic
- `right-rail.js` — Right sidebar (clinic details)
- `targets-tab.js` — Targets view module
- `styles.css` — Main stylesheet
- `targets-tab.css` — Targets view styles

**Why Root?** These 6 files are the **complete web app**. All dependencies (Mapbox GL, PapaParse, Turf.js) come from CDN. No build step, no bundler.

---

## 📊 Data Files (data/ folder)

### data/geographic/
Spatial boundaries, isochrones, mappings

**Key Files:**
- `sa3_scored.geojson` (4.6 MB) — 336 SA3 regions with composite scores
- `sa2_seifa.geojson` (7.2 MB) — SA2 boundaries with SEIFA deciles
- `sa3_raw.csv` — Raw SA3 scoring data
- `mmm_benchmark.json` — MMM class benchmarks
- `sa1_centroids_pop.csv` (2.3 MB) — SA1 population (optimized, was 411 MB)
- `isochrone_*.geojson` — Pre-computed isochrones for 7,845 clinics
- `SA3-21_MMM-23_mapping.csv` — SA3 ↔ MMM class mapping
- `SA_Mapping.csv` — Geographic hierarchy codes

**Status:** ✅ Clean (removed 411MB uncompressed SA1 GeoJSON)

### data/clinics/
Clinic locations, websites, ownership classification

**Key Files:**
- `Master Sheet/comprehensive_clinic_database.csv` (3.5 MB)
  - 7,880 clinics with location, ownership, format, billing, website, reviews, GP data
- `Scrape Results/clinic_websites_and_reviews.csv` — Google Places data
- `Corporate Only/` — Corporate chain analysis
- `Archive/` — Historical versions

### data/workforce/
GP workforce supply & FTE data

- `dataset-gp-workforce-2020-to-2025.xlsx` — Historical (4.2 MB)
- `gp_attribution.csv` — GP ↔ clinic assignments
- `gp_workforce_2020_2025/` — Extracted CSVs by state/MMM class

### data/government/
Government regulatory & statistical data

- `GP NRA SA3 Quarterly.csv` — National Register of Accredited GPs
- `medicare-quarterly-statistics.xlsx` — Medicare utilization data
- `UCC_Directory.csv` — Urgent Care Centre directory

---

## 🔧 Scripts (scripts/ folder)

### Data Enrichment Pipeline
- `enrich_sa3.py` — Enrich SA3 with clinic metrics
- `enrich_clinics_archetypes.py` — Classify clinic format & billing
- `enrich_sa3_billings.py` — Billing model analytics
- `enrich_sa3_workforce.py` — Workforce supply scoring

### Data Fetching & Processing
- `fetch_clinic_websites_with_reviews.py` — Google Places API
- `comprehensive_clinic_match.py` — Clinic ID matching
- `identify_and_match_corporate.py` — Corporate chain tagging
- `consolidate_and_complete_match.py` — Data consolidation

### Utilities
- `csv_viewer_eastbrooke.py` — Inspect clinic data
- `duplicate_url_fixer.py` — Fix duplicate website URLs
- `url_editor.py` — Manual URL editing tool
- `scrape_*.py` — Website scraping (IPN, Medicross, MyHealth, Sonic, TopHealth)

---

## 🔗 File References in Code

### app.js pathMap (Data Loading)
```javascript
const pathMap = {
    'sa3_scored.geojson': 'data/geographic/sa3_scored.geojson',
    'comprehensive_clinic_database.csv': 'data/clinics/Master Sheet/comprehensive_clinic_database.csv',
    'sa3_raw.csv': 'data/geographic/sa3_raw.csv',
    'mmm_benchmark.json': 'data/geographic/mmm_benchmark.json',
    'sa2_seifa.geojson': 'data/geographic/sa2_seifa.geojson',
    'sa1_centroids_pop.csv': 'data/geographic/sa1_centroids_pop.csv'
};
```

**Status:** ✅ Clean (removed dead references to `sa1_2021_boundaries.geojson` and unused `sa1_census_g01.csv`)

### Direct Isochrone Fetches
```javascript
const response = await fetch(`data/geographic/isochrone_${clinic.clinic_id}.geojson`);
```

---

## ✅ Recent Optimizations

### June 7, 2026
1. **Removed 411MB SA1 GeoJSON** — Replaced with 2.3MB pre-baked centroid CSV
2. **Cleaned pathMap** — Removed unused `sa1_2021_boundaries.geojson` reference
3. **Organized root directory** — Moved 10 utility scripts to `scripts/` folder
4. **Verified app functionality** — All features working, no console errors

### Git History Clean
- Used `git filter-branch` to remove large file from history
- Force-pushed cleaned `feat/isochrone-comparison` branch

---

## 🚀 Running the App

```bash
# Start local server
python3 -m http.server 8000

# Open in browser
http://localhost:8000
```

**Why Python HTTP server?** All data is local. No API backend needed. Single static HTML file + data files.

---

## 📋 Data Loading Flow

```
index.html
  ↓
  app.js (loads via getFileUrl)
  ├─ fetch('data/geographic/sa3_scored.geojson')        → SA3 choropleth
  ├─ fetch('data/clinics/.../comprehensive_clinic_database.csv')  → Clinic pins
  ├─ fetch('data/geographic/sa3_raw.csv')               → Profile card data
  ├─ fetch('data/geographic/mmm_benchmark.json')        → Workforce metrics
  ├─ fetch('data/geographic/sa1_centroids_pop.csv')     → Catchment population
  ├─ fetch('data/geographic/sa2_seifa.geojson')         → SEIFA lens (on demand)
  └─ fetch('data/geographic/isochrone_${id}.geojson')   → Clinic catchment
```

---

## 🔍 No Broken References

All file paths verified:
- ✅ All fetched files exist
- ✅ All pathMap entries are used in code
- ✅ No 404 errors in console
- ✅ App loads and displays data correctly
- ✅ Isochrone comparison feature working

---

## 📝 Notes

- **No build step required** — This is a static HTML app
- **CDN dependencies** — Mapbox GL, PapaParse, Turf.js all from CDN
- **Git history clean** — Large files removed; repository is now ~7MB
- **Scripts folder** — Contains data processing pipeline, not part of web app
- **Data folder** — Served as-is by HTTP server; used by both app and Python scripts

