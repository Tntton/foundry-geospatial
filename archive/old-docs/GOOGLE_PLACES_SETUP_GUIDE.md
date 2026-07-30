# Google Places API Setup — Complete Step-by-Step Guide

## Overview

You're about to fetch website URLs and review counts for 7,880 clinics using Google Places API. This will cost ~$100 AUD and take ~2-3 hours.

**End result**: A CSV file with clinic names, websites, and review counts ready for web scraping.

---

## PART 1: Google Cloud Console Setup (30 min)

### Step 1.1: Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. At the top, click the **Project dropdown** (next to "Google Cloud")
3. Click **NEW PROJECT**
4. Name it: `gp-clinics` (or whatever you prefer)
5. Click **CREATE**
6. Wait ~1 minute for it to be created

### Step 1.2: Enable the Places API

1. In the left sidebar, click **APIs & Services** → **Library**
2. Search for `Places API`
3. Click on **Places API**
4. Click the blue **ENABLE** button
5. Wait for it to finish enabling (~30 seconds)

### Step 1.3: Create an API Key

1. Click **APIs & Services** → **Credentials** (in left sidebar)
2. Click **+ CREATE CREDENTIALS** at the top
3. Select **API Key**
4. A popup will show your API key (like `AIza...`)
5. **Copy this key** and save it somewhere safe (we'll use it in a moment)

### Step 1.4: Restrict the API Key (Security)

This optional but recommended to prevent unauthorized use:

1. In the **Credentials** page, click on your newly created API key
2. Under **Application restrictions**, select **HTTP referrers (web sites)**
3. Under **API restrictions**, select **Restrict key** and choose **Places API**
4. Click **SAVE**

### Step 1.5: Set up a Budget Alert

This prevents surprise charges:

1. Click **Billing** in the left sidebar (you may need to set up billing first)
2. Click **Budgets & Alerts**
3. Click **CREATE BUDGET**
4. Budget name: `Google Places Alert`
5. Budget amount: **$150 AUD** (gives buffer above ~$100 estimate)
6. In **Actions**, enable email notifications when you hit 50%, 90%, 100%
7. Click **CREATE**

✅ **You're done with Google Cloud!**

---

## PART 2: Local Setup (15 min)

### Step 2.1: Install Python dependencies

Open your terminal and run:

```bash
pip install googlemaps pandas openpyxl
```

### Step 2.2: Set your API key as an environment variable

**NEVER hardcode your API key in scripts.** Instead, set it as an environment variable:

```bash
export GOOGLE_PLACES_API_KEY="AIza...YOUR_KEY_HERE..."
```

Replace `AIza...YOUR_KEY_HERE...` with the actual key you copied in Step 1.3.

**To make this persist** (so you don't have to run the export every time):

**On Mac/Linux**:
```bash
# Open your shell config file
nano ~/.zshrc
# Or if you use bash:
# nano ~/.bashrc

# Add this line at the end:
export GOOGLE_PLACES_API_KEY="AIza...YOUR_KEY_HERE..."

# Press Ctrl+O, Enter, then Ctrl+X to save
```

**On Windows (PowerShell)**:
```powershell
[Environment]::SetEnvironmentVariable("GOOGLE_PLACES_API_KEY", "AIza...YOUR_KEY_HERE...", "User")
# Restart PowerShell for it to take effect
```

✅ **Verify it worked**:
```bash
echo $GOOGLE_PLACES_API_KEY
# Should print: AIza...YOUR_KEY_HERE...
```

---

## PART 3: Test Run (20 min)

### Step 3.1: Create a test script

Navigate to your GP Platform Code folder and create a file called `test_google_places.py`:

```python
import os
import googlemaps

API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY")
if not API_KEY:
    print("❌ ERROR: GOOGLE_PLACES_API_KEY environment variable not set!")
    print("Run: export GOOGLE_PLACES_API_KEY='AIza...'")
    exit(1)

print(f"✓ API key found: {API_KEY[:20]}...")
gmaps = googlemaps.Client(key=API_KEY)

# Test on 2 real Australian clinics
test_clinics = [
    {"OBJECTID": 1, "ORGANISATION_NAME": "Woolworths Medical Centre", "SUBURB": "Woolworths"},
    {"OBJECTID": 2, "ORGANISATION_NAME": "Bondi Medical Centre", "SUBURB": "Bondi"},
]

print("\n--- Testing Google Places API ---\n")

for clinic in test_clinics:
    query = f"{clinic['ORGANISATION_NAME']} {clinic['SUBURB']}"
    print(f"Looking up: {query}")
    
    try:
        # Search for the place
        places_result = gmaps.places(query=query, type="health")
        
        if places_result['results']:
            place = places_result['results'][0]
            place_id = place['place_id']
            place_name = place.get('name', 'N/A')
            
            # Get details including reviews
            details = gmaps.place(
                place_id=place_id,
                fields=["website", "name", "rating", "user_ratings_total", "review"]
            )
            
            website = details['result'].get('website', 'No website')
            rating = details['result'].get('rating', 'N/A')
            review_count = details['result'].get('user_ratings_total', 0)
            
            print(f"  ✓ Matched: {place_name}")
            print(f"    Website: {website}")
            print(f"    Rating: {rating} ⭐ ({review_count} reviews)")
        else:
            print(f"  ✗ No results found")
            
    except Exception as e:
        print(f"  ✗ Error: {e}")
    
    print()
```

### Step 3.2: Run the test

```bash
cd "/Users/joshting/Desktop/GP Intelligence Platform/GP Platform Code"
python test_google_places.py
```

**Expected output**:
```
✓ API key found: AIza...
--- Testing Google Places API ---

Looking up: Woolworths Medical Centre Woolworths
  ✓ Matched: Woolworths Medical Centre
    Website: https://www.woolworthsmedical.com
    Rating: 4.5 ⭐ (120 reviews)

Looking up: Bondi Medical Centre Bondi
  ✓ Matched: Bondi Medical Centre
    Website: https://www.bondimedical.com.au
    Rating: 4.2 ⭐ (85 reviews)
```

✅ **If you see this, your API is working!**

---

## PART 4: Full Pipeline (2-3 hours runtime)

### Step 4.1: Create the full fetch script

Create a file called `fetch_clinic_websites_with_reviews.py`:

```python
import os
import time
import pandas as pd
import googlemaps
from pathlib import Path

# --- Config ---
API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY")
if not API_KEY:
    print("❌ ERROR: GOOGLE_PLACES_API_KEY not set. Run: export GOOGLE_PLACES_API_KEY='AIza...'")
    exit(1)

INPUT_CSV = "clinics.csv"
OUTPUT_CSV = "clinic_websites_and_reviews.csv"
CHECKPOINT_EVERY = 100   # Save progress every N clinics
RATE_LIMIT_DELAY = 0.05  # 50ms between requests (~20 req/s, well under 100 qps quota)

# --- Init ---
gmaps = googlemaps.Client(key=API_KEY)


def get_clinic_info(clinic: dict) -> dict:
    """Look up clinic website and reviews via Google Places API."""
    query = f"{clinic['ORGANISATION_NAME']} {clinic['SUBURB']}"
    result = {
        "OBJECTID": clinic["OBJECTID"],
        "ORGANISATION_NAME": clinic["ORGANISATION_NAME"],
        "SUBURB": clinic["SUBURB"],
        "website_url": None,
        "rating": None,
        "review_count": 0,
        "place_name": None,
        "place_id": None,
        "status": "not_found",
    }

    try:
        places_result = gmaps.places(query=query, type="health")
        if places_result["results"]:
            place = places_result["results"][0]
            place_id = place["place_id"]
            
            # Fetch details including website and review data
            details = gmaps.place(
                place_id=place_id,
                fields=["website", "name", "place_id", "rating", "user_ratings_total"]
            )
            
            website = details["result"].get("website")
            rating = details["result"].get("rating")
            review_count = details["result"].get("user_ratings_total", 0)
            
            result.update({
                "website_url": website,
                "rating": rating,
                "review_count": review_count,
                "place_name": details["result"].get("name"),
                "place_id": place_id,
                "status": "found" if website else "no_website",
            })
    except Exception as e:
        result["status"] = f"error: {str(e)[:50]}"

    return result


def load_progress(output_path: str) -> set:
    """Load already-processed OBJECTIDs from existing output file."""
    if Path(output_path).exists():
        df = pd.read_csv(output_path)
        return set(df["OBJECTID"].tolist())
    return set()


def main():
    # Load clinics
    clinics_df = pd.read_csv(INPUT_CSV)
    print(f"📂 Loaded {len(clinics_df)} clinics from {INPUT_CSV}")

    # Resume from checkpoint if output already exists
    processed_ids = load_progress(OUTPUT_CSV)
    if processed_ids:
        print(f"⏸️  Resuming — {len(processed_ids)} clinics already processed")

    remaining = clinics_df[~clinics_df["OBJECTID"].isin(processed_ids)]
    print(f"⏳ Clinics remaining: {len(remaining)}\n")

    results = []
    errors = 0
    total_results = len(processed_ids)

    for idx, (_, clinic) in enumerate(remaining.iterrows()):
        result = get_clinic_info(clinic.to_dict())
        results.append(result)

        if "error" in result["status"]:
            errors += 1

        # Progress logging every 50 clinics
        if (idx + 1) % 50 == 0:
            found = sum(1 for r in results if r["status"] == "found")
            pct = (idx + 1) / len(remaining) * 100
            print(f"Progress: {idx+1}/{len(remaining)} ({pct:.0f}%) | Found: {found} | Errors: {errors}")

        # Checkpoint save every 100 clinics
        if (idx + 1) % CHECKPOINT_EVERY == 0:
            save_results(results, OUTPUT_CSV, append=bool(processed_ids or idx >= CHECKPOINT_EVERY))
            results = []  # Clear buffer after saving
            print(f"  💾 Checkpoint saved at {(idx + 1) + len(processed_ids)} clinics\n")

        time.sleep(RATE_LIMIT_DELAY)

    # Final save
    if results:
        save_results(results, OUTPUT_CSV, append=bool(processed_ids))

    print(f"\n✅ Done! Output saved to {OUTPUT_CSV}")
    summarise(OUTPUT_CSV)


def save_results(results: list, output_path: str, append: bool = False):
    """Save results to CSV, appending if file exists."""
    df = pd.DataFrame(results)
    mode = "a" if append and Path(output_path).exists() else "w"
    header = not (append and Path(output_path).exists())
    df.to_csv(output_path, mode=mode, header=header, index=False)


def summarise(output_path: str):
    """Print summary statistics of the output."""
    df = pd.read_csv(output_path)
    total = len(df)
    found = (df["status"] == "found").sum()
    no_website = (df["status"] == "no_website").sum()
    not_found = (df["status"] == "not_found").sum()
    errors = df["status"].str.startswith("error").sum()
    
    avg_reviews = df[df["review_count"] > 0]["review_count"].mean()
    avg_rating = df[df["rating"].notna()]["rating"].mean()

    print(f"\n{'='*50}")
    print(f"{'SUMMARY STATISTICS':^50}")
    print(f"{'='*50}")
    print(f"Total clinics processed:  {total:>5}")
    print(f"Website found:            {found:>5} ({found/total*100:>5.1f}%)")
    print(f"No website listed:        {no_website:>5} ({no_website/total*100:>5.1f}%)")
    print(f"Not found in Google Maps: {not_found:>5} ({not_found/total*100:>5.1f}%)")
    print(f"API errors:               {errors:>5} ({errors/total*100:>5.1f}%)")
    print(f"\nReview statistics:")
    print(f"Clinics with reviews:     {(df['review_count'] > 0).sum():>5}")
    print(f"Average review count:     {avg_reviews:>5.0f}")
    print(f"Average rating:           {avg_rating:>5.2f}⭐")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    main()
```

### Step 4.2: Run the full pipeline

```bash
cd "/Users/joshting/Desktop/GP Intelligence Platform/GP Platform Code"
python fetch_clinic_websites_with_reviews.py
```

This will:
- Take **2-3 hours** to process all 7,880 clinics
- Save checkpoints every 100 clinics (so if it crashes, you can resume)
- Print progress every 50 clinics
- Display a summary at the end

**You can safely close the terminal and run it in the background if needed.**

---

## PART 5: Verify Output (10 min)

Once complete, verify the results:

```python
import pandas as pd

df = pd.read_csv("clinic_websites_and_reviews.csv")

# Show a sample of successful lookups
print("=== Sample of found clinics ===")
print(df[df["status"] == "found"][["ORGANISATION_NAME", "website_url", "review_count", "rating"]].head(20))

# Show any errors
print("\n=== Errors (if any) ===")
print(df[df["status"].str.startswith("error")][["ORGANISATION_NAME", "status"]].head(10))

# Summary statistics
print("\n=== Stats ===")
print(f"Total: {len(df)}")
print(f"Found: {(df['status'] == 'found').sum()}")
print(f"Avg reviews: {df['review_count'].mean():.0f}")
print(f"Avg rating: {df['rating'].mean():.2f}")
```

---

## Output File Schema

Your output CSV `clinic_websites_and_reviews.csv` will have:

| Column | Example | Description |
|--------|---------|-------------|
| `OBJECTID` | 12345 | Primary key |
| `ORGANISATION_NAME` | Bondi Medical Centre | Original clinic name |
| `SUBURB` | Bondi | Original suburb |
| `website_url` | https://bondimedical.com | Website from Google Places |
| `rating` | 4.5 | Google rating (1-5 stars) |
| `review_count` | 87 | Number of Google reviews |
| `place_name` | Bondi Medical Centre | Name Google found |
| `place_id` | ChIJ... | Google Place ID |
| `status` | found | Status code |

---

## Troubleshooting

### ❌ "GOOGLE_PLACES_API_KEY not set"
→ Run `export GOOGLE_PLACES_API_KEY="AIza..."` in your terminal

### ❌ "Invalid API key"
→ Check your API key is copied correctly from Google Cloud Console

### ❌ "Quota exceeded"
→ You've hit the daily quota (~10,000 free lookups). Wait until tomorrow or upgrade billing.

### ❌ "Connection timeout"
→ Internet issue. Script will auto-resume from checkpoint when you run it again.

### ✅ Many "not found" results
→ This is normal for rural clinics. They'll fall back to heuristics in the ETL step.

---

## Next Steps

Once `clinic_websites_and_reviews.csv` is ready, run:

```bash
python scrape_clinic_websites.py
```

This will visit each website and extract billing model, format, and ownership signals using Playwright.
