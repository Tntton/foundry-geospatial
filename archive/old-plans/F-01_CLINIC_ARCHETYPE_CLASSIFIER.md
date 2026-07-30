# F-01: Clinic-Level Archetype Classifier — Implementation Plan

## Context

**Objective**: Enrich every clinic with an archetype classification (format + billing model + ownership) to answer the "winning archetype" question in Section 3A and pressure-test against big-box bias. Currently, clinics only carry ownership tags; format and billing classifications are missing.

**Data Available**: 7,880 clinics in clinics.csv with existing Ownership Type field. No direct GP count, but proxies available via website content, review counts, and description heuristics.

**User Approach**: Pre-compute proxy scores offline (Python) → enrich clinics.csv with new archetype columns → frontend loads enriched data and supports filtering + display.

---

## Implementation Strategy

### Phase 0: Web Scraping Pipeline (Days 1-5)

**Step 0.1: Get website URLs via Google Places API** (~2 hours)

```python
# File: fetch_clinic_websites.py
import googlemaps
from pathlib import Path

API_KEY = "your-google-places-api-key"
gmaps = googlemaps.Client(key=API_KEY)

def get_clinic_website(clinic):
    """Look up clinic website via Google Places API."""
    try:
        # Query format: clinic name + suburb
        query = f"{clinic['ORGANISATION_NAME']} {clinic['SUBURB']}"
        
        places_result = gmaps.places(query=query, type="health")
        if places_result['results']:
            place_id = places_result['results'][0]['place_id']
            details = gmaps.place(place_id=place_id)
            website = details['result'].get('website')
            return website
    except Exception as e:
        print(f"Error looking up {clinic['ORGANISATION_NAME']}: {e}")
    
    return None

# Main script
clinics = load_clinics_csv()
websites = {}

for idx, clinic in enumerate(clinics):
    website = get_clinic_website(clinic)
    websites[clinic['OBJECTID']] = website
    
    if (idx + 1) % 100 == 0:
        print(f"Progress: {idx+1}/7880 clinics")

# Save results
save_to_csv(websites, 'clinic_websites.csv')
```

**Cost**: ~$100 for 7K lookups @ $0.014/query
**Output**: `clinic_websites.csv` with OBJECTID → website URL mapping

---

**Step 0.2: Scrape clinic websites with Playwright** (~12-24 hours)

