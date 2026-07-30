# Google Places API Setup — Clinic Website Fetcher

## Context

You are working on a clinic archetype classifier. The goal of this task is to enrich `clinics.csv` (7,880 clinics) with website URLs by querying the Google Places API, so that a downstream scraper can extract billing model, format, and ownership signals from each clinic's website.

**Input**: `clinics.csv` — columns include `OBJECTID`, `ORGANISATION_NAME`, `SUBURB`  
**Output**: `clinic_websites.csv` — mapping of `OBJECTID` → `website_url`  
**Estimated cost**: ~$100 AUD for 7,880 lookups at ~$0.014/query  
**Estimated runtime**: ~2 hours

---

## Step 1 — Prerequisites

### 1.1 Install dependencies

```bash
pip install googlemaps pandas
```

### 1.2 Set your API key as an environment variable

**Never hardcode the API key in the script.** Set it in your shell:

```bash
export GOOGLE_PLACES_API_KEY="AIza..."
```

To make this persist across sessions, add it to your `~/.zshrc` or `~/.bashrc`.

### 1.3 Google Cloud Console setup (if not done yet)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Enable **Places API** under APIs & Services → Library
3. Create an API key under APIs & Services → Credentials
4. Set a **billing budget alert** at ~$120 to avoid runaway charges:
   - Billing → Budgets & Alerts → Create Budget

---

## Step 2 — Test on a small batch first

Before running the full 7,880 clinics, test on 10 rows to validate the output quality.

Create `test_fetch.py`:

```python
import os
import googlemaps

API_KEY = os.environ["GOOGLE_PLACES_API_KEY"]
gmaps = googlemaps.Client(key=API_KEY)

test_clinics = [
    {"OBJECTID": 1, "ORGANISATION_NAME": "Sydney CBD Medical Centre", "SUBURB": "Sydney"},
    {"OBJECTID": 2, "ORGANISATION_NAME": "Bondi Junction Family Clinic", "SUBURB": "Bondi Junction"},
]

for clinic in test_clinics:
    query = f"{clinic['ORGANISATION_NAME']} {clinic['SUBURB']}"
    try:
        places_result = gmaps.places(query=query, type="health")
        if places_result['results']:
            place_id = places_result['results'][0]['place_id']
            details = gmaps.place(place_id=place_id, fields=["website", "name"])
            website = details['result'].get('website')
            name = details['result'].get('name')
            print(f"✓ {clinic['ORGANISATION_NAME']} → {website} (matched: {name})")
        else:
            print(f"✗ {clinic['ORGANISATION_NAME']} → No results found")
    except Exception as e:
        print(f"✗ {clinic['ORGANISATION_NAME']} → Error: {e}")
```

Run it:

```bash
python test_fetch.py
```

Check that:
- Results are returning sensible clinic names
- Website URLs look correct (not just google.com)
- No auth errors (would indicate API key issue)

---

## Step 3 — Full pipeline script

Create `fetch_clinic_websites.py`:

