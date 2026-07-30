# Data Cleanup & Consolidation Checklist

**Last Updated:** May 24, 2026  
**Status:** Ready to implement

---

## ✅ IMMEDIATE ACTIONS (Safe - No Risk)

### 1. Delete Temporary Files
```bash
# These are just logs - safe to delete
rm data/fetch_progress.log
rm data/fetch_progress.log.bak.partial
rm data/scraper.log
rm data/scraper_output.log
rm data/scraper_output.txt
rm data/.DS_Store

# Space saved: ~47 KB
```

### 2. Delete Backup CSVs
```bash
# These are old backups - safe to delete
rm data/clinic_websites_and_reviews.csv.bak.2200rows
rm data/clinic_websites_and_reviews.csv.bak.partial

# Space saved: ~484 KB
```

### 3. Keep Only One UCC Format
```bash
# Keep CSV (smaller, compatible), delete Excel duplicate
rm data/UCC_Directory.xlsx

# Space saved: 23 KB
```

**Total immediate savings: ~554 KB** ✓

---

## ⚠️ HIGH PRIORITY (Requires Verification)

### 4. Clinic Data Consolidation

**Current situation:**
```
Files being USED by scripts:
  ✅ enriched_clinics.csv    - used by 3 scripts, highest quality
  ✅ clinics.csv              - used by 5 scripts, base data

Files NOT being used:
  ❌ enriched_clinics_retagged.csv        - 1 script reference, obsolete
  ❌ enriched_clinics_with_gp_data.csv    - not actively used
```

**Action items:**
```bash
# Step 1: Check what each script does
cat scripts/enrich_clinics_archetypes.py | head -30
cat scripts/retag_ownership_from_corporate_chains.py | head -30

# Step 2: Understand the data flow
# Q: Does clinics.csv → enriched_clinics.csv pipeline exist?
# Q: Are these development/test versions?

# Step 3: Verify before deleting
grep -n "enriched_clinics_retagged\|enriched_clinics_with_gp_data" scripts/*.py

# ONLY if confirmed unused:
# rm data/enriched_clinics_retagged.csv        (3.5 MB)
# rm data/enriched_clinics_with_gp_data.csv    (2.9 MB)
# Potential savings: 6.4 MB
```

**⚠️ DO NOT DELETE until you verify:**
- [ ] Check git history - are these recent experiments or old versions?
- [ ] Are these used in any Jupyter notebooks or external tools?
- [ ] Ask: "Why do we have multiple enriched_clinics files?"

---

### 5. GP Mapping Data

**Current situation:**
```
gp_clinic_mapping.csv (595 KB)
├── Used by: scripts/scrape_doctor_pages.py
├── Created earlier in pipeline
└── Status: ACTIVE

gp_attribution.csv (929 KB)
├── Used by: NOTHING (no scripts reference it)
├── Appears to be newer version
└── Status: KEPT but UNUSED
```

**Action items:**
```bash
# Step 1: Understand the difference
head -5 data/gp_clinic_mapping.csv
head -5 data/gp_attribution.csv

# Step 2: Check if gp_attribution is better version
# Q: Does gp_attribution have more complete data?
# Q: Should scripts use gp_attribution instead?

# Step 3: Check git blame
git log --oneline -- data/gp_attribution.csv
git log --oneline -- data/gp_clinic_mapping.csv

# If gp_attribution is truly replacement:
# UPDATE scripts to use gp_attribution
# rm data/gp_clinic_mapping.csv          (595 KB)
# Savings: 595 KB
```

**Status: INVESTIGATE** - Don't delete yet, understand the relationships first.

---

### 6. Geospatial Data Optimization

**Current situation:**
```
SA3_2021_AUST_SHP_GDA2020.zip     (34 MB, compressed)
SA3_2021_AUST_SHP_GDA2020/        (directory, unzipped)
├── Unzipped size: ~34 MB (REDUNDANT)
└── Both exist at same time!

SIMILAR FOR SA2:
SA2_2021_AUST_SHP_GDA2020.zip     (48 MB, compressed)
├── Check if unzipped directory exists too
```

**Action items:**
```bash
# Step 1: Check if unzipped dir is needed
ls -lh data/SA3_2021_AUST_SHP_GDA2020/ | head -20

# Step 2: Find how scripts use shapefiles
grep -r "\.shp\|shapefile" scripts/*.py

# Step 3: Determine if scripts read from .zip or unzipped dir
# Q: Do they use gpd.read_file('path/to/shp')?
# Q: Can they use a .zip directly?

# ONLY if scripts can read .zip directly:
# rm -rf data/SA3_2021_AUST_SHP_GDA2020/     (34 MB saved!)

# Check SA2 too:
du -sh data/SA2_2021_AUST_SHP_GDA2020 2>/dev/null
```

**⚠️ CAREFUL:** Only delete if scripts handle .zip files natively.

**Potential savings: 34-82 MB** 🔥

---

## 🔍 INVESTIGATION NEEDED

### 7. NRA Billing Data (Check for Redundancy)

**Files:**
```
GP NRA by SA3 FY25 + Growth.csv          (1.7 MB)
├── LTM aggregated (Mar-Dec 2025)
└── Status: KEPT

GP NRA SA3 Quarterly.csv                 (1.7 MB)
├── Quarterly breakdown
└── Status: KEPT
```

