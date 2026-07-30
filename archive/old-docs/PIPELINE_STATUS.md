# F-01 Archetype Classifier — Pipeline Status

## 🚀 What's Running Right Now

✅ **Google Places Fetch** (Background Task ID: `brfs9leko`)
- **Status**: Running in background
- **Progress**: Fetching website URLs + review counts for 7,880 clinics
- **Runtime**: ~2-3 hours (50ms per clinic)
- **Cost**: ~$100 AUD
- **Output**: `clinic_websites_and_reviews.csv`
- **Can interrupt?**: Yes (auto-resumes from checkpoint every 100 clinics)

---

## 📊 Track Progress (While Waiting)

Check progress at any time:

```bash
python3 check_fetch_progress.py
```

This will show:
- How many clinics processed
- Success/failure breakdown
- Average reviews and ratings
- Estimated time remaining

---

## ⏭️ What Happens Next (Automatically)

### Step 1: Google Places Fetch Completes
- Output file: `clinic_websites_and_reviews.csv`
- Size: ~2-3 MB
- Contains: Website URLs, review counts, ratings for ~5,500 clinics

### Step 2: Run Web Scraper
When fetch completes, you'll run:

```bash
python3 scrape_clinics_full.py
```

This script:
- Visits each clinic website with a browser
- Extracts billing model signals (bulk vs private)
- Extracts format signals (big-box vs small)
- Extracts ownership indicators
- Captures Google review counts
- **Runtime**: ~12-24 hours (50 parallel browsers)
- **Output**: `clinic_scrape_results.csv`

### Step 3: ETL Enrichment
Create enriched clinics.csv:
- Format classification (Big-box / Mid-format / Small / Unclassified)
- Billing model (Bulk / Mixed / Private / Unclassified)
- Ownership confidence scores
- All with confidence levels (high/medium/low)

---

## 📁 Files Ready to Go

| File | Purpose | Status |
|------|---------|--------|
| `fetch_clinic_websites_with_reviews.py` | Fetch websites + reviews | ✅ Running |
| `check_fetch_progress.py` | Monitor progress | ✅ Ready |
| `scrape_clinics_full.py` | Web scraper | ✅ Ready (pending fetch) |
| `test_api_key.py` | API verification | ✅ Passed |

---

## 🎯 What You Should Do Now

1. **Wait 2-3 hours** for fetch to complete (you can close this terminal)
2. **Check progress** periodically with:
   ```bash
   python3 check_fetch_progress.py
   ```
3. **When fetch completes**, I'll notify you and run the scraper next
4. **Monitor output files**:
   - `clinic_websites_and_reviews.csv` (after fetch)
   - `clinic_scrape_results.csv` (after scraper)
   - `fetch_progress.log` (progress log)

---

## 💡 Key Stats to Track

**From Fetch Output**:
- How many clinics have websites (~70%)
- Average review count per clinic
- Average Google rating

**From Scrape Output**:
- Extraction success rate
- Coverage of billing/format/ownership signals
- Accuracy of proxy scoring

---

## ⚠️ If Something Goes Wrong

**Check the fetch log**:
```bash
tail -f fetch_progress.log
```

**If script crashes**:
- Check: API quota limit (sign into Google Cloud Console)
- Check: Internet connection
- Re-run: Script will auto-resume from last checkpoint

**If timeout on scraper**:
- Browsers may be slow on your machine
- Increase `BATCH_SIZE` in `scrape_clinics_full.py` (currently 50)
- Or reduce to 25 for slower connections

---

## 📞 Next Steps

I'll monitor and notify you when:
1. ✅ Fetch completes → Ready to start scraper
2. ✅ Scraper completes → Ready for ETL enrichment
3. ✅ All done → Ready to load into frontend

See you in ~2-3 hours! ☕

---

**Last Updated**: Task started at $(date)
