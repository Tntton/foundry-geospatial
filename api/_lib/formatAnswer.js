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

// GFM-style table: a "| a | b |" row immediately followed by a
// "|---|---|" separator row. Only recognized with that exact two-line
// signature present, so a line that merely contains a stray '|' (and has
// no separator row right after it) safely falls through to a normal
// paragraph instead of misfiring as a table.
const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_SEP_RE = /^\|[\s:|-]+\|$/;

// A plain line.split('|') would also split on the '|' INSIDE a deep-link
// token (e.g. "[[region:12701|Bringelly - Green Valley]]" has its own
// internal '|' separating id from label) -- chopping the token in half
// right at a cell boundary, so it can never match TOKEN_RE later and just
// renders as two garbled fragments in adjacent cells. Track bracket depth
// so a '|' inside an open "[[...]]" span is never treated as a column
// delimiter.
function splitTableCells(inner) {
    const cells = [];
    let buf = '';
    let depth = 0;
    for (let i = 0; i < inner.length; i++) {
        const two = inner[i] + (inner[i + 1] || '');
        if (two === '[[') { depth++; buf += two; i++; continue; }
        if (two === ']]') { depth = Math.max(0, depth - 1); buf += two; i++; continue; }
        if (inner[i] === '|' && depth === 0) { cells.push(buf.trim()); buf = ''; continue; }
        buf += inner[i];
    }
    cells.push(buf.trim());
    return cells;
}

function parseTableRow(line) {
    return splitTableCells(line.slice(1, -1));
}

// Same constrained-markdown-to-HTML conversion as the old ask-read.js
// (bold via **, bullets via "- "/"1. ", paragraphs via blank lines, tables
// via "| a | b |") — moved here verbatim so both the assistant's tool-loop
// answer and any future caller share one implementation.
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

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line) { flushParagraph(); flushList(); i++; continue; }

        if (TABLE_ROW_RE.test(line) && lines[i + 1] && TABLE_SEP_RE.test(lines[i + 1])) {
            flushParagraph();
            flushList();
            const header = parseTableRow(line);
            const bodyRows = [];
            i += 2; // skip header + separator
            while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
                bodyRows.push(parseTableRow(lines[i]));
                i++;
            }
            const theadHtml = `<thead><tr>${header.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
            const tbodyHtml = `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
            htmlParts.push(`<div class="cop-table-wrap"><table>${theadHtml}${tbodyHtml}</table></div>`);
            continue;
        }

        const listMatch = line.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
        if (listMatch) { flushParagraph(); listBuf.push(listMatch[1]); }
        else { flushList(); paragraphBuf.push(line); }
        i++;
    }
    flushParagraph();
    flushList();

    const assembled = htmlParts.join('') || `<p>${t}</p>`;
    return linkifyTokens(assembled, grounded);
}