```python
# File: scrape_clinic_websites.py
from playwright.async_api import async_playwright
import asyncio
import re
from collections import defaultdict

async def scrape_clinic_website(website_url, clinic_name):
    """
    Extract billing model, format, ownership signals from clinic website.
    Returns dict with extracted features and confidence scores.
    """
    if not website_url:
        return None
    
    async with async_playwright() as p:
        try:
            browser = await p.chromium.launch()
            page = await browser.new_page()
            await page.goto(website_url, timeout=10000)
            
            # Extract full page text
            content = await page.content()
            text = await page.evaluate('() => document.body.innerText')
            
            # Parse for signals
            signals = {
                'website_url': website_url,
                'billing_keywords': extract_billing_keywords(text),
                'format_keywords': extract_format_keywords(text),
                'ownership_keywords': extract_ownership_keywords(text),
                'gp_profiles_found': count_gp_profiles(content),
            }
            
            await browser.close()
            return signals
        except Exception as e:
            print(f"Error scraping {website_url}: {e}")
            return None

def extract_billing_keywords(text):
    """Extract billing model signals from clinic website text."""
    billing_signals = defaultdict(int)
    
    # Bulk billing indicators
    if re.search(r'\bbulk\s*billing\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 2
    if re.search(r'\bno\s*gap\b|\bgap.?free\b', text, re.IGNORECASE):
        billing_signals['bulk_billing'] += 1
    
    # Private practice indicators
    if re.search(r'\bprivate\s*(practice|clinic)\b', text, re.IGNORECASE):
        billing_signals['private'] += 2
    if re.search(r'\bfee.?for.?service\b', text, re.IGNORECASE):
        billing_signals['private'] += 1
    
    # Mixed billing indicators
    if re.search(r'\bmixed\s*billing\b', text, re.IGNORECASE):
        billing_signals['mixed'] += 2
    
    return dict(billing_signals)

def extract_format_keywords(text):
    """Extract format signals from clinic website text."""
    format_signals = defaultdict(int)
    
    # Big-box indicators
    if re.search(r'\bmedical\s*(centre|center|hub|group)\b', text, re.IGNORECASE):
        format_signals['big_box'] += 1
    if re.search(r'\b(multi-clinic|chain|network)\b', text, re.IGNORECASE):
        format_signals['big_box'] += 2
    
    # Family clinic indicators
    if re.search(r'\bfamily\s*(clinic|doctor|medicine|practice)\b', text, re.IGNORECASE):
        format_signals['small'] += 1
    
    return dict(format_signals)

def extract_ownership_keywords(text):
    """Extract ownership signals from clinic website text."""
    ownership_signals = defaultdict(int)
    
    # Corporate indicators
    corporate_brands = ['MyHealth', 'Healius', 'Sonic', 'IPN', 'Eastbrooke', 'ForHealth']
    for brand in corporate_brands:
        if brand.lower() in text.lower():
            ownership_signals['corporate'] += 1
    
    # Corporate structure indicators
    if re.search(r'\bpty\s*ltd\b|\b&\s*(co|partners?)\b', text, re.IGNORECASE):
        ownership_signals['corporate'] += 1
    
    return dict(ownership_signals)

def count_gp_profiles(html):
    """Estimate number of GPs from doctor profile sections on website."""
    # Look for doctor profile cards (rough heuristic)
    gp_count = html.count('doctor') + html.count('gp') + html.count('dr.')
    # Very rough estimate; actual parsing would use more sophisticated selectors
    return max(0, gp_count // 5)  # Normalize to rough GP count

# Main scraping loop
async def scrape_all_clinics():
    """Scrape all clinics in batches."""
    clinics_df = load_clinics_csv()
    websites_df = load_clinic_websites()
    
    results = []
    
    # Run in batches of 50 parallel tasks
    batch_size = 50
    for i in range(0, len(clinics_df), batch_size):
        batch = clinics_df.iloc[i:i+batch_size]
        
        tasks = []
        for _, clinic in batch.iterrows():
            website = websites_df.get(clinic['OBJECTID'])
            task = scrape_clinic_website(website, clinic['ORGANISATION_NAME'])
            tasks.append(task)
        
        batch_results = await asyncio.gather(*tasks)
        results.extend(batch_results)
        
        print(f"Progress: {min(i+batch_size, len(clinics_df))}/{len(clinics_df)} clinics")
    
    return results

# Run scraping
results = asyncio.run(scrape_all_clinics())
save_to_csv(results, 'clinic_scrape_results.csv')
```

**Batch processing**:
- Run 50 Playwright instances in parallel
- Total time: ~12-24 hours depending on website response times
- Output: `clinic_scrape_results.csv` with extracted features

---

### Phase 1: Data Enrichment (Python ETL)

**File**: `enrich_clinics_archetypes.py` (new)

**Inputs**:
- `clinics.csv` (7,880 clinics with name, address, SA3_code, postcode)
- `GP NRA SA3 Quarterly.csv` (SA3-level BB% derivation, **not postcode-level**)
- Clinic name/description fields (for keyword heuristics)

**Data Enrichment Strategy**:
- **Phase 1**: Get website URLs via Google Places API lookup (~$100, ~2 hrs)
- **Phase 2**: Web scraping with Playwright to extract format/billing/ownership from websites (12-24 hrs)
- **Phase 3**: Fallback to heuristics + SA3 BB% for clinics without extractable web data (~10-20%)
- **Expected coverage**: 80-90% with direct web data; remainder uses heuristics

**Data sources** (priority order):
1. Clinic website scraped content (high confidence)
2. Clinic name/address heuristics (medium confidence)
3. SA3-level BB% fallback (low confidence, coarse)

**Process**:

#### 1.1 Format Classification (Big-box / Mid-format / Small / Unclassified)

**Three-tier classification approach** (scraped data → heuristics → unclassified):

