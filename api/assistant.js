// Vercel serverless function (Node runtime, ESM) — the persistent chat
// assistant that replaces both the old ⌘K nav-copilot (api/copilot.js) and
// the per-clinic/per-region "ask a follow-up" Q&A (api/ask-read.js). See
// the plan file for full context on why.
//
// Unlike the old copilot.js (one generateObject call, one fixed intent
// schema, explicitly not agentic), this runs a real multi-step tool-calling
// loop: the model can call read-only Supabase-backed query tools to answer
// genuinely open questions ("highest workforce risk in NSW"), and/or call
// state-mutation tools to propose filter/navigation changes. Mutation
// tools never touch the database or the client's live map/filter state
// directly — each just validates its input and appends to a `planSteps`
// list returned to the client, which executes every step itself via its
// existing deterministic setter functions (Copilot.executePlan(), a direct
// port of the old applyCopilotIntent()/buildCopilotSteps()). This keeps
// copilot.js's original safety principle intact: the model never touches
// live state directly, it only ever proposes a plan.
//
// Read-only tools execute for real, server-side, directly against
// Supabase via plain REST (see api/_lib/supabaseRest.js) using the same
// publishable anon key already embedded client-side — no new credential,
// no @supabase/supabase-js dependency, no service-role key (see that
// file's own comment for why not).
//
// Routed through Vercel AI Gateway, same as before — no direct Anthropic
// API key, no auth gate (same public/unauthenticated posture as every
// other endpoint in this app).

import { generateText, tool, stepCountIs, gateway } from 'ai';
import { z } from 'zod';
import { supabaseSelect, fetchGazetteerNames, matchGazetteerRegion, fetchGazetteerMembers } from './_lib/supabaseRest.js';
import { formatAnswerHtml } from './_lib/formatAnswer.js';

const MODEL = 'anthropic/claude-sonnet-5';

// A real multi-step tool loop costs meaningfully more per request than the
// old single generateObject call (more tokens, more model round-trips, a DB
// round-trip per read tool) — these caps are tighter than copilot.js's/
// ask-read.js's old 10/60s specifically because each request is now far
// more expensive regardless of count.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 6;
const MAX_MESSAGES = 30;
const MAX_MESSAGES_CHARS = 16_000;
const MAX_NEW_MESSAGE_CHARS = 500; // up from ask-read.js's/copilot.js's 300 -- open analytical questions need more room
const MAX_STATE_CHARS = 2000;
const MAX_OUTPUT_TOKENS = 1500;
// A tiny cap combined with a real multi-tool loop (now three tool
// categories, including web search) risks the model spending its entire
// budget on tool calls and never reaching a final text step -- raised from
// 6, and paired with the prepareStep guard below that forces the *last*
// step to be text-only, so running out of budget can no longer produce a
// silently empty answer.
const MAX_STEPS = 8;

const STATE_NAMES = [
    'New South Wales', 'Victoria', 'Queensland', 'Western Australia',
    'South Australia', 'Tasmania', 'Australian Capital Territory', 'Northern Territory'
];

// Best-effort only: resets on cold start and isn't shared across concurrent
// Vercel instances. A speed bump against casual abuse, not a guarantee.
const requestLog = new Map();

