#!/usr/bin/env python3
"""Check the progress of the fetch script"""

import pandas as pd
from pathlib import Path

output_file = Path("clinic_websites_and_reviews.csv")

if not output_file.exists():
    print("⏳ Fetch not started yet or still initializing...")
else:
    df = pd.read_csv(output_file)
    total = len(df)
    found = (df["status"] == "found").sum()
    no_website = (df["status"] == "no_website").sum()
    not_found = (df["status"] == "not_found").sum()
    errors = df["status"].str.startswith("error").sum()

    pct = total / 7880 * 100

    print(f"\n{'='*60}")
    print(f"📊 Fetch Progress Update")
    print(f"{'='*60}")
    print(f"Clinics processed: {total:,} / 7,880 ({pct:.1f}%)")
    print(f"\nStatus breakdown:")
    print(f"  ✅ Websites found:  {found:>6,} ({found/total*100:>5.1f}%)")
    print(f"  ⚠️  No website:     {no_website:>6,} ({no_website/total*100:>5.1f}%)")
    print(f"  ❌ Not found:      {not_found:>6,} ({not_found/total*100:>5.1f}%)")
    print(f"  🔥 API errors:     {errors:>6,} ({errors/total*100:>5.1f}%)")

    if total > 0 and found > 0:
        avg_reviews = df[df["review_count"] > 0]["review_count"].mean()
        avg_rating = df[df["rating"].notna()]["rating"].mean()
        print(f"\nReview metrics:")
        print(f"  Avg reviews/clinic: {avg_reviews:>6.0f}")
        print(f"  Avg rating:         {avg_rating:>6.2f}⭐")

    print(f"{'='*60}\n")

    # ETA
    if total < 7880:
        remaining = 7880 - total
        rate = total / (remaining + total)  # clinics per call
        mins_per_clinic = 0.05 / 60  # 50ms delay
        est_remaining_mins = remaining * mins_per_clinic
        print(f"⏱️  Estimated time remaining: ~{est_remaining_mins:.0f} minutes\n")
