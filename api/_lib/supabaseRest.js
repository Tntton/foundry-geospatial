// Shared server-side Supabase REST helper for api/assistant.js's read-only
// query tools. Extends the pattern api/copilot.js's fetchGazetteerNames()
// already established (plain fetch() against PostgREST using the same
// publishable anon key already embedded client-side in src/js/app.js) rather
// than adding @supabase/supabase-js or a service-role key as a server
// dependency:
//   - No RLS is enabled on any table in this project (verified against
//     scripts/supabase_migration/schema.sql — zero "enable row level
//     security"/"grant" statements), so the anon key already has full read
//     access to everything these tools need.
//   - A service-role key would be strictly worse here: higher blast radius
//     (bypasses RLS entirely, can write) for zero capability benefit, plus a
//     new secret to manage.
//   - PostgREST's own query-string operators (eq., gte., lte., in.(...),
//     order=, limit=, select=) are expressive enough for every tool below
//     without a query-builder library.
//
// Guardrail: every caller supplies a fixed table name and a fixed,
// hardcoded `select` column list — callers only ever pass filter *values*
// (already validated by each tool's own Zod schema in api/assistant.js),
// never table/column names. This file issues GET requests only.

const DATA_SUPABASE_URL = 'https://ytervdshmvdawoomhnlp.supabase.co';
const DATA_SUPABASE_ANON_KEY = 'sb_publishable_3cXEeYAJg3u3CX_j8ITJQg_jLLPouw-';

const AUTH_HEADERS = {
    apikey: DATA_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${DATA_SUPABASE_ANON_KEY}`
};

// Generic PostgREST GET. `params` is an array of [key, value] PostgREST
// query pairs, e.g. [['select','sa3_code,sa3_name'], ['tier','in.(1,2)'],
// ['composite_score','gte.60'], ['composite_score','lte.80']] — an array
// (not a plain object) specifically so range filters can repeat the same
// column key twice (gte + lte); URLSearchParams built from an array of
// pairs appends rather than overwrites duplicates, a plain object would
// silently drop the first one. Also accepts a plain object for simple
// no-duplicate-key calls, for convenience.
// Returns [] on any failure (network, non-2xx, bad JSON) rather than
// throwing — every read tool treats an empty result as "no matches", not a
// hard error, matching fetchGazetteerNames()'s existing failure posture.
export async function supabaseSelect(table, params) {
    try {
        const pairs = Array.isArray(params) ? params : Object.entries(params);
        const qs = new URLSearchParams(pairs).toString();
        const res = await fetch(`${DATA_SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: AUTH_HEADERS });
        if (!res.ok) return [];
        const rows = await res.json();
        return Array.isArray(rows) ? rows : [];
    } catch {
        return [];
    }
}

// Cached per cold-start (region_definitions is small, hand-curated, and
// changes rarely — see scripts/supabase_migration/schema.sql's "Gap 1"
// comment). Refetched if empty (e.g. first request after cold start, or if
// a prior fetch failed) rather than cached forever, so a genuinely new
// region added to the table shows up without a redeploy. Moved here
// verbatim from api/copilot.js so both the assistant's system-prompt
// gazetteer list and its resolve_gazetteer_region tool share one fetch.
let gazetteerCache = null;

export async function fetchGazetteerNames() {
    if (gazetteerCache && gazetteerCache.length) return gazetteerCache;
    const rows = await supabaseSelect('region_definitions', { select: 'region_name,aliases' });
    if (!rows.length) return [];
    gazetteerCache = rows.map((r) => ({ name: r.region_name, aliases: r.aliases || [] }));
    return gazetteerCache;
}

// Same alias-aware, case-insensitive match api/copilot.js used to validate
// intent.geography.regionName server-side. Shared here so the
// resolve_gazetteer_region tool and the mutation-tool grounding check (see
// api/assistant.js) use the exact same resolution logic.
export function matchGazetteerRegion(gazetteer, name) {
    if (!name) return null;
    const wanted = String(name).trim().toLowerCase();
    return gazetteer.find((r) =>
        r.name.toLowerCase() === wanted || r.aliases.some((a) => a.toLowerCase() === wanted)
    ) || null;
}

export async function fetchGazetteerMembers(regionName) {
    const rows = await supabaseSelect('region_gazetteer_members', {
        select: 'sa3_code',
        region_name: `eq.${regionName}`
    });
    return rows.map((r) => r.sa3_code);
}
