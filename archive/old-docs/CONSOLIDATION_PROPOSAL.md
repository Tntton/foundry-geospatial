# Data Consolidation Proposal: Use enriched_clinics.csv as Single Source

**Proposed by:** User insight  
**Date:** May 24, 2026  
**Savings:** 2.9 MB  
**Complexity:** Medium (requires script updates)

---

## 🎯 The Proposal

Instead of maintaining **two clinic data files**:
- `clinics.csv` (2.9 MB) - Base location data
- `enriched_clinics.csv` (3.5 MB) - Enriched with format, billing, website, reviews, GP data

**Use ONLY:**
- `enriched_clinics.csv` (3.5 MB) - Complete superset containing everything

---

## ✅ Why This Works

### enriched_clinics.csv Contains Everything clinics.csv Has:

```
clinics.csv base data:
  ✅ OBJECTID, location (lat/long)
  ✅ Address, suburb, state, postcode
  ✅ Ownership classification
  ✅ Geographic codes (SA2, SA3, SA4)
  ✅ Government service IDs
  
enriched_clinics.csv HAS ALL OF THE ABOVE PLUS:
  ✅ Format (Small/Mid/Big-box) - 100%
  ✅ Billing Model - 100%
  ✅ Ownership Confidence - 100%
  ✅ Website URLs - 56%
  ✅ Google reviews - 68%
  ✅ GP data - 29%
  ✅ Corporate chain - 6%
```

**Result:** No data is lost. enriched_clinics.csv is a **strict superset**.

---

## 🔄 Impact on Scripts

### Current Flow:
```
clinics.csv 
  → enrich_clinics_archetypes.py
  → enrich_sa3.py
  → fetch_clinic_websites_with_reviews.py
enriched_clinics.csv ← outputs from above
  → scrape_doctor_pages.py
  → retag_ownership_from_corporate_chains.py
  → index.html (app)
```

### New Flow:
```
enriched_clinics.csv (SINGLE SOURCE)
  ↓
  ├─→ enrich_sa3.py (just needs location + ownership data)
  ├─→ scrape_doctor_pages.py (just needs location)
  ├─→ retag_ownership_from_corporate_chains.py (just needs ownership + name)
  └─→ index.html (app - already uses this)
```

---

## 📝 Scripts That Would Need Updates

### 1. **enrich_sa3.py** ✅ Easy Update

**Current:**
```python
CLINICS_CSV = 'data/clinics.csv'
clinics = read_clinics()  # reads clinics.csv
# Aggregates ownership by SA3
```

**New:**
```python
CLINICS_CSV = 'data/enriched_clinics.csv'
clinics = read_clinics()  # reads enriched_clinics.csv
# Same aggregation logic (enriched has all location + ownership data)
```

**Change Required:** One line (file path)  
**Risk:** ZERO - enriched has all needed data

---

### 2. **fetch_clinic_websites_with_reviews.py** ✅ Easy Update

**Current:**
```python
INPUT_CSV = "data/clinics.csv"
OUTPUT_CSV = "clinic_websites_and_reviews.csv"
# Reads clinics.csv and fetches website data
```

**New:**
```python
INPUT_CSV = "data/enriched_clinics.csv"
OUTPUT_CSV = "clinic_websites_and_reviews.csv"
# Same logic (enriched has location + OBJECTID needed for fetching)
```

**Change Required:** One line  
**Risk:** ZERO - enriched has OBJECTID + location data

---

### 3. **enrich_clinics_archetypes.py** ⚠️ Moderate Change

**Current Logic:**
```
Reads:
  - clinics.csv (base locations)
  - clinic_websites_and_reviews.csv (scraped reviews)
  - clinic_scrape_results.csv (format/billing keywords)
Outputs:
  - enriched_clinics.csv (with format/billing added)
```

**New Logic Option A (Simplest):**
```
This script becomes obsolete!
Why? enriched_clinics.csv already has format + billing + all the data.

If you need to:
  • Re-enrich from scratch with new methods → keep this script
  • Just use existing enriched data → skip this script
```

**New Logic Option B (If re-enrichment needed):**
```
Reads:
  - enriched_clinics.csv (already has format/billing)
  - New enrichment data (e.g., new classification methods)
Outputs:
  - enriched_clinics.csv (updated with new data)

Change: Update CLINICS_CSV path, adjust logic to MODIFY instead of CREATE
Risk: MEDIUM - need to test that updates don't overwrite good data
```

**Recommendation:** Delete or archive this script (enrichment already done)

---

### 4. **scrape_doctor_pages.py** ✅ No Change Needed

