#!/usr/bin/env python3
"""Enrich sa3_scored.geojson with NRA billing metrics from quarterly MBS data.

Rolling 4-quarter window: uses the latest 4 quarters from GP NRA SA3 Quarterly.csv.
3-year CAGR: compares rolling 4Q ending latest quarter vs same 4Q ending 3 years prior.
Coverage: all 8 states/territories (file uses mixed-case abbreviations: Vic, Qld, Tas).
"""
import csv, json, math
from collections import defaultdict

# ── Config ────────────────────────────────────────────────────────────────────
QUARTERLY_FILE = 'GP NRA SA3 Quarterly.csv'
UCC_FILE       = 'UCC_Directory.csv'
GEOJSON_FILE   = 'data/sa3_scored.geojson'

# File uses mixed-case abbreviations (NSW, Vic, Qld, Tas etc.)
# Normalise to uppercase for lookup
STATE_MAP = {
    'NSW': 'New South Wales',
    'VIC': 'Victoria',
    'QLD': 'Queensland',
    'SA':  'South Australia',
    'WA':  'Western Australia',
    'TAS': 'Tasmania',
    'ACT': 'Australian Capital Territory',
    'NT':  'Northern Territory',
}
# Accept any case variant
STATE_ABBRS = set(STATE_MAP.keys())

def norm_state(s):
    """Normalise 'Vic' → 'VIC', 'Qld' → 'QLD' etc."""
    return s.strip().upper()

# Quarter ordering for sorting (fiscal year, quarter number)
def quarter_sort_key(q):
    """Convert '2025-26 Q2 (Dec Qtr)' → (2025, 2) for sorting."""
    # Extract year and quarter number
    parts = q.split()
    fy = parts[0]          # e.g. '2025-26'
    qn = int(parts[1][1])  # e.g. 2
    yr = int(fy.split('-')[0])
    return (yr, qn)

# ── Mapping: combined NRA SA3 names → constituent SA3 names in geojson ────────
COMBINED_MAP = {
    ('Australian Capital Territory', 'Tuggeranong & Uriarra - Namadgi'): [
        ('Australian Capital Territory', 'Tuggeranong'),
        ('Australian Capital Territory', 'Uriarra - Namadgi'),
    ],
    ('New South Wales', 'Blue Mountains & Blue Mountains - South'): [
        ('New South Wales', 'Blue Mountains'),
        ('New South Wales', 'Blue Mountains - South'),
    ],
    ('New South Wales', 'Port Macquarie & Lord Howe Island'): [
        ('New South Wales', 'Port Macquarie'),
    ],
    ('New South Wales', 'Wollongong & Illawarra Catchment Reserve'): [
        ('New South Wales', 'Wollongong'),
        ('New South Wales', 'Illawarra Catchment Reserve'),
    ],
}

# ── Parse quarterly file ──────────────────────────────────────────────────────
print('Parsing quarterly NRA file…')
quarterly = defaultdict(lambda: defaultdict(dict))
# quarterly[(state_full, sa3)][quarter] = {metrics}

with open(QUARTERLY_FILE, encoding='latin-1') as f:
    reader = csv.reader(f)
    rows = list(reader)

header_row_idx = 4
headers = [h.strip() for h in rows[header_row_idx]]

def col(name):
    return headers.index(name)

def parse_num(s):
    try:
        return float(str(s).strip().replace(',', '').replace('$', '').replace('%', '').replace(' ', ''))
    except (ValueError, AttributeError):
        return None

# Column indices
c_state   = col('State')
c_sa3     = col('SA3')
c_qt      = col('Quarter')
c_svc     = col('Services')
c_benefits = col('Benefits ($)')
c_bb_svc  = col('Bulk Billed Services')
c_bb_rate = col('MBS Bulk Billing Rate (%)')
c_fee     = col('Fee Charged ($)')
c_oop     = col('Out of Pocket ($)')

all_quarters = set()

for r in rows[header_row_idx + 1:]:
    if len(r) <= c_fee:
        continue
    state_abbr = norm_state(r[c_state])   # normalise Vic→VIC, Qld→QLD etc.
    if state_abbr not in STATE_ABBRS:
        continue
    sa3 = r[c_sa3].strip()
    # Skip state-level aggregate rows (SA3 field contains state name/abbr)
    if not sa3 or norm_state(sa3) in STATE_ABBRS or sa3 == 'Australia':
        continue
    qt = r[c_qt].strip()
    if not qt:
        continue

    state_full = STATE_MAP[state_abbr]
    key = (state_full, sa3)
    all_quarters.add(qt)

    quarterly[key][qt] = {
        'services':  parse_num(r[c_svc]),
        'benefits':  parse_num(r[c_benefits]),
        'bb_svc':    parse_num(r[c_bb_svc]),
        'bb_rate':   parse_num(r[c_bb_rate]),
        'fee':       parse_num(r[c_fee]),
        'oop':       parse_num(r[c_oop]),
    }

