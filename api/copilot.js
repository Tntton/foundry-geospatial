// Vercel serverless function (Node runtime, ESM) that translates one
// natural-language ⌘K sentence into a single structured "intent" object —
// which market to score, which layers/filters/colour-by to apply, and
// whether to decline or partially apply the request. See plan Phase H
// ("Natural-language co-pilot") for full context.
//
// Deliberately NOT an agentic tool-calling loop: the model never touches
// live map/filter state directly. It reasons once over a compact summary of
// current state + a fixed list of real, curated gazetteer region names, and
// returns a plan; src/js/app.js's applyCopilotIntent() then executes every
// step itself, in a fixed safe order, computing the real camera fit
// mechanically from whatever actually matched. This mirrors the one
// existing precedent for "app state → LLM call" in this codebase
// (api/ask-read.js: the model reasons over already-computed fields, never
// re-derives or invents data) and keeps the brief's hard sequencing rules
// (filter-then-fit, let Mapbox pick zoom, never guess a region boundary)
// enforceable in code rather than left to model judgment.
//
// Routed through Vercel AI Gateway, same as ask-read.js — no direct
// Anthropic API key, no auth gate (same public/unauthenticated posture,
// same per-IP rate limit as the reasoning for that endpoint).

import { generateObject } from 'ai';
import { z } from 'zod';

const MODEL = 'anthropic/claude-sonnet-5';
const MAX_QUERY_CHARS = 300;
const MAX_HISTORY_TURNS = 6;
const MAX_STATE_CHARS = 2000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

// Same Supabase project + public/publishable anon key already embedded
// client-side in src/js/app.js (DATA_SUPABASE_URL/DATA_SUPABASE_ANON_KEY) —
// not a new secret, just reused server-side via plain REST so this file
// doesn't need a new npm dependency for a single lookup query.
const DATA_SUPABASE_URL = 'https://ytervdshmvdawoomhnlp.supabase.co';
const DATA_SUPABASE_ANON_KEY = 'sb_publishable_3cXEeYAJg3u3CX_j8ITJQg_jLLPouw-';

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

// Cached per cold-start (region_definitions is small, hand-curated, and
// changes rarely — see scripts/supabase_migration/schema.sql's "Gap 1"
// comment). Refetched if empty (e.g. first request after cold start, or if
// a prior fetch failed) rather than cached forever, so a genuinely new
// region added to the table shows up without a redeploy.
let gazetteerCache = null;

async function fetchGazetteerNames() {
    if (gazetteerCache && gazetteerCache.length) return gazetteerCache;
    try {
        const res = await fetch(
            `${DATA_SUPABASE_URL}/rest/v1/region_definitions?select=region_name,aliases`,
            { headers: { apikey: DATA_SUPABASE_ANON_KEY, Authorization: `Bearer ${DATA_SUPABASE_ANON_KEY}` } }
        );
        if (!res.ok) return [];
        const rows = await res.json();
        gazetteerCache = rows.map((r) => ({ name: r.region_name, aliases: r.aliases || [] }));
        return gazetteerCache;
    } catch {
        return [];
    }
}

const STATE_NAMES = [
    'New South Wales', 'Victoria', 'Queensland', 'Western Australia',
    'South Australia', 'Tasmania', 'Australian Capital Territory', 'Northern Territory'
];

const copilotIntentSchema = z.object({
    scoringMarket: z.enum(['gp', 'physio', 'dental']).nullable()
        .describe('Set only if the sentence asks to switch the scoring market. Null if unchanged.'),
    clinicLayers: z.object({
        add: z.array(z.enum(['gp', 'physio', 'dental'])),
        remove: z.array(z.enum(['gp', 'physio', 'dental']))
    }).nullable().describe('Map overlay layers to toggle on/off, independent of scoringMarket.'),
    geography: z.object({
        state: z.enum(STATE_NAMES).nullable(),
        regionName: z.string().nullable()
            .describe('Must exactly match one of the provided real gazetteer region names, or their listed aliases normalized back to the real name. Null if the sentence names no such region, or names one not in the provided list — never invent a boundary.'),
        remoteness: z.array(z.number().int().min(1).max(7))
    }).nullable(),
    catalogueLoads: z.array(z.enum(['seifa', 'workforce', 'gpBillings']))
        .describe('Data Catalogue stats that must be loaded before groundFilters below can apply (seifa deciles need seifa loaded, workforceRiskMin/dpa need workforce loaded, etc).'),
    groundFilters: z.object({
        tier: z.array(z.number().int().min(1).max(5)).describe('e.g. "tier 1 and 2" -> [1,2]'),
        seifaDeciles: z.array(z.number().int().min(1).max(10)),
        workforceRiskMin: z.number().min(0).max(100).nullable(),
        dpaBonded: z.boolean().nullable(),
        dpaGpImg: z.boolean().nullable(),
        archetype: z.object({
            format: z.array(z.enum(['Big-box', 'Mid-format', 'Small'])),
            billing: z.array(z.enum(['Bulk', 'Mixed', 'Private'])),
            ownership: z.array(z.enum(['Corporate', 'Independent']))
        }).nullable(),
        lowDensity: z.boolean()
            .describe('True if the sentence asks for low/thin competitive density. The frontend resolves this into a live percentile cutoff over supply_score — never invent or compute a number yourself.')
    }).nullable(),
    colourBy: z.enum(['composite', 'whitespace', 'workforce', 'seifa']).nullable(),
    focus: z.object({
        type: z.enum(['region', 'clinic']),
        name: z.string().describe('The region or clinic name/description as stated in the sentence, for the frontend to resolve to an id — you do not have ids.')
    }).nullable().describe('Set only for a direct "go to"/"show me" single-target ask, not a filter request.'),
    status: z.enum(['applied', 'partial', 'declined']),
    summary: z.string()
        .describe('One in-voice sentence, direct and specific like the rest of this app\'s copy (e.g. "12 regions match. Tier 1-2 and independent narrow it fast; density\'s thinner data here — check it before you underwrite."). Never generic chatbot phrasing like "I\'ve filtered the results for you!"'),
    skipped: z.array(z.string())
        .describe('For status:partial — plain description of what could not be applied and why (e.g. "billing mix — not in the catalogue for Physio yet").'),
    declineReason: z.string().nullable()
        .describe('For status:declined — plain scope-boundary explanation, e.g. "no historical snapshot data before this scoring vintage." Decline (do not guess) historical/trend/"since <year>" comparisons and deal-availability/"likely to sell" asks — this platform is a single snapshot and has no deal-state data.')
});