```python
# Already reads enriched_clinics.csv, not clinics.csv
enriched_df = pd.read_csv('data/enriched_clinics.csv')
# Works as-is!
```

---

### 5. **retag_ownership_from_corporate_chains.py** ✅ No Change Needed

```python
# Already reads enriched_clinics.csv, not clinics.csv
INPUT_CLINICS_CSV = "data/enriched_clinics.csv"
# Works as-is!
```

---

## 💾 Consolidation Options

### Option A: Simple Consolidation (Recommended)
```
Delete: clinics.csv
Keep: enriched_clinics.csv
Update: 2 script paths (enrich_sa3.py, fetch_clinic_websites_with_reviews.py)
Archive: enrich_clinics_archetypes.py (no longer needed)
Savings: 2.9 MB
Time: 15 minutes
Risk: LOW
```

### Option B: Keep Both (Current State)
```
Delete: clinics.csv
Keep: enriched_clinics.csv + clinics.csv
Use: enriched_clinics.csv as source
Benefit: Can always regenerate enriched from base if needed
Savings: 0 MB
Risk: NONE (conservative)
```

### Option C: Advanced Consolidation
```
Delete: clinics.csv
Keep: enriched_clinics.csv
Refactor: enrich_clinics_archetypes.py to be "update existing enrichment" script
Benefit: Can add new enrichments without losing old ones
Time: 1-2 hours
Risk: MEDIUM (need to test logic carefully)
```

---

## 🔍 What Gets Lost with Consolidation?

If you delete clinics.csv, you lose:
- ❌ Ability to "start from scratch" enrichment (already done anyway)
- ❌ Original raw clinic data (but enriched has all location/ownership data)

You KEEP:
- ✅ All location data
- ✅ All ownership data
- ✅ All enrichments (format, billing, website, reviews, GP)
- ✅ Ability to add NEW enrichments to existing data

---

## 📊 Impact Analysis

### Current State (Both Files)
```
clinics.csv:            2.9 MB (base location data)
enriched_clinics.csv:   3.5 MB (complete data)
Total:                  6.4 MB
```

### After Consolidation
```
enriched_clinics.csv:   3.5 MB (single source of truth)
Total:                  3.5 MB
Savings:                2.9 MB (45% reduction)
```

---

## ✅ Recommendation

### **Go with Option A (Simple Consolidation)**

**Why:**
1. ✅ Saves 2.9 MB with minimal effort
2. ✅ No loss of data (enriched is superset)
3. ✅ Only 2 script paths need updating
4. ✅ Better pipeline clarity (single source of truth)
5. ✅ Less confusing for future maintenance

**Steps:**
```bash
# 1. Update enrich_sa3.py
#    Change: CLINICS_CSV = 'data/enriched_clinics.csv'

# 2. Update fetch_clinic_websites_with_reviews.py
#    Change: INPUT_CSV = "data/enriched_clinics.csv"

# 3. Test both scripts
python3 scripts/enrich_sa3.py
python3 scripts/fetch_clinic_websites_with_reviews.py

# 4. Delete clinics.csv
rm data/clinics.csv

# 5. Archive enrich_clinics_archetypes.py (no longer needed)
mv scripts/enrich_clinics_archetypes.py scripts/_archive/
```

**Time to implement:** 10 minutes  
**Risk level:** LOW  
**Savings:** 2.9 MB (total cleanup: 9.9 MB)

---

## 🎯 Final Consolidation Totals

**If we do this:**
```
Files Already Deleted:
  ✅ enriched_clinics_retagged.csv    (3.5 MB)
  ✅ enriched_clinics_with_gp_data.csv (2.9 MB)
  ✅ Temp logs, backups              (~550 KB)
  = 6.95 MB saved

Files to Delete (This Proposal):
  ✅ clinics.csv                     (2.9 MB)
  = 2.9 MB additional saved

TOTAL CLEANUP: 9.85 MB (from ~256 MB)
```

---

## ❓ Questions to Consider

1. **Do you ever re-enrich from raw data?**
   - If NO → Delete clinics.csv (Option A)
   - If YES → Keep clinics.csv (Option B)

2. **Do you add new enrichments regularly?**
   - If NO → Can delete enrich_clinics_archetypes.py
   - If YES → Keep it but update logic

3. **Do you want a simple pipeline?**
   - If YES → Use single source (enriched_clinics.csv only)
   - If NO → Keep both for flexibility

---

## 🚀 Ready to Go?

If you want to proceed with consolidation, I can:
1. Update the 2 script paths for you
2. Test both scripts
3. Delete clinics.csv
4. Verify everything works
5. Confirm the 2.9 MB savings

Just say the word! 🎯

