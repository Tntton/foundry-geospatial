# Data Consolidation & Merge Opportunities

## Overview
Your data folder contains 59 files with significant redundancy and fragmentation. This guide identifies consolidation opportunities to reduce clutter and improve maintainability.

---

## 🎯 Group 1: CLINIC CORE DATA (High Priority - Merge These)

### Current State: **4 versions of clinic data exist**
```
clinics.csv (2.9 MB)
├── Base clinic locations with basic attributes
├── 7,880 clinics
└── Columns: location, ownership, SA2/SA3 codes

enriched_clinics.csv (3.5 MB) ⭐ PRODUCTION VERSION
├── Enriched with: format, billing model, website, reviews
├── Doctor data: unique_gps, total_gp_fte, doctor_names, doctor_count
├── Highest quality version
└── Used by: index.html (fetched as enriched_clinics.csv)

enriched_clinics_retagged.csv (3.5 MB)
├── Re-tagged ownership classification
├── Appears to be a revision/correction of enriched_clinics
└── Status: UNCLEAR - may be outdated

enriched_clinics_with_gp_data.csv (2.9 MB)
├── Similar schema to enriched_clinics but lacking format/billing columns
├── Has doctor_count, doctor_names, total_gp_fte
└── Status: APPEARS INCOMPLETE/REDUNDANT
```

### Recommendation: **CONSOLIDATE TO ONE VERSION**
```
Action: Keep ONLY enriched_clinics.csv (current production)
Delete:
  ✗ clinics.csv                          (3.5 MB saved)
  ✗ enriched_clinics_with_gp_data.csv    (2.9 MB saved)
  ✗ enriched_clinics_retagged.csv        (3.5 MB saved)

Verify before deleting:
  1. Does any Python script import these?
  2. Is enriched_clinics_retagged a deliberate revision? Check git history
  3. Is enriched_clinics_with_gp_data a development version?
```

**Space saved: ~9.9 MB** ✓

---

## 🎯 Group 2: WEBSITE & REVIEW DATA (Medium Priority - Clean Up)

### Current State: **Multiple scrape outputs**
```
clinic_websites_and_reviews.csv (833 KB) ⭐ MAIN FILE
├── 5,336 records with website_url, rating, review_count
├── OBJECTID links to clinic data
└── Used by: enriched_clinics.csv merge

clinic_websites_and_reviews.csv.bak.2200rows (345 KB)
├── Older version with 2,200 clinics (partial)
└── Status: OBSOLETE BACKUP

clinic_websites_and_reviews.csv.bak.partial (139 KB)
├── Very old partial scrape
└── Status: OBSOLETE

clinic_scrape_results.csv (540 KB)
├── Raw scrape output with JSON-like fields
├── Contains: billing_keywords, format_keywords, ownership_keywords
├── doctor_names, doctor_count extracted from websites
└── Status: INTERMEDIATE - appears to feed enriched_clinics
```

### Recommendation: **CONSOLIDATE & CLEAN**
```
Action 1: Merge website/review data into enriched_clinics
  - clinic_websites_and_reviews.csv columns → enriched_clinics.csv
  - These are already there! (website_url, rating, review_count)

Action 2: Delete backup files
  ✗ clinic_websites_and_reviews.csv.bak.2200rows     (345 KB)
  ✗ clinic_websites_and_reviews.csv.bak.partial      (139 KB)

Action 3: Decide on clinic_scrape_results.csv
  ? Keep if it's needed as raw scrape reference for reproducibility
  ? Delete if enriched_clinics already includes all valuable data
  ? Recalculate: Is it ~540 KB worth keeping?
```

**Space saved: 484 KB (if deleting scrape results: 1.0 MB)** ✓

---

## 🎯 Group 3: GP WORKFORCE DATA (High Priority - Clean Up)

### Current State: **Multiple partially overlapping GP datasets**
```
gp_clinic_mapping.csv (595 KB)
├── Maps individual GPs to clinics
├── Columns: GP_ID, GP_Name, Clinic_OBJECTID, FTE, Headcount_At_Clinic
├── ~10K GP-clinic relationships
└── Used by: likely enriched_clinics derivation

gp_attribution.csv (929 KB) ⭐ NEWER VERSION
├── Maps GPs to clinics with attribution
├── Columns: GP_ID, GP_Name, Clinic_OBJECTID, Clinic_Name, Num_Clinics_For_GP
├── ~13K records
└── Status: Appears to be NEWER/BETTER version than gp_clinic_mapping

enriched_clinics columns:
├── unique_gps, total_gp_fte, doctor_names, doctor_count
└── These may be aggregations from above files
```