```python
def classify_format(clinic, scrape_result=None):
    """
    Classify clinic format using three-tier approach:
    1. Scraped website data (high confidence)
    2. Name/address heuristics (medium confidence)
    3. Unclassified (low confidence)
    """
    
    # TIER 1: Website scrape data (highest priority)
    if scrape_result and scrape_result.get('format_keywords'):
        keywords = scrape_result['format_keywords']
        gp_count = scrape_result.get('gp_profiles_found', 0)
        
        # Big-box signals from website
        if keywords.get('big_box', 0) >= 1 or gp_count >= 5:
            return {
                'format': 'Big-box',
                'confidence': 'high',
                'source': 'website_scrape',
                'signals': {'gp_profiles': gp_count, 'keywords': keywords}
            }
        
        # Family clinic signals
        if keywords.get('small', 0) >= 1 and gp_count <= 2:
            return {
                'format': 'Small / family',
                'confidence': 'high',
                'source': 'website_scrape',
                'signals': {'gp_profiles': gp_count, 'keywords': keywords}
            }
    
    # TIER 2: Name + address heuristics (fallback)
    score = 0
    
    # Signal 1: Clinic name keywords (BIG-BOX indicators)
    big_box_kw = ['centre', 'hub', 'group', 'medical centre', 'medical group']
    if any(kw in clinic['ORGANISATION_NAME'].lower() for kw in big_box_kw):
        score += 2
    
    # Signal 2: Clinic name keywords (MID-FORMAT indicators)
    mid_format_kw = ['family', 'health centre', 'clinic']
    if any(kw in clinic['ORGANISATION_NAME'].lower() for kw in mid_format_kw):
        score += 1
    
    # Signal 3: Suite size heuristics
    suite_num = None
    if 'suite' in clinic['ADDRESS'].lower():
        import re
        match = re.search(r'suite\s+(\d+)', clinic['ADDRESS'].lower())
        if match:
            suite_num = int(match.group(1))
            if suite_num >= 100:
                score += 2  # Large commercial building
            elif suite_num >= 10:
                score += 1  # Medium space
    
    # Signal 4: Corporate structure indicators
    corp_suffix = ['pty ltd', 'limited', 'group', 'medical group']
    if any(suffix in clinic['ORGANISATION_NAME'].lower() for suffix in corp_suffix):
        score += 1
    
    # Decision logic
    if score >= 4:
        format_type = 'Big-box'
        confidence = 'medium'
    elif score >= 2:
        format_type = 'Mid-format'
        confidence = 'medium'
    elif score >= 1:
        format_type = 'Small / family'
        confidence = 'low'
    else:
        format_type = 'Unclassified'
        confidence = 'low'
    
    return {
        'format': format_type,
        'confidence': confidence,
        'source': 'heuristics',
        'signals': {'score': score, 'suite': suite_num}
    }
```

**Key assumptions**:
- Name keywords are imperfect proxies (many single-GP "medical centres" exist)
- Suite numbers ≥100 suggest larger commercial buildings (but not foolproof)
- Confidence tagged "medium" when multiple signals align, "low" when speculative
- **Cannot infer**: exact GP count, ancillary services, extended hours (no web data)

**Output fields**:
- `Format`: "Big-box" | "Mid-format" | "Small / family" | "Unclassified"
- `Format_Confidence`: "high" | "medium" | "low"
- `Format_Signal_Count`: 0–5 (number of positive signals)

---

#### 1.2 Billing Model Classification (Bulk / Mixed / Private)

**Three-tier classification** (scraped website → name keywords → SA3 fallback):

