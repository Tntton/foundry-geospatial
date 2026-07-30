#!/usr/bin/env python3
"""Quick test to verify Google Places API key works"""

import googlemaps

import os
API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")  # Set via env var — do not hardcode

print("🔍 Testing Google Places API key...\n")

try:
    gmaps = googlemaps.Client(key=API_KEY)
    print("✅ API client initialized successfully\n")

    # Test on 2 real Australian clinics
    test_clinics = [
        {"name": "Sydney CBD Medical Centre", "suburb": "Sydney"},
        {"name": "Bondi Medical Centre", "suburb": "Bondi"},
    ]

    for clinic in test_clinics:
        query = f"{clinic['name']} {clinic['suburb']}"
        print(f"Testing: {query}")

        places_result = gmaps.places(query=query, type="health")
        if places_result['results']:
            place = places_result['results'][0]
            place_id = place['place_id']

            details = gmaps.place(
                place_id=place_id,
                fields=["website", "name", "rating", "user_ratings_total"]
            )

            website = details['result'].get('website', 'No website')
            rating = details['result'].get('rating', 'N/A')
            review_count = details['result'].get('user_ratings_total', 0)
            matched_name = details['result'].get('name', 'Unknown')

            print(f"  ✅ Found: {matched_name}")
            print(f"     Website: {website}")
            print(f"     Rating: {rating}⭐ ({review_count} reviews)\n")
        else:
            print(f"  ⚠️  No results found\n")

    print("=" * 60)
    print("✅ API KEY VERIFIED - All tests passed!")
    print("=" * 60)
    print("\nYou're ready to run the full pipeline.")
    print("Next: python fetch_clinic_websites_with_reviews.py")

except Exception as e:
    print(f"❌ Error: {e}")
    print("\nAPI key may be invalid or rate limited.")
    exit(1)