function isRateLimited(key) {
    const now = Date.now();
    const timestamps = (requestLog.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    timestamps.push(now);
    requestLog.set(key, timestamps);
    return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

function buildSystemPrompt(gazetteer, stateJson) {
    const regionList = gazetteer.length
        ? gazetteer.map((r) => `"${r.name}"${r.aliases.length ? ` (aliases: ${r.aliases.join(', ')})` : ''}`).join('; ')
        : '(none loaded)';
    return `You are Foundry Health's in-app assistant for a clinic-acquisition screening map covering GP, ` +
        `Physiotherapy and Dental clinics across Australia. You can both answer open questions about the real data ` +
        `and propose changes to what the map/rail currently shows. You do not execute anything yourself — filter/ ` +
        `navigation changes are only ever a proposed plan; the app applies it deterministically afterward, exactly ` +
        `like every other action in this app.\n\n` +
        `## Tools\n` +
        `You have three kinds of tools. Read-only tools (resolve_gazetteer_region, query_sa3_regions, query_clinics, ` +
        `summarize_clinic_chain, query_data_coverage, query_gp_billing) query the real database directly and return ` +
        `real rows — use them freely, including multiple calls in one turn, to actually answer analytical questions ` +
        `instead of guessing. State-change tools (set_scoring_market, toggle_clinic_layer, set_geography_filter, ` +
        `load_catalogue_dataset, set_ground_filter, set_colour_by_lens, focus_on_region, focus_on_clinic) only ever ` +
        `stage a change — call them when the user is asking you to change what's shown, not just answer a question. ` +
        `search_web searches the public internet — use it only for general context this app's database doesn't ` +
        `track (industry news, regulatory background, general healthcare/demographic context); never use it to ` +
        `answer a question about this app's own regions/clinics/scores, which must always come from the read-only ` +
        `tools above.\n\n` +
        `## Ground rules\n` +
        `- Query before propose: never call focus_on_region/focus_on_clinic, or put a regionName into ` +
        `set_geography_filter, unless that exact sa3Code/clinicId/regionName already came back from a read tool ` +
        `earlier in THIS conversation. If a mutation tool rejects your input for this reason, call the matching read ` +
        `tool first, then retry.\n` +
        `- Never state a specific region name, SA3 code, clinic name/id, score, or figure tracked by this app unless ` +
        `it came from a read-only tool result already in this conversation. If you don't have it, say so plainly — ` +
        `never estimate, and never fall back on general knowledge about Australian geography or healthcare to fill a ` +
        `gap in this app's own data.\n` +
        `- search_web results are the one exception to "don't use general knowledge" — you may state what a web ` +
        `search returns, but always attribute it plainly (e.g. "From a web search:") so the user can tell this ` +
        `app's own data apart from outside context. Never blend the two into one unattributed claim, and never use ` +
        `a web result to override or fill in a figure this app is supposed to track itself.\n` +
        `- This app's own data always outranks search_web when the two disagree. If a web result contradicts a ` +
        `read-only tool result (e.g. a clinic count, a chain's footprint, a demographic figure this app tracks), ` +
        `state the app's own figure as the answer, and only mention the web figure as a flagged discrepancy (e.g. ` +
        `"this app shows N; a web search suggested a different figure, but this app's own data should be treated ` +
        `as authoritative here") -- never silently prefer the web figure, and never average or split the difference ` +
        `between the two.\n` +
        `- Real, curated named regions (valid resolve_gazetteer_region / regionName values, matched case-insensitively ` +
        `including aliases): ${regionList}. If a named place isn't in this list, resolve_gazetteer_region will tell ` +
        `you so — don't guess a nearby real region instead.\n` +
        `- "Independent ownership" is a clinic-level filter (set_ground_filter's archetype.ownership), not a region ` +
        `metric.\n` +
        `- "Low/thin competitive density" -> set_ground_filter's lowDensity:true. This aliases the region's own ` +
        `Supply score (fewer clinics relative to population = higher score) -- never compute or invent a threshold ` +
        `yourself.\n` +
        `- Historical/trend comparisons ("since 2019", "how has X changed") and deal-availability asks ("likely to ` +
        `sell", "distressed sellers") are genuinely out of scope -- this platform is a single snapshot with no deal-` +
        `state data. Say so plainly in your answer; don't guess.\n` +
        `- Before claiming a field/dataset "isn't available" or the data "is too sparse to trust" for a market, call ` +
        `query_data_coverage and use its real numbers -- don't assume from the field's name alone. A market can also ` +
        `have literally zero clinics on file (check totalMatches/coverage before describing a market's data at all).\n` +
        `- Use the conversation so far to resolve follow-ups ("now just the top 5", "does this one have workforce ` +
        `risk issues" while the user is looking at a specific region/clinic, per the currentState below) -- only ` +
        `change what the new message actually asks to change.\n` +
        `- Match this app's own direct, specific voice -- never generic assistant phrasing like "I've filtered the ` +
        `results for you!" or "Sure, I can help with that!".\n\n` +
        `## Deep-link tokens\n` +
        `When your answer names a specific region, clinic, or chain you have real grounding for (from a tool result ` +
        `this turn), you may reference it as a clickable token instead of plain text: [[region:SA3_CODE|Label]], ` +
        `[[clinic:CLINIC_ID|Label]], [[chain:CHAIN_NAME|Label]]. You may also link to a part of the app: ` +
        `[[tab:targets|Label]] (tab is one of map/list/targets) or [[catalogue:seifa|Label]] (catalogue is one of ` +
        `seifa/workforce/gpBillings). Only use a token id you actually have grounding for -- an ungrounded token is ` +
        `silently dropped to plain text, so there's no benefit to guessing one.\n\n` +
        `## Current app state (JSON, refreshed live every message)\n${stateJson}`;
}

// ============================================================
// Tool set
// ============================================================
// `grounded` and `planSteps` are per-request closures (created fresh inside
// the handler below, not module-level) — see buildTools().
function buildTools(grounded, planSteps, skipped) {
    return {
        // ---- Read-only query tools (execute for real, server-side) ----
        resolve_gazetteer_region: tool({
            description: 'Resolve a colloquial named region (e.g. "South-East Queensland", "SEQ", "Western Sydney", ' +
                '"Greater Melbourne") to its real SA3 code list. Call this before using a regionName in ' +
                'set_geography_filter or query_sa3_regions\'s regionNames, and before telling the user a region ' +
                '"isn\'t available" -- check here first.',
            inputSchema: z.object({ name: z.string() }),
            execute: async ({ name }) => {
                const gazetteer = await fetchGazetteerNames();
                const match = matchGazetteerRegion(gazetteer, name);
                if (!match) return { matched: false, suggestions: gazetteer.slice(0, 20).map((r) => r.name) };
                const sa3Codes = await fetchGazetteerMembers(match.name);
                grounded.regionName.add(match.name);
                sa3Codes.forEach((c) => grounded.sa3.add(c));
                return { matched: true, regionName: match.name, sa3Codes, sa3Count: sa3Codes.length };
            }
        }),

        query_sa3_regions: tool({
            description: 'Query SA3 regions by state, tier, named gazetteer regions, a specific SA3\'s own name, or ' +
                'score/workforce-risk thresholds. Use this to answer open analytical questions ("highest workforce ' +
                'risk in NSW") or to compare named regions in one call. Returns compact rows plus totalMatches -- ' +
                'always report totalMatches honestly if the result was truncated to the limit.',
            inputSchema: z.object({
                state: z.enum(STATE_NAMES).optional(),
                tier: z.array(z.number().int().min(1).max(5)).optional(),
                regionNames: z.array(z.string()).optional()
                    .describe('Real gazetteer region names (from resolve_gazetteer_region).'),
                sa3NameContains: z.string().optional()
                    .describe('Partial, case-insensitive match on the SA3\'s own name -- for "show me X" about one specific region, not a named group.'),
                compositeScoreMin: z.number().optional(),
                compositeScoreMax: z.number().optional(),
                supplyScoreMin: z.number().optional(),
                supplyScoreMax: z.number().optional(),
                workforceRiskMin: z.number().optional(),
                workforceRiskMax: z.number().optional(),
                dpaBonded: z.boolean().optional(),
                dpaGpImg: z.boolean().optional(),
                sortBy: z.enum(['composite_score', 'demand_score', 'supply_score', 'competition_score', 'economics_score', 'workforce_risk_score']).optional(),
                sortDir: z.enum(['asc', 'desc']).optional(),
                limit: z.number().int().min(1).max(50).optional()
            }),
            execute: async (args) => {
                let sa3CodeAllowlist = null;
                if (args.regionNames?.length) {
                    const sets = await Promise.all(args.regionNames.map((n) => fetchGazetteerMembers(n)));
                    sa3CodeAllowlist = [...new Set(sets.flat())];
                    if (!sa3CodeAllowlist.length) {
                        return { rows: [], totalMatches: 0, note: 'None of the given regionNames resolved -- call resolve_gazetteer_region first.' };
                    }
                }
                const params = [
                    ['select', 'sa3_code,sa3_name,state,tier,composite_score,demand_score,supply_score,competition_score,economics_score,workforce_risk_score,dpa_bonded,dpa_gp_img,population_y25,corporate_share']
                ];
                if (args.state) params.push(['state', `eq.${args.state}`]);
                if (args.tier?.length) params.push(['tier', `in.(${args.tier.join(',')})`]);
                if (sa3CodeAllowlist) params.push(['sa3_code', `in.(${sa3CodeAllowlist.join(',')})`]);
                if (args.sa3NameContains) params.push(['sa3_name', `ilike.*${args.sa3NameContains}*`]);
                if (args.compositeScoreMin != null) params.push(['composite_score', `gte.${args.compositeScoreMin}`]);
                if (args.compositeScoreMax != null) params.push(['composite_score', `lte.${args.compositeScoreMax}`]);
                if (args.supplyScoreMin != null) params.push(['supply_score', `gte.${args.supplyScoreMin}`]);
                if (args.supplyScoreMax != null) params.push(['supply_score', `lte.${args.supplyScoreMax}`]);
                if (args.workforceRiskMin != null) params.push(['workforce_risk_score', `gte.${args.workforceRiskMin}`]);
                if (args.workforceRiskMax != null) params.push(['workforce_risk_score', `lte.${args.workforceRiskMax}`]);
                if (args.dpaBonded != null) params.push(['dpa_bonded', `eq.${args.dpaBonded}`]);
                if (args.dpaGpImg != null) params.push(['dpa_gp_img', `eq.${args.dpaGpImg}`]);
                const limit = args.limit || 20;
                params.push(['order', `${args.sortBy || 'composite_score'}.${args.sortDir || 'desc'}`]);
                params.push(['limit', String(limit)]);

                const rows = await supabaseSelect('sa3', params);
                rows.forEach((r) => grounded.sa3.add(r.sa3_code));

                // totalMatches: a second, count-only request with the same
                // filters (Prefer: count=exact) so the model can honestly say
                // "N match, showing top limit" rather than assuming rows.length
                // is the whole answer.
                const countParams = params.filter(([k]) => k !== 'select' && k !== 'order' && k !== 'limit');
                countParams.unshift(['select', 'sa3_code']);
                let totalMatches = rows.length;
                try {
                    const qs = new URLSearchParams(countParams).toString();
                    const res = await fetch(`https://ytervdshmvdawoomhnlp.supabase.co/rest/v1/sa3?${qs}`, {
                        headers: {
                            apikey: 'sb_publishable_3cXEeYAJg3u3CX_j8ITJQg_jLLPouw-',
                            Authorization: 'Bearer sb_publishable_3cXEeYAJg3u3CX_j8ITJQg_jLLPouw-',
                            Prefer: 'count=exact',
                            Range: '0-0'
                        }
                    });
                    const contentRange = res.headers.get('content-range');
                    if (contentRange?.includes('/')) {
                        const total = contentRange.split('/')[1];
                        if (total && total !== '*') totalMatches = parseInt(total, 10);
                    }
                } catch { /* fall back to rows.length */ }

                return { rows, totalMatches, returned: rows.length };
            }
        }),

        query_clinics: tool({
            description: 'Query clinics for one market by region/state/ownership/chain/billing/GP count/rating. ' +
                'Returns compact rows plus totalMatches.',
            inputSchema: z.object({
                marketId: z.enum(['gp', 'physio', 'dental']),
                sa3Codes: z.array(z.string()).optional(),
                regionName: z.string().optional().describe('Real gazetteer region name (from resolve_gazetteer_region).'),
                stateCode: z.string().optional(),
                nameContains: z.string().optional(),
                ownership: z.string().optional(),
                corporateChain: z.string().optional(),
                billingType: z.string().optional(),
                gpCountMin: z.number().optional(),
                googleRatingMin: z.number().optional(),
                sortBy: z.enum(['gp_count', 'google_rating', 'google_review_count']).optional(),
                sortDir: z.enum(['asc', 'desc']).optional(),
                limit: z.number().int().min(1).max(30).optional()
            }),
            execute: async (args) => {
                let sa3CodeAllowlist = args.sa3Codes?.length ? args.sa3Codes : null;
                if (!sa3CodeAllowlist && args.regionName) {
                    sa3CodeAllowlist = await fetchGazetteerMembers(args.regionName);
                    if (!sa3CodeAllowlist.length) return { rows: [], totalMatches: 0, note: 'regionName did not resolve -- call resolve_gazetteer_region first.' };
                }
                const params = [
                    ['select', 'clinic_id,name,suburb,state_code,sa3_name,ownership,corporate_chain,gp_count,billing_type,google_rating,google_review_count'],
                    ['market_id', `eq.${args.marketId}`]
                ];
                if (sa3CodeAllowlist) params.push(['sa3_code', `in.(${sa3CodeAllowlist.join(',')})`]);
                if (args.stateCode) params.push(['state_code', `eq.${args.stateCode}`]);
                if (args.nameContains) params.push(['name', `ilike.*${args.nameContains}*`]);
                if (args.ownership) params.push(['ownership', `eq.${args.ownership}`]);
                if (args.corporateChain) params.push(['corporate_chain', `eq.${args.corporateChain}`]);
                if (args.billingType) params.push(['billing_type', `eq.${args.billingType}`]);
                if (args.gpCountMin != null) params.push(['gp_count', `gte.${args.gpCountMin}`]);
                if (args.googleRatingMin != null) params.push(['google_rating', `gte.${args.googleRatingMin}`]);
                const limit = args.limit || 15;
                params.push(['order', `${args.sortBy || 'gp_count'}.${args.sortDir || 'desc'}`]);
                params.push(['limit', String(limit)]);

                const rows = await supabaseSelect('clinics', params);
                rows.forEach((r) => {
                    grounded.clinic.add(String(r.clinic_id));
                    if (r.corporate_chain) grounded.chain.add(r.corporate_chain);
                });
                return { rows, totalMatches: rows.length === limit ? `at least ${limit}` : rows.length, returned: rows.length };
            }
        }),

        summarize_clinic_chain: tool({
            description: 'Aggregate clinic counts/GP headcount for one or more corporate chains -- use for "compare ' +
                'chain X vs Y" rather than listing individual clinics.',
            inputSchema: z.object({
                marketId: z.enum(['gp', 'physio', 'dental']),
                chainName: z.string().optional(),
                sa3Codes: z.array(z.string()).optional(),
                regionName: z.string().optional()
            }),
            execute: async (args) => {
                let sa3CodeAllowlist = args.sa3Codes?.length ? args.sa3Codes : null;
                if (!sa3CodeAllowlist && args.regionName) {
                    sa3CodeAllowlist = await fetchGazetteerMembers(args.regionName);
                    if (!sa3CodeAllowlist.length) return { chains: [], note: 'regionName did not resolve -- call resolve_gazetteer_region first.' };
                }
                const params = [
                    ['select', 'corporate_chain,sa3_code,gp_count'],
                    ['market_id', `eq.${args.marketId}`],
                    ['corporate_chain', 'not.is.null']
                ];
                if (args.chainName) params.push(['corporate_chain', `eq.${args.chainName}`]);
                if (sa3CodeAllowlist) params.push(['sa3_code', `in.(${sa3CodeAllowlist.join(',')})`]);
                params.push(['limit', '5000']);

                const rows = await supabaseSelect('clinics', params);
                const byChain = {};
                rows.forEach((r) => {
                    const key = r.corporate_chain;
                    if (!byChain[key]) byChain[key] = { chainName: key, clinicCount: 0, sa3s: new Set(), gpCountSum: 0, gpCountN: 0 };
                    byChain[key].clinicCount++;
                    byChain[key].sa3s.add(r.sa3_code);
                    if (r.gp_count != null) { byChain[key].gpCountSum += r.gp_count; byChain[key].gpCountN++; }
                });
                const chains = Object.values(byChain).map((c) => ({
                    chainName: c.chainName,
                    clinicCount: c.clinicCount,
                    distinctSa3Count: c.sa3s.size,
                    avgGpCount: c.gpCountN ? Math.round((c.gpCountSum / c.gpCountN) * 10) / 10 : null
                })).sort((a, b) => b.clinicCount - a.clinicCount);
                chains.forEach((c) => grounded.chain.add(c.chainName));
                return { chains };
            }
        }),

        query_data_coverage: tool({
            description: 'Check how completely a field is populated for a market/region -- use this before claiming ' +
                'data "isn\'t available" or "is too sparse to trust". Distinguishes a genuinely sparse field from a ' +
                'market with zero clinics recorded at all.',
            inputSchema: z.object({
                marketId: z.enum(['gp', 'physio', 'dental']),
                sa3Code: z.string().optional(),
                regionName: z.string().optional(),
                field: z.enum(['gp_count', 'billing_type', 'allied_health', 'pathology', 'radiology_imaging', 'doctor_names', 'clinic_format']).optional()
            }),
            execute: async (args) => {
                if (args.sa3Code || args.regionName) {
                    let sa3Codes = args.sa3Code ? [args.sa3Code] : await fetchGazetteerMembers(args.regionName);
                    if (!sa3Codes.length) return { rows: [], note: 'regionName did not resolve -- call resolve_gazetteer_region first.' };
                    const params = [
                        ['select', 'sa3_code,field,total,populated,pct_populated'],
                        ['market_id', `eq.${args.marketId}`],
                        ['sa3_code', `in.(${sa3Codes.join(',')})`]
                    ];
                    if (args.field) params.push(['field', `eq.${args.field}`]);
                    const rows = await supabaseSelect('clinic_data_coverage', params);
                    return { rows, scope: 'per-region', noDataAtAllForMarket: rows.length === 0 };
                }
                const params = [
                    ['select', 'field,total,populated,pct_populated'],
                    ['market_id', `eq.${args.marketId}`]
                ];
                if (args.field) params.push(['field', `eq.${args.field}`]);
                const rows = await supabaseSelect('clinic_data_coverage_by_market', params);
                return { rows, scope: 'market-wide', noDataAtAllForMarket: rows.length === 0 };
            }
        }),

        query_gp_billing: tool({
            description: 'GP-only Medicare billing/bulk-billing stats by SA3. Returns {applicable:false} if called for physio/dental.',
            inputSchema: z.object({
                marketId: z.enum(['gp', 'physio', 'dental']),
                sa3Codes: z.array(z.string()).optional(),
                regionName: z.string().optional(),
                state: z.enum(STATE_NAMES).optional()
            }),
            execute: async (args) => {
                if (args.marketId !== 'gp') return { applicable: false, reason: 'GP billing data only exists for the GP market.' };
                let sa3CodeAllowlist = args.sa3Codes?.length ? args.sa3Codes : null;
                if (!sa3CodeAllowlist && args.regionName) {
                    sa3CodeAllowlist = await fetchGazetteerMembers(args.regionName);
                    if (!sa3CodeAllowlist.length) return { applicable: true, rows: [], note: 'regionName did not resolve -- call resolve_gazetteer_region first.' };
                }
                const params = [
                    ['select', 'sa3_code,sa3_name,state,mbs_bulk_billing_rate,avg_patient_contribution,fee_charged,out_of_pocket,mbs_bb_rate_l3y_cagr']
                ];
                if (sa3CodeAllowlist) params.push(['sa3_code', `in.(${sa3CodeAllowlist.join(',')})`]);
                if (args.state) params.push(['state', `eq.${args.state}`]);
                params.push(['limit', '50']);
                const rows = await supabaseSelect('gp_billing_sa3_ltm', params);
                rows.forEach((r) => { if (r.sa3_code) grounded.sa3.add(r.sa3_code); });
                return { applicable: true, rows };
            }
        }),

        // ---- State-mutation tools (validate + queue a plan step only) ----
        set_scoring_market: tool({
            description: 'Switch which market (gp/physio/dental) is being scored. Only call if explicitly asked to change it.',
            inputSchema: z.object({ market: z.enum(['gp', 'physio', 'dental']) }),
            execute: async ({ market }) => {
                planSteps.push({ tool: 'set_scoring_market', args: { market } });
                return { ok: true };
            }
        }),

        toggle_clinic_layer: tool({
            description: 'Toggle a clinic-pin map overlay layer on/off, independent of the scoring market. Call once per layer changed.',
            inputSchema: z.object({ layer: z.enum(['gp', 'physio', 'dental']), on: z.boolean() }),
            execute: async ({ layer, on }) => {
                planSteps.push({ tool: 'toggle_clinic_layer', args: { layer, on } });
                return { ok: true };
            }
        }),

        set_geography_filter: tool({
            description: 'Set geographic scope: a state, a named region (must be resolved via resolve_gazetteer_region ' +
                'first), and/or MMM remoteness classes 1-7.',
            inputSchema: z.object({
                state: z.enum(STATE_NAMES).nullable().optional(),
                regionName: z.string().nullable().optional(),
                remoteness: z.array(z.number().int().min(1).max(7)).optional()
            }),
            execute: async ({ state, regionName, remoteness }) => {
                let resolvedRegionName = null;
                if (regionName) {
                    const gazetteer = await fetchGazetteerNames();
                    const match = matchGazetteerRegion(gazetteer, regionName);
                    if (!match) {
                        skipped.push(`geography: "${regionName}" is not a recognized named region`);
                        return { ok: false, reason: `"${regionName}" isn't a recognized named region -- call resolve_gazetteer_region first, or drop this filter.` };
                    }
                    resolvedRegionName = match.name;
                }
                planSteps.push({ tool: 'set_geography_filter', args: { state: state || null, regionName: resolvedRegionName, remoteness: remoteness || [] } });
                return { ok: true };
            }
        }),

        load_catalogue_dataset: tool({
            description: 'Load one or more Data Catalogue datasets so their filters become available. Required before ' +
                'set_ground_filter can use seifaDeciles/workforceRiskMin/dpaBonded/dpaGpImg.',
            inputSchema: z.object({ datasets: z.array(z.enum(['seifa', 'workforce', 'gpBillings'])) }),
            execute: async ({ datasets }) => {
                planSteps.push({ tool: 'load_catalogue_dataset', args: { datasets } });
                return { ok: true };
            }
        }),

        set_ground_filter: tool({
            description: 'Set ground-level narrowing filters: composite tier band, SEIFA deciles, minimum workforce ' +
                'risk, DPA flags, clinic archetype (format/billing/ownership), and/or low competitive density (aliases ' +
                'the Supply score -- never invent a number).',
            inputSchema: z.object({
                tier: z.array(z.number().int().min(1).max(5)).optional(),
                seifaDeciles: z.array(z.number().int().min(1).max(10)).optional(),
                workforceRiskMin: z.number().min(0).max(100).nullable().optional(),
                dpaBonded: z.boolean().nullable().optional(),
                dpaGpImg: z.boolean().nullable().optional(),
                archetype: z.object({
                    format: z.array(z.enum(['Big-box', 'Mid-format', 'Small'])).optional(),
                    billing: z.array(z.enum(['Bulk', 'Mixed', 'Private'])).optional(),
                    ownership: z.array(z.enum(['Corporate', 'Independent'])).optional()
                }).nullable().optional(),
                lowDensity: z.boolean().optional()
            }),
            execute: async (args) => {
                planSteps.push({ tool: 'set_ground_filter', args });
                return { ok: true };
            }
        }),

        set_colour_by_lens: tool({
            description: 'Change the map colour-by lens.',
            inputSchema: z.object({ lens: z.enum(['composite', 'whitespace', 'workforce', 'seifa']) }),
            execute: async ({ lens }) => {
                planSteps.push({ tool: 'set_colour_by_lens', args: { lens } });
                return { ok: true };
            }
        }),

        focus_on_region: tool({
            description: 'Navigate the map camera and open the detail drawer for one specific region. sa3Code MUST ' +
                'come from a query_sa3_regions or resolve_gazetteer_region result already in this conversation.',
            inputSchema: z.object({ sa3Code: z.string(), label: z.string() }),
            execute: async ({ sa3Code, label }) => {
                if (!grounded.sa3.has(sa3Code)) {
                    skipped.push(`focus: SA3 ${sa3Code} was not looked up first`);
                    return { ok: false, reason: 'That SA3 code did not come from a tool result this turn -- call query_sa3_regions first.' };
                }
                planSteps.push({ tool: 'focus_on_region', args: { sa3Code, label } });
                return { ok: true };
            }
        }),

        focus_on_clinic: tool({
            description: 'Navigate the map camera and open the detail drawer for one specific clinic. clinicId MUST ' +
                'come from a query_clinics result already in this conversation.',
            inputSchema: z.object({ clinicId: z.string(), label: z.string() }),
            execute: async ({ clinicId, label }) => {
                if (!grounded.clinic.has(String(clinicId))) {
                    skipped.push(`focus: clinic ${clinicId} was not looked up first`);
                    return { ok: false, reason: 'That clinic id did not come from a query_clinics result this turn -- call query_clinics first.' };
                }
                planSteps.push({ tool: 'focus_on_clinic', args: { clinicId, label } });
                return { ok: true };
            }
        }),

        // ---- Provider-executed tool (gateway-native — runs under the same
        // AI_GATEWAY_API_KEY/OIDC credential already used for the model
        // call, no new secret required, works regardless of which model
        // string is routed to). Never touches `grounded` -- web results
        // don't produce sa3/clinic/chain ids, so there's nothing for the
        // deep-link/mutation-tool grounding checks to track here.
        search_web: gateway.tools.perplexitySearch({ maxResults: 5 })
    };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const clientKey = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    if (isRateLimited(clientKey)) {
        res.status(429).json({ error: 'Too many requests — try again in a minute.' });
        return;
    }

    if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
        res.status(500).json({ error: 'Server is not configured for the assistant yet.' });
        return;
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = null; }
    }
    let { messages, currentState } = body || {};

    if (!Array.isArray(messages) || !messages.length) {
        res.status(400).json({ error: 'Missing messages.' });
        return;
    }
    if (!messages.every((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')) {
        res.status(400).json({ error: 'Invalid messages.' });
        return;
    }
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user' || !lastMessage.text.trim()) {
        res.status(400).json({ error: 'Last message must be a non-empty user message.' });
        return;
    }
    if (lastMessage.text.length > MAX_NEW_MESSAGE_CHARS) {
        res.status(400).json({ error: `Message is too long (max ${MAX_NEW_MESSAGE_CHARS} characters).` });
        return;
    }

    // Bound conversation growth: keep the most recent MAX_MESSAGES entries,
    // then trim further from the front if still over the char budget —
    // mirrors copilot.js's old MAX_HISTORY_TURNS/MAX_STATE_CHARS caps, just
    // sized for a real multi-turn thread instead of a 6-entry breadcrumb log.
    messages = messages.slice(-MAX_MESSAGES);
    while (messages.length > 1 && messages.reduce((n, m) => n + m.text.length, 0) > MAX_MESSAGES_CHARS) {
        messages.shift();
    }

    const stateJson = JSON.stringify(currentState ?? {});
    if (stateJson.length > MAX_STATE_CHARS) {
        res.status(400).json({ error: 'currentState payload too large.' });
        return;
    }

    try {
        const gazetteer = await fetchGazetteerNames();
        const grounded = { sa3: new Set(), clinic: new Set(), chain: new Set(), regionName: new Set() };
        const planSteps = [];
        const skipped = [];

        const result = await generateText({
            model: MODEL,
            system: buildSystemPrompt(gazetteer, stateJson),
            messages: messages.map((m) => ({ role: m.role, content: m.text })),
            tools: buildTools(grounded, planSteps, skipped),
            stopWhen: stepCountIs(MAX_STEPS),
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            // Guarantees a non-empty final answer even if every prior step
            // was spent on tool calls: on the last allowed step, disable
            // tools entirely so the model is structurally unable to do
            // anything but write its final text response using whatever
            // it already gathered. Without this, hitting the step cap
            // mid-tool-call silently returns empty text (see the `!raw`
            // check below, which this makes unreachable in practice).
            prepareStep: ({ stepNumber }) => (
                stepNumber === MAX_STEPS - 1 ? { toolChoice: 'none' } : {}
            )
        });

        const raw = (result.text || '').trim();
        console.log('[assistant] usage', result.usage, 'steps', result.steps?.length, 'planSteps', planSteps.length);

        if (!raw) {
            res.status(502).json({ error: 'Model returned an empty answer — try rephrasing.' });
            return;
        }

        const answer = formatAnswerHtml(raw, grounded);
        const plan = planSteps.length
            ? { status: skipped.length ? 'partial' : 'applied', steps: planSteps, skipped }
            : null;

        res.status(200).json({ answer, plan });
    } catch (err) {
        console.error('[assistant] Gateway/model error', err);
        res.status(502).json({ error: "Couldn't reach the model just now — try again." });
    }
}
