#!/usr/bin/env python3
"""
Fetch website URLs and review counts for all clinics using Google Places API.
This will take ~90 minutes and cost ~$100 AUD.

Run with: caffeinate -i python3 fetch_clinic_websites_with_reviews.py
(to prevent Mac sleep during execution)
"""

import os
import time
import pandas as pd
import googlemaps
from pathlib import Path

# --- Config ---
API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")  # Set via env var — do not hardcode
INPUT_CSV = "data/enriched_clinics.csv"
OUTPUT_CSV = "data/clinics/Scrape Results/clinic_websites_and_reviews.csv"
CHECKPOINT_EVERY = 100
RATE_LIMIT_DELAY = 0.05  # 50ms between requests

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
    print(f"DEBUG: Starting main()")  # DEBUG
    # Load clinics
    print(f"DEBUG: Loading {INPUT_CSV}")  # DEBUG
    clinics_df = pd.read_csv(INPUT_CSV)
    print(f"📂 Loaded {len(clinics_df)} clinics from {INPUT_CSV}\n")

    # Resume from checkpoint if output already exists
    processed_ids = load_progress(OUTPUT_CSV)
    if processed_ids:
        print(f"⏸️  Resuming — {len(processed_ids)} clinics already processed")

    remaining = clinics_df[~clinics_df["OBJECTID"].isin(processed_ids)]
    print(f"⏳ Clinics to process: {len(remaining)}")
    print(f"⏱️  Estimated time: ~{len(remaining) * 0.05 / 60:.1f} minutes\n")

    results = []
    errors = 0

    for idx, (_, clinic) in enumerate(remaining.iterrows()):
        result = get_clinic_info(clinic.to_dict())
        results.append(result)

        if "error" in result["status"]:
            errors += 1

        # Progress logging
        if (idx + 1) % 50 == 0:
            found = sum(1 for r in results if r["status"] == "found")
            pct = (idx + 1) / len(remaining) * 100
            print(f"Progress: {idx+1:,}/{len(remaining):,} ({pct:.1f}%) | Found: {found} | Errors: {errors}")

        # Checkpoint save
        if (idx + 1) % CHECKPOINT_EVERY == 0:
            save_results(results, OUTPUT_CSV, append=bool(processed_ids or idx >= CHECKPOINT_EVERY))
            results = []
            print(f"  💾 Checkpoint saved\n")

        time.sleep(RATE_LIMIT_DELAY)

    # Final save
    if results:
        print(f"\n⏳ Saving final {len(results)} results...")
        save_results(results, OUTPUT_CSV, append=bool(processed_ids))
        print(f"✅ Final save complete!")

    print(f"\n✅ Done! Output saved to {OUTPUT_CSV}")

    # Verify output before summary
    if not Path(OUTPUT_CSV).exists():
        print("❌ CRITICAL: Output file does not exist!")
        exit(1)

    final_count = len(pd.read_csv(OUTPUT_CSV))
    print(f"✅ Verification: {final_count} rows in output file")

    summarise(OUTPUT_CSV)


def save_results(results: list, output_path: str, append: bool = False):
    """Save results to CSV with proper error handling."""
    if not results:
        return

    df = pd.DataFrame(results)
    try:
        if append and Path(output_path).exists():
            # Read existing data, append new, write back
            existing_df = pd.read_csv(output_path)
            df = pd.concat([existing_df, df], ignore_index=True)
            df.to_csv(output_path, index=False)
        else:
            # Write fresh
            df.to_csv(output_path, index=False)

        # Verify write was successful
        verify_df = pd.read_csv(output_path)
        if len(verify_df) == 0:
            raise ValueError("CSV file is empty after write!")
    except Exception as e:
        print(f"❌ ERROR saving to {output_path}: {e}")
        raise


def summarise(output_path: str):
    """Print summary statistics."""
    df = pd.read_csv(output_path)
    total = len(df)
    found = (df["status"] == "found").sum()
    no_website = (df["status"] == "no_website").sum()
    not_found = (df["status"] == "not_found").sum()
    errors = df["status"].str.startswith("error").sum()

    avg_reviews = df[df["review_count"] > 0]["review_count"].mean()
    avg_rating = df[df["rating"].notna()]["rating"].mean()

    print(f"\n{'='*60}")
    print(f"{'SUMMARY':^60}")
    print(f"{'='*60}")
    print(f"Total clinics:         {total:>6}")
    print(f"Website found:         {found:>6} ({found/total*100:>5.1f}%)")
    print(f"No website listed:     {no_website:>6} ({no_website/total*100:>5.1f}%)")
    print(f"Not found in Maps:     {not_found:>6} ({not_found/total*100:>5.1f}%)")
    print(f"API errors:            {errors:>6} ({errors/total*100:>5.1f}%)")
    print(f"\nReview stats:")
    print(f"Clinics with reviews:  {(df['review_count'] > 0).sum():>6}")
    print(f"Avg review count:      {avg_reviews:>6.0f}")
    print(f"Avg rating:            {avg_rating:>6.2f}⭐")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
