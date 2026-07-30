# Folder Reorganization Summary

**Date:** May 24, 2026  
**Status:** ✅ Complete - App tested and working

## What Was Done

Your folder has been reorganized for better navigation and maintainability. All files are now organized into logical groups instead of cluttering the root directory.

### New Folder Structure

```
GP Platform Code/
├── index.html           # Main app entry point
├── app.js               # Application logic
├── right-rail.js        # UI component
├── styles.css           # Styling
├── README.md            # Documentation
│
├── data/                # All data files and raw datasets
│   ├── sa3_scored.geojson           (Production - SA3 scoring data)
│   ├── enriched_clinics.csv         (Production - clinic locations)
│   ├── sa3_raw.csv                  (Production - underlying metrics)
│   ├── mmm_benchmark.json           (Production - benchmark data)
│   ├── sa2_seifa.geojson            (Production - SEIFA data)
│   ├── SA3_2021_AUST_SHP_GDA2020/   (Shapefiles)
│   ├── gp_workforce_2020_2025/      (Workforce data)
│   ├── corporate_chain_csv_exports/ (Corporate data)
│   ├── *.xlsx, *.csv, *.zip         (Raw reference data)
│   └── ... (59 files total)
│
├── scripts/             # All Python processing and utility scripts
│   ├── merge_sa3_data.py
│   ├── enrich_sa3.py
│   ├── enrich_sa3_billings.py
│   ├── enrich_sa3_workforce.py
│   ├── optimize_geojson.py
│   ├── scrape_*.py
│   └── ... (25 Python files)
│
├── docs/                # Documentation and guides
│   ├── GOOGLE_PLACES_SETUP_GUIDE.md
│   ├── KEYWORD_EXTRACTION_GUIDE.md
│   ├── ARCHETYPE_FRONTEND_PLAN.md
│   ├── PIPELINE_STATUS.md
│   └── ... (6 guide files)
│
└── Plans/               # Project plans (existing structure maintained)
```

## What Changed

### 1. **app.js** - Updated data file paths
- Modified `getFileUrl()` function to reference `/data/` folder
- All data fetches now use: `getFileUrl('filename')` → `data/filename`
- Files affected:
  - `sa3_scored.geojson`
  - `enriched_clinics.csv`
  - `sa3_raw.csv`
  - `mmm_benchmark.json`
  - `sa2_seifa.geojson`

### 2. **Python scripts** - Updated file paths
- Updated ~25 Python scripts to reference files in the `/data/` folder
- Added `data/` prefix to all file references:
  - CSV files: `'data/clinics.csv'`, `'data/sa3_raw.csv'`, etc.
  - Shapefiles: `'data/SA3_2021_AUST_SHP_GDA2020/...'`
  - All other data files

### 3. **Folder Moves**
- ✅ Moved all data files to `/data` (59 files)
- ✅ Moved all Python scripts to `/scripts` (25 files)
- ✅ Moved all documentation to `/docs` (6 guide files)
- ✅ Removed clutter from root directory

## Testing

✅ **App verification:** The app loads correctly and displays:
- All 336 SA3 regions as choropleth
- 6,981 clinic locations
- All interactive features (filters, lenses, search)
- No console errors
- All data files loading from `/data/` folder (HTTP 200)

## How to Use

### Running the App
```bash
cd /Users/joshting/Desktop/GP\ Intelligence\ Platform/GP\ Platform\ Code
python3 -m http.server 8000
# Open http://localhost:8000
```

### Running Python Scripts
All scripts should be run from the root directory:
```bash
cd /Users/joshting/Desktop/GP\ Intelligence\ Platform/GP\ Platform\ Code
python3 scripts/merge_sa3_data.py
python3 scripts/enrich_sa3.py
# etc.
```

## Files in Root Directory

Only essential files remain in the root:
- `index.html` - Main HTML page
- `app.js` - Application logic (183 KB)
- `right-rail.js` - UI component
- `styles.css` - Styling (98 KB)
- `README.md` - Project documentation

## Backup Notes

- No files were deleted; all were moved to organized folders
- Original file functionality preserved
- Python scripts automatically reference the new `/data/` paths
- App routes all data requests through `/data/` folder

## Next Steps

If you add new files in the future:
- **Raw data files** → `/data/`
- **Python scripts** → `/scripts/`
- **Documentation** → `/docs/`
- **App files** (HTML/JS/CSS) → root directory

---

If you run into any issues with file paths, check:
1. Are you running scripts from the root directory?
2. Do the files exist in `/data/`?
3. Check app console (F12) for any 404 errors