### Recommendation: **CHOOSE SINGLE SOURCE**
```
Action 1: Determine data lineage
  Q: Is enriched_clinics built FROM gp_clinic_mapping or gp_attribution?
  Q: Which is authoritative? (gp_attribution seems newer)
  Q: Are both needed for different purposes?

Action 2: If both not needed
  ✗ gp_clinic_mapping.csv              (595 KB)
  Keep: gp_attribution.csv             (reference for individual GPs)

Action 3: Rename for clarity (optional)
  Rename: gp_attribution.csv → gp_to_clinic_mapping.csv
```

**Space saved: 595 KB** ✓

---

## 🎯 Group 4: NRA/BILLING DATA (Medium Priority - Consolidate)

### Current State: **Two overlapping billings/NRA files**
```
GP NRA by SA3 FY25 + Growth.csv (1.7 MB)
├── Aggregated National Revenue Assessed (NRA) by SA3
├── LTM (Last Twelve Months) Mar-Dec 2025
├── Note: Contains metadata header rows (skip first ~3 rows)
└── Use: SA3-level billing/revenue metrics

GP NRA SA3 Quarterly.csv (1.7 MB)
├── Quarterly NRA breakdown by SA3
├── More granular than FY25 + Growth
├── Note: Also has metadata header rows
└── Use: SA3-level quarterly trends

Question: Are these both needed?
  - One is LTM aggregated
  - One is quarterly time-series
  - Could be combined into single quarterly dataset
```

### Recommendation: **CONSOLIDATE OR CLARIFY**
```
Option A: Keep quarterly data, derive LTM from it
  ✗ GP NRA by SA3 FY25 + Growth.csv    (redundant aggregation)
  Keep: GP NRA SA3 Quarterly.csv        (can calculate LTM)

Option B: Keep both if different analytical uses
  Keep both if:
    - FY25+Growth contains additional metrics not in Quarterly
    - Performance reasons (pre-aggregated LTM useful)

Recommendation: Review usage
  Search scripts for which file is actually used
  If only one is used in code → delete the other
```

**Space saved: 1.7 MB (if consolidating)** ✓

---

## 🎯 Group 5: LOGS & TEMPORARY FILES (Easy - Delete These)

### Current State: **Scraper/fetch logs and temp files**
```
fetch_progress.log (9.5 KB)
└── Temporary scraper progress tracking

fetch_progress.log.bak.partial (11 KB)
└── Backup of partial fetch

scraper.log (26 KB)
└── Scraper output log

scraper_output.log (0 B)
└── Empty log file

scraper_output.txt (306 B)
└── Tiny text output
```

### Recommendation: **DELETE ALL (Safe to Remove)**
```
✗ fetch_progress.log
✗ fetch_progress.log.bak.partial
✗ scraper.log
✗ scraper_output.log
✗ scraper_output.txt

Status: SAFE TO DELETE - these are logs, not data
Space saved: 47 KB
```

**Space saved: 47 KB** ✓

---

## 🎯 Group 6: REFERENCE/MAPPING DATA (Keep, But Organize)

### Current State: **Multiple SA/geographic mapping files**
```
SA3-21_MMM-23_mapping.csv (15 MB) ⭐ LARGE
├── SA3 to Modified Monash Model (MMM) mapping
├── Includes population/ERP data
├── Used by: enrich_sa3.py
└── Status: KEEP (needed for scoring)

SA_Mapping.csv (480 KB)
├── Generic SA-level mapping (SA2/SA3/SA4)
├── Status: UNCLEAR - may be redundant with above

SA2_SEIFA.csv (705 KB)
├── SA2-level SEIFA index data
├── Used by: geography enrichment
└── Status: KEEP (unique data)

UCC_Directory.csv (23 KB)
UCC_Directory.xlsx (23 KB)
├── University Cooperation Centre directory
├── Duplicated in both CSV and Excel
└── Status: Keep ONE format only

.DS_Store
└── macOS system file - DELETE
```

### Recommendation: **CLEAN UP**
```
Keep: SA3-21_MMM-23_mapping.csv    (essential for scoring)
Keep: SA2_SEIFA.csv                 (SA2 enrichment)
Review: SA_Mapping.csv              (check if used)

Delete:
  ✗ .DS_Store                       (macOS clutter)
  ✗ UCC_Directory.xlsx              (keep CSV only)

Space saved: 23 KB + .DS_Store
```

**Space saved: 23 KB** ✓

---

## 🎯 Group 7: GEOSPATIAL DATA (Large Files - Keep Compressed)

### Current State: **Shapefiles and GeoJSON**
```
SA3_2021_AUST_SHP_GDA2020.zip (34 MB)
├── Shapefile directory also present (unzipped)
├── Use: Point-in-polygon for SA3 assignment
└── Question: Keep both .zip AND unzipped?

SA3_2021_AUST_SHP_GDA2020/ (directory)
├── Extracted shapefiles
└── Status: REDUNDANT if .zip exists

SA2_2021_AUST_SHP_GDA2020.zip (48 MB)
├── SA2 boundary shapefile
├── Used by: SEIFA enrichment
└── Status: KEEP

sa3_scored.geojson (4.6 MB)
└── Production file used by app

sa2_seifa.geojson (7.2 MB)
└── Production file used by app (lazy load)
```