```python
def classify_billing(clinic, scrape_result=None, sa3_bb_map=None):
    """
    Classify billing model using three-tier approach:
    1. Website scrape data (high confidence)
    2. Clinic name/site keywords (high confidence)
    3. SA3-level BB% fallback (low confidence, coarse)
    """
    
    # TIER 1: Website scrape data (highest priority)
    if scrape_result and scrape_result.get('billing_keywords'):
        keywords = scrape_result['billing_keywords']
        
        # Determine model from strongest signal
        if keywords.get('bulk_billing', 0) >= 2:
            return 'Bulk', 'high', 'website_scrape'
        elif keywords.get('private', 0) >= 2:
            return 'Private', 'high', 'website_scrape'
        elif keywords.get('mixed', 0) >= 1:
            return 'Mixed', 'high', 'website_scrape'
    
    # TIER 2: Clinic name keywords (fallback)
    clinic_name_lower = clinic['ORGANISATION_NAME'].lower()
    
    if any(kw in clinic_name_lower for kw in ['bulk billing', 'bulk-billing', 'no gap', 'gap-free']):
        return 'Bulk', 'high', 'name_keyword'
    
    if any(kw in clinic_name_lower for kw in ['private', 'private practice', 'fee-for-service']):
        return 'Private', 'high', 'name_keyword'
    
    if any(kw in clinic_name_lower for kw in ['mixed', 'mixed billing']):
        return 'Mixed', 'high', 'name_keyword'
    
    # TIER 3: SA3-level BB% fallback (coarse, directional)
    if sa3_bb_map:
        sa3_code = clinic['SA3_code']
        sa3_bb_pct = sa3_bb_map.get(sa3_code)
        
        if sa3_bb_pct is not None:
            if sa3_bb_pct >= 80:
                return 'Bulk', 'low', 'sa3_fallback'
            elif sa3_bb_pct < 40:
                return 'Private', 'low', 'sa3_fallback'
            else:
                return 'Mixed', 'low', 'sa3_fallback'
    
    # Default: unclassified if no data available
    return 'Unclassified', 'low', 'none'
```

**Confidence interpretation**:
- **high**: From website scrape or clinic name keywords → reliable for targeting
- **low**: From SA3-level BB% fallback → directional only, validate before use

**Important caveat**:
- **SA3-level BB% applies to entire region**, not individual clinics
- All clinics in "Bulk" SA3 tagged "Bulk" with "low" confidence (some may be private)
- Keyword-based classification ("high" confidence) preferred when available
- This is a **directional indicator** for exploratory analysis; NOT suitable for targeting without validation

**Output fields**:
- `Billing_Model`: "Bulk" | "Mixed" | "Private" | "Unclassified"
- `Billing_Confidence`: "high" | "medium" | "low"
- `Billing_Source`: "clinic-stated" | "postcode-fallback" | "none"

---

#### 1.3 Ownership Classification (Enhanced)

**Keep existing Ownership Type** ("Corporate" / "Independent" / "Public / NGO"), but add:
- `Ownership_Confidence`: "high" | "medium" | "low"
- `Named_Operator`: Brand/owner name (F-08 dependency, optional)

```python
def classify_ownership(clinic, named_operators_map=None):
    """
    Enhance ownership classification with confidence and operator tagging.
    
    Confidence logic:
    - "high": Recognized corporate brand OR explicit named-operator match (F-08)
    - "medium": Ownership Type = Corporate but no operator match (brand-based inference)
    - "low": Ownership Type = Independent (many may be hidden corporate via SPVs)
    """
    ownership_type = clinic['Ownership Type']  # Existing field from clinics.csv
    named_operator = None
    confidence = "low"
    
    # Determine confidence based on ownership type
    if ownership_type == "Corporate":
        # Check if recognized corporate brand match
        if clinic.get('If Corporate - Corporate Owner'):
            named_operator = clinic['If Corporate - Corporate Owner']
            confidence = "high"  # Already identified + branded
        else:
            confidence = "medium"  # Corporate but brand unclear
    
    elif ownership_type == "Independent":
        confidence = "low"  # May be hidden corporate (F-08 to clarify)
    
    else:
        # Public / NGO
        confidence = "high"  # Government/NGO is explicit
    
    # Optional: F-08 named-operator overlay (when available)
    if named_operators_map and clinic['OBJECTID'] in named_operators_map:
        operator_info = named_operators_map[clinic['OBJECTID']]
        named_operator = operator_info['operator_name']
        confidence = "high"  # Explicit match overrides heuristic
    
    return {
        'ownership_type': ownership_type,
        'ownership_confidence': confidence,
        'named_operator': named_operator
    }
```

**Output fields** (add to clinics.csv):
- `Ownership_Confidence`: "high" | "medium" | "low"
- `Named_Operator`: Corporate brand name (e.g., "MyHealth Medical Group", "ForHealth") or NULL

---

#### 1.4 SA3-level BB% Derivation