# Sort quarters
sorted_quarters = sorted(all_quarters, key=quarter_sort_key)
print(f'  {len(sorted_quarters)} quarters found: {sorted_quarters[0]} → {sorted_quarters[-1]}')
print(f'  {len(quarterly)} NRA SA3 entries')

# Expand combined names into constituent SA3s
for combined_key, geo_keys in COMBINED_MAP.items():
    if combined_key in quarterly:
        for geo_key in geo_keys:
            n = len(geo_keys)
            for qt, metrics in quarterly[combined_key].items():
                quarterly[geo_key][qt] = {
                    k: (v / n if v is not None else None)
                    for k, v in metrics.items()
                }

# ── Define rolling windows ────────────────────────────────────────────────────
latest_4q = sorted_quarters[-4:]         # most recent 4 quarters
prior_4q  = sorted_quarters[-16:-12]     # same 4Q from 3 years prior

print(f'  Latest 4Q: {latest_4q[0]} → {latest_4q[-1]}')
print(f'  Prior  4Q: {prior_4q[0]} → {prior_4q[-1]}')

def sum_metrics(qt_dict, quarters):
    """Sum metrics across the given quarters. Returns None if any are missing."""
    totals = {'services': 0, 'benefits': 0, 'bb_svc': 0, 'fee': 0, 'oop': 0}
    for q in quarters:
        if q not in qt_dict:
            return None
        m = qt_dict[q]
        if any(m.get(k) is None for k in totals):
            return None
        for k in totals:
            totals[k] += m[k]
    return totals

def bb_rate_avg(qt_dict, quarters):
    """Weighted average BB rate across quarters."""
    total_svc = 0; total_bb = 0
    for q in quarters:
        if q not in qt_dict:
            return None
        m = qt_dict[q]
        if m.get('services') is None or m.get('bb_svc') is None:
            return None
        total_svc += m['services']
        total_bb  += m['bb_svc']
    return 100 * total_bb / total_svc if total_svc > 0 else None

def cagr(current, prior, years=3):
    if current is None or prior is None or prior == 0 or current < 0:
        return None
    return (math.pow(current / prior, 1.0 / years) - 1) * 100

# ── Build enriched lookup per geojson SA3 ────────────────────────────────────
enriched = {}

for key, qt_data in quarterly.items():
    # Skip combined names (already expanded above)
    if key in COMBINED_MAP:
        continue

    latest = sum_metrics(qt_data, latest_4q)
    prior  = sum_metrics(qt_data, prior_4q)

    if latest is None:
        continue

    services = latest['services']
    fee      = latest['fee']
    oop      = latest['oop']
    bb       = bb_rate_avg(qt_data, latest_4q)

    fees_per_service = fee / services if services > 0 else None

    # 3-year CAGR calculations
    cagr_fee = None
    cagr_bb  = None
    if prior is not None and prior['fee'] > 0:
        cagr_fee = cagr(fee, prior['fee'])
    if prior is not None:
        prior_bb = bb_rate_avg(qt_data, prior_4q)
        if prior_bb is not None and prior_bb > 0:
            cagr_bb = cagr(bb, prior_bb) if bb is not None else None

    enriched[key] = {
        'NRA_Services_Count':      round(services),
        'NRA_Total_Fees':          round(fee, 2),
        'NRA_Fees_Per_Service':    round(fees_per_service, 2) if fees_per_service else None,
        'NRA_BB_Rate':             round(bb, 1) if bb is not None else None,
        'NRA_Out_of_Pocket':       round(oop, 2),
        'NRA_Fee_Charged_CAGR':    round(cagr_fee, 2) if cagr_fee is not None else None,
        'NRA_BB_Rate_CAGR':        round(cagr_bb, 2) if cagr_bb is not None else None,
    }

print(f'\n  Enriched {len(enriched)} SA3s with rolling 4Q metrics')

# ── Compute percentile scores (0–100) ─────────────────────────────────────────
def percentile_rank(values_dict, key):
    """Return dict {sa3_key: percentile_0_100} for a given metric key, ignoring None."""
    vals = [(k, v[key]) for k, v in values_dict.items() if v.get(key) is not None]
    if not vals:
        return {}
    vals.sort(key=lambda x: x[1])
    n = len(vals)
    return {k: round(100 * i / (n - 1)) if n > 1 else 50 for i, (k, _) in enumerate(vals)}

pct_fees_per_service = percentile_rank(enriched, 'NRA_Fees_Per_Service')
pct_total_fees       = percentile_rank(enriched, 'NRA_Total_Fees')
pct_fee_cagr         = percentile_rank(enriched, 'NRA_Fee_Charged_CAGR')
pct_bb_cagr          = percentile_rank(enriched, 'NRA_BB_Rate_CAGR')

