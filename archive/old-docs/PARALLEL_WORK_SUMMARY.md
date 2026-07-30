# Parallel Work Completed While Fetch Runs

## Status
**Google Places Fetch:** 58% complete (4,600/7,880) — ~3 min remaining

---

## ✅ Task 1: ETL Enrichment Script

**File:** `enrich_clinics_archetypes.py`

### What it does:
- Reads: `clinic_websites_and_reviews.csv` (from fetch), `clinic_scrape_results.csv` (from scraper), `clinics.csv` (base data)
- Applies three-tier classification logic
- Outputs: `enriched_clinics.csv` with columns:
  - `Format` (Big-box / Mid-format / Small / Unclassified)
  - `Format_Confidence` (high / medium / low)
  - `Billing_Model` (Bulk / Mixed / Private / Unclassified)
  - `Billing_Confidence` (high / medium / low)
  - `Ownership` (Corporate / Independent / Unclassified)
  - `Ownership_Confidence` (high / medium / low)

### How it works:
1. For each clinic, check if website scrape results exist
2. If has website signals → classify with **high confidence**
3. Else if has name keywords → classify with **medium confidence**
4. Else use SA3-level BB% as fallback → classify with **low confidence**

### When to run:
```bash
# After scraper completes (produces clinic_scrape_results.csv)
python3 enrich_clinics_archetypes.py
```

### Expected output:
- `enriched_clinics.csv` with 7,880 rows
- Summary stats showing distribution by Format, Billing, Ownership, and confidence levels
- Ready for frontend consumption

---

## ✅ Task 2: Frontend Integration Plan

**File:** `ARCHETYPE_FRONTEND_PLAN.md`

### Changes needed:

**Map View — Left Rail:**
- Add "Clinic Archetypes" filter section
- Checkboxes for Format (Big-box, Mid-format, Small)
- Checkboxes for Billing (Bulk, Mixed, Private)
- Checkboxes for Ownership (Corporate, Independent)
- Confidence level toggle (high/medium/low)

**Clinic Markers:**
- **Size by Format:** Big-box (10px) → Mid-format (8px) → Small (6px)
- **Color by Billing:** Bulk (green #1b5e20) → Mixed (blue #1976d2) → Private (red #c00000)
- **Opacity by Confidence:** High (1.0) → Medium (0.7) → Low (0.5)

**Detail Drawer (on clinic click):**
- Add "Archetype Classification" section
- Show Format, Billing, Ownership with confidence badges

**League Table (Rankings view):**
- Add 3 new columns: Format, Billing_Model, Ownership
- Each cell includes small confidence dot (color-coded)
- Make columns sortable

### Implementation order:
1. Add HTML (filter chips, table columns, drawer section)
2. Add CSS (styling, colors, badges)
3. Load enriched_clinics.csv into app.js
4. Wire up filter checkbox handlers
5. Update marker rendering
6. Populate table rows
7. Test and polish

---

## ✅ Task 3: Refined Keyword Extraction

**File:** `scrape_clinics_full.py` (updated) + `keyword_extraction_test.py` + `KEYWORD_EXTRACTION_GUIDE.md`

### What was improved:

**Billing Signals:**
- Bulk billing: "bulk billing", "100% bulk billing", "no gap", "gap-free"
- Private: "fee-for-service", "private fees", "private billing"
- Mixed: "both bulk and private", "mixed billing"
- Decision: Highest score wins; tie → use fallback

**Format Signals:**
- Big-box: "multi-clinic", "clinic chain", "network", "group practice", "multiple locations", "franchise"
- Small: "family clinic", "neighbourhood", "local GP", "independent practice"
- Decision: Explicit win or "Mid-format" for ambiguous

**Ownership Signals:**
- Corporate: Named brands (MyHealth, Healius, Sonic, IPN, etc.), "Pty Ltd", "affiliate of [brand]"
- Independent: Everything else (default)
- Decision: ≥1 corporate signal → Corporate

### Test harness:
```bash
python3 keyword_extraction_test.py  # Validates patterns on 7 sample website texts
```

### Known limitations (documented):
- Patterns are intentionally broad → high recall, lower precision
- Confidence scoring in ETL handles imprecision
- Three-tier fallback provides safety net
- Post-scrape validation script included for spot-checking

---

## 🚀 Next Steps (Chronological)

### Phase 1: Complete the fetch (~3 min from now)
```bash
# Monitor:
python3 check_fetch_progress.py

# Expected output: clinic_websites_and_reviews.csv (600KB, ~7,880 rows)
```

### Phase 2: Run the scraper (12-24 hours)
```bash
python3 scrape_clinics_full.py

# Expected output: clinic_scrape_results.csv with format/billing/ownership signals
# Progress: checkpointed every 100 clinics, resumable on interrupt
```

### Phase 3: Run ETL enrichment (immediate after scraper)
```bash
python3 enrich_clinics_archetypes.py

# Expected output: enriched_clinics.csv ready for frontend
```

### Phase 4: Implement frontend (2-4 hours)
Follow `ARCHETYPE_FRONTEND_PLAN.md` step-by-step:
1. Update HTML (left rail, drawer, table)
2. Update CSS
3. Update app.js (loading, filtering, rendering)
4. Test all filter combinations
5. Polish responsive behavior

---

## 📊 Files Created/Updated

| File | Status | Purpose |
|------|--------|---------|
| enrich_clinics_archetypes.py | ✅ Ready | ETL enrichment script |
| ARCHETYPE_FRONTEND_PLAN.md | ✅ Ready | Frontend spec & implementation guide |
| keyword_extraction_test.py | ✅ Ready | Keyword pattern validation |
| KEYWORD_EXTRACTION_GUIDE.md | ✅ Ready | Pattern documentation |
| scrape_clinics_full.py | ✅ Updated | Improved keyword extraction |
| PARALLEL_WORK_SUMMARY.md | ✅ This doc | Task summary |

---

## 🎯 Key Decision Points

**Q: What if scraper finds no website for a clinic?**
A: ETL falls back to name keywords (medium confidence) → SA3-level BB% (low confidence)

**Q: What if website text is garbled or extracted poorly?**
A: Low confidence flag; still used but marked as unreliable

**Q: Should we validate corporate brands against ASIC?**
A: Not in MVP; mentioned as future enhancement. Keyword approach is pragmatic for screening.

**Q: How many clinics will we get enriched?**
A: Estimate:
- ~4,000-4,500 with website + scrape signals (high confidence)
- ~1,500-2,000 with keywords only (medium confidence)
- ~1,000-1,500 with SA3 fallback only (low confidence)

---

## ⏱️ Timeline

- **Now:** Fetch in progress (3 min remaining)
- **+3 min:** Start scraper
- **+15-30 hours:** Scraper runs in background
- **+30 hours:** Run ETL enrichment (5 min)
- **+30 hours:** Frontend implementation begins (2-4 hours)
- **+32-34 hours:** Feature complete & testing

---

## 💡 Tips

- **Monitor scraper progress:** Check `clinic_scrape_results.csv` file size / row count
- **Parallel work:** Start frontend HTML/CSS while scraper runs
- **Spot-check output:** Sample 10-20 clinics post-enrichment to validate
- **Confidence tuning:** If low confidence is too high, adjust thresholds in ETL