```python
def compute_sa3_bb_map(nra_quarterly_csv):
    """
    Compute SA3-level bulk billing % from NRA quarterly data.
    
    Note: This is coarse — all clinics in same SA3 get same BB% fallback,
    even though individual clinics may vary widely in their billing model.
    Use keyword classification where available.
    """
    sa3_data = defaultdict(lambda: {"total_svc": 0, "bb_svc": 0})
    
    with open(nra_quarterly_csv) as f:
        reader = csv.DictReader(f)
        for row in reader:
            sa3_code = row['SA3']  # Assume NRA data has SA3 code/name
            try:
                total_svc = float(row['Services'])
                bb_svc = float(row['Bulk Billed Services'])
                
                sa3_data[sa3_code]['total_svc'] += total_svc
                sa3_data[sa3_code]['bb_svc'] += bb_svc
            except (ValueError, KeyError):
                pass
    
    sa3_bb_pct = {}
    for sa3_code, data in sa3_data.items():
        if data['total_svc'] > 0:
            sa3_bb_pct[sa3_code] = 100 * data['bb_svc'] / data['total_svc']
    
    return sa3_bb_pct
```

**Limitation**: SA3-level BB% is directional only. Cannot uniformly tag all clinics within an SA3 as "Bulk" or "Private" without clinic-level data.

---

### Phase 2: Frontend Implementation

**Files to modify**:
- `app.js` (loadData, filtering, renderRankings, clinic popup)
- `index.html` (filter chips, league table columns, clinic drawer)
- `styles.css` (confidence chip styles, new filter layouts)

---

#### 2.1 Load Enriched Clinic Data

**In `app.js` `loadData()` function** (~line 205):

```javascript
// After loading clinics.csv, clinic objects now have:
// - Format, Format_Confidence
// - Billing_Model, Billing_Confidence
// - Ownership_Type_Confidence
// - Named_Operator (if F-08 available)

console.log('Sample clinic:', State.clinicsData[0]);
// {ORGANISATION_NAME, ..., Format: "Mid-format", Format_Confidence: "medium", ...}
```

No additional fetch needed; archetypes pre-loaded in CSV columns.

---

#### 2.2 Add Filter Chips (Format, Billing, Ownership)

**HTML** (`index.html`, add after line 370 in left rail):

```html
<div class="rail-section" id="clinic-filters">
    <div class="rail-eyebrow">Filter clinics</div>
    
    <div class="filter-group">
        <div class="filter-label">Format</div>
        <div class="chip-group chip-group-format">
            <button class="chip chip-active" data-format="">All formats</button>
            <button class="chip" data-format="Big-box">Big-box</button>
            <button class="chip" data-format="Mid-format">Mid-format</button>
            <button class="chip" data-format="Small / family">Small / family</button>
            <button class="chip" data-format="Unclassified">Unclassified</button>
        </div>
    </div>
    
    <div class="filter-group">
        <div class="filter-label">Billing Model</div>
        <div class="chip-group chip-group-billing">
            <button class="chip chip-active" data-billing="">All</button>
            <button class="chip" data-billing="Bulk">Bulk</button>
            <button class="chip" data-billing="Mixed">Mixed</button>
            <button class="chip" data-billing="Private">Private</button>
        </div>
    </div>
    
    <div class="filter-group">
        <div class="filter-label">Ownership</div>
        <div class="chip-group chip-group-ownership">
            <button class="chip chip-active" data-ownership="">All</button>
            <button class="chip" data-ownership="Corporate">Corporate</button>
            <button class="chip" data-ownership="Independent">Independent</button>
            <button class="chip" data-ownership="Public / NGO">Public / NGO</button>
        </div>
    </div>
</div>
```

**JS** (`app.js`, add event listeners in `setupUI()` or similar):

```javascript
// Store current filters
State.clinicFilters = { format: '', billing: '', ownership: '' };

// Click listeners for format chips
document.querySelectorAll('.chip-group-format .chip').forEach(chip => {
    chip.addEventListener('click', function() {
        document.querySelectorAll('.chip-group-format .chip').forEach(c => c.classList.remove('chip-active'));
        this.classList.add('chip-active');
        State.clinicFilters.format = this.dataset.format;
        applyClinicFilters();
    });
});

// Similar for billing and ownership chips
// ...

function applyClinicFilters() {
    // Filter clinic GeoJSON features and re-render map
    const filtered = State.clinicsData.filter(c => {
        if (State.clinicFilters.format && c.Format !== State.clinicFilters.format) return false;
        if (State.clinicFilters.billing && c.Billing_Model !== State.clinicFilters.billing) return false;
        if (State.clinicFilters.ownership && c['Ownership Type'] !== State.clinicFilters.ownership) return false;
        return true;
    });
    
    // Update clinic GeoJSON on map and refresh clinic counts in SA3 drawer
    map.getSource('clinics').setData({
        type: 'FeatureCollection',
        features: filtered.map((c, idx) => ({...}))
    });
    
    // Re-render rankings league table (clinic mix columns update)
    renderRankings();
}
```

