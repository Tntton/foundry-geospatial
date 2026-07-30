# Keyword Extraction Strategy & Validation

## Overview
Keyword extraction identifies archetype signals from clinic website text to classify Format, Billing Model, and Ownership. The approach prioritizes **recall** (finding signals when they exist) over **precision** (avoiding false positives), since the ETL layer applies confidence scoring as a fallback.

---

## Current Patterns

### Billing Model Extraction

**Bulk Billing Signals:**
- "bulk billing", "bulk-billing" → score +2
- "100% bulk billing" → score +1
- "no gap", "gap-free", "no out-of-pocket" → score +1

**Private Billing Signals:**
- "fee-for-service", "fee for service" → score +2
- "private fees" → score +1
- "private billing" → score +2

**Mixed Billing Signals:**
- "both bulk and private" (both keywords in same match) → score +1
- "mixed billing" → score +2

**Decision Logic:**
```
if bulk_score > private_score and bulk_score >= 1:
  return "Bulk"
elif private_score > bulk_score and private_score >= 1:
  return "Private"
elif mixed_score > 0 or (bulk_score > 0 and private_score > 0):
  return "Mixed"
else:
  return "Fallback to SA3-level BB%"
```

### Format Extraction

**Big-Box Signals (multi-location, chain, network):**
- "multi-clinic", "multi-provider", "clinic chain", "network", "group practice" → score +2
- "medical centre", "medical center", "medical hub", "medical group" → score +1
- "multiple locations", "branches", "franchise", "locations across" → score +2

**Small Practice Signals (independent, family, neighbourhood):**
- "family clinic", "family doctor", "family practice", "family medicine" → score +1
- "neighbourhood", "local GP", "independent practice", "sole trader", "independent-run" → score +1

**Decision Logic:**
```
if big_box_score > small_score and big_box_score >= 1:
  return "Big-box"
elif small_score > big_box_score and small_score >= 1:
  return "Small"
elif big_box_score > 0 or small_score > 0:
  return "Mid-format"  (some signals but ambiguous)
else:
  return "Unclassified"
```

### Ownership Extraction

**Corporate Signals:**
- Known corporate brands: MyHealth, Healius, Sonic, IPN, Eastbrooke, ForHealth, Primary Care, Medicore, Tristar, Affiliated Doctors, Pulse, ProMedico, Doctors Lounge, Healthpoint → score +1 each
- "Pty Ltd", "Pty Limited", "Proprietary Limited" → score +1
- "part of / affiliate / network of / member of + corporate brand" → score +1

**Decision Logic:**
```
if corporate_score >= 1:
  return "Corporate"
else:
  return "Independent"
```

---

## Known Limitations

### Imprecision (by design)
- "Medical centre" matches both big-box groups AND single big medical centres (ambiguous)
- "Gap-free" signals can occasionally appear in non-billing contexts
- Patterns are broad to maximize recall; **confidence levels compensate for this**

### Edge Cases
1. **"Private practice" as a format descriptor** — not extracted as billing signal (format vs. billing distinction)
2. **"Bulk and private" phrasing** — should trigger "Mixed" not double-count bulk
3. **Corporate networks described without brand names** — may be missed if pattern is too specific
4. **Unbranded subsidiary clinics** — default to "Independent" (ownership signals rely on brand recognition)

### Mitigations
1. Low-confidence scoring for ambiguous signals
2. Three-tier fallback: website signals → name keywords → SA3 level
3. Manual spot-checks of sample extractions post-scrape
4. ETL layer validates and applies confidence levels

---

## Validation Approach

Rather than obsessing over exact signal counts (which are brittle), validate **decision logic** instead:

```python
# What matters: clinic is correctly classified, not the score magnitude
test_cases = [
    {
        'clinic': 'MyHealth Sydney CBD',
        'expected_format': 'Big-box',
        'expected_billing': 'Mixed',
        'expected_ownership': 'Corporate'
    }
]
```

The ETL enrichment script handles confidence assignment based on:
- **High confidence:** Multiple strong signals from website text
- **Medium confidence:** Single clear signal OR multiple weak signals
- **Low confidence:** No website signals; falling back to SA3-level BB%

---

## Testing Script

Use `keyword_extraction_test.py` to validate patterns against sample websites:

```bash
python3 keyword_extraction_test.py
```

### Adding New Test Cases
When adding patterns or brands, add corresponding test cases to `TEST_CASES` list with expected signal dictionaries.

### Pattern Refinement
1. Run test suite
2. Review failures
3. Adjust patterns in `scrape_clinics_full.py`
4. Re-run test suite
5. Once patterns are stable, do spot-checks on real scraped output

---

## Known Corporate Brands (Australia)

| Brand | Status | Regions |
|-------|--------|---------|
| MyHealth | Major | National |
| Healius | Major | National |
| Sonic | Major | National |
| IPN | Major | National |
| Eastbrooke | Regional | VIC, TAS |
| ForHealth | Regional | NSW, QLD |
| Primary Care | Regional | WA, SA |
| Medicore | Regional | VIC |
| Tristar | Small | NSW |
| Affiliated Doctors | Small | Various |
| Pulse | Small | Various |

Note: This list is a starting point. As we process 7,880 clinics, we may discover additional brands to add.

---

## Post-Scrape Validation

After `scrape_clinics_full.py` completes, audit a random sample:

```bash
# Sample 50 scraped results
python3 -c "
import pandas as pd
import random
df = pd.read_csv('clinic_scrape_results.csv')
sample = df[df['status'] == 'success'].sample(n=min(50, len(df)))
# Manually spot-check 5-10 against their actual websites
"
```

**Validation checklist:**
- [ ] Billing signal matches website tone (bulk vs. private prominent language)
- [ ] Format signal matches website structure (multi-location footer, single location, etc.)
- [ ] Ownership signal matches website branding and corporate affiliation language
- [ ] No false positives (e.g., "no gap in our service" falsely triggering bulk billing)

---

## Future Improvements

1. **Dynamic brand discovery:** Scan all websites for unrecognized corporate names
2. **Context window expansion:** Extract larger text windows around signals for validation
3. **Exclusion patterns:** Add regex patterns to explicitly EXCLUDE false positives
4. **Clinic specialty signals:** Extract whether clinic specializes in bulk billing (common keyword pattern)
5. **Integration with business registration:** Cross-reference ownership with ASIC/ABN for validation
