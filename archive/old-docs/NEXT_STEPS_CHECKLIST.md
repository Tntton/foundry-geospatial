# Next Steps Checklist — F-01 Archetype Classifier

## ✅ Current Status
- **Fetch script:** Resuming in background (Task ID: `bnbygw2mp`)
- **Monitor:** Watching for completion (Task ID: `b1f9r4i8u`)
- **Preparation:** All three scripts & docs ready

---

## 📋 Step 1: Confirm Fetch Completion

**When you see the monitor notification:**
```bash
# Verify the output file is complete
python3 check_fetch_progress.py
# Should show: ✅ 7,880 clinics processed (100.0%)
# Should show: ~6,500-6,700 with websites

# Check file size
ls -lh clinic_websites_and_reviews.csv
# Should be ~600KB-800KB, not 13KB
```

---

## 🔄 Step 2: Launch Web Scraper

**As soon as fetch is 100% complete:**
```bash
# Start the scraper (12-24 hour runtime)
python3 scrape_clinics_full.py

# This will:
# - Visit each clinic website with Playwright
# - Extract billing keywords (bulk_billing, private, mixed)
# - Extract format keywords (big_box, small)
# - Extract ownership keywords (corporate brands)
# - Save to clinic_scrape_results.csv
# - Checkpoint every 100 clinics (resumable)

# While it runs, you can work on frontend in parallel
```

**Progress tracking:**
```bash
# Monitor scraper progress in another terminal
ls -lh clinic_scrape_results.csv  # File size grows as it runs
wc -l clinic_scrape_results.csv   # Row count increases
```

---

## 🎬 Step 3: Run ETL Enrichment (After Scraper Completes)

**When scraper finishes (~24 hours later):**
```bash
# Run enrichment script
python3 enrich_clinics_archetypes.py

# This will:
# - Read clinic_websites_and_reviews.csv (from fetch)
# - Read clinic_scrape_results.csv (from scraper)
# - Read clinics.csv (base data)
# - Apply three-tier classification
# - Output enriched_clinics.csv with Format, Billing_Model, Ownership + confidence
# - Print summary stats by archetype

# Expected output columns:
# OBJECTID, ORGANISATION_NAME, SUBURB, STATE, ...existing...,
# Format, Format_Confidence,
# Billing_Model, Billing_Confidence,
# Ownership, Ownership_Confidence
```

---

## 🎨 Step 4: Implement Frontend Changes (In Parallel with Scraper)

**While the scraper runs, you can build the UI:**

Follow `ARCHETYPE_FRONTEND_PLAN.md` step-by-step:

### 4a. Update HTML (30 min)
```html
<!-- Left rail: Add archetype filter section -->
<!-- Rankings table: Add 3 new columns -->
<!-- Drawer: Add archetype classification section -->
```
File: `index.html`

### 4b. Update CSS (20 min)
- Chip styling for archetype filters
- Confidence badge colors (high/medium/low)
- Table cell colors by archetype
- Drawer layout adjustments

File: `styles.css`

### 4c. Update JavaScript (2-3 hours)
```javascript
// Load enriched_clinics.csv into clinicsData
// Add archetype filter state management
// Implement matchesArchetypeFilter() function
// Wire up checkbox event handlers
// Update marker rendering by Format/Billing/Confidence
// Populate league table with new columns
```
File: `app.js`

### 4d. Test (1 hour)
- [ ] Archetype filters appear and work
- [ ] Markers style by Format (size), Billing (color), Confidence (opacity)
- [ ] Detail drawer shows archetype classifications
- [ ] League table columns sort correctly
- [ ] Mobile responsive
- [ ] No regressions in existing features

---

## 🧪 Step 5: Validation & QA

**Before shipping:**

```bash
# Sample spot-check: 10 random enriched clinics
# Verify: Format matches website (big-box vs small)
#         Billing matches website tone (bulk vs private)
#         Ownership matches brand (corporate vs independent)
#         Confidence is appropriate (high/medium/low)

# Check aggregates: Do the percentages make sense?
# ~40-50% Big-box, 30-40% Mid-format, 10-20% Small
# ~45-55% Bulk, 25-35% Mixed, 10-15% Private
# ~30-40% Corporate, 60-70% Independent
```

---

## 📊 Expected Outputs

### clinic_websites_and_reviews.csv (from fetch)
```
OBJECTID, ORGANISATION_NAME, SUBURB, website_url, rating, review_count, ...
5, Roleystone Child Health Centre, Roleystone, https://..., 4.1, 24, ...
```
Expected: **7,880 rows**, ~600KB file size, **~85% with websites**