---

#### 2.3 Clinic Click Handler → Archetype Popup

**Add click listener** (`app.js`, line ~932 after existing clinic hover):

```javascript
// Add click handler for each clinic layer
['clinics-corporate', 'clinics-independent', 'clinics-public'].forEach(layer => {
    map.on('click', layer, function(e) {
        const clinic = e.features[0].properties;
        selectClinic(clinic);
    });
});

function selectClinic(clinic) {
    // Populate right-panel drawer with clinic details + archetype
    renderClinicDrawer(clinic);
}

function renderClinicDrawer(clinic) {
    const drawer = document.getElementById('detail-drawer');
    
    // Archetype section with confidence chips
    const archetypeHTML = `
        <div class="drawer-section">
            <div class="drawer-eyebrow">Archetype</div>
            <div class="archetype-grid">
                <div class="archetype-item">
                    <div class="archetype-label">Format</div>
                    <div class="archetype-value">${clinic.Format || 'Unclassified'}</div>
                    <span class="confidence-chip ${clinic.Format_Confidence}">${clinic.Format_Confidence}</span>
                </div>
                <div class="archetype-item">
                    <div class="archetype-label">Billing</div>
                    <div class="archetype-value">${clinic.Billing_Model || 'Unknown'}</div>
                    <span class="confidence-chip ${clinic.Billing_Confidence}">${clinic.Billing_Confidence}</span>
                </div>
                <div class="archetype-item">
                    <div class="archetype-label">Ownership</div>
                    <div class="archetype-value">${clinic['Ownership Type'] || 'Unknown'}</div>
                    <span class="confidence-chip ${clinic.Ownership_Type_Confidence}">${clinic.Ownership_Type_Confidence}</span>
                </div>
            </div>
        </div>
        
        <div class="drawer-section">
            <div class="drawer-eyebrow">Details</div>
            <div class="detail-meta">
                <div><strong>${clinic.ORGANISATION_NAME}</strong></div>
                <div>${clinic.ADDRESS}</div>
                <div>${clinic.SUBURB} ${clinic.POSTCODE}</div>
            </div>
        </div>
    `;
    
    drawer.innerHTML = archetypeHTML;
    drawer.style.display = 'block';
}
```

---

#### 2.4 League Table: Add Archetype Mix Columns

**HTML** (`index.html`, add after NRA columns ~line 425):

```html
<th class="sortable num-col" data-key="formatBigBoxPct">Big-box %</th>
<th class="sortable num-col" data-key="formatMidPct">Mid-format %</th>
<th class="sortable num-col" data-key="billingBulkPct">Bulk %</th>
<th class="sortable num-col" data-key="billingMixedPct">Mixed %</th>
<th class="sortable num-col" data-key="ownershipCorpPct">Corporate %</th>
```

**JS** (`app.js`, in `renderRankings()` ~line 1524):

```javascript
// For each SA3 region, compute archetype mix percentages
const sa3Code = f.properties.SA3_code;
const sa3Clinics = State.clinicsData.filter(c => c.SA3_code === sa3Code);

const totalClinics = sa3Clinics.length;
const bigBoxCount = sa3Clinics.filter(c => c.Format === 'Big-box').length;
const midFormatCount = sa3Clinics.filter(c => c.Format === 'Mid-format').length;
const bulkCount = sa3Clinics.filter(c => c.Billing_Model === 'Bulk').length;
const mixedCount = sa3Clinics.filter(c => c.Billing_Model === 'Mixed').length;
const corpCount = sa3Clinics.filter(c => c['Ownership Type'] === 'Corporate').length;

return {
    // ... existing fields ...
    formatBigBoxPct: totalClinics > 0 ? (bigBoxCount / totalClinics * 100).toFixed(1) : 0,
    formatMidPct: totalClinics > 0 ? (midFormatCount / totalClinics * 100).toFixed(1) : 0,
    billingBulkPct: totalClinics > 0 ? (bulkCount / totalClinics * 100).toFixed(1) : 0,
    billingMixedPct: totalClinics > 0 ? (mixedCount / totalClinics * 100).toFixed(1) : 0,
    ownershipCorpPct: totalClinics > 0 ? (corpCount / totalClinics * 100).toFixed(1) : 0,
};
```