for key in enriched:
    enriched[key]['NRA_Score_Fees_Per_Service'] = pct_fees_per_service.get(key)
    enriched[key]['NRA_Score_Total_Fees']       = pct_total_fees.get(key)
    enriched[key]['NRA_Score_Fee_CAGR']         = pct_fee_cagr.get(key)
    enriched[key]['NRA_Score_BB_CAGR']          = pct_bb_cagr.get(key)

# ── Parse UCC directory → spatial join to SA3 ────────────────────────────────
# We tag SA3s as UCC_Present=True if any UCC coordinate falls within their polygon.
# Approximate approach: parse UCC coordinates, load geojson polygons, check containment.
print('\nParsing UCC directory…')
ucc_points = []
with open(UCC_FILE, encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            lon = float(row['Longitude'])
            lat = float(row['Latitude'])
            ucc_points.append((lon, lat, row.get('Clinic Name', '')))
        except (ValueError, KeyError):
            pass
print(f'  {len(ucc_points)} UCC locations loaded')

# Point-in-polygon: shapely if available, else skip
ucc_sa3_set = set()
try:
    from shapely.geometry import shape, Point
    print('  Running spatial join…')
    with open(GEOJSON_FILE) as f:
        gj = json.load(f)
    for feat in gj['features']:
        try:
            poly = shape(feat['geometry'])
            for lon, lat, name in ucc_points:
                if poly.contains(Point(lon, lat)):
                    ucc_sa3_set.add((feat['properties']['State'], feat['properties']['SA3Name']))
                    break
        except Exception:
            pass
    print(f'  {len(ucc_sa3_set)} SA3s with ≥1 UCC')
except ImportError:
    print('  shapely not available — UCC_Present will be False for all')

# ── Load and enrich GeoJSON ───────────────────────────────────────────────────
print('\nEnriching sa3_scored.geojson…')
with open(GEOJSON_FILE) as f:
    gj = json.load(f)

covered = 0
missing_states = set()
for feat in gj['features']:
    p = feat['properties']
    key = (p['State'], p['SA3Name'])

    nra = enriched.get(key)
    if nra:
        covered += 1
        for k, v in nra.items():
            p[k] = v
    else:
        # Null out all NRA fields so JS can detect missing data
        for field in ['NRA_Services_Count','NRA_Total_Fees','NRA_Fees_Per_Service',
                      'NRA_BB_Rate','NRA_Out_of_Pocket','NRA_Fee_Charged_CAGR',
                      'NRA_BB_Rate_CAGR','NRA_Score_Fees_Per_Service',
                      'NRA_Score_Total_Fees','NRA_Score_Fee_CAGR','NRA_Score_BB_CAGR']:
            p[field] = None
        missing_states.add(p['State'])

    p['UCC_Present'] = key in ucc_sa3_set

print(f'  Covered:  {covered}/336 SA3s with NRA data')
if missing_states:
    print(f'  Missing:  {336 - covered}/336 SA3s (state coverage gaps: {sorted(missing_states)})')
else:
    print(f'  Missing:  {336 - covered}/336 SA3s (SA3 name mismatches only)')

# ── Write back ────────────────────────────────────────────────────────────────
with open(GEOJSON_FILE, 'w') as f:
    json.dump(gj, f, separators=(',', ':'))
print('\nWrote sa3_scored.geojson')

# ── Sanity checks ─────────────────────────────────────────────────────────────
scores_fps  = [f['properties']['NRA_Fees_Per_Service'] for f in gj['features'] if f['properties']['NRA_Fees_Per_Service']]
scores_bb   = [f['properties']['NRA_BB_Rate']          for f in gj['features'] if f['properties']['NRA_BB_Rate']]
scores_cagr = [f['properties']['NRA_Fee_Charged_CAGR'] for f in gj['features'] if f['properties']['NRA_Fee_Charged_CAGR'] is not None]

print(f'\nFees per service: min=${min(scores_fps):.2f}, max=${max(scores_fps):.2f}, median=${sorted(scores_fps)[len(scores_fps)//2]:.2f}')
print(f'BB rate:          min={min(scores_bb):.1f}%, max={max(scores_bb):.1f}%')
print(f'Fee CAGR 3Y:      min={min(scores_cagr):.1f}%, max={max(scores_cagr):.1f}%')

# Spot checks
spot = ['Sydney - City and Inner South', 'Queanbeyan', 'Outback - North and East']
for feat in gj['features']:
    if feat['properties']['SA3Name'] in spot:
        p = feat['properties']
        print(f"\n{p['SA3Name']} ({p['State']}):")
        print(f"  Fees/service=${p.get('NRA_Fees_Per_Service')}, BB={p.get('NRA_BB_Rate')}%, Fee CAGR={p.get('NRA_Fee_Charged_CAGR')}%")
        print(f"  Total fees=${p.get('NRA_Total_Fees'):,.0f}" if p.get('NRA_Total_Fees') else "  No NRA data")
        print(f"  Score(fps)={p.get('NRA_Score_Fees_Per_Service')}, UCC={p.get('UCC_Present')}")