### Recommendation: **OPTIMIZE STORAGE**
```
Action 1: Delete unzipped directory, keep .zip
  ✗ SA3_2021_AUST_SHP_GDA2020/        (delete, reuse .zip)
  
  Space saved: 34 MB ✓
  
  (Scripts should read from .zip directly or unzip on demand)

Action 2: Verify SA2 shapefile usage
  ? Is SA2_2021_AUST_SHP_GDA2020.zip ever unzipped?
  If yes: Apply same strategy

GeoJSON files: KEEP (used by production app)
```

**Space saved: 34+ MB** ✓

---

## 🎯 Group 8: DPA & WORKFORCE DATA (Keep - Check Organization)

### Current State: **Large zip files + structured workforce data**
```
dpa_2020_bonded.zip (45 MB)
├── Deserving Places Assistance program data
├── Doctor Practice Address (DPA) - bonded practitioners
└── Status: KEEP (reference data)

dpa_2020_gp.zip (44 MB)
├── DPA for GPs
└── Status: KEEP (reference data)

gp_workforce_2020_2025/ (directory)
├── Workforce statistics by Australian Medical Board (AMB)
├── Monthly data files (act.csv, mm1-5.csv, etc.)
└── Status: KEEP (time-series data)

dataset-gp-workforce-2020-to-2025.xlsx (490 KB)
├── Possibly summary/processed version of gp_workforce_2020_2025/?
└── Check: Is this derived from the directory above?

Medicare files:
├── medicare-quarterly-statistics-statistical-area-sa3-summary-...xlsx (1.6 MB)
└── Status: KEEP (official government stats)
```

### Recommendation: **VERIFY RELATIONSHIPS**
```
Potential consolidation:
  Q: Is dataset-gp-workforce-2020-to-2025.xlsx a processed version 
     of gp_workforce_2020_2025/?
  
  If YES:
    - Keep only the .xlsx (smaller, processed)
    - Delete gp_workforce_2020_2025/ directory
    - Space saved: TBD (check directory size)
  
  If NO:
    - Keep both (different data sources)

Keep all large zips (DPA files) - these are reference datasets
```

**Space saved: TBD (depends on directory size)**

---

## 📊 SUMMARY OF RECOMMENDATIONS

### Quick Wins (Safe, High Impact)
| Action | Files | Space Saved | Risk |
|--------|-------|-------------|------|
| Delete backup CSVs | clinic_websites_...bak.* | 484 KB | ✅ None |
| Delete logs | fetch_progress.log, scraper.* | 47 KB | ✅ None |
| Delete .DS_Store | .DS_Store | <1 KB | ✅ None |
| Keep ONE UCC format | Delete .xlsx | 23 KB | ✅ Low |
| Delete shapefile dirs | SA3_2021_*/directory | 34 MB | ⚠️ Medium |
| **SUBTOTAL** | | **~519 KB + 34 MB** | |

### Medium Priority (Requires Verification)
| Action | Files | Space Saved | Risk |
|--------|-------|-------------|------|
| Delete redundant clinic CSVs | clinics.csv, enriched_with_gp_data | 6.4 MB | ⚠️ HIGH |
| Choose GP mapping source | gp_clinic_mapping or gp_attribution | 595 KB | ⚠️ MEDIUM |
| Consolidate NRA data | Keep one quarterly+LTM | 1.7 MB | ⚠️ MEDIUM |
| Check workforce dup | dataset-gp vs directory | Unknown | ⚠️ MEDIUM |

### Total Potential Savings: **~43 MB - 50 MB**

---

## 🔍 BEFORE YOU DELETE - DO THIS

```bash
# 1. Check what scripts actually use each file
grep -r "clinics\.csv\|enriched_clinics\|clinic_websites" scripts/

# 2. Check git history for recent changes
git log --oneline --follow -- data/file_name.csv

# 3. Create backup before major deletions
zip -r data_backup_$(date +%Y%m%d).zip data/

# 4. Update this guide with findings
```

---

## 💡 NEXT STEPS

**Priority 1 (This Week):**
- [ ] Delete logs and backups (safe, ~520 KB)
- [ ] Verify which clinic CSV is actually used
- [ ] Consolidate clinic data if possible (~10 MB)
- [ ] Delete unzipped shapefiles if zip exists (~34 MB)

**Priority 2 (Next):**
- [ ] Determine NRA data consolidation strategy
- [ ] Verify GP mapping data relationships
- [ ] Check workforce data duplication

**Priority 3 (Cleanup):**
- [ ] Document final data schema
- [ ] Create data dictionary
- [ ] Update scripts with confirmed paths