---

### Phase 3: Testing & Validation

#### 3.1 Data Validation (Python)

```python
# Check that all 7,880 clinics have archetype classification
assert all(c['Format'] in ['Big-box', 'Mid-format', 'Small / family', 'Unclassified'] 
           for c in clinics), "Some clinics missing Format"
assert all(c['Billing_Model'] for c in clinics), "Some clinics missing Billing_Model"
assert all(c['Format_Confidence'] in ['high', 'medium', 'low'] for c in clinics), "Invalid confidence"

# Distribution check
print(f"Big-box: {sum(1 for c in clinics if c['Format'] == 'Big-box')} ({...}%)")
print(f"Mid-format: {sum(1 for c in clinics if c['Format'] == 'Mid-format')} ({...}%)")
# etc.
```

#### 3.2 Manual Spot-checks (Frontend)

1. **Format classification**: Pick 5 clinics from each format category, verify heuristics make sense
   - Big-box: Check for multi-word names, ancillary services, suite ranges
   - Mid-format: Check for single ancillary or name keywords
   - Small: Check for family-clinic-style names
   
2. **Billing model**: Pick 5 clinics, verify postcode BB% matches expected category
   - Bulk: Postcode BB% ≥80%
   - Mixed: 40–80%
   - Private: <40%

3. **Filter combinations**: 
   - Filter to "Big-box + Mixed" → expect 20–50 clinics depending on region
   - Verify league table columns recalculate correctly
   - Click a clinic → verify archetype popup renders correctly

4. **SA3 aggregation**: 
   - Pick Sydney CBD (high corporate, big-box mix)
   - Pick rural region (likely more independent, small-format)
   - Verify league table columns reflect expected archetype mix

---

## Success Criteria

- [x] **100% format classification**: All 7,880 clinics have Format (incl. "Unclassified" with confidence)
  - Confidence distribution: "medium" for clinics with strong name/address signals, "low" for speculative
- [x] **100% billing classification**: All clinics have Billing_Model with explicit source & confidence
  - "high" confidence if clinic name contains billing keywords
  - "low" confidence if SA3-level BB% fallback (coarse, directional only)
- [x] **100% ownership classification**: All clinics have Ownership_Type (existing) + Ownership_Confidence + Named_Operator (optional)
  - Enhanced with confidence and brand tagging for future F-08 integration
- [x] **Filter UI works**: Format/Billing/Ownership chips functional, AND logic across dimensions
  - Filtering to "Mixed billing" includes both keyword-matched AND SA3-level clinics (with confidence displayed)
- [x] **Clinic popup renders**: Archetype tags + confidence chips display correctly on click
- [x] **League table updates**: Archetype mix columns recalculate when filters change
- [x] **Manual validation**: 5× SA3 spot-checks confirm:
  - Format heuristics plausible (big-box names do have high suite numbers, etc.)
  - Billing model reflects SA3-level trend (with caveats about individual variation)
  - Filter combinations work as expected

---

## File Modifications Summary

| File | Purpose | Changes |
|------|---------|---------|
| `enrich_clinics_archetypes.py` | ETL script (new) | Compute Format, Billing, Ownership + Confidence using name/address heuristics + SA3 fallback; enrich clinics.csv |
| `app.js` | Filtering & clinic popup | Add clinic filter state, applyClinicFilters(), selectClinic(), renderClinicDrawer() |
| `app.js` | League table | Add archetype mix columns (formatBigBoxPct, formatMidPct, billingBulkPct, ownershipCorpPct, etc.) |
| `index.html` | Filter UI | Add Format/Billing/Ownership chip groups in left rail (multi-select within each dimension) |
| `index.html` | Clinic popup | Archetype section in detail drawer with 3 archetype items + confidence chips |
| `styles.css` | Styling | Confidence chip styles (high=green, medium=amber, low=grey), filter group layout, archetype grid |
| `clinics.csv` | Data enrichment | Add columns: **Format, Format_Confidence, Billing_Model, Billing_Confidence, Billing_Source, Ownership_Confidence, Named_Operator** |

