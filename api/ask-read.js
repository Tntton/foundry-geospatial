// Vercel serverless function (Node runtime, ESM — see package.json's
// "type": "module") that answers ONE free-text follow-up question about a
// single clinic or SA3 region's already-computed Acquisition/Region read
// (see computeAcquisitionRead()/computeRegionRead() in src/js/app.js). This
// is the only part of that feature that calls a live model — the
// four-dimension scorecard itself stays a deterministic heuristic (see plan
// Phase 5/6).
//
// Routed through Vercel AI Gateway (not a direct Anthropic API key) so the
// model can be swapped later without touching credentials — see plan Phase 6
// addendum. AI_GATEWAY_API_KEY lives only in Vercel's Environment Variables
// and must never be sent to or read by the client. There is deliberately no
// auth gate here (confirmed choice), so the caps below (question length,
// context size, max output tokens, best-effort per-IP rate limit) are the
// actual cost/abuse mitigation for this being a public, unauthenticated
// endpoint.

import { generateText } from 'ai';

const MODEL = 'anthropic/claude-sonnet-5';
const MAX_QUESTION_CHARS = 300;
const MAX_CONTEXT_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 1500; // generous headroom (not unlimited — no auth gate on this endpoint) so answers essentially never get cut mid-sentence
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

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

function buildInstructions(scope) {
    const subject = scope === 'region' ? 'a single SA3 region' : 'a single clinic';
    return `Answer one scoped question about ${subject} for Foundry Health's acquisition screening tool. ` +
        `Use ONLY the JSON fields provided in the user message — never invent figures, ownership relationships, ` +
        `or comparisons to data not given. If the question can't be answered from these fields, say so plainly ` +
        `instead of guessing. Respond with a single short paragraph of plain prose only, 2-3 sentences, under 60 ` +
        `words total. Do not use ANY markdown syntax — no headings, no "#", no bold/"**", no bullet or numbered ` +
        `lists. Just plain sentences.`;
}

// Best-effort cleanup for whatever formatting the model produces despite the
// instruction above — different models comply with varying reliability, so
// this is defense-in-depth, not the primary mechanism. Also guards against
// the model ever echoing HTML-like content into what becomes innerHTML.
function sanitizeAnswer(text) {
    let t = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    t = t.replace(/^#{1,6}\s+/gm, '');           // heading markers
    t = t.replace(/\*\*(.+?)\*\*/g, '$1');       // bold
    t = t.replace(/^[-*]\s+/gm, '');             // bullet markers
    t = t.replace(/\n{2,}/g, '\n').trim();
    return t;
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

    // Auth: an explicit AI_GATEWAY_API_KEY (if set) takes priority; otherwise
    // the AI SDK automatically falls back to this Vercel deployment's own
    // OIDC token (VERCEL_OIDC_TOKEN, auto-populated on every Vercel
    // deployment, scoped to the project's own team/plan — no key to manage).
    // Only bail out early if genuinely neither is available (e.g. running
    // locally outside `vercel dev`/`vercel env pull`).
    if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
        res.status(500).json({ error: 'Server is not configured for live answers yet.' });
        return;
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = null; }
    }
    const { scope, question, context } = body || {};

    if (!question || typeof question !== 'string' || !question.trim()) {
        res.status(400).json({ error: 'Missing question.' });
        return;
    }
    if (question.length > MAX_QUESTION_CHARS) {
        res.status(400).json({ error: `Question is too long (max ${MAX_QUESTION_CHARS} characters).` });
        return;
    }
    if (scope !== 'clinic' && scope !== 'region') {
        res.status(400).json({ error: 'Invalid scope.' });
        return;
    }
    const contextJson = JSON.stringify(context ?? {});
    if (contextJson.length > MAX_CONTEXT_CHARS) {
        res.status(400).json({ error: 'Context payload too large.' });
        return;
    }

    try {
        const result = await generateText({
            model: MODEL,
            instructions: buildInstructions(scope),
            prompt: `Question: ${question.trim()}\n\nFields for this ${scope}:\n${contextJson}`,
            maxOutputTokens: MAX_OUTPUT_TOKENS
        });

        let answer = sanitizeAnswer((result.text || '').trim());
        console.log('[ask-read] usage', result.usage, 'finishReason', result.finishReason);

        if (!answer) {
            res.status(502).json({ error: 'Model returned an empty answer — try rephrasing.' });
            return;
        }

        // Hit the token cap mid-sentence — trim back to the last complete
        // sentence rather than showing a dangling half-word.
        if (result.finishReason === 'length') {
            const lastEnd = Math.max(answer.lastIndexOf('. '), answer.lastIndexOf('! '), answer.lastIndexOf('? '), answer.lastIndexOf('.\n'));
            if (lastEnd > 40) answer = answer.slice(0, lastEnd + 1).trim();
        }

        res.status(200).json({ answer });
    } catch (err) {
        console.error('[ask-read] Gateway/model error', err);
        res.status(502).json({ error: "Couldn't reach the model just now — try again." });
    }
}