**Questions to answer:**
```bash
# Q1: Does any script use these files?
grep -r "NRA\|nra" scripts/*.py

# Q2: How are they different?
head -3 data/GP\ NRA\ by\ SA3\ FY25\ +\ Growth.csv
head -3 data/GP\ NRA\ SA3\ Quarterly.csv

# Q3: Can LTM be derived from Quarterly?
# If yes, delete FY25+Growth, keep Quarterly (save 1.7 MB)
# If no, keep both (different data sources)
```

**Action:** ⏸️ Don't delete yet, only if confirmed unused

---

### 8. Workforce Data Duplication (INVESTIGATE)

**Files:**
```
gp_workforce_2020_2025/                  (directory with CSV files)
├── Contains: act.csv, mm1.csv, mm2.csv, mm3.csv, mm4.csv, mm5.csv
└── ~12 months of data?

dataset-gp-workforce-2020-to-2025.xlsx   (490 KB)
├── Excel summary/processed version?
└── Status: UNCLEAR
```

**Questions:**
```bash
# Q1: Is the .xlsx a processed version of the directory data?
# Q2: Are they used for different purposes?
# Q3: Which is authoritative?

# Check:
ls -la data/gp_workforce_2020_2025/
file data/dataset-gp-workforce-2020-to-2025.xlsx

# If .xlsx is derived from directory:
# rm -rf data/gp_workforce_2020_2025/      (UNKNOWN SIZE)
# Keep: dataset-gp-workforce-2020-to-2025.xlsx
```

**Action:** 🔍 Investigate before taking action

---

### 9. Corporate Chain Data

**Current situation:**
```
corporate_clinic_chains.csv         (1.7 KB)
├── Small lookup table
└── Status: KEEP

corporate_chain_csv_exports/        (directory)
├── Multiple CSV files
├── Size: Unknown
└── Status: Check if needed
```

**Action:**
```bash
# Verify what's in this directory
du -sh data/corporate_chain_csv_exports/
ls -la data/corporate_chain_csv_exports/

# Check usage
grep -r "corporate_chain" scripts/*.py
```

---

## 📋 IMPLEMENTATION PLAN

### Phase 1: Easy Cleanup (Today - Low Risk)
```bash
cd /Users/joshting/Desktop/GP\ Intelligence\ Platform/GP\ Platform\ Code

# 1. Delete logs and backups (47 + 484 = 531 KB saved)
rm data/fetch_progress.log*
rm data/scraper*.log data/scraper*.txt
rm data/clinic_websites_and_reviews.csv.bak.*
rm data/.DS_Store

# 2. Delete duplicate format (23 KB saved)
rm data/UCC_Directory.xlsx

# ✅ DONE: ~554 KB freed
```

### Phase 2: Verification (Tomorrow - Do Investigation)
```
Before running Phase 3, answer these questions:

[ ] Clinic data: Are the 3 enriched_clinics* files needed?
    - Check scripts that use them
    - Check recent git commits
    - Check if they're development versions

[ ] GP mapping: Is gp_attribution a replacement for gp_clinic_mapping?
    - Compare data completeness
    - Check which is more recent
    - Update scripts if needed

[ ] Geospatial: Do scripts read .zip or need unzipped directories?
    - Test if geopandas can read from .zip
    - Potentially save 34-82 MB

[ ] NRA data: Are both billing files needed?
    - Check if they're used
    - Verify you can't derive LTM from Quarterly

[ ] Workforce: Is .xlsx derived from directory?
    - Compare content
    - Verify directory can be deleted
```

### Phase 3: Safe Deletions (Once Verified)
```bash
# Only run these after verification above

# Delete clinic duplicates (6.4 MB if confirmed)
# rm data/enriched_clinics_retagged.csv
# rm data/enriched_clinics_with_gp_data.csv

# Delete redundant GP mapping (595 KB if confirmed)
# rm data/gp_clinic_mapping.csv

# Delete shapefile duplicates (34-82 MB if confirmed)
# rm -rf data/SA3_2021_AUST_SHP_GDA2020/
# rm -rf data/SA2_2021_AUST_SHP_GDA2020/
```

---

## 🎯 ESTIMATED SAVINGS

| Phase | Files | Size | Risk |
|-------|-------|------|------|
| Phase 1 (Immediate) | Logs, backups, dupes | 554 KB | ✅ None |
| Phase 2a (Clinic files) | 2 CSV files | 6.4 MB | ⚠️ Medium |
| Phase 2b (GP mapping) | 1 CSV file | 595 KB | ⚠️ Medium |
| Phase 2c (Shapefiles) | 2 directories | 34-82 MB | ⚠️ High |
| Phase 2d (Workforce) | 1 directory | ? KB | ⚠️ Medium |

**Total potential: 41-89 MB** 🚀

---

## 🛡️ SAFETY CHECKLIST

Before deleting ANYTHING:
- [ ] Commit current state to git
- [ ] Create data backup: `zip -r data_backup_$(date +%Y%m%d).zip data/`
- [ ] Run these before/after to verify nothing broke:
  ```bash
  python3 -m http.server 8000
  # Check if app loads at localhost:8000
  # Verify map displays correctly
  ```

---

## ✨ Next Steps

1. **Today:** Run Phase 1 (immediate cleanup)
2. **Tomorrow:** Answer Phase 2 investigation questions
3. **This week:** Run Phase 3 (once verified safe)
4. **Update:** Modify this guide with your findings