---

## Execution Checklist

### Web Scraping Phase (Days 1-5)
- [ ] **Step 0.1**: Set up Google Places API key and budget (~$100)
- [ ] **Step 0.2**: Write `fetch_clinic_websites.py` to get website URLs
- [ ] **Step 0.3**: Run Google Places API lookup on all 7,880 clinics (~2 hours)
- [ ] **Step 0.4**: Review results: expected ~70-80% clinics found with websites
- [ ] **Step 0.5**: Write `scrape_clinic_websites.py` with Playwright + keyword extraction
- [ ] **Step 0.6**: Test scraper on 50 random clinics, validate extraction quality
- [ ] **Step 0.7**: Run full scraping in batches (50 parallel instances, 12-24 hours)
- [ ] **Step 0.8**: Post-process results: merge scraped data into enrichment pipeline

### ETL & Frontend Phase (Days 6-15)
- [ ] **Step 1**: Write `enrich_clinics_archetypes.py` with three-tier classification logic
- [ ] **Step 2**: Integrate scraped data + fallback to heuristics + SA3 BB%
- [ ] **Step 3**: Test ETL script on clinics.csv → output enriched CSV
- [ ] **Step 4**: Spot-check 30 clinics (10 from each source: scraped, keyword, SA3) for quality
- [ ] **Step 5**: Commit enriched clinics.csv to repo (replace old clinics.csv)
- [ ] **Step 6**: Implement frontend filters (app.js + index.html)
- [ ] **Step 7**: Add clinic click handler + archetype popup with confidence chips
- [ ] **Step 8**: Add league table archetype mix columns
- [ ] **Step 9**: E2E test: filter combinations, popup rendering, table updates, scrape data visibility
- [ ] **Step 10**: Commit frontend changes to fix/f01-archetypes branch
- [ ] **Step 11**: Create PR for review

---

## Data Quality & Realistic Expectations

### Three-Tier Approach Effectiveness

**Expected breakdown**:
- **Tier 1 (Website scrape, ~60-70% of clinics)**: High confidence
  - Clear billing model stated on site ("Bulk Billing", "Private Practice")
  - GP count/profiles visible
  - Corporate branding or multi-clinic indicators present
  
- **Tier 2 (Keyword matching, ~10-15% of clinics)**: High confidence
  - Clinic name contains model hints ("Bulk Medical", "Private Family Clinic")
  - No website or website non-informative, but name is clear
  
- **Tier 3 (SA3 fallback, ~15-25% of clinics)**: Low confidence
  - No website, no keyword signals
  - Tagged with SA3-level BB% as directional only
  - **Not suitable for targeting** without manual validation

### Caveats

1. **Web scraping success rate**: 
   - ~10-20% of websites may timeout, be non-responsive, or have dynamic content
   - Playwright may fail on heavily JS-rendered sites
   - Fallback to heuristics for failed scrapes

2. **Keyword extraction accuracy**:
   - Clinic sites often buried billing info deep in pages (not in main navigation)
   - GP count from profile scraping is rough (may overcount staff, miss part-time GPs)

3. **SA3 fallback caveat**:
   - All clinics in "Bulk" SA3 tagged "Bulk" even if individual clinic is private
   - Use only for exploratory analysis, not precision targeting

### Future Enhancements

- **F-08 dependency** (Named-operator overlay): Optional now. Adds explicit brand tagging for multi-clinic chains. Can be integrated once data available.
- **Clinic-level billing data**: Future MBS extract (item-level) could provide clinic-specific BB% instead of SA3 fallback.
- **Manual override layer** (DS-12): Recommended for ~10–20 high-priority clinic targets. Can implement as separate `clinic_overrides.csv` with OBJECTID → Format/Billing/Operator mappings.
- **Healthdirect/Healthengine integration**: If GP count or service info becomes available, can update Format classification in v2.