### clinic_scrape_results.csv (from scraper)
```
OBJECTID, ORGANISATION_NAME, website_url, 
billing_keywords, format_keywords, ownership_keywords, status, ...
```
Expected: **~6,500-6,700 rows** (only those with websites), success rate ~85-90%

### enriched_clinics.csv (from ETL)
```
OBJECTID, ORGANISATION_NAME, SUBURB, STATE, ...existing...,
Format, Format_Confidence,
Billing_Model, Billing_Confidence,
Ownership, Ownership_Confidence
```
Expected: **7,880 rows**, all clinics enriched (with confidence levels showing which are website-based vs fallback)

---

## ⏱️ Timeline

| Phase | Duration | When to Start |
|-------|----------|---------------|
| Fetch completion | ~10 min | Now (resuming) |
| Scraper runs | 12-24 hours | Right after fetch completes |
| ETL enrichment | 5 min | After scraper finishes |
| Frontend implementation | 2-4 hours | In parallel with scraper |
| Testing & QA | 1-2 hours | After ETL completes |
| **Total** | ~36-48 hours | — |

---

## 🔧 Troubleshooting

### "clinic_websites_and_reviews.csv is still only 80 rows"
- Check: Is the fetch script still running? (`ps aux | grep fetch_clinic`)
- Wait for monitor notification that file size is > 7800 rows

### "Scraper times out on a website"
- Script will skip and move to next (status: timeout)
- Increase timeout from 10000ms to 15000ms if needed
- Can also reduce BATCH_SIZE from 50 to 25 for slower connection

### "ETL script fails because enriched_clinics.csv doesn't exist yet"
- This is expected! Run ETL only AFTER scraper completes
- Check: Does `clinic_scrape_results.csv` exist first?

### "Frontend tests show low accuracy on archetype classification"
- Check: KEYWORD_EXTRACTION_GUIDE.md for known limitations
- Spot-check 5-10 clinics manually on their actual websites
- Consider post-processing: adjust confidence thresholds, add exclusion patterns

---

## 📞 Key Files Reference

| File | Purpose | Created/Updated |
|------|---------|-----------------|
| fetch_clinic_websites_with_reviews.py | Fetch script (running now) | Session 1 |
| scrape_clinics_full.py | Web scraper (improved patterns) | This session ✅ |
| enrich_clinics_archetypes.py | ETL enrichment | This session ✅ |
| keyword_extraction_test.py | Pattern validation | This session ✅ |
| ARCHETYPE_FRONTEND_PLAN.md | Frontend spec | This session ✅ |
| KEYWORD_EXTRACTION_GUIDE.md | Pattern docs | This session ✅ |
| PARALLEL_WORK_SUMMARY.md | Work summary | This session ✅ |
| index.html | Frontend (to be updated) | To do |
| app.js | Frontend logic (to be updated) | To do |
| styles.css | Frontend styling (to be updated) | To do |

---

## ✨ Success Criteria

### Phase 1: Fetch ✅ (in progress)
- [ ] clinic_websites_and_reviews.csv has 7,880 rows
- [ ] ~6,500+ clinics have websites
- [ ] 0 API errors (or <1%)
- [ ] Average rating ~4.0⭐

### Phase 2: Scraper
- [ ] clinic_scrape_results.csv created
- [ ] ~6,500+ rows (websites that were found)
- [ ] Success rate >85%
- [ ] Spot-checks show reasonable signal extraction

### Phase 3: ETL
- [ ] enriched_clinics.csv created
- [ ] All 7,880 clinics have Format, Billing, Ownership
- [ ] Confidence levels are assigned correctly
- [ ] High confidence ~40-50%, Medium ~30-40%, Low ~10-20%

### Phase 4: Frontend
- [ ] Archetype filters work on map
- [ ] Markers display with archetype styling
- [ ] League table columns added and sortable
- [ ] Detail drawer shows classifications
- [ ] No regressions in other features
- [ ] Mobile responsive

---

## 🎯 Next Immediate Action

**Right now:**
1. Wait for monitor notification that fetch is complete
2. Verify file size with `python3 check_fetch_progress.py`
3. Launch scraper: `python3 scrape_clinics_full.py`

**While scraper runs (parallel work):**
- Start frontend changes from ARCHETYPE_FRONTEND_PLAN.md
- Do HTML + CSS first (quick wins)
- Then tackle JavaScript logic

**After scraper completes:**
- Run ETL: `python3 enrich_clinics_archetypes.py`
- Finish frontend integration
- Test all features

---

You're all set! Let me know when the fetch completes and we'll kick off phase 2. 🚀