```python
import os
import time
import pandas as pd
import googlemaps
from pathlib import Path

# --- Config ---
API_KEY = os.environ["GOOGLE_PLACES_API_KEY"]
INPUT_CSV = "clinics.csv"
OUTPUT_CSV = "clinic_websites.csv"
CHECKPOINT_EVERY = 100   # Save progress every N clinics
RATE_LIMIT_DELAY = 0.05  # 50ms between requests (~20 req/s, well under quota)

# --- Init ---
gmaps = googlemaps.Client(key=API_KEY)


def get_clinic_website(clinic: dict) -> dict:
    """Look up clinic website via Google Places API. Returns result dict."""
    query = f"{clinic['ORGANISATION_NAME']} {clinic['SUBURB']}"
    result = {
        "OBJECTID": clinic["OBJECTID"],
        "ORGANISATION_NAME": clinic["ORGANISATION_NAME"],
        "SUBURB": clinic["SUBURB"],
        "website_url": None,
        "place_name": None,
        "place_id": None,
        "status": "not_found",
    }

    try:
        places_result = gmaps.places(query=query, type="health")
        if places_result["results"]:
            place = places_result["results"][0]
            place_id = place["place_id"]
            details = gmaps.place(
                place_id=place_id,
                fields=["website", "name", "place_id"]
            )
            website = details["result"].get("website")
            result.update({
                "website_url": website,
                "place_name": details["result"].get("name"),
                "place_id": place_id,
                "status": "found" if website else "no_website",
            })
    except Exception as e:
        result["status"] = f"error: {e}"

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
    print(f"Loaded {len(clinics_df)} clinics from {INPUT_CSV}")

    # Resume from checkpoint if output already exists
    processed_ids = load_progress(OUTPUT_CSV)
    if processed_ids:
        print(f"Resuming — {len(processed_ids)} clinics already processed")

    remaining = clinics_df[~clinics_df["OBJECTID"].isin(processed_ids)]
    print(f"Clinics remaining: {len(remaining)}")

    results = []
    errors = 0

    for idx, (_, clinic) in enumerate(remaining.iterrows()):
        result = get_clinic_website(clinic.to_dict())
        results.append(result)

        if "error" in result["status"]:
            errors += 1

        # Progress logging
        if (idx + 1) % 50 == 0:
            found = sum(1 for r in results if r["status"] == "found")
            print(
                f"Progress: {idx+1}/{len(remaining)} | "
                f"Found: {found} | Errors: {errors}"
            )

        # Checkpoint save
        if (idx + 1) % CHECKPOINT_EVERY == 0:
            save_results(results, OUTPUT_CSV, append=bool(processed_ids or idx >= CHECKPOINT_EVERY))
            results = []  # Clear buffer after saving

        time.sleep(RATE_LIMIT_DELAY)

    # Final save
    if results:
        save_results(results, OUTPUT_CSV, append=bool(processed_ids))

    print(f"\nDone. Output saved to {OUTPUT_CSV}")
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

    print(f"\n--- Summary ---")
    print(f"Total clinics:   {total}")
    print(f"Website found:   {found} ({found/total*100:.1f}%)")
    print(f"No website:      {no_website} ({no_website/total*100:.1f}%)")
    print(f"Not found:       {not_found} ({not_found/total*100:.1f}%)")
    print(f"Errors:          {errors} ({errors/total*100:.1f}%)")


if __name__ == "__main__":
    main()
```

---

## Step 4 — Run the full pipeline

```bash
python fetch_clinic_websites.py
```

The script will:
- Auto-resume if interrupted (checkpoint every 100 clinics)
- Log progress every 50 clinics
- Print a summary at the end

Expected output at completion:
```
Total clinics:   7880
Website found:   ~5500 (70%)
No website:      ~700 (9%)
Not found:       ~600 (8%)
Errors:          ~80 (1%)
```

---

## Step 5 — Validate output

Once complete, do a quick spot-check:

```python
import pandas as pd

df = pd.read_csv("clinic_websites.csv")

# Check a sample
print(df[df["status"] == "found"].sample(10)[["ORGANISATION_NAME", "SUBURB", "website_url", "place_name"]])

# Check error cases
print(df[df["status"].str.startswith("error")].head(10))
```

Look for:
- Website URLs that look plausible (clinic's own domain, not google.com)
- `place_name` roughly matching `ORGANISATION_NAME` (confirms correct clinic was matched)
- Error messages to identify any systematic issues

---

## Output Schema

`clinic_websites.csv` will have these columns:

| Column | Description |
|--------|-------------|
| `OBJECTID` | Primary key, matches clinics.csv |
| `ORGANISATION_NAME` | Original clinic name |
| `SUBURB` | Original suburb |
| `website_url` | Website URL from Google Places (null if not found) |
| `place_name` | Name returned by Google (use to verify match quality) |
| `place_id` | Google Place ID (useful for future re-queries) |
| `status` | `found`, `no_website`, `not_found`, or `error: <message>` |

---

## Next Step

Once `clinic_websites.csv` is ready, the next task is `scrape_clinic_websites.py` — using Playwright to visit each URL and extract billing model, format, and ownership signals. That feeds into `enrich_clinics_archetypes.py` which adds `Format`, `Billing_Model`, and `Ownership_Confidence` columns to `clinics.csv`.
