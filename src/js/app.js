/* ============================================================
 * Foundry Intelligence Platform
 * Application logic
 * ============================================================ */

mapboxgl.accessToken = 'pk.eyJ1Ijoiam9zaHRpbmcxMSIsImEiOiJjbXA4NnJsbGswZGxxMnFxMHE5dTBnc25zIn0.eHyv0YqYR-hTYLy6Z_FEPQ';

// ============================================================
// Mapbox Isochrone API — Test Function
// ============================================================
const isoUrlBase = 'https://api.mapbox.com/isochrone/v1/mapbox/';
const isoProfile = 'driving'; // 15-min driving isochrone
const isoMinutes = 15;

async function fetchClinicIsochrone(clinic) {
  if (!clinic || !clinic.longitude || !clinic.latitude) {
    console.error('Invalid clinic data:', clinic);
    return;
  }
  const { longitude, latitude, clinic_id, clinic_name } = clinic;
  const url = `${isoUrlBase}${isoProfile}/${longitude},${latitude}?contours_minutes=${isoMinutes}&polygons=true&access_token=${mapboxgl.accessToken}`;
  console.log('Calling Mapbox Isochrone API:', url);

  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      console.error('API Error:', response.status, response.statusText);
      return;
    }
    const data = await response.json();
    console.log(`✓ Isochrone API response for ${clinic_name} (ID: ${clinic_id}):`, data);
    return data;
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

// ============================================================
// URL Parameter Helpers
// ============================================================
function getQueryParam(key) {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
}

function setQueryParam(key, value) {
    const params = new URLSearchParams(window.location.search);
    params.set(key, value);
    window.history.replaceState(null, '', '?' + params.toString());
}

// ============================================================
// State
// ============================================================
const State = {
    markets: {
        available: ['gp', 'physio', 'dental'],
        current: 'gp',
        config: null
    },
    sa3Data: null,
    sa2Data: null,                  // SEIFA SA2 polygons (F-06)
    clinicsData: [],                // flat, assembled view — see rebuildActiveClinicsData()
    clinicsByVertical: { gp: [], physio: [], dental: [] },  // per-vertical cache, Datasets-as-layers (plan Phase A)
    activeClinicLayers: ['gp'],     // which verticals' clinic pins are currently shown; scoring market's own layer is always included
    // Data Catalogue (plan Phase G) — which optional datasets the user has
    // loaded. Step 3 shows nothing but "required by the model" info by
    // default; loading one of these reveals its filter controls there and
    // (where colorable) a dynamic Colour-by chip.
    catalogueLoaded: { seifa: false, workforce: false, gpBillings: false },
    // "Limit regions" (plan Phase G) — SEIFA decile selection is browsable
    // without narrowing anything until this is switched on (workforce risk/
    // DPA already narrows immediately via its own pre-existing slider/
    // checkboxes, so it doesn't need this same gate).
    catalogueFilterActive: { seifa: false },
    sa3RawLookup: {},
    sa3ClinicCounts: {},
    currentState: '',
    currentSA3Code: null,
    currentView: 'map',
    currentMapView: 'composite',    // 'composite' | 'whitespace' | 'seifa'
    seifaRange: [1, 10],            // legacy; use seifaDeciles
    seifaDeciles: [],               // SEIFA decile chips; [] = all shown
    mmmFilter: [],                  // array of MMM class ints; [] = no filter
    // Copilot-only filters (plan Phase H) — no manual rail control for
    // either, deliberately: the brief's non-goals rule out adding new rail
    // UI, so these are only ever set by applyCopilotIntent() and cleared via
    // their own removable filter chip (see updateFilterChips()).
    tierFilter: [],                 // array of allowed tier ints (1-5); [] = no filter
    regionFilter: null,             // { name, sa3Codes } | null — resolved gazetteer region
    supplyScoreMin: null,           // number | null — "low competitive density" resolved threshold, see resolveLowDensityThreshold()
    rankingsSort: { key: 'composite', dir: 'desc' },
    rankingsFilters: { search: '', state: '', tier: '' },
    weights: { demand: 30, supply: 35, competition: 20, economics: 15 },
    workforceWeights: { supply: 40, age: 30, dpa: 30 },
    workforceRiskMin: 0,
    dpaFilter: { bonded: false, gpImg: false },
    mmmBenchmark: {},
    nraLookup: {},
    archetypeFilter: { format: [], billing: [], ownership: [] },  // F-01
    dataAvailabilityFilter: { has_website: false, has_gp_data: false },
    clinicChainFilter: [],  // Selected clinic chains
    sa3TargetMetrics: {},   // F-02: per-target per-SA3 metrics { SA3Code: { 'IPN': { clinics, composite, tier, format, billing }, ... } }
    targetMetaSummary: {},  // F-02: per-target summary { 'IPN': { totalClinics, regionsPresent, avgComposite, tier1Count, ... } }
    targetOverlapMatrix: {}, // F-02: overlap counts { 'IPN|Myhealth': { count, percentage }, ... }
    tableView: 'composite',
    uniqueClinicChains: [],  // List of unique clinic chains from data
    gpAdjustmentFactors: {   // Populated by computeGpAdjustmentFactors()
        _bySA3:    null,     // Map<sa3Code, { factor, avgClinicsPerGP, uniqueGPs }>
        _byChain:  {},       // chain name  → { factor, avgClinicsPerGP, uniqueGPs }
        _byGroup:  {},       // group name  → { factor }
        _byCorpus: 0.903     // all-corporate fallback
    },
    gpCoverageStats: {},     // diagnostic: totalGPs, multiSitePct, sa3WithOwnFactor
    activeClinicId: null,
    activeClinicIsochrone: null,
    selectedClinics: [],
    comparisonIsochrones: {},
    acquisitionReads: {},   // clinic_id -> { phase: 'idle'|'loading'|'result', collapsed, thread: [] }
    regionReads: {}         // SA3Code  -> { phase: 'idle'|'loading'|'result', thread: [] }
};

// ============================================================
// Supabase Authentication (initialized in HTML inline script)
// ============================================================
// Supabase client is created in map.html and available as window.supabase_client
// Auth functions are defined in map.html's inline script

// Extend State with auth properties
State.user = null;
State.authToken = null;

// ============================================================
// AUTH FUNCTIONS (defined early so they're ready immediately)
// ============================================================
function showAppView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.querySelector(`[data-view="${viewName}"]`);
    if (view) view.classList.add('active');
}

async function checkAuthStatus() {
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Auth check timeout')), 5000)
        );
        const { data } = await Promise.race([
            supabase.auth.getSession(),
            timeoutPromise
        ]);
        if (data?.session) {
            State.user = data.session.user;
            State.authToken = data.session.access_token;
            showAppView('map');
            document.getElementById('logout-btn').style.display = 'block';
            return true;
        } else {
            showAppView('login');
            document.getElementById('logout-btn').style.display = 'none';
            const loader = document.getElementById('loader');
            if (loader) loader.style.display = 'none';
            return false;
        }
    } catch (error) {
        console.error('Auth check failed:', error.message);
        showAppView('login');
        document.getElementById('logout-btn').style.display = 'none';
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'none';
        return false;
    }
}

async function handleLogin(email, password) {
    const errorEl = document.getElementById('auth-error');
    errorEl.textContent = '';
    errorEl.style.color = '#d32f2f';
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            errorEl.textContent = error.message;
            return;
        }
        State.user = data.user;
        State.authToken = data.session.access_token;
        document.getElementById('logout-btn').style.display = 'block';
        showAppView('map');
        init();
    } catch (error) {
        errorEl.textContent = 'Login failed: ' + error.message;
    }
}

async function handleSignup(email, password) {
    const errorEl = document.getElementById('auth-error');
    errorEl.textContent = '';
    errorEl.style.color = '#d32f2f';
    try {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
            errorEl.textContent = error.message;
            return;
        }
        errorEl.style.color = 'green';
        errorEl.textContent = 'Signup successful! Check your email to confirm your account.';
        document.getElementById('auth-email').value = '';
        document.getElementById('auth-password').value = '';
    } catch (error) {
        errorEl.textContent = 'Signup failed: ' + error.message;
    }
}

async function handleGoogleLogin() {
    const errorEl = document.getElementById('auth-error');
    errorEl.textContent = '';
    errorEl.style.color = '#d32f2f';
    try {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin }
        });
        if (error) errorEl.textContent = error.message;
    } catch (error) {
        errorEl.textContent = 'Google login failed: ' + error.message;
    }
}

async function handleLogout() {
    await supabase.auth.signOut();
    State.user = null;
    State.authToken = null;
    showAppView('login');
    location.reload();
}

const DEFAULT_WEIGHTS = { demand: 30, supply: 35, competition: 20, economics: 15 };
const WEIGHT_KEYS = ['demand', 'supply', 'competition', 'economics'];
const WEIGHT_MIN = 5;
const WEIGHT_MAX = 60;

// Foundry brand spec — tier ramp:
// dark sage → primary sage → mid sage → traffic amber → traffic red
const TIER_COLORS = {
    1: '#465E4D',
    2: '#6E9277',
    3: '#97C777',
    4: '#FFC000',
    5: '#C00000'
};

const TIER_LABELS = {
    1: 'Tier 1 · Exceptional',
    2: 'Tier 2 · Strong',
    3: 'Tier 3 · Moderate',
    4: 'Tier 4 · Weak',
    5: 'Tier 5 · Poor'
};

// Chain dimension scores (Deliverability, Asset Quality, Platform Potential, Strategic Fit)
const DIMENSION_SCORES = {
    'ForHealth': { deliver: 72, quality: 55, platform: 58, fit: 43 },
    'Smart Clinics + Better Medical': { deliver: 70, quality: 68, platform: 48, fit: 22 },
    'Family Doctor': { deliver: 62, quality: 48, platform: 65, fit: 61 },
    'Partnered Health': { deliver: 52, quality: 56, platform: 48, fit: 27 },
    'Jupiter Health': { deliver: 58, quality: 41, platform: 42, fit: 38 },
    'Qualitas Health': { deliver: 50, quality: 45, platform: 43, fit: 50 },
    'Ochre Health': { deliver: 45, quality: 52, platform: 51, fit: 34 },
    'My Health': { deliver: 25, quality: 60, platform: 57, fit: 39 },
    'Sonic Healthcare (IPN)': { deliver: 15, quality: 42, platform: 73, fit: 10 },
    'Bupa Medical': { deliver: 12, quality: 38, platform: 28, fit: 20 }
};

const PILLAR_META = {
    demand: { name: 'Demand', weight: 30 },
    supply: { name: 'Supply', weight: 35 },
    competition: { name: 'Competition', weight: 20 },
    economics: { name: 'Economics', weight: 15 }
};

// Foundry brand: no blue / no purple. Dark sage / primary sage / footnote grey.
const OWNERSHIP_COLORS = {
    Corporate: '#465E4D',
    Independent: '#6E9277',
    'NGO': '#9A9A9A'
};

const MMM_LABELS = {
    1: 'Metro',
    2: 'Regional centre',
    3: 'Large rural town',
    4: 'Medium rural town',
    5: 'Small rural town',
    6: 'Remote',
    7: 'Very remote'
};

// F-02: Clinic Chain Target Palette
// Color + pattern system for 16-way distinction (color-vision-deficiency safe)
// Patterns: 'solid', 'dots', 'stripes-h', 'stripes-v', 'cross'
const CLINIC_CHAIN_PALETTE = {
    'IPN Medical Network': { slug: 'ipn', name: 'IPN', color: '#465E4D', pattern: 'solid' },
    'Myhealth Medical Group': { slug: 'myhealth', name: 'Myhealth', color: '#6E9277', pattern: 'dots' },
    'Family Doctor': { slug: 'family-doctor', name: 'Family Doctor', color: '#97C777', pattern: 'solid' },
    'ForHealth': { slug: 'forhealth', name: 'ForHealth', color: '#FFC000', pattern: 'solid' },
    'Better Medical': { slug: 'better', name: 'Better Medical', color: '#C00000', pattern: 'solid' },
    'Jupiter Health': { slug: 'jupiter', name: 'Jupiter Health', color: '#465E4D', pattern: 'stripes-h' },
    'Partnered Health': { slug: 'partnered', name: 'Partnered Health', color: '#6E9277', pattern: 'stripes-v' },
    'Ochre Health': { slug: 'ochre', name: 'Ochre Health', color: '#97C777', pattern: 'dots' },
    'Qualitas Health': { slug: 'qualitas', name: 'Qualitas Health', color: '#FFC000', pattern: 'dots' },
    'Cornerstone Health': { slug: 'cornerstone', name: 'Cornerstone Health', color: '#C00000', pattern: 'dots' },
    'Fullerton Health Australia': { slug: 'fullerton', name: 'Fullerton Health', color: '#465E4D', pattern: 'cross' },
    'Next Practice': { slug: 'next-practice', name: 'Next Practice', color: '#6E9277', pattern: 'cross' },
    'Myclinic Group': { slug: 'myclinic', name: 'Myclinic Group', color: '#97C777', pattern: 'stripes-h' },
    'SIA Medical Centres': { slug: 'sia', name: 'SIA Medical', color: '#FFC000', pattern: 'stripes-v' },
    'HealthE Care': { slug: 'healthe', name: 'HealthE Care', color: '#C00000', pattern: 'stripes-h' },
    'Main Street Medical': { slug: 'main-street', name: 'Main Street Medical', color: '#465E4D', pattern: 'dots' },
    'ProHealth Care': { slug: 'prohealth', name: 'ProHealth Care', color: '#6E9277', pattern: 'stripes-h' },
    'Top Health Group': { slug: 'top-health', name: 'Top Health', color: '#97C777', pattern: 'cross' },
    'Your Doctor': { slug: 'your-doctor', name: 'Your Doctor', color: '#FFC000', pattern: 'cross' },
    'Top End Medical Centre': { slug: 'top-end', name: 'Top End Medical', color: '#C00000', pattern: 'cross' }
};

// ============================================================
// Helpers
// ============================================================
function tierForScore(score) {
    if (score >= 85) return 1;
    if (score >= 70) return 2;
    if (score >= 55) return 3;
    if (score >= 40) return 4;
    return 5;
}

/**
 * Assign tiers across all features in-place.
 *
 * Default: absolute thresholds (T1 ≥85, T2 ≥70, T3 ≥55, T4 ≥40, T5 <40).
 * Fallback: if fewer than 5 features would be T1 under absolute thresholds,
 *           switch to percentile-rank based assignment:
 *             T1 ≥ 95th pct  |  T2 85–95th  |  T3 50–85th  |  T4 20–50th  |  T5 < 20th
 *
 * Asserts all 5 tiers have ≥1 member; throws if not (should never happen with ≥5 features).
 */
function assignTiers(features) {
    const scores = features.map(f => parseFloat(f.properties.Composite_Score) || 0);

    // Check T1 count under absolute thresholds
    const t1AbsCount = scores.filter(s => s >= 85).length;

    if (t1AbsCount >= 5) {
        // Absolute thresholds
        features.forEach(f => {
            f.properties.Tier = tierForScore(parseFloat(f.properties.Composite_Score) || 0);
        });
    } else {
        // Percentile-rank based assignment
        const sorted = [...scores].sort((a, b) => a - b);
        const n = sorted.length;
        const pctRank = score => {
            // % of values strictly below this score
            let lo = 0, hi = n;
            while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < score) lo = m + 1; else hi = m; }
            return (lo / n) * 100;
        };
        features.forEach(f => {
            const r = pctRank(parseFloat(f.properties.Composite_Score) || 0);
            let tier;
            if      (r >= 95) tier = 1;
            else if (r >= 85) tier = 2;
            else if (r >= 50) tier = 3;
            else if (r >= 20) tier = 4;
            else              tier = 5;
            f.properties.Tier = tier;
        });
    }

    // Assert all tiers have ≥1 member
    const counts = [1,2,3,4,5].map(t => features.filter(f => f.properties.Tier === t).length);
    const emptyTiers = [1,2,3,4,5].filter((t, i) => counts[i] === 0);
    if (emptyTiers.length > 0) {
        console.warn('[assignTiers] Empty tiers detected:', emptyTiers, '— counts:', counts);
    }
    return { mode: t1AbsCount >= 5 ? 'absolute' : 'percentile', counts };
}

function fmtInt(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('en-AU');
}

function fmtPct(v, digits = 1) {
    if (v === undefined || v === null || v === '') return '—';
    const n = parseFloat(String(v).replace(/[$%,\s]/g, ''));
    if (isNaN(n)) return '—';
    return n.toFixed(digits) + '%';
}

function fmtNum(v, digits = 1) {
    if (v === undefined || v === null || v === '') return '—';
    const n = parseFloat(String(v).replace(/[$%,\s]/g, ''));
    if (isNaN(n)) return '—';
    return n.toFixed(digits);
}

function fmtMoney(v) {
    if (v === undefined || v === null || v === '') return '—';
    const n = parseFloat(String(v).replace(/[$%,\s]/g, ''));
    if (isNaN(n)) return '—';
    if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString('en-AU');
}

function parseNum(v) {
    if (v === undefined || v === null || v === '') return NaN;
    return parseFloat(String(v).replace(/[$%,\s]/g, ''));
}

// Escapes a value for safe interpolation inside a single-quoted inline
// onclick="...('...')" attribute string.
function escJsAttr(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Live follow-up Q&A (Acquisition/Region read) — the one part of that
// feature that calls a real model (api/ask-read.js, Claude Haiku 4.5). The
// four-dimension scorecard itself stays a deterministic heuristic; see
// plan Phase 6. `context` is exactly the already-computed read result
// (computeAcquisitionRead/computeRegionRead output) — no re-derivation.
async function fetchLiveAnswer(scope, question, context) {
    try {
        const res = await fetch('/api/ask-read', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ scope, question, context })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.answer) return { ok: false, text: data.error || "Couldn't reach the model just now — try again." };
        return { ok: true, text: data.answer };
    } catch (e) {
        return { ok: false, text: "Couldn't reach the model just now — try again." };
    }
}

function fmtStamp(d) {
    if (!d) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function getProp(raw, ...keys) {
    if (!raw) return undefined;
    for (const k of keys) {
        if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== '') return raw[k];
    }
    return undefined;
}

function getFileUrl(filename) {
    // Map filenames to their subdirectory locations
    // Updated for stratification folder (geographic classification systems)
    const pathMap = {
        'sa3_scored.geojson': 'data/shared/geographic/processed/sa3_scored.geojson',
        'comprehensive_clinic_database.csv': 'data/markets/gp/gp_clinics.csv',
        'sa3_raw.csv': 'data/shared/demographics/population_sa3.csv',
        'mmm_benchmark.json': 'data/shared/geographic/stratification/mmm/mmm_benchmark.json',
        'sa2_seifa.geojson': 'data/shared/geographic/stratification/seifa/sa2_seifa.geojson',
        'sa1_centroids_pop.csv': 'data/shared/demographics/population_sa1.csv'
    };

    try {
        const path = pathMap[filename] || 'data/' + filename;
        if (window.location.origin && window.location.origin !== 'null') {
            return window.location.origin + '/' + path;
        }
        return new URL(path, window.location.href).href;
    } catch (e) {
        return path;
    }
}

// ============================================================
// Supabase Data Adapters
// Replaces the static /data/* fetches above with Supabase queries. Each adapter
// returns data in the SAME shape/property-names the existing (unmodified)
// parsing/rendering code elsewhere in this file already expects, so nothing
// downstream needs to change. See scripts/supabase_migration/schema.sql for the
// get_sa3_geojson/get_sa2_geojson/get_mmm_benchmark/get_clinics/get_sa1_centroids/
// get_clinic_isochrone RPC definitions this relies on.
// ============================================================

// The DATA project (where clinics/sa3/sa2/sa1/markets live) is a SEPARATE Supabase
// project from the one map.html uses for auth (window.supabase_client) -- don't
// reuse that client, it points at the wrong project and has none of this schema.
// This key is the public/publishable anon key, safe to embed in client code (same
// category as the Mapbox pk. token) -- not a secret.
const DATA_SUPABASE_URL = 'https://ytervdshmvdawoomhnlp.supabase.co';
const DATA_SUPABASE_ANON_KEY = 'sb_publishable_3cXEeYAJg3u3CX_j8ITJQg_jLLPouw-';

let _dataSupabaseClient = null;
function getSupabaseClient() {
    return new Promise((resolve) => {
        const tryCreate = () => {
            if (_dataSupabaseClient) { resolve(_dataSupabaseClient); return true; }
            if (window.supabase && window.supabase.createClient) {
                _dataSupabaseClient = window.supabase.createClient(DATA_SUPABASE_URL, DATA_SUPABASE_ANON_KEY);
                resolve(_dataSupabaseClient);
                return true;
            }
            return false;
        };
        if (tryCreate()) return;
        const interval = setInterval(() => {
            if (tryCreate()) clearInterval(interval);
        }, 50);
    });
}

async function fetchSa3Geojson() {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.rpc('get_sa3_geojson');
    if (error) throw new Error(`Failed to load sa3 geojson: ${error.message}`);
    return data;
}

async function fetchSa2Geojson() {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.rpc('get_sa2_geojson');
    if (error) throw new Error(`Failed to load sa2 geojson: ${error.message}`);
    return data;
}

async function fetchMmmBenchmark() {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.rpc('get_mmm_benchmark');
    if (error) { console.warn('[mmm] failed to load:', error.message); return null; }
    return data;
}

async function fetchSa1Centroids() {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.rpc('get_sa1_centroids');
    if (error) { console.warn('[sa1] failed to load:', error.message); return null; }
    return data;
}

async function fetchMarketConfigFromSupabase(marketId) {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from('markets').select('config').eq('market_id', marketId).single();
    if (error) throw new Error(`Failed to load config for market: ${marketId} (${error.message})`);
    return data.config;
}

// Named-region gazetteer (plan Phase H) — resolves a real curated region
// name (e.g. "South-East Queensland", see scripts/supabase_migration/
// schema.sql's region_definitions/region_gazetteer_members tables) to its
// explicit SA3 code list. The copilot backend already validates regionName
// against this same table before it ever reaches here (api/copilot.js) —
// this is the client-side lookup that turns the validated name into an
// actual filter. Cached by name since the gazetteer is small and static.
const _regionGazetteerCache = {};
async function resolveGazetteerRegion(regionName) {
    if (!regionName) return null;
    if (_regionGazetteerCache[regionName]) return _regionGazetteerCache[regionName];
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
        .from('region_gazetteer_members')
        .select('sa3_code')
        .eq('region_name', regionName);
    if (error || !data || !data.length) {
        console.warn('[copilot] gazetteer lookup failed for', regionName, error?.message);
        return null;
    }
    const result = { name: regionName, sa3Codes: data.map((r) => r.sa3_code) };
    _regionGazetteerCache[regionName] = result;
    return result;
}

async function fetchClinicIsochroneGeojson(marketId, clinicId) {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.rpc('get_clinic_isochrone', {
        p_market_id: marketId, p_clinic_id: String(clinicId)
    });
    if (error) { console.warn('[isochrone] rpc error:', error.message); return null; }
    return data; // null when the clinic has no isochrone (matches old !response.ok path)
}

function boolToYesNo(v) {
    if (v === true) return 'Yes';
    if (v === false) return 'No';
    return '';
}

// Reconstructs legacy raw-CSV-shaped rows from Supabase's normalized `clinics`
// columns, keyed by market — feeds straight into the existing, unmodified
// normalizeClinicData()/universal-normalization pipeline in loadMarketData() below.
const LEGACY_COLUMN_MAP = {
    gp: (row) => ({
        clinic_id: row.clinic_id,
        clinic_name: row.name,
        'Corporate Chain': row.corporate_chain,
        ownership: row.ownership,
        clinic_format: row.clinic_format,
        'Billing Type': row.billing_type,
        Pathology: boolToYesNo(row.pathology),
        'Radiology/Imaging': boolToYesNo(row.radiology_imaging),
        'Allied Health': boolToYesNo(row.allied_health),
        website: row.website,
        'Doctor Names Clean': row.doctor_names,
        google_review_count: row.google_review_count,
        google_rating: row.google_rating,
        gp_count: row.gp_count,
        address: row.address,
        suburb: row.suburb,
        state_code: row.state_code,
        postcode: row.postcode,
        longitude: row.longitude,
        latitude: row.latitude,
        sa1_code: row.sa1_code,
        sa2_code: row.sa2_code,
        sa2_name: row.sa2_name,
        sa2_area_km2: row.sa2_area_km2,
        sa3_code: row.sa3_code,
        sa3_name: row.sa3_name,
        sa4_code: row.sa4_code,
        sa4_name: row.sa4_name,
        gccsa_code: row.gccsa_code,
        gccsa_name: row.gccsa_name,
        state_name: row.state_name,
        nhsd_service_id: row.nhsd_service_id,
        nhsd_service_type: row.nhsd_service_type,
        gnaf_address_id: row.gnaf_address_id,
        geographic_area_class: row.geographic_area_class,
        geographic_source_date: row.geographic_source_date,
        Format_Confidence: row.format_confidence,
    }),
    physio: (row) => ({
        PracticeID: row.clinic_id,
        PracticeName: row.name,
        FullAddress: row.address,
        Address1: row.address1,
        City: row.suburb,
        State: row.state_code,
        Postcode: row.postcode,
        Phone: row.phone,
        Email: row.email,
        Website: row.website,
        Lat: row.latitude,
        Lon: row.longitude,
        NDIS: row.ndis ? 1 : 0,
        Telehealth: row.telehealth ? 1 : 0,
        rank: row.rank,
        sa3_code: row.sa3_code,
        sa3_name: row.sa3_name,
        segments: Array.isArray(row.segments) ? row.segments.join(', ') : row.segments,
        primary_segment: row.primary_segment,
        confidence: row.confidence,
    }),
    // Untested (0 dental clinics exist yet) -- forward-compatible best guess based on
    // dental/market_config.json's clinic_fields (ownership_type/billing_type naming),
    // mirrored from the gp shape since dental's raw CSV column set was never finalized.
    dental: (row) => ({
        clinic_id: row.clinic_id,
        clinic_name: row.name,
        ownership_type: row.ownership,
        clinic_format: row.clinic_format,
        billing_type: row.billing_type,
        latitude: row.latitude,
        longitude: row.longitude,
        sa3_code: row.sa3_code,
        sa3_name: row.sa3_name,
        address: row.address,
        suburb: row.suburb,
        state_code: row.state_code,
        postcode: row.postcode,
        website: row.website,
    }),
};

async function fetchClinicsForMarket(marketId) {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.rpc('get_clinics', { p_market_id: marketId });
    if (error) throw new Error(`Failed to load clinics for market: ${marketId} (${error.message})`);
    const reshape = LEGACY_COLUMN_MAP[marketId] || LEGACY_COLUMN_MAP.gp;
    return (data || []).map(reshape);
}

// ============================================================
// Market Management
// ============================================================

async function loadMarketConfig(marketId) {
    /**
     * Load market configuration (markets.config in Supabase — the same object
     * market_config.json used to be, 1:1)
     */
    try {
        const config = await fetchMarketConfigFromSupabase(marketId);
        console.log(`[market] loaded config for ${marketId}:`, config);
        return config;
    } catch (e) {
        console.error(`[market] Error loading config:`, e);
        throw e;
    }
}

function normalizeClinicData(clinicsData, fieldMapping) {
    /**
     * Normalize clinic data using market-specific field mapping
     * fieldMapping: { canonical_name: csv_column_name }
     * Example: { id: 'clinic_id', name: 'clinic_name', latitude: 'latitude' }
     */
    return clinicsData.map((raw, idx) => {
        const normalized = {};

        // Map canonical names to CSV columns
        Object.entries(fieldMapping).forEach(([canonical, csvCol]) => {
            normalized[canonical] = raw[csvCol];
        });

        // Debug first clinic to see field mapping
        if (idx === 0) {
            console.log('[normalizeClinicData] First clinic fieldMapping:', fieldMapping);
            console.log('[normalizeClinicData] First clinic raw has sa3_code:', raw.sa3_code, 'sa3_name:', raw.sa3_name);
            console.log('[normalizeClinicData] First clinic normalized has sa3_code:', normalized.sa3_code, 'sa3_name:', normalized.sa3_name);
        }

        // Copy all original fields for flexibility
        Object.entries(raw).forEach(([k, v]) => {
            if (!(k in normalized)) {
                normalized[k] = v;
            }
        });

        // Add default values for missing expected fields
        // (so clinic layer filters don't exclude them)
        if (!normalized.ownership) normalized.ownership = 'Unknown';
        if (!normalized.clinic_format) normalized.clinic_format = 'Small';
        if (!normalized['Billing Type']) normalized['Billing Type'] = 'Unknown';

        // Ensure clinic_name exists for labels (use 'name' if clinic_name doesn't exist)
        if (!normalized.clinic_name && normalized.name) {
            normalized.clinic_name = normalized.name;
        }

        // Ensure clinic_id exists for isochrone loading (use 'id' if clinic_id doesn't exist)
        if (!normalized.clinic_id && normalized.id) {
            normalized.clinic_id = normalized.id;
        }

        return normalized;
    });
}

function assignSA3CodesViaPointInPolygon(clinicsData, sa3Features) {
    /**
     * Match clinics to SA3 regions using point-in-polygon lookup
     * Uses Turf.js to find which SA3 polygon contains each clinic point
     */
    let matched = 0;
    let unmatched = 0;

    clinicsData.forEach(clinic => {
        // Skip if already has SA3Code
        if (clinic.sa3_code) return;

        const lat = parseFloat(clinic.latitude);
        const lon = parseFloat(clinic.longitude);

        // Skip invalid coordinates
        if (isNaN(lat) || isNaN(lon)) {
            unmatched++;
            return;
        }

        // Create point for Turf.js
        const clinicPoint = turf.point([lon, lat]);

        // Find SA3 polygon containing this point
        const matchingSA3 = sa3Features.find(feature => {
            try {
                return turf.booleanPointInPolygon(clinicPoint, feature);
            } catch (e) {
                return false;
            }
        });

        if (matchingSA3) {
            clinic.sa3_code = String(matchingSA3.properties.SA3_CODE21).trim();
            clinic.sa3_name = matchingSA3.properties.SA3Name;
            clinic.sa3_state = matchingSA3.properties.State;
            matched++;
        } else {
            unmatched++;
        }
    });

    console.log(`[sa3-match] Matched ${matched} clinics to SA3 regions, ${unmatched} unmatched`);
    return { matched, unmatched };
}

async function loadSharedData(progressCb) {
    /**
     * Load geographic and demographic data shared by all markets
     * Called once at startup
     */
    progressCb('Loading geographic data…');

    const [sa3Json, bmJson, sa1Data] = await Promise.all([
        fetchSa3Geojson(),
        fetchMmmBenchmark(),
        fetchSa1Centroids(),
    ]);

    progressCb('Parsing geographic data…');

    State.sa3Data = sa3Json;

    // sa3_raw.csv (population_sa3.csv) is folded into get_sa3_geojson()'s properties
    // now -- derive the lookup from the same object instead of a second query.
    State.sa3Data.features.forEach(feat => {
        const code = feat.properties.SA3Code;
        if (code) State.sa3RawLookup[String(code).trim()] = feat.properties;
    });

    if (bmJson) State.mmmBenchmark = bmJson;

    if (sa1Data) {
        State.sa1CentroidData = sa1Data;
        console.log(`[sa1] loaded ${State.sa1CentroidData.length} SA1 centroids`);
    }

    // Build NRA lookup from geojson properties
    State.sa3Data.features.forEach(feat => {
        const p = feat.properties;
        const key = `${p.State}|${p.SA3Name}`;
        State.nraLookup[key] = p;
    });

    console.log('[shared] Geographic and demographic data loaded');
}

async function loadMarketData(marketId, progressCb) {
    /**
     * Load market-specific clinic data
     * Called when user switches markets or at startup
     */
    progressCb(`Loading ${marketId} clinic data…`);

    // Load market config
    const config = await loadMarketConfig(marketId);
    State.markets.config = config;

    // Fetch clinics (Supabase clinics table, reshaped to legacy CSV column names)
    const legacyShapedRows = await fetchClinicsForMarket(marketId);

    progressCb(`Parsing ${marketId} clinic data…`);

    // Normalize clinic data using market config field mapping
    let clinicsData = normalizeClinicData(legacyShapedRows, config.clinic_fields);
    clinicsData = clinicsData.filter(d => d.latitude && d.longitude);

    // Universal normalization (all markets)
    const BILLING_NORM = { 'Bulk Billing': 'Bulk', 'Mixed Billing': 'Mixed', 'Private Billing': 'Private' };
    const SERVICE_YES = new Set(['yes', 'true', 'Yes', 'True']);
    clinicsData.forEach(c => {
        if (c['Billing Type'] && BILLING_NORM[c['Billing Type']]) {
            c['Billing Type'] = BILLING_NORM[c['Billing Type']];
        }
        ['Pathology', 'Radiology/Imaging', 'Allied Health'].forEach(svc => {
            if (c[svc] !== undefined) {
                c[svc] = SERVICE_YES.has(c[svc]) ? 'Yes' : 'No';
            }
        });
        ['sa3_code', 'sa2_code', 'sa4_code'].forEach(fld => {
            if (c[fld]) c[fld] = String(c[fld]).replace(/\.\d+$/, '');
        });
    });

    // GP-specific: compute adjustment factors
    if (marketId === 'gp') {
        computeGpAdjustmentFactors(clinicsData);
        applyGpAdjustmentFactors(clinicsData);
    }

    // For non-GP markets: match clinics to SA3 regions via point-in-polygon
    if (marketId !== 'gp' && State.sa3Data && State.sa3Data.features) {
        assignSA3CodesViaPointInPolygon(clinicsData, State.sa3Data.features);
    }

    // Extract unique clinic chains
    const uniqueChains = new Set();
    clinicsData.forEach(c => {
        if (c['Corporate Chain'] && c['Corporate Chain'].trim() !== '') {
            uniqueChains.add(c['Corporate Chain'].trim());
        }
    });
    State.uniqueClinicChains = Array.from(uniqueChains).sort();

    console.log(`[market] Loaded ${clinicsData.length} clinics for ${marketId}`);

    return { clinicsData, config };
}

// ============================================================
// Datasets-as-layers (plan Phase A) — assembles the flat State.clinicsData
// view every existing call site reads from State.clinicsByVertical +
// State.activeClinicLayers. Call after either changes.
// ============================================================
function rebuildActiveClinicsData() {
    State.clinicsData = State.activeClinicLayers.flatMap((layer) => State.clinicsByVertical[layer] || []);
}

// ============================================================
// Datasets-as-layers (plan Phase E) — clinic layers are multi-select map
// overlays, independent of the single-select scoring market. Toggling a
// secondary layer on/off never touches State.sa3Data, scores, or filters —
// those stay scoped to State.markets.current. Per-layer filter sub-panels
// (segments/ndis/telehealth for physio; ownership/chain for dental) are an
// explicitly deferred follow-up, same spirit as the region/chain dossier —
// this phase proves out the layering mechanic itself.
// ============================================================
function renderClinicLayerCheckboxes() {
    document.querySelectorAll('.clinic-layer-toggle').forEach((el) => {
        const layer = el.dataset.layer;
        const isPrimary = layer === State.markets.current;
        el.checked = isPrimary || State.activeClinicLayers.includes(layer);
        el.disabled = isPrimary;
    });
    // Clinic counts (plan Phase G) — only shown once that vertical's data
    // has actually been fetched at least once (lazy per-layer fetch, plan
    // Phase E); there's no lightweight count-only query to prefetch all
    // three up front, so an un-toggled layer's count stays blank until its
    // first load rather than guessing a number.
    ['gp', 'physio', 'dental'].forEach((layer) => {
        const el = document.getElementById('clinic-layer-count-' + layer);
        if (!el) return;
        const cached = State.clinicsByVertical[layer];
        el.textContent = cached && cached.length ? cached.length.toLocaleString('en-AU') : '';
    });
}

async function toggleClinicLayer(layer, checked) {
    if (layer === State.markets.current) return; // scoring market's own layer can't be toggled off from here

    if (checked) {
        if (!State.activeClinicLayers.includes(layer)) State.activeClinicLayers.push(layer);
        if (!State.clinicsByVertical[layer] || !State.clinicsByVertical[layer].length) {
            // loadMarketData() is reused for its fetch+normalize+SA3-match
            // pipeline, but it also side-effects state meant for the
            // *scoring* market (State.markets.config, State.uniqueClinicChains)
            // — save/restore those so loading a secondary layer can't
            // clobber the scoring market's own display state.
            const savedConfig = State.markets.config;
            const savedChains = State.uniqueClinicChains;
            try {
                const { clinicsData } = await loadMarketData(layer, () => {});
                clinicsData.forEach((c) => { c._layer = layer; });
                State.clinicsByVertical[layer] = clinicsData;
            } finally {
                State.markets.config = savedConfig;
                State.uniqueClinicChains = savedChains;
            }
        }
        rebuildActiveClinicsData();
        addSecondaryClinicLayer(layer);
    } else {
        State.activeClinicLayers = State.activeClinicLayers.filter((l) => l !== layer);
        rebuildActiveClinicsData();
        removeClinicLayer(layer);
    }
    renderFunnelSummaries();
    renderClinicLayerLegend(); // plan Phase F
    renderClinicLayerCheckboxes(); // plan Phase G — refresh the count once fetched
    // Data Catalogue's own Supply rows mirror these same layers — keep its
    // nav counts/checked-state live if the modal happens to be open.
    if (!document.getElementById('catalogue-modal-backdrop')?.classList.contains('hidden')) {
        renderCatalogueNav();
        renderCatalogueDetail(catalogueActiveCategory);
    }
}

async function switchMarket(marketId) {
    /**
     * Switch to a different market
     * Loads market config + clinic data, resets filters, updates UI
     */
    console.log(`[market] Switching to ${marketId}`);

    // Update URL
    setQueryParam('market', marketId);

    // Show loader
    const loaderEl = document.getElementById('loader');
    const progressEl = document.getElementById('loader-progress');
    loaderEl.classList.remove('hide');
    progressEl.textContent = `Loading ${marketId}…`;

    try {
        // Load market data
        const { clinicsData, config } = await loadMarketData(marketId, (msg) => {
            progressEl.textContent = msg;
        });

        // Update state
        State.markets.current = marketId;
        State.markets.config = config;
        // Datasets-as-layers (plan Phase A): store per-vertical, then assemble
        // the flat State.clinicsData view every existing call site still reads
        // unchanged. Phase A keeps this single-layer (multi-select lands in
        // Phase E) — switching the scoring market resets the active layer set
        // to just that vertical.
        clinicsData.forEach(c => { c._layer = marketId; });
        State.clinicsByVertical[marketId] = clinicsData;
        State.activeClinicLayers = [marketId];
        rebuildActiveClinicsData();
        State.sa3ClinicCounts = {};

        // Recompute clinic metrics
        precomputeClinicCounts();

        // Reset filters
        State.clinicChainFilter = [];
        State.currentSA3Code = null;
        State.seifaDeciles = [];
        State.mmmFilter = [];
        State.currentView = 'map';

        // Update product name
        const productName = document.getElementById('product-name');
        if (productName) {
            productName.textContent = config.market_name || 'Market';
        }

        // Update market switcher display
        const nameEl = document.getElementById('market-switcher-name');
        if (nameEl) nameEl.textContent = config.market_name || 'Market';
        // Mirror the market name into the mobile top-bar switcher
        const mobName = document.getElementById('mob-market-name');
        if (mobName) mobName.textContent = config.market_name || 'Market';
        // Mirror into Step 1's scoring-market dropdown trigger (plan Phase D)
        const funnelMarketStatus = document.getElementById('funnel-market-status');
        if (funnelMarketStatus) funnelMarketStatus.textContent = config.market_name || 'Market';

        // Update active market button (legacy hook, kept if ever reintroduced)
        // and the Step 1 scoring-market dropdown (plan Phase D).
        document.querySelectorAll('.market-selector-item, .market-dropdown-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.market === marketId);
        });

        // Rebuild map and UI
        progressEl.textContent = 'Rendering…';

        // Remove old map layers/sources before rebuilding
        try {
            // Remove layers
            const style = map.getStyle();
            if (style.layers) {
                style.layers.forEach(layer => {
                    if (layer.source === 'sa3' || layer.source === 'clinics' || layer.source === 'activeClinicMarker') {
                        map.removeLayer(layer.id);
                    }
                });
            }
            // Remove sources
            if (map.getSource('sa3')) map.removeSource('sa3');
            if (map.getSource('clinics')) map.removeSource('clinics');
            if (map.getSource('activeClinicMarker')) map.removeSource('activeClinicMarker');
        } catch (e) {
            console.warn('[market] Error cleaning up old layers:', e);
        }

        await attachMapLayers();
        applyWeights();
        renderDrawerEmpty();
        renderRankings();
        populateClinicChainsFilter();
        updateGPSpecificFilters();
        renderFunnelSummaries();  // plan Phase C
        renderClinicLayerCheckboxes();  // plan Phase E
        renderClinicLayerLegend();  // plan Phase F
        renderCatalogueLensChips();  // plan Phase G — re-sync dynamic SEIFA chip across market switch

        loaderEl.classList.add('hide');
        console.log(`[market] Switched to ${marketId} successfully`);
    } catch (e) {
        console.error(`[market] Error switching to ${marketId}:`, e);
        progressEl.textContent = `Error: ${e.message}`;
        loaderEl.classList.add('hide');
    }
}

function updateGPSpecificFilters() {
    /**
     * Hide/show GP-specific lenses and filters based on current market
     * - NRA (GP Billings) lenses only available for GP market
     * - Geographic Stratification section only visible for GP market
     */
    const isGP = State.markets.current === 'gp';
    console.log('[updateGPSpecificFilters] isGP:', isGP, 'current market:', State.markets.current);

    // Hide/show GP-specific lenses (Workforce + GP Billings) using display:none
    document.querySelectorAll('[data-lens="workforce"]').forEach(el => {
        el.style.display = isGP ? '' : 'none';
    });
    // GP Billings is now a Data Catalogue item (plan Phase G) — only shown
    // once loaded AND while GP is the scoring market (it's meaningless
    // outside of it either way).
    const gpBillingsVisible = isGP && State.catalogueLoaded.gpBillings;
    const nraWrap = document.querySelector('.lens-nra-wrap');
    if (nraWrap) nraWrap.style.display = gpBillingsVisible ? '' : 'none';
    // Mobile equivalents
    document.querySelector('#mob-lens-nra-btn')?.style && (document.querySelector('#mob-lens-nra-btn').style.display = gpBillingsVisible ? '' : 'none');
    document.querySelector('#mob-nra-picker')?.style && (document.querySelector('#mob-nra-picker').style.display = gpBillingsVisible ? '' : 'none');

    // Reset NRA or workforce lens if switching away from GP
    if (!isGP && (State.currentMapView.startsWith('nra-') || State.currentMapView === 'workforce')) {
        setMapView('composite');
    }

    // Funnel steps 2/3 (Geographic stratification's old home, plan Phase C
    // split it into "Where are you looking?"/"What kind of ground?"):
    // always visible, but keep collapsed for non-GP markets.
    ['geo', 'ground'].forEach((stepId) => {
        const stepBody = document.getElementById('acc-body-' + stepId);
        if (stepBody && !isGP && !stepBody.classList.contains('collapsed')) {
            stepBody.classList.add('collapsed');
            const stepArrow = document.getElementById('acc-arrow-' + stepId);
            if (stepArrow) stepArrow.textContent = '▸';
            const stepSummary = document.getElementById('funnel-summary-' + stepId);
            if (stepSummary) stepSummary.style.display = '';
        }
    });

    // Hide Archetype content for non-GP markets (header still visible, content hidden)
    const archetypeContent = document.getElementById('archetype-content');
    if (archetypeContent) {
        archetypeContent.classList.toggle('hidden', !isGP);
    }
}

// ============================================================
// Data loading
// ============================================================
async function loadData(progressCb) {
    // Fetch all startup assets in parallel — they're static files so browser
    // cache headers (304 Not Modified) will keep repeat visits instant.
    // sa2_seifa.geojson (7.2 MB) is deferred until the SEIFA lens is selected.
    progressCb('Loading data…');
    const [sa3Res, clinicsRes, rawRes, bmRes, sa1Res] = await Promise.all([
        fetch(getFileUrl('sa3_scored.geojson')),
        fetch(getFileUrl('comprehensive_clinic_database.csv')),
        fetch(getFileUrl('sa3_raw.csv')).catch(() => null),
        fetch(getFileUrl('mmm_benchmark.json')).catch(() => null),
        fetch(getFileUrl('sa1_centroids_pop.csv')).catch(() => null),
    ]);

    if (!sa3Res.ok)     throw new Error('Failed to load sa3_scored.geojson');
    if (!clinicsRes.ok) throw new Error('Failed to load enriched_clinics.csv');

    // Parse in parallel where possible
    progressCb('Parsing data…');
    const [sa3Json, clinicsText, rawText, bmJson, sa1Text] = await Promise.all([
        sa3Res.json(),
        clinicsRes.text(),
        rawRes?.ok  ? rawRes.text()  : Promise.resolve(null),
        bmRes?.ok   ? bmRes.json()   : Promise.resolve(null),
        sa1Res?.ok  ? sa1Res.text()  : Promise.resolve(null),
    ]);

    State.sa3Data = sa3Json;

    const parsed = Papa.parse(clinicsText, { header: true, skipEmptyLines: true });
    State.clinicsData = parsed.data.filter(d => d.latitude && d.longitude);

    // Normalise in-memory values to the short-form keys the rest of the app expects.
    // (The CSV is not modified — this only affects the JS runtime objects.)
    const BILLING_NORM = { 'Bulk Billing': 'Bulk', 'Mixed Billing': 'Mixed', 'Private Billing': 'Private' };
    const SERVICE_YES  = new Set(['yes', 'true', 'Yes', 'True']);
    State.clinicsData.forEach(c => {
        // Billing Type → short key used everywhere in buckets / filter chips
        if (c['Billing Type'] && BILLING_NORM[c['Billing Type']]) {
            c['Billing Type'] = BILLING_NORM[c['Billing Type']];
        }
        // Service columns → canonical 'Yes' / 'No'
        ['Pathology', 'Radiology/Imaging', 'Allied Health'].forEach(svc => {
            c[svc] = SERVICE_YES.has(c[svc]) ? 'Yes' : 'No';
        });
        // Strip float suffix from SA3/SA2 codes so they match geojson integer codes
        ['sa3_code', 'sa2_code', 'sa4_code'].forEach(fld => {
            if (c[fld]) c[fld] = String(c[fld]).replace(/\.\d+$/, '');
        });
    });

    // Compute GP multi-site adjustment factors (SA3 → chain → group → corpus hierarchy)
    computeGpAdjustmentFactors(State.clinicsData);
    // Apply adjusted_gp_capacity to every corporate clinic row
    applyGpAdjustmentFactors(State.clinicsData);

    // Extract unique clinic chains for filtering
    const uniqueChains = new Set();
    State.clinicsData.forEach(c => {
        if (c['Corporate Chain'] && c['Corporate Chain'].trim() !== '') {
            uniqueChains.add(c['Corporate Chain'].trim());
        }
    });
    State.uniqueClinicChains = Array.from(uniqueChains).sort();

    if (rawText) {
        const rawParsed = Papa.parse(rawText, {
            header: true, skipEmptyLines: true, transformHeader: h => h.trim()
        });
        rawParsed.data.forEach(row => {
            const code = row['SA3 Code'] || row['SA3_Code'];
            if (code) State.sa3RawLookup[String(code).trim()] = row;
        });
    }

    if (bmJson) State.mmmBenchmark = bmJson;

    // Build SA1 centroid+population lookup (2.3 MB pre-baked CSV, not the 411 MB boundaries file)
    if (sa1Text) {
        const sa1Parsed = Papa.parse(sa1Text, { header: true, skipEmptyLines: true, dynamicTyping: true });
        State.sa1CentroidData = sa1Parsed.data; // [{sa1_code, lat, lon, population}]
        console.log(`[sa1] loaded ${State.sa1CentroidData.length} SA1 centroids`);
    }

    // Build GP Billings lookup from geojson properties (NRA_* fields were precomputed by ETL)
    State.sa3Data.features.forEach(feat => {
        const p = feat.properties;
        const key = `${p.State}|${p.SA3Name}`;
        State.nraLookup[key] = p;
    });

    // sa2_seifa.geojson (7.2 MB) is NOT fetched here — loaded on demand
    // by ensureSEIFALayer() the first time the SEIFA lens is selected.

    progressCb('Indexing clinics…');
    precomputeClinicCounts();
    computeNationalAvgDensity();

    // Re-assign tiers using the smart tiering logic
    // (stored Tiers in geojson may reflect old absolute thresholds)
    const { mode, counts } = assignTiers(State.sa3Data.features);
    State.tieringMode = mode;
    State.tierCounts  = counts;
    console.log(`[tiering] mode=${mode}  T1=${counts[0]} T2=${counts[1]} T3=${counts[2]} T4=${counts[3]} T5=${counts[4]}`);
}

// ============================================================
// GP Effective Capacity — adjustment factor computation
// ============================================================

// Chain-type classification used for Level 3 (group) factors.
// Source: data/clinics/Corporate Only/corporate chains & backers_parent company.csv
const GP_CHAIN_TYPE_MAP = {
    'Family Doctor':                  'Mega Platform',
    'My Health':                      'Mega Platform',
    'Sonic Healthcare (IPN)':         'Mega Platform',
    'ForHealth':                      'Large National',
    'Ochre Health':                   'Large National',
    'Smart Clinics + Better Medical': 'Large National',
    'Partnered Health':               'Large National',
    'Jupiter Health':                 'Mid-Market',
    'Qualitas Health':                'Mid-Market',
    'Sonic Healthcare':               'Mid-Market',
    'Bupa Medical':                   'Mid-Market',
    'Medicross':                      'Mid-Market',
    'Cornerstone Health':             'Mid-Market',
    'Next Practice':                  'Mid-Market',
    'Medical One':                    'Mid-Market',
    'Top Health':                     'Mid-Market',
    'MyClinic':                       'Mid-Market',
    'SIA medical centre':             'Mid-Market',
    'ProHealth Care':                 'Mid-Market',
    'Atticus Health':                 'Niche',
    'Your Doctors':                   'Niche',
    'Tlc Primary Care':               'Niche',
    'Top End':                        'Niche',
    'Amtan Medical':                  'Niche',
    'Dpv Health':                     'Niche',
    'Sarkon Medical Centre':          'Niche',
    'Epichealth':                     'Niche',
};

// Hardcoded Level 2 (chain) and Level 3 (group) factors derived from
// Dataset B analysis. computeGpAdjustmentFactors() updates _byChain at runtime
// if fresh data differs by >5%.
const GP_CHAIN_FACTORS_SEED = {
    'My Health':                     { factor: 0.820, avgClinicsPerGP: 1.219 },
    'Family Doctor':                 { factor: 0.918, avgClinicsPerGP: 1.089 },
    'ForHealth':                     { factor: 0.925, avgClinicsPerGP: 1.082 },
    'Jupiter Health':                { factor: 0.931, avgClinicsPerGP: 1.075 },
    'Smart Clinics + Better Medical':{ factor: 0.950, avgClinicsPerGP: 1.053 },
    'Partnered Health':              { factor: 0.976, avgClinicsPerGP: 1.025 },
    'Qualitas Health':               { factor: 0.978, avgClinicsPerGP: 1.022 },
    'Ochre Health':                  { factor: 0.995, avgClinicsPerGP: 1.005 },
};
const GP_GROUP_FACTORS = {
    'Mega Platform':  0.869,
    'Large National': 0.962,
    'Mid-Market':     0.955,
    'Niche':          0.903,
};
const GP_CORPUS_FACTOR = 0.903;

/**
 * Compute GP multi-site adjustment factors at SA3 and chain levels from
 * the Doctor Names Clean field (Dataset B). Stores results in
 * State.gpAdjustmentFactors.
 *
 * Must be called AFTER data normalisation and BEFORE precomputeClinicCounts().
 * State.sa3Data must already be loaded (sa3Data is fetched in parallel with clinics).
 */
function computeGpAdjustmentFactors(clinicsData) {
    // Initialise with hardcoded seeds
    State.gpAdjustmentFactors._byChain  = Object.assign({}, GP_CHAIN_FACTORS_SEED);
    State.gpAdjustmentFactors._byGroup  = Object.assign({}, GP_GROUP_FACTORS);
    State.gpAdjustmentFactors._byCorpus = GP_CORPUS_FACTOR;
    State.gpAdjustmentFactors._bySA3    = new Map();

    // ── Phase A: build GP→clinic linkage from Doctor Names Clean ──────────
    const gpClinicMap = new Map(); // normName → Set<clinic_id>
    const clinicSA3   = {};        // clinic_id → sa3_code
    const clinicChain = {};        // clinic_id → Corporate Chain

    const STRIP_PREFIXES = ['dr. ', 'dr ', 'doctor ', 'prof. ', 'prof ', 'a/prof ', 'a/prof. '];

    clinicsData.forEach(c => {
        if (c.ownership !== 'Corporate') return; // corporate only
        const raw = (c['Doctor Names Clean'] || '').trim();
        if (!raw || raw === 'nan' || raw === 'None' || raw === '[]') return;

        const cid   = c.clinic_id;
        const sa3   = c.sa3_code || '';
        const chain = (c['Corporate Chain'] || '').trim();
        clinicSA3[cid]   = sa3;
        clinicChain[cid] = chain;

        const seen = new Set();
        raw.split(',').forEach(part => {
            let n = part.trim().toLowerCase();
            STRIP_PREFIXES.forEach(p => { if (n.startsWith(p)) n = n.slice(p.length); });
            n = n.trim();
            if (n.length < 4 || seen.has(n)) return; // artefact or dupe within clinic
            seen.add(n);
            if (!gpClinicMap.has(n)) gpClinicMap.set(n, new Set());
            gpClinicMap.get(n).add(cid);
        });
    });

    const totalGPs      = gpClinicMap.size;
    const multiSiteGPs  = [...gpClinicMap.values()].filter(s => s.size > 1).length;

    // ── Phase B: SA3-level factors (≥20 unique GPs in SA3) ───────────────
    // For each SA3, collect GPs who work there and compute avg total clinic count.
    const sa3GpSets = new Map(); // sa3Code → Set<normName>
    gpClinicMap.forEach((clinicSet, gpName) => {
        clinicSet.forEach(cid => {
            const sa3 = clinicSA3[cid];
            if (!sa3) return;
            if (!sa3GpSets.has(sa3)) sa3GpSets.set(sa3, new Set());
            sa3GpSets.get(sa3).add(gpName);
        });
    });

    let sa3WithOwnFactor = 0;
    sa3GpSets.forEach((gpSet, sa3Code) => {
        if (gpSet.size < 20) return; // insufficient data
        // Sum each GP's FULL clinic count (not just within this SA3)
        let totalLinks = 0;
        gpSet.forEach(gpName => { totalLinks += gpClinicMap.get(gpName).size; });
        const avgClinicsPerGP = totalLinks / gpSet.size;
        const factor = 1 / avgClinicsPerGP;
        State.gpAdjustmentFactors._bySA3.set(sa3Code, {
            factor:          +factor.toFixed(4),
            avgClinicsPerGP: +avgClinicsPerGP.toFixed(4),
            uniqueGPs:       gpSet.size
        });
        sa3WithOwnFactor++;
    });

    // ── Phase C: chain-level factors (≥30 unique GPs for chain) ──────────
    const chainGpSets = new Map(); // chain → Set<normName>
    gpClinicMap.forEach((clinicSet, gpName) => {
        clinicSet.forEach(cid => {
            const chain = clinicChain[cid];
            if (!chain) return;
            if (!chainGpSets.has(chain)) chainGpSets.set(chain, new Set());
            chainGpSets.get(chain).add(gpName);
        });
    });

    chainGpSets.forEach((gpSet, chain) => {
        if (gpSet.size < 30) return;
        let totalLinks = 0;
        gpSet.forEach(gpName => { totalLinks += gpClinicMap.get(gpName).size; });
        const avgClinicsPerGP = totalLinks / gpSet.size;
        const freshFactor     = 1 / avgClinicsPerGP;
        const seed            = GP_CHAIN_FACTORS_SEED[chain];
        if (seed && Math.abs(freshFactor - seed.factor) > 0.05) {
            console.warn(`[gpFactor] ${chain}: seed ${seed.factor.toFixed(3)} vs fresh ${freshFactor.toFixed(3)} — using fresh`);
        }
        State.gpAdjustmentFactors._byChain[chain] = {
            factor:          +freshFactor.toFixed(4),
            avgClinicsPerGP: +avgClinicsPerGP.toFixed(4),
            uniqueGPs:       gpSet.size
        };
    });

    // ── Diagnostics ───────────────────────────────────────────────────────
    State.gpCoverageStats = {
        totalGPs,
        multiSiteGPs,
        multiSitePct:    totalGPs > 0 ? +((multiSiteGPs / totalGPs) * 100).toFixed(1) : 0,
        sa3WithOwnFactor,
        chainCount:      chainGpSets.size
    };
    console.log(`[gpFactor] ${totalGPs} unique GPs, ${multiSiteGPs} multi-site (${State.gpCoverageStats.multiSitePct}%), ${sa3WithOwnFactor} SA3s with own factor`);
}

/**
 * Resolve the most-specific available adjustment factor for a clinic.
 * Level 1: SA3-specific  → Level 2: chain  → Level 3: group  → Level 4: corpus
 */
function resolveGpFactor(clinic) {
    // Level 1: SA3-specific
    const sa3Entry = State.gpAdjustmentFactors._bySA3?.get(clinic.sa3_code);
    if (sa3Entry) return { ...sa3Entry, level: 'sa3' };

    // Level 2: chain-specific
    const chain      = (clinic['Corporate Chain'] || '').trim();
    const chainEntry = State.gpAdjustmentFactors._byChain[chain];
    if (chainEntry) return { ...chainEntry, level: 'chain' };

    // Level 3: chain-type group
    const groupName = GP_CHAIN_TYPE_MAP[chain];
    if (groupName) {
        const gf = State.gpAdjustmentFactors._byGroup[groupName];
        if (gf) return { factor: gf, level: 'group', groupName };
    }

    // Level 4: all-corporate corpus fallback
    return { factor: State.gpAdjustmentFactors._byCorpus, level: 'corpus' };
}

/**
 * Calculate GP FTE for all clinics: FTE = 0.75 × GP count
 * Applied uniformly to both corporate and independent clinics.
 */
function applyGpAdjustmentFactors(clinicsData) {
    clinicsData.forEach(c => {
        const rawCount = parseFloat(c.gp_count) || 0;
        if (rawCount > 0) {
            c.adjusted_gp_capacity = +(rawCount * 0.75).toFixed(2);
            c._gpAdjustmentFactor = 0.75;
            c._gpAdjustmentLevel = 'uniform';
            c._gpImputed = false;
        } else {
            c.adjusted_gp_capacity = null;
            c._gpAdjustmentFactor = 0.75;
            c._gpAdjustmentLevel = 'no_data';
            c._gpImputed = false;
        }
    });
}

// ============================================================
// Precompute clinic count aggregates per SA3
// ============================================================

function computeNationalAvgDensity() {
    // Weighted median of per-SA3 clinic density (weighted by clinic count),
    // so the reference reflects where clinics actually operate, not vast empty SA3s.
    const pairs = [];
    State.sa3Data.features.forEach(feat => {
        const code = String(feat.properties.SA3Code || '').trim();
        const count = State.sa3ClinicCounts[code]?.total || 0;
        if (count === 0) return;
        const areaSqKm = turf.area(feat) / 1e6;
        if (areaSqKm > 0) pairs.push({ density: count / areaSqKm, count });
    });

    // Sort by density and find the count-weighted median
    pairs.sort((a, b) => a.density - b.density);
    const totalClinics = pairs.reduce((s, p) => s + p.count, 0);
    let cum = 0;
    const half = totalClinics / 2;
    for (const p of pairs) {
        cum += p.count;
        if (cum >= half) { State.nationalAvgDensity = p.density; break; }
    }
    console.log('[density] national weighted-median density:', State.nationalAvgDensity?.toFixed(4), 'clinics/km²');
}

function precomputeClinicCounts() {
    if (!State.sa3Data || !State.clinicsData.length) return;

    // Build SA3Code → properties lookup for O(1) tier access
    const sa3Props = {};
    State.sa3Data.features.forEach(f => {
        const code = String(f.properties.SA3Code || '').trim();
        if (code) sa3Props[code] = f.properties;
    });

    // Initialise empty buckets for every SA3 upfront
    State.sa3Data.features.forEach(f => {
        const code = String(f.properties.SA3Code || '').trim();
        State.sa3ClinicCounts[code] = {
            total: 0, independent: 0, corporate: 0, publicngo: 0,
            format:   { 'Big-box': 0, 'Mid-format': 0, 'Small': 0, 'Unclassified': 0 },
            billing:  { 'Bulk': 0, 'Mixed': 0, 'Private': 0, 'Unclassified': 0 },
            ownership:{ 'Corporate': 0, 'Independent': 0, 'NGO': 0 }
        };
        State.sa3TargetMetrics[code] = {};
    });

    // Single O(n) pass over clinics — uses the sa3_code field already on each row
    // (assigned during ETL from NHSD/ABS concordance; matches SA3Code in geojson).
    // NB: the CSV stores sa3_code as a float-like string (e.g. "50601.0"), so we
    // strip any trailing decimal to match the geojson's 5-digit integer codes.
    let unmatched = 0;
    State.clinicsData.forEach(c => {
        const code = String(c['sa3_code'] || c['SA3_code'] || c['SA3Code'] || '').trim().replace(/\.\d+$/, '');
        if (!code || !State.sa3ClinicCounts[code]) { unmatched++; return; }

        const bucket = State.sa3ClinicCounts[code];
        bucket.total++;

        const own = c['ownership'] || '';
        if (own === 'Corporate') { bucket.corporate++; bucket.ownership.Corporate++; }
        else if (own === 'Independent') { bucket.independent++; bucket.ownership.Independent++; }
        else if (own === 'NGO') { bucket.publicngo++; bucket.ownership['NGO']++; }

        const fmt = c['clinic_format'] || 'Unclassified';
        if (fmt in bucket.format) bucket.format[fmt]++;

        const bill = c['Billing Type'] || 'Unclassified';
        if (bill in bucket.billing) bucket.billing[bill]++;

        // F-02: Per-target metrics
        const chainName = (c['Corporate Chain'] || '').trim();
        if (chainName) {
            const tm = State.sa3TargetMetrics[code];
            if (!tm[chainName]) {
                tm[chainName] = {
                    clinics: 0,
                    format:   { 'Big-box': 0, 'Mid-format': 0, 'Small': 0, 'Unclassified': 0 },
                    billing:  { 'Bulk': 0, 'Mixed': 0, 'Private': 0, 'Unclassified': 0 },
                    ownership:{ 'Corporate': 0, 'Independent': 0, 'NGO': 0 },
                    tier1Count: 0
                };
            }
            const entry = tm[chainName];
            entry.clinics++;
            if (fmt  in entry.format)   entry.format[fmt]++;
            if (bill in entry.billing)  entry.billing[bill]++;
            if (own === 'Corporate')         entry.ownership.Corporate++;
            else if (own === 'Independent')  entry.ownership.Independent++;
            else if (own === 'NGO') entry.ownership['NGO']++;
            // SA3 tier comes from the lookup, not the PiP result
            if ((sa3Props[code]?.Tier || 0) === 1) entry.tier1Count++;

            // GP adjusted capacity accumulation per chain-SA3 cell
            if (c.adjusted_gp_capacity != null && !c._gpImputed) {
                entry.adjCapSum   = (entry.adjCapSum   || 0) + c.adjusted_gp_capacity;
                entry.adjCapCount = (entry.adjCapCount || 0) + 1;
            }
        }

        // GP capacity aggregation per SA3 bucket (corporate non-imputed only)
        if (own === 'Corporate' && c.adjusted_gp_capacity != null && !c._gpImputed) {
            bucket.gpCapacitySum   = (bucket.gpCapacitySum   || 0) + c.adjusted_gp_capacity;
            bucket.gpCapacityCount = (bucket.gpCapacityCount || 0) + 1;
            if (!bucket._gpRaw) bucket._gpRaw = [];
            bucket._gpRaw.push(parseFloat(c.gp_count) || 0);
        }
    });

    if (unmatched > 0) console.warn(`[precompute] ${unmatched} clinics had no matching SA3Code`);

    // Finalise per-SA3 GP capacity fields
    Object.entries(State.sa3ClinicCounts).forEach(([code, bucket]) => {
        bucket.totalAdjustedGpCapacity = bucket.gpCapacitySum || 0;
        bucket.medianRawGpCount        = medianOf(bucket._gpRaw || []);
        bucket.gpDataCoveragePct       = bucket.corporate > 0
            ? Math.round((bucket.gpCapacityCount || 0) / bucket.corporate * 100) : 0;
        const sa3Factor = State.gpAdjustmentFactors._bySA3?.get(code);
        bucket.gpAdjustmentFactor = sa3Factor?.factor || null;
        bucket.gpAdjustmentLevel  = sa3Factor ? 'sa3' : null;
        delete bucket._gpRaw;
        delete bucket.gpCapacitySum;
    });

    // F-02: Build target summary and overlap matrix
    buildTargetMetaSummary();
    buildTargetOverlapMatrix();
}

/** Helper: compute median of a numeric array (returns 0 for empty). */
function medianOf(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * F-02: Compute per-target aggregate statistics across all SA3s
 */
function buildTargetMetaSummary() {
    State.targetMetaSummary = {};

    Object.keys(State.sa3TargetMetrics).forEach(sa3Code => {
        const targetsInSA3 = State.sa3TargetMetrics[sa3Code];
        Object.keys(targetsInSA3).forEach(chainName => {
            if (!State.targetMetaSummary[chainName]) {
                State.targetMetaSummary[chainName] = {
                    totalClinics: 0,
                    regionsPresent: 0,
                    avgComposite: 0,
                    tier1Count: 0,
                    tier2Count: 0,
                    formatMix: { 'Big-box': 0, 'Mid-format': 0, 'Small': 0, 'Unclassified': 0 },
                    billingMix: { 'Bulk': 0, 'Mixed': 0, 'Private': 0, 'Unclassified': 0 },
                    ownershipMix: { 'Corporate': 0, 'Independent': 0, 'NGO': 0 }
                };
            }
            const summary = State.targetMetaSummary[chainName];
            const metrics = targetsInSA3[chainName];

            summary.totalClinics += metrics.clinics;
            summary.regionsPresent++;
            summary.tier1Count += metrics.tier1Count;
            // GP adjusted capacity accumulation
            summary.totalAdjustedGpCapacity  = (summary.totalAdjustedGpCapacity  || 0) + (metrics.adjCapSum   || 0);
            summary.gpCoveredClinicCount     = (summary.gpCoveredClinicCount     || 0) + (metrics.adjCapCount || 0);

            Object.keys(metrics.format).forEach(fmt => {
                summary.formatMix[fmt] = (summary.formatMix[fmt] || 0) + metrics.format[fmt];
            });
            Object.keys(metrics.billing).forEach(bill => {
                summary.billingMix[bill] = (summary.billingMix[bill] || 0) + metrics.billing[bill];
            });
            Object.keys(metrics.ownership).forEach(own => {
                summary.ownershipMix[own] = (summary.ownershipMix[own] || 0) + metrics.ownership[own];
            });
        });
    });

    // Compute average composite + GP capacity derived fields per target
    Object.keys(State.targetMetaSummary).forEach(chainName => {
        const summary = State.targetMetaSummary[chainName];
        let compositeSum = 0;
        let regionsWithData = 0;

        Object.keys(State.sa3TargetMetrics).forEach(sa3Code => {
            if (State.sa3TargetMetrics[sa3Code][chainName]) {
                const sa3Feature = State.sa3Data.features.find(f => f.properties.SA3Code === sa3Code);
                if (sa3Feature) {
                    compositeSum += sa3Feature.properties.Composite_Score || 0;
                    regionsWithData++;
                }
            }
        });
        summary.avgComposite = regionsWithData > 0 ? (compositeSum / regionsWithData).toFixed(1) : 0;

        // GP capacity derived fields
        const total    = summary.totalClinics   || 0;
        const covered  = summary.gpCoveredClinicCount || 0;
        summary.avgAdjustedGpCapacityPerClinic =
            total > 0 && summary.totalAdjustedGpCapacity
                ? +(summary.totalAdjustedGpCapacity / total).toFixed(2) : 0;
        summary.gpCoveragePct = total > 0 ? Math.round(covered / total * 100) : 0;

        // Resolve chain-level adjustment factor for display
        const chainEntry = State.gpAdjustmentFactors._byChain[chainName];
        const groupName  = GP_CHAIN_TYPE_MAP[chainName];
        const groupFactor= groupName && State.gpAdjustmentFactors._byGroup[groupName];
        if (chainEntry) {
            summary.adjustmentFactor = chainEntry.factor;
            summary.adjustmentLevel  = 'chain';
        } else if (groupFactor) {
            summary.adjustmentFactor = groupFactor;
            summary.adjustmentLevel  = 'group';
        } else {
            summary.adjustmentFactor = State.gpAdjustmentFactors._byCorpus;
            summary.adjustmentLevel  = 'corpus';
        }
    });
}

/**
 * F-02: Build overlap matrix showing which target pairs coexist in SA3s
 */
function buildTargetOverlapMatrix() {
    State.targetOverlapMatrix = {};
    const allChains = Object.keys(State.targetMetaSummary).sort();

    for (let i = 0; i < allChains.length; i++) {
        for (let j = i + 1; j < allChains.length; j++) {
            const chainA = allChains[i];
            const chainB = allChains[j];
            const key = `${chainA}|${chainB}`;

            let overlapCount = 0;
            Object.keys(State.sa3TargetMetrics).forEach(sa3Code => {
                const hasA = State.sa3TargetMetrics[sa3Code][chainA];
                const hasB = State.sa3TargetMetrics[sa3Code][chainB];
                if (hasA && hasB) overlapCount++;
            });

            State.targetOverlapMatrix[key] = {
                count: overlapCount,
                percentage: State.targetMetaSummary[chainA].regionsPresent > 0
                    ? ((overlapCount / State.targetMetaSummary[chainA].regionsPresent) * 100).toFixed(1)
                    : 0
            };
        }
    }
}

// ============================================================
// Map
// ============================================================
let map;
let mapReady;
let hoveredFeatureId = null;

function initMap() {
    // Clear container first to avoid Mapbox warning about non-empty container
    const container = document.getElementById('map');
    if (container) container.innerHTML = '';

    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/light-v11',
        center: [134.0, -26.0],
        zoom: 3.7,
        pitch: 0,
        bearing: 0,
        attributionControl: false
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    // Expose globally so auth code can call resize() after showing map view
    window.appMap = map;

    mapReady = new Promise(resolve => {
        let done = false;
        const fin = () => { if (done) return; done = true; resolve(); };
        map.on('load', fin);
        map.on('style.load', fin);
        const poll = setInterval(() => {
            if (map.isStyleLoaded()) { clearInterval(poll); fin(); }
        }, 200);
    });
}

// ============================================================
// Datasets-as-layers (plan Phase E) — per-clinic-layer map source/layer
// helpers. Shared by attachMapLayers() (initial build, primary layer only
// today since switchMarket() always resets activeClinicLayers to just the
// new scoring market) and toggleClinicLayer() (adding/removing a secondary
// layer live, without a full attachMapLayers() rebuild).
// ============================================================
// Guards against "Layer already exists" — seen in testing when a checkbox's
// change event fires more than once for a single toggle (this environment's
// click handling can double-fire). Idempotent add is cheap insurance.
function addLayerSafe(config) {
    if (!map.getLayer(config.id)) map.addLayer(config);
}

function buildClinicLayerSource(layer) {
    const clinics = State.clinicsByVertical[layer] || [];
    const geojson = {
        type: 'FeatureCollection',
        features: clinics.map((c, idx) => ({
            type: 'Feature',
            id: idx,
            geometry: { type: 'Point', coordinates: [parseFloat(c.longitude), parseFloat(c.latitude)] },
            properties: c
        }))
    };
    const sourceId = `clinics-${layer}`;
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(geojson);
    } else {
        map.addSource(sourceId, { type: 'geojson', data: geojson, cluster: true, clusterMaxZoom: 6, clusterRadius: 50 });
    }
    return sourceId;
}

function addPrimaryClinicLayers(layer) {
    const sourceId = buildClinicLayerSource(layer);

    addLayerSafe({
        id: 'clinics-clusters',
        type: 'circle',
        source: sourceId,
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': '#465E4D',
            'circle-opacity': 0.85,
            'circle-stroke-color': '#FFFFFF',
            'circle-stroke-width': 1.5,
            'circle-radius': [
                'step', ['get', 'point_count'],
                12, 25, 16, 100, 20, 500, 26
            ]
        }
    });
    addLayerSafe({
        id: 'clinics-cluster-count',
        type: 'symbol',
        source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 11,
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular']
        },
        paint: { 'text-color': '#FFFFFF' }
    });

    const clinicLayerStyle = (color) => ({
        'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            6,  ['match', ['get', 'clinic_format'], 'Big-box', 4.5, 'Mid-format', 3.5, 'Small', 2.5, 3],
            12, ['match', ['get', 'clinic_format'], 'Big-box', 10,  'Mid-format', 8,   'Small', 6,   7]
        ],
        'circle-color': color,
        'circle-opacity': 0.9,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 1.2
    });

    addLayerSafe({
        id: 'clinics-corporate',
        type: 'circle',
        source: sourceId,
        filter: ['==', ['get', 'ownership'], 'Corporate'],
        paint: clinicLayerStyle(OWNERSHIP_COLORS.Corporate),
        minzoom: 6
    });
    addLayerSafe({
        id: 'clinics-independent',
        type: 'circle',
        source: sourceId,
        filter: ['==', ['get', 'ownership'], 'Independent'],
        paint: clinicLayerStyle(OWNERSHIP_COLORS.Independent),
        minzoom: 6
    });
    addLayerSafe({
        id: 'clinics-public',
        type: 'circle',
        source: sourceId,
        filter: ['==', ['get', 'ownership'], 'NGO'],
        paint: clinicLayerStyle(OWNERSHIP_COLORS['NGO']),
        minzoom: 6
    });
    addLayerSafe({
        id: 'clinics-unknown',
        type: 'circle',
        source: sourceId,
        filter: ['==', ['get', 'ownership'], 'Unknown'],
        paint: clinicLayerStyle('#9A9A9A'), // neutral grey for unknown ownership
        minzoom: 6
    });

    addLayerSafe({
        id: 'clinics-labels',
        type: 'symbol',
        source: sourceId,
        minzoom: 10,
        layout: {
            'text-field': ['get', 'clinic_name'],
            'text-size': 10,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular']
        },
        paint: {
            'text-color': '#000000',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 1.5,
            'text-halo-blur': 0.5
        }
    });
}

// Secondary (non-scoring) clinic layer — a single outlined/hollow circle
// style, no ownership split, no labels. Visually reads as "overlay, not
// the scored dataset" per the plan's primary-vs-secondary distinction.
function addSecondaryClinicLayer(layer) {
    const sourceId = buildClinicLayerSource(layer);

    addLayerSafe({
        id: `clinics-${layer}-clusters`,
        type: 'circle',
        source: sourceId,
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': 'rgba(255,255,255,0.5)',
            'circle-stroke-color': '#6E6E68',
            'circle-stroke-width': 1.5,
            'circle-radius': [
                'step', ['get', 'point_count'],
                10, 25, 14, 100, 18, 500, 24
            ]
        }
    });
    addLayerSafe({
        id: `clinics-${layer}-cluster-count`,
        type: 'symbol',
        source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 10,
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular']
        },
        paint: { 'text-color': '#3a3a37' }
    });
    addLayerSafe({
        id: `clinics-${layer}-pins`,
        type: 'circle',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        minzoom: 6,
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 6.5],
            'circle-color': 'rgba(255,255,255,0.6)',
            'circle-stroke-color': '#6E6E68',
            'circle-stroke-width': 1.4
        }
    });

    wireSecondaryClinicLayerEvents(layer);
}

function removeClinicLayer(layer) {
    const isPrimary = layer === State.markets.current;
    const ids = isPrimary
        ? ['clinics-labels', 'clinics-unknown', 'clinics-public', 'clinics-independent', 'clinics-corporate', 'clinics-cluster-count', 'clinics-clusters']
        : [`clinics-${layer}-pins`, `clinics-${layer}-cluster-count`, `clinics-${layer}-clusters`];
    ids.forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    const sourceId = `clinics-${layer}`;
    if (map.getSource(sourceId)) map.removeSource(sourceId);
}

async function attachMapLayers() {
    await mapReady;

    try {
        const layers = map.getStyle().layers;
        layers.forEach(l => {
            if (l.type === 'symbol' && l.id.includes('label')) {
                map.setPaintProperty(l.id, 'text-color', '#9A9A9A');
            }
        });
    } catch (e) {}

    map.addSource('sa3', { type: 'geojson', data: State.sa3Data, generateId: true });

    map.addLayer({
        id: 'sa3-fill',
        type: 'fill',
        source: 'sa3',
        paint: {
            'fill-color': [
                'step', ['get', 'Composite_Score'],
                TIER_COLORS[5],
                40, TIER_COLORS[4],
                55, TIER_COLORS[3],
                70, TIER_COLORS[2],
                85, TIER_COLORS[1]
            ],
            'fill-color-transition': { duration: 400 },
            'fill-opacity': [
                'case',
                ['boolean', ['feature-state', 'hover'], false], 0.78,
                ['boolean', ['feature-state', 'selected'], false], 0.85,
                0.55
            ]
        }
    });

    map.addLayer({
        id: 'sa3-outline',
        type: 'line',
        source: 'sa3',
        paint: {
            'line-color': '#FFFFFF',
            'line-width': [
                'case',
                ['boolean', ['feature-state', 'selected'], false], 2.4,
                0.6
            ],
            'line-opacity': 0.85
        }
    });

    map.addLayer({
        id: 'sa3-outline-sel',
        type: 'line',
        source: 'sa3',
        paint: {
            'line-color': '#000000',
            'line-width': [
                'case',
                ['boolean', ['feature-state', 'selected'], false], 1.4,
                0
            ]
        }
    });

    // Datasets-as-layers (plan Phase E): one source+layer-set per active
    // clinic layer, not one shared 'clinics' source. The scoring market's
    // own layer (primary) keeps its original ids/ownership-split styling
    // (clinics-corporate etc.) unchanged — every existing filter/click
    // handler that references those ids keeps working untouched. Other
    // active layers (secondary — additive overlays, don't drive scoring)
    // get their own muted/outlined `clinics-{layer}-*` ids.
    State.activeClinicLayers.forEach((layer) => {
        if (layer === State.markets.current) {
            addPrimaryClinicLayers(layer);
        } else {
            addSecondaryClinicLayer(layer);
        }
    });

    // SA2 SEIFA layer is added on first use (ensureSEIFALayer) to avoid
    // fetching 7.2 MB at startup for users who never switch to SEIFA lens.

    // Initialize active clinic marker source for isochrone visualization
    map.addSource('activeClinicMarker', {
        type: 'geojson',
        data: turf.featureCollection([])
    });

    wireMapInteractions();
    setMapView(State.currentMapView);  // initial legend + rail visibility
}

// ---- F-06: Lazy SEIFA layer — fetched + added only on first SEIFA lens switch ----
async function ensureSEIFALayer() {
    // Already added — just make visible
    if (map.getSource('sa2')) {
        map.setLayoutProperty('sa2-seifa-fill',    'visibility', 'visible');
        map.setLayoutProperty('sa2-seifa-outline', 'visibility', 'visible');
        return;
    }

    // Loaded on demand (shown once per session)
    try {
        State.sa2Data = await fetchSa2Geojson();
    } catch (e) {
        console.warn('sa2 geojson load failed:', e);
        return;
    }

    map.addSource('sa2', { type: 'geojson', data: State.sa2Data });
    map.addLayer({
        id: 'sa2-seifa-fill',
        type: 'fill',
        source: 'sa2',
        layout: { visibility: 'visible' },
        paint: {
            'fill-color': [
                'case',
                ['==', ['get', 'IRSAD_Decile'], null], '#E5E7E4',
                ['step', ['get', 'IRSAD_Decile'],
                    TIER_COLORS[5], 2, '#E68866', 3, TIER_COLORS[4],
                    4, '#E8C99B',   5, '#E8E0BE', 6, TIER_COLORS[3],
                    7, '#B5CFA0',   8, TIER_COLORS[2], 9, '#5E7D63',
                    10, TIER_COLORS[1]
                ]
            ],
            'fill-color-transition': { duration: 300 },
            'fill-opacity': 0.68
        }
    }, 'clinics-corporate');
    map.addLayer({
        id: 'sa2-seifa-outline',
        type: 'line',
        source: 'sa2',
        layout: { visibility: 'visible' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 0.3, 'line-opacity': 0.6 }
    }, 'clinics-corporate');

    // Wire hover interactions now that the layer exists
    const tooltip = document.getElementById('map-tooltip');
    if (tooltip) {
        map.on('mouseenter', 'sa2-seifa-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mousemove', 'sa2-seifa-fill', (e) => {
            if (!e.features.length) return;
            const p = e.features[0].properties;
            tooltip.innerHTML = `
                <div class="map-tooltip-name">${p.SA2Name}</div>
                <div class="map-tooltip-meta">
                    ${p.State} · IRSAD ${p.IRSAD_Decile != null ? 'decile ' + p.IRSAD_Decile : 'n/a'}
                    ${p.IRSAD_Score != null ? ' · score ' + p.IRSAD_Score : ''}
                    ${p.Population != null ? ' · pop ' + fmtInt(p.Population) : ''}
                </div>`;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.point.x + 14) + 'px';
            tooltip.style.top  = (e.point.y + 14) + 'px';
        });
        map.on('mouseleave', 'sa2-seifa-fill', () => {
            map.getCanvas().style.cursor = '';
            tooltip.style.display = 'none';
        });
    }

    // Apply SEIFA range filter if already set
    applySeifaFilter();
}

// ============================================================
// F-06 — Map view switching (Composite / Whitespace / SEIFA)
// ============================================================
function setMapView(view) {
    State.currentMapView = view;
    renderCatalogueLensChips(); // plan Phase G — keeps the dynamic SEIFA chip's active class in sync

    // Model-inputs disclosure (plan Phase F) only makes sense for Composite
    const modelInputsLink = document.getElementById('model-inputs-link');
    if (modelInputsLink) modelInputsLink.style.display = view === 'composite' ? '' : 'none';
    if (view !== 'composite') {
        const disclosure = document.getElementById('model-inputs-disclosure');
        if (disclosure) disclosure.classList.add('hidden');
    }

    const sa3Vis = (view === 'seifa') ? 'none' : 'visible';

    ['sa3-fill', 'sa3-outline', 'sa3-outline-sel'].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', sa3Vis);
    });

    if (view === 'seifa') {
        // Load + show SEIFA layer lazily (first switch fetches 7.2 MB, subsequent are instant)
        ensureSEIFALayer();
    } else if (map.getLayer('sa2-seifa-fill')) {
        map.setLayoutProperty('sa2-seifa-fill',    'visibility', 'none');
        map.setLayoutProperty('sa2-seifa-outline', 'visibility', 'none');
    }

    // Swap SA3 fill-color expression
    if (view === 'whitespace') {
        map.setPaintProperty('sa3-fill', 'fill-color', [
            'step', ['coalesce', ['get', 'Whitespace_Score'], 0],
            '#E8EFE9',         // 0
            25, '#C5E0B3',     // 25
            50, '#97C777',     // 50
            75, '#6E9277',     // 75
            100, '#465E4D'     // 100
        ]);
    } else if (view === 'composite') {
        // Always colour by Tier property (works correctly for both absolute and percentile modes)
        map.setPaintProperty('sa3-fill', 'fill-color', [
            'match', ['get', 'Tier'],
            1, TIER_COLORS[1],
            2, TIER_COLORS[2],
            3, TIER_COLORS[3],
            4, TIER_COLORS[4],
            TIER_COLORS[5]
        ]);
    } else if (view === 'workforce') {
        map.setPaintProperty('sa3-fill', 'fill-color', [
            'step', ['coalesce', ['get', 'Workforce_Risk_Score'], 0],
            '#E8EFE9',
            20, '#C5E0B3',
            40, '#97C777',
            60, '#6E9277',
            80, '#465E4D'
        ]);
    } else if (view === 'nra-fees-per-service') {
        map.setPaintProperty('sa3-fill', 'fill-color', [
            'case', ['==', ['get', 'NRA_Score_Fees_Per_Service'], null], '#CCCCCC',
            ['step', ['coalesce', ['get', 'NRA_Score_Fees_Per_Service'], -1],
                '#CCCCCC',
                0, '#E8F5E9',
                20, '#C8E6C9',
                40, '#81C784',
                60, '#4CAF50',
                80, '#2E7D32'
            ]
        ]);
    } else if (view === 'nra-total-fees') {
        map.setPaintProperty('sa3-fill', 'fill-color', [
            'case', ['==', ['get', 'NRA_Score_Total_Fees'], null], '#CCCCCC',
            ['step', ['coalesce', ['get', 'NRA_Score_Total_Fees'], -1],
                '#CCCCCC',
                0, '#E8F5E9',
                20, '#C8E6C9',
                40, '#81C784',
                60, '#4CAF50',
                80, '#2E7D32'
            ]
        ]);
    } else if (view === 'nra-bb') {
        map.setPaintProperty('sa3-fill', 'fill-color', [
            'case', ['==', ['get', 'NRA_BB_Rate'], null], '#CCCCCC',
            ['step', ['coalesce', ['get', 'NRA_BB_Rate'], -1],
                '#CCCCCC',
                0, '#C62828',
                25, '#EF5350',
                50, '#EEEEEE',
                75, '#7CB342',
                90, '#2E7D32'
            ]
        ]);
    } else if (view === 'nra-fee-cagr') {
        map.setPaintProperty('sa3-fill', 'fill-color', [
            'case', ['==', ['get', 'NRA_Fee_Charged_CAGR'], null], '#CCCCCC',
            ['step', ['coalesce', ['get', 'NRA_Fee_Charged_CAGR'], -99],
                '#CCCCCC',
                -99, '#C62828',
                0, '#EEEEEE',
                5, '#7CB342',
                10, '#2E7D32'
            ]
        ]);
    } else if (view === 'nra-bb-cagr') {
        map.setPaintProperty('sa3-fill', 'fill-color', [
            'case', ['==', ['get', 'NRA_BB_Rate_CAGR'], null], '#CCCCCC',
            ['step', ['coalesce', ['get', 'NRA_BB_Rate_CAGR'], -99],
                '#CCCCCC',
                -99, '#C62828',
                0, '#EEEEEE',
                2, '#7CB342',
                5, '#2E7D32'
            ]
        ]);
    }

    // Update lens control UI
    updateLensUI(view);

    renderLegend(view);
}

// Render the colour legend matching the current map view
function renderLegend(view) {
    const titleEl = document.getElementById('legend-title');
    const bodyEl = document.getElementById('legend-content');
    if (!titleEl || !bodyEl) return;

    if (view === 'composite') {
        const isPct = State.tieringMode === 'percentile';
        titleEl.textContent = isPct ? 'Composite tier ramp (percentile)' : 'Composite tier ramp';
        const rows = isPct
            ? [
                { sw: 'var(--tier-1)', label: 'Tier 1 · Exceptional', range: '≥ 95th pct'   },
                { sw: 'var(--tier-2)', label: 'Tier 2 · Strong',      range: '85–95th pct'  },
                { sw: 'var(--tier-3)', label: 'Tier 3 · Moderate',    range: '50–85th pct'  },
                { sw: 'var(--tier-4)', label: 'Tier 4 · Weak',        range: '20–50th pct'  },
                { sw: 'var(--tier-5)', label: 'Tier 5 · Poor',        range: '< 20th pct'   }
              ]
            : [
                { sw: 'var(--tier-1)', label: 'Tier 1 · Exceptional', range: '85–100' },
                { sw: 'var(--tier-2)', label: 'Tier 2 · Strong',      range: '70–84'  },
                { sw: 'var(--tier-3)', label: 'Tier 3 · Moderate',    range: '55–69'  },
                { sw: 'var(--tier-4)', label: 'Tier 4 · Weak',        range: '40–54'  },
                { sw: 'var(--tier-5)', label: 'Tier 5 · Poor',        range: '0–39'   }
              ];
        bodyEl.innerHTML = rows.map(r => `
            <div class="tier-row">
                <span class="tier-swatch" style="background:${r.sw}"></span>
                <span>${r.label}</span>
                <span class="tier-range">${r.range}</span>
            </div>
        `).join('') + (isPct ? `
            <div class="tier-row-note">
                <span style="color:var(--muted);font-size:10px;line-height:1.4">
                    Percentile mode active — score range too compressed for absolute thresholds
                </span>
            </div>` : '');
        return;
    }

    if (view === 'whitespace') {
        titleEl.textContent = 'Whitespace ramp';
        bodyEl.innerHTML = [
            { sw: '#465E4D', label: 'Very high · all 4 signals',  score: '100' },
            { sw: '#6E9277', label: 'High · 3 of 4 signals',     score: '75'  },
            { sw: '#97C777', label: 'Medium · 2 of 4 signals',   score: '50'  },
            { sw: '#C5E0B3', label: 'Low · 1 of 4 signals',      score: '25'  },
            { sw: '#E8EFE9', label: 'None · no signals',         score: '0'   }
        ].map(r => `
            <div class="tier-row">
                <span class="tier-swatch" style="background:${r.sw}"></span>
                <span>${r.label}</span>
                <span class="tier-range num">${r.score}</span>
            </div>
        `).join('') + `
            <div class="tier-row-note">
                <span style="color:var(--muted);font-size:10px;line-height:1.4">
                    Signals: low SES · low corporate share · high demand · workforce risk ≥60
                </span>
            </div>
        `;
        return;
    }

    if (view === 'workforce') {
        titleEl.textContent = 'Workforce risk';
        bodyEl.innerHTML = [
            { sw: '#465E4D', label: 'Severe', range: '80–100' },
            { sw: '#6E9277', label: 'High',   range: '60–79'  },
            { sw: '#97C777', label: 'Elevated',range: '40–59' },
            { sw: '#C5E0B3', label: 'Moderate',range: '20–39' },
            { sw: '#E8EFE9', label: 'Low',     range: '0–19'  }
        ].map(r => `
            <div class="tier-row">
                <span class="tier-swatch" style="background:${r.sw}"></span>
                <span>${r.label}</span>
                <span class="tier-range">${r.range}</span>
            </div>
        `).join('') + `
            <div class="tier-row-note">
                <span style="color:var(--muted);font-size:10px;line-height:1.4">
                    Supply density · age cohort · DPA
                </span>
            </div>
        `;
        return;
    }

    if (view === 'seifa') {
        titleEl.textContent = 'SEIFA IRSAD decile (SA2)';
        // Diverging strip — 10 narrow swatches representing decile 1 → 10
        const stops = [
            '#C00000', '#E68866', '#FFC000', '#E8C99B', '#E8E0BE',
            '#97C777', '#B5CFA0', '#6E9277', '#5E7D63', '#465E4D'
        ];
        bodyEl.innerHTML = `
            <div class="seifa-legend-strip">
                ${stops.map((c, i) => `
                    <div class="seifa-legend-swatch" style="background:${c}"
                         title="Decile ${i + 1}"></div>
                `).join('')}
            </div>
            <div class="seifa-legend-axis">
                <span>1 · Most disadvantaged</span>
                <span>10 · Most advantaged</span>
            </div>
            <div class="tier-row-note">
                <span style="color:var(--muted);font-size:10px;line-height:1.4">
                    Filter SA2s with the SEIFA decile slider above.
                </span>
            </div>
        `;
        return;
    }

    const nraSwatchRow = (sw, label) => `
        <div class="tier-row">
            <span class="tier-swatch" style="background:${sw}"></span>
            <span>${label}</span>
        </div>`;
    const nraNoData = `
        <div class="tier-row">
            <span class="tier-swatch" style="background:#CCCCCC"></span>
            <span style="color:var(--muted)">No data (Lord Howe Is. only)</span>
        </div>`;

    if (view === 'nra-fees-per-service') {
        titleEl.textContent = 'Avg fees per service';
        bodyEl.innerHTML = [
            ['#2E7D32', '80th–100th pct · highest'],
            ['#4CAF50', '60th–79th pct · high'],
            ['#81C784', '40th–59th pct · moderate'],
            ['#C8E6C9', '20th–39th pct · low'],
            ['#E8F5E9', '0–19th pct · lowest'],
        ].map(([sw, l]) => nraSwatchRow(sw, l)).join('') + nraNoData + `
            <div class="tier-row-note">
                <span style="color:var(--muted);font-size:10px;line-height:1.4">
                    Fee Charged ($) ÷ Service Count · Rolling 4Q to Dec 2025
                </span>
            </div>`;
        return;
    }

    if (view === 'nra-total-fees') {
        titleEl.textContent = 'Total fees';
        bodyEl.innerHTML = [
            ['#2E7D32', '80th–100th pct · largest market'],
            ['#4CAF50', '60th–79th pct · large'],
            ['#81C784', '40th–59th pct · moderate'],
            ['#C8E6C9', '20th–39th pct · small'],
            ['#E8F5E9', '0–19th pct · smallest'],
        ].map(([sw, l]) => nraSwatchRow(sw, l)).join('') + nraNoData + `
            <div class="tier-row-note">
                <span style="color:var(--muted);font-size:10px;line-height:1.4">
                    Total fees charged in SA3 · Rolling 4Q to Dec 2025
                </span>
            </div>`;
        return;
    }

    if (view === 'nra-bb') {
        titleEl.textContent = 'Bulk billing %';
        bodyEl.innerHTML = [
            ['#2E7D32', '90–100% · almost all bulk-billed'],
            ['#7CB342', '75–89% · high bulk-billing'],
            ['#EEEEEE', '50–74% · mixed billing'],
            ['#EF5350', '25–49% · low bulk-billing'],
            ['#C62828', '0–24% · mostly private'],
        ].map(([sw, l]) => nraSwatchRow(sw, l)).join('') + nraNoData + `
            <div class="tier-row-note">
                <span style="color:var(--muted);font-size:10px;line-height:1.4">
                    Bulk-billed services ÷ total services · Rolling 4Q to Dec 2025
                </span>
            </div>`;
        return;
    }

    if (view === 'nra-fee-cagr') {
        titleEl.textContent = '3-Year fee CAGR';
        bodyEl.innerHTML = [
            ['#2E7D32', '≥10% growth · fast-rising market'],
            ['#7CB342', '5–9% · healthy growth'],
            ['#EEEEEE', '0–4% · flat / in-line'],
            ['#C62828', 'Negative · fee decline'],
        ].map(([sw, l]) => nraSwatchRow(sw, l)).join('') + nraNoData + `
            <div class="tier-row-note">
                <span style="color:var(--muted);font-size:10px;line-height:1.4">
                    3-year CAGR · rolling 4Q Dec 2025 vs Dec 2022
                </span>
            </div>`;
        return;
    }

    if (view === 'nra-bb-cagr') {
        titleEl.textContent = '3-Year BB% CAGR';
        bodyEl.innerHTML = [
            ['#2E7D32', '≥5% · rapid BB% increase'],
            ['#7CB342', '2–4% · rising BB%'],
            ['#EEEEEE', '~0% · stable BB mix'],
            ['#C62828', 'Negative · BB% declining'],
        ].map(([sw, l]) => nraSwatchRow(sw, l)).join('') + nraNoData + `
            <div class="tier-row-note">
                <span style="color:var(--muted);font-size:10px;line-height:1.4">
                    3-year CAGR in bulk billing rate · Dec 2025 vs Dec 2022
                </span>
            </div>`;
        return;
    }
}

// ============================================================
// Datasets-as-layers (plan Phase F) — live running SA3 count below the
// funnel. Reuses updateRailStats()'s own filter chain (state/MMM for
// geography, +DPA/workforce for "after filters") — no new data or
// filtering logic, per the plan's own "no new data needed" constraint.
// ============================================================
function renderFunnelRegionCount(allCount, afterGeoCount, afterFiltersCount, scoredCount) {
    const el = document.getElementById('funnel-region-count');
    if (!el) return;
    const row = (label, val) => `<div class="funnel-count-row"><span>${label}</span><span>${val.toLocaleString('en-AU')}</span></div>`;
    el.innerHTML =
        row('All SA3', allCount) +
        row('After geography', afterGeoCount) +
        row('After filters', afterFiltersCount) +
        row('Scored &amp; rankable', scoredCount);
}

// Deferred "Model inputs"/coverage-strip disclosure (plan Phase F) — an
// explicit placeholder (the canvas asked for this twice and never resolved
// a layout), surfaced behind the Composite chip per one of the canvas's own
// two candidate answers. Reuses the same scored/total counts as the
// running count above — no new computation invented.
function toggleModelInputsDisclosure() {
    const el = document.getElementById('model-inputs-disclosure');
    if (!el) return;
    const opening = el.classList.contains('hidden');
    el.classList.toggle('hidden', !opening);
    if (opening) renderModelInputsDisclosure();
}

function renderModelInputsDisclosure() {
    const el = document.getElementById('model-inputs-disclosure');
    if (!el || !State.sa3Data) return;
    const all = State.sa3Data.features.length;
    const scored = State.sa3Data.features.filter(f => Number.isFinite(parseFloat(f.properties.Composite_Score))).length;
    el.innerHTML = `
        <div class="model-inputs-note">
            <strong>Model inputs</strong> — placeholder, not a finished design.
            ${scored.toLocaleString('en-AU')} of ${all.toLocaleString('en-AU')} SA3 scored
            (Demand · Supply · Competition · Economics).
        </div>
    `;
}

// One legend swatch per active clinic layer — primary (scoring market,
// filled dot, matches attachMapLayers()'s ownership-colored styling) vs
// secondary (hollow/outlined dot, matches addSecondaryClinicLayer()'s
// muted style). Call after anything that changes State.activeClinicLayers.
function renderClinicLayerLegend() {
    const row = document.getElementById('clinic-layer-legend-row');
    const el = document.getElementById('clinic-layer-legend');
    if (!row || !el) return;
    const labels = { gp: 'General Practice', physio: 'Physiotherapy', dental: 'Dental' };
    row.style.display = State.activeClinicLayers.length ? '' : 'none';
    el.innerHTML = State.activeClinicLayers.map((layer) => {
        const isPrimary = layer === State.markets.current;
        const swatch = isPrimary
            ? '<span class="clinic-layer-swatch clinic-layer-swatch-primary"></span>'
            : '<span class="clinic-layer-swatch clinic-layer-swatch-secondary"></span>';
        return `<div class="tier-row">${swatch}<span>${labels[layer] || layer}${isPrimary ? ' · scoring' : ''}</span></div>`;
    }).join('');
}

// ============================================================
// Data Catalogue (plan Phase G) — Step 3 ships empty by default; datasets
// are grouped by the composite dimension they feed (matching the weight
// labels already in Step 4). "Required" rows are informational only (baked
// into every score already); "optional" rows are genuinely loadable using
// only data this app actually has. The mockup's illustrative datasets
// (population projections, disease prevalence, etc.) are NOT reproduced —
// see the plan's own "do not fabricate new datasets" note.
// ============================================================
// Each category is grouped into logical sections (not a required/optional
// split) — a locked item just carries `locked:true` and renders an inline
// badge, same row style as an optional one. Matches the reference design's
// own grouping (e.g. "Population & Projections", "Epidemiology & Burden").
//
// This reproduces the FULL reference catalogue, including datasets this
// app doesn't actually have yet — those carry `available: false` and
// render as a greyed-out, disabled row with a "Not available" badge
// instead of either faking them as loadable or omitting them silently.
// Only items with a real `key` (seifa / workforce / gpBillings) or
// `locked: true` on something this app genuinely computes are real.
const CATALOGUE_CATEGORIES = [
    {
        key: 'demand', name: 'Demand', weight: 30,
        desc: 'How much care this population will need, and how that’s changing.',
        sections: [
            { name: 'Population & Projections', items: [
                { label: 'Estimated resident population', hint: 'ABS ERP · Jun 2024 — feeds the composite', locked: true, type: 'REGION' },
                { label: 'Population projections to 2031', hint: 'ABS series B · Nov 2023', available: false, type: 'REGION' },
                { label: 'Share of population aged 65+', hint: 'ABS ERP · Jun 2024 — shown in every region’s profile, not a composite input', locked: true, lockedLabel: 'In region profile', type: 'REGION' },
                { label: 'Population growth, 5-year CAGR', hint: 'Derived · ABS ERP — the growth half of Demand, feeds the composite', locked: true, type: 'REGION' },
            ]},
            { name: 'Epidemiology & Burden', items: [
                { label: 'Type 2 diabetes prevalence', hint: 'PHIDU · Apr 2023', available: false, type: 'REGION' },
                { label: 'COPD prevalence', hint: 'PHIDU · Apr 2023', available: false, type: 'REGION' },
                { label: 'Mental health conditions', hint: 'PHIDU · Apr 2023', available: false, type: 'REGION' },
                { label: 'ED presentations per 1,000', hint: 'AIHW · Jan 2025', available: false, type: 'REGION' },
            ]},
            { name: 'Aged-care Demand', items: [
                { label: 'Residential aged-care places', hint: 'GEN Aged Care · Apr 2025', available: false, type: 'REGION' },
                { label: 'Home care packages', hint: 'GEN Aged Care · Apr 2025', available: false, type: 'REGION' },
            ]},
        ],
    },
    {
        key: 'supply', name: 'Supply', weight: 35,
        desc: 'Who is already serving this population — sites on the ground, and the practitioners inside them.',
        sections: [
            { name: 'Sites & Business Counts', items: [
                { label: 'General practice clinics', hint: 'NHSD · Mar 2025', layerToggle: 'gp', type: 'PINS' },
                { label: 'Physiotherapy clinics', hint: 'NHSD · Mar 2025', layerToggle: 'physio', type: 'PINS' },
                { label: 'Dental clinics', hint: 'NHSD · Mar 2025 — 0 clinics loaded for this market today', available: false, type: 'PINS' },
                { label: 'Community pharmacies', hint: 'PBS approved suppliers · Feb 2025', available: false, type: 'PINS' },
                { label: 'Public hospitals & emergency departments', hint: 'AIHW · Jan 2025', available: false, type: 'PINS' },
                { label: 'Telehealth-only providers', hint: 'MyHR · Mar 2025', available: false, type: 'PINS' },
            ]},
            { name: 'Density & Saturation', items: [
                { label: 'Clinics per 10,000 residents', hint: 'Derived · NHSD × ABS ERP — the Supply input, feeds the composite', locked: true, type: 'REGION' },
            ]},
            { name: 'Practitioner Workforce', items: [
                { key: 'workforce', label: 'Workforce risk & DPA flags', hint: 'DoctorConnect DPA status + composite supply/age/DPA risk score', gpOnly: true, type: 'REGION' },
                { label: 'GP FTE per 100,000', hint: 'NHWDS · Jun 2024', available: false, type: 'REGION' },
                { label: 'Allied health FTE per 100,000', hint: 'NHWDS · Jun 2024', available: false, type: 'REGION' },
                { label: 'Registrar training posts', hint: 'RACGP / ACRRM · Feb 2025', available: false, type: 'REGION' },
                { label: 'Practitioner churn, 3-year', hint: 'Derived · NHWDS', available: false, type: 'REGION' },
            ]},
        ],
    },
    {
        key: 'competition', name: 'Competition', weight: 20,
        desc: 'Who already holds the ground and how consolidated it already is.',
        sections: [
            { name: 'Ownership & Consolidation', items: [
                { label: 'Ownership mix — corporate vs independent', hint: 'Foundry classification · Mar 2025 — feeds the composite', locked: true, type: 'REGION' },
                { label: 'Chain penetration by SA3', hint: 'Foundry classification · Mar 2025', available: false, type: 'REGION' },
                { label: 'Recorded transactions, 5-year', hint: 'Foundry deal log · Mar 2025', available: false, type: 'REGION' },
            ]},
            { name: 'Saturation', items: [
                { label: 'Mean catchment overlap', hint: 'Derived · drive-time isochrones', available: false, type: 'REGION' },
            ]},
            { name: 'Adjacent Providers', items: [
                { label: 'Aged-care provider locations', hint: 'GEN Aged Care · Apr 2025', available: false, type: 'PINS' },
            ]},
        ],
    },
    {
        key: 'economics', name: 'Economics', weight: 15,
        desc: 'What a practice can bill here, and who can pay for it.',
        sections: [
            { name: 'Household Means', items: [
                { label: 'Median household income', hint: '2021 Census · ABS — feeds the composite', locked: true, type: 'REGION' },
                { key: 'seifa', label: 'SEIFA IRSAD decile', hint: '2021 Census · ABS — socioeconomic disadvantage/advantage, decile 1 (most disadvantaged) to 10', type: 'REGION' },
                { label: 'SEIFA IRSD decile', hint: '2021 Census · ABS', available: false, type: 'REGION' },
            ]},
            { name: 'Payer Mix & Billing', items: [
                { key: 'gpBillings', label: 'Bulk-billing rate, non-referred attendances', hint: 'Services Australia · Dec 2024 — also includes avg fees/service, total fees, 3Y CAGR', gpOnly: true, type: 'REGION' },
                { label: 'MBS services per capita', hint: 'PHIDU · Apr 2023', available: false, type: 'REGION' },
                { label: 'Private health insurance coverage', hint: 'APRA · Jun 2024', available: false, type: 'REGION' },
            ]},
            { name: 'Program Funding', items: [
                { label: 'Commonwealth Home Support Programme (CHSP)', hint: 'PHIDU · Apr 2023', available: false, type: 'REGION' },
                { label: 'National Disability Insurance Scheme (NDIS)', hint: 'PHIDU · Apr 2023', available: false, type: 'REGION' },
            ]},
        ],
    },
];

// "Start here" quick bundles — each pre-stages a specific, real combination
// of the optional items above (not the mockup's illustrative bundles).
const CATALOGUE_BUNDLES = [
    { key: 'base', name: 'Base case', desc: 'Just what the model requires — nothing extra loaded.', loads: [] },
    { key: 'workforce_access', name: 'Workforce & access', desc: 'Add workforce risk and DPA flags to narrow by supply-side pressure.', loads: ['workforce'] },
    { key: 'full_economics', name: 'Full economics', desc: 'Add SEIFA and GP Billings for a complete economics read.', loads: ['seifa', 'gpBillings'] },
];

// All optional item keys across every category, regardless of gpOnly/market
// visibility — used to reset a bundle cleanly (anything not in the bundle's
// `loads` gets explicitly unloaded, not just left alone).
function allCatalogueOptionalKeys() {
    return CATALOGUE_CATEGORIES.flatMap((cat) => cat.sections.flatMap((s) => s.items.filter((i) => i.key).map((i) => i.key)));
}

// Staged selections while the modal is open — committed to
// State.catalogueLoaded only on "Load", so switching categories mid-review
// doesn't lose an unsaved checkbox change in a category you've clicked away
// from.
let catalogueActiveCategory = 'supply';
let catalogueStaged = {};

function visibleCatalogueSections(cat) {
    const isGP = State.markets.current === 'gp';
    return cat.sections
        .map((s) => ({ ...s, items: s.items.filter((i) => !i.gpOnly || isGP) }))
        .filter((s) => s.items.length);
}

function catalogueStagedChangeCount() {
    const keys = allCatalogueOptionalKeys();
    return keys.filter((k) => !!catalogueStaged[k] !== !!State.catalogueLoaded[k]).length;
}

function renderCatalogueNav() {
    const nav = document.getElementById('catalogue-modal-nav');
    if (!nav) return;
    const bundleHtml = '<div class="catalogue-nav-hdr">Start here</div>' + CATALOGUE_BUNDLES.map((b) => `
        <button type="button" class="catalogue-bundle-card" onclick="applyCatalogueBundle('${b.key}')">
            <div class="catalogue-bundle-name">${b.name}<span class="catalogue-bundle-count">${b.loads.length}</span></div>
            <div class="catalogue-bundle-desc">${b.desc}</div>
        </button>
    `).join('');
    const categoryHtml = '<div class="catalogue-nav-hdr">All interest areas</div>' + CATALOGUE_CATEGORIES.map((cat) => {
        const sections = visibleCatalogueSections(cat);
        const allItems = sections.flatMap((s) => s.items);
        const lockedCount = allItems.filter((i) => i.locked || (i.layerToggle && i.layerToggle === State.markets.current)).length;
        const loadedCount = allItems.filter((i) => {
            if (i.layerToggle) return i.layerToggle === State.markets.current || State.activeClinicLayers.includes(i.layerToggle);
            return i.locked || catalogueStaged[i.key];
        }).length;
        return `
            <button type="button" class="catalogue-nav-item${cat.key === catalogueActiveCategory ? ' active' : ''}" onclick="selectCatalogueCategory('${cat.key}')">
                <div class="catalogue-nav-item-name">${cat.name}</div>
                <div class="catalogue-nav-item-sub">
                    <span class="catalogue-nav-item-counts">${loadedCount} of ${allItems.length} loaded · ${lockedCount} locked</span>
                    <span class="catalogue-nav-item-weight">${cat.weight}%</span>
                </div>
            </button>
        `;
    }).join('');
    nav.innerHTML = bundleHtml + categoryHtml;
}

function renderCatalogueDetail(key) {
    const detail = document.getElementById('catalogue-modal-detail');
    if (!detail) return;
    const cat = CATALOGUE_CATEGORIES.find((c) => c.key === key);
    if (!cat) return;
    const sections = visibleCatalogueSections(cat);
    detail.innerHTML = `
        <div class="catalogue-detail-hdr">
            <span class="catalogue-detail-name">${cat.name}</span>
            <span class="catalogue-detail-weight">${cat.weight}% of the composite</span>
        </div>
        <div class="catalogue-detail-desc">${cat.desc}</div>
        ${sections.map((s) => `
            <div class="catalogue-detail-subhdr">${s.name}</div>
            ${s.items.map((i) => {
                const typeTag = i.type ? `<span class="catalogue-row-type">${i.type}</span>` : '';
                if (i.layerToggle) {
                    const layer = i.layerToggle;
                    const isPrimary = layer === State.markets.current;
                    const checked = isPrimary || State.activeClinicLayers.includes(layer);
                    // Unlike seifa/workforce/gpBillings below, clinic layers apply the
                    // instant you click them (same as Step 1's own checkboxes) -- they're
                    // never staged, so "Load" never lights up for them. Without a visual
                    // cue that's easy to misread as "the checkbox didn't do anything" --
                    // a real bug report turned out to be exactly this confusion, not a
                    // broken checkbox. The badge/hint make the immediate-effect explicit.
                    const badge = isPrimary
                        ? '<span class="catalogue-row-badge">Scoring market</span>'
                        : (checked ? '<span class="catalogue-row-badge catalogue-row-badge-live">On the map now</span>' : '');
                    const hint = isPrimary
                        ? `${i.hint} — the scoring market's own layer is always on`
                        : `${i.hint} — optional overlay, applies instantly on click, not part of "Load" below`;
                    return `
                        <label class="catalogue-row${isPrimary ? ' locked' : ''}">
                            <input type="checkbox" ${checked ? 'checked' : ''} ${isPrimary ? 'disabled' : ''} onchange="toggleClinicLayer('${layer}', this.checked)">
                            <div>
                                <div class="catalogue-row-label">${i.label}${typeTag}${badge}</div>
                                <div class="catalogue-row-hint">${hint}</div>
                            </div>
                        </label>
                    `;
                }
                if (i.locked) {
                    return `
                        <div class="catalogue-row locked">
                            <input type="checkbox" checked disabled>
                            <div>
                                <div class="catalogue-row-label">${i.label}${typeTag}<span class="catalogue-row-badge">${i.lockedLabel || 'Required by the model'}</span></div>
                                <div class="catalogue-row-hint">${i.hint}</div>
                            </div>
                        </div>
                    `;
                }
                if (i.available === false) {
                    return `
                        <div class="catalogue-row unavailable">
                            <input type="checkbox" disabled>
                            <div>
                                <div class="catalogue-row-label">${i.label}${typeTag}<span class="catalogue-row-badge catalogue-row-badge-unavailable">Not available</span></div>
                                <div class="catalogue-row-hint">${i.hint}</div>
                            </div>
                        </div>
                    `;
                }
                return `
                    <label class="catalogue-row">
                        <input type="checkbox" class="catalogue-item-checkbox" data-key="${i.key}" ${catalogueStaged[i.key] ? 'checked' : ''} onchange="stageCatalogueItem('${i.key}', this.checked)">
                        <div>
                            <div class="catalogue-row-label">${i.label}${typeTag}</div>
                            <div class="catalogue-row-hint">${i.hint}</div>
                        </div>
                    </label>
                `;
            }).join('')}
        `).join('')}
    `;
}

function selectCatalogueCategory(key) {
    catalogueActiveCategory = key;
    renderCatalogueNav();
    renderCatalogueDetail(key);
}

function stageCatalogueItem(key, checked) {
    catalogueStaged[key] = checked;
    renderCatalogueNav(); // refresh the "X of Y loaded" counts + Load button state
    renderCatalogueFooter();
}

function applyCatalogueBundle(bundleKey) {
    const bundle = CATALOGUE_BUNDLES.find((b) => b.key === bundleKey);
    if (!bundle) return;
    allCatalogueOptionalKeys().forEach((k) => { catalogueStaged[k] = bundle.loads.includes(k); });
    renderCatalogueNav();
    renderCatalogueDetail(catalogueActiveCategory);
    renderCatalogueFooter();
}

function renderCatalogueFooter() {
    const count = catalogueStagedChangeCount();
    const statusEl = document.getElementById('catalogue-staged-status');
    if (statusEl) statusEl.textContent = count === 0 ? 'No changes staged' : `${count} change${count === 1 ? '' : 's'} staged`;
    // Never disabled -- clinic-layer toggles (see layerToggle rows above) apply
    // instantly and aren't part of this staged count, so a user who only touched
    // those would otherwise be stuck using "Cancel" to close, which reads as
    // discarding a change that already took effect. Load always safely closes:
    // it commits the staged seifa/workforce/gpBillings diff if there is one, and
    // is a harmless no-op close otherwise -- relabelled "Done" in that case so it
    // doesn't read as loading nothing.
    const loadBtn = document.getElementById('catalogue-load-btn');
    if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.textContent = count === 0 ? 'Done' : 'Load';
    }
}

function openDataCatalogue() {
    catalogueStaged = { ...State.catalogueLoaded };
    renderCatalogueNav();
    renderCatalogueDetail(catalogueActiveCategory);
    renderCatalogueFooter();
    document.getElementById('catalogue-modal-backdrop')?.classList.remove('hidden');
}

function closeDataCatalogue() {
    document.getElementById('catalogue-modal-backdrop')?.classList.add('hidden');
}

function loadDataCatalogueSelections() {
    if (catalogueStagedChangeCount() > 0) {
        State.catalogueLoaded = { ...catalogueStaged };
        applyCatalogueLoadedState();
    }
    closeDataCatalogue();
}

// Applies State.catalogueLoaded to the actual UI: Step 3 filter sections,
// the dynamic Colour-by chip(s), and the GP Billings dropdown.
function applyCatalogueLoadedState() {
    const groundEmpty = document.getElementById('catalogue-ground-empty');
    const groundBtn = document.getElementById('ground-add-from-catalogue');
    const seifaSection = document.getElementById('ses-remoteness-section');
    const workforceSection = document.getElementById('workforce-section');
    const extraFilters = document.getElementById('ground-extra-filters');
    const anyLoaded = State.catalogueLoaded.seifa || State.catalogueLoaded.workforce || State.catalogueLoaded.gpBillings;

    if (seifaSection) seifaSection.classList.toggle('hidden', !State.catalogueLoaded.seifa);
    if (workforceSection) workforceSection.classList.toggle('hidden', !State.catalogueLoaded.workforce);
    if (extraFilters) extraFilters.classList.toggle('hidden', !anyLoaded);
    if (groundEmpty) groundEmpty.classList.toggle('hidden', anyLoaded);
    if (groundBtn) groundBtn.textContent = anyLoaded ? 'Add more from catalogue' : 'Add from catalogue';
    if (!State.catalogueLoaded.seifa) State.catalogueFilterActive.seifa = false; // reset on unload

    renderCatalogueLensChips();
    renderCatalogueDatasetControls(); // plan Phase G
    updateGPSpecificFilters(); // re-checks catalogueLoaded.gpBillings for the NRA dropdown
    renderFunnelSummaries();
    updateRailStats(); // a dataset load/unload can change the running region count
}

// Per-loaded-dataset control bar (plan Phase G) — "Colour map by this" /
// "Limit regions" (SEIFA only — workforce already narrows immediately via
// its own pre-existing slider/checkboxes) / "✕" to unload.
function renderCatalogueDatasetControls() {
    const seifaEl = document.getElementById('seifa-dataset-controls');
    if (seifaEl) {
        seifaEl.innerHTML = State.catalogueLoaded.seifa ? `
            <span class="catalogue-dataset-name">SEIFA IRSAD decile</span>
            <div class="catalogue-dataset-btn-row">
                <button type="button" class="catalogue-dataset-btn" onclick="colourMapByDataset('seifa')">Colour map by this</button>
                <button type="button" class="catalogue-dataset-btn${State.catalogueFilterActive.seifa ? ' active' : ''}" onclick="toggleSeifaRegionLimit()">Limit regions</button>
                <button type="button" class="catalogue-dataset-remove" onclick="removeCatalogueDataset('seifa')" title="Remove SEIFA IRSAD decile">✕</button>
            </div>
        ` : '';
    }
    const workforceEl = document.getElementById('workforce-dataset-controls');
    if (workforceEl) {
        workforceEl.innerHTML = State.catalogueLoaded.workforce ? `
            <span class="catalogue-dataset-name">Workforce risk &amp; DPA flags</span>
            <div class="catalogue-dataset-btn-row">
                <button type="button" class="catalogue-dataset-btn" onclick="colourMapByDataset('workforce')">Colour map by this</button>
                <button type="button" class="catalogue-dataset-remove" onclick="removeCatalogueDataset('workforce')" title="Remove workforce risk & DPA flags">✕</button>
            </div>
        ` : '';
    }
}

function colourMapByDataset(key) {
    const lens = { seifa: 'seifa', workforce: 'workforce' }[key];
    if (!lens) return;
    setMapView(lens);
    saveLensState(lens);
}

// Removing a dataset unloads it from the catalogue entirely (equivalent to
// unchecking it there) — clears its filter state too so nothing stays
// silently applied after its controls disappear.
function removeCatalogueDataset(key) {
    State.catalogueLoaded[key] = false;
    catalogueStaged[key] = false;
    if (key === 'seifa') {
        State.seifaDeciles = [];
        document.querySelectorAll('.seifa-chip').forEach((c) => { c.checked = false; });
        State.catalogueFilterActive.seifa = false;
        applySeifaFilter();
    }
    if (key === 'workforce') {
        State.dpaFilter = { bonded: false, gpImg: false };
        State.workforceRiskMin = 0;
        const bondedEl = document.getElementById('dpa-bonded'); if (bondedEl) bondedEl.checked = false;
        const gpImgEl = document.getElementById('dpa-gp-img'); if (gpImgEl) gpImgEl.checked = false;
        const sliderEl = document.getElementById('workforce-risk-slider'); if (sliderEl) sliderEl.value = 0;
        const readoutEl = document.getElementById('workforce-risk-readout'); if (readoutEl) readoutEl.textContent = '0';
        applyWorkforceFilters();
    }
    applyCatalogueLoadedState();
    updateFilterChips();
}

// SA2 → SA3 aggregation for the SEIFA "Limit regions" toggle — an SA3
// "passes" if at least one of its SA2s falls in a selected decile. Real
// data (SA2 features carry SA3Code — see fetchSa2Geojson()), not a
// fabricated shortcut; lazily loads the SA2 dataset if needed since it's
// otherwise only fetched on first switching to the SEIFA lens.
function computeSeifaPassingSA3Codes() {
    if (!State.sa2Data) return null; // caller re-runs updateRailStats() once ensureSEIFALayer() resolves
    const passing = new Set();
    State.sa2Data.features.forEach((f) => {
        const p = f.properties;
        if (State.seifaDeciles.includes(p.IRSAD_Decile)) passing.add(String(p.SA3Code).trim());
    });
    return passing;
}

async function toggleSeifaRegionLimit() {
    State.catalogueFilterActive.seifa = !State.catalogueFilterActive.seifa;
    if (State.catalogueFilterActive.seifa && !State.sa2Data) {
        await ensureSEIFALayer(); // populates State.sa2Data as a side effect
    }
    renderCatalogueDatasetControls();
    updateRailStats();
}

// Dynamic Colour-by chip for SEIFA (desktop + mobile) — only appears once
// loaded from the catalogue. Delegated active-class sync (wireLensActiveSync
// in wireUI) handles visual state on click; setMapView() itself calls this
// too so the chip's active class stays correct even when SEIFA is entered
// via decile-chip selection rather than a direct click on this chip.
function renderCatalogueLensChips() {
    const wireChip = (btn) => {
        btn.addEventListener('click', () => { setMapView(btn.dataset.lens); saveLensState(btn.dataset.lens); });
    };
    const desktop = document.getElementById('catalogue-lens-chips');
    if (desktop) {
        desktop.innerHTML = State.catalogueLoaded.seifa
            ? `<button class="lens-seg${State.currentMapView === 'seifa' ? ' active' : ''}" data-lens="seifa">SEIFA</button>` : '';
        desktop.querySelectorAll('.lens-seg').forEach(wireChip);
    }
    const mobile = document.getElementById('mob-catalogue-lens-chips');
    if (mobile) {
        mobile.innerHTML = State.catalogueLoaded.seifa
            ? `<button class="mob-lens-chip lens-seg${State.currentMapView === 'seifa' ? ' active' : ''}" data-lens="seifa">SEIFA</button>` : '';
        mobile.querySelectorAll('.lens-seg').forEach(wireChip);
    }
}

function applySeifaFilter() {
    if (!map.getLayer('sa2-seifa-fill')) return;
    const stateFilter = State.currentState ? ['==', ['get', 'State'], State.currentState] : ['literal', true];

    let seifaFilter;
    if (State.seifaDeciles && State.seifaDeciles.length > 0) {
        // New chip-based filter: exact decile matches
        seifaFilter = ['in', ['coalesce', ['get', 'IRSAD_Decile'], 0], ['literal', State.seifaDeciles]];
    } else {
        // Legacy range filter (all deciles when none selected = show all)
        const [lo, hi] = State.seifaRange;
        seifaFilter = ['all',
            ['>=', ['coalesce', ['get', 'IRSAD_Decile'], 0], lo],
            ['<=', ['coalesce', ['get', 'IRSAD_Decile'], 0], hi]
        ];
    }

    const filter = stateFilter[0] === 'literal'
        ? seifaFilter
        : ['all', stateFilter, seifaFilter];
    map.setFilter('sa2-seifa-fill', filter);
    map.setFilter('sa2-seifa-outline', filter);
}

function applyMmmFilter() {
    // MMM filters the SA3 layer; state filter already applied separately
    const stateFilter = State.currentState ? ['==', ['get', 'State'], State.currentState] : null;
    const mmmFilter = State.mmmFilter.length
        ? ['in', ['coalesce', ['get', 'MMM_Dominant'], 0], ['literal', State.mmmFilter]]
        : null;

    const filters = [stateFilter, mmmFilter].filter(Boolean);
    const combined = filters.length === 0 ? null
        : filters.length === 1 ? filters[0]
        : ['all', ...filters];

    ['sa3-fill', 'sa3-outline', 'sa3-outline-sel'].forEach(id => {
        if (map.getLayer(id)) map.setFilter(id, combined);
    });
}

// F-01: Filter clinic map markers by archetype (Format / Billing / Ownership)
function applyArchetypeFilter() {
    const { format, billing, ownership } = State.archetypeFilter;
    const hasFilter = format.length || billing.length || ownership.length;

    const layerIds = ['clinics-corporate', 'clinics-independent', 'clinics-public'];
    const ownershipBase = {
        'clinics-corporate':   ['==', ['get', 'ownership'], 'Corporate'],
        'clinics-independent': ['==', ['get', 'ownership'], 'Independent'],
        'clinics-public':      ['==', ['get', 'ownership'], 'NGO'],
    };

    if (!hasFilter) {
        layerIds.forEach(id => { if (map.getLayer(id)) map.setFilter(id, ownershipBase[id]); });
        if (map.getLayer('clinics-labels')) map.setFilter('clinics-labels', null);
        return;
    }

    const parts = [];
    if (format.length)    parts.push(['in', ['get', 'clinic_format'],        ['literal', format]]);
    if (billing.length)   parts.push(['in', ['get', 'Billing Type'], ['literal', billing]]);
    if (ownership.length) parts.push(['in', ['get', 'ownership'], ['literal', ownership]]);
    const archetypePart = parts.length === 1 ? parts[0] : ['all', ...parts];

    layerIds.forEach(id => {
        if (!map.getLayer(id)) return;
        map.setFilter(id, ['all', ownershipBase[id], archetypePart]);
    });
    if (map.getLayer('clinics-labels')) map.setFilter('clinics-labels', archetypePart);
}

function zoomToFilteredClinics() {
    /**
     * Auto-zoom map to fit all filtered clinic chains in view.
     * Also ensures zoom level is high enough to show individual clinic markers.
     */
    if (!State.clinicChainFilter || State.clinicChainFilter.length === 0) return;

    // Find all clinics matching selected chains
    const filteredClinics = State.clinicsData.filter(c =>
        c['Corporate Chain'] && State.clinicChainFilter.includes(c['Corporate Chain'].trim())
    );

    if (filteredClinics.length === 0) return;

    // Calculate bounding box
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    filteredClinics.forEach(clinic => {
        const lat = parseFloat(clinic.latitude);
        const lng = parseFloat(clinic.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
        }
    });

    if (minLat === Infinity) return;

    // fitBounds to show all filtered clinics. maxZoom caps the zoom for single-clinic
    // selections. No minZoom — national chains (Sonic, Smart Clinics) span the continent
    // and should be visible at the national view; the layer minzoom is lowered to 2
    // when a filter is active so pins render at any zoom level.
    map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 60, duration: 600, maxZoom: 11 }
    );
}

function applyClinicChainFilter() {
    /**
     * Filter clinics by selected corporate clinic chains.
     * Combines with archetype and data availability filters.
     */
    const { clinicChainFilter } = State;

    if (clinicChainFilter.length === 0) {
        // No chain filter selected — re-apply other filters
        applyDataAvailabilityFilter();
        return;
    }

    // Auto-zoom to show filtered clinics
    zoomToFilteredClinics();

    // Build filter expression: show clinics from selected chains
    const chainPart = ['in', ['get', 'Corporate Chain'], ['literal', clinicChainFilter]];

    // Also apply data availability filters if any
    const { has_website, has_gp_data } = State.dataAvailabilityFilter;
    const dataParts = [];
    if (has_website) dataParts.push(['!=', ['coalesce', ['get', 'website'], ''], '']);
    if (has_gp_data) dataParts.push(['!=', ['coalesce', ['get', 'gp_count'],  ''], '']);

    // Build archetype filter
    const { format, billing, ownership } = State.archetypeFilter;
    const archetypeParts = [];
    if (format.length)    archetypeParts.push(['in', ['get', 'clinic_format'],        ['literal', format]]);
    if (billing.length)   archetypeParts.push(['in', ['get', 'Billing Type'], ['literal', billing]]);
    if (ownership.length) archetypeParts.push(['in', ['get', 'ownership'], ['literal', ownership]]);

    // Combine all active filters
    let finalFilter = chainPart;
    if (dataParts.length > 0) {
        const dataPart = dataParts.length === 1 ? dataParts[0] : ['all', ...dataParts];
        finalFilter = ['all', finalFilter, dataPart];
    }
    if (archetypeParts.length > 0) {
        const archetypePart = archetypeParts.length === 1 ? archetypeParts[0] : ['all', ...archetypeParts];
        finalFilter = ['all', finalFilter, archetypePart];
    }

    // Apply to map layers
    const layerIds = ['clinics-corporate', 'clinics-independent', 'clinics-public'];
    const ownershipBase = {
        'clinics-corporate':   ['==', ['get', 'ownership'], 'Corporate'],
        'clinics-independent': ['==', ['get', 'ownership'], 'Independent'],
        'clinics-public':      ['==', ['get', 'ownership'], 'NGO'],
    };

    layerIds.forEach(id => {
        if (!map.getLayer(id)) return;
        map.setFilter(id, ['all', ownershipBase[id], finalFilter]);
        // Drop minzoom to 2 so pins are visible even for national chains (Sonic,
        // Smart Clinics) whose fitBounds lands at a continental zoom level.
        map.setLayerZoomRange(id, 2, 24);
    });
    if (map.getLayer('clinics-labels')) {
        map.setFilter('clinics-labels', finalFilter);
    }

    // Matte out SA3 background when clinic chain filter is active
    if (map.getLayer('sa3-fill')) {
        map.setPaintProperty('sa3-fill', 'fill-opacity', 0.3);
    }
}

function resetClinicLayerZoom() {
    /**
     * Reset clinic layer zoom ranges to their original values (minzoom 6) when
     * no chain filter is active. No radius manipulation — pins stay at their
     * defined size from the layer definition.
     */
    const layerIds = ['clinics-corporate', 'clinics-independent', 'clinics-public'];
    layerIds.forEach(id => {
        if (map.getLayer(id)) {
            map.setLayerZoomRange(id, 6, 24); // original minzoom as defined at layer creation
        }
    });

    // Restore SA3 background opacity
    if (map.getLayer('sa3-fill')) {
        map.setPaintProperty('sa3-fill', 'fill-opacity', 0.8);
    }
}

function applyDataAvailabilityFilter() {
    const { has_website, has_gp_data } = State.dataAvailabilityFilter;
    const hasAnyFilter = has_website || has_gp_data;

    // If clinic chain filter is active, let it handle the combined filtering
    if (State.clinicChainFilter.length > 0) {
        applyClinicChainFilter();
        return;
    }

    if (!hasAnyFilter) {
        // No data-availability filters — just re-apply archetype filter cleanly
        resetClinicLayerZoom();
        applyArchetypeFilter();
        return;
    }

    // CSV values are strings from PapaParse. Missing = "" or null.
    // Use coalesce to handle both null (absent property) and "" (empty string).
    const parts = [];
    if (has_website) parts.push(['!=', ['coalesce', ['get', 'website'], ''], '']);
    if (has_gp_data) parts.push(['!=', ['coalesce', ['get', 'gp_count'],  ''], '']);

    const dataAvailabilityPart = parts.length === 1 ? parts[0] : ['all', ...parts];

    // Get current archetype filter
    const { format, billing, ownership } = State.archetypeFilter;
    const archetypeHasFilter = format.length || billing.length || ownership.length;

    const archetypeParts = [];
    if (format.length)    archetypeParts.push(['in', ['get', 'clinic_format'],        ['literal', format]]);
    if (billing.length)   archetypeParts.push(['in', ['get', 'Billing Type'], ['literal', billing]]);
    if (ownership.length) archetypeParts.push(['in', ['get', 'ownership'], ['literal', ownership]]);
    const archetypePart = archetypeParts.length === 0 ? null
                        : archetypeParts.length === 1 ? archetypeParts[0]
                        : ['all', ...archetypeParts];

    const layerIds = ['clinics-corporate', 'clinics-independent', 'clinics-public'];
    const ownershipBase = {
        'clinics-corporate':   ['==', ['get', 'ownership'], 'Corporate'],
        'clinics-independent': ['==', ['get', 'ownership'], 'Independent'],
        'clinics-public':      ['==', ['get', 'ownership'], 'NGO'],
    };

    layerIds.forEach(id => {
        if (!map.getLayer(id)) return;
        const filters = [ownershipBase[id], dataAvailabilityPart];
        if (archetypePart) filters.push(archetypePart);
        map.setFilter(id, filters.length === 1 ? filters[0] : ['all', ...filters]);
    });

    if (map.getLayer('clinics-labels')) {
        const filters = [dataAvailabilityPart];
        if (archetypePart) filters.push(archetypePart);
        map.setFilter('clinics-labels', filters.length === 1 ? filters[0] : ['all', ...filters]);
    }
}

function applyWorkforceFilters() {
    const stateFilter = State.currentState ? ['==', ['get', 'State'], State.currentState] : null;
    const mmmFilter = State.mmmFilter.length
        ? ['in', ['coalesce', ['get', 'MMM_Dominant'], 0], ['literal', State.mmmFilter]]
        : null;

    const { bonded, gpImg } = State.dpaFilter;
    let dpaFilter = null;
    if (bonded && gpImg) {
        dpaFilter = ['all', ['==', ['get', 'DPA_Bonded'], true], ['==', ['get', 'DPA_GP_IMG'], true]];
    } else if (bonded) {
        dpaFilter = ['==', ['get', 'DPA_Bonded'], true];
    } else if (gpImg) {
        dpaFilter = ['==', ['get', 'DPA_GP_IMG'], true];
    }

    const riskFilter = State.workforceRiskMin > 0
        ? ['>=', ['coalesce', ['get', 'Workforce_Risk_Score'], 0], State.workforceRiskMin]
        : null;

    // Copilot-only filters (plan Phase H) — same "[] = no filter" convention
    // as mmmFilter above, no manual rail control for either.
    const tierFilterExpr = State.tierFilter.length
        ? ['in', ['get', 'Tier'], ['literal', State.tierFilter]]
        : null;
    const regionFilterExpr = State.regionFilter && State.regionFilter.sa3Codes.length
        ? ['in', ['get', 'SA3Code'], ['literal', State.regionFilter.sa3Codes]]
        : null;
    // "Low competitive density" -> HIGH Supply_Score, not low (per the
    // Gap 2 semantic alias: fewer clinics relative to population = more
    // attractive = higher Supply score — see schema.sql's comment on
    // sa3.supply_score). Confirmed against live data: every current tier
    // 1-2 SA3 sits above the national median Supply_Score, none below it.
    const densityFilterExpr = State.supplyScoreMin != null
        ? ['>=', ['coalesce', ['get', 'Supply_Score'], 0], State.supplyScoreMin]
        : null;

    const filters = [stateFilter, mmmFilter, dpaFilter, riskFilter, tierFilterExpr, regionFilterExpr, densityFilterExpr].filter(Boolean);
    const combined = filters.length === 0 ? null
        : filters.length === 1 ? filters[0]
        : ['all', ...filters];

    ['sa3-fill', 'sa3-outline', 'sa3-outline-sel'].forEach(id => {
        if (map.getLayer(id)) map.setFilter(id, combined);
    });
}

function showToast(msg, durationMs = 3500) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(State._toastTimer);
    State._toastTimer = setTimeout(() => el.classList.add('hidden'), durationMs);
}

function wireMapInteractions() {
    const tooltip = document.getElementById('map-tooltip');

    map.on('mousemove', 'sa3-fill', (e) => {
        if (!e.features.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const f = e.features[0];
        if (hoveredFeatureId !== null && hoveredFeatureId !== f.id) {
            map.setFeatureState({ source: 'sa3', id: hoveredFeatureId }, { hover: false });
        }
        hoveredFeatureId = f.id;
        map.setFeatureState({ source: 'sa3', id: hoveredFeatureId }, { hover: true });

        const p = f.properties;
        const t = parseInt(p.Tier);
        tooltip.innerHTML = `
            <div class="map-tooltip-name">${p.SA3Name}</div>
            <div class="map-tooltip-meta">${p.State} · Score ${Math.round(parseFloat(p.Composite_Score))} · ${TIER_LABELS[t]}</div>
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.point.x + 14) + 'px';
        tooltip.style.top = (e.point.y + 14) + 'px';
    });

    map.on('mouseleave', 'sa3-fill', () => {
        map.getCanvas().style.cursor = '';
        if (hoveredFeatureId !== null) {
            map.setFeatureState({ source: 'sa3', id: hoveredFeatureId }, { hover: false });
        }
        hoveredFeatureId = null;
        tooltip.style.display = 'none';
    });

    map.on('click', 'sa3-fill', (e) => {
        if (!e.features.length) return;
        // Don't fire SA3 click when the user clicked a clinic marker (or
        // cluster) on top — includes any secondary layers currently active
        // (plan Phase E), not just the scoring market's own layer.
        const clinicHit = map.queryRenderedFeatures(e.point, {
            layers: getAllClinicInteractiveLayerIds()
        });
        if (clinicHit.length > 0) return;
        selectSA3(e.features[0].properties.SA3Code);
    });

    // Datasets-as-layers (plan Phase B): clicking a cluster zooms in until it
    // splits, rather than selecting a clinic (clusters have no single clinic
    // to select).
    map.on('mouseenter', 'clinics-clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'clinics-clusters', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'clinics-clusters', (e) => {
        const feature = e.features[0];
        const clusterId = feature.properties.cluster_id;
        map.getSource(`clinics-${State.markets.current}`).getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            map.easeTo({ center: feature.geometry.coordinates, zoom, duration: 500 });
        });
    });

    ['clinics-corporate', 'clinics-independent', 'clinics-public', 'clinics-unknown'].forEach(layer => {
        map.on('mouseenter', layer, () => {
            map.getCanvas().style.cursor = State.selectedClinics.length === 1 ? 'crosshair' : 'pointer';
        });
        map.on('mousemove', layer, (e) => {
            if (!e.features.length) return;
            const c = e.features[0].properties;
            const location = c.sa3_name || c.suburb || c.City || '';
            tooltip.innerHTML = `
                <div class="map-tooltip-name">${c.clinic_name || 'Clinic'}</div>
                <div class="map-tooltip-meta">${c['ownership'] || ''} · ${location}</div>
            `;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.point.x + 14) + 'px';
            tooltip.style.top = (e.point.y + 14) + 'px';
        });
        map.on('mouseleave', layer, () => {
            map.getCanvas().style.cursor = '';
            tooltip.style.display = 'none';
        });
        // F-01: Click handler to show clinic archetype popup
        map.on('click', layer, (e) => {
            if (!e.features.length) return;
            selectClinic(e.features[0].properties);
        });
    });

    // SA2 SEIFA hover interactions are wired in ensureSEIFALayer() on first use
}

// Datasets-as-layers (plan Phase E) — every clinic layer id currently on
// the map (primary + any active secondary layers), for the SA3-click
// suppression check above. Computed live rather than cached since
// secondary layers can be toggled on/off at any time.
function getAllClinicInteractiveLayerIds() {
    const ids = ['clinics-corporate', 'clinics-independent', 'clinics-public', 'clinics-unknown', 'clinics-clusters'];
    State.activeClinicLayers.forEach((layer) => {
        if (layer === State.markets.current) return;
        ids.push(`clinics-${layer}-pins`, `clinics-${layer}-clusters`);
    });
    return ids;
}

// Hover/click wiring for a secondary (non-scoring) clinic layer — clicking
// a cluster zooms in same as the primary layer; clicking a leaf pin opens
// the existing clinic-select rail (no separate secondary-layer UI invented).
function wireSecondaryClinicLayerEvents(layer) {
    const tooltip = document.getElementById('map-tooltip');
    const clusterLayerId = `clinics-${layer}-clusters`;
    const pinLayerId = `clinics-${layer}-pins`;

    map.on('mouseenter', clusterLayerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', clusterLayerId, () => { map.getCanvas().style.cursor = ''; });
    map.on('click', clusterLayerId, (e) => {
        const feature = e.features[0];
        const clusterId = feature.properties.cluster_id;
        map.getSource(`clinics-${layer}`).getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            map.easeTo({ center: feature.geometry.coordinates, zoom, duration: 500 });
        });
    });

    map.on('mouseenter', pinLayerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mousemove', pinLayerId, (e) => {
        if (!e.features.length) return;
        const c = e.features[0].properties;
        const location = c.sa3_name || c.suburb || c.City || '';
        tooltip.innerHTML = `
            <div class="map-tooltip-name">${c.clinic_name || 'Clinic'}</div>
            <div class="map-tooltip-meta">${c['ownership'] || ''} · ${location}</div>
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.point.x + 14) + 'px';
        tooltip.style.top = (e.point.y + 14) + 'px';
    });
    map.on('mouseleave', pinLayerId, () => {
        map.getCanvas().style.cursor = '';
        tooltip.style.display = 'none';
    });
    map.on('click', pinLayerId, (e) => {
        if (!e.features.length) return;
        selectClinic(e.features[0].properties);
    });
}

let lastSelectedId = null;
function selectSA3(sa3Code) {
    State.currentSA3Code = sa3Code;
    const feature = State.sa3Data.features.find(f => f.properties.SA3Code === sa3Code);
    if (!feature) return;

    if (lastSelectedId !== null) {
        map.setFeatureState({ source: 'sa3', id: lastSelectedId }, { selected: false });
    }
    const idx = State.sa3Data.features.findIndex(f => f.properties.SA3Code === sa3Code);
    if (idx >= 0) {
        map.setFeatureState({ source: 'sa3', id: idx }, { selected: true });
        lastSelectedId = idx;
    }

    renderDrawer(feature);
    const drawer = document.getElementById('detail-drawer');
    drawer.classList.add('active');

    if (isMobile()) {
        const rail = document.getElementById('map-rail');
        rail.classList.remove('open', 'snap-full', 'snap-expanded');
        rail.classList.add('snap-hidden');
        rail.style.transform = '';
        rail.style.display   = 'none';
        showBackdrop();
    }

    try {
        const bbox = turf.bbox(feature);
        const padding = isMobile()
            ? { top: 60, bottom: window.innerHeight * 0.6 + 20, left: 30, right: 30 }
            : { top: 60, bottom: 60, left: 60, right: 460 };
        map.fitBounds(bbox, { padding, duration: 700, maxZoom: 9 });
    } catch (e) {}
}

function closeDrawer() {
    document.getElementById('detail-drawer').classList.remove('active');
    if (lastSelectedId !== null) {
        map.setFeatureState({ source: 'sa3', id: lastSelectedId }, { selected: false });
        lastSelectedId = null;
    }
    State.currentSA3Code = null;
    if (isMobile()) {
        hideBackdrop();
        const rail = document.getElementById('map-rail');
        if (rail) {
            rail.classList.remove('snap-hidden');
            rail.style.transform = '';
            rail.style.display   = '';
            rail.scrollTop = 0;
        }
    }
}

// F-01: Clinic popup on click with archetype details
function selectClinic(clinic) {
    // Find full clinic object from State.clinicsData (event gives properties only)
    console.log('[selectClinic] clicked clinic:', clinic.clinic_name, 'clinic_id:', clinic.clinic_id);
    console.log('[selectClinic] State.clinicsData length:', State.clinicsData.length);
    console.log('[selectClinic] First clinic in State:', State.clinicsData[0]);

    const fullClinic = State.clinicsData.find(c => String(c.clinic_id) === String(clinic.clinic_id));
    console.log('[selectClinic] fullClinic found:', !!fullClinic);

    if (!fullClinic) {
        console.error('[selectClinic] Could not find clinic with id:', clinic.clinic_id, 'in State.clinicsData');
        return;
    }

    // Automatically load isochrone and show right rail (new behavior)
    loadAndShowIsochrone(fullClinic);
}

function renderClinicDrawer(clinic) {
    // Write into drawer-body (preserves the drawer shell so SA3 clicks still work)
    const drawerBody = document.getElementById('drawer-body');

    const confidenceChip = (conf) => {
        const colors = { 'high': '#4CAF50', 'medium': '#FFC107', 'low': '#999999' };
        return `<span style="background:${colors[conf] || '#999'};color:white;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;letter-spacing:0.03em;">${conf || '—'}</span>`;
    };

    drawerBody.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;position:relative;z-index:10;padding:12px;background:var(--surface);">
            <button class="btn-primary" style="flex:1;font-size:12px;padding:8px 16px;" id="view-catchment-btn" aria-label="View Catchment">
                View Catchment
            </button>
            <button class="btn-icon drawer-close" onclick="closeDrawer()" aria-label="Close">
                <svg viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
        </div>

        <div class="drawer-header">
            <div class="drawer-eyebrow">
                <span>Clinic</span>
            </div>
            <h2 class="drawer-title" style="font-size:17px;">${clinic.clinic_name || 'Clinic'}</h2>
            <div class="drawer-subtitle">${clinic.suburb || ''}, ${clinic.state_code || ''} ${clinic.postcode || ''}</div>
        </div>

        <div class="drawer-section">
            <div class="drawer-section-title">Address</div>
            <div style="font-size:13px;line-height:1.6;color:var(--text-secondary);">${clinic.address || '—'}</div>
        </div>

        ${clinic.website ? `
        <div class="drawer-section">
            <div class="drawer-section-title">Website</div>
            <a href="${clinic.website}" target="_blank" rel="noopener noreferrer" style="display:inline-block;color:var(--link,#0066cc);text-decoration:none;font-size:13px;word-break:break-all;padding:6px;background:var(--surface-2,#f5f5f5);border-radius:4px;border:1px solid var(--hairline);">
                ${clinic.website}
                <svg style="display:inline;width:12px;height:12px;margin-left:4px;vertical-align:-2px;" viewBox="0 0 16 16" fill="none"><path d="M13.3 3L3 13m0 0h8m-8 0V4.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </a>
        </div>
        ` : ''}

        <div class="drawer-section">
            <div class="drawer-section-title">F-01 Archetype</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:8px;">
                <div style="background:var(--surface-2,#f5f5f5);padding:10px;border-radius:6px;">
                    <div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Format</div>
                    <div style="font-size:13px;font-weight:600;margin-bottom:5px;">${clinic.clinic_format || 'Unclassified'}</div>
                    ${confidenceChip(clinic.Format_Confidence)}
                </div>
                <div style="background:var(--surface-2,#f5f5f5);padding:10px;border-radius:6px;">
                    <div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Billing</div>
                    <div style="font-size:13px;font-weight:600;margin-bottom:5px;">${clinic['Billing Type'] || 'Unclassified'}</div>
                    ${confidenceChip(clinic.Billing_Confidence)}
                </div>
                <div style="background:var(--surface-2,#f5f5f5);padding:10px;border-radius:6px;">
                    <div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Ownership</div>
                    <div style="font-size:13px;font-weight:600;margin-bottom:5px;">${clinic.ownership || 'Unclassified'}</div>
                    <span style="background:#4CAF50;color:white;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;">verified</span>
                </div>
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:8px;">high = green &nbsp;·&nbsp; medium = amber &nbsp;·&nbsp; low = grey</div>
        </div>

        <div class="drawer-section">
            <div class="drawer-section-title">GP Team</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;">
                <div style="background:var(--surface-2,#f5f5f5);padding:10px;border-radius:6px;">
                    <div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Headcount</div>
                    <div style="font-size:16px;font-weight:600;color:var(--sage-deep);">${clinic.gp_count ? clinic.gp_count : '—'}</div>
                    <div style="font-size:9px;color:var(--muted);margin-top:2px;">GPs identified</div>
                </div>
                <div style="background:var(--surface-2,#f5f5f5);padding:10px;border-radius:6px;">
                    <div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">
                        Est. Effective Capacity
                    </div>
                    ${(() => {
                        const cap = clinic.adjusted_gp_capacity;
                        const factor = clinic._gpAdjustmentFactor;
                        const level  = clinic._gpAdjustmentLevel;
                        if (cap == null) return '<div style="font-size:16px;font-weight:600;color:var(--sage);">—</div><div style="font-size:9px;color:var(--muted);margin-top:2px;">No headcount data</div>';
                        const imputed = clinic._gpImputed;
                        const valStr  = cap.toFixed(1);
                        const levelLabel = level === 'sa3' ? 'SA3 estimate' : level === 'chain' ? clinic['Corporate Chain'] + ' chain avg' : level === 'group' ? 'group avg' : 'corpus avg';
                        return `
                            <div style="font-size:16px;font-weight:600;color:var(--sage);${imputed ? 'font-style:italic;opacity:0.75' : ''}">${valStr}${imputed ? '<sup style="font-size:9px;margin-left:2px;color:var(--muted)">est</sup>' : ''}</div>
                            <div style="font-size:9px;color:var(--muted);margin-top:2px;">× ${factor?.toFixed(3)} · ${levelLabel}</div>
                        `;
                    })()}
                </div>
            </div>
            <div style="font-size:9px;color:var(--muted);margin-top:8px;font-style:italic;">
                ${clinic.ownership === 'Corporate'
                    ? (clinic.gp_count
                        ? `Headcount adjusted for multi-site GP sharing. Factor reflects avg clinics per GP in this segment.`
                        : `Headcount data unavailable — capacity imputed from chain segment median.`)
                    : 'Effective capacity estimate applies to corporate clinics only.'}
            </div>
        </div>

        <div class="drawer-section">
            <div class="drawer-section-title">Data source</div>
            <div style="font-size:11px;color:var(--text-secondary);line-height:1.7;">
                Format &amp; Billing — web scrape + keyword heuristics<br>
                Ownership — website signals + NHSD registry reconciled<br>
                GP Headcount — clinic website scrape (Doctor Names)<br>
                Effective Capacity — multi-site adjustment model (see Methodology)<br>
                <span style="color:var(--muted);">See Methodology for full classification logic</span>
            </div>
        </div>
    `;

    // Attach event listener to "View Catchment" button
    const viewCatchmentBtn = document.getElementById('view-catchment-btn');
    if (viewCatchmentBtn) {
        viewCatchmentBtn.onclick = () => {
            loadAndShowIsochroneFromDrawer(clinic.clinic_id);
        };
    }

    // Scroll drawer body to top
    drawerBody.scrollTop = 0;
    document.getElementById('detail-drawer').scrollTop = 0;
}

function clinicSearchGoto(clinicId) {
    // Find the clinic by clinic_id
    const clinic = State.clinicsData.find(c => String(c.clinic_id) === String(clinicId));
    if (!clinic) {
        console.warn('Clinic not found:', clinicId);
        return;
    }

    // Close search results and collapse the rail on mobile
    const clinicSearchResults = document.getElementById('clinic-search-results');
    if (clinicSearchResults) clinicSearchResults.style.display = 'none';
    document.getElementById('map-rail')?.classList.remove('open');

    // Render clinic drawer and open it
    renderClinicDrawer(clinic);
    document.getElementById('detail-drawer').classList.add('active');
    if (isMobile()) showBackdrop();

    // Center map on clinic
    const lng = parseFloat(clinic.longitude);
    const lat = parseFloat(clinic.latitude);
    if (!isNaN(lng) && !isNaN(lat)) {
        map.flyTo({ center: [lng, lat], zoom: 13, duration: 800 });
    }
}

// ============================================================
// Mobile sheet helpers
// ============================================================
function isMobile() { return window.innerWidth <= 900; }

function showBackdrop() {
    document.getElementById('sheet-backdrop').classList.add('active');
}
function hideBackdrop() {
    document.getElementById('sheet-backdrop').classList.remove('active');
}

function openRail() {
    document.getElementById('map-rail').classList.add('open');
    showBackdrop();
}
function closeRail() {
    document.getElementById('map-rail').classList.remove('open');
    if (!document.getElementById('detail-drawer').classList.contains('active')) {
        hideBackdrop();
    }
}

// ============================================================
// Drawer rendering
// ============================================================
function renderDrawer(feature) {
    const p = feature.properties;
    const tier = parseInt(p.Tier);
    const tierColor = TIER_COLORS[tier];
    const composite = parseFloat(p.Composite_Score) || 0;
    const demand = parseFloat(p.Demand_Score) || 0;
    const supply = parseFloat(p.Supply_Score) || 0;
    const competition = parseFloat(p.Competition_Score) || 0;
    const economics = parseFloat(p.Economics_Score) || 0;

    // Look up clinic counts — try bucket first, fall back to direct count from clinicsData
    let counts = State.sa3ClinicCounts[p.SA3Code];
    if (!counts || counts.total === 0) {
        // Fallback: count clinics directly by sa3_code match
        const targetCode = String(p.SA3Code || '').trim();
        const matching = State.clinicsData.filter(c => {
            const cc = String(c.sa3_code || c.SA3_code || c.SA3Code || '').trim().replace(/\.\d+$/, '');
            return cc === targetCode;
        });
        if (matching.length > 0) {
            counts = {
                total: matching.length,
                corporate:   matching.filter(c => c.ownership === 'Corporate').length,
                independent: matching.filter(c => c.ownership === 'Independent').length,
                publicngo:   matching.filter(c => c.ownership === 'NGO').length,
                format:    { 'Big-box':0, 'Mid-format':0, 'Small':0, 'Unclassified':0 },
                billing:   { 'Bulk':0, 'Mixed':0, 'Private':0, 'Unclassified':0 },
                ownership: { 'Corporate':0, 'Independent':0, 'NGO':0 },
            };
            matching.forEach(c => {
                const fmt = c.clinic_format || 'Unclassified';
                if (fmt in counts.format) counts.format[fmt]++;
                const bill = c['Billing Type'] || 'Unclassified';
                if (bill in counts.billing) counts.billing[bill]++;
                const own = c.ownership || '';
                if (own in counts.ownership) counts.ownership[own]++;
            });
            // Persist so other readers benefit
            State.sa3ClinicCounts[p.SA3Code] = counts;
        } else {
            counts = counts || { total: 0, corporate: 0, independent: 0, publicngo: 0 };
        }
    }
    const raw = State.sa3RawLookup[String(p.SA3Code).trim()];

    const ringR = 36;
    const ringC = 2 * Math.PI * ringR;
    const ringOffset = ringC * (1 - Math.max(0, Math.min(100, composite)) / 100);

    const headlines = {
        1: 'Top-decile market with a strong consolidation thesis.',
        2: 'High-conviction region — multiple acquisition targets available.',
        3: 'Selectively attractive; demands targeted thesis.',
        4: 'Below-median fundamentals; deprioritise unless distressed.',
        5: 'Low-priority market under base-case methodology.'
    };

    const oppCopy = buildOpportunityNote(counts, tier, p);
    const totalMix = (counts.corporate || 0) + (counts.independent || 0) + (counts.publicngo || 0);

    // Region read — real clinics in this SA3 (candidate sites + asset-quality dim)
    const regionReadTargetCode = String(p.SA3Code || '').trim();
    const sa3Clinics = State.clinicsData.filter(c => {
        const cc = String(c.sa3_code || c.SA3_code || c.SA3Code || '').trim().replace(/\.\d+$/, '');
        return cc === regionReadTargetCode;
    });
    const showRegionRead = State.markets.current === 'gp' && counts.total > 0;
    if (showRegionRead) {
        if (!State.regionReads[p.SA3Code]) {
            State.regionReads[p.SA3Code] = { phase: 'idle', thread: [] };
        }
        State.regionReads[p.SA3Code].ctx = { p, counts, tier, composite, competition, sa3Clinics };
    }

    const html = `
        <button class="btn-icon drawer-close" onclick="closeDrawer()" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        </button>

        <div class="drawer-header">
            <div class="drawer-eyebrow">
                <span>SA3 Region</span>
                <span class="drawer-code">· ${p.SA3Code}</span>
            </div>
            <h2 class="drawer-title">${p.SA3Name}</h2>
            <div class="drawer-subtitle">${p.State}</div>

            <div class="drawer-score-band">
                <div class="drawer-ring">
                    <svg viewBox="0 0 84 84">
                        <circle class="drawer-ring-track" cx="42" cy="42" r="${ringR}"/>
                        <circle class="drawer-ring-arc" cx="42" cy="42" r="${ringR}"
                                stroke="${tierColor}"
                                stroke-dasharray="${ringC}"
                                stroke-dashoffset="${ringC}"
                                data-target="${ringOffset}"/>
                    </svg>
                    <div class="drawer-ring-number">
                        <div class="drawer-ring-number-big">${Math.round(composite)}</div>
                        <div class="drawer-ring-number-suffix">/ 100</div>
                    </div>
                </div>
                <div class="drawer-score-meta">
                    <div class="drawer-tier-badge">
                        <span class="drawer-tier-dot" style="background:${tierColor}"></span>
                        ${TIER_LABELS[tier]}
                    </div>
                    <div class="drawer-score-label">Investment thesis</div>
                    <div class="drawer-score-headline">${headlines[tier]}</div>
                </div>
            </div>
        </div>

        <div class="drawer-section">
            <div class="drawer-section-title">
                Score decomposition
                <span class="drawer-section-title-note">/ 100</span>
            </div>
            <div class="score-bars">
                ${renderScoreBar('Demand', demand, 'demand')}
                ${renderScoreBar('Supply', supply, 'supply')}
                ${renderScoreBar('Competition', competition, 'competition')}
                ${renderScoreBar('Economics', economics, 'economics')}
            </div>
        </div>

        ${showRegionRead ? `<div class="drawer-section" id="region-read-${p.SA3Code}">
            ${buildRegionReadHTML(p.SA3Code)}
        </div>` : ''}

        <div class="drawer-section">
            <div class="drawer-section-title drawer-section-collapsible" onclick="toggleDrawerSection(this)">
                <span><span class="drawer-section-toggle">▶</span> Demand profile</span>
            </div>
            <div class="stat-grid drawer-section-content collapsed">
                <div class="stat-cell">
                    <div class="stat-cell-label">Population, 2025</div>
                    <div class="stat-cell-value">${fmtInt(parseNum(getProp(raw, 'D_Population_Y25', 'D_Population_2025')))}</div>
                    <div class="stat-cell-sub">Estimated residents</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-cell-label">Annual growth</div>
                    <div class="stat-cell-value">${fmtPct(getProp(raw, 'D_PopGrowth', 'D_Pop_Growth'))}</div>
                    <div class="stat-cell-sub">Population CAGR</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-cell-label">Aged 65+</div>
                    <div class="stat-cell-value">${fmtPct(getProp(raw, 'D_Pop%65', 'D_Pop_Pct_65Plus'))}</div>
                    <div class="stat-cell-sub">Share of population</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-cell-label">Median income</div>
                    <div class="stat-cell-value">${fmtMoney(getProp(raw, 'E_Median_Household_Income'))}</div>
                    <div class="stat-cell-sub">Household, AUD</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-cell-label">Remoteness</div>
                    <div class="stat-cell-value">${p.MMM_Dominant != null
                        ? 'MMM ' + p.MMM_Dominant
                        : '—'}</div>
                    <div class="stat-cell-sub">${p.MMM_Dominant != null
                        ? (MMM_LABELS[p.MMM_Dominant] || 'Unclassified')
                        : 'Not classified'}</div>
                </div>
            </div>
        </div>

        ${State.markets.current === 'gp' ? `<div class="drawer-section">
            <div class="drawer-section-title drawer-section-collapsible" onclick="toggleDrawerSection(this)">
                <span><span class="drawer-section-toggle">▶</span> Workforce</span>
            </div>
            <div class="drawer-section-content collapsed">
                <div class="stat-grid">
                    ${(() => {
                        const mmm = String(parseInt(p.MMM_Dominant) || 1);
                        const fte = p.MMM_GPFTE_per_10k != null ? parseFloat(p.MMM_GPFTE_per_10k).toFixed(1) : '—';
                        const pct55 = p.MMM_Pct_GP_55plus != null ? parseFloat(p.MMM_Pct_GP_55plus).toFixed(1) + '%' : '—';
                        const wfRisk = p.Workforce_Risk_Score != null ? p.Workforce_Risk_Score : '—';
                        const dpaBonded = p.DPA_Bonded;
                        const dpaGpImg = p.DPA_GP_IMG;
                        let dpaLabel = '—';
                        let dpaSub = 'Bonded · GP/IMG flags';
                        if (dpaBonded && dpaGpImg) dpaLabel = '●● Both';
                        else if (dpaBonded) dpaLabel = '● Bonded';
                        else if (dpaGpImg) dpaLabel = '● GP/IMG';
                        return `
                            <div class="stat-cell">
                                <div class="stat-cell-label">GP FTE per 10,000</div>
                                <div class="stat-cell-value">${fte}</div>
                                <div class="stat-cell-sub">MMM ${mmm} benchmark · HWD 2025</div>
                            </div>
                            <div class="stat-cell">
                                <div class="stat-cell-label">% GP aged ≥55</div>
                                <div class="stat-cell-value">${pct55}</div>
                                <div class="stat-cell-sub">MMM ${mmm} benchmark · HWD 2025</div>
                            </div>
                            <div class="stat-cell">
                                <div class="stat-cell-label">DPA status</div>
                                <div class="stat-cell-value" style="font-size:13px">${dpaLabel}</div>
                                <div class="stat-cell-sub">${dpaSub}</div>
                            </div>
                            <div class="stat-cell">
                                <div class="stat-cell-label">Workforce risk</div>
                                <div class="stat-cell-value">${wfRisk} <span style="font-size:12px;color:var(--muted)">/ 100</span></div>
                                <div class="stat-cell-sub">Composite — 40 / 30 / 30</div>
                            </div>
                        `;
                    })()}
                </div>
                <div style="margin-top:8px;font-size:10px;color:var(--muted);line-height:1.5">
                    Supply density and age cohort are HWD national benchmarks for the SA3's dominant MMM class.
                    DPA flags come from spatial intersection with the 2020 DoctorConnect catchment shapefiles.
                </div>
            </div>
        </div>` : ''}

        ${(State.markets.current === 'gp' && p.NRA_Fees_Per_Service != null && p.NRA_Fees_Per_Service !== '') ? `
        <div class="drawer-section">
            <div class="drawer-section-title drawer-section-collapsible" onclick="toggleDrawerSection(this)">
                <span><span class="drawer-section-toggle">▶</span> GP Billings</span>
                <span class="drawer-section-title-note">Rolling 4Q to Dec 2025</span>
            </div>
            <div class="stat-grid drawer-section-content collapsed">
                <div class="stat-cell">
                    <div class="stat-cell-label">Avg fees per service</div>
                    <div class="stat-cell-value">${fmtMoney(p.NRA_Fees_Per_Service)}</div>
                    <div class="stat-cell-sub">Fee Charged ÷ Services</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-cell-label">Total fees</div>
                    <div class="stat-cell-value">${fmtMoney(p.NRA_Total_Fees)}</div>
                    <div class="stat-cell-sub">Gross fees charged in SA3</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-cell-label">Bulk billing rate</div>
                    <div class="stat-cell-value">${fmtPct(p.NRA_BB_Rate, 1)}</div>
                    <div class="stat-cell-sub">BB services ÷ total services</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-cell-label">UCC present</div>
                    <div class="stat-cell-value" style="font-size:13px">${p.UCC_Present ? '✓ Yes' : '✗ No'}</div>
                    <div class="stat-cell-sub">Medicare Urgent Care Clinic</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-cell-label">Fee 3Y CAGR</div>
                    <div class="stat-cell-value">${p.NRA_Fee_Charged_CAGR != null ? fmtPct(p.NRA_Fee_Charged_CAGR, 1) : '—'}</div>
                    <div class="stat-cell-sub">Dec 2025 vs Dec 2022</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-cell-label">BB% 3Y CAGR</div>
                    <div class="stat-cell-value">${p.NRA_BB_Rate_CAGR != null ? fmtPct(p.NRA_BB_Rate_CAGR, 1) : '—'}</div>
                    <div class="stat-cell-sub">Bulk billing trend</div>
                </div>
            </div>
        </div>
        ` : ''}

        <div class="drawer-section">
            <div class="drawer-section-title drawer-section-collapsible" onclick="toggleDrawerSection(this)">
                <span><span class="drawer-section-toggle">▶</span> Clinic footprint</span>
                <span class="drawer-section-title-note">${counts.total} sites</span>
            </div>
            <div class="drawer-section-content collapsed">
                <div class="stat-grid">
                    <div class="stat-cell">
                        <div class="stat-cell-label">Total clinics</div>
                        <div class="stat-cell-value">${counts.total}</div>
                        <div class="stat-cell-sub">${State.markets.current === 'gp' ? 'All ownership types' : (State.markets.config?.market_name || 'This market')}</div>
                    </div>
                    <div class="stat-cell">
                        <div class="stat-cell-label">Per 10,000 pop.</div>
                        <div class="stat-cell-value">${fmtNum(getProp(raw, 'S_Clinics_per_10K_residents', 'S_Clinics_per_10000'), 1)}</div>
                        <div class="stat-cell-sub">Density measure</div>
                    </div>
                </div>

                ${State.markets.current === 'gp' ? `
                <div class="mix-bar">
                    <div class="mix-bar-track">
                        ${totalMix > 0 ? `
                            <div class="mix-bar-seg" style="width:${counts.independent/totalMix*100}%;background:${OWNERSHIP_COLORS.Independent}"></div>
                            <div class="mix-bar-seg" style="width:${counts.corporate/totalMix*100}%;background:${OWNERSHIP_COLORS.Corporate}"></div>
                            <div class="mix-bar-seg" style="width:${counts.publicngo/totalMix*100}%;background:${OWNERSHIP_COLORS['NGO']}"></div>
                        ` : ''}
                    </div>
                    <div class="mix-bar-legend">
                        <div class="mix-bar-legend-item">
                            <span class="mix-bar-legend-dot" style="background:${OWNERSHIP_COLORS.Independent}"></span>
                            Independent <span class="mix-bar-legend-num">${counts.independent}</span>
                        </div>
                        <div class="mix-bar-legend-item">
                            <span class="mix-bar-legend-dot" style="background:${OWNERSHIP_COLORS.Corporate}"></span>
                            Corporate <span class="mix-bar-legend-num">${counts.corporate}</span>
                        </div>
                        <div class="mix-bar-legend-item">
                            <span class="mix-bar-legend-dot" style="background:${OWNERSHIP_COLORS['NGO']}"></span>
                            Public/NGO <span class="mix-bar-legend-num">${counts.publicngo}</span>
                        </div>
                    </div>
                </div>
                <div class="opportunity-note">
                    <div class="opportunity-note-label">Opportunity · directional</div>
                    <div class="opportunity-note-body">${oppCopy}</div>
                </div>
                <div class="caveat">
                    <svg class="caveat-icon" viewBox="0 0 14 14" fill="none">
                        <path d="M7 1L13 12H1L7 1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                        <path d="M7 5v3M7 10v0.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    </svg>
                    <div class="caveat-body">
                        <strong>Independent count is a directional upper bound.</strong> Ownership is Foundry's internal classification — clinics without a recognisable corporate brand default to 'Independent'. Many are likely corporate-owned via unbranded vehicles, particularly in regional markets and post-acquisition portfolios. Manual verification required before deployment. See Methodology.
                    </div>
                </div>` : ''}
            </div>
        </div>

        ${(() => {
            const ac = State.sa3ClinicCounts[p.SA3Code] || {};
            const fmtData  = ac.format   || {};
            const billData = ac.billing  || {};
            const ownData  = ac.ownership || {};
            const fmtTotal  = (fmtData['Big-box']||0) + (fmtData['Mid-format']||0) + (fmtData['Small']||0) + (fmtData['Unclassified']||0);
            const billTotal = (billData['Bulk']||0) + (billData['Mixed']||0) + (billData['Private']||0) + (billData['Unclassified']||0);
            const ownTotal  = (ownData['Corporate']||0) + (ownData['Independent']||0) + (ownData['NGO']||0);

            const mixBar = (segs) => `
                <div class="mix-bar-track archetype-bar-track">
                    ${segs.map(([pct, color, label, n]) => pct > 0
                        ? `<div class="mix-bar-seg" style="width:${pct}%;background:${color}" title="${label}: ${n}"></div>`
                        : '').join('')}
                    ${segs.every(([pct]) => pct === 0)
                        ? '<div style="width:100%;background:var(--hairline);border-radius:2px"></div>' : ''}
                </div>`;

            const legend = (items) => `
                <div class="archetype-dim-legend">
                    ${items.map(([color, label, n]) =>
                        `<span><span class="mix-bar-legend-dot" style="background:${color}"></span>${label} <strong>${n}</strong></span>`
                    ).join('')}
                </div>`;

            return `
            <div class="drawer-section">
                <div class="drawer-section-title drawer-section-collapsible" onclick="toggleDrawerSection(this)">
                    <span><span class="drawer-section-toggle">▶</span> Archetype mix</span>
                </div>

                <div class="drawer-section-content collapsed">
                    <div class="archetype-row">
                        <div class="archetype-dim-label">Format</div>
                        ${mixBar(fmtTotal > 0 ? [
                            [fmtData['Big-box']/fmtTotal*100,   'var(--sage-deep)',  'Big-box',    fmtData['Big-box']||0],
                            [fmtData['Mid-format']/fmtTotal*100,'var(--sage)',       'Mid-format', fmtData['Mid-format']||0],
                            [fmtData['Small']/fmtTotal*100,     'var(--sage-mid)',   'Small',      fmtData['Small']||0],
                            [fmtData['Unclassified']/fmtTotal*100,'#ddd',            'Unclassified', fmtData['Unclassified']||0],
                        ] : [[0,'','',0]])}
                        ${legend([
                            ['var(--sage-deep)',  'Big-box',    fmtData['Big-box']||0],
                            ['var(--sage)',       'Mid',        fmtData['Mid-format']||0],
                            ['var(--sage-mid)',   'Small',      fmtData['Small']||0],
                            ['#ddd',              'Unclass.',   fmtData['Unclassified']||0],
                        ])}
                    </div>

                    <div class="archetype-row">
                        <div class="archetype-dim-label">Billing</div>
                        ${mixBar(billTotal > 0 ? [
                            [billData['Bulk']/billTotal*100,    'var(--sage-light)', 'Bulk',    billData['Bulk']||0],
                            [billData['Mixed']/billTotal*100,   'var(--tier-4)',     'Mixed',   billData['Mixed']||0],
                            [billData['Private']/billTotal*100, 'var(--tier-5)',     'Private', billData['Private']||0],
                            [billData['Unclassified']/billTotal*100, '#ddd',         'Unclassified', billData['Unclassified']||0],
                        ] : [[0,'','',0]])}
                        ${legend([
                            ['var(--sage-light)', 'Bulk',    billData['Bulk']||0],
                            ['var(--tier-4)',     'Mixed',   billData['Mixed']||0],
                            ['var(--tier-5)',     'Private', billData['Private']||0],
                            ['#ddd',              'Unclass.', billData['Unclassified']||0],
                        ])}
                    </div>

                    <div class="archetype-row">
                        <div class="archetype-dim-label">Ownership</div>
                        ${mixBar(ownTotal > 0 ? [
                            [ownData['Independent']/ownTotal*100, 'var(--own-independent)', 'Independent', ownData['Independent']||0],
                            [ownData['Corporate']/ownTotal*100,   'var(--own-corporate)',   'Corporate',   ownData['Corporate']||0],
                            [ownData['NGO']/ownTotal*100, '#888',                 'Public/NGO',   ownData['NGO']||0],
                        ] : [[0,'','',0]])}
                        ${legend([
                            ['var(--own-independent)', 'Indep.',     ownData['Independent']||0],
                            ['var(--own-corporate)',   'Corp.',      ownData['Corporate']||0],
                            ['#888',                   'Public/NGO', ownData['NGO']||0],
                        ])}
                    </div>

                    <div style="margin-top:6px;font-size:10px;color:var(--muted)">
                        Grey = Unclassified. Billing unclassified sites use SA3-level bulk billing % as fallback.
                    </div>
                </div>
            </div>`;
        })()}
    `;

    document.getElementById('drawer-body').innerHTML = html;

    requestAnimationFrame(() => {
        const arc = document.querySelector('.drawer-ring-arc');
        if (arc) arc.style.strokeDashoffset = arc.dataset.target;
        document.querySelectorAll('.score-bar-fill').forEach(el => {
            el.style.width = el.dataset.target + '%';
        });
    });
}

function renderScoreBar(label, value, key) {
    return `
        <div class="score-bar">
            <div class="score-bar-label">
                <div class="score-bar-name">${label}</div>
                <div class="score-bar-weight">${State.weights[key].toFixed(0)}% weight</div>
            </div>
            <div class="score-bar-track">
                <div class="score-bar-fill" data-target="${value}" style="width: 0"></div>
            </div>
            <div class="score-bar-num">${Math.round(value)}</div>
        </div>
    `;
}

function buildOpportunityNote(counts, tier, props) {
    const indep = counts.independent || 0;
    const total = counts.total || 0;
    const indepPct = total > 0 ? Math.round(indep / total * 100) : 0;

    if (tier <= 2 && indep >= 8) {
        return `<strong>${indep} independent practices</strong> (${indepPct}% of the local market) with fragmented ownership. Strong fragmentation supports a roll-up thesis.`;
    }
    if (tier <= 2 && indep >= 3) {
        return `<strong>${indep} independent practices</strong> available as acquisition targets. Pair with selective greenfield to reach scale.`;
    }
    if (tier === 3) {
        return `${indep} independent targets within reach. Diligence required to validate underlying demand momentum.`;
    }
    if (tier >= 4 && indep < 3) {
        return `Limited consolidation runway — ${indep} independent practices. Deprioritise under base-case allocation.`;
    }
    return `${indep} independent practices in market. Score profile suggests caution.`;
}

// ============================================================
// Region read — SA3-level heuristic "AI read" (same pattern/rationale
// as computeAcquisitionRead, scored at region level instead of clinic
// level). See plan Phase 5. All numbers below come from data already
// computed in renderDrawer() — no new queries, no fabricated figures.
// ============================================================
function computeRegionRead(p, counts, tier, composite, competition, sa3Clinics) {
    const dim = (name, rating, why, field) => ({ name, rating, ...RD_RATING_STYLE[rating], why, field });
    const total = counts.total || 0;

    // Deliverability — share of independently-owned (acquirable) sites
    let deliverability;
    if (total === 0) {
        deliverability = dim('Deliverability', 'Unrated', 'No clinics on file for this region.', 'total=0');
    } else {
        const indepPct = (counts.independent || 0) / total;
        const pctLabel = Math.round(indepPct * 100);
        if (indepPct >= 0.5) {
            deliverability = dim('Deliverability', 'High', `${counts.independent} of ${total} tracked clinics (${pctLabel}%) are independently owned — acquirable without a corporate carve-out.`, `own_independent=${counts.independent}/${total}`);
        } else if (indepPct >= 0.25) {
            deliverability = dim('Deliverability', 'Med', `${counts.independent} of ${total} tracked clinics (${pctLabel}%) are independent; the rest sit with corporate groups.`, `own_independent=${counts.independent}/${total}`);
        } else {
            deliverability = dim('Deliverability', 'Low', `Only ${counts.independent} of ${total} tracked clinics (${pctLabel}%) are independent — the obvious roll-up may already be run by someone else.`, `own_independent=${counts.independent}/${total}`);
        }
    }

    // Asset quality — share of scale sites (GP market: gp_count >= 6) among classified sites
    const knownGp = (sa3Clinics || []).filter(c => c.gp_count != null && c.gp_count !== '' && !isNaN(parseFloat(c.gp_count)));
    const scaleSites = knownGp.filter(c => parseFloat(c.gp_count) >= 6);
    let assetQuality;
    if (knownGp.length === 0) {
        assetQuality = dim('Asset quality', 'Unrated', 'No clinics in this region have a recorded GP headcount.', 'gp_count_known=0');
    } else {
        const scaleRatio = scaleSites.length / knownGp.length;
        if (scaleRatio >= 0.25) {
            assetQuality = dim('Asset quality', 'High', `${scaleSites.length} of ${knownGp.length} classified sites reach 6+ GPs — a genuine anchor tail.`, `scale_sites=${scaleSites.length}/${knownGp.length}`);
        } else if (scaleRatio >= 0.1) {
            assetQuality = dim('Asset quality', 'Med', `${scaleSites.length} of ${knownGp.length} classified sites reach 6+ GPs — a thin but present tail.`, `scale_sites=${scaleSites.length}/${knownGp.length}`);
        } else {
            assetQuality = dim('Asset quality', 'Low', `Only ${scaleSites.length} of ${knownGp.length} classified sites reach 6+ GPs — the tail is too thin to anchor a platform.`, `scale_sites=${scaleSites.length}/${knownGp.length}`);
        }
    }

    // Platform potential — regional composite/tier
    let platformPotential;
    if (tier <= 2) {
        platformPotential = dim('Platform potential', 'High', `${TIER_LABELS[tier]}, composite ${Math.round(composite)} — the regional fundamentals support a build.`, `composite=${Math.round(composite)}`);
    } else if (tier === 3) {
        platformPotential = dim('Platform potential', 'Med', `${TIER_LABELS[tier]}, composite ${Math.round(composite)} — moderate fundamentals.`, `composite=${Math.round(composite)}`);
    } else {
        platformPotential = dim('Platform potential', 'Low', `${TIER_LABELS[tier]}, composite ${Math.round(composite)} — below the bar this platform underwrites against.`, `composite=${Math.round(composite)}`);
    }

    // Strategic fit — the app's own competition-dimension score (0-100; higher = less saturated / more favourable)
    let strategicFit;
    const compRounded = Math.round(competition);
    if (compRounded >= 60) {
        strategicFit = dim('Strategic fit', 'High', `Competition scores ${compRounded}/100 — open field relative to Foundry's own methodology.`, `competition_score=${compRounded}`);
    } else if (compRounded >= 40) {
        strategicFit = dim('Strategic fit', 'Med', `Competition scores ${compRounded}/100 — workable but not wide open.`, `competition_score=${compRounded}`);
    } else {
        strategicFit = dim('Strategic fit', 'Low', `Competition scores ${compRounded}/100 — the region is already well served.`, `competition_score=${compRounded}`);
    }

    const dims = [deliverability, assetQuality, platformPotential, strategicFit];
    const ratings = dims.map(d => d.rating);
    const highCount = ratings.filter(r => r === 'High').length;
    const lowCount = ratings.filter(r => r === 'Low').length;
    const unratedCount = ratings.filter(r => r === 'Unrated').length;

    // A single Unrated dimension withholds a full "Build case" — same rationale
    // as the clinic-level read: don't claim confidence in a dimension that's
    // genuinely unknown, not just unfavourable.
    let verdict, verdictDot;
    if (unratedCount >= 2) {
        verdict = 'Provisional · limited data'; verdictDot = '#BFBFBF';
    } else if (lowCount >= 3) {
        verdict = 'Deprioritise'; verdictDot = '#C00000';
    } else if (unratedCount === 1) {
        verdict = 'No platform case · bolt-ons only'; verdictDot = '#E0A800';
    } else if (platformPotential.rating !== 'Low' && strategicFit.rating !== 'Low' && highCount >= 2) {
        verdict = 'Build case'; verdictDot = '#6E9277';
    } else {
        verdict = 'No platform case · bolt-ons only'; verdictDot = '#E0A800';
    }
    const verdictStyle = {
        'Build case': { bg: '#E8EFE9', fg: '#2F4636' },
        'No platform case · bolt-ons only': { bg: '#FFF2CC', fg: '#8A6500' },
        'Deprioritise': { bg: '#FCE4E4', fg: '#A81111' },
        'Provisional · limited data': { bg: '#F1F1EE', fg: '#5A5A55' }
    }[verdict];

    const narrative = [
        { tone: deliverability.rating === 'Low' ? 'warn' : 'normal', strong: 'Ownership & acquirability.', text: deliverability.why },
        { tone: assetQuality.rating === 'Low' ? 'warn' : 'normal', strong: 'Anchor scale.', text: assetQuality.why },
        { tone: (platformPotential.rating === 'Low' || strategicFit.rating === 'Low') ? 'warn' : 'normal', strong: 'Regional fundamentals.', text: `${platformPotential.why} ${strategicFit.why}` }
    ];
    const recText = {
        'Build case': `Build here. Sequence outreach starting with the largest classified sites (see candidates below).`,
        'No platform case · bolt-ons only': 'Bolt-ons only. Hold this region as feeder supply for a stronger adjacent SA3 rather than a standalone build.',
        'Deprioritise': 'Deprioritise. Multiple dimensions are unfavourable under base-case allocation.',
        'Provisional · limited data': 'Enrich before screening. Too little classified data to size a platform case here.'
    }[verdict];
    narrative.push({ tone: verdict === 'Build case' ? 'good' : (verdict === 'Provisional · limited data' ? 'normal' : 'warn'), strong: 'Recommendation.', text: recText });

    // Candidate sites — real clinics in this SA3, ranked by GP headcount (no fabricated
    // ownership-group linkage; that relationship isn't tracked in this dataset)
    const candidateSites = (sa3Clinics || [])
        .slice()
        .sort((a, b) => (parseFloat(b.gp_count) || -1) - (parseFloat(a.gp_count) || -1))
        .slice(0, 3)
        .map(c => {
            const gp = c.gp_count != null && c.gp_count !== '' ? parseFloat(c.gp_count) : null;
            const tag = gp == null ? { label: 'ENRICH', bg: '#F1F1EE', fg: '#5A5A55' }
                : gp >= 8 ? { label: 'ANCHOR', bg: '#C5E0B3', fg: '#2F4636' }
                : gp >= 4 ? { label: 'BOLT-ON', bg: '#FFF2CC', fg: '#8A6500' }
                : { label: 'SMALL', bg: '#F1F1EE', fg: '#5A5A55' };
            return {
                name: c.clinic_name || c.name || 'Unnamed clinic',
                meta: `${gp != null ? gp + ' GPs' : 'GP count unknown'} · ${c.ownership || 'Unclassified owner'}`,
                tag: tag.label, tagBg: tag.bg, tagFg: tag.fg
            };
        });

    const chips = [
        {
            label: 'What would flip this to a build case?',
            answer: `Platform potential and Strategic fit both need to clear "Med" — that means composite above ~60 (currently ${Math.round(composite)}) and a competition score above ~40 (currently ${compRounded}). On the region's current trajectory neither is guaranteed to move without new supply data or a competitor exit.`
        },
        {
            label: 'How concentrated is ownership here?',
            answer: `${counts.corporate || 0} of ${total} tracked clinics are corporate-owned, ${counts.independent || 0} independent, ${counts.publicngo || 0} public/NGO. See the Archetype mix section below for the full format/billing/ownership breakdown.`
        }
    ];

    return { dims, verdict, verdictBg: verdictStyle.bg, verdictFg: verdictStyle.fg, verdictDot, narrative, candidateSites, chips };
}

function buildRegionReadHTML(sa3Code) {
    const st = State.regionReads[sa3Code];
    if (!st || !st.ctx) return '';
    const idAttr = escJsAttr(sa3Code);

    const headActions = (st.phase === 'result')
        ? `<button class="rd-link-btn" onclick="regionReadGenerate('${idAttr}')">Regenerate</button>`
        : '';

    let body = '';
    if (!st.phase || st.phase === 'idle') {
        body = `
            <div style="font-size:12px;color:var(--muted);line-height:1.45;margin-bottom:12px">Ask whether this region warrants a platform build — and which of its ${st.ctx.counts.total || 0} clinics carry the case. Same four dimensions, scored at SA3 level.</div>
            <button class="rd-generate-btn" onclick="regionReadGenerate('${idAttr}')">Generate read</button>
        `;
    } else if (st.phase === 'loading') {
        body = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span class="rd-blink-dot"></span><span style="font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--sage-deep)">Reading region and ${st.ctx.counts.total || 0} clinic records…</span></div>
            <div class="rd-shim" style="height:22px;width:56%;margin-bottom:12px"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
                <div class="rd-shim" style="height:56px"></div><div class="rd-shim" style="height:56px"></div>
                <div class="rd-shim" style="height:56px"></div><div class="rd-shim" style="height:56px"></div>
            </div>
            <div class="rd-shim" style="height:10px;margin-bottom:6px"></div>
            <div class="rd-shim" style="height:10px;width:80%"></div>
        `;
    } else if (st.phase === 'result' && st.result) {
        const read = st.result;
        body = `
            <div class="rd-fadein">
                <div class="rd-verdict-badge" style="background:${read.verdictBg};color:${read.verdictFg}"><span class="rd-verdict-dot" style="background:${read.verdictDot}"></span>${read.verdict}</div>
                <div class="rd-dims-grid">
                    ${read.dims.map(d => `
                        <div class="rd-dim-card">
                            <div class="rd-dim-card-head">
                                <span class="rd-dim-name">${d.name}</span>
                                <span class="rd-dim-rating" style="background:${d.bg};color:${d.fg}">${d.rating}</span>
                            </div>
                            <div class="rd-dim-why">${d.why}</div>
                            <div class="rd-dim-field">${d.field}</div>
                        </div>
                    `).join('')}
                </div>
                <div class="rd-narrative">
                    ${read.narrative.map(n => `
                        <div class="rd-narrative-row">
                            <span class="rd-narrative-dot ${n.tone === 'warn' ? 'warn' : (n.tone === 'good' ? 'good' : '')}"></span>
                            <div class="rd-narrative-text"><strong>${n.strong}</strong> ${n.text}</div>
                        </div>
                    `).join('')}
                </div>
                ${read.candidateSites.length ? `
                <div style="border:1px solid var(--hairline);border-radius:2px;background:#fff;margin-bottom:12px">
                    <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid var(--surface-2, #E6E6E1)">
                        <span style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Candidate sites</span>
                        <span style="margin-left:auto;font-family:var(--mono);font-size:8.5px;color:var(--muted)">${read.candidateSites.length} of ${st.ctx.counts.total || 0}, by GP headcount</span>
                    </div>
                    ${read.candidateSites.map(s => `
                        <div class="rr-site-row">
                            <div style="min-width:0">
                                <div class="rr-site-name">${s.name}</div>
                                <div class="rr-site-meta">${s.meta}</div>
                            </div>
                            <span class="rr-site-tag" style="background:${s.tagBg};color:${s.tagFg}">${s.tag}</span>
                        </div>
                    `).join('')}
                    <div style="padding:8px 11px;font-size:10px;color:var(--muted);line-height:1.4">Ranked by GP headcount only — ownership-group relationships between sites are not tracked in this dataset.</div>
                </div>` : ''}
                <div class="rd-stamp">
                    <span>${fmtStamp(st.generatedAt)}</span><span>·</span><span>foundry-read v1</span><span>·</span><span>heuristic, not model-generated</span>
                </div>
                <div>
                    <div class="rd-chips">
                        ${read.chips.map((c, i) => `<button class="rd-chip" onclick="regionReadAskChip('${idAttr}', ${i})">${c.label}</button>`).join('')}
                    </div>
                    ${st.thread.map(t => `
                        <div class="rd-thread-item rd-fadein">
                            <div class="rd-thread-q">${t.q}</div>
                            <div class="rd-thread-a">${t.pending ? '<span class="rd-blink-dot"></span> Thinking…' : t.a}</div>
                            ${t.live && !t.pending ? '<div class="rd-live-tag">Model-generated — verify independently</div>' : ''}
                        </div>
                    `).join('')}
                    <div class="rd-followup-row">
                        <input class="rd-followup-input" id="region-read-draft-${idAttr}" placeholder="Ask a follow-up about this region…" onkeydown="if(event.key==='Enter') regionReadAskFreeform('${idAttr}')" />
                        <button class="rd-followup-send" onclick="regionReadAskFreeform('${idAttr}')">↩</button>
                    </div>
                    <div class="rd-followup-note">Scored dimensions above are computed, not model-generated. Suggested questions reuse that computation instantly; free-form questions call a live model scoped to this SA3 only.</div>
                </div>
            </div>
        `;
    }

    return `
        <div class="rd-read-head">
            <div class="rd-read-head-left">
                <span class="drawer-section-title" style="border:none;padding:0;margin:0">Region read</span>
            </div>
            ${headActions}
        </div>
        ${body}
    `;
}

function renderRegionReadSection(sa3Code) {
    const el = document.getElementById('region-read-' + sa3Code);
    if (el) el.innerHTML = buildRegionReadHTML(sa3Code);
}

function regionReadGenerate(sa3Code) {
    const st = State.regionReads[sa3Code];
    if (!st || !st.ctx) return;
    clearTimeout(st._timer);
    st.phase = 'loading';
    st.thread = [];
    renderRegionReadSection(sa3Code);
    st._timer = setTimeout(() => {
        const ctx = st.ctx;
        st.result = computeRegionRead(ctx.p, ctx.counts, ctx.tier, ctx.composite, ctx.competition, ctx.sa3Clinics);
        st.phase = 'result';
        st.generatedAt = new Date();
        renderRegionReadSection(sa3Code);
    }, 1600);
}

function regionReadAskChip(sa3Code, idx) {
    const st = State.regionReads[sa3Code];
    if (!st || !st.result) return;
    const c = st.result.chips[idx];
    if (!c) return;
    st.thread.push({ q: c.label, a: c.answer });
    renderRegionReadSection(sa3Code);
}

async function regionReadAskFreeform(sa3Code) {
    const st = State.regionReads[sa3Code];
    if (!st || !st.result) return;
    const input = document.getElementById('region-read-draft-' + sa3Code);
    if (!input) return;
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    const entry = { q, a: '', live: false, pending: true };
    st.thread.push(entry);
    renderRegionReadSection(sa3Code);
    const result = await fetchLiveAnswer('region', q, st.result);
    entry.a = result.text;
    entry.live = result.ok;
    entry.pending = false;
    renderRegionReadSection(sa3Code);
}

function renderDrawerEmpty() {
    document.getElementById('drawer-body').innerHTML = `
        <div class="drawer-empty">
            <div class="drawer-empty-art">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M10 2C6.7 2 4 4.7 4 8c0 4.4 6 10 6 10s6-5.6 6-10c0-3.3-2.7-6-6-6z" stroke="currentColor" stroke-width="1.4"/>
                    <circle cx="10" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/>
                </svg>
            </div>
            <div class="drawer-empty-title">Select a region</div>
            <div class="drawer-empty-body">Click any SA3 on the map to see its composite score, demand profile, clinic footprint, and consolidation opportunity.</div>
        </div>
    `;
}

/**
 * F-02: Render target overview panel when clinic chains are selected
 */
function renderTargetPanel() {
    const selectedChains = State.clinicChainFilter || [];
    if (selectedChains.length === 0) return '';

    const summary = State.targetMetaSummary || {};

    // Calculate combined stats
    let totalClinics = 0;
    let totalRegions = new Set();
    let tier1Total = 0;
    const selectedSummaries = selectedChains.map(chain => summary[chain]).filter(Boolean);

    selectedSummaries.forEach(s => {
        totalClinics += s.totalClinics;
        tier1Total += s.tier1Count;
    });

    // Compute average composite across selected targets
    let compositeSum = 0;
    selectedSummaries.forEach(s => {
        compositeSum += parseFloat(s.avgComposite) * s.regionsPresent;
    });
    let totalRegionsCount = selectedSummaries.reduce((sum, s) => sum + s.regionsPresent, 0);
    const avgComposite = totalRegionsCount > 0 ? (compositeSum / totalRegionsCount).toFixed(1) : 0;

    // Compute tier 1 percentage
    const tier1Pct = totalClinics > 0 ? ((tier1Total / totalClinics) * 100).toFixed(1) : 0;

    let html = `
        <div class="drawer-section target-panel">
            <div class="drawer-section-title drawer-section-collapsible" onclick="toggleDrawerSection(this)">
                <span class="drawer-section-toggle">▼</span>
                Target Overview
            </div>
            <div class="drawer-section-content">
                <div class="target-summary-row">
                    Targets: <strong>${selectedChains.length}</strong> ·
                    Combined: <strong>${totalClinics.toLocaleString('en-AU')}</strong> clinics ·
                    Avg composite: <strong>${avgComposite}</strong> ·
                    Tier 1: <strong>${tier1Pct}%</strong>
                </div>

            <div class="target-cards-container">
    `;

    // Render per-target cards (collapsed by default)
    selectedChains.forEach(chainName => {
        const s = summary[chainName];
        if (!s) return;

        const paletteEntry = CLINIC_CHAIN_PALETTE[chainName] || {};
        const color = paletteEntry.color || '#6E9277';
        const pattern = paletteEntry.pattern || 'solid';
        const slug = paletteEntry.slug || 'unknown';

        const fmt = s.formatMix || {};
        const fmtTotal = (fmt['Big-box'] || 0) + (fmt['Mid-format'] || 0) + (fmt['Small'] || 0) + (fmt['Unclassified'] || 0);
        const fmtBigboxPct = fmtTotal > 0 ? (((fmt['Big-box'] || 0) / fmtTotal) * 100).toFixed(0) : 0;
        const fmtMidPct = fmtTotal > 0 ? (((fmt['Mid-format'] || 0) / fmtTotal) * 100).toFixed(0) : 0;
        const fmtSmallPct = fmtTotal > 0 ? (((fmt['Small'] || 0) / fmtTotal) * 100).toFixed(0) : 0;

        const bill = s.billingMix || {};
        const billTotal = (bill['Bulk'] || 0) + (bill['Mixed'] || 0) + (bill['Private'] || 0) + (bill['Unclassified'] || 0);
        const billBulkPct = billTotal > 0 ? (((bill['Bulk'] || 0) / billTotal) * 100).toFixed(0) : 0;
        const billMixedPct = billTotal > 0 ? (((bill['Mixed'] || 0) / billTotal) * 100).toFixed(0) : 0;
        const billPrivatePct = billTotal > 0 ? (((bill['Private'] || 0) / billTotal) * 100).toFixed(0) : 0;

        const tier1Pct = s.totalClinics > 0 ? ((s.tier1Count / s.totalClinics) * 100).toFixed(1) : 0;

        html += `
            <div class="target-card">
                <div class="target-card-header" onclick="toggleTargetCard('target-card-${slug}')">
                    <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                        <div class="target-swatch target-${slug}" style="background-color: ${color};"></div>
                        <div>
                            <div style="font-weight: 600;">${paletteEntry.name}</div>
                            <div style="font-size: 11px; color: var(--muted);">${s.totalClinics} clinics · Composite ${s.avgComposite}</div>
                        </div>
                    </div>
                    <div style="font-size: 10px; color: var(--muted);">Regions: ${s.regionsPresent}</div>
                </div>
                <div class="target-card-body hidden" id="target-card-${slug}">
                    <div style="margin-bottom: 12px;">
                        <div class="archetype-dim-label">Format Mix</div>
                        <div class="mix-bar" style="display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: #eee;">
                            <div style="flex: ${fmtBigboxPct || 0.1}; background: #465E4D;"></div>
                            <div style="flex: ${fmtMidPct || 0.1}; background: #6E9277;"></div>
                            <div style="flex: ${fmtSmallPct || 0.1}; background: #97C777;"></div>
                        </div>
                        <div class="archetype-dim-legend" style="margin-top: 6px;">
                            <span><span class="mix-bar-legend-dot" style="background: #465E4D;"></span>Big-box ${fmtBigboxPct}%</span>
                            <span><span class="mix-bar-legend-dot" style="background: #6E9277;"></span>Mid ${fmtMidPct}%</span>
                            <span><span class="mix-bar-legend-dot" style="background: #97C777;"></span>Small ${fmtSmallPct}%</span>
                        </div>
                    </div>

                    <div style="margin-bottom: 12px;">
                        <div class="archetype-dim-label">Billing Mix</div>
                        <div class="mix-bar" style="display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: #eee;">
                            <div style="flex: ${billBulkPct || 0.1}; background: #97C777;"></div>
                            <div style="flex: ${billMixedPct || 0.1}; background: #FFC000;"></div>
                            <div style="flex: ${billPrivatePct || 0.1}; background: #C00000;"></div>
                        </div>
                        <div class="archetype-dim-legend" style="margin-top: 6px;">
                            <span><span class="mix-bar-legend-dot" style="background: #97C777;"></span>Bulk ${billBulkPct}%</span>
                            <span><span class="mix-bar-legend-dot" style="background: #FFC000;"></span>Mixed ${billMixedPct}%</span>
                            <span><span class="mix-bar-legend-dot" style="background: #C00000;"></span>Private ${billPrivatePct}%</span>
                        </div>
                    </div>

                    <div style="margin-bottom: 12px; padding: 8px; background: var(--subtle-bg); border-radius: 4px;">
                        <div class="archetype-dim-label">Tier 1 Concentration</div>
                        <div style="font-size: 13px; font-weight: 600; margin-top: 4px;">${s.tier1Count} of ${s.totalClinics} (${tier1Pct}%)</div>
                        <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">clinics in Tier 1 regions</div>
                    </div>
                    <div style="border-top: 1px solid var(--hairline); padding-top: 10px; margin-top: 4px; display:none;">
                        <button class="btn btn-ghost" style="width:100%;font-size:11px;justify-content:center;gap:6px;" onclick="exportTargetDossier('${chainName}');event.stopPropagation();">
                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v7m0 0L3 5m3 3l3-3M2 10h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            Export dossier (.pptx)
                        </button>
                    </div>
                </div>
            </div>
        `;
    });

    html += `
            </div>
        </div>`;

    // Render overlap section if 2+ targets selected
    if (selectedChains.length >= 2) {
        html += `
        <div class="drawer-section target-overlap-panel">
            <div class="drawer-section-title drawer-section-collapsible" onclick="toggleDrawerSection(this)">
                <span class="drawer-section-toggle">▼</span>
                Target Overlap
            </div>
            <div class="drawer-section-content">
                <table class="target-overlap-matrix">
        `;

        // Matrix header
        html += '<tr><td></td>';
        selectedChains.forEach(chain => {
            const paletteEntry = CLINIC_CHAIN_PALETTE[chain] || {};
            html += `<td style="font-weight: 600; font-size: 9px;">${paletteEntry.name}</td>`;
        });
        html += '</tr>';

        // Matrix rows
        selectedChains.forEach((chainA, i) => {
            const paletteEntryA = CLINIC_CHAIN_PALETTE[chainA] || {};
            html += `<tr><td style="font-weight: 600; font-size: 9px;">${paletteEntryA.name}</td>`;
            selectedChains.forEach((chainB, j) => {
                if (i === j) {
                    html += `<td>—</td>`;
                } else if (i > j) {
                    html += `<td>—</td>`;
                } else {
                    const key = `${chainA}|${chainB}`;
                    const overlap = State.targetOverlapMatrix[key] || { count: 0, percentage: 0 };
                    html += `<td>${overlap.count}<br/><span style="font-size: 8px; color: var(--muted);">${overlap.percentage}%</span></td>`;
                }
            });
            html += '</tr>';
        });

        html += `</table>
            </div>
        </div>`;
    }

    return html;
}

/**
 * F-02: Show/update the Target Overview drawer
 */
function updateTargetOverviewDrawer() {
    const selectedChains = State.clinicChainFilter || [];
    const drawer = document.getElementById('target-overview-drawer');
    const body = document.getElementById('target-overview-body');

    if (selectedChains.length === 0) {
        // Hide drawer if no targets selected
        if (drawer) drawer.classList.add('hidden');
        return;
    }

    // Show drawer and render content
    if (drawer) drawer.classList.remove('hidden');
    if (body) {
        body.innerHTML = renderTargetPanel();
    }
}

function toggleTargetCard(cardId) {
    const card = document.getElementById(cardId);
    if (card) {
        card.classList.toggle('hidden');
    }
}

/**
 * Toggle drawer section content visibility (collapse/expand)
 */
function toggleDrawerSection(titleEl) {
    const toggle = titleEl.querySelector('.drawer-section-toggle');
    const section = titleEl.parentElement;
    const content = section.querySelector('.drawer-section-content');

    if (content) {
        content.classList.toggle('collapsed');
        if (toggle) {
            toggle.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
        }
    }
}

/**
 * F-02: Export target clinic data as CSV in DS-12 format
 * DS-12 columns: clinic_id, target_name, clinic_name, suburb, state, address, latitude, longitude, gp_count_est, format, billing_model, verified_date, verification_source
 */
function exportTargetCSV(targetChainName) {
    if (!targetChainName) return;

    const paletteEntry = CLINIC_CHAIN_PALETTE[targetChainName] || {};
    const slug = paletteEntry.slug || 'unknown';

    // Filter clinics to this target
    const targetClinics = State.clinicsData.filter(c =>
        (c['Corporate Chain'] || '').trim() === targetChainName
    );

    if (targetClinics.length === 0) {
        console.warn(`No clinics found for target: ${targetChainName}`);
        return;
    }

    // Build CSV content
    const headers = [
        'clinic_id',
        'target_name',
        'clinic_name',
        'suburb',
        'state',
        'address',
        'latitude',
        'longitude',
        'gp_count_est',
        'format',
        'billing_model',
        'verified_date',
        'verification_source'
    ];

    const rows = targetClinics.map(c => [
        c['OBJECTID'] || '',
        targetChainName,
        c['clinic_name'] || '',
        c['suburb'] || '',
        c['STATE'] || '',
        c['ADDRESS'] || '',
        c['latitude'] || '',
        c['longitude'] || '',
        c['gp_count'] || '',
        c['clinic_format'] || 'Unclassified',
        c['Billing Type'] || 'Unclassified',
        new Date().toISOString().split('T')[0],  // Today's date
        'comprehensive_clinic_database.csv'
    ]);

    // Escape CSV values (handle quotes and commas)
    const escapeCsv = (val) => {
        if (val === null || val === undefined) return '""';
        val = String(val).trim();
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
            return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
    };

    const csvContent = [
        headers.map(escapeCsv).join(','),
        ...rows.map(row => row.map(escapeCsv).join(','))
    ].join('\n');

    // Trigger browser download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `target_${slug}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`[Target Export] Downloaded ${targetClinics.length} clinics for ${targetChainName}`);
}

// ============================================================
// F-07: Export Target Footprint Dossier (.pptx)
// ============================================================
async function exportTargetDossier(chainName) {
    console.log('[F-07] Starting dossier export for:', chainName);
    if (typeof PptxGenJS === 'undefined') {
        alert('PptxGenJS not loaded — please refresh and try again.');
        return;
    }

    const summary = State.targetMetaSummary[chainName] || {};
    const palette = CLINIC_CHAIN_PALETTE[chainName] || {};
    const displayName = palette.name || chainName;
    const slug = palette.slug || 'unknown';
    const brandColor = (palette.color || '#6E9277').replace('#', '');

    // ── Format mix ──────────────────────────────────────────
    const fmt = summary.formatMix || {};
    const fmtTotal = (fmt['Big-box']||0)+(fmt['Mid-format']||0)+(fmt['Small']||0)+(fmt['Unclassified']||0);
    const fmtBigPct  = fmtTotal > 0 ? Math.round((fmt['Big-box']||0)/fmtTotal*100) : 0;
    const fmtMidPct  = fmtTotal > 0 ? Math.round((fmt['Mid-format']||0)/fmtTotal*100) : 0;
    const fmtSmallPct= fmtTotal > 0 ? Math.round((fmt['Small']||0)/fmtTotal*100) : 0;

    // ── Billing mix ─────────────────────────────────────────
    const bill = summary.billingMix || {};
    const billTotal = (bill['Bulk']||0)+(bill['Mixed']||0)+(bill['Private']||0)+(bill['Unclassified']||0);
    const billBulkPct  = billTotal > 0 ? Math.round((bill['Bulk']||0)/billTotal*100) : 0;
    const billMixedPct = billTotal > 0 ? Math.round((bill['Mixed']||0)/billTotal*100) : 0;
    const billPrivPct  = billTotal > 0 ? Math.round((bill['Private']||0)/billTotal*100) : 0;

    // ── Ownership mix ────────────────────────────────────────
    const own = summary.ownershipMix || {};
    const ownTotal = (own['Corporate']||0)+(own['Independent']||0)+(own['NGO']||0);
    const ownCorpPct  = ownTotal > 0 ? Math.round((own['Corporate']||0)/ownTotal*100) : 0;
    const ownIndepPct = ownTotal > 0 ? Math.round((own['Independent']||0)/ownTotal*100) : 0;

    // ── Tier breakdown ───────────────────────────────────────
    const t1  = summary.tier1Count || 0;
    const t2  = summary.tier2Count || 0;
    const regions = summary.regionsPresent || 0;
    const t3plus = Math.max(0, regions - t1 - t2);
    const t1Pct  = regions > 0 ? Math.round(t1/regions*100) : 0;
    const t12Pct = regions > 0 ? Math.round((t1+t2)/regions*100) : 0;

    // ── National avg composite ───────────────────────────────
    const nationalAvg = State.sa3Data
        ? (State.sa3Data.features.reduce((s,f)=>s+(f.properties.Composite_Score||0),0)/State.sa3Data.features.length).toFixed(1)
        : '65.2';

    // ── Footprint SA3s — top 3 / bottom 3 ───────────────────
    const footprintSA3s = Object.keys(State.sa3TargetMetrics).filter(
        sa3Code => State.sa3TargetMetrics[sa3Code][chainName]
    );
    const footprintData = footprintSA3s.map(sa3Code => {
        const f = State.sa3Data.features.find(f => f.properties.SA3Code === sa3Code);
        const p = f ? f.properties : {};
        return {
            name: p.SA3Name || sa3Code,
            state: p.State || '',
            composite: parseFloat(p.Composite_Score || 0),
            tier: p.tier || 5
        };
    }).filter(d => d.composite > 0).sort((a,b) => b.composite - a.composite);

    const top3    = footprintData.slice(0, 3);
    const bottom3 = [...footprintData].reverse().slice(0, 3);

    // ── Independent pipeline in footprint ───────────────────
    const pipeline = footprintSA3s.reduce((sum, sa3Code) => {
        const cc = State.sa3ClinicCounts[sa3Code] || {};
        return sum + (cc.independent || 0);
    }, 0);

    // ── Peer overlap ─────────────────────────────────────────
    const peers = (State.clinicChainFilter || []).filter(c => c !== chainName);

    // ── Action subtitle (auto-generated) ────────────────────
    const dominantFmt = fmtBigPct >= fmtMidPct && fmtBigPct >= fmtSmallPct ? 'big-box'
        : fmtMidPct >= fmtSmallPct ? 'mid-format' : 'small-format';
    const dominantBill = billBulkPct >= billPrivPct ? 'bulk-billing' : 'private-billing';
    const tierProfile = t1Pct >= 40 ? 'strong Tier 1–2 concentration'
        : t1Pct >= 20 ? 'moderate Tier 1–2 exposure' : 'predominantly Tier 3+ profile';
    const actionSubtitle = `${displayName}'s ${dominantFmt} ${dominantBill} footprint (${summary.totalClinics} clinics across ${regions} SA3s) shows ${tierProfile} — weighted composite ${summary.avgComposite} vs national avg ${nationalAvg}.`;

    // ── Fetch map image from Mapbox Static API ───────────────
    const MAPBOX_TOKEN = mapboxgl.accessToken;
    const targetClinics = (State.clinicsData || []).filter(
        c => (c['Corporate Chain'] || '').trim() === chainName && c.longitude && c.latitude
    );

    let mapImageData = null;
    try {
        let overlay, camera;
        if (targetClinics.length > 0) {
            const pins = targetClinics.slice(0, 35).map(c =>
                `pin-s+${brandColor}(${parseFloat(c.longitude).toFixed(4)},${parseFloat(c.latitude).toFixed(4)})`
            ).join(',');
            overlay = pins;
            camera = 'auto';
        } else {
            overlay = '';
            camera = '134,-26,3.5';
        }
        const staticUrl = overlay
            ? `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${overlay}/${camera}/600x440@2x?padding=60&access_token=${MAPBOX_TOKEN}`
            : `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${camera}/600x440@2x?access_token=${MAPBOX_TOKEN}`;
        const resp = await fetch(staticUrl);
        if (resp.ok) {
            const blob = await resp.blob();
            mapImageData = await new Promise(res => {
                const reader = new FileReader();
                reader.onloadend = () => res(reader.result);
                reader.readAsDataURL(blob);
            });
        }
    } catch(e) {
        console.warn('[F-07] Map fetch failed:', e);
    }

    // ── Build PPTX ───────────────────────────────────────────
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33" × 7.5"
    pptx.author = 'Foundry Health';
    pptx.subject = `Chain Dossier — ${displayName}`;

    const slide = pptx.addSlide();

    // Color palette
    const C_BLACK    = '000000';
    const C_DEEP     = '465E4D';
    const C_SAGE     = '6E9277';
    const C_MIDSAGE  = '97C777';
    const C_LIGHTSAGE = 'C5E0B3';
    const C_AMBER    = 'FFC000';
    const C_AMBERTEXT = '8A6500';
    const C_RED      = 'C00000';
    const C_INK      = '000000';
    const C_INK2     = '2A2A2A';
    const C_INK3     = '9A9A9A';
    const C_HAIR     = 'CACACA';
    const C_SOFT     = 'ECECEC';
    const C_BG       = 'F5F5F4';
    const C_WHITE    = 'FFFFFF';

    // ── LAYOUT STRUCTURE ────────────────────────────────────
    // LAYOUT_WIDE = 13.33" × 7.5"
    // Margins: 0.2" left/right = 12.93" content width
    // Top bar: 0.3" | Banner: 0.5" | Title: 1.1" | Dims: 0.7" | Body: 4.4" | Footer: 0.5"

    // ── TOP BAR ──────────────────────────────────────────────
    slide.addShape(pptx.ShapeType.rect, {
        x:0, y:0, w:13.33, h:0.3,
        fill:{ color:C_WHITE }, line:{ color:C_HAIR, pt:1 }
    });
    slide.addText('FOUNDRY HEALTH · GP DILIGENCE', {
        x:0.2, y:0.04, w:4, h:0.2,
        fontSize:8, fontFace:'Helvetica', bold:true, color:C_DEEP
    });
    slide.addText('COMMERCIAL-IN-CONFIDENCE · DRAFT FOR IC', {
        x:4.2, y:0.04, w:5, h:0.2,
        fontSize:7, fontFace:'Helvetica', align:'center', color:C_INK3
    });
    slide.addText('CHAIN DOSSIER', {
        x:9.2, y:0.04, w:4.13, h:0.2,
        fontSize:8, fontFace:'Helvetica', bold:true, align:'right', color:C_INK, letterSpacing:0.05
    });

    // ── RECOMMENDATION BANNER ────────────────────────────────
    slide.addShape(pptx.ShapeType.rect, {
        x:0, y:0.3, w:13.33, h:0.5,
        fill:{ color:C_DEEP }, line: null
    });
    slide.addText('XX', {
        x:0.2, y:0.34, w:2, h:0.24,
        fontSize:12, fontFace:'Helvetica', bold:true, color:C_WHITE
    });
    slide.addText('XX', {
        x:0.2, y:0.62, w:4, h:0.14,
        fontSize:9, fontFace:'Helvetica', color:C_WHITE
    });
    slide.addText(Math.round(summary.avgComposite || 0), {
        x:11.33, y:0.34, w:1.8, h:0.28,
        fontSize:24, fontFace:'Helvetica', bold:true, align:'right', color:C_WHITE
    });
    slide.addText('TARGET SCORE', {
        x:11.33, y:0.64, w:1.8, h:0.1,
        fontSize:7, fontFace:'Helvetica', bold:true, align:'right', color:C_WHITE
    });

    // ── TITLE BLOCK ──────────────────────────────────────────
    let ty = 0.85;
    slide.addText('PRIMARY HEALTHCARE · CORPORATE GP CHAIN', {
        x:0.2, y:ty, w:12.93, h:0.14,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    ty += 0.16;

    slide.addText(displayName, {
        x:0.2, y:ty, w:12.93, h:0.35,
        fontSize:32, fontFace:'Times New Roman', bold:true, color:C_BLACK
    });
    ty += 0.38;

    slide.addText(`PE-BACKED · Owned 2018 · ${summary.totalClinics || 'XX'} clinics across ${regions || 'XX'} SA3s`, {
        x:0.2, y:ty, w:12.93, h:0.14,
        fontSize:10, fontFace:'Helvetica', color:C_INK2
    });
    ty += 0.16;

    // Thesis placeholder
    slide.addShape(pptx.ShapeType.rect, {
        x:0.15, y:ty, w:0.08, h:0.12,
        fill:{ color:C_LIGHTSAGE }, line: null
    });
    slide.addText('THESIS', {
        x:0.15, y:ty, w:0.8, h:0.12,
        fontSize:7, fontFace:'Helvetica', bold:true, color:C_DEEP, align:'center', valign:'middle'
    });
    slide.addText('XX [Analyst: actionability + edge + watch-item]', {
        x:1.0, y:ty, w:11.13, h:0.3,
        fontSize:9, fontFace:'Helvetica', color:C_BLACK, valign:'top', wrap:true, lineSpacing:13
    });
    ty += 0.32;

    // ── DIMENSION TILES ──────────────────────────────────────
    const dimScores = DIMENSION_SCORES[chainName] || { deliver: 0, quality: 0, platform: 0, fit: 0 };
    const dimY = ty;
    const dims = [
        { label:'Deliverability', score: Math.round(dimScores.deliver || 0).toString(), tone:'mid' },
        { label:'Asset quality', score: Math.round(dimScores.quality || 0).toString(), tone:'mid' },
        { label:'Platform potential', score: Math.round(dimScores.platform || 0).toString(), tone:'mid' },
        { label:'Strategic fit', score: Math.round(dimScores.fit || 0).toString(), tone:'mid' }
    ];
    dims.forEach((d, i) => {
        const dx = 0.2 + (i * 3.23);
        slide.addShape(pptx.ShapeType.rect, {
            x:dx, y:dimY, w:3.13, h:0.68,
            fill:{ color:C_WHITE }, line:{ color:C_HAIR, pt:1 }
        });
        slide.addText(d.label, {
            x:dx+0.12, y:dimY+0.07, w:2.89, h:0.12,
            fontSize:8, fontFace:'Helvetica', bold:true, color:C_INK3
        });
        slide.addText(d.score, {
            x:dx+0.12, y:dimY+0.22, w:2.89, h:0.2,
            fontSize:16, fontFace:'Helvetica', bold:true, color:C_DEEP
        });
    });
    ty = dimY + 0.72;

    // ── TWO-COLUMN BODY ──────────────────────────────────────
    const colLX = 0.15, colLW = 7.2;
    const colRX = 7.5, colRW = 5.65;
    let lyLeft = ty, lyRight = ty;

    // LEFT: Why Now
    slide.addText('WHY NOW', {
        x:colLX, y:lyLeft, w:colLW, h:0.16,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    lyLeft += 0.22;

    slide.addShape(pptx.ShapeType.line, {
        x:colLX, y:lyLeft-0.02, w:colLW, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    slide.addText('XX  ·  Timing factor 1', {
        x:colLX, y:lyLeft, w:colLW, h:0.15,
        fontSize:9, fontFace:'Helvetica', color:C_INK2
    });
    lyLeft += 0.18;
    slide.addText('XX  ·  Timing factor 2', {
        x:colLX, y:lyLeft, w:colLW, h:0.15,
        fontSize:9, fontFace:'Helvetica', color:C_INK2
    });
    lyLeft += 0.18;
    slide.addText('XX  ·  Timing factor 3', {
        x:colLX, y:lyLeft, w:colLW, h:0.15,
        fontSize:9, fontFace:'Helvetica', color:C_INK2
    });
    lyLeft += 0.25;

    // LEFT: Value Creation Levers
    slide.addText('VALUE CREATION LEVERS', {
        x:colLX, y:lyLeft, w:colLW, h:0.16,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    lyLeft += 0.22;

    slide.addShape(pptx.ShapeType.line, {
        x:colLX, y:lyLeft-0.02, w:colLW, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    slide.addText('1.  XX Lever  ·  Mechanism  ·  +XX% upside  ·  Primary', {
        x:colLX, y:lyLeft, w:colLW, h:0.14,
        fontSize:8.5, fontFace:'Helvetica', color:C_INK2
    });
    lyLeft += 0.17;
    slide.addText('2.  XX Lever  ·  Mechanism  ·  +XX upside  ·  Yr 1', {
        x:colLX, y:lyLeft, w:colLW, h:0.14,
        fontSize:8.5, fontFace:'Helvetica', color:C_INK2
    });
    lyLeft += 0.17;
    slide.addText('3.  XX Lever  ·  Mechanism  ·  +XX upside  ·  Yr 1–2', {
        x:colLX, y:lyLeft, w:colLW, h:0.14,
        fontSize:8.5, fontFace:'Helvetica', color:C_INK2
    });
    lyLeft += 0.17;
    slide.addText('4.  XX Lever  ·  Mechanism  ·  +XX upside  ·  Yr 2–3', {
        x:colLX, y:lyLeft, w:colLW, h:0.14,
        fontSize:8.5, fontFace:'Helvetica', color:C_INK2
    });
    lyLeft += 0.25;

    // RIGHT: Footprint Quality
    slide.addText('FOOTPRINT QUALITY', {
        x:colRX, y:lyRight, w:colRW, h:0.16,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    lyRight += 0.22;

    slide.addShape(pptx.ShapeType.line, {
        x:colRX, y:lyRight-0.02, w:colRW, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    // Tier mix bar
    slide.addShape(pptx.ShapeType.rect, {
        x:colRX, y:lyRight, w:1.2, h:0.12,
        fill:{ color:C_DEEP }
    });
    slide.addShape(pptx.ShapeType.rect, {
        x:colRX+1.2, y:lyRight, w:1.2, h:0.12,
        fill:{ color:C_SAGE }
    });
    slide.addShape(pptx.ShapeType.rect, {
        x:colRX+2.4, y:lyRight, w:2.4, h:0.12,
        fill:{ color:C_LIGHTSAGE }
    });
    slide.addText('Tier 1–2  ·  T3  ·  T4–5 (the tail)', {
        x:colRX, y:lyRight+0.15, w:colRW, h:0.12,
        fontSize:8, fontFace:'Helvetica', color:C_INK3
    });
    lyRight += 0.35;

    slide.addText(`Composite  ${summary.avgComposite || '0'} vs national avg ${nationalAvg}`, {
        x:colRX, y:lyRight, w:colRW, h:0.14,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK2
    });
    lyRight += 0.17;
    slide.addText(`Bulk billing  ${billBulkPct}% · Mixed ${billMixedPct}% · Private ${billPrivPct}%`, {
        x:colRX, y:lyRight, w:colRW, h:0.14,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK2
    });
    lyRight += 0.17;
    const avgClinicsPerRegion = regions > 0 ? (summary.totalClinics / regions).toFixed(1) : 0;
    slide.addText(`${summary.totalClinics} clinics across ${regions} regions · ${avgClinicsPerRegion} avg clinics/region`, {
        x:colRX, y:lyRight, w:colRW, h:0.14,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK2
    });
    lyRight += 0.25;

    // RIGHT: Risk Flags
    slide.addText('RISK FLAGS', {
        x:colRX, y:lyRight, w:colRW, h:0.16,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    lyRight += 0.22;

    slide.addShape(pptx.ShapeType.line, {
        x:colRX, y:lyRight-0.02, w:colRW, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    [
        { dot:C_RED, text:'XX Risk — description' },
        { dot:C_AMBER, text:'XX Risk — description' },
        { dot:C_SAGE, text:'XX Risk — description' }
    ].forEach((r, i) => {
        slide.addShape(pptx.ShapeType.ellipse, {
            x:colRX, y:lyRight+0.03, w:0.08, h:0.08,
            fill:{ color:r.dot }, line: null
        });
        slide.addText(r.text, {
            x:colRX+0.12, y:lyRight, w:colRW-0.15, h:0.14,
            fontSize:8.5, fontFace:'Helvetica', color:C_INK2
        });
        lyRight += 0.17;
    });

    // ── FOOTER ───────────────────────────────────────────────
    slide.addShape(pptx.ShapeType.rect, {
        x:0, y:6.8, w:13.33, h:0.7,
        fill:{ color:C_BG }, line:{ color:C_HAIR, pt:1 }
    });

    slide.addText('KEY DILIGENCE QUESTIONS', {
        x:0.2, y:6.86, w:6.5, h:0.14,
        fontSize:8, fontFace:'Helvetica', bold:true, color:C_INK3
    });

    const questions = [
        'XX Question 1',
        'XX Question 2',
        'XX Question 3',
        'XX Question 4'
    ];
    let qx = 0.2, qy = 7.04;
    questions.forEach((q, i) => {
        if (i === 2) { qx = 6.8; qy = 7.04; }
        slide.addText(`${i+1}.`, {
            x:qx, y:qy, w:0.3, h:0.12,
            fontSize:8, fontFace:'Helvetica', bold:true, color:C_DEEP
        });
        slide.addText(q, {
            x:qx+0.35, y:qy, w:2.8, h:0.12,
            fontSize:8, fontFace:'Helvetica', color:C_INK2
        });
        qy += 0.13;
    });

    slide.addShape(pptx.ShapeType.line, {
        x:0.2, y:7.36, w:12.93, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    slide.addText('Sources: Foundry Health · Data vintage Mar 2025', {
        x:0.2, y:7.38, w:12.93, h:0.1,
        fontSize:7, fontFace:'Helvetica', color:C_INK3
    });

    // ── Save ─────────────────────────────────────────────────
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const cleanName = displayName.replace(/[^a-zA-Z0-9]/g, '_');
    await pptx.writeFile({ fileName:`FH_GP_Diligence_${cleanName}_${dateStr}.pptx` });
    console.log(`[F-07] Dossier exported for ${displayName}`);
}

// ============================================================
// Region Dossier Export — PPTX
// ============================================================
async function exportRegionDossier(sa3Code) {
    console.log('[F-07] Starting region dossier export for:', sa3Code);
    if (typeof PptxGenJS === 'undefined') {
        alert('PptxGenJS not loaded — please refresh and try again.');
        return;
    }

    const feature = State.sa3Data.features.find(f => f.properties.SA3Code === sa3Code);
    if (!feature) {
        alert('Region data not found.');
        return;
    }

    const p = feature.properties;
    const regionName = p.SA3Name || sa3Code;
    const state = p.State || '';
    const tier = parseInt(p.Tier) || 5;
    const demand = parseFloat(p.Demand_Score || p.Demand || 0);
    const supply = parseFloat(p.Supply_Score || p.Supply || 0);
    const competition = parseFloat(p.Competition_Score || p.Competition || 0);
    const economics = parseFloat(p.Economics_Score || p.Economics || 0);
    const composite = parseFloat(p.Composite_Score || 0);

    const clinicCounts = (State.sa3ClinicCounts || {})[sa3Code] || {};
    const independent = clinicCounts.independent || 0;
    const corporate = clinicCounts.corporate || 0;
    const total = clinicCounts.total || 0;
    const corpShare = total > 0 ? Math.round(corporate / total * 100) : 0;

    // Build PPTX
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'Foundry Health';
    pptx.subject = `Region Dossier — ${regionName}`;

    const slide = pptx.addSlide();

    // Color palette
    const C_BLACK    = '000000';
    const C_DEEP     = '465E4D';
    const C_SAGE     = '6E9277';
    const C_MIDSAGE  = '97C777';
    const C_LIGHTSAGE = 'C5E0B3';
    const C_AMBER    = 'FFC000';
    const C_AMBERTEXT = '8A6500';
    const C_RED      = 'C00000';
    const C_INK      = '000000';
    const C_INK2     = '2A2A2A';
    const C_INK3     = '9A9A9A';
    const C_HAIR     = 'CACACA';
    const C_SOFT     = 'ECECEC';
    const C_BG       = 'F5F5F4';
    const C_WHITE    = 'FFFFFF';

    // ── LAYOUT STRUCTURE ────────────────────────────────────
    // LAYOUT_WIDE = 13.33" × 7.5"
    // Margins: 0.2" left/right = 12.93" content width
    // Top bar: 0.3" | Banner: 0.5" | Title: 1.1" | Dims: 0.68" | Body: 4.42" | Footer: 0.5"

    // ── TOP BAR ──────────────────────────────────────────────
    slide.addShape(pptx.ShapeType.rect, {
        x:0, y:0, w:13.33, h:0.3,
        fill:{ color:C_WHITE }, line:{ color:C_HAIR, pt:1 }
    });
    slide.addText('FOUNDRY HEALTH · GP DILIGENCE', {
        x:0.2, y:0.04, w:4, h:0.2,
        fontSize:8, fontFace:'Helvetica', bold:true, color:C_DEEP
    });
    slide.addText('COMMERCIAL-IN-CONFIDENCE · DRAFT FOR IC', {
        x:4.2, y:0.04, w:5, h:0.2,
        fontSize:7, fontFace:'Helvetica', align:'center', color:C_INK3
    });
    slide.addText('REGION DOSSIER', {
        x:9.2, y:0.04, w:4.13, h:0.2,
        fontSize:8, fontFace:'Helvetica', bold:true, align:'right', color:C_INK, letterSpacing:0.05
    });

    // ── RECOMMENDATION BANNER ────────────────────────────────
    slide.addShape(pptx.ShapeType.rect, {
        x:0, y:0.3, w:13.33, h:0.5,
        fill:{ color:C_DEEP }, line: null
    });
    slide.addText('XX', {
        x:0.2, y:0.34, w:2, h:0.24,
        fontSize:12, fontFace:'Helvetica', bold:true, color:C_WHITE
    });
    slide.addText('XX', {
        x:0.2, y:0.62, w:4, h:0.14,
        fontSize:9, fontFace:'Helvetica', color:C_WHITE
    });
    slide.addText(Math.round(composite).toString(), {
        x:11.33, y:0.34, w:1.8, h:0.28,
        fontSize:24, fontFace:'Helvetica', bold:true, align:'right', color:C_WHITE
    });
    slide.addText('COMPOSITE SCORE', {
        x:11.33, y:0.64, w:1.8, h:0.1,
        fontSize:7, fontFace:'Helvetica', bold:true, align:'right', color:C_WHITE
    });

    // ── TITLE BLOCK ──────────────────────────────────────────
    let ty = 0.85;
    slide.addText(`SA3 ${sa3Code} · ${state}`, {
        x:0.2, y:ty, w:12.93, h:0.14,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    ty += 0.16;

    slide.addText(regionName, {
        x:0.2, y:ty, w:12.93, h:0.35,
        fontSize:32, fontFace:'Times New Roman', bold:true, color:C_BLACK
    });
    ty += 0.38;

    slide.addText(`${independent.toLocaleString()} independent clinics · ${corpShare}% corporate`, {
        x:0.2, y:ty, w:12.93, h:0.14,
        fontSize:10, fontFace:'Helvetica', color:C_INK2
    });
    ty += 0.16;

    // Thesis placeholder
    slide.addShape(pptx.ShapeType.rect, {
        x:0.15, y:ty, w:0.08, h:0.12,
        fill:{ color:C_LIGHTSAGE }, line: null
    });
    slide.addText('THESIS', {
        x:0.15, y:ty, w:0.8, h:0.12,
        fontSize:7, fontFace:'Helvetica', bold:true, color:C_DEEP, align:'center', valign:'middle'
    });
    slide.addText('XX [Analyst: roll-up opportunity + structural case in 3–4 sentences]', {
        x:1.0, y:ty, w:11.93, h:0.3,
        fontSize:9, fontFace:'Helvetica', color:C_BLACK, valign:'top', wrap:true, lineSpacing:13
    });
    ty += 0.32;

    // ── DIMENSION TILES ──────────────────────────────────────
    const dimY = ty;
    const dims = [
        { label:'Demand', score:Math.round(demand).toString(), tone:'mid' },
        { label:'Supply', score:Math.round(supply).toString(), tone:'mid' },
        { label:'Competition', score:Math.round(competition).toString(), tone:'mid' },
        { label:'Economics', score:Math.round(economics).toString(), tone:'mid' }
    ];
    dims.forEach((d, i) => {
        const dx = 0.2 + (i * 3.23);
        slide.addShape(pptx.ShapeType.rect, {
            x:dx, y:dimY, w:3.13, h:0.68,
            fill:{ color:C_WHITE }, line:{ color:C_HAIR, pt:1 }
        });
        slide.addText(d.label, {
            x:dx+0.12, y:dimY+0.07, w:2.89, h:0.12,
            fontSize:8, fontFace:'Helvetica', bold:true, color:C_INK3
        });
        slide.addText(d.score, {
            x:dx+0.12, y:dimY+0.22, w:2.89, h:0.2,
            fontSize:16, fontFace:'Helvetica', bold:true, color:C_DEEP
        });
    });
    ty = dimY + 0.72;

    // ── TWO-COLUMN BODY ──────────────────────────────────────
    const colLX = 0.15, colLW = 7.2;
    const colRX = 7.5, colRW = 5.65;
    let lyLeft = ty, lyRight = ty;

    // LEFT: Path cards (Roll-up and Greenfield)
    slide.addText('STRATEGIES', {
        x:colLX, y:lyLeft, w:colLW, h:0.16,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    lyLeft += 0.22;

    slide.addShape(pptx.ShapeType.line, {
        x:colLX, y:lyLeft-0.02, w:colLW, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    // Roll-up path card
    slide.addShape(pptx.ShapeType.rect, {
        x:colLX, y:lyLeft, w:3.4, h:0.05,
        fill:{ color:C_SAGE }, line: null
    });
    slide.addText('PRIMARY — Roll-up the independents', {
        x:colLX+0.15, y:lyLeft+0.08, w:3.1, h:0.14,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK2
    });
    lyLeft += 0.26;
    slide.addText(`${independent} acquirable  ·  ${corpShare}% corporate`, {
        x:colLX+0.15, y:lyLeft, w:3.1, h:0.14,
        fontSize:8.5, fontFace:'Helvetica', color:C_INK2
    });
    lyLeft += 0.17;
    slide.addText(`${total} total clinics in region`, {
        x:colLX+0.15, y:lyLeft, w:3.1, h:0.12,
        fontSize:8, fontFace:'Helvetica', color:C_INK3
    });
    lyLeft += 0.15;

    // Greenfield path card
    slide.addShape(pptx.ShapeType.rect, {
        x:colLX, y:lyLeft+0.05, w:3.4, h:0.05,
        fill:{ color:C_SOFT }, line: null
    });
    slide.addText('SECONDARY — Greenfield new-build', {
        x:colLX+0.15, y:lyLeft+0.13, w:3.1, h:0.14,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK2
    });
    lyLeft += 0.32;
    slide.addText(`Supply score ${Math.round(supply)}  ·  demand analysis`, {
        x:colLX+0.15, y:lyLeft, w:3.1, h:0.14,
        fontSize:8.5, fontFace:'Helvetica', color:C_INK2
    });
    lyLeft += 0.17;
    slide.addText(`Demand score ${Math.round(demand)}  ·  market need`, {
        x:colLX+0.15, y:lyLeft, w:3.1, h:0.12,
        fontSize:8, fontFace:'Helvetica', color:C_INK3
    });
    lyLeft += 0.25;

    // ── LEFT: Sequence (3-phase plan)
    slide.addText('RECOMMENDED SEQUENCE', {
        x:colLX, y:lyLeft, w:colLW, h:0.16,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    lyLeft += 0.22;

    slide.addShape(pptx.ShapeType.line, {
        x:colLX, y:lyLeft-0.02, w:colLW, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    const phases = [
        { num:'1', label:'Anchor acquisition', period:'0–12mo', target:'XX sites · #3 corporate' },
        { num:'2', label:'Roll-up the tail', period:'12–24mo', target:'8–12 sites · #1 corporate' },
        { num:'3', label:'Greenfield gap', period:'24–36mo', target:'~14 sites · clear #1' }
    ];

    phases.forEach((ph, idx) => {
        slide.addShape(pptx.ShapeType.rect, {
            x:colLX, y:lyLeft, w:3.4, h:0.05,
            fill:{ color:C_SAGE }, line: null
        });
        slide.addText(`PHASE ${ph.num}  ·  ${ph.period}`, {
            x:colLX+0.15, y:lyLeft+0.08, w:3.1, h:0.12,
            fontSize:8, fontFace:'Helvetica', bold:true, color:C_SAGE
        });
        lyLeft += 0.22;
        slide.addText(ph.label, {
            x:colLX+0.15, y:lyLeft, w:3.1, h:0.12,
            fontSize:8.5, fontFace:'Helvetica', bold:true, color:C_INK2
        });
        lyLeft += 0.15;
        slide.addText('→ ' + ph.target, {
            x:colLX+0.15, y:lyLeft, w:3.1, h:0.12,
            fontSize:8, fontFace:'Helvetica', color:C_DEEP, bold:true
        });
        lyLeft += 0.18;
    });

    // RIGHT: Context and risks
    slide.addText('DEMAND DRIVERS', {
        x:colRX, y:lyRight, w:colRW, h:0.16,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    lyRight += 0.22;

    slide.addShape(pptx.ShapeType.line, {
        x:colRX, y:lyRight-0.02, w:colRW, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    slide.addText(`${total} total clinics  ·  Demand score ${Math.round(demand)}`, {
        x:colRX, y:lyRight, w:colRW, h:0.14,
        fontSize:9, fontFace:'Helvetica', color:C_INK2
    });
    lyRight += 0.17;
    slide.addText(`Supply score ${Math.round(supply)}  ·  ${independent} independent practices`, {
        x:colRX, y:lyRight, w:colRW, h:0.14,
        fontSize:9, fontFace:'Helvetica', color:C_INK2
    });
    lyRight += 0.17;
    slide.addText(`Economics score ${Math.round(economics)}  ·  regional profile`, {
        x:colRX, y:lyRight, w:colRW, h:0.14,
        fontSize:9, fontFace:'Helvetica', color:C_INK2
    });
    lyRight += 0.25;

    // Competitive structure
    slide.addText('COMPETITIVE STRUCTURE', {
        x:colRX, y:lyRight, w:colRW, h:0.16,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    lyRight += 0.22;

    slide.addShape(pptx.ShapeType.line, {
        x:colRX, y:lyRight-0.02, w:colRW, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    slide.addText(`${corpShare}% corporate  ·  ${100-corpShare}% independent`, {
        x:colRX, y:lyRight, w:colRW, h:0.14,
        fontSize:9, fontFace:'Helvetica', color:C_INK2
    });
    lyRight += 0.17;
    slide.addText(`Competition score ${Math.round(competition)}  ·  market structure`, {
        x:colRX, y:lyRight, w:colRW, h:0.14,
        fontSize:9, fontFace:'Helvetica', color:C_INK2
    });
    lyRight += 0.25;

    // Workforce
    slide.addText('WORKFORCE', {
        x:colRX, y:lyRight, w:colRW, h:0.16,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    lyRight += 0.22;

    slide.addShape(pptx.ShapeType.line, {
        x:colRX, y:lyRight-0.02, w:colRW, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    slide.addText(`${total} clinics across ${sa3Code}  ·  supply analysis`, {
        x:colRX, y:lyRight, w:colRW, h:0.14,
        fontSize:9, fontFace:'Helvetica', color:C_INK2
    });
    lyRight += 0.17;
    slide.addText(`Supply score ${Math.round(supply)}  ·  regional workforce need`, {
        x:colRX, y:lyRight, w:colRW, h:0.14,
        fontSize:9, fontFace:'Helvetica', color:C_INK2
    });
    lyRight += 0.25;

    // Risk flags
    slide.addText('RISK FLAGS', {
        x:colRX, y:lyRight, w:colRW, h:0.16,
        fontSize:9, fontFace:'Helvetica', bold:true, color:C_INK3, letterSpacing:0.08
    });
    lyRight += 0.22;

    slide.addShape(pptx.ShapeType.line, {
        x:colRX, y:lyRight-0.02, w:colRW, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    [
        { dot:C_AMBER, text:'SEIFA 5 caps private-billing upside' },
        { dot:C_SAGE, text:'Greenfield 18–24mo ramp risk' },
        { dot:C_RED, text:'Competitor may be assembling' }
    ].forEach((r, i) => {
        slide.addShape(pptx.ShapeType.ellipse, {
            x:colRX, y:lyRight+0.03, w:0.08, h:0.08,
            fill:{ color:r.dot }, line: null
        });
        slide.addText(r.text, {
            x:colRX+0.12, y:lyRight, w:colRW-0.15, h:0.14,
            fontSize:8.5, fontFace:'Helvetica', color:C_INK2
        });
        lyRight += 0.17;
    });

    // ── FOOTER ───────────────────────────────────────────────
    slide.addShape(pptx.ShapeType.rect, {
        x:0, y:6.8, w:13.33, h:0.7,
        fill:{ color:C_BG }, line:{ color:C_HAIR, pt:1 }
    });

    slide.addText('KEY DILIGENCE QUESTIONS', {
        x:0.2, y:6.86, w:6.5, h:0.14,
        fontSize:8, fontFace:'Helvetica', bold:true, color:C_INK3
    });

    const questions = [
        'XX Question 1',
        'XX Question 2',
        'XX Question 3',
        'XX Question 4'
    ];
    let qx = 0.2, qy = 7.04;
    questions.forEach((q, i) => {
        if (i === 2) { qx = 6.8; qy = 7.04; }
        slide.addText(`${i+1}.`, {
            x:qx, y:qy, w:0.3, h:0.12,
            fontSize:8, fontFace:'Helvetica', bold:true, color:C_DEEP
        });
        slide.addText(q, {
            x:qx+0.35, y:qy, w:2.8, h:0.12,
            fontSize:8, fontFace:'Helvetica', color:C_INK2
        });
        qy += 0.13;
    });

    slide.addShape(pptx.ShapeType.line, {
        x:0.2, y:7.36, w:12.93, h:0,
        line:{ color:C_HAIR, pt:0.5 }
    });

    slide.addText('Sources: Foundry Health · Data vintage Mar 2025', {
        x:0.2, y:7.38, w:12.93, h:0.1,
        fontSize:7, fontFace:'Helvetica', color:C_INK3
    });

    // ── Save ─────────────────────────────────────────────────
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const cleanName = regionName.replace(/[^a-zA-Z0-9]/g, '_');
    await pptx.writeFile({ fileName:`FH_GP_Diligence_region_${cleanName}_${dateStr}.pptx` });
    console.log(`[F-07] Region dossier exported for ${regionName}`);
}

// ============================================================
// Weight panel
// ============================================================
function isDefaultWeights() {
    return WEIGHT_KEYS.every(k => Math.round(State.weights[k]) === DEFAULT_WEIGHTS[k]);
}

function updateWeightUI() {
    const isDefault = isDefaultWeights();
    WEIGHT_KEYS.forEach(k => {
        const val = Math.round(State.weights[k]);
        document.getElementById('weight-value-' + k).textContent = val + '%';
        const slider = document.getElementById('weight-slider-' + k);
        if (parseInt(slider.value) !== val) slider.value = val;
        // Delta indicator
        const deltaEl = document.getElementById('weight-delta-' + k);
        if (deltaEl) {
            const diff = val - DEFAULT_WEIGHTS[k];
            deltaEl.textContent = diff !== 0 ? (diff > 0 ? '+' + diff : diff) : '';
        }
        // Base case bar position
        const baseEl = document.getElementById('weight-base-' + k);
        if (baseEl) {
            const pct = ((DEFAULT_WEIGHTS[k] - 5) / (60 - 5)) * 100;
            baseEl.style.width = pct + '%';
        }
    });
    document.getElementById('weights-reset').classList.toggle('hidden', isDefault);
    // Plan Phase H — the co-pilot banner shares this same floating slot and
    // takes precedence while active, so this banner stays suppressed rather
    // than fighting it for the same space.
    const copilotBannerActive = !document.getElementById('copilot-banner')?.classList.contains('hidden');
    document.getElementById('weight-warning').classList.toggle('visible', !isDefault && !copilotBannerActive);
    // Custom thesis badge
    const badge = document.getElementById('thesis-badge');
    if (badge) badge.style.display = isDefault ? 'none' : '';
    renderFunnelSummaries();  // plan Phase C
}

function adjustWeight(changedKey, newValue) {
    newValue = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, newValue));
    const others = WEIGHT_KEYS.filter(k => k !== changedKey);
    const targetOthersSum = 100 - newValue;
    const oldOthersSum = others.reduce((s, k) => s + State.weights[k], 0);
    others.forEach(k => {
        State.weights[k] = oldOthersSum > 0
            ? State.weights[k] * targetOthersSum / oldOthersSum
            : targetOthersSum / others.length;
    });
    State.weights[changedKey] = newValue;

    for (let iter = 0; iter < 10; iter++) {
        const violations = others.filter(k => State.weights[k] < WEIGHT_MIN || State.weights[k] > WEIGHT_MAX);
        if (violations.length === 0) break;
        let residual = 0;
        violations.forEach(k => {
            const clamped = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, State.weights[k]));
            residual += State.weights[k] - clamped;
            State.weights[k] = clamped;
        });
        const free = others.filter(k => !violations.includes(k));
        if (free.length === 0) break;
        const freeSum = free.reduce((s, k) => s + State.weights[k], 0);
        free.forEach(k => {
            State.weights[k] += freeSum > 0
                ? residual * State.weights[k] / freeSum
                : residual / free.length;
        });
    }

    const total = WEIGHT_KEYS.reduce((s, k) => s + State.weights[k], 0);
    const corr = 100 - total;
    if (Math.abs(corr) > 0.001) {
        const cand = State.weights[changedKey] + corr;
        if (cand >= WEIGHT_MIN && cand <= WEIGHT_MAX) State.weights[changedKey] = cand;
        else others.forEach(k => State.weights[k] += corr / others.length);
    }
}

function applyWeights() {
    if (!State.sa3Data) return;
    const wD = State.weights.demand / 100;
    const wS = State.weights.supply / 100;
    const wC = State.weights.competition / 100;
    const wE = State.weights.economics / 100;

    State.sa3Data.features.forEach(f => {
        const p = f.properties;
        const composite = (parseFloat(p.Demand_Score) || 0) * wD
                        + (parseFloat(p.Supply_Score) || 0) * wS
                        + (parseFloat(p.Competition_Score) || 0) * wC
                        + (parseFloat(p.Economics_Score) || 0) * wE;
        p.Composite_Score = Math.round(composite * 100) / 100;
    });

    // Assign tiers across all features (falls back to percentile if T1 < 5)
    const { mode, counts } = assignTiers(State.sa3Data.features);
    State.tieringMode = mode;
    State.tierCounts  = counts;

    const src = map && map.getSource('sa3');
    if (src) src.setData(State.sa3Data);

    if (State.currentSA3Code) {
        const f = State.sa3Data.features.find(ft => ft.properties.SA3Code === State.currentSA3Code);
        if (f) renderDrawer(f);
    }

    updateWeightUI();
    updateRailStats();
    if (State.currentView === 'rankings') renderRankings();
}

// ============================================================
// Rail stats
// ============================================================
// Single source of truth for "what SA3s are currently in scope" — shared by
// updateRailStats() below (which derives tier/avg/acquirable stats from it)
// and the copilot's camera-fit tool call (plan Phase H, applyCopilotIntent()),
// so the displayed region count and the camera's fitBounds target can never
// silently disagree with each other.
function computeFilteredSA3Features() {
    if (!State.sa3Data) return { all: [], afterGeo: [], final: [] };
    const all = State.sa3Data.features;
    let features = all;
    if (State.currentState) {
        features = features.filter(f => f.properties.State === State.currentState);
    }
    if (State.mmmFilter && State.mmmFilter.length) {
        features = features.filter(f => State.mmmFilter.includes(f.properties.MMM_Dominant));
    }
    // Copilot-only geography narrowing (plan Phase H) — resolved gazetteer
    // region, e.g. "South-East Queensland" -> its real SA3 code list.
    if (State.regionFilter && State.regionFilter.sa3Codes.length) {
        const codes = new Set(State.regionFilter.sa3Codes);
        features = features.filter(f => codes.has(String(f.properties.SA3Code).trim()));
    }
    const afterGeo = features;
    if (State.dpaFilter.bonded && State.dpaFilter.gpImg) {
        features = features.filter(f => f.properties.DPA_Bonded && f.properties.DPA_GP_IMG);
    } else if (State.dpaFilter.bonded) {
        features = features.filter(f => f.properties.DPA_Bonded);
    } else if (State.dpaFilter.gpImg) {
        features = features.filter(f => f.properties.DPA_GP_IMG);
    }
    if (State.workforceRiskMin > 0) {
        features = features.filter(f => (f.properties.Workforce_Risk_Score || 0) >= State.workforceRiskMin);
    }
    // SEIFA "Limit regions" (plan Phase G) — off by default even with
    // deciles selected (browsable, not narrowing, until switched on) since
    // SEIFA is SA2-level and this app's SA3 running count needs a real
    // aggregation step first (see computeSeifaPassingSA3Codes()).
    if (State.catalogueFilterActive.seifa && State.seifaDeciles && State.seifaDeciles.length) {
        const passing = computeSeifaPassingSA3Codes();
        if (passing) features = features.filter(f => passing.has(String(f.properties.SA3Code).trim()));
    }
    // Copilot-only tier narrowing (plan Phase H) — e.g. "tier 1 and 2".
    if (State.tierFilter && State.tierFilter.length) {
        features = features.filter(f => State.tierFilter.includes(f.properties.Tier));
    }
    // Copilot-only "low competitive density" narrowing (plan Phase H) — a
    // concrete resolved threshold, set by resolveLowDensityThreshold().
    // "Low density" = HIGH Supply_Score (see applyWorkforceFilters()'s
    // matching comment for why).
    if (State.supplyScoreMin != null) {
        features = features.filter(f => (parseFloat(f.properties.Supply_Score) || 0) >= State.supplyScoreMin);
    }
    return { all, afterGeo, final: features };
}

// "Low competitive density" (plan Phase H) resolves to a LIVE percentile
// split over whatever's currently geography-filtered (state/MMM/named
// region) — not a fixed absolute score — so "low" means the same relative
// thing whether you're looking at 340 regions or 12. Returns the median
// (50th percentile) Supply_Score value; the caller keeps everything AT OR
// ABOVE it (State.supplyScoreMin, ">=" in applyWorkforceFilters()/
// computeFilteredSA3Features()) — HIGH Supply_Score is what "low density"
// actually means here, not low, matching the design reference's
// "Competitive density ≤ Q2" framing (bottom half of density = top half of
// the inverse proxy score). Must be called with geography filters already
// applied to State but before ground filters are read, so `afterGeo`
// reflects only the geographic scope, not any ground-filter narrowing.
function resolveLowDensityThreshold(percentile = 50) {
    const { afterGeo } = computeFilteredSA3Features();
    const scores = afterGeo
        .map((f) => parseFloat(f.properties.Supply_Score))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    if (!scores.length) return null;
    const idx = Math.min(scores.length - 1, Math.floor((percentile / 100) * scores.length));
    return scores[idx];
}

function updateRailStats() {
    if (!State.sa3Data) return;
    const { all, afterGeo, final: features } = computeFilteredSA3Features();
    const allCount = all.length; // plan Phase F: running count stage 1
    const afterGeoCount = afterGeo.length; // plan Phase F: running count stage 2

    let tier1 = 0, tier2 = 0, sum = 0, acquirable = 0, scoredCount = 0; // scoredCount: plan Phase F
    features.forEach(f => {
        const p = f.properties;
        if (p.Tier === 1) tier1++;
        if (p.Tier === 2) tier2++;
        sum += parseFloat(p.Composite_Score) || 0;
        if (Number.isFinite(parseFloat(p.Composite_Score))) scoredCount++;
        const c = State.sa3ClinicCounts[p.SA3Code];
        if (c) acquirable += c.independent;
    });
    const avg = features.length > 0 ? sum / features.length : 0;
    renderFunnelRegionCount(allCount, afterGeoCount, features.length, scoredCount); // plan Phase F

    const regionsTxt = features.length.toLocaleString('en-AU');
    const avgTxt = avg.toFixed(1);
    const tier1Txt = tier1.toLocaleString('en-AU');
    const tier2Txt = tier2.toLocaleString('en-AU');
    const acqTxt = acquirable.toLocaleString('en-AU');

    // Update stats if elements exist (right-rail.js may not have initialized yet)
    const statRegions = document.getElementById('stat-regions');
    if (statRegions) statRegions.textContent = regionsTxt;
    const statAvg = document.getElementById('stat-avg');
    if (statAvg) statAvg.textContent = avgTxt;
    const statTier1 = document.getElementById('stat-tier1');
    if (statTier1) statTier1.textContent = tier1Txt;
    const statTier2 = document.getElementById('stat-tier2');
    if (statTier2) statTier2.textContent = tier2Txt;
    const statAcquirable = document.getElementById('stat-acquirable');
    if (statAcquirable) statAcquirable.textContent = acqTxt;

    // Mobile KPI strip mirror
    const setMobStat = (key, val) => {
        const el = document.querySelector('.mob-kpi-value[data-mob-stat="' + key + '"]');
        if (el) el.textContent = val;
    };
    setMobStat('regions',    regionsTxt);
    setMobStat('avg',        avgTxt);
    setMobStat('tier1',      tier1Txt);
    setMobStat('tier2',      tier2Txt);
    setMobStat('acquirable', acqTxt);

    if (document.getElementById('band-regions')) {
        document.getElementById('band-regions').textContent = features.length.toLocaleString('en-AU');
        document.getElementById('band-tier1').textContent = tier1.toLocaleString('en-AU');
        document.getElementById('band-tier2').textContent = tier2.toLocaleString('en-AU');
        document.getElementById('band-acquirable').textContent = acquirable.toLocaleString('en-AU');
    }
}

// ============================================================
// Rankings view
// ============================================================

function resetRankingsView() {
    /**
     * Reset rankings filters and sort when switching markets
     */
    State.rankingsSort = { key: 'composite', dir: 'desc' };
    State.rankingsFilters = { search: '', state: '', tier: '' };

    // Clear input fields
    const searchInput = document.getElementById('rankings-search');
    const stateSelect = document.getElementById('state-filter');
    const tierSelect = document.getElementById('tier-filter');

    if (searchInput) searchInput.value = '';
    if (stateSelect) stateSelect.value = '';
    if (tierSelect) tierSelect.value = '';
}

function renderRankings() {
    if (!State.sa3Data) return;
    const { search, state, tier } = State.rankingsFilters;
    const { key, dir } = State.rankingsSort;

    // Hide GP-only column chips when not on GP market
    const isGP = (State.markets.current || 'gp') === 'gp';
    document.querySelectorAll('[data-table-view="nra"], [data-table-view="archetypes"], [data-table-view="targets"]').forEach(chip => {
        chip.style.display = isGP ? '' : 'none';
        // If a GP-only view is currently active but we're not on GP, reset to composite
        if (!isGP && chip.classList.contains('active')) {
            chip.classList.remove('active');
            document.querySelector('[data-table-view="composite"]')?.classList.add('active');
            State.rankingsTableView = 'composite';
        }
    });

    let rows = State.sa3Data.features.map(f => {
        const p = f.properties;
        const counts = State.sa3ClinicCounts[p.SA3Code] || { total: 0, independent: 0 };
        return {
            code: p.SA3Code,
            name: p.SA3Name,
            state: p.State,
            demand: parseFloat(p.Demand_Score) || 0,
            supply: parseFloat(p.Supply_Score) || 0,
            competition: parseFloat(p.Competition_Score) || 0,
            economics: parseFloat(p.Economics_Score) || 0,
            composite: parseFloat(p.Composite_Score) || 0,
            tier: parseInt(p.Tier),
            clinics: counts.total,
            acquirable: counts.independent,
            // NRA Billing metrics (null if state not in coverage)
            nraFeesPerService: p.NRA_Fees_Per_Service != null ? parseFloat(p.NRA_Fees_Per_Service) : null,
            nraTotalFees:      p.NRA_Total_Fees      != null ? parseFloat(p.NRA_Total_Fees)       : null,
            nraBBRate:         p.NRA_BB_Rate          != null ? parseFloat(p.NRA_BB_Rate)          : null,
            nraFeeCagr:        p.NRA_Fee_Charged_CAGR != null ? parseFloat(p.NRA_Fee_Charged_CAGR) : null,
            nraBbCagr:         p.NRA_BB_Rate_CAGR     != null ? parseFloat(p.NRA_BB_Rate_CAGR)     : null,
            // F-01 archetype mix %
            ...(() => {
                const ac = State.sa3ClinicCounts[p.SA3Code] || {};
                const fmt  = ac.format   || {};
                const bill = ac.billing  || {};
                const own  = ac.ownership || {};
                const fmtTotal  = (fmt['Big-box']||0)  + (fmt['Mid-format']||0) + (fmt['Small']||0);
                const billTotal = (bill['Bulk']||0)    + (bill['Mixed']||0)     + (bill['Private']||0);
                const ownTotal  = (own['Corporate']||0) + (own['Independent']||0) + (own['NGO']||0);
                return {
                    fmtBigbox: fmtTotal  > 0 ? (fmt['Big-box']||0)       / fmtTotal  * 100 : null,
                    billBulk:  billTotal > 0 ? (bill['Bulk']||0)          / billTotal * 100 : null,
                    ownIndep:  ownTotal  > 0 ? (own['Independent']||0)    / ownTotal  * 100 : null,
                };
            })(),
            // F-02: Per-target clinic counts
            ...(() => {
                const targetMetrics = State.sa3TargetMetrics[p.SA3Code] || {};
                const targetCounts = {};
                Object.keys(targetMetrics).forEach(chainName => {
                    const paletteEntry = CLINIC_CHAIN_PALETTE[chainName] || {};
                    const slug = paletteEntry.slug || 'unknown';
                    targetCounts[`target_${slug}`] = targetMetrics[chainName].clinics || 0;
                });
                return targetCounts;
            })(),
        };
    });

    if (search) {
        const s = search.toLowerCase();
        rows = rows.filter(r => r.name.toLowerCase().includes(s) || r.state.toLowerCase().includes(s));
    }
    if (state) rows = rows.filter(r => r.state === state);
    if (tier) rows = rows.filter(r => r.tier === parseInt(tier));

    rows.sort((a, b) => {
        const av = a[key], bv = b[key];
        if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        // Nulls always sort last regardless of direction
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return dir === 'asc' ? av - bv : bv - av;
    });

    document.getElementById('rankings-count').textContent =
        rows.length === 1 ? '1 region' : rows.length.toLocaleString('en-AU') + ' regions';

    const tbody = document.getElementById('rankings-tbody');
    tbody.innerHTML = rows.map((r, i) => `
        <tr data-sa3="${r.code}">
            <td class="rank-num">${i + 1}</td>
            <td>
                <div class="rank-name">${r.name}</div>
                <div class="rank-state">${r.state}</div>
            </td>
            <td class="rank-num-cell num-col composite-col">${Math.round(r.demand)}</td>
            <td class="rank-num-cell num-col composite-col">${Math.round(r.supply)}</td>
            <td class="rank-num-cell num-col composite-col">${Math.round(r.competition)}</td>
            <td class="rank-num-cell num-col composite-col">${Math.round(r.economics)}</td>
            <td class="num-col"><span class="rank-composite">${Math.round(r.composite)}</span></td>
            <td>
                <span class="tier-pill">
                    <span class="tier-pill-dot" style="background:${TIER_COLORS[r.tier]}"></span>
                    Tier ${r.tier}
                </span>
            </td>
            <td class="rank-num-cell num-col">${fmtInt(r.clinics)}</td>
            <td class="rank-num-cell num-col" style="color:var(--sage-deep);font-weight:600">${fmtInt(r.acquirable)}</td>
            <td class="rank-num-cell num-col nra-col">${r.nraFeesPerService != null ? fmtMoney(r.nraFeesPerService) : '<span class="nra-na">—</span>'}</td>
            <td class="rank-num-cell num-col nra-col">${r.nraTotalFees      != null ? fmtMoney(r.nraTotalFees)      : '<span class="nra-na">—</span>'}</td>
            <td class="rank-num-cell num-col nra-col">${r.nraBBRate         != null ? fmtPct(r.nraBBRate, 1)        : '<span class="nra-na">—</span>'}</td>
            <td class="rank-num-cell num-col nra-col">${r.nraFeeCagr        != null ? fmtPct(r.nraFeeCagr, 1)       : '<span class="nra-na">—</span>'}</td>
            <td class="rank-num-cell num-col nra-col">${r.nraBbCagr         != null ? fmtPct(r.nraBbCagr, 1)        : '<span class="nra-na">—</span>'}</td>
            <td class="rank-num-cell num-col archetype-col">${r.fmtBigbox != null ? fmtPct(r.fmtBigbox, 0) : '<span class="nra-na">—</span>'}</td>
            <td class="rank-num-cell num-col archetype-col">${r.billBulk  != null ? fmtPct(r.billBulk,  0) : '<span class="nra-na">—</span>'}</td>
            <td class="rank-num-cell num-col archetype-col">${r.ownIndep  != null ? fmtPct(r.ownIndep,  0) : '<span class="nra-na">—</span>'}</td>
            ${(() => {
                // F-02: Generate target column cells for selected chains
                const selectedChains = State.clinicChainFilter || [];
                return selectedChains.map(chainName => {
                    const paletteEntry = CLINIC_CHAIN_PALETTE[chainName] || {};
                    const slug = paletteEntry.slug || 'unknown';
                    const count = r[`target_${slug}`] || 0;
                    return `<td class="rank-num-cell num-col target-col target-${slug}">${fmtInt(count)}</td>`;
                }).join('');
            })()}
        </tr>
    `).join('');

    document.querySelectorAll('.rankings-table thead th').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.key === key) th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
    });

    // Re-apply column visibility after tbody rebuild
    if (State.tableView) {
        const showC = State.tableView === 'composite'  || State.tableView === 'all';
        const showN = State.tableView === 'nra'        || State.tableView === 'all';
        const showA = State.tableView === 'archetypes' || State.tableView === 'all';
        document.querySelectorAll('.composite-col').forEach(el => { el.style.display = showC ? '' : 'none'; });
        document.querySelectorAll('.nra-col').forEach(el => { el.style.display = showN ? '' : 'none'; });
        document.querySelectorAll('.archetype-col').forEach(el => { el.style.display = showA ? '' : 'none'; });
    }

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
            const code = tr.dataset.sa3;
            switchView('map');
            setTimeout(() => selectSA3(code), 100);
        });
    });
}

// ============================================================
// View switching
// ============================================================
function switchView(viewName) {
    State.currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === viewName));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
    if (viewName === 'map' && map) setTimeout(() => map.resize(), 50);
    if (viewName === 'rankings') renderRankings();
    if (viewName === 'methodology') initMethodologyCollapsible();
    if (viewName === 'targets' && typeof TargetsTab !== 'undefined') {
        TargetsTab.enrichFromAppState();
        TargetsTab.render();
    }
}

let _methodologyCollapsed = false;
function initMethodologyCollapsible() {
    const article = document.querySelector('.method-article');
    if (!article || article.dataset.collapsibleDone) return;
    article.dataset.collapsibleDone = 'true';

    // Define top-level section boundaries (h2 text starts)
    const TOP_LEVEL = [
        'Part 1: Regional Analysis',
        'Part 2: Clinic-Level Analysis',
        'Part 3: Data Sources & Limitations'
    ];

    const allH2 = Array.from(article.querySelectorAll('h2'));
    const topH2s = allH2.filter(h => TOP_LEVEL.some(t => h.textContent.trim().startsWith(t)));

    // Build TOC
    const toc = document.createElement('nav');
    toc.className = 'method-toc';
    toc.innerHTML = '<div class="method-toc-label">Contents</div>' +
        topH2s.map((h, i) => {
            const id = 'method-sec-' + i;
            h.id = id;
            const label = h.textContent.replace(/\s*0\s*–\s*100\s*/g, '').replace(/\s*SA3 level\s*/g, '').trim();
            return `<a class="method-toc-link" href="#${id}">${label}</a>`;
        }).join('');
    article.insertBefore(toc, article.querySelector('h2'));

    // Wrap each top-level section in a <details>
    topH2s.forEach((h2, i) => {
        const details = document.createElement('details');
        details.className = 'method-section';
        details.open = false; // all sections collapsed by default

        const summary = document.createElement('summary');
        summary.className = 'method-section-summary';
        summary.innerHTML = h2.outerHTML
            .replace('<h2', '<span class="method-section-h2"')
            .replace('</h2>', '</span>');

        // Collect all nodes until next top-level h2
        const nodes = [];
        let node = h2.nextSibling;
        const nextTopH2 = topH2s[i + 1];
        while (node && node !== nextTopH2) {
            nodes.push(node);
            node = node.nextSibling;
        }

        details.appendChild(summary);
        const body = document.createElement('div');
        body.className = 'method-section-body';
        nodes.forEach(n => body.appendChild(n));
        details.appendChild(body);

        h2.replaceWith(details);
    });

    // Now wrap h3 subsections in collapsible details elements
    const allH3 = Array.from(article.querySelectorAll('h3'));
    allH3.forEach(h3 => {
        const details = document.createElement('details');
        details.className = 'method-subsection';
        details.open = false; // subsections collapsed by default

        const summary = document.createElement('summary');
        summary.className = 'method-subsection-summary';
        summary.innerHTML = h3.outerHTML
            .replace('<h3', '<span class="method-subsection-h3"')
            .replace('</h3>', '</span>');

        // Collect all nodes until next h3 or h2
        const nodes = [];
        let node = h3.nextSibling;
        while (node && node.tagName !== 'H2' && node.tagName !== 'H3') {
            nodes.push(node);
            node = node.nextSibling;
        }

        details.appendChild(summary);
        const body = document.createElement('div');
        body.className = 'method-subsection-body';
        nodes.forEach(n => body.appendChild(n));
        details.appendChild(body);

        h3.replaceWith(details);
    });
}

// ============================================================
// Data Studio
// ============================================================

const DataStudio = {
    marketStates: { gp: true, physio: true, dental: true },

    datasets: {
        gp: [
            { name: 'Clinic locations', source: 'Scraped + geocoded', year: 2025, coverage: 99 },
            { name: 'Clinic format', source: 'Scraped + verified', year: 2025, coverage: 86 },
            { name: 'Ownership', source: 'Scraped + verified', year: 2025, coverage: 95 },
            { name: 'Medicare billing', source: 'Services Australia NRA', year: 2025, coverage: 93 },
            { name: 'GP workforce', source: 'HWD 2025', year: 2025, coverage: 100 }
        ],
        physio: [
            { name: 'Practice locations', source: 'Scraped + geocoded', year: 2024, coverage: 95 },
            { name: 'Practice accreditation', source: 'APA registry', year: 2024, coverage: 72 },
            { name: 'Service mix', source: 'Modelled', year: 2024, coverage: 68 }
        ],
        dental: [
            { name: 'Practice locations', source: 'Scraped + geocoded', year: 2024, coverage: 86 },
            { name: 'Practice accreditation', source: 'AHPRA registry', year: 2024, coverage: 58 },
            { name: 'Billing mix', source: 'Pending', year: null, coverage: null }
        ],
        shared: [
            { name: 'Drive-time isochrones', source: 'Mapbox API', year: 2025, coverage: 100 },
            { name: 'SA3 boundaries', source: 'ABS Digital Boundaries', year: 2021, coverage: 100 },
            { name: 'SA2 boundaries', source: 'ABS Digital Boundaries', year: 2021, coverage: 100 },
            { name: 'Population (ERP)', source: 'ABS Estimated Residents', year: 2025, coverage: 100 },
            { name: 'Population (SA1)', source: 'ABS Estimated Residents', year: 2025, coverage: 100 }
        ]
    },

    init() {
        // Render datasets
        this.renderDatasets();

        // Wire up market toggles
        document.querySelectorAll('.ds-market-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const market = e.target.closest('.ds-market-group').dataset.market;
                this.toggleMarket(market, e.target.checked);
            });
        });

        // Wire up controls
        document.getElementById('ds-reset-btn').addEventListener('click', () => this.reset());
        document.getElementById('ds-save-btn').addEventListener('click', () => this.saveModel());

        this.updateConfidence();
    },

    renderDatasets() {
        // Render market datasets
        ['gp', 'physio', 'dental'].forEach(market => {
            const container = document.getElementById(`${market}-datasets`);
            if (!container) return;

            const html = this.datasets[market]
                .map(ds => this.renderDatasetTile(ds))
                .join('');
            container.innerHTML = html;
        });

        // Render shared datasets by category
        const sharedContainer = document.getElementById('shared-datasets');
        const sharedByCategory = {
            'Catchments': this.datasets.shared.slice(0, 1),
            'Boundaries': this.datasets.shared.slice(1, 3),
            'Population': this.datasets.shared.slice(4)
        };

        let sharedHtml = '';
        for (const [category, datasets] of Object.entries(sharedByCategory)) {
            sharedHtml += `
                <div class="ds-shared-group">
                    <div class="ds-shared-header">
                        <span class="ds-shared-lock">🔒</span>
                        <h3 class="ds-shared-title">${category}</h3>
                    </div>
                    <div class="ds-datasets">
                        ${datasets.map(ds => this.renderDatasetTile(ds)).join('')}
                    </div>
                </div>
            `;
        }
        sharedContainer.innerHTML = sharedHtml;
    },

    renderDatasetTile(ds) {
        const coverageClass = ds.coverage === null ? '' :
            ds.coverage >= 80 ? 'green' :
            ds.coverage >= 50 ? 'amber' : 'red';

        const coverageText = ds.coverage === null ? '—' :
            `${ds.coverage}%${ds.coverage < 80 ? ' ⚠' : ''}`;

        const yearText = ds.year === null ? '—' : ds.year;

        return `
            <div class="ds-dataset">
                <div class="ds-dataset-info">
                    <div class="ds-dataset-name">${ds.name}</div>
                    <div class="ds-dataset-meta">
                        <span class="ds-dataset-source">${ds.source}</span>
                        <span class="ds-dataset-year">${yearText}</span>
                    </div>
                </div>
                <span class="ds-dataset-coverage ${coverageClass}">${coverageText}</span>
            </div>
        `;
    },

    toggleMarket(market, enabled) {
        this.marketStates[market] = enabled;
        const group = document.querySelector(`.ds-market-group[data-market="${market}"]`);
        if (enabled) {
            group.classList.remove('disabled');
        } else {
            group.classList.add('disabled');
        }
        this.updateConfidence();
    },

    updateConfidence() {
        // Calculate average coverage of in-scope sources
        let totalCoverage = 0;
        let count = 0;

        // Markets data
        for (const [market, enabled] of Object.entries(this.marketStates)) {
            if (enabled && this.datasets[market]) {
                this.datasets[market].forEach(ds => {
                    if (ds.coverage !== null) {
                        totalCoverage += ds.coverage;
                        count++;
                    }
                });
            }
        }

        // Shared data (always included)
        this.datasets.shared.forEach(ds => {
            if (ds.coverage !== null) {
                totalCoverage += ds.coverage;
                count++;
            }
        });

        const confidence = count > 0 ? Math.round(totalCoverage / count) : 0;
        document.getElementById('ds-confidence-value').textContent = confidence + '%';

        // Update markets-in-scope count
        const marketsInScope = Object.values(this.marketStates).filter(Boolean).length;
        document.getElementById('ds-markets-in-scope').textContent = marketsInScope;
    },

    reset() {
        this.marketStates = { gp: true, physio: true, dental: true };
        document.querySelectorAll('.ds-market-checkbox').forEach(checkbox => {
            checkbox.checked = true;
        });
        document.querySelectorAll('.ds-market-group').forEach(group => {
            group.classList.remove('disabled');
        });
        this.updateConfidence();
        showToast('Model configuration reset');
    },

    saveModel() {
        const enabledMarkets = Object.keys(this.marketStates).filter(m => this.marketStates[m]);
        showToast(`Model saved with ${enabledMarkets.join(', ')} markets`);
    }
};

// ============================================================
// Init
// ============================================================
async function init() {
    const progressEl = document.getElementById('loader-progress');
    const setProgress = (txt) => { if (progressEl) progressEl.textContent = txt; };

    initMap();

    try {
        // 1. Load shared data (geographic, demographics) — once per session
        await loadSharedData(setProgress);

        // 2. Determine initial market from URL or default to 'gp'
        const marketParam = getQueryParam('market');
        const initialMarket = marketParam && State.markets.available.includes(marketParam)
            ? marketParam
            : 'gp';

        // 3. Load market data and render
        await switchMarket(initialMarket);

        // 4. Wire up market selector
        wireMarketSelector();

        // 5. Initialize Data Studio
        DataStudio.init();

        // 6. If ?login=1 was passed (from home page login button), open login modal
        if (getQueryParam('login') === '1') {
            const loginView = document.querySelector('[data-view="login"]');
            if (loginView) loginView.style.display = 'flex';
        }
    } catch (err) {
        console.error(err);
        setProgress('Error: ' + err.message);
    }

    wireUI();

    // Hide loader once init is complete
    const loaderEl = document.getElementById('loader');
    if (loaderEl) loaderEl.classList.add('hide');
}

function populateClinicChainsFilter() {
    /**
     * Dynamically populate the clinic chains filter grid with checkboxes.
     * Only available for GP market; clear for other markets.
     */
    const grid = document.getElementById('clinic-chains-grid');
    if (!grid) return;

    // Only show chains for GP market; show placeholder for others
    if (State.markets.current !== 'gp') {
        grid.innerHTML = '<span style="font-size:11px;color:var(--muted);font-style:italic;">To be classified</span>';
        return;
    }

    if (!State.uniqueClinicChains) return;

    grid.innerHTML = '';

    State.uniqueClinicChains.forEach(chain => {
        const label = document.createElement('label');
        label.className = 'mmm-chip-label';
        label.title = `Filter to ${chain} clinics`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = chain;
        checkbox.dataset.chain = chain;
        checkbox.className = 'clinic-chain-checkbox';

        const span = document.createElement('span');
        span.textContent = chain;

        label.appendChild(checkbox);
        label.appendChild(span);
        grid.appendChild(label);
    });

    // Wire up event listeners for clinic chain checkboxes
    document.querySelectorAll('.clinic-chain-checkbox').forEach(chk => {
        chk.addEventListener('change', () => {
            State.clinicChainFilter = Array.from(
                document.querySelectorAll('.clinic-chain-checkbox:checked')
            ).map(el => el.dataset.chain);

            // F-02: Show/hide reset button
            const resetBtn = document.getElementById('clinic-chains-reset');
            if (resetBtn) {
                resetBtn.classList.toggle('hidden', State.clinicChainFilter.length === 0);
            }

            applyClinicChainFilter();
            updateRailStats();

            // F-02: Show/update target overview drawer (legacy — suppressed by rd-* unified rail)
            updateTargetOverviewDrawer();

            // Unified right rail: fire event so renderRightRail() picks up new chain state
            document.dispatchEvent(new CustomEvent('chainFilterChanged'));
        });
    });

    // F-02: Wire reset button
    const resetBtn = document.getElementById('clinic-chains-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            // Clear all checkboxes
            document.querySelectorAll('.clinic-chain-checkbox').forEach(chk => {
                chk.checked = false;
            });
            // Trigger change event on first checkbox to update state
            const firstChk = document.querySelector('.clinic-chain-checkbox');
            if (firstChk) firstChk.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }
}

// Step 1's scoring-market dropdown (plan Phase D) — single-select, calls
// switchMarket() directly instead of round-tripping through index.html.
function toggleMarketDropdown(forceOpen) {
    const menu = document.getElementById('market-dropdown-menu');
    const trigger = document.getElementById('market-dropdown-trigger');
    if (!menu || !trigger) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', String(open));
}

async function selectScoringMarket(marketId) {
    toggleMarketDropdown(false);
    if (marketId === State.markets.current) return;
    await switchMarket(marketId);
}

function wireMarketSelector() {
    // Close the scoring-market dropdown on any outside click, mirroring the
    // existing .lens-nra-menu pattern.
    document.addEventListener('click', () => toggleMarketDropdown(false));
    // Same for the Targets chain-dossier layer dropdown (plan Phase G).
    document.addEventListener('click', () => { if (typeof TP !== 'undefined') TP.toggleLayerDropdown(false); });
    wireMapSubTabs();
}

function wireMapSubTabs() {
    const tabs = document.querySelectorAll('.map-subtab');
    const panels = {
        map:     document.getElementById('subpanel-map'),
        list:    document.getElementById('subpanel-list'),
        targets: document.getElementById('subpanel-targets'),
    };
    const countEl = document.getElementById('map-subbar-count');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.subtab;
            tabs.forEach(t => t.classList.toggle('active', t.dataset.subtab === target));

            // Hide all panels
            Object.values(panels).forEach(p => { if (p) p.style.display = 'none'; });

            // Show selected panel
            const panel = panels[target];
            if (panel) panel.style.display = 'flex';

            if (target === 'map') {
                if (countEl) countEl.textContent = '';
                setTimeout(() => { if (map) map.resize(); }, 50);
            } else if (target === 'list') {
                renderRankings(); // reuse existing full rankings renderer
            } else if (target === 'targets') {
                if (countEl) countEl.textContent = '';
                // Chain dossier (plan Phase G) is computed from real per-layer
                // clinic data, not the old hand-curated GP-only PLATFORM list,
                // so it works for any market/clinic layer — no more "coming
                // soon" placeholder for non-GP markets.
                if (typeof TP !== 'undefined') TP.renderChainDossier();
            }
        });
    });
}


function wireUI() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    document.getElementById('state-filter').addEventListener('change', (e) => {
        State.currentState = e.target.value;
        applyWorkforceFilters();
        applySeifaFilter();
        updateRailStats();
        updateFilterChips();
        deactivatePreset();
    });

    // Lens segmented control — replaces map-view-select dropdown
    document.querySelectorAll('.lens-seg:not(.lens-nra-trigger)').forEach(btn => {
        btn.addEventListener('click', () => {
            setMapView(btn.dataset.lens);
            saveLensState(btn.dataset.lens);
        });
    });

    // NRA sub-menu toggle
    const nraTrigger = document.getElementById('lens-nra-trigger');
    const nraMenu = document.getElementById('lens-nra-menu');
    if (nraTrigger && nraMenu) {
        nraTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            nraMenu.classList.toggle('open');
        });
        document.addEventListener('click', () => nraMenu.classList.remove('open'));
        nraMenu.querySelectorAll('.lens-nra-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                nraMenu.classList.remove('open');
                setMapView(item.dataset.lens);
                saveLensState(item.dataset.lens);
            });
        });
    }

    // SEIFA decile chips — replace old dual slider
    document.querySelectorAll('.seifa-chip').forEach(chk => {
        chk.addEventListener('change', () => {
            State.seifaDeciles = Array.from(document.querySelectorAll('.seifa-chip:checked'))
                .map(el => parseInt(el.value));
            // Auto-switch lens to SEIFA when any decile is selected
            if (State.seifaDeciles.length > 0 && State.currentMapView !== 'seifa') {
                setMapView('seifa');
            }
            applySeifaFilter();
            updateFilterChips();
        });
    });

    // F-06: MMM multi-select via checkbox chips. Values can be a single
    // class ("3") or a combined bucket ("6,7" — plan Phase G's "6-7 Remote"
    // grouping) — split+flatten so a combined chip contributes every class
    // it represents to State.mmmFilter.
    document.querySelectorAll('.mmm-chip').forEach(chk => {
        chk.addEventListener('change', () => {
            const selected = Array.from(document.querySelectorAll('.mmm-chip:checked'))
                .flatMap(el => el.value.split(',').map(Number));
            State.mmmFilter = selected;
            applyWorkforceFilters();
            updateRailStats();
            updateFilterChips();
        });
    });

    // F-01: Archetype filter chips
    document.querySelectorAll('.archetype-chip').forEach(chk => {
        chk.addEventListener('change', () => {
            ['format', 'billing', 'ownership'].forEach(dim => {
                State.archetypeFilter[dim] = Array.from(
                    document.querySelectorAll(`.archetype-chip[data-dim="${dim}"]:checked`)
                ).map(el => el.value);
            });
            const hasAny = State.archetypeFilter.format.length
                || State.archetypeFilter.billing.length
                || State.archetypeFilter.ownership.length;
            const resetBtn = document.getElementById('archetype-reset');
            if (resetBtn) resetBtn.style.display = hasAny ? '' : 'none';
            // Apply both archetype and data availability filters together
            applyArchetypeFilter();
            if (Object.values(State.dataAvailabilityFilter).some(v => v)) {
                applyDataAvailabilityFilter();
            }
            updateFilterChips();
        });
    });

    document.getElementById('archetype-reset')?.addEventListener('click', () => {
        document.querySelectorAll('.archetype-chip').forEach(chk => { chk.checked = false; });
        State.archetypeFilter = { format: [], billing: [], ownership: [] };
        document.getElementById('archetype-reset').style.display = 'none';
        applyArchetypeFilter();
        if (Object.values(State.dataAvailabilityFilter).some(v => v)) {
            applyDataAvailabilityFilter();
        }
    });

    // Data Availability Filters (Has Website, Has GP Data)
    document.querySelectorAll('.clinic-data-filter').forEach(chk => {
        chk.addEventListener('change', () => {
            ['has_website', 'has_gp_data'].forEach(filter => {
                State.dataAvailabilityFilter[filter] = document.querySelector(
                    `.clinic-data-filter[data-filter="${filter}"]`
                )?.checked || false;
            });
            applyDataAvailabilityFilter();
        });
    });

    // Global search — replaces old clinic search input
    const globalSearchInput = document.getElementById('global-search-input');
    const globalSearchClear = document.getElementById('global-search-clear');
    const globalSearchResults = document.getElementById('global-search-results');

    function runGlobalSearch(query) {
        if (!query) {
            globalSearchResults.innerHTML = '';
            globalSearchClear.style.display = 'none';
            return;
        }
        globalSearchClear.style.display = '';
        const q = query.toLowerCase();

        // SA3 name matches
        const sa3Matches = (State.sa3Data ? State.sa3Data.features : [])
            .filter(f => (f.properties.SA3Name || '').toLowerCase().includes(q))
            .slice(0, 5);

        // Clinic name matches
        const clinicMatches = State.clinicsData
            .filter(c => (c.clinic_name || '').toLowerCase().includes(q) ||
                         (c.suburb || '').toLowerCase().includes(q))
            .slice(0, 8);

        // Chain matches
        const chainMatches = Object.keys(CLINIC_CHAIN_PALETTE)
            .filter(k => k.toLowerCase().includes(q) || (CLINIC_CHAIN_PALETTE[k].name || '').toLowerCase().includes(q))
            .slice(0, 4);

        let html = '';
        if (sa3Matches.length) {
            html += `<div class="search-result-group-label">SA3 Regions</div>`;
            sa3Matches.forEach(f => {
                const p = f.properties;
                html += `<div class="search-result-item" onclick="searchGotoSA3('${p.SA3Code}')">
                    <div>
                        <div class="search-result-name">${p.SA3Name}</div>
                        <div class="search-result-meta">${p.State || ''} · Score ${Math.round(p.Composite_Score || 0)} · T${p.tier||5}</div>
                    </div>
                </div>`;
            });
        }
        if (clinicMatches.length) {
            html += `<div class="search-result-group-label">Clinics</div>`;
            clinicMatches.forEach(c => {
                html += `<div class="search-result-item" onclick="searchGotoClinic('${c.clinic_id}')">
                    <div>
                        <div class="search-result-name">${c.clinic_name}</div>
                        <div class="search-result-meta">${c.suburb || ''}, ${c.state_code || ''}</div>
                    </div>
                </div>`;
            });
        }
        if (chainMatches.length) {
            html += `<div class="search-result-group-label">Clinic chains</div>`;
            chainMatches.forEach(k => {
                const pal = CLINIC_CHAIN_PALETTE[k];
                html += `<div class="search-result-item" onclick="searchActivateChain('${k}')">
                    <span style="width:8px;height:8px;border-radius:50%;background:${pal.color || '#888'};flex-shrink:0;display:inline-block"></span>
                    <div>
                        <div class="search-result-name">${pal.name || k}</div>
                        <div class="search-result-meta">Chain filter</div>
                    </div>
                </div>`;
            });
        }
        if (!html) html = `<div style="padding:12px;font-size:12px;color:var(--muted);text-align:center">No results for "${query}"</div>`;
        globalSearchResults.innerHTML = html;
    }

    if (globalSearchInput) {
        globalSearchInput.addEventListener('input', (e) => runGlobalSearch(e.target.value.trim()));
        globalSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { globalSearchInput.value = ''; globalSearchResults.innerHTML = ''; globalSearchClear.style.display = 'none'; }
            // Natural-language co-pilot (plan Phase H) — Enter did nothing on
            // this input before; extends the existing ⌘K surface rather than
            // adding a second "ask the AI" panel. Typing-as-you-go behavior
            // above is completely untouched.
            if (e.key === 'Enter' && globalSearchInput.value.trim()) {
                e.preventDefault();
                globalSearchResults.innerHTML = '';
                globalSearchClear.style.display = 'none';
                const q = globalSearchInput.value.trim();
                globalSearchInput.value = '';
                runCopilotQuery(q);
            }
        });
        document.addEventListener('click', (e) => { if (!e.target.closest('.global-search-wrap')) globalSearchResults.innerHTML = ''; });
    }
    if (globalSearchClear) {
        globalSearchClear.addEventListener('click', () => { globalSearchInput.value = ''; globalSearchResults.innerHTML = ''; globalSearchClear.style.display = 'none'; });
    }
    // ⌘K shortcut
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            globalSearchInput?.focus();
        }
    });

    // Keep legacy clinic-search-input wired for backward compat (hidden)
    const clinicSearchInput = document.getElementById('clinic-search-input');
    const clinicSearchClear = document.getElementById('clinic-search-clear');
    const clinicSearchResultsList = document.getElementById('clinic-search-results-list');

    // F-04: DPA checkboxes
    const dpaBondedEl = document.getElementById('dpa-bonded');
    const dpaGpImgEl  = document.getElementById('dpa-gp-img');
    if (dpaBondedEl) dpaBondedEl.addEventListener('change', () => {
        State.dpaFilter.bonded = dpaBondedEl.checked;
        applyWorkforceFilters();
        updateRailStats();
    });
    if (dpaGpImgEl) dpaGpImgEl.addEventListener('change', () => {
        State.dpaFilter.gpImg = dpaGpImgEl.checked;
        applyWorkforceFilters();
        updateRailStats();
    });

    // F-04: Workforce risk threshold slider
    const wfRiskSlider = document.getElementById('workforce-risk-slider');
    const wfRiskReadout = document.getElementById('workforce-risk-readout');
    if (wfRiskSlider) wfRiskSlider.addEventListener('input', () => {
        State.workforceRiskMin = parseInt(wfRiskSlider.value);
        if (wfRiskReadout) wfRiskReadout.textContent = State.workforceRiskMin;
        applyWorkforceFilters();
        updateRailStats();
    });

    // F-04: Workforce weight sliders (proportional redistribution)
    const WF_KEYS = ['supply', 'age', 'dpa'];
    const WF_MIN = 5;
    function adjustWorkforceWeight(changedKey, newValue) {
        const others = WF_KEYS.filter(k => k !== changedKey);
        const targetOthersSum = 100 - newValue;
        const oldOthersSum = others.reduce((s, k) => s + State.workforceWeights[k], 0);
        others.forEach(k => {
            State.workforceWeights[k] = oldOthersSum > 0
                ? State.workforceWeights[k] * targetOthersSum / oldOthersSum
                : targetOthersSum / others.length;
        });
        State.workforceWeights[changedKey] = newValue;
        // clamp
        const violations = others.filter(k => State.workforceWeights[k] < WF_MIN);
        violations.forEach(k => { State.workforceWeights[k] = WF_MIN; });
        const total = WF_KEYS.reduce((s, k) => s + State.workforceWeights[k], 0);
        const corr = 100 - total;
        if (Math.abs(corr) > 0.01) State.workforceWeights[changedKey] += corr;
    }

    function recomputeWorkforceScores() {
        if (!State.sa3Data || !State.mmmBenchmark) return;
        const bm = State.mmmBenchmark;
        const ftes = Object.values(bm).map(v => v.gpfte_per_10k);
        const ages = Object.values(bm).map(v => v.pct_55plus);
        const fte_min = Math.min(...ftes), fte_max = Math.max(...ftes);
        const age_min = Math.min(...ages), age_max = Math.max(...ages);
        const { supply: wS, age: wA, dpa: wD } = State.workforceWeights;
        State.sa3Data.features.forEach(f => {
            const p = f.properties;
            const mmm = String(parseInt(p.MMM_Dominant) || 1);
            const b = bm[mmm] || bm['1'];
            const supply_norm = fte_max !== fte_min ? 100 * (fte_max - b.gpfte_per_10k) / (fte_max - fte_min) : 0;
            const age_norm    = age_max !== age_min ? 100 * (b.pct_55plus - age_min) / (age_max - age_min) : 0;
            const dpa_score   = (p.DPA_Bonded && p.DPA_GP_IMG) ? 100 : (p.DPA_Bonded || p.DPA_GP_IMG) ? 50 : 0;
            p.Workforce_Risk_Score = Math.round(wS / 100 * supply_norm + wA / 100 * age_norm + wD / 100 * dpa_score);
        });
        map.getSource('sa3').setData(State.sa3Data);
    }

    function updateWorkforceWeightUI() {
        WF_KEYS.forEach(k => {
            const slider = document.getElementById('wf-weight-slider-' + k);
            const readout = document.getElementById('wf-weight-value-' + k);
            if (slider) slider.value = Math.round(State.workforceWeights[k]);
            if (readout) readout.textContent = Math.round(State.workforceWeights[k]) + '%';
        });
    }

    WF_KEYS.forEach(k => {
        const el = document.getElementById('wf-weight-slider-' + k);
        if (el) el.addEventListener('input', () => {
            adjustWorkforceWeight(k, parseFloat(el.value));
            updateWorkforceWeightUI();
            recomputeWorkforceScores();
        });
    });

    const wfResetEl = document.getElementById('workforce-reset');
    if (wfResetEl) wfResetEl.addEventListener('click', () => {
        State.workforceWeights = { supply: 40, age: 30, dpa: 30 };
        updateWorkforceWeightUI();
        recomputeWorkforceScores();
    });

    // NOTE: 'layer-clinics'/'layer-labels' checkboxes don't exist anywhere in
    // map.html (pre-existing dead reference, unrelated to plan Phase C) —
    // this was silently throwing on every page load and halting the rest of
    // wireUI() before it ever ran. Guarded defensively, matching this
    // function's own convention elsewhere (e.g. wfResetEl above).
    const layerClinicsEl = document.getElementById('layer-clinics');
    if (layerClinicsEl) layerClinicsEl.addEventListener('change', (e) => {
        const vis = e.target.checked ? 'visible' : 'none';
        ['clinics-corporate', 'clinics-independent', 'clinics-public'].forEach(id =>
            map.setLayoutProperty(id, 'visibility', vis));
    });
    const layerLabelsEl = document.getElementById('layer-labels');
    if (layerLabelsEl) layerLabelsEl.addEventListener('change', (e) => {
        map.setLayoutProperty('clinics-labels', 'visibility', e.target.checked ? 'visible' : 'none');
    });

    WEIGHT_KEYS.forEach(k => {
        document.getElementById('weight-slider-' + k).addEventListener('input', (e) => {
            adjustWeight(k, parseFloat(e.target.value));
            applyWeights();
        });
    });
    document.getElementById('weights-reset').addEventListener('click', () => {
        State.weights = { ...DEFAULT_WEIGHTS };
        applyWeights();
    });

    document.getElementById('rankings-search').addEventListener('input', (e) => {
        State.rankingsFilters.search = e.target.value;
        renderRankings();
    });
    document.querySelectorAll('.chip-group-state .chip').forEach(c => {
        c.addEventListener('click', () => {
            document.querySelectorAll('.chip-group-state .chip').forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            State.rankingsFilters.state = c.dataset.state || '';
            renderRankings();
        });
    });
    document.querySelectorAll('.chip-group-tier .chip').forEach(c => {
        c.addEventListener('click', () => {
            document.querySelectorAll('.chip-group-tier .chip').forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            State.rankingsFilters.tier = c.dataset.tier || '';
            renderRankings();
        });
    });
    // Table column view switcher
    function applyTableView(view) {
        State.tableView = view;
        const showComposite  = view === 'composite'  || view === 'all';
        const showNra        = view === 'nra'        || view === 'all';
        const showArchetypes = view === 'archetypes' || view === 'all';
        const showTargets    = view === 'targets'    || view === 'all';

        document.querySelectorAll('.composite-col').forEach(el => {
            el.style.display = showComposite ? '' : 'none';
        });
        document.querySelectorAll('.nra-col').forEach(el => {
            el.style.display = showNra ? '' : 'none';
        });
        document.querySelectorAll('.archetype-col').forEach(el => {
            el.style.display = showArchetypes ? '' : 'none';
        });
        document.querySelectorAll('.target-col').forEach(el => {
            el.style.display = showTargets ? '' : 'none';
        });

        // F-02: Generate dynamic target columns if viewing targets
        if (showTargets && State.clinicChainFilter && State.clinicChainFilter.length > 0) {
            updateTargetTableColumns();
        }
    }

    /**
     * F-02: Dynamically add/remove target column headers based on selected filters
     */
    function updateTargetTableColumns() {
        const thead = document.querySelector('.rankings-table thead tr');
        if (!thead) return;

        // Remove existing target column headers (except placeholder)
        document.querySelectorAll('.target-col').forEach(col => {
            if (col.tagName === 'TH') col.remove();
        });

        // Add new target column headers for each selected chain
        const selectedChains = State.clinicChainFilter || [];
        selectedChains.forEach(chainName => {
            const paletteEntry = CLINIC_CHAIN_PALETTE[chainName] || {};
            const slug = paletteEntry.slug || 'unknown';
            const th = document.createElement('th');
            th.className = `sortable num-col target-col target-${slug}`;
            th.setAttribute('data-key', `target_${slug}`);
            th.textContent = paletteEntry.name || chainName;
            thead.appendChild(th);
        });

        // Re-render rankings to include target data
        renderRankings();
    }
    State.tableView = 'composite';
    applyTableView('composite');

    document.querySelectorAll('.chip-group-table-view .chip').forEach(c => {
        c.addEventListener('click', () => {
            document.querySelectorAll('.chip-group-table-view .chip').forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            applyTableView(c.dataset.tableView);
        });
    });

    document.querySelectorAll('.rankings-table thead th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (State.rankingsSort.key === key) {
                State.rankingsSort.dir = State.rankingsSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                State.rankingsSort.key = key;
                State.rankingsSort.dir = key === 'name' || key === 'state' ? 'asc' : 'desc';
            }
            renderRankings();
        });
    });

    document.getElementById('export-btn')?.addEventListener('click', () => { window.print(); });

    const fab = document.getElementById('fab-controls');
    const backdrop = document.getElementById('sheet-backdrop');
    const rail = document.getElementById('map-rail');

    if (fab) {
        fab.addEventListener('click', () => {
            if (rail.classList.contains('open')) closeRail();
            else openRail();
        });
    }
    if (backdrop) {
        backdrop.addEventListener('click', () => {
            closeRail();
            closeDrawer();
        });
    }

    let touchStartY = 0;
    if (rail) {
        rail.addEventListener('touchstart', (e) => {
            if (!isMobile()) return;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });
        rail.addEventListener('touchend', (e) => {
            if (!isMobile()) return;
            const dy = e.changedTouches[0].clientY - touchStartY;
            if (dy > 80 && rail.scrollTop <= 0) closeRail();
        }, { passive: true });
    }

    let lastIsMobile = isMobile();
    window.addEventListener('resize', () => {
        const nowMobile = isMobile();
        if (nowMobile !== lastIsMobile) {
            lastIsMobile = nowMobile;
            rail.classList.remove('open');
            hideBackdrop();
        }
        if (map) map.resize();
    });

    // Data-quality toggle
    document.getElementById('data-quality-toggle')?.addEventListener('click', () => {
        const sub = document.getElementById('data-quality-sub');
        const btn = document.getElementById('data-quality-toggle');
        if (sub) {
            const open = sub.style.display !== 'none';
            sub.style.display = open ? 'none' : '';
            btn.textContent = open ? 'Data-quality filters ▸' : 'Data-quality filters ▴';
        }
    });

    // Filter reset all
    document.getElementById('filter-reset-all')?.addEventListener('click', () => {
        document.getElementById('state-filter').value = '';
        State.currentState = '';
        document.querySelectorAll('.seifa-chip').forEach(c => c.checked = false);
        State.seifaDeciles = [];
        document.querySelectorAll('.mmm-chip').forEach(c => c.checked = false);
        State.mmmFilter = [];
        document.querySelectorAll('.archetype-chip').forEach(c => c.checked = false);
        State.archetypeFilter = { format: [], billing: [], ownership: [] };
        document.querySelectorAll('.clinic-data-filter').forEach(c => c.checked = false);
        State.dataAvailabilityFilter = { has_website: false, has_gp_data: false };
        document.getElementById('dpa-bonded').checked = false;
        document.getElementById('dpa-gp-img').checked = false;
        State.dpaFilter = { bonded: false, gpImg: false };
        document.getElementById('workforce-risk-slider').value = 0;
        document.getElementById('workforce-risk-readout').textContent = '0';
        State.workforceRiskMin = 0;
        document.getElementById('archetype-reset').style.display = 'none';
        applyWorkforceFilters();
        applySeifaFilter();
        updateRailStats();
        updateFilterChips();
        deactivatePreset();
    });

    // Filter chips clear all
    document.getElementById('filter-chips-clear')?.addEventListener('click', () => {
        document.getElementById('filter-reset-all')?.click();
    });

    // KPI league-table button
    document.getElementById('kpi-league-btn')?.addEventListener('click', () => {
        document.querySelector('.nav-btn[data-view="rankings"]')?.click();
    });

    // Preset cards init
    initPresets();

    // Restore saved lens state
    const savedLens = localStorage.getItem('fh.lens');
    if (savedLens) setMapView(savedLens);

    // Funnel rail (plan Phase C) always starts at step 1 — the HTML's own
    // default classes (step 1 open, steps 2-4 collapsed) are correct as-is;
    // just sync each step's summary visibility to match on load.
    FUNNEL_STEP_IDS.forEach((stepId) => {
        const stepBody = document.getElementById('acc-body-' + stepId);
        const stepSummary = document.getElementById('funnel-summary-' + stepId);
        if (stepBody && stepSummary) {
            stepSummary.style.display = stepBody.classList.contains('collapsed') ? '' : 'none';
        }
    });
    renderFunnelSummaries();

    // Populate clinic chains filter after all UI is wired up
    populateClinicChainsFilter();
}

// ============================================================
// Accordion toggle — Datasets-as-layers (plan Phase C): the left rail is
// now a 4-step funnel ('clinics' / 'geo' / 'ground' / 'thesis', in that
// order — "always the same order," one step open at a time, per the design
// canvas). Opening one step force-collapses the other three rather than
// each accordion toggling independently. No open/closed state is persisted
// across loads — the funnel always starts back at step 1, matching the
// "forcing function" intent rather than restoring an arbitrary prior state.
// ============================================================
const FUNNEL_STEP_IDS = ['clinics', 'geo', 'ground', 'thesis'];
function toggleAccordion(id) {
    const body = document.getElementById('acc-body-' + id);
    if (!body) return;
    const opening = body.classList.contains('collapsed');
    FUNNEL_STEP_IDS.forEach((stepId) => {
        const stepBody = document.getElementById('acc-body-' + stepId);
        const stepArrow = document.getElementById('acc-arrow-' + stepId);
        const stepSummary = document.getElementById('funnel-summary-' + stepId);
        if (!stepBody) return;
        const shouldOpen = opening && stepId === id;
        stepBody.classList.toggle('collapsed', !shouldOpen);
        if (stepArrow) stepArrow.textContent = shouldOpen ? '▾' : '▸';
        if (stepSummary) stepSummary.style.display = shouldOpen ? 'none' : '';
    });
    renderFunnelSummaries();
}

// One-line "current answer" shown under each collapsed funnel step.
function renderFunnelSummaries() {
    const marketName = State.markets.config?.market_name || (State.markets.current || 'gp').toUpperCase();
    const archCount = (State.archetypeFilter.format.length + State.archetypeFilter.billing.length + State.archetypeFilter.ownership.length);
    const chainCount = (State.clinicChainFilter || []).length;
    const filterCount = archCount + chainCount;
    const extraLayers = (State.activeClinicLayers || []).length - 1; // plan Phase E
    const s1 = document.getElementById('funnel-summary-clinics');
    if (s1) s1.textContent = `${marketName}` +
        (extraLayers > 0 ? ` · +${extraLayers} layer${extraLayers === 1 ? '' : 's'}` : '') +
        (filterCount ? ` · ${filterCount} filter${filterCount === 1 ? '' : 's'} active` : '');

    const s2 = document.getElementById('funnel-summary-geo');
    if (s2) {
        const state = State.regionFilter ? (State.currentState ? `${State.currentState} · ${State.regionFilter.name}` : State.regionFilter.name)
            : (State.currentState || 'All Australia');
        const mmm = (State.mmmFilter || []).length ? `MMM ${State.mmmFilter.join(',')}` : 'all remoteness';
        s2.textContent = `${state} · ${mmm}`;
    }

    const s3 = document.getElementById('funnel-summary-ground');
    if (s3) {
        // plan Phase G — Step 3 is now the Data Catalogue entry point (Demand/
        // Supply/Competition/Economics), so its summary reflects which of
        // those categories have something loaded, not SEIFA specifically.
        const loadedCategoryNames = (typeof CATALOGUE_CATEGORIES !== 'undefined' ? CATALOGUE_CATEGORIES : [])
            .filter((cat) => cat.sections.some((sec) => sec.items.some((i) => i.key && State.catalogueLoaded[i.key])))
            .map((cat) => cat.name);
        // plan Phase H — copilot-only tier/density filters have no catalogue
        // category of their own; append them alongside loaded categories.
        const copilotBits = [];
        if (State.tierFilter && State.tierFilter.length) copilotBits.push(`Tier ${State.tierFilter.slice().sort().join('–')}`);
        if (State.supplyScoreMin != null) copilotBits.push('Low competitive density');
        const base = loadedCategoryNames.length ? loadedCategoryNames.join(', ') + ' loaded' : 'Nothing loaded';
        s3.textContent = copilotBits.length ? `${base} · ${copilotBits.join(' · ')}` : base;
    }

    const s4 = document.getElementById('funnel-summary-thesis');
    if (s4) {
        const w = State.weights;
        s4.textContent = `Demand ${Math.round(w.demand)}% · Supply ${Math.round(w.supply)}% · Competition ${Math.round(w.competition)}% · Economics ${Math.round(w.economics)}%`;
    }
}

// ============================================================
// Lens UI update
// ============================================================
function updateLensUI(view) {
    const NRA_LABELS = {
        'nra-fees-per-service': 'Avg fees per service',
        'nra-total-fees': 'Total fees',
        'nra-bb': 'Bulk billing %',
        'nra-fee-cagr': '3Y fee CAGR',
        'nra-bb-cagr': '3Y BB% CAGR'
    };
    const isNra = view.startsWith('nra-');

    document.querySelectorAll('.lens-seg:not(.lens-nra-trigger)').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lens === view);
    });
    const nraTrigger = document.getElementById('lens-nra-trigger');
    if (nraTrigger) nraTrigger.classList.toggle('active', isNra);

    document.querySelectorAll('.lens-nra-item').forEach(item => {
        item.classList.toggle('active', item.dataset.lens === view);
    });

    const sublabel = document.getElementById('lens-nra-sublabel');
    if (sublabel) {
        if (isNra) {
            sublabel.textContent = NRA_LABELS[view] || view;
            sublabel.classList.add('visible');
        } else {
            sublabel.classList.remove('visible');
        }
    }
}

function saveLensState(view) {
    localStorage.setItem('fh.lens', view);
}

// ============================================================
// Active filter chips
// ============================================================
function updateFilterChips() {
    renderFunnelSummaries();  // plan Phase C: every filter-change choke point also refreshes the funnel's collapsed-step summaries
    const chips = [];

    if (State.currentState) chips.push({ label: State.currentState, key: 'state' });

    if (State.seifaDeciles && State.seifaDeciles.length > 0)
        chips.push({ label: `SEIFA: ${State.seifaDeciles.join(',')}`, key: 'seifa' });

    if (State.mmmFilter.length > 0)
        chips.push({ label: `MMM: ${State.mmmFilter.join(',')}`, key: 'mmm' });

    ['format', 'billing', 'ownership'].forEach(dim => {
        (State.archetypeFilter[dim] || []).forEach(val => {
            chips.push({ label: val, key: `arch-${dim}-${val}` });
        });
    });

    if (State.dpaFilter.bonded) chips.push({ label: 'DPA Bonded', key: 'dpa-bonded' });
    if (State.dpaFilter.gpImg)  chips.push({ label: 'DPA GP/IMG', key: 'dpa-gpimg' });
    if (State.workforceRiskMin > 0) chips.push({ label: `Risk ≥${State.workforceRiskMin}`, key: 'wf-risk' });

    // Copilot-only filters (plan Phase H) — no rail control of their own,
    // so this chip is the only way to see and clear them.
    if (State.regionFilter) chips.push({ label: State.regionFilter.name, key: 'region' });
    if (State.tierFilter && State.tierFilter.length)
        chips.push({ label: `Tier ${State.tierFilter.slice().sort().join(', ')}`, key: 'tier' });
    if (State.supplyScoreMin != null)
        chips.push({ label: `Low competitive density`, key: 'density' });

    const strip = document.getElementById('filter-chips-strip');
    const inner = document.getElementById('filter-chips-inner');
    if (!strip || !inner) return;

    if (chips.length === 0) {
        strip.style.display = 'none';
        return;
    }
    strip.style.display = '';
    inner.innerHTML = chips.map(c => `
        <span class="filter-chip">
            ${c.label}
            <button class="filter-chip-remove" onclick="removeFilterChip('${c.key}')">✕</button>
        </span>
    `).join('');
}

function removeFilterChip(key) {
    if (key === 'state') {
        document.getElementById('state-filter').value = '';
        State.currentState = '';
        applyWorkforceFilters(); applySeifaFilter();
    } else if (key === 'seifa') {
        document.querySelectorAll('.seifa-chip').forEach(c => c.checked = false);
        State.seifaDeciles = [];
        applySeifaFilter();
    } else if (key === 'mmm') {
        document.querySelectorAll('.mmm-chip').forEach(c => c.checked = false);
        State.mmmFilter = [];
        applyWorkforceFilters();
    } else if (key.startsWith('arch-')) {
        const [, dim, val] = key.split('-');
        const chip = document.querySelector(`.archetype-chip[data-dim="${dim}"][value="${val}"]`);
        if (chip) { chip.checked = false; chip.dispatchEvent(new Event('change', { bubbles: true })); return; }
    } else if (key === 'dpa-bonded') {
        document.getElementById('dpa-bonded').checked = false;
        State.dpaFilter.bonded = false; applyWorkforceFilters();
    } else if (key === 'dpa-gpimg') {
        document.getElementById('dpa-gp-img').checked = false;
        State.dpaFilter.gpImg = false; applyWorkforceFilters();
    } else if (key === 'wf-risk') {
        document.getElementById('workforce-risk-slider').value = 0;
        document.getElementById('workforce-risk-readout').textContent = '0';
        State.workforceRiskMin = 0; applyWorkforceFilters();
    } else if (key === 'region') {
        State.regionFilter = null; applyWorkforceFilters();
    } else if (key === 'tier') {
        State.tierFilter = []; applyWorkforceFilters();
    } else if (key === 'density') {
        State.supplyScoreMin = null; applyWorkforceFilters();
    }
    updateRailStats();
    updateFilterChips();
    deactivatePreset();
}

// ============================================================
// Natural-language co-pilot (plan Phase H)
// ============================================================
// One structured "intent" object (from api/copilot.js's generateObject call)
// is applied here deterministically, in a FIXED safe order — the model
// never touches live state directly, it only describes intent. Every step
// below reuses an existing apply*()/set*() function; nothing here
// reimplements filtering logic. See plan Phase H for the full rationale
// (single structured intent vs. an agentic tool loop against the live map).

const COPILOT_MARKET_LABELS = { gp: 'General Practice', physio: 'Physiotherapy', dental: 'Dental' };
const COPILOT_CATALOGUE_LABELS = { seifa: 'SEIFA IRSAD decile', workforce: 'workforce risk & DPA flags', gpBillings: 'GP billing mix' };
const COPILOT_MAX_HISTORY = 6;
let _copilotHistory = []; // session-only (no backend session store exists or is needed) — [{query, summary}], newest last

function copilotSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function copilotBbox(features) {
    if (!features || !features.length) return null;
    try { return turf.bbox(turf.featureCollection(features)); } catch { return null; }
}
function copilotBboxArea(b) { return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]); }
// "Meaningfully different" — IoU (intersection over union) below 0.6. A
// simple, concrete threshold: refiltering to a subset that still mostly
// overlaps the current view (e.g. "now just the independent ones", same
// regions, fewer clinic pins) holds the camera; a genuinely different
// region set re-flies. New code — no existing helper computes this.
function copilotBboxChangedMeaningfully(before, after) {
    if (!before || !after) return true;
    const areaBefore = copilotBboxArea(before), areaAfter = copilotBboxArea(after);
    if (areaBefore === 0 || areaAfter === 0) return true;
    const ix1 = Math.max(before[0], after[0]), iy1 = Math.max(before[1], after[1]);
    const ix2 = Math.min(before[2], after[2]), iy2 = Math.min(before[3], after[3]);
    const inter = (ix2 > ix1 && iy2 > iy1) ? (ix2 - ix1) * (iy2 - iy1) : 0;
    const iou = inter / (areaBefore + areaAfter - inter);
    return iou < 0.6;
}

function buildCopilotStateSummary() {
    return {
        scoringMarket: State.markets.current,
        clinicLayers: State.activeClinicLayers,
        state: State.currentState || null,
        regionName: State.regionFilter?.name || null,
        remoteness: State.mmmFilter,
        tier: State.tierFilter,
        seifaDeciles: State.seifaDeciles,
        workforceRiskMin: State.workforceRiskMin,
        dpaBonded: State.dpaFilter.bonded,
        dpaGpImg: State.dpaFilter.gpImg,
        archetype: State.archetypeFilter,
        lowDensityActive: State.supplyScoreMin != null,
        colourBy: State.currentMapView,
        catalogueLoaded: State.catalogueLoaded,
        regionsInScope: computeFilteredSA3Features().final.length
    };
}

function describeCopilotFilterSummary(intent) {
    const parts = [];
    if (intent.geography?.regionName) parts.push(intent.geography.regionName);
    else if (intent.geography?.state) parts.push(intent.geography.state);
    if (intent.groundFilters?.archetype?.ownership?.length) parts.push(intent.groundFilters.archetype.ownership.join('/'));
    if (intent.groundFilters?.tier?.length) parts.push(`Tier ${intent.groundFilters.tier.slice().sort().join('–')}`);
    if (intent.groundFilters?.lowDensity) parts.push('Low competitive density');
    return parts.join(' · ');
}

// Builds the ordered, conditional list of checklist steps for this intent —
// only steps whose action actually applies for THIS query appear (unlike a
// fixed mock sequence). Each has a real async `run()`; the checklist UI
// renders them queued → running → done as they're actually awaited below,
// not a fake timer.
function buildCopilotSteps(intent) {
    const steps = [];
    const isGP = () => State.markets.current === 'gp';

    if (intent.scoringMarket && intent.scoringMarket !== State.markets.current) {
        steps.push({
            label: `Setting scoring market: ${COPILOT_MARKET_LABELS[intent.scoringMarket] || intent.scoringMarket}`,
            tag: 'step 1', railStep: 'clinics',
            run: async () => { await switchMarket(intent.scoringMarket); }
        });
    }
    if (intent.clinicLayers) {
        (intent.clinicLayers.add || []).forEach((layer) => {
            if (!State.activeClinicLayers.includes(layer)) {
                steps.push({
                    label: `Adding ${COPILOT_MARKET_LABELS[layer] || layer} layer`, tag: 'step 1', railStep: 'clinics',
                    run: async () => { await toggleClinicLayer(layer, true); }
                });
            }
        });
        (intent.clinicLayers.remove || []).forEach((layer) => {
            if (State.activeClinicLayers.includes(layer) && layer !== State.markets.current) {
                steps.push({
                    label: `Removing ${COPILOT_MARKET_LABELS[layer] || layer} layer`, tag: 'step 1', railStep: 'clinics',
                    run: async () => { await toggleClinicLayer(layer, false); }
                });
            }
        });
    }
    const catalogueNeeded = (intent.catalogueLoads || []).filter((k) => {
        if (State.catalogueLoaded[k]) return false;
        if (k === 'gpBillings' && !isGP()) return false; // gpOnly — model should already reflect this in status:partial/skipped
        return true;
    });
    if (catalogueNeeded.length) {
        steps.push({
            label: `Loading ${catalogueNeeded.map((k) => COPILOT_CATALOGUE_LABELS[k] || k).join(', ')} from data catalogue`,
            tag: 'catalogue', railStep: 'ground',
            run: async () => {
                catalogueNeeded.forEach((k) => { catalogueStaged[k] = true; });
                loadDataCatalogueSelections();
            }
        });
    }
    const g = intent.geography, gf = intent.groundFilters;
    const filteringLabel = describeCopilotFilterSummary(intent);
    if (filteringLabel) {
        steps.push({
            label: `Filtering: ${filteringLabel}`, tag: 'steps 2–3', railStep: null, // touches both, pulsed separately below
            run: async () => {
                if (g?.state && g.state !== State.currentState) {
                    State.currentState = g.state;
                    const sel = document.getElementById('state-filter');
                    if (sel) sel.value = g.state;
                }
                if (g?.regionName) {
                    const resolved = await resolveGazetteerRegion(g.regionName);
                    if (resolved) State.regionFilter = resolved;
                }
                if (g?.remoteness?.length) {
                    State.mmmFilter = g.remoteness;
                    document.querySelectorAll('.mmm-chip').forEach((cb) => {
                        const vals = cb.value.split(',').map(Number);
                        cb.checked = vals.some((v) => g.remoteness.includes(v));
                    });
                }
                if (gf?.tier?.length) State.tierFilter = gf.tier;
                if (gf?.seifaDeciles?.length) {
                    State.seifaDeciles = gf.seifaDeciles;
                    State.catalogueFilterActive.seifa = true;
                    document.querySelectorAll('.seifa-chip').forEach((cb) => { cb.checked = gf.seifaDeciles.includes(parseInt(cb.value, 10)); });
                }
                if (gf?.workforceRiskMin != null) {
                    State.workforceRiskMin = gf.workforceRiskMin;
                    const slider = document.getElementById('workforce-risk-slider');
                    if (slider) slider.value = gf.workforceRiskMin;
                    const readout = document.getElementById('workforce-risk-readout');
                    if (readout) readout.textContent = gf.workforceRiskMin;
                }
                if (gf?.dpaBonded != null) {
                    State.dpaFilter.bonded = gf.dpaBonded;
                    const el = document.getElementById('dpa-bonded'); if (el) el.checked = gf.dpaBonded;
                }
                if (gf?.dpaGpImg != null) {
                    State.dpaFilter.gpImg = gf.dpaGpImg;
                    const el = document.getElementById('dpa-gp-img'); if (el) el.checked = gf.dpaGpImg;
                }
                if (gf?.archetype) {
                    ['format', 'billing', 'ownership'].forEach((dim) => {
                        const vals = gf.archetype[dim];
                        if (vals && vals.length) {
                            State.archetypeFilter[dim] = vals;
                            document.querySelectorAll(`.archetype-chip[data-dim="${dim}"]`).forEach((cb) => { cb.checked = vals.includes(cb.value); });
                        }
                    });
                    applyArchetypeFilter();
                }
                if (gf?.lowDensity) State.supplyScoreMin = resolveLowDensityThreshold(50);
                applyWorkforceFilters();
                applySeifaFilter();
            }
        });
    }
    if (intent.colourBy && intent.colourBy !== State.currentMapView) {
        steps.push({
            label: `Colouring by ${intent.colourBy}`, tag: 'colour', railStep: 'thesis',
            run: async () => { setMapView(intent.colourBy); saveLensState(intent.colourBy); }
        });
    }
    return steps;
}

// The one entry point wired to Enter on #global-search-input (plan Phase H).
async function runCopilotQuery(query) {
    const trimmed = (query || '').trim();
    if (!trimmed) return;

    renderCopilotChecklist([{ label: 'Thinking through your request', tag: 'plan', status: 'running' }]);
    showCopilotChecklist(true);

    let data;
    try {
        const res = await fetch('/api/copilot', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                query: trimmed,
                currentState: buildCopilotStateSummary(),
                history: _copilotHistory.slice(-COPILOT_MAX_HISTORY)
            })
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok || !data.intent) {
            showCopilotChecklist(false);
            renderCopilotBanner({ status: 'declined', declineReason: data.error || "Couldn't reach the co-pilot just now — try again." });
            return;
        }
    } catch {
        showCopilotChecklist(false);
        renderCopilotBanner({ status: 'declined', declineReason: "Couldn't reach the co-pilot just now — try again." });
        return;
    }

    await applyCopilotIntent(data.intent, trimmed);
}

async function applyCopilotIntent(intent, originalQuery) {
    const beforeFeatures = computeFilteredSA3Features().final;
    const beforeBbox = copilotBbox(beforeFeatures);
    const beforeCount = beforeFeatures.length;
    const steps = buildCopilotSteps(intent);
    const pulseSteps = new Set(steps.map((s) => s.railStep).filter(Boolean));
    if (steps.some((s) => s.tag === 'steps 2–3')) { pulseSteps.add('geo'); pulseSteps.add('ground'); }

    const display = steps.map((s) => ({ label: s.label, tag: s.tag, status: 'queued' }));
    renderCopilotChecklist(display);

    for (let i = 0; i < steps.length; i++) {
        display[i].status = 'running';
        renderCopilotChecklist(display);
        await steps[i].run();
        display[i].status = 'done';
        renderCopilotChecklist(display);
        await copilotSleep(180); // pacing only, for legibility — every line above is real completed work, not a timer standing in for it
    }

    updateRailStats();
    updateFilterChips();
    renderFunnelSummaries();

    // Camera — resolved AFTER every filter has actually applied, fitted to
    // the real matched geometry (never the gazetteer's static region bbox),
    // and only re-flown if the view genuinely needs to move.
    let cameraHeld = false;
    if (intent.focus?.name) {
        display.push({ label: `Opening ${intent.focus.name}`, tag: 'map', status: 'running' });
        renderCopilotChecklist(display);
        if (intent.focus.type === 'region') {
            const match = State.sa3Data?.features.find((f) => (f.properties.SA3Name || '').toLowerCase() === intent.focus.name.toLowerCase());
            if (match) selectSA3(match.properties.SA3Code);
        } else if (intent.focus.type === 'clinic') {
            const match = State.clinicsData.find((c) => (c.clinic_name || '').toLowerCase() === intent.focus.name.toLowerCase());
            if (match) selectClinic(match);
        }
        display[display.length - 1].status = 'done';
        renderCopilotChecklist(display);
    } else {
        const afterFeatures = computeFilteredSA3Features().final;
        const afterBbox = copilotBbox(afterFeatures);
        if (afterBbox && copilotBboxChangedMeaningfully(beforeBbox, afterBbox)) {
            display.push({ label: `Fitting camera to ${afterFeatures.length} matched region${afterFeatures.length === 1 ? '' : 's'}`, tag: 'map', status: 'running' });
            renderCopilotChecklist(display);
            map.fitBounds(afterBbox, { padding: 60, duration: 800, maxZoom: 10 });
            display[display.length - 1].status = 'done';
            renderCopilotChecklist(display);
        } else {
            cameraHeld = true;
        }
    }

    pulseRailSteps([...pulseSteps]);
    await copilotSleep(300);
    showCopilotChecklist(false);

    const afterCount = computeFilteredSA3Features().final.length;
    _copilotHistory.push({ query: originalQuery, summary: intent.summary, beforeCount, afterCount, time: copilotTimeLabel() });
    if (_copilotHistory.length > COPILOT_MAX_HISTORY) _copilotHistory.shift();

    renderCopilotBanner(intent, cameraHeld);
}

function copilotTimeLabel() {
    return new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function copilotResetApplied() {
    State.regionFilter = null;
    State.tierFilter = [];
    State.supplyScoreMin = null;
    applyWorkforceFilters();
    updateRailStats();
    updateFilterChips();
    _copilotHistory = [];
    hideCopilotBanner();
}

function showCopilotChecklist(show) {
    document.getElementById('copilot-checklist')?.classList.toggle('hidden', !show);
}

function renderCopilotChecklist(steps) {
    const body = document.getElementById('copilot-checklist-body');
    const title = document.getElementById('copilot-checklist-title');
    if (!body) return;
    const doneCount = steps.filter((s) => s.status === 'done').length;
    if (title) {
        title.textContent = (steps.length && doneCount === steps.length)
            ? `Done · ${steps.length} action${steps.length === 1 ? '' : 's'}`
            : `Working · ${doneCount} of ${steps.length}`;
    }
    body.innerHTML = steps.map((s) => {
        const icon = s.status === 'done' ? '✓' : (s.status === 'running' ? '▶' : '·');
        return `
            <div class="copilot-step ${s.status}">
                <span class="copilot-step-icon ${s.status}">${icon}</span>
                <span class="copilot-step-label">${s.label}</span>
                <span class="copilot-step-tag">${s.tag}</span>
            </div>
        `;
    }).join('');
}

// Briefly highlights which of the 4 funnel steps the intent actually
// touched (plan Phase H) — restarts the animation cleanly even if a
// previous pulse is still fading, via the forced-reflow trick.
function pulseRailSteps(railStepIds) {
    railStepIds.forEach((id) => {
        const el = document.getElementById('acc-' + id);
        if (!el) return;
        el.classList.remove('copilot-pulse');
        void el.offsetWidth;
        el.classList.add('copilot-pulse');
        setTimeout(() => el.classList.remove('copilot-pulse'), 3300);
    });
}

let _copilotLogOpen = true;

function copilotToggleLog() {
    _copilotLogOpen = !_copilotLogOpen;
    renderCopilotBanner(_copilotLastIntent, _copilotLastCameraHeld);
}

let _copilotLastIntent = null;
let _copilotLastCameraHeld = false;

function hideCopilotBanner() {
    document.getElementById('copilot-banner')?.classList.add('hidden');
    document.getElementById('weight-warning') && updateWeightUI();
}

// Renders the one banner slot for every co-pilot outcome — applied,
// partial, declined — plus the camera-held indicator and the expandable
// multi-turn log. Same visual register throughout (plan Phase H): no
// toast, no red, matching .weight-warning's existing amber "differs from
// base case" treatment. Only one of .weight-warning/#copilot-banner shows
// at a time — the co-pilot banner takes precedence while active since it's
// the more specific, more recent state change.
function renderCopilotBanner(intent, cameraHeld) {
    _copilotLastIntent = intent;
    _copilotLastCameraHeld = cameraHeld;
    const el = document.getElementById('copilot-banner');
    if (!el || !intent) return;

    document.getElementById('weight-warning')?.classList.remove('visible');

    if (intent.status === 'declined') {
        el.className = 'copilot-banner declined';
        el.innerHTML = `
            <div class="copilot-banner-row">
                <span class="copilot-banner-badge neutral">Out of scope</span>
                <div class="copilot-banner-text">${intent.declineReason || "Can't do that yet."}</div>
            </div>
        `;
        return;
    }

    const badgeLabel = intent.status === 'partial' ? 'Partial' : 'Copilot applied';
    const skippedNote = (intent.status === 'partial' && intent.skipped?.length)
        ? `<span class="copilot-banner-sub"> — skipped: ${intent.skipped.join('; ')}</span>` : '';
    const latest = _copilotHistory[_copilotHistory.length - 1];
    const scopeNote = latest ? `<span class="copilot-banner-sub"> — ${latest.afterCount} region${latest.afterCount === 1 ? '' : 's'} in view</span>` : '';

    const logRows = _copilotHistory.slice().reverse().map((h) => `
        <div class="copilot-banner-log-row">
            <span class="copilot-banner-log-delta" style="color:var(--muted)">${h.time}</span>
            <div class="copilot-banner-log-query">“${h.query}”</div>
            <span class="copilot-banner-log-delta">${h.beforeCount} → ${h.afterCount}</span>
        </div>
    `).join('');

    el.className = 'copilot-banner';
    el.innerHTML = `
        <div class="copilot-banner-row">
            <span class="copilot-banner-badge">${badgeLabel}</span>
            <div class="copilot-banner-text">${intent.summary || ''}${skippedNote}${scopeNote}</div>
            <button class="copilot-banner-btn" onclick="copilotResetApplied()">Reset</button>
            ${_copilotHistory.length > 1 ? `<button class="copilot-banner-toggle" onclick="copilotToggleLog()">${_copilotLogOpen ? '▴' : '▾'} ${_copilotHistory.length} turns</button>` : ''}
        </div>
        ${(_copilotLogOpen && _copilotHistory.length > 1) ? `<div class="copilot-banner-log">${logRows}</div>` : ''}
        ${cameraHeld ? `
            <div class="copilot-camera-held">
                <span class="copilot-camera-held-badge">Camera held</span>
                <span>Same regions in frame — refiltering inside the current view doesn't move the map.</span>
            </div>
        ` : ''}
    `;
    el.classList.remove('hidden');
}

// ============================================================
// Presets (saved views)
// ============================================================
const DEFAULT_PRESETS = [
    {
        id: 'rollup',
        name: 'Roll-up screen',
        sub: 'Composite ≥70 · Indep · Corp <30%',
        apply: () => {
            resetFiltersQuiet();
            setMapView('composite'); saveLensState('composite');
            document.querySelector('.archetype-chip[data-dim="ownership"][value="Independent"]').checked = true;
            State.archetypeFilter.ownership = ['Independent'];
            applyArchetypeFilter();
        }
    },
    {
        id: 'greenfield',
        name: 'Greenfield',
        sub: 'Whitespace ≥75',
        apply: () => {
            resetFiltersQuiet();
            setMapView('whitespace'); saveLensState('whitespace');
        }
    },
    {
        id: 'workforce',
        name: 'Workforce-stressed',
        sub: 'Risk ≥60 · DPA flagged',
        apply: () => {
            resetFiltersQuiet();
            setMapView('workforce'); saveLensState('workforce');
            document.getElementById('dpa-bonded').checked = true;
            State.dpaFilter.bonded = true;
            document.getElementById('workforce-risk-slider').value = 60;
            document.getElementById('workforce-risk-readout').textContent = '60';
            State.workforceRiskMin = 60;
            applyWorkforceFilters();
        }
    }
];

function resetFiltersQuiet() {
    document.getElementById('state-filter').value = '';
    State.currentState = '';
    document.querySelectorAll('.seifa-chip,.mmm-chip,.archetype-chip,.clinic-data-filter').forEach(c => c.checked = false);
    State.seifaDeciles = []; State.mmmFilter = [];
    State.archetypeFilter = { format: [], billing: [], ownership: [] };
    State.dataAvailabilityFilter = { has_website: false, has_gp_data: false };
    document.getElementById('dpa-bonded').checked = false;
    document.getElementById('dpa-gp-img').checked = false;
    State.dpaFilter = { bonded: false, gpImg: false };
    document.getElementById('workforce-risk-slider').value = 0;
    document.getElementById('workforce-risk-readout').textContent = '0';
    State.workforceRiskMin = 0;
    const resetBtn = document.getElementById('archetype-reset');
    if (resetBtn) resetBtn.style.display = 'none';
}

function initPresets() {
    const container = document.getElementById('preset-cards');
    if (!container) return;

    const customPresets = JSON.parse(localStorage.getItem('fh.presets.custom') || '[]');
    let allPresets = [...DEFAULT_PRESETS, ...customPresets];

    // For physio: exclude Workforce-stressed and Roll-up presets (no workforce data available)
    if (State.markets.current === 'physio') {
        allPresets = allPresets.filter(p => p.id !== 'workforce' && p.id !== 'rollup');
    }

    container.innerHTML = allPresets.map(p => `
        <div class="preset-card" id="preset-${p.id}" onclick="applyPreset('${p.id}')">
            <div class="preset-name">${p.name}</div>
            <div class="preset-sub">${p.sub}</div>
        </div>
    `).join('');

    const saved = localStorage.getItem('fh.preset.active');
    if (saved) document.getElementById('preset-' + saved)?.classList.add('active');

    // New preset button
    document.getElementById('preset-new-btn')?.addEventListener('click', () => {
        const name = prompt('Saved view name:');
        if (!name) return;
        const sub = [
            State.currentState || '',
            State.mmmFilter.length ? `MMM:${State.mmmFilter.join(',')}` : '',
            State.archetypeFilter.ownership.length ? `Own:${State.archetypeFilter.ownership.join(',')}` : '',
        ].filter(Boolean).join(' · ') || State.currentMapView;
        const id = 'custom-' + Date.now();
        const customs = JSON.parse(localStorage.getItem('fh.presets.custom') || '[]');
        customs.push({ id, name, sub, apply: null });
        localStorage.setItem('fh.presets.custom', JSON.stringify(customs));
        initPresets();
    });
}

function applyPreset(id) {
    const preset = DEFAULT_PRESETS.find(p => p.id === id);
    if (preset && preset.apply) {
        preset.apply();
        updateRailStats();
        updateFilterChips();
    }
    document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
    document.getElementById('preset-' + id)?.classList.add('active');
    localStorage.setItem('fh.preset.active', id);
}

function deactivatePreset() {
    document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
    localStorage.removeItem('fh.preset.active');
}

// ============================================================
// Search navigation helpers
// ============================================================
function searchGotoSA3(sa3Code) {
    document.getElementById('global-search-results').innerHTML = '';
    document.getElementById('global-search-input').value = '';
    const feature = State.sa3Data?.features.find(f => f.properties.SA3Code === sa3Code);
    if (feature && map) {
        const bbox = turf.bbox(feature);
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, duration: 600 });
        setTimeout(() => openDrawerForSA3(sa3Code), 700);
    }
}

function searchGotoClinic(clinicId) {
    document.getElementById('global-search-results').innerHTML = '';
    document.getElementById('global-search-input').value = '';
    const clinic = State.clinicsData.find(c => String(c.clinic_id) === String(clinicId));
    if (clinic && map) {
        map.flyTo({ center: [parseFloat(clinic.longitude), parseFloat(clinic.latitude)], zoom: 13, duration: 600 });
        renderClinicDrawer(clinic);
        document.getElementById('detail-drawer').classList.add('active');
        if (isMobile()) showBackdrop();
    }
}

function searchActivateChain(chainName) {
    document.getElementById('global-search-results').innerHTML = '';
    document.getElementById('global-search-input').value = '';
    if (!State.clinicChainFilter.includes(chainName)) {
        State.clinicChainFilter.push(chainName);
        const checkbox = document.querySelector(`.clinic-chain-checkbox[data-chain="${chainName}"]`);
        if (checkbox) { checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true })); }
    }
}

function openDrawerForSA3(sa3Code) {
    const feature = State.sa3Data?.features.find(f => f.properties.SA3Code === sa3Code);
    if (feature) {
        State.currentSA3Code = sa3Code;
        renderDrawer(feature.properties);
        document.getElementById('detail-drawer')?.classList.add('active');
        if (isMobile()) {
            const rail = document.getElementById('map-rail');
            if (rail) {
                rail.classList.remove('open', 'snap-full', 'snap-expanded');
                rail.classList.add('snap-hidden');
                rail.style.transform = '';
                rail.style.display   = 'none';
            }
        }
    }
}

window.closeDrawer = closeDrawer;
window.toggleAccordion = toggleAccordion;
window.applyPreset = applyPreset;
window.removeFilterChip = removeFilterChip;
window.searchGotoSA3 = searchGotoSA3;
window.searchGotoClinic = searchGotoClinic;
window.searchActivateChain = searchActivateChain;

// ============================================================
// Auth UI Wiring
// ============================================================
// Auth event wiring and status check are handled by HTML inline scripts
// checkAuthStatus() is called from HTML DOMContentLoaded listener

/* ============================================================
 * MOBILE HANDOFF wiring
 * Spec: ~/Downloads/mobile-handoff.md
 *
 * Mobile UI is purely additive. New .mob-* elements live alongside
 * the desktop .lens-seg / .map-rail / etc. We share class names where
 * possible (so existing click handlers fire automatically) and add
 * a tiny script here for the bits that need explicit wiring:
 *   1. Sync `.active` class across desktop + mobile lens chips
 *   2. Mirror updateRailStats() values into .mob-kpi-value cells
 *   3. NRA picker show/hide (action-sheet style)
 *   4. ⋯ overflow menu show/hide
 *   5. Bottom-sheet snap (peek ↔ expanded ↔ full)
 * ============================================================ */
// ============================================================
// Isochrone Visualization & Comparison
// ============================================================

function loadAndShowIsochroneFromDrawer(clinicId) {
    const clinic = State.clinicsData.find(c => c.clinic_id === clinicId);
    if (!clinic) return;
    loadAndShowIsochrone(clinic);
}

async function loadAndShowIsochrone(clinic) {
    try {
        // Use current market from State
        const market = State.markets.current || 'gp';
        console.log('[loadAndShowIsochrone] Loading for clinic:', clinic.clinic_name, 'market:', market);
        const iso = await fetchClinicIsochroneGeojson(market, clinic.clinic_id);

        if (iso) {
            console.log('[loadAndShowIsochrone] Isochrone loaded successfully, features:', iso.features?.length);
        } else {
            console.warn(`[loadAndShowIsochrone] Isochrone not available for ${clinic.clinic_name} (${clinic.clinic_id}) in ${market} market`);
        }

        // Check if we already have a comparison clinic
        console.log('[loadAndShowIsochrone] Before state update - selectedClinics.length:', State.selectedClinics.length);
        if (State.selectedClinics.length === 0) {
            console.log('[loadAndShowIsochrone] Setting up SINGLE clinic selection');
            State.activeClinicId = clinic.clinic_id;
            State.activeClinicIsochrone = iso;
            State.selectedClinics = [clinic];
            console.log('[loadAndShowIsochrone] After state update - selectedClinics:', State.selectedClinics.map(c => c.clinic_name));
            if (iso) {
                State.comparisonIsochrones[clinic.clinic_id] = iso;
                console.log('[loadAndShowIsochrone] Calling renderActiveClinicIsochrone');
                renderActiveClinicIsochrone(clinic, iso);
                addMarkerLayersOnTop(clinic);
                console.log('[loadAndShowIsochrone] Calling renderCatchmentAnalyticsPanel for single');
                renderCatchmentAnalyticsPanel();
                showToast('Clinic selected — click a second clinic on the map to compare');
            } else {
                renderCatchmentAnalyticsPanel();
                showToast('Clinic selected (catchment data not available for this market)');
            }
        } else if (State.selectedClinics.length === 1) {
            console.log('[loadAndShowIsochrone] Setting up COMPARISON (2nd clinic)');
            // Store first clinic's data in comparison isochrones before overwriting activeClinicIsochrone
            const firstClinic = State.selectedClinics[0];
            if (State.activeClinicIsochrone) {
                State.comparisonIsochrones[firstClinic.clinic_id] = State.activeClinicIsochrone;
            }

            // Now update for second clinic
            State.activeClinicId = clinic.clinic_id;
            State.activeClinicIsochrone = iso;
            State.selectedClinics.push(clinic);
            if (iso) {
                State.comparisonIsochrones[clinic.clinic_id] = iso;
                renderComparisonIsochrones();
            }
            renderCatchmentAnalyticsPanel();
        }
    } catch (e) {
        console.error('Error loading isochrone:', e);
        showToast(`Catchment data unavailable: ${e.message}`);
    }
}

function renderActiveClinicIsochrone(clinic, iso) {
    try {
        console.log('renderActiveClinicIsochrone called for:', clinic.clinic_name, 'ISO data:', iso);

        // Remove iso2 layers if they exist (from previous comparison)
        ['iso2-fill', 'iso2-outline', 'iso2-label-bg', 'iso2-label'].forEach(id => {
            if (map.getLayer(id)) map.removeLayer(id);
            if (map.getSource(id)) map.removeSource(id);
        });

        if (map.getLayer('iso1-fill')) map.removeLayer('iso1-fill');
        if (map.getLayer('iso1-outline')) map.removeLayer('iso1-outline');
        if (map.getSource('iso1')) map.removeSource('iso1');

        map.addSource('iso1', { type: 'geojson', data: iso });
        console.log('iso1 source added');

        // Find a reference layer to add isochrone before (prefer a clinic layer)
        const refLayer = map.getStyle().layers.find(l => l.id.startsWith('clinics')) ||
                         map.getStyle().layers.find(l => l.id.startsWith('sa3')) ||
                         undefined;

        console.log('Available layers:', map.getStyle().layers.map(l => l.id).slice(0, 10));
        console.log('Reference layer for insertion:', refLayer?.id);

        // Verify source data
        const sourceData = map.getSource('iso1')._data;
        console.log('Source data features:', sourceData?.features?.length);
        if (sourceData?.features?.[0]?.geometry) {
            console.log('First feature geometry type:', sourceData.features[0].geometry.type);
            console.log('Coordinate count:', sourceData.features[0].geometry.coordinates[0]?.length);
        }

        // Fill layer
        map.addLayer({
            id: 'iso1-fill',
            type: 'fill',
            source: 'iso1',
            paint: {
                'fill-color': '#9B7ABA',
                'fill-opacity': 0.25
            }
        }, refLayer?.id);
        console.log('iso1-fill layer added');

        // Outline layer
        map.addLayer({
            id: 'iso1-outline',
            type: 'line',
            source: 'iso1',
            paint: {
                'line-color': '#7C3AED',
                'line-width': 2
            }
        });
        console.log('iso1-outline layer added');

        // Clinic name label background
        const labelBbox = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [parseFloat(clinic.longitude), parseFloat(clinic.latitude)] },
            properties: { name: clinic.clinic_name || 'Clinic' }
        };

        map.addSource('iso1-label', { type: 'geojson', data: { type: 'FeatureCollection', features: [labelBbox] } });

        map.addLayer({
            id: 'iso1-label-bg',
            type: 'symbol',
            source: 'iso1-label',
            layout: {
                'text-field': ['get', 'name'],
                'text-size': 12,
                'text-offset': [0, -1.8],
                'text-anchor': 'bottom',
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
            },
            paint: {
                'text-color': '#FFFFFF',
                'text-halo-color': '#465E4D',
                'text-halo-width': 3,
                'text-halo-blur': 1
            }
        });

        map.addLayer({
            id: 'iso1-label',
            type: 'symbol',
            source: 'iso1-label',
            layout: {
                'text-field': ['get', 'name'],
                'text-size': 12,
                'text-offset': [0, -1.8],
                'text-anchor': 'bottom',
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
            },
            paint: {
                'text-color': '#FFFFFF'
            }
        });

        // Zoom map to isochrone bounds
        const bbox = turf.bbox(iso);
        console.log('Isochrone bbox:', bbox);
        const padding = { top: 100, bottom: 100, left: 100, right: 100 };
        map.fitBounds(bbox, { padding, duration: 800, maxZoom: 13 });
        console.log('Map zoomed to isochrone');
    } catch(e) {
        console.warn('Error rendering isochrone:', e);
    }
}

function renderComparisonIsochrones() {
    try {
        if (State.selectedClinics.length < 2) return;

        const clinic1 = State.selectedClinics[0];
        const clinic2 = State.selectedClinics[1];
        const iso1 = State.comparisonIsochrones[clinic1.clinic_id];
        const iso2 = State.comparisonIsochrones[clinic2.clinic_id];

        if (!iso1 || !iso2) return;

        clearAllIsochroneLayers();

        map.addSource('iso1', { type: 'geojson', data: iso1 });
        map.addSource('iso2', { type: 'geojson', data: iso2 });

        // Clinic 1 - purple
        map.addLayer({
            id: 'iso1-fill',
            type: 'fill',
            source: 'iso1',
            paint: { 'fill-color': '#9B7ABA', 'fill-opacity': 0.25 }
        });

        map.addLayer({
            id: 'iso1-outline',
            type: 'line',
            source: 'iso1',
            paint: { 'line-color': '#7C3AED', 'line-width': 2 }
        });

        // Clinic 2 - orange
        map.addLayer({
            id: 'iso2-fill',
            type: 'fill',
            source: 'iso2',
            paint: { 'fill-color': '#FFB366', 'fill-opacity': 0.25 }
        });

        map.addLayer({
            id: 'iso2-outline',
            type: 'line',
            source: 'iso2',
            paint: { 'line-color': '#FF8C00', 'line-width': 2 }
        });

        // Labels
        const label1 = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [parseFloat(clinic1.longitude), parseFloat(clinic1.latitude)] },
            properties: { name: clinic1.clinic_name || 'Clinic 1' }
        };

        const label2 = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [parseFloat(clinic2.longitude), parseFloat(clinic2.latitude)] },
            properties: { name: clinic2.clinic_name || 'Clinic 2' }
        };

        map.addSource('iso1-label', { type: 'geojson', data: { type: 'FeatureCollection', features: [label1] } });
        map.addSource('iso2-label', { type: 'geojson', data: { type: 'FeatureCollection', features: [label2] } });

        [1, 2].forEach(i => {
            map.addLayer({
                id: `iso${i}-label-bg`,
                type: 'symbol',
                source: `iso${i}-label`,
                layout: {
                    'text-field': ['get', 'name'],
                    'text-size': 12,
                    'text-offset': [0, -1.8],
                    'text-anchor': 'bottom',
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
                },
                paint: {
                    'text-color': '#FFFFFF',
                    'text-halo-color': '#465E4D',
                    'text-halo-width': 3,
                    'text-halo-blur': 1
                }
            });

            map.addLayer({
                id: `iso${i}-label`,
                type: 'symbol',
                source: `iso${i}-label`,
                layout: {
                    'text-field': ['get', 'name'],
                    'text-size': 12,
                    'text-offset': [0, -1.8],
                    'text-anchor': 'bottom',
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
                },
                paint: { 'text-color': '#FFFFFF' }
            });
        });

        // Add markers for both clinics in comparison
        addComparisonMarkers(clinic1, clinic2);
    } catch(e) {
        console.warn('Error rendering comparison:', e);
    }
}

function addComparisonMarkers(clinic1, clinic2) {
    try {
        // Remove old marker layers if any
        ['activeClinicMarkerHalo', 'activeClinicMarkerPin', 'clinic2MarkerHalo', 'clinic2MarkerPin'].forEach(id => {
            if (map.getLayer(id)) map.removeLayer(id);
        });

        // Clinic 1 marker
        const point1 = turf.point(
            [parseFloat(clinic1.longitude), parseFloat(clinic1.latitude)],
            { label: clinic1.clinic_name || 'Clinic 1' }
        );

        const markerSource1 = map.getSource('activeClinicMarker');
        if (markerSource1) {
            markerSource1.setData(turf.featureCollection([point1]));
        }

        map.addLayer({
            id: 'activeClinicMarkerHalo',
            type: 'circle',
            source: 'activeClinicMarker',
            paint: {
                'circle-radius': 9,
                'circle-color': '#D32F2F',
                'circle-opacity': 1,
                'circle-stroke-width': 0
            }
        });

        map.addLayer({
            id: 'activeClinicMarkerPin',
            type: 'circle',
            source: 'activeClinicMarker',
            paint: {
                'circle-radius': 4,
                'circle-color': '#ffffff',
                'circle-stroke-color': '#D32F2F',
                'circle-stroke-width': 1
            }
        });

        // Clinic 2 marker - use clinic2MarkerSource
        if (!map.getSource('clinic2MarkerSource')) {
            map.addSource('clinic2MarkerSource', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }

        const point2 = turf.point(
            [parseFloat(clinic2.longitude), parseFloat(clinic2.latitude)],
            { label: clinic2.clinic_name || 'Clinic 2' }
        );

        map.getSource('clinic2MarkerSource').setData(turf.featureCollection([point2]));

        map.addLayer({
            id: 'clinic2MarkerHalo',
            type: 'circle',
            source: 'clinic2MarkerSource',
            paint: {
                'circle-radius': 9,
                'circle-color': '#D32F2F',
                'circle-opacity': 1,
                'circle-stroke-width': 0
            }
        });

        map.addLayer({
            id: 'clinic2MarkerPin',
            type: 'circle',
            source: 'clinic2MarkerSource',
            paint: {
                'circle-radius': 4,
                'circle-color': '#ffffff',
                'circle-stroke-color': '#D32F2F',
                'circle-stroke-width': 1
            }
        });
    } catch(e) {
        console.warn('Error adding comparison markers:', e);
    }
}

function clearAllIsochroneLayers() {
    ['iso1-fill', 'iso1-outline', 'iso1-label', 'iso1-label-bg', 'iso2-fill', 'iso2-outline', 'iso2-label', 'iso2-label-bg', 'activeClinicMarkerHalo', 'activeClinicMarkerPin'].forEach(id => {
        try {
            if (map.getLayer(id)) map.removeLayer(id);
        } catch(e) {}
    });

    ['iso1', 'iso2', 'iso1-label', 'iso2-label'].forEach(id => {
        try {
            if (map.getSource(id)) map.removeSource(id);
        } catch(e) {}
    });
}

function addMarkerLayersOnTop(clinic) {
    try {
        if (map.getLayer('activeClinicMarkerHalo')) map.removeLayer('activeClinicMarkerHalo');
        if (map.getLayer('activeClinicMarkerPin')) map.removeLayer('activeClinicMarkerPin');

        const point = turf.point(
            [parseFloat(clinic.longitude), parseFloat(clinic.latitude)],
            { label: clinic.clinic_name || 'Clinic' }
        );

        const markerSource = map.getSource('activeClinicMarker');
        if (markerSource) {
            markerSource.setData(turf.featureCollection([point]));
        }

        // Red marker with white center
        map.addLayer({
            id: 'activeClinicMarkerHalo',
            type: 'circle',
            source: 'activeClinicMarker',
            paint: {
                'circle-radius': 9,
                'circle-color': '#D32F2F',
                'circle-opacity': 1,
                'circle-stroke-width': 0
            }
        });

        // White center dot
        map.addLayer({
            id: 'activeClinicMarkerPin',
            type: 'circle',
            source: 'activeClinicMarker',
            paint: {
                'circle-radius': 4,
                'circle-color': '#ffffff',
                'circle-stroke-color': '#D32F2F',
                'circle-stroke-width': 1
            }
        });
    } catch(e) {
        console.warn('Error adding marker layers:', e);
    }
}

function computeOverlapPercent(iso1, iso2) {
    try {
        console.log('Computing overlap:', {
            iso1Valid: iso1?.features?.length > 0,
            iso2Valid: iso2?.features?.length > 0,
            iso1Type: iso1?.type,
            iso2Type: iso2?.type
        });

        const feat1 = iso1.features ? iso1.features[0] : iso1;
        const feat2 = iso2.features ? iso2.features[0] : iso2;

        const area1 = turf.area(feat1) / 1000000;
        const area2 = turf.area(feat2) / 1000000;
        console.log('Isochrone areas:', { area1, area2 });

        const intersection = turf.intersect(feat1, feat2);
        console.log('Intersection result:', intersection);

        if (intersection && intersection.geometry) {
            const areaIntersection = turf.area(intersection) / 1000000;
            const pct = (areaIntersection / area1) * 100;
            console.log('Overlap %:', pct.toFixed(1));
            return pct > 0 ? pct.toFixed(1) : '—';
        }

        const union = turf.union(feat1, feat2);
        console.log('Union result:', union);

        if (union) {
            const areaUnion = turf.area(union) / 1000000;
            const overlap = area1 + area2 - areaUnion;
            console.log('Overlap % (via union):', ((overlap / area1) * 100).toFixed(1));
            return overlap > 0 ? ((overlap / area1) * 100).toFixed(1) : '—';
        }

        console.log('No intersection or union found, returning —');
        return '—';
    } catch(e) {
        console.error('Overlap calculation failed:', e);
        return '—';
    }
}

function computeCatchmentAnalytics(isochrone) {
    try {
        let clinicCount = 0;
        let gpCount = 0;
        let clinicsWithGpCount = 0;
        let population = 0;

        console.log('computeCatchmentAnalytics called');

        if (!isochrone || !isochrone.features || isochrone.features.length === 0) {
            console.warn('Missing isochrone data');
            return { clinicCount: 0, gpCount: 0, clinicsWithGpCount: 0, population: 0 };
        }

        const isoFeature = isochrone.features[0];

        // Check which clinics fall within the isochrone
        if (State.clinicsData) {
            console.log('Checking clinics against isochrone');
            State.clinicsData.forEach(clinic => {
                try {
                    const point = turf.point([parseFloat(clinic.longitude), parseFloat(clinic.latitude)]);
                    if (turf.booleanPointInPolygon(point, isoFeature)) {
                        clinicCount++;
                        const gps = parseInt(clinic.gp_count) || 0;
                        if (gps > 0) {
                            clinicsWithGpCount++;
                            gpCount += gps;
                        }
                    }
                } catch(e) {
                    console.warn('Error checking clinic:', clinic.clinic_name, e);
                }
            });
            console.log('Found clinics in catchment:', clinicCount, 'with GPs:', clinicsWithGpCount, 'total GPs:', gpCount);
        }

        // Aggregate population from SA1 centroids pre-loaded at startup (sa1_centroids_pop.csv)
        if (State.sa1CentroidData) {
            for (const row of State.sa1CentroidData) {
                try {
                    const pt = turf.point([row.lon, row.lat]);
                    if (turf.booleanPointInPolygon(pt, isoFeature)) {
                        population += row.population || 0;
                    }
                } catch(e) { /* skip malformed row */ }
            }
            console.log('Catchment population from SA1 centroids:', population);
        }

        console.log('Catchment Analytics Results:', {
            clinicCount,
            clinicsWithGpCount,
            gpCount,
            population
        });

        return { clinicCount, clinicsWithGpCount, gpCount, population };
    } catch(e) {
        console.error('Catchment analytics calculation failed:', e);
        return { clinicCount: 0, clinicsWithGpCount: 0, gpCount: 0, population: 0 };
    }
}

function computeSA1PopulationAggregate(isochrone) {
    try {
        let totalPopulation = 0;
        let sa1Count = 0;

        // Find SA1s that intersect with isochrone
        // For now, return estimate based on clinic SA1s within catchment
        if (State.clinicsData && isochrone) {
            const sa1PopulationMap = {};

            State.clinicsData.forEach(clinic => {
                try {
                    const point = turf.point([parseFloat(clinic.longitude), parseFloat(clinic.latitude)]);
                    if (turf.booleanPointInPolygon(point, isochrone)) {
                        const sa1_code = clinic.sa1_code;
                        if (sa1_code && !sa1PopulationMap[sa1_code]) {
                            sa1PopulationMap[sa1_code] = true;
                            sa1Count++;
                        }
                    }
                } catch(e) {}
            });

            // Load population data for these SA1s
            // This would require loading the Census CSV data
            // For now, return a placeholder that can be enhanced later
        }

        return { totalPopulation, sa1Count };
    } catch(e) {
        console.warn('SA1 population calculation failed:', e);
        return { totalPopulation: 0, sa1Count: 0 };
    }
}

// ============================================================
// Helper: Find SA3 for a clinic location
// ============================================================
function findClinicSA3(clinic) {
    if (!State.sa3Data || !clinic.longitude || !clinic.latitude) return null;
    const point = turf.point([clinic.longitude, clinic.latitude]);
    for (const feature of State.sa3Data.features) {
        try {
            if (turf.booleanPointInPolygon(point, feature)) {
                return feature;
            }
        } catch(e) {}
    }
    return null;
}

// ============================================================
// Helper: Calculate residents per GP (DEPRECATED - use calculateResidentsPerClinic)
// ============================================================
function calculateResidentsPerGP(population, gpCount) {
    if (!population || !gpCount || gpCount === 0) return null;
    return Math.round(population / gpCount);
}

// ============================================================
// Helper: Calculate residents per clinic
// ============================================================
function calculateResidentsPerClinic(population, clinicCount) {
    if (!population || !clinicCount || clinicCount === 0) return null;
    return Math.round(population / clinicCount);
}

// ============================================================
// Helper: Calculate GP FTE (0.75 × GP count)
// ============================================================
function calculateGpFte(gpCount) {
    if (!gpCount || gpCount === 0) return null;
    return parseFloat((gpCount * 0.75).toFixed(2));
}

// ============================================================
// Helper: Calculate nearest rival distance in catchment
// ============================================================
function calculateNearestRivalDistance(clinic, isochrone) {
    if (!State.clinicsData || !isochrone || !clinic.longitude || !clinic.latitude) return null;

    // Extract the feature from the FeatureCollection
    const isoFeature = isochrone.features && isochrone.features.length > 0 ? isochrone.features[0] : null;
    if (!isoFeature) return null;

    const clinicPoint = turf.point([parseFloat(clinic.longitude), parseFloat(clinic.latitude)]);
    let minDistance = Infinity;

    State.clinicsData.forEach(otherClinic => {
        if (otherClinic.clinic_id === clinic.clinic_id) return; // Skip self

        try {
            const otherPoint = turf.point([parseFloat(otherClinic.longitude), parseFloat(otherClinic.latitude)]);
            if (turf.booleanPointInPolygon(otherPoint, isoFeature)) {
                const distance = turf.distance(clinicPoint, otherPoint, { units: 'kilometers' });
                minDistance = Math.min(minDistance, distance);
            }
        } catch(e) {}
    });

    return minDistance === Infinity ? null : minDistance.toFixed(1);
}

// ============================================================
// Helper: Get clinic archetype
// ============================================================
function getClinicArchetype(clinic) {
    return {
        format: clinic.clinic_format || 'Unknown',
        billing: clinic['Billing Type'] || 'Unknown',
        ownership: clinic.ownership || 'Independent'
    };
}

// ============================================================
// Helper: Compute score for a clinic (based on SA3 + catchment)
// ============================================================
function computeClinicScore(clinic, sa3Feature, isochrone) {
    // Start with SA3 score as baseline, could enhance with isochrone data
    const baseScore = parseFloat(sa3Feature?.properties?.Composite_Score) || 50;
    return Math.round(baseScore);
}

// ============================================================
// Helper: Get tier for score
// ============================================================
function getTierForScore(score) {
    if (score >= 70) return { tier: 1, label: 'Tier 1 · Exceptional', color: '#465E4D' };
    if (score >= 60) return { tier: 2, label: 'Tier 2 · Strong', color: '#6E9277' };
    if (score >= 50) return { tier: 3, label: 'Tier 3 · Moderate', color: '#97C777' };
    if (score >= 40) return { tier: 4, label: 'Tier 4 · Weak', color: '#FFC000' };
    return { tier: 5, label: 'Tier 5 · Poor', color: '#C00000' };
}

// ============================================================
// Acquisition read — clinic-level heuristic "AI read"
//
// Deterministic, rule-based scorer (no LLM backend exists in this app).
// Mirrors the visual/interaction language of the imported Claude Design
// mockup ("Clinic Acquisition Read.dc.html") but every rating/number here
// is computed from real fields already on the clinic/SA3/catchment,
// never invented. See plan Phase 5 for rationale.
// ============================================================
const RD_RATING_STYLE = {
    High:    { bg: '#C5E0B3', fg: '#2F4636' },
    Med:     { bg: '#FFF2CC', fg: '#8A6500' },
    Low:     { bg: '#FCE4E4', fg: '#A81111' },
    Unrated: { bg: '#F1F1EE', fg: '#5A5A55' }
};

function computeAcquisitionRead(clinic, archetype, tierInfo, analytics, clinicsPerKm, nationalAvgDensity, sa3Counts) {
    const market = State.markets.current;
    const missing = [];
    const dim = (name, rating, why, field) => ({ name, rating, ...RD_RATING_STYLE[rating], why, field });

    // Deliverability — ownership structure
    let deliverability;
    if (!clinic.ownership) {
        missing.push('ownership');
        deliverability = dim('Deliverability', 'Unrated', 'Ownership not classified — cannot rule out a corporate parent or multi-site carve-out.', 'ownership=null');
    } else if (clinic.ownership === 'Independent') {
        deliverability = dim('Deliverability', 'High', 'Independent ownership, single site — no corporate carve-out complexity.', 'ownership=Independent');
    } else if (clinic.ownership === 'Corporate') {
        deliverability = dim('Deliverability', 'Low', 'Corporate-owned — likely requires a carve-out from a parent group, adding deal complexity.', 'ownership=Corporate');
    } else {
        deliverability = dim('Deliverability', 'Med', `Ownership recorded as ${clinic.ownership} — carve-out complexity not fully known.`, `ownership=${clinic.ownership}`);
    }

    // Asset quality — scale proxy (GP headcount for GP market, format elsewhere)
    let assetQuality;
    if (market === 'gp') {
        const gpCount = clinic.gp_count != null && clinic.gp_count !== '' ? parseFloat(clinic.gp_count) : null;
        if (gpCount == null || isNaN(gpCount)) {
            missing.push('gp_count');
            assetQuality = dim('Asset quality', 'Unrated', 'No GP headcount on file. Nothing to size the asset against.', 'gp_count=null');
        } else if (gpCount >= 8) {
            assetQuality = dim('Asset quality', 'High', `${archetype.format} format, ${gpCount} GPs identified (est. ${(gpCount * 0.75).toFixed(1)} FTE) — genuinely large for this market.`, `gp_count=${gpCount}`);
        } else if (gpCount >= 4) {
            assetQuality = dim('Asset quality', 'Med', `${gpCount} GPs identified (est. ${(gpCount * 0.75).toFixed(1)} FTE) — mid-sized for this market.`, `gp_count=${gpCount}`);
        } else {
            assetQuality = dim('Asset quality', 'Low', `Only ${gpCount} GP${gpCount === 1 ? '' : 's'} identified — below scale for a platform anchor.`, `gp_count=${gpCount}`);
        }
    } else {
        const fmt = clinic.clinic_format;
        if (!fmt || fmt === 'Unknown' || fmt === 'Unclassified') {
            missing.push('format');
            assetQuality = dim('Asset quality', 'Unrated', 'Format not classified. Nothing to size the asset against.', 'clinic_format=null');
        } else if (fmt === 'Big-box') {
            assetQuality = dim('Asset quality', 'High', 'Big-box format — the largest scale bracket tracked for this market.', `clinic_format=${fmt}`);
        } else if (fmt === 'Mid-format') {
            assetQuality = dim('Asset quality', 'Med', 'Mid-format site — moderate scale.', `clinic_format=${fmt}`);
        } else {
            assetQuality = dim('Asset quality', 'Low', `${fmt} format — below scale for a platform anchor.`, `clinic_format=${fmt}`);
        }
    }

    // Platform potential — regional (SA3) composite/tier
    let platformPotential;
    if (tierInfo.tier <= 2) {
        platformPotential = dim('Platform potential', 'High', `Sits in a ${tierInfo.label} region on Foundry's base-case composite.`, `tier=${tierInfo.tier}`);
    } else if (tierInfo.tier === 3) {
        platformPotential = dim('Platform potential', 'Med', `${tierInfo.label} region — moderate composite fundamentals.`, `tier=${tierInfo.tier}`);
    } else {
        platformPotential = dim('Platform potential', 'Low', `Sits in a ${tierInfo.label} region on Foundry's base-case composite.`, `tier=${tierInfo.tier}`);
    }

    // Strategic fit — competitive density vs national average
    let strategicFit;
    const densityRatio = (nationalAvgDensity > 0 && isFinite(clinicsPerKm)) ? clinicsPerKm / nationalAvgDensity : null;
    if (densityRatio == null) {
        missing.push('catchment density');
        strategicFit = dim('Strategic fit', 'Unrated', 'Catchment density unavailable.', 'comp_density=null');
    } else if (densityRatio < 1.5) {
        strategicFit = dim('Strategic fit', 'High', `Catchment density ${clinicsPerKm.toFixed(2)} clinics/km² — near or below the ${nationalAvgDensity.toFixed(2)} national average, open field.`, `comp_density=${clinicsPerKm.toFixed(2)}`);
    } else if (densityRatio < 4) {
        strategicFit = dim('Strategic fit', 'Med', `Catchment density ${clinicsPerKm.toFixed(2)} clinics/km² — roughly ${densityRatio.toFixed(1)}× national average, competitive but workable.`, `comp_density=${clinicsPerKm.toFixed(2)}`);
    } else {
        strategicFit = dim('Strategic fit', 'Low', `Catchment density ${clinicsPerKm.toFixed(2)} clinics/km² — ${densityRatio.toFixed(1)}× national average across ${analytics.clinicCount} clinics within the drive-time, heavily saturated.`, `comp_density=${clinicsPerKm.toFixed(2)}`);
    }

    const dims = [deliverability, assetQuality, platformPotential, strategicFit];
    const ratings = dims.map(d => d.rating);
    const highCount = ratings.filter(r => r === 'High').length;
    const lowCount = ratings.filter(r => r === 'Low').length;
    const unratedCount = ratings.filter(r => r === 'Unrated').length;

    // A single Unrated dimension is enough to withhold full confidence — never
    // claim "Attractive platform anchor" (implies every dimension checked out)
    // when one of the four is genuinely unknown, not just unfavourable.
    let verdict, verdictDot;
    if (unratedCount >= 2) {
        verdict = 'Provisional · enrich to rate'; verdictDot = '#BFBFBF';
    } else if (lowCount >= 3) {
        verdict = 'Pass'; verdictDot = '#C00000';
    } else if (unratedCount === 1) {
        verdict = 'Opportunistic bolt-on only'; verdictDot = '#E0A800';
    } else if (highCount === 4) {
        verdict = 'Attractive platform anchor'; verdictDot = '#6E9277';
    } else if (deliverability.rating === 'High' && assetQuality.rating === 'High' && (platformPotential.rating === 'Low' || strategicFit.rating === 'Low')) {
        verdict = 'Opportunistic bolt-on only'; verdictDot = '#E0A800';
    } else if (highCount >= 2 && lowCount === 0) {
        verdict = 'Attractive platform anchor'; verdictDot = '#6E9277';
    } else {
        verdict = 'Opportunistic bolt-on only'; verdictDot = '#E0A800';
    }
    const verdictStyle = {
        'Attractive platform anchor': { bg: '#E8EFE9', fg: '#2F4636' },
        'Opportunistic bolt-on only': { bg: '#FFF2CC', fg: '#8A6500' },
        'Pass': { bg: '#FCE4E4', fg: '#A81111' },
        'Provisional · enrich to rate': { bg: '#F1F1EE', fg: '#5A5A55' }
    }[verdict];

    const narrative = [
        { tone: deliverability.rating === 'Low' ? 'warn' : 'normal', strong: 'Deliverability & scale.', text: `${deliverability.why} ${assetQuality.why}` },
        { tone: (platformPotential.rating === 'Low' || strategicFit.rating === 'Low') ? 'warn' : 'normal', strong: 'Regional & competitive backdrop.', text: `${platformPotential.why} ${strategicFit.why}` }
    ];
    const recText = {
        'Attractive platform anchor': 'Progress to outreach. This site clears the majority of Foundry’s standing criteria.',
        'Opportunistic bolt-on only': 'Opportunistic bolt-on. Progress only if priced for the regional/competitive backdrop and paired with a stronger anchor elsewhere.',
        'Pass': 'Pass. Multiple dimensions are unfavourable with no offsetting asset quality.',
        'Provisional · enrich to rate': 'Enrich before screening. Missing fields prevent a confident verdict; no recommendation is offered until they’re filled in.'
    }[verdict];
    narrative.push({ tone: verdict === 'Attractive platform anchor' ? 'good' : (verdict === 'Provisional · enrich to rate' ? 'normal' : 'warn'), strong: 'Recommendation.', text: recText });

    if (!clinic['Billing Type'] || archetype.billing === 'Unknown') missing.push('billing model');
    const totalTracked = market === 'gp' ? 5 : 4; // ownership, scale field, density, tier(always known) [+billing for gp]
    const FIELD_LABELS = { ownership: 'Ownership', gp_count: 'GP headcount', format: 'Format', 'catchment density': 'Catchment density', 'billing model': 'Billing model' };
    const caveat = missing.length > 0
        ? `${missing.map(f => FIELD_LABELS[f] || f).join(', ')} unclassified for this site. ${missing.length >= 2 ? 'This read rests substantially on regional and catchment data — treat it as a screen, not an assessment.' : 'Confirm before underwriting.'}`
        : null;
    const completeness = `${Math.max(0, totalTracked - missing.length)}/${totalTracked}`;

    const chips = [
        {
            label: 'What would make this a platform anchor?',
            answer: (() => {
                const tierPart = tierInfo.tier <= 2 ? 'This region already clears the regional bar.' : `A regional composite in Tier 1–2 (this site sits in ${tierInfo.label}) and`;
                const densityTarget = (nationalAvgDensity * 1.5).toFixed(2);
                const densityPart = densityRatio != null && densityRatio < 1.5
                    ? `catchment density is already at or below ~${densityTarget} clinics/km².`
                    : `catchment density below roughly ${densityTarget} clinics/km² (currently ${clinicsPerKm.toFixed(2)}).`;
                return `${tierPart} ${densityPart}`;
            })()
        },
        {
            label: 'How saturated is the competitive landscape here?',
            answer: sa3Counts
                ? `Across this SA3, ${sa3Counts.total || 0} tracked clinics split ${sa3Counts.independent || 0} independent / ${sa3Counts.corporate || 0} corporate / ${sa3Counts.publicngo || 0} public-NGO. Within just this clinic's 15-minute drive-time, ${analytics.clinicCount} clinics are present — a tighter, catchment-scoped figure than the SA3 total.`
                : `${analytics.clinicCount} clinics fall within this clinic's 15-minute catchment. Chain/ownership-level detail beyond that isn't held on this panel — see the SA3 drawer's Archetype mix.`
        }
    ];

    return { dims, verdict, verdictBg: verdictStyle.bg, verdictFg: verdictStyle.fg, verdictDot, narrative, caveat, completeness, chips };
}

// ============================================================
// Acquisition read — render + interaction (idle/loading/result),
// scoped to State.acquisitionReads[clinic_id]. Uses direct DOM
// updates on #acq-read-<id> rather than a full rail re-render.
// ============================================================
function buildAcquisitionReadHTML(clinicId) {
    const st = State.acquisitionReads[clinicId];
    if (!st || !st.ctx) return '';
    const idAttr = escJsAttr(clinicId);

    const headActions = (st.phase === 'result')
        ? `<div class="rd-read-actions">
             <button class="rd-link-btn muted" onclick="acqReadToggleCollapse('${idAttr}')">${st.collapsed ? 'Expand' : 'Collapse'}</button>
             <button class="rd-link-btn" onclick="acqReadGenerate('${idAttr}')">Regenerate</button>
           </div>`
        : '';

    let body = '';
    if (!st.phase || st.phase === 'idle') {
        body = `
            <div style="font-size:12px;color:var(--muted);line-height:1.45;margin-bottom:12px">Ask whether this clinic fits Foundry's acquisition criteria. Scored against Deliverability, Asset quality, Platform potential and Strategic fit.</div>
            <button class="rd-generate-btn" onclick="acqReadGenerate('${idAttr}')">Generate read</button>
        `;
    } else if (st.phase === 'loading') {
        body = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span class="rd-blink-dot"></span><span style="font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--sage-deep)">Reading clinic data…</span></div>
            <div class="rd-shim" style="height:22px;width:62%;margin-bottom:12px"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
                <div class="rd-shim" style="height:56px"></div><div class="rd-shim" style="height:56px"></div>
                <div class="rd-shim" style="height:56px"></div><div class="rd-shim" style="height:56px"></div>
            </div>
            <div class="rd-shim" style="height:10px;margin-bottom:6px"></div>
            <div class="rd-shim" style="height:10px;width:74%"></div>
        `;
    } else if (st.phase === 'result' && st.result && st.collapsed) {
        const read = st.result;
        body = `
            <div class="rd-collapsed-row rd-fadein">
                <span style="width:8px;height:8px;border-radius:50%;background:${read.verdictDot};flex-shrink:0"></span>
                <span style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">${read.verdict}</span>
                <span style="margin-left:auto;font-family:var(--mono);font-size:9px;color:var(--muted)">${read.dims.map(d => d.rating[0]).join('·')}</span>
            </div>
        `;
    } else if (st.phase === 'result' && st.result) {
        const read = st.result;
        body = `
            <div class="rd-fadein">
                <div class="rd-verdict-badge" style="background:${read.verdictBg};color:${read.verdictFg}"><span class="rd-verdict-dot" style="background:${read.verdictDot}"></span>${read.verdict}</div>
                <div class="rd-dims-grid">
                    ${read.dims.map(d => `
                        <div class="rd-dim-card">
                            <div class="rd-dim-card-head">
                                <span class="rd-dim-name">${d.name}</span>
                                <span class="rd-dim-rating" style="background:${d.bg};color:${d.fg}">${d.rating}</span>
                            </div>
                            <div class="rd-dim-why">${d.why}</div>
                            <div class="rd-dim-field">${d.field}</div>
                        </div>
                    `).join('')}
                </div>
                <div class="rd-narrative">
                    ${read.narrative.map(n => `
                        <div class="rd-narrative-row">
                            <span class="rd-narrative-dot ${n.tone === 'warn' ? 'warn' : (n.tone === 'good' ? 'good' : '')}"></span>
                            <div class="rd-narrative-text"><strong>${n.strong}</strong> ${n.text}</div>
                        </div>
                    `).join('')}
                </div>
                ${read.caveat ? `
                <div class="caveat" style="margin-bottom:12px">
                    <svg class="caveat-icon" viewBox="0 0 14 14" fill="none">
                        <path d="M7 1L13 12H1L7 1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                        <path d="M7 5v3M7 10v0.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    </svg>
                    <div class="caveat-body">${read.caveat} Read generated from ${read.completeness} tracked fields.</div>
                </div>` : ''}
                <div class="rd-stamp">
                    <span>${fmtStamp(st.generatedAt)}</span><span>·</span><span>foundry-read v1</span><span>·</span><span>heuristic, not model-generated</span>
                </div>
                <div>
                    <div class="rd-chips">
                        ${read.chips.map((c, i) => `<button class="rd-chip" onclick="acqReadAskChip('${idAttr}', ${i})">${c.label}</button>`).join('')}
                    </div>
                    ${st.thread.map(t => `
                        <div class="rd-thread-item rd-fadein">
                            <div class="rd-thread-q">${t.q}</div>
                            <div class="rd-thread-a">${t.pending ? '<span class="rd-blink-dot"></span> Thinking…' : t.a}</div>
                            ${t.live && !t.pending ? '<div class="rd-live-tag">Model-generated — verify independently</div>' : ''}
                        </div>
                    `).join('')}
                    <div class="rd-followup-row">
                        <input class="rd-followup-input" id="acq-read-draft-${idAttr}" placeholder="Ask a follow-up about this clinic…" onkeydown="if(event.key==='Enter') acqReadAskFreeform('${idAttr}')" />
                        <button class="rd-followup-send" onclick="acqReadAskFreeform('${idAttr}')">↩</button>
                    </div>
                    <div class="rd-followup-note">Scored dimensions above are computed, not model-generated. Suggested questions reuse that computation instantly; free-form questions call a live model scoped to this clinic only, with no memory between clinics.</div>
                </div>
            </div>
        `;
    }

    return `
        <div class="rd-read-head">
            <div class="rd-read-head-left">
                <span class="rd-section-title">Acquisition read</span>
            </div>
            ${headActions}
        </div>
        ${body}
    `;
}

function renderAcqReadSection(clinicId) {
    const el = document.getElementById('acq-read-' + clinicId);
    if (el) el.innerHTML = buildAcquisitionReadHTML(clinicId);
}

function acqReadGenerate(clinicId) {
    const st = State.acquisitionReads[clinicId];
    if (!st || !st.ctx) return;
    clearTimeout(st._timer);
    st.phase = 'loading';
    st.collapsed = false;
    st.thread = [];
    renderAcqReadSection(clinicId);
    st._timer = setTimeout(() => {
        const ctx = st.ctx;
        st.result = computeAcquisitionRead(ctx.clinic, ctx.archetype, ctx.tierInfo, ctx.analytics, ctx.clinicsPerKm, ctx.nationalAvgDensity, ctx.sa3Counts);
        st.phase = 'result';
        st.generatedAt = new Date();
        renderAcqReadSection(clinicId);
    }, 1400);
}

function acqReadToggleCollapse(clinicId) {
    const st = State.acquisitionReads[clinicId];
    if (!st) return;
    st.collapsed = !st.collapsed;
    renderAcqReadSection(clinicId);
}

function acqReadAskChip(clinicId, idx) {
    const st = State.acquisitionReads[clinicId];
    if (!st || !st.result) return;
    const c = st.result.chips[idx];
    if (!c) return;
    st.thread.push({ q: c.label, a: c.answer });
    renderAcqReadSection(clinicId);
}

async function acqReadAskFreeform(clinicId) {
    const st = State.acquisitionReads[clinicId];
    if (!st || !st.result) return;
    const input = document.getElementById('acq-read-draft-' + clinicId);
    if (!input) return;
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    const entry = { q, a: '', live: false, pending: true };
    st.thread.push(entry);
    renderAcqReadSection(clinicId);
    const result = await fetchLiveAnswer('clinic', q, st.result);
    entry.a = result.text;
    entry.live = result.ok;
    entry.pending = false;
    renderAcqReadSection(clinicId);
}

// ============================================================
// Helper: Generate SVG overlap diagram
// ============================================================
function generateOverlapDiagram(area1, area2, overlapPct, clinic1Name, clinic2Name) {
    // Purple (#7C3AED) for clinic 1, Orange (#E8862C) for clinic 2
    // Sizes proportional to areas with overlap intersection
    const maxSize = Math.max(area1, area2);
    const r1 = Math.sqrt((area1 / maxSize) * 1600) / 2;
    const r2 = Math.sqrt((area2 / maxSize) * 1600) / 2;
    const cx1 = 52, cy = 48;
    const cx2 = 84, cy2 = 48;

    return `<svg class="overlap-diagram" viewBox="0 0 132 96" aria-label="Catchment overlap diagram">
        <circle cx="${cx1}" cy="${cy}" r="${r1}" fill="#7C3AED" fill-opacity="0.16" stroke="#7C3AED" stroke-width="1.5"/>
        <circle cx="${cx2}" cy="${cy2}" r="${r2}" fill="#E8862C" fill-opacity="0.16" stroke="#E8862C" stroke-width="1.5"/>
        <clipPath id="clipL"><circle cx="${cx1}" cy="${cy}" r="${r1}"/></clipPath>
        <circle cx="${cx2}" cy="${cy2}" r="${r2}" fill="#465E4D" fill-opacity="0.42" clip-path="url(#clipL)"/>
    </svg>`;
}

// ============================================================
// Single Clinic Detail Rail (Right Rail Redesign)
// ============================================================
function renderBasicClinicInfo(clinic) {
    const panel = document.getElementById('comparison-panel');
    if (!panel) return;
    panel.classList.remove('hidden'); // make visible
    // Don't show backdrop — keep map interactive for second clinic selection

    const archetype = getClinicArchetype(clinic);
    // Datasets-as-layers (plan Phase E): clicked clinic may belong to a
    // secondary clinic layer, not the scoring market — use its own tagged
    // vertical (set in switchMarket()/toggleClinicLayer()) so a Physio pin
    // clicked while GP is the scoring market doesn't get labelled "GP Clinic".
    const market = clinic._layer || State.markets.current || 'gp';

    panel.innerHTML = `
        <div class="rd-root">
            <!-- Header -->
            <div class="rd-header">
                <div class="rd-header-text">
                    <div class="rd-eyebrow">${market.toUpperCase()} Clinic</div>
                    <div class="rd-title">${clinic.clinic_name || clinic.name || 'Clinic'}</div>
                    <div class="rd-sub">${clinic.suburb || ''} ${clinic.state_code || ''}</div>
                </div>
                <div class="rd-header-actions">
                    <button class="rd-close" onclick="clearAllIsochrones()" aria-label="Close">✕</button>
                </div>
            </div>

            <!-- Clinic Details -->
            <div class="rd-section">
                <div class="rd-section-head">
                    <span class="rd-section-title">Clinic Information</span>
                </div>
                ${clinic.address ? `<div style="font-size:13px;margin-bottom:12px;">📍 ${clinic.address}</div>` : ''}
                ${clinic.website ? `<div style="font-size:13px;margin-bottom:12px;"><a href="${clinic.website}" target="_blank" style="color:#0066cc;">🔗 ${clinic.website}</a></div>` : ''}
            </div>

            <!-- Archetype (if available) -->
            <div class="rd-section">
                <div class="rd-section-head">
                    <span class="rd-section-title">Details</span>
                </div>
                <div class="rd-arch">
                    ${clinic.clinic_format ? `<div class="arch-cell"><div class="arch-cell-l">Format</div><div class="arch-cell-v">${clinic.clinic_format}</div></div>` : ''}
                    ${clinic['Billing Type'] ? `<div class="arch-cell"><div class="arch-cell-l">Billing</div><div class="arch-cell-v">${clinic['Billing Type']}</div></div>` : ''}
                    ${clinic.ownership ? `<div class="arch-cell"><div class="arch-cell-l">Ownership</div><div class="arch-cell-v">${clinic.ownership}</div></div>` : ''}
                </div>
            </div>

            <div style="padding:16px;background:#f5f5f5;border-radius:6px;margin:16px;font-size:12px;color:#666;">
                ⓘ Catchment data not available for this market
            </div>
        </div>
    `;
}

function renderSingleClinicRail() {
    const panel = document.getElementById('comparison-panel');
    if (!panel || State.selectedClinics.length !== 1) return;
    panel.classList.remove('hidden'); // make visible
    // Don't show backdrop — keep map interactive for second clinic selection

    const clinic = State.selectedClinics[0];
    const iso = State.comparisonIsochrones[clinic.clinic_id];

    // Debug: log what we have in clinic object
    const allKeys = Object.keys(clinic);
    console.log('[renderSingleClinicRail] ALL clinic object keys:', allKeys);
    console.log('[renderSingleClinicRail] clinic object has sa3_name:', 'sa3_name' in clinic, 'has sa3_code:', 'sa3_code' in clinic);
    console.log('[renderSingleClinicRail] sa3_name:', clinic.sa3_name, 'sa3_code:', clinic.sa3_code, 'suburb:', clinic.suburb, 'City:', clinic.City);

    // If no isochrones available, show basic clinic info instead
    if (!iso) {
        renderBasicClinicInfo(clinic);
        return;
    }
    if (!State.sa3Data) return;

    // Find SA3 for this clinic using existing clinic mapping
    let sa3Code = clinic.sa3_code || clinic.SA3Code;
    let sa3Feature = null;
    // Prefer sa3_name from mapping, fallback to suburb, then City, then unknown
    let sa3Name = clinic.sa3_name || clinic.suburb || clinic.City || 'Unknown Location';
    console.log('[renderSingleClinicRail] Final sa3Name:', sa3Name, 'sa3Code:', sa3Code);
    let sa3Score = 50;

    if (sa3Code && State.sa3Data) {
        // Try multiple property names for SA3 code
        sa3Feature = State.sa3Data.features.find(f =>
            f.properties.SA3Code === sa3Code ||
            f.properties.SA3_CODE === sa3Code ||
            String(f.properties.SA3Code) === String(sa3Code) ||
            String(f.properties.sa3_code) === String(sa3Code) ||
            parseInt(f.properties.SA3Code) === parseInt(sa3Code)
        );
        if (sa3Feature) {
            sa3Name = sa3Feature.properties['SA3 Name'] || sa3Name;
            sa3Score = parseFloat(sa3Feature.properties.Composite_Score) || 50;
            console.log('SA3 Feature found:', {
                sa3Code,
                sa3Name,
                sa3Score,
                population: sa3Feature.properties.D_Population_Y25,
                popPropertyExists: 'D_Population_Y25' in sa3Feature.properties
            });
        } else {
            console.log('No SA3 feature found for code:', sa3Code);
            console.log('First SA3 property keys:', State.sa3Data.features[0]?.properties ? Object.keys(State.sa3Data.features[0].properties).slice(0, 15) : 'N/A');
        }
    }
    console.log('Clinic SA3 lookup:', { clinic_id: clinic.clinic_id, suburb: clinic.suburb, sa3Code, sa3Name, sa3FeatureFound: !!sa3Feature });

    // Compute clinic rank within SA3s
    const allScores = State.sa3Data.features.map(f => parseFloat(f.properties.Composite_Score) || 0).sort((a,b) => b-a);
    const rank = allScores.findIndex(s => s <= sa3Score) + 1;
    const totalSA3s = allScores.length || 336;

    // Get clinic details
    const archetype = getClinicArchetype(clinic);
    const score = computeClinicScore(clinic, sa3Feature, iso);
    const tierInfo = getTierForScore(score);
    const area = (turf.area(iso) / 1000000).toFixed(1);
    const analytics = computeCatchmentAnalytics(iso);

    // Placeholder thesis based on tier
    const theses = {
        1: "High-growth region with strong clinic concentration and excellent GP capacity — scalable acquisition target.",
        2: "Well-positioned catchment with balanced demand and competition — solid investment profile.",
        3: "Moderate growth with decent clinic spread — requires additional analysis for strategic fit.",
        4: "Slower-growth area with higher clinic density — consolidation opportunity.",
        5: "Challenging market with limited GP availability — requires significant operational investment."
    };
    const thesis = theses[tierInfo.tier] || "Regional catchment analysis required.";

    // Compute key signals and metrics
    const clinicsPerKm = parseFloat((analytics.clinicCount / area).toFixed(2));
    const nationalAvgDensity = State.nationalAvgDensity || 0.15;
    const maxDensity = Math.max(clinicsPerKm, nationalAvgDensity);
    const clinicDensityWidth = (clinicsPerKm / maxDensity) * 100;
    const nationalDensityWidth = (nationalAvgDensity / maxDensity) * 100;
    const gpCapacity = (analytics.gpCount || 0).toFixed(1);
    const ownershipStatus = archetype.ownership === 'Corporate' ? '✓ verified' : '';

    // Residents per clinic metric - use aggregated SA1 population from catchment
    const population = analytics.population || 0;
    const residentsPerClinic = calculateResidentsPerClinic(population, analytics.clinicCount);
    const formattedResidentsPerClinic = residentsPerClinic ? (residentsPerClinic / 1000).toFixed(1) + 'k' : '—';
    const formattedPopulation = population ? (population / 1000).toFixed(1) + 'k' : '—';

    // Calculate data completeness for GPs
    const gpDataCompleteness = analytics.clinicCount > 0 ? Math.round((analytics.clinicsWithGpCount / analytics.clinicCount) * 100) : 0;

    // Nearest rival distance
    const nearestRivalDist = calculateNearestRivalDistance(clinic, iso);

    // Score breakdown (use weighted dimensions from State.weights)
    const wD = State.weights.demand / 100;
    const wS = State.weights.supply / 100;
    const wC = State.weights.competition / 100;
    const wE = State.weights.economics / 100;

    const demandScore = Math.round(sa3Score * (wD / (wD + wS + wC + wE)));
    const supplyScore = Math.round(sa3Score * (wS / (wD + wS + wC + wE)));
    const competitionScore = Math.round(sa3Score * (wC / (wD + wS + wC + wE)));
    const economicsScore = Math.round(sa3Score * (wE / (wD + wS + wC + wE)));

    // Mobile: Show KPI-only compact view
    if (isMobile()) {
        panel.innerHTML = `
            <div style="padding: 12px 16px 16px;">
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 2px;">Clinic</div>
                        <div style="font-size: 14px; font-weight: 600; line-height: 1.2; margin-bottom: 2px;">${clinic.clinic_name}</div>
                        <div style="font-size: 11px; color: var(--muted);">${clinic.suburb || ''} ${clinic.state_code || ''}</div>
                    </div>
                    <button class="rd-close" onclick="clearAllIsochrones()" aria-label="Close" style="margin: -8px -8px 0 0; background: none; border: none; cursor: pointer; font-size: 20px; color: var(--muted); padding: 8px;">✕</button>
                </div>

                <!-- Key Metrics Grid -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px;">
                    <div style="background: var(--surface-2); padding: 10px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 12px; font-weight: 600; color: var(--ink);">${area}</div>
                        <div style="font-size: 9px; color: var(--muted); margin-top: 2px;">km² catchment</div>
                    </div>
                    <div style="background: var(--surface-2); padding: 10px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 12px; font-weight: 600; color: var(--ink);">${formattedPopulation}</div>
                        <div style="font-size: 9px; color: var(--muted); margin-top: 2px;">population</div>
                    </div>
                    <div style="background: var(--surface-2); padding: 10px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 12px; font-weight: 600; color: var(--ink);">${analytics.clinicCount}</div>
                        <div style="font-size: 9px; color: var(--muted); margin-top: 2px;">clinics</div>
                    </div>
                    ${State.markets.current === 'gp' ? `<div style="background: var(--surface-2); padding: 10px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 12px; font-weight: 600; color: var(--ink);">${clinic.gp_count || 0}</div>
                        <div style="font-size: 9px; color: var(--muted); margin-top: 2px;">GPs</div>
                    </div>` : ''}
                </div>

                <!-- Compare Prompt -->
                <div style="background: var(--sage-wash); padding: 8px; border-radius: 4px; text-align: center; font-size: 12px; color: var(--ink);">
                    <span style="font-weight: 600;">+</span> Click another clinic to compare
                </div>
            </div>
        `;
        panel.classList.remove('hidden');
        return;
    }

    // Desktop: Show full detailed view
    const tierColor = tierInfo.tier === 3 ? '#FFF2CC' : (tierInfo.tier <= 2 ? '#E3EBE5' : '#FFF2CC');
    const tierDotColor = tierInfo.tier === 3 ? '#E0A800' : (tierInfo.tier <= 2 ? '#6E9277' : '#E0A800');
    const tierPillClass = tierInfo.tier === 3 ? 'amber' : '';

    // Acquisition read — refresh the compute context each render, preserve
    // phase/collapsed/thread across clinic re-selection (see plan Phase 5).
    if (!State.acquisitionReads[clinic.clinic_id]) {
        State.acquisitionReads[clinic.clinic_id] = { phase: 'idle', collapsed: false, thread: [] };
    }
    State.acquisitionReads[clinic.clinic_id].ctx = {
        clinic, archetype, tierInfo, analytics, clinicsPerKm, nationalAvgDensity,
        sa3Counts: sa3Code ? State.sa3ClinicCounts[sa3Code] : null
    };

    panel.innerHTML = `
        <div class="rd-root">
            <!-- Header -->
            <div class="rd-header">
                <div class="rd-header-text">
                    <div class="rd-eyebrow">Clinic · ${sa3Name}${clinic.state_code ? ', ' + clinic.state_code : ''}</div>
                    <div class="rd-title">${clinic.clinic_name}</div>
                    <div class="rd-sub">${clinic.address || ''} · ${clinic.website || ''}</div>
                </div>
                <div class="rd-header-actions">
                    <button class="rd-close" onclick="clearAllIsochrones()" aria-label="Close">✕</button>
                </div>
            </div>

            <!-- Catchment & Demand (Hero) -->
            <div class="rd-section">
                <div class="rd-section-head">
                    <span class="rd-section-title">Catchment &amp; demand</span>
                    <span class="rd-section-sub">Drive-time model</span>
                </div>
                <div class="rd-mini3">
                    <div><div class="m3-v">${area}<span class="u"> km²</span></div><div class="m3-l">Catchment area</div></div>
                    <div><div class="m3-v">${formattedPopulation}<span class="u"></span></div><div class="m3-l">Population served</div></div>
                </div>
                <div class="rd-insight">
                    <div class="rd-insight-l">Why it matters</div>
                    <div class="rd-insight-t">Catchment growth and population density inform acquisition strategy. Higher growth areas support scaling; higher density areas may indicate competitive saturation.</div>
                </div>
            </div>

            <!-- Acquisition Read (AI-flagged heuristic read, see plan Phase 5) -->
            <div class="rd-section" id="acq-read-${clinic.clinic_id}">
                ${buildAcquisitionReadHTML(clinic.clinic_id)}
            </div>

            <!-- Clinic Archetype -->
            <div class="rd-section">
                <div class="rd-section-head">
                    <span class="rd-section-title">Archetype details</span>
                    <span class="rd-section-sub">Classification</span>
                </div>
                <div class="rd-arch">
                    <div class="arch-cell">
                        <div class="arch-cell-l">Format</div>
                        <div class="arch-cell-v">${archetype.format}</div>
                    </div>
                    <div class="arch-cell">
                        <div class="arch-cell-l">Billing</div>
                        <div class="arch-cell-v">${archetype.billing}</div>
                    </div>
                    <div class="arch-cell">
                        <div class="arch-cell-l">Ownership</div>
                        <div class="arch-cell-v">${archetype.ownership}</div>
                        ${ownershipStatus ? `<span class="arch-verified">${ownershipStatus}</span>` : ''}
                    </div>
                </div>
                ${State.markets.current === 'gp' ? `<div class="rd-team">
                    <div class="team-cell"><div class="team-v">${clinic.gp_count || 0}</div><div class="team-l">GPs identified</div></div>
                    <div class="team-cell"><div class="team-v">${(clinic.gp_count * 0.75).toFixed(1)}</div><div class="team-l">Est GP FTE · ×0.75</div></div>
                </div>` : ''}
            </div>

            <!-- Competitive Density -->
            <div class="rd-section">
                <div class="rd-section-head">
                    <span class="rd-section-title">Competitive density</span>
                    <span class="rd-section-sub">In-catchment</span>
                </div>
                <div class="rd-cmpbar">
                    <div class="cmpbar-row">
                        <div class="cmpbar-k">This clinic</div>
                        <div class="cmpbar-track"><div class="cmpbar-fill" style="width:${clinicDensityWidth}%; background:#6E9277;"></div></div>
                        <div class="cmpbar-v">${clinicsPerKm.toFixed(2)}</div>
                    </div>
                    <div class="cmpbar-row">
                        <div class="cmpbar-k">National avg</div>
                        <div class="cmpbar-track"><div class="cmpbar-fill" style="width:${nationalDensityWidth}%; background:#BFBFBF;"></div></div>
                        <div class="cmpbar-v">${nationalAvgDensity.toFixed(2)}</div>
                    </div>
                </div>
                <div class="rd-overlap">
                    <div class="rd-overlap-l">Read</div>
                    <div class="rd-overlap-t"><b>${analytics.clinicCount} clinics</b> serve the ${area} km² catchment — density sits at <b>${clinicsPerKm} clinics/km²</b>.</div>
                </div>

                <!-- KPIs -->
                <div class="rd-kpi-row">
                    <div class="rd-kpi-cell">
                        <div class="rd-kpi-label">Clinics in catchment</div>
                        <div class="rd-kpi-value">${analytics.clinicCount}</div>
                    </div>
                    ${State.markets.current === 'gp' ? `<div class="rd-kpi-cell">
                        <div class="rd-kpi-label">GPs in catchment</div>
                        <div class="rd-kpi-value">>${analytics.gpCount}</div>
                        <div class="rd-kpi-note">(${gpDataCompleteness}% have data)</div>
                    </div>` : ''}
                    <div class="rd-kpi-cell">
                        <div class="rd-kpi-label">Residents per clinic</div>
                        <div class="rd-kpi-value">${formattedResidentsPerClinic}</div>
                    </div>
                </div>
            </div>

        </div>

            <!-- Compare prompt -->
            <div class="rd-compare-prompt">
                <span class="rd-compare-icon">+</span>
                <span>Click another clinic on the map to compare</span>
            </div>
        </div>
    `;
    panel.classList.remove('hidden');
}

// ============================================================
// Comparison Rail (Right Rail Redesign)
// ============================================================
function renderComparisonRail() {
    const panel = document.getElementById('comparison-panel');
    if (!panel || State.selectedClinics.length !== 2 || !State.sa3Data) return;
    panel.classList.remove('hidden'); // make visible
    // Don't show backdrop — keep map interactive

    const clinic1 = State.selectedClinics[0];
    const clinic2 = State.selectedClinics[1];
    const iso1 = State.comparisonIsochrones[clinic1.clinic_id];
    const iso2 = State.comparisonIsochrones[clinic2.clinic_id];

    if (!iso1 || !iso2) return;

    const area1 = (turf.area(iso1) / 1000000).toFixed(1);
    const area2 = (turf.area(iso2) / 1000000).toFixed(1);
    const overlapPct = computeOverlapPercent(iso1, iso2);

    // Determine if complementary or overlapping
    const verdict = overlapPct < 30 ? 'Complementary' : (overlapPct < 70 ? 'Overlapping' : 'Highly Overlapping');

    // Find SA3s for both clinics
    const sa3_1 = findClinicSA3(clinic1);
    const sa3_2 = findClinicSA3(clinic2);
    const sa3Name = sa3_1?.properties['SA3 Name'] || clinic1.sa3_name ||
                    sa3_2?.properties['SA3 Name'] || clinic2.sa3_name ||
                    'Multi-region';

    const score1 = computeClinicScore(clinic1, sa3_1, iso1);
    const score2 = computeClinicScore(clinic2, sa3_2, iso2);
    const leader = score1 > score2 ? 0 : (score2 > score1 ? 1 : -1);

    const analytics1 = computeCatchmentAnalytics(iso1);
    const analytics2 = computeCatchmentAnalytics(iso2);

    // Mobile: Show KPI-only compact comparison view
    if (isMobile()) {
        panel.innerHTML = `
            <div style="padding: 12px 16px 16px;">
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px;">Comparison</div>
                        <div style="font-size: 12px; font-weight: 600; line-height: 1.2; margin-bottom: 4px;">${clinic1.clinic_name.split(' ').slice(0, 2).join(' ')} <span style="color: var(--muted); font-weight: 400;">vs</span> ${clinic2.clinic_name.split(' ').slice(0, 2).join(' ')}</div>
                        <div style="font-size: 11px; color: var(--muted);">${overlapPct}% overlap</div>
                    </div>
                    <button class="rd-close" onclick="clearAllIsochrones()" aria-label="Close" style="margin: -8px -8px 0 0; background: none; border: none; cursor: pointer; font-size: 20px; color: var(--muted); padding: 8px;">✕</button>
                </div>

                <!-- Clinic 1 KPIs -->
                <div style="background: var(--surface-2); padding: 10px; border-radius: 6px; margin-bottom: 8px;">
                    <div style="font-size: 10px; font-weight: 600; color: var(--muted); margin-bottom: 8px;">${clinic1.clinic_name}</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div style="text-align: center;">
                            <div style="font-size: 12px; font-weight: 600; color: var(--ink);">${area1}</div>
                            <div style="font-size: 8px; color: var(--muted);">km²</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 12px; font-weight: 600; color: var(--ink);">${analytics1.clinicCount}</div>
                            <div style="font-size: 8px; color: var(--muted);">clinics</div>
                        </div>
                    </div>
                </div>

                <!-- Clinic 2 KPIs -->
                <div style="background: var(--surface-2); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; font-weight: 600; color: var(--muted); margin-bottom: 8px;">${clinic2.clinic_name}</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div style="text-align: center;">
                            <div style="font-size: 12px; font-weight: 600; color: var(--ink);">${area2}</div>
                            <div style="font-size: 8px; color: var(--muted);">km²</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 12px; font-weight: 600; color: var(--ink);">${analytics2.clinicCount}</div>
                            <div style="font-size: 8px; color: var(--muted);">clinics</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        panel.classList.remove('hidden');
        return;
    }

    // Desktop: Show full comparison view
    panel.innerHTML = `
        <div class="rd-root">
            <!-- Header -->
            <div class="rd-header">
                <div class="rd-header-text">
                    <div class="rd-eyebrow">Comparison · ${sa3Name} SA3</div>
                    <div class="rd-title">${clinic1.clinic_name}<br><span style="font-weight:400; color:var(--muted); font-size:15px;">vs</span> ${clinic2.clinic_name}</div>
                </div>
                <div class="rd-header-actions">
                    <button class="rd-close" onclick="clearAllIsochrones()" aria-label="Close">✕</button>
                </div>
            </div>

            <!-- Overlap Headline -->
            <div class="rd-overlap-hero">
                ${generateOverlapDiagram(area1, area2, overlapPct, clinic1.clinic_name, clinic2.clinic_name)}
                <div>
                    <div class="rd-overlap-l" style="margin-bottom:2px;">Catchment overlap</div>
                    <div class="overlap-pct">${overlapPct}<span class="s">%</span></div>
                    <span class="overlap-verdict"><span class="rd-tier-dot" style="background:#6E9277;width:7px;height:7px;border-radius:50%;display:inline-block;"></span>${verdict}</span>
                </div>
            </div>

            <!-- Key Takeaway -->
            <div class="rd-section">
                <div class="rd-insight">
                    <div class="rd-insight-l">Key takeaway</div>
                    <div class="rd-insight-t">${overlapPct}% of catchments overlap. These clinics are ${verdict.toLowerCase()} — ${overlapPct < 50 ? 'combining adds complementary reach' : 'combining consolidates overlapping territory'}.</div>
                </div>
            </div>

            <!-- Head to Head -->
            <div class="rd-section">
                <div class="rd-section-head">
                    <span class="rd-section-title">Head to head</span>
                    <span class="rd-section-sub">Leader shaded</span>
                </div>
                <div class="rd-h2h-head">
                    <div class="h2h-clinic">
                        <span class="h2h-sw" style="background:#7C3AED;"></span>
                        <div><div class="h2h-cn">${clinic1.clinic_name.split(' ').slice(0,2).join(' ')}<br></div><div class="h2h-cs">${clinic1.suburb}, ${clinic1.state_code}</div></div>
                    </div>
                    <div class="h2h-clinic">
                        <span class="h2h-sw" style="background:#E8862C;"></span>
                        <div><div class="h2h-cn">${clinic2.clinic_name.split(' ').slice(0,2).join(' ')}<br></div><div class="h2h-cs">${clinic2.suburb}, ${clinic2.state_code}</div></div>
                    </div>
                </div>

                <!-- Score -->
                <div class="h2h-row">
                    <div class="h2h-label"><span>Investability score</span><span class="lead">${leader === 0 ? '◂ ' + clinic1.clinic_name.split(' ')[0] : (leader === 1 ? clinic2.clinic_name.split(' ')[0] + ' ▸' : '—')}</span></div>
                    <div class="h2h-bars">
                        <div class="h2h-side"><div class="h2h-val">${score1}</div><div class="h2h-track"><div class="h2h-fill" style="width:${Math.min(score1, 100)}%; background:#7C3AED;"></div></div></div>
                        <div class="h2h-side right ${leader === 0 ? 'dim' : ''}"><div class="h2h-val">${score2}</div><div class="h2h-track right"><div class="h2h-fill" style="width:${Math.min(score2, 100)}%; background:#E8862C;"></div></div></div>
                    </div>
                </div>

                <!-- Catchment area -->
                <div class="h2h-row">
                    <div class="h2h-label"><span>Catchment area</span><span class="lead">${parseFloat(area1) > parseFloat(area2) ? '◂ ' + clinic1.clinic_name.split(' ')[0] : clinic2.clinic_name.split(' ')[0] + ' ▸'}</span></div>
                    <div class="h2h-bars">
                        <div class="h2h-side ${parseFloat(area2) > parseFloat(area1) ? 'dim' : ''}"><div class="h2h-val">${area1}<span class="u"> km²</span></div><div class="h2h-track"><div class="h2h-fill" style="width:${Math.min((area1/Math.max(area1,area2))*100, 100)}%; background:#7C3AED;"></div></div></div>
                        <div class="h2h-side right"><div class="h2h-val">${area2}<span class="u"> km²</span></div><div class="h2h-track right"><div class="h2h-fill" style="width:${Math.min((area2/Math.max(area1,area2))*100, 100)}%; background:#E8862C;"></div></div></div>
                    </div>
                </div>

                <!-- Population served -->
                <div class="h2h-row">
                    <div class="h2h-label"><span>Population served</span><span class="lead">${(clinic1.gp_count || 0) > (clinic2.gp_count || 0) ? '◂ ' + clinic1.clinic_name.split(' ')[0] : clinic2.clinic_name.split(' ')[0] + ' ▸'}</span></div>
                    <div class="h2h-bars">
                        <div class="h2h-side ${(clinic2.gp_count || 0) > (clinic1.gp_count || 0) ? 'dim' : ''}"><div class="h2h-val">${analytics1.population ? (analytics1.population / 1000).toFixed(1) + 'k' : '—'}</div><div class="h2h-track"><div class="h2h-fill" style="width:${Math.min((analytics1.population/Math.max(analytics1.population||1,analytics2.population||1))*100, 100)}%; background:#7C3AED;"></div></div></div>
                        <div class="h2h-side right"><div class="h2h-val">${analytics2.population ? (analytics2.population / 1000).toFixed(1) + 'k' : '—'}</div><div class="h2h-track right"><div class="h2h-fill" style="width:${Math.min((analytics2.population/Math.max(analytics1.population||1,analytics2.population||1))*100, 100)}%; background:#E8862C;"></div></div></div>
                    </div>
                </div>

                <!-- Residents per clinic -->
                <div class="h2h-row">
                    <div class="h2h-label"><span>Residents per clinic</span><span class="lead">${(analytics1.population / (analytics1.clinicCount || 1)) > (analytics2.population / (analytics2.clinicCount || 1)) ? '◂ ' + clinic1.clinic_name.split(' ')[0] : clinic2.clinic_name.split(' ')[0] + ' ▸'}</span></div>
                    <div class="h2h-bars">
                        <div class="h2h-side ${(analytics2.population / (analytics2.clinicCount || 1)) > (analytics1.population / (analytics1.clinicCount || 1)) ? 'dim' : ''}"><div class="h2h-val">${analytics1.clinicCount && analytics1.population ? (analytics1.population / analytics1.clinicCount / 1000).toFixed(1) + 'k' : '—'}</div><div class="h2h-track"><div class="h2h-fill" style="width:${analytics1.clinicCount && analytics1.population && analytics2.clinicCount && analytics2.population ? Math.min((analytics1.population / analytics1.clinicCount / Math.max(analytics1.population / analytics1.clinicCount, analytics2.population / analytics2.clinicCount))*100, 100) : 0}%; background:#7C3AED;"></div></div></div>
                        <div class="h2h-side right"><div class="h2h-val">${analytics2.clinicCount && analytics2.population ? (analytics2.population / analytics2.clinicCount / 1000).toFixed(1) + 'k' : '—'}</div><div class="h2h-track right"><div class="h2h-fill" style="width:${analytics1.clinicCount && analytics1.population && analytics2.clinicCount && analytics2.population ? Math.min((analytics2.population / analytics2.clinicCount / Math.max(analytics1.population / analytics1.clinicCount, analytics2.population / analytics2.clinicCount))*100, 100) : 0}%; background:#E8862C;"></div></div></div>
                    </div>
                </div>

                <!-- Est GP FTE (GP-specific) -->
                ${State.markets.current === 'gp' ? `<div class="h2h-row">
                    <div class="h2h-label"><span>Est GP FTE</span><span class="lead">${analytics1.gpCount > analytics2.gpCount ? '◂ ' + clinic1.clinic_name.split(' ')[0] : clinic2.clinic_name.split(' ')[0] + ' ▸'}</span></div>
                    <div class="h2h-bars">
                        <div class="h2h-side ${analytics2.gpCount > analytics1.gpCount ? 'dim' : ''}"><div class="h2h-val">${analytics1.gpCount}</div><div class="h2h-track"><div class="h2h-fill" style="width:${Math.min((analytics1.gpCount/Math.max(analytics1.gpCount,analytics2.gpCount))*100, 100)}%; background:#7C3AED;"></div></div></div>
                        <div class="h2h-side right"><div class="h2h-val">${analytics2.gpCount}</div><div class="h2h-track right"><div class="h2h-fill" style="width:${Math.min((analytics2.gpCount/Math.max(analytics1.gpCount,analytics2.gpCount))*100, 100)}%; background:#E8862C;"></div></div></div>
                    </div>
                </div>` : ''}

                <!-- Rivals in catchment -->
                <div class="h2h-row">
                    <div class="h2h-label"><span>Rivals in catchment</span><span class="lead">${analytics1.clinicCount < analytics2.clinicCount ? '◂ ' + clinic1.clinic_name.split(' ')[0] : clinic2.clinic_name.split(' ')[0] + ' ▸'}</span></div>
                    <div class="h2h-bars">
                        <div class="h2h-side ${analytics2.clinicCount < analytics1.clinicCount ? 'dim' : ''}"><div class="h2h-val">${analytics1.clinicCount}</div><div class="h2h-track"><div class="h2h-fill" style="width:${Math.min((analytics1.clinicCount/Math.max(analytics1.clinicCount,analytics2.clinicCount))*100, 100)}%; background:#7C3AED;"></div></div></div>
                        <div class="h2h-side right"><div class="h2h-val">${analytics2.clinicCount}</div><div class="h2h-track right"><div class="h2h-fill" style="width:${Math.min((analytics2.clinicCount/Math.max(analytics1.clinicCount,analytics2.clinicCount))*100, 100)}%; background:#E8862C;"></div></div></div>
                    </div>
                </div>
            </div>

            <!-- Combined Footprint -->
            <div class="rd-section">
                <div class="rd-section-head">
                    <span class="rd-section-title">Combined footprint</span>
                    <span class="rd-section-sub">Net of overlap</span>
                </div>
                <div class="rd-combined">
                    <div class="comb-cell"><div class="comb-v">${(parseFloat(area1) + parseFloat(area2) - (parseFloat(area1) + parseFloat(area2)) * (overlapPct / 100)).toFixed(1)}<span class="u"> km²</span></div><div class="comb-l">Net unique catchment</div></div>
                    ${State.markets.current === 'gp' ? `<div class="comb-cell"><div class="comb-v">${(parseFloat(clinic1.gp_count || 0) + parseFloat(clinic2.gp_count || 0)) ? '>' + (parseFloat(clinic1.gp_count || 0) + parseFloat(clinic2.gp_count || 0)) : '—'}<span class="u"> GPs</span></div><div class="comb-l">Combined GP count</div><div class="comb-note">${analytics1.clinicsWithGpCount + analytics2.clinicsWithGpCount > 0 ? `(${Math.round(((analytics1.clinicsWithGpCount + analytics2.clinicsWithGpCount) / (analytics1.clinicCount + analytics2.clinicCount)) * 100)}% have data)` : '(data unavailable)'}</div></div>` : ''}
                </div>
            </div>
        </div>
    `;
    panel.classList.remove('hidden');
}

function renderCatchmentAnalyticsPanel() {
    console.log('[renderCatchmentAnalyticsPanel] selectedClinics.length:', State.selectedClinics.length);
    if (State.selectedClinics.length === 1) {
        console.log('[renderCatchmentAnalyticsPanel] Rendering SINGLE clinic rail');
        renderSingleClinicRail();
    } else if (State.selectedClinics.length === 2) {
        console.log('[renderCatchmentAnalyticsPanel] Rendering COMPARISON rail');
        renderComparisonRail();
    }
}

function renderComparisonPanel() {
    if (State.selectedClinics.length < 2) return;

    const clinic1 = State.selectedClinics[0];
    const clinic2 = State.selectedClinics[1];
    const iso1 = State.comparisonIsochrones[clinic1.clinic_id];
    const iso2 = State.comparisonIsochrones[clinic2.clinic_id];

    const overlapPct = computeOverlapPercent(iso1, iso2);
    const area1 = (turf.area(iso1) / 1000000).toFixed(1);
    const area2 = (turf.area(iso2) / 1000000).toFixed(1);

    const panel = document.getElementById('comparison-panel');
    if (panel) {
        panel.classList.remove('hidden');
        // Don't show backdrop — keep map interactive
        panel.innerHTML = `
            <div class="comparison-header">
                <h3>${clinic1.clinic_name} vs ${clinic2.clinic_name}</h3>
                <button class="btn-icon" onclick="clearAllIsochrones()" style="position:relative;z-index:1000;" aria-label="Close">
                    <svg viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                </button>
            </div>

            <div class="comparison-content">
                <div style="padding:16px;border-bottom:1px solid var(--hairline);">
                    <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Catchment Overlap</div>
                    <div style="font-size:28px;font-weight:700;color:#7C3AED;">${overlapPct}%</div>
                </div>

                <div style="padding:16px;">
                    <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;">Catchment Area (km²)</div>
                    <div style="display:grid;gap:12px;">
                        <div style="background:linear-gradient(135deg, rgba(155, 122, 186, 0.15) 0%, rgba(124, 58, 237, 0.05) 100%);padding:12px;border-radius:6px;border-left:3px solid #7C3AED;">
                            <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">${clinic1.clinic_name}</div>
                            <div style="font-size:18px;font-weight:700;">${area1}</div>
                        </div>
                        <div style="background:linear-gradient(135deg, rgba(255, 179, 102, 0.15) 0%, rgba(255, 140, 0, 0.05) 100%);padding:12px;border-radius:6px;border-left:3px solid #FF8C00;">
                            <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">${clinic2.clinic_name}</div>
                            <div style="font-size:18px;font-weight:700;">${area2}</div>
                        </div>
                    </div>
                </div>

                <div style="padding:16px;">
                    <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;">Details</div>
                    <table style="width:100%;font-size:12px;line-height:1.8;">
                        <tr><td style="padding:4px 0;color:var(--muted);">${clinic1.clinic_name}</td><td style="text-align:right;font-weight:600;">${clinic1.suburb}, ${clinic1.state_code}</td></tr>
                        <tr><td style="padding:4px 0;color:var(--muted);">${clinic2.clinic_name}</td><td style="text-align:right;font-weight:600;">${clinic2.suburb}, ${clinic2.state_code}</td></tr>
                    </table>
                </div>
            </div>
        `;
        panel.classList.remove('hidden');
    }
}

function clearAllIsochrones() {
    State.activeClinicId = null;
    State.activeClinicIsochrone = null;
    State.selectedClinics = [];
    State.comparisonIsochrones = {};

    clearAllIsochroneLayers();

    // Clear all label layers
    for (let i = 1; i <= 2; i++) {
        const labelId = `iso${i}-label`;
        const labelBgId = labelId + '-bg';
        try {
            map.removeLayer(labelId);
            map.removeLayer(labelBgId);
            map.removeSource(labelId);
        } catch(e) {}
    }

    // Hide active marker
    const source = map.getSource('activeClinicMarker');
    if (source) source.setData(turf.featureCollection([]));

    // Hide comparison panel
    const panel = document.getElementById('comparison-panel');
    if (panel) panel.classList.add('hidden');

    closeDrawer();
}

(function mobileHandoff() {
    const MOBILE_BREAKPOINT = 1024;
    const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;

    document.addEventListener('DOMContentLoaded', () => {
        document.body.classList.toggle('has-mob-layout', isMobile());
        window.addEventListener('resize', () => {
            document.body.classList.toggle('has-mob-layout', isMobile());
        });

        wireLensActiveSync();
        wireKpiMirror();
        wireNraPicker();
        wireMoreMenu();
        wireSheetSnap();
    });

    // ---------- 1 · Lens active-class sync (desktop ↔ mobile) ----------
    function wireLensActiveSync() {
        // Delegate clicks so any lens-seg (mobile or desktop) updates BOTH sets
        document.addEventListener('click', (e) => {
            const seg = e.target.closest('.lens-seg');
            if (!seg || !seg.dataset.lens) return;
            const lens = seg.dataset.lens;

            // Sync active class across every .lens-seg AND .mob-lens-chip in the DOM
            document.querySelectorAll('.lens-seg').forEach(el => {
                el.classList.toggle('active', el.dataset.lens === lens);
            });
            document.querySelectorAll('.mob-lens-chip[data-lens]').forEach(el => {
                el.classList.toggle('active', el.dataset.lens === lens);
            });

            // NRA chip on mobile takes "active" when any nra-* lens is selected
            const mobNra = document.getElementById('mob-lens-nra-btn');
            if (mobNra) mobNra.classList.toggle('active', lens.startsWith('nra-'));
        }, true); // capture phase so we run alongside existing handlers
    }

    // ---------- 2 · Mirror updateRailStats into mobile KPI strip ----------
    function wireKpiMirror() {
        const idToMobStat = {
            'stat-regions':    'regions',
            'stat-avg':        'avg',
            'stat-tier1':      'tier1',
            'stat-tier2':      'tier2',
            'stat-acquirable': 'acquirable',
        };

        // Use MutationObserver so we never miss an update regardless of code path
        Object.keys(idToMobStat).forEach(id => {
            const src = document.getElementById(id);
            if (!src) return;
            const mobKey = idToMobStat[id];
            const mob = document.querySelector('.mob-kpi-value[data-mob-stat="' + mobKey + '"]');
            if (!mob) return;

            // Initial sync
            mob.textContent = src.textContent;

            const obs = new MutationObserver(() => {
                mob.textContent = src.textContent;
            });
            obs.observe(src, { childList: true, characterData: true, subtree: true });
        });
    }

    // ---------- 3 · NRA picker (mobile action-sheet) ----------
    function wireNraPicker() {
        const trigger = document.getElementById('mob-lens-nra-btn');
        const picker = document.getElementById('mob-nra-picker');
        const cancel = document.getElementById('mob-nra-picker-cancel');
        const backdrop = picker && picker.querySelector('.mob-nra-picker-backdrop');
        if (!trigger || !picker) return;

        const close = () => picker.classList.remove('open');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            picker.classList.add('open');
        });
        if (cancel) cancel.addEventListener('click', close);
        if (backdrop) backdrop.addEventListener('click', close);

        // Tapping any NRA item closes the picker (the .lens-seg handler already changes the lens)
        picker.querySelectorAll('.mob-nra-picker-item').forEach(item => {
            item.addEventListener('click', close);
        });
    }

    // ---------- 4 · ⋯ overflow menu ----------
    function wireMoreMenu() {
        const btn = document.getElementById('mob-more');
        const menu = document.getElementById('mob-more-menu');
        if (!btn || !menu) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && e.target !== btn) menu.classList.remove('open');
        });

        // Export button forwards to existing export handler
        const exportBtn = document.getElementById('mob-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                menu.classList.remove('open');
                const desktopExport = document.getElementById('export-btn');
                if (desktopExport) desktopExport.click();
            });
        }

        // Sub-view links drive the map sub-tabs (Map / List / Targets).
        // On mobile the sub-tab bar is overlaid by the map canvas, so this
        // overflow menu is the primary navigation between sub-views.
        menu.querySelectorAll('.mob-subtab-link').forEach(item => {
            item.addEventListener('click', () => {
                menu.classList.remove('open');
                if (typeof switchView === 'function') switchView('map');
                const sub = item.dataset.subtab;
                const subtabBtn = document.querySelector('.map-subtab[data-subtab="' + sub + '"]');
                if (subtabBtn) subtabBtn.click();
            });
        });

        // Sync active state of menu items with the map sub-tabs
        const observer = new MutationObserver(() => {
            document.querySelectorAll('.mob-subtab-link').forEach(mobBtn => {
                const sub = mobBtn.dataset.subtab;
                const subtabBtn = document.querySelector('.map-subtab[data-subtab="' + sub + '"]');
                if (subtabBtn) mobBtn.classList.toggle('active', subtabBtn.classList.contains('active'));
            });
        });
        const subbar = document.querySelector('.map-subtabs');
        if (subbar) observer.observe(subbar, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    // ---------- 5 · Bottom-sheet snap (peek ↔ expanded ↔ full) ----------
    function wireSheetSnap() {
        const rail = document.getElementById('map-rail');
        if (!rail) return;

        // max-height approach: rail sizes to content so no blank space, and the
        // grabber is always at the visual top. CSS classes drive the value;
        // inline style is only used for the instant hide (snap-hidden).
        function setSnap(state) {
            rail.classList.remove('snap-full', 'snap-expanded', 'snap-hidden');
            if (state === 'full')     rail.classList.add('snap-full');
            if (state === 'expanded') rail.classList.add('snap-expanded');
            if (state === 'hidden')   rail.classList.add('snap-hidden');

            rail.style.transform = ''; // clear any legacy inline transform

            if (state === 'hidden') {
                // Instant hide — display:none is bulletproof on iOS
                rail.style.display = 'none';
                return;
            }

            // Clear all inline overrides so CSS class values take effect
            rail.style.display   = '';
            rail.style.transition = '';
            rail.style.maxHeight  = '';
            rail.style.overflow   = '';
            rail.style.overflowY  = '';
            if (state === 'peek') rail.scrollTop = 0;
        }

        const cycleSnap = () => {
            if (rail.classList.contains('snap-full')) {
                setSnap('peek');
            } else if (rail.classList.contains('snap-expanded')) {
                setSnap('full');
            } else {
                setSnap('expanded');
            }
        };

        // Tap on the grabber area (top ~30px of the sheet) toggles state
        rail.addEventListener('click', (e) => {
            if (!isMobile()) return;
            const rect = rail.getBoundingClientRect();
            if (e.clientY - rect.top <= 30) {
                e.preventDefault();
                cycleSnap();
            }
        });

        // Drag support — basic, no momentum
        let startY = null, startSnap = null;
        rail.addEventListener('touchstart', (e) => {
            if (!isMobile()) return;
            const rect = rail.getBoundingClientRect();
            const y = e.touches[0].clientY;
            if (y - rect.top > 40) return;  // only when starting drag in the grabber area
            startY = y;
            startSnap = rail.classList.contains('snap-full') ? 'full'
                      : rail.classList.contains('snap-expanded') ? 'expanded'
                      : 'peek';
        }, { passive: true });

        rail.addEventListener('touchend', (e) => {
            if (startY == null) return;
            const endY = (e.changedTouches[0] || {}).clientY || startY;
            const dy = endY - startY;
            const TH = 40;

            if      (startSnap === 'peek'     && dy < -TH) setSnap('expanded');
            else if (startSnap === 'expanded' && dy < -TH) setSnap('full');
            else if (startSnap === 'expanded' && dy > TH)  setSnap('peek');
            else if (startSnap === 'full'     && dy > TH)  setSnap('expanded');
            startY = null;
        }, { passive: true });
    }
})();