function buildSystemPrompt(gazetteer) {
    const regionList = gazetteer.length
        ? gazetteer.map((r) => `"${r.name}"${r.aliases.length ? ` (aliases: ${r.aliases.join(', ')})` : ''}`).join('; ')
        : '(none loaded — treat every regionName as unavailable, always null)';
    return `You translate one natural-language sentence into a structured filter/navigation intent for Foundry Health's ` +
        `clinic-acquisition screening map. You do not execute anything — you only describe intent; the app applies it ` +
        `deterministically afterward.\n\n` +
        `Real, curated named regions (the ONLY valid values for geography.regionName, matched case-insensitively ` +
        `including aliases, normalized to the exact name shown): ${regionList}\n\n` +
        `Valid states: ${STATE_NAMES.join(', ')}.\n\n` +
        `Ground rules:\n` +
        `- Never invent a region boundary, a data field, or a number not derivable from the request. If a named place ` +
        `isn't in the list above, leave geography.regionName null — do not guess a nearby real region instead.\n` +
        `- "Independent ownership" is a clinic-level filter (groundFilters.archetype.ownership), not a region metric.\n` +
        `- "Low/thin competitive density" -> groundFilters.lowDensity: true. Never compute or invent a score threshold.\n` +
        `- Historical/trend comparisons ("since 2019", "how has X changed") and deal-availability asks ("likely to ` +
        `sell", "distressed sellers") are out of scope — set status:"declined" with a plain declineReason, don't guess.\n` +
        `- If a request needs a catalogue stat not available for the current market (e.g. GP billing mix while ` +
        `scoring Physio), apply everything else and set status:"partial" with that item named in skipped.\n` +
        `- The summary line must match this app's own direct, specific voice — never generic assistant phrasing.\n` +
        `- Use the provided conversation history to resolve follow-ups like "now just the top 5" or "now just the ` +
        `independent ones" against what was already applied — only change what the new sentence actually asks to change.`;
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
        res.status(500).json({ error: 'Server is not configured for the co-pilot yet.' });
        return;
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = null; }
    }
    const { query, currentState, history } = body || {};

    if (!query || typeof query !== 'string' || !query.trim()) {
        res.status(400).json({ error: 'Missing query.' });
        return;
    }
    if (query.length > MAX_QUERY_CHARS) {
        res.status(400).json({ error: `Query is too long (max ${MAX_QUERY_CHARS} characters).` });
        return;
    }
    const stateJson = JSON.stringify(currentState ?? {});
    if (stateJson.length > MAX_STATE_CHARS) {
        res.status(400).json({ error: 'currentState payload too large.' });
        return;
    }
    const historyTurns = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];

    try {
        const gazetteer = await fetchGazetteerNames();
        const historyText = historyTurns.length
            ? historyTurns.map((h, i) => `${i + 1}. "${h.query}" -> ${h.summary}`).join('\n')
            : '(none — this is the first turn)';

        const result = await generateObject({
            model: MODEL,
            schema: copilotIntentSchema,
            system: buildSystemPrompt(gazetteer),
            prompt: `Current applied state: ${stateJson}\n\nConversation history:\n${historyText}\n\nNew sentence: ${query.trim()}`
        });

        const intent = result.object;

        // Defense in depth: never trust the model's regionName even though
        // the schema/prompt constrain it — null it out server-side unless it
        // resolves to a real curated name (case-insensitive, alias-aware).
        // A wrong boundary silently applied would be worse than none at all.
        if (intent.geography?.regionName) {
            const wanted = intent.geography.regionName.trim().toLowerCase();
            const match = gazetteer.find((r) =>
                r.name.toLowerCase() === wanted || r.aliases.some((a) => a.toLowerCase() === wanted)
            );
            intent.geography.regionName = match ? match.name : null;
        }

        console.log('[copilot] usage', result.usage, 'status', intent.status);
        res.status(200).json({ intent });
    } catch (err) {
        console.error('[copilot] Gateway/model error', err);
        res.status(502).json({ error: "Couldn't reach the model just now — try again." });
    }
}
