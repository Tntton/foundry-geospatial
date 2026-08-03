// Shared answer formatter for api/assistant.js. Generalizes the old
// api/ask-read.js's formatAnswerHtml(): same escape-first, then
// selectively-reintroduce-a-small-fixed-syntax approach (never a general
// markdown/HTML parser — the job is recognizing a small, fixed,
// non-recursive set of literal patterns and nothing else), extended with
// one more pass that recognizes deep-link tokens and turns them into safe
// clickable markup, reusing the app's own existing navigation entry points.
//
// Token syntax: [[kind:id|Label]], kind in {region, clinic, chain, tab,
// catalogue}. Regex deliberately disallows '|'/']' inside id/label so the
// pattern stays non-recursive and the escaping surface stays small.
//
// Grounding: region/clinic/chain ids must have appeared in a tool result
// earlier in this same conversation turn (the caller passes a `grounded`
// object of Sets built while running the tool loop — see api/assistant.js).
// tab/catalogue ids are validated against a small fixed allowlist instead,
// since they're not queried entities, just fixed navigation targets. A
// token whose id isn't grounded/allowed is dropped to plain label text —
// never a dead or wrong link, never silently disappeared.

const TOKEN_RE = /\[\[(region|clinic|chain|tab|catalogue):([^|\]]{1,80})\|([^\]]{1,80})\]\]/g;

const TAB_ALLOWLIST = new Set(['map', 'list', 'targets']);
// Mirrors copilotIntentSchema's catalogueLoads enum (api/assistant.js) — the
// only real, loadable optional Data Catalogue datasets that exist today.
const CATALOGUE_ALLOWLIST = new Set(['seifa', 'workforce', 'gpBillings']);

function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Mirrors src/js/app.js's escJsAttr() exactly — safe interpolation inside a
// single-quoted inline onclick="...('...')" attribute string.
function escJsAttrServer(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Token kind -> grounded-set key. "region" tokens carry an sa3Code, which
// api/assistant.js tracks under grounded.sa3 (matching query_sa3_regions'
// own field name) rather than grounded.region — mapped here so the two
// naming conventions (token vocabulary vs. tool/column vocabulary) don't
// have to match by coincidence.
const KIND_TO_GROUNDED_KEY = { region: 'sa3', clinic: 'clinic', chain: 'chain' };

function isGrounded(kind, id, grounded) {
    if (kind === 'tab') return TAB_ALLOWLIST.has(id);
    if (kind === 'catalogue') return CATALOGUE_ALLOWLIST.has(id);
    return !!grounded?.[KIND_TO_GROUNDED_KEY[kind]]?.has(id);
}

// Converts a single already-HTML-escaped text segment's deep-link tokens.
// Called after the bold/list/paragraph pass below, on the assembled HTML —
// tokens are plain-text-safe (no '<'/'>'/'&' in the syntax itself) so
// running this last doesn't interact badly with the '<strong>'/'<ul><li>'
// tags already introduced.
function linkifyTokens(html, grounded) {
    return html.replace(TOKEN_RE, (whole, kind, id, label) => {
        if (!isGrounded(kind, id, grounded)) return label;
        return `<button type="button" class="cop-token cop-token-${kind}" onclick="Copilot.followLink('${kind}','${escJsAttrServer(id)}')">${label}</button>`;
    });
}

// Same constrained-markdown-to-HTML conversion as the old ask-read.js
// (bold via **, bullets via "- "/"1. ", paragraphs via blank lines) — moved
// here verbatim so both the assistant's tool-loop answer and any future
// caller share one implementation.
export function formatAnswerHtml(text, grounded) {
    let t = escapeHtml(text);
    t = t.replace(/^#{1,6}\s+/gm, '');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*(.+?)\*/g, '$1');

    const lines = t.split('\n').map((l) => l.trim());
    const htmlParts = [];
    let paragraphBuf = [];
    let listBuf = [];
    const flushParagraph = () => {
        if (paragraphBuf.length) { htmlParts.push(`<p>${paragraphBuf.join(' ')}</p>`); paragraphBuf = []; }
    };
    const flushList = () => {
        if (listBuf.length) { htmlParts.push('<ul>' + listBuf.map((i) => `<li>${i}</li>`).join('') + '</ul>'); listBuf = []; }
    };
    for (const line of lines) {
        if (!line) { flushParagraph(); flushList(); continue; }
        const listMatch = line.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
        if (listMatch) { flushParagraph(); listBuf.push(listMatch[1]); }
        else { flushList(); paragraphBuf.push(line); }
    }
    flushParagraph();
    flushList();

    const assembled = htmlParts.join('') || `<p>${t}</p>`;
    return linkifyTokens(assembled, grounded);
}
