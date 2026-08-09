"""
Shared helpers for the GP-count data-integrity two-step pipeline:
  1. discover_gp_page_urls.py   -- find each clinic's "our doctors"/team page
  2. scrape_gp_names_from_page.py -- scrape names from that already-known URL
  3. audit_gp_count_accuracy.py -- compare Supabase's recorded gp_count
     against a fresh discover+scrape run, on a sample

Kept as one small module so the doctor-name regex and the team-page
link-scoring logic can't drift apart across the three scripts that need
them -- this is genuinely shared logic, not premature abstraction.

Deliberately NOT executed as part of building this pipeline -- actually
running any of these three scripts against live external clinic websites
is a separate, deliberate action for a human to kick off when ready.
"""

import re

# Corporate-chain clinics are permanently out of scope for any scrape-based
# gp_count correction: the user did a deep, partly-manual scrape/QA pass on
# these before this pipeline existed, so the recorded value is already high
# quality, and our website-scraping approach is structurally disadvantaged
# here anyway -- chain sites often have no real per-location roster page at
# all (confirmed live: Better Medical's "About Us" page lists 2 national
# executives, not any specific clinic's GPs). Independents are where this
# pipeline adds real signal.
NON_CHAIN_VALUES = {'', 'independent', 'none'}


def is_corporate_chain(corporate_chain):
    return (corporate_chain or '').strip().lower() not in NON_CHAIN_VALUES

# Uncapped -- see the GP-count data-integrity plan for why a fixed cap is
# wrong on its own: it guarantees undercounting any practice with more GPs
# than the cap, independent of how good the underlying regex match is.
#
# Only the title word is case-insensitive (scoped `(?i:...)` group) -- the
# name-capture group `[A-Z][a-z]+` must stay case-SENSITIVE, since that's
# what actually enforces "this is a real capitalized name". A blanket
# re.IGNORECASE on the whole pattern (the previous approach) neuters that
# character class entirely -- `[A-Z]` starts matching lowercase letters too
# under IGNORECASE, so "Doctor is welcoming new patients" matches
# `(?:Doctor)\s+([A-Z][a-z]+...)` and captures "is welcoming" as a "name".
# Confirmed live: this was the root cause of garbage names like "is
# welcoming"/"offers bulk" showing up in real scrape output.
TITLE_PATTERNS = [
    r'(?i:Dr)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',   # Dr. Name or Dr. First Last
    r'(?i:Dr)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',       # Dr Name
    r'(?i:GP):\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',      # GP: Name
    r'(?i:Doctor|Practitioner)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',  # Doctor Name
]

# Cheap second net independent of the regex fix above: common non-name words
# that leaked through as "names" in real scrape output before the fix (title
# word immediately followed by ordinary sentence text). Checked against the
# lowercased candidate name.
NON_NAME_STOPWORDS = {
    'welcoming', 'offers', 'bulk', 'billing', 'patients', 'book', 'click',
    'read', 'today', 'please', 'call', 'online', 'more', 'appointment',
    'appointments', 'available', 'currently', 'now', 'accepting', 'new',
    'director', 'manager', 'medical', 'clinical', 'practice', 'principal',
}


def _looks_like_stopword_junk(name):
    words = set(name.lower().split())
    return bool(words & NON_NAME_STOPWORDS)

# Phrase -> score, used to rank a homepage's own <a> links as candidate
# "our doctors"/team pages -- discovering the REAL link on each clinic's
# own site, rather than guessing a fixed list of common URL paths, since
# clinic sites vary a lot in how they structure this (e.g. "/practice/our-gps"
# would never match a fixed path guess but shows up here via its link text).
TEAM_PAGE_KEYWORDS = [
    ('our doctors', 5), ('meet the team', 5), ('meet our doctors', 5),
    ('meet our', 4), ('our team', 4), ('our gps', 4), ('our practitioners', 4),
    ('doctors', 3), ('practitioners', 3), ('our staff', 3), ('gps', 3),
    ('staff', 2), ('team', 2), ('about us', 1),
]

# A link/page can legitimately score high on TEAM_PAGE_KEYWORDS while being a
# RECRUITMENT page, not a patient-facing roster: "join our team", "careers/
# general-practitioners", "overseas GPs" all contain "team"/"practitioners"/
# "GPs" just as strongly as a real "meet our doctors" page does. Confirmed
# live across 5+ separate corporate chains (My Health, Qualitas Health,
# Medical One, Cornerstone Health) during the full-database validation run --
# each one's "high confidence" discovered page turned out to be a careers/
# hiring page with none of the clinic's actual doctors on it, extracting
# near-zero or garbage names (page boilerplate like "Jobs at..." matched as if
# it were a name). These disqualify a link outright, regardless of how high
# it would otherwise score.
RECRUITMENT_PAGE_MARKERS = [
    'career', 'job', 'vacan', 'recruit', 'overseas', 'join our team',
    'join the team', 'apply now', 'we are hiring', "we're hiring", 'employment',
]


def is_recruitment_page(href, link_text):
    haystack = f'{href or ""} {link_text or ""}'.lower()
    return any(marker in haystack for marker in RECRUITMENT_PAGE_MARKERS)

# Catches "Jane Smith, MBBS" style listings that never say the word "Dr" --
# common on grid/card layouts that show a name + qualification instead of a
# title. Requires a real AU/UK medical qualification abbreviation right after
# the name so it stays precise (unlike a bare name pattern, which would match
# almost anything).
CREDENTIAL_SUFFIXES = r'(?i:MBBS|MBChB|MB\s?BS|FRACGP|MD|FACRRM|FACRM)'
TITLE_PATTERNS_WITH_CREDENTIAL_SUFFIX = [
    rf'([A-Z][a-z]+(?:[-\'][A-Z][a-z]+)?\s+[A-Z][a-z]+(?:[-\'][A-Z][a-z]+)?),?\s+{CREDENTIAL_SUFFIXES}\b',
]

# Substrings that show up on bot-detection / "prove you're human" interstitial
# pages (Cloudflare, generic JS-challenge templates). A scrape that lands on
# one of these will find 0 doctor names -- which looks identical to "this
# clinic genuinely has no team page listed" unless we check for it explicitly.
BOT_CHALLENGE_MARKERS = [
    'checking your browser', 'cf-browser-verification', 'attention required',
    'just a moment', 'enable javascript and cookies to continue',
    'verify you are human', 'ddos protection by',
]


def looks_like_bot_challenge(text):
    haystack = (text or '').lower()
    return any(marker in haystack for marker in BOT_CHALLENGE_MARKERS)


def classify_fetch_error(exc):
    """Bucket a Playwright/requests exception into a small taxonomy instead
    of a truncated free-text string, so failure modes can be counted and
    compared across a large run instead of eyeballed one at a time."""
    msg = str(exc).lower()
    if 'timeout' in msg:
        return 'timeout'
    if 'cert' in msg or 'ssl' in msg:
        return 'cert_error'
    if 'err_name_not_resolved' in msg or 'dns' in msg:
        return 'dns_error'
    if 'err_connection_refused' in msg or 'err_connection_reset' in msg:
        return 'connection_error'
    if 'net::err' in msg:
        return 'network_error'
    if 'execution context was destroyed' in msg or 'interrupted by another navigation' in msg:
        return 'client_side_redirect'
    return 'other_error'


def dedup_key(name):
    """Loose dedup key so 'Dr. John Smith' and 'Dr Smith' collapse to the
    same person instead of being counted twice -- keyed on last word
    (surname, in Western name order) plus first-letter of the rest."""
    parts = name.lower().split()
    if len(parts) == 1:
        return parts[0]
    return f'{parts[0][0]}_{parts[-1]}'


def extract_doctor_names(text):
    """Extract doctor/GP names from a page's rendered text. No cap.

    No blanket re.IGNORECASE here -- each pattern scopes its own
    case-insensitivity to the title word via `(?i:...)`, keeping the
    name-capture group's [A-Z][a-z]+ genuinely case-sensitive (see
    TITLE_PATTERNS' comment for why that matters)."""
    names, seen = [], set()
    for pattern in TITLE_PATTERNS + TITLE_PATTERNS_WITH_CREDENTIAL_SUFFIX:
        for match in re.finditer(pattern, text, re.MULTILINE):
            name = match.group(1).strip()
            if not name or len(name) <= 2 or name.isdigit():
                continue
            if _looks_like_stopword_junk(name):
                continue
            key = dedup_key(name)
            if key in seen:
                continue
            seen.add(key)
            names.append(name)
    return names


def score_team_page_link(href, link_text):
    """Score one homepage <a> tag as a candidate team/doctors page.
    Higher = more likely to be a dedicated GP listing, not just a passing
    mention. Returns 0 for links with no relevant keyword at all, or for a
    recruitment/careers link regardless of keyword overlap (see
    RECRUITMENT_PAGE_MARKERS)."""
    if is_recruitment_page(href, link_text):
        return 0
    haystack = f'{href or ""} {link_text or ""}'.lower()
    return max((score for phrase, score in TEAM_PAGE_KEYWORDS if phrase in haystack), default=0)


def pick_best_team_page_link(links):
    """`links` is a list of {href, text} dicts (e.g. from a Playwright
    `page.eval_on_selector_all('a', ...)` call). Returns (href, score) for
    the highest-scoring link, or (None, 0) if nothing looks like a team page.

    The score matters as much as the href downstream: a weak match (e.g.
    only 'about us', score 1) is often a generic corporate bio page rather
    than an actual per-location doctor roster -- confirmed live during the
    GP-count validation run (bettermedical.com.au's "About Us" page lists
    two national executives, not any specific clinic's GPs). A caller that
    only keeps the href and discards the score can't tell that apart from a
    strong 'our doctors' match, and ends up over-trusting the result."""
    best_href, best_score = None, 0
    for link in links:
        score = score_team_page_link(link.get('href'), link.get('text'))
        if score > best_score:
            best_href, best_score = link.get('href'), score
    return best_href, best_score


# --- DOM card-grid structured extraction -----------------------------------
#
# A real "team" page is usually built from a repeated DOM structure -- sibling
# elements each with a photo + name + role -- not just flat paragraph text.
# Detecting that structure directly is far more reliable than regexing the
# page's flattened innerText: a flat-text regex has no idea whether "Doctor"
# and a following capitalized phrase are actually adjacent on a name card, or
# just happen to appear near each other in unrelated prose. Verified live
# against two real pages in this dataset (ochrehealth.com.au and
# partneredhealthmedicalcentres.com.au team pages) -- neither uses schema.org
# markup, both render doctors as sibling elements in different but detectable
# shapes (a heading vs. a plain name-classed div).
#
# Returned to Python as {'method': ..., 'card_count': int, 'cards': [...]}
# or None -- kept "dumb" (structural signals only): GP/non-GP keyword
# classification and confidence scoring stay in Python so the keyword lists
# below don't need to be duplicated into this JS string.
DETECT_CARD_GRID_JS = r"""
() => {
  const MIN_CARDS = 2;
  const MAX_CARDS = 60;
  const NAME_SHAPE = /^(Dr\.?\s+)?[A-Z][A-Za-z'-]+(\s+[A-Z][A-Za-z'-]+){0,3}$/;
  const CTA_WORDS = /^(book(\s+(now|an appointment))?|profile|read more|view profile|learn more|contact|call|email|website)$/i;

  function microdataPeople() {
    const out = [];
    document.querySelectorAll('[itemtype*="schema.org/Person"], [itemtype*="schema.org/Physician"]').forEach(el => {
      const nameEl = el.querySelector('[itemprop="name"]') || el;
      out.push({ name: (nameEl.innerText || '').trim(), role_text: (el.innerText || '').trim(),
                 has_image: !!el.querySelector('img'), photo_like: !!el.querySelector('img'), name_shape_ok: true });
    });
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
        items.filter(i => i && ['Person', 'Physician'].includes(i['@type'])).forEach(i => {
          out.push({ name: i.name || '', role_text: i.jobTitle || i.description || '',
                     has_image: !!i.image, photo_like: !!i.image, name_shape_ok: true });
        });
      } catch (e) { /* malformed JSON-LD is common -- skip, don't throw */ }
    });
    return out;
  }

  function extractCard(el) {
    const img = el.querySelector('img');
    const dims = img ? Math.max(
      img.width || 0, img.height || 0,
      parseInt(img.getAttribute('width') || 0), parseInt(img.getAttribute('height') || 0)
    ) : 0;
    // lazy-load placeholders (data:image/gif;base64, seen live) still count
    // as "a photo slot exists here" -- the structural intent is what matters.
    const photoLike = !!img && (dims >= 80 || (img.src || '').startsWith('data:'));

    let nameEl = el.querySelector('h1,h2,h3,h4,h5,h6');
    let nameSource = 'heading';
    const tryText = e => e && e.innerText && e.innerText.trim();
    if (!tryText(nameEl) || !NAME_SHAPE.test(tryText(nameEl))) {
      nameEl = el.querySelector('[class*="name" i]');
      nameSource = 'name_class';
    }
    if (!tryText(nameEl) || !NAME_SHAPE.test(tryText(nameEl))) {
      nameEl = el.querySelector('strong, b');
      nameSource = 'bold';
    }
    if (!tryText(nameEl) || !NAME_SHAPE.test(tryText(nameEl))) {
      const texty = [...el.querySelectorAll('*')].filter(
        n => n.children.length === 0 && n.innerText && n.innerText.trim().length <= 40
      );
      texty.sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize));
      nameEl = texty[0];
      nameSource = 'largest_font';
    }

    const nameText = tryText(nameEl) || '';
    const nameShapeOk = NAME_SHAPE.test(nameText);

    let roleText = el.innerText || '';
    if (nameText) roleText = roleText.replace(nameText, '');
    roleText = roleText.split('\n').filter(line => !CTA_WORDS.test(line.trim())).join(' ').trim();

    return { name: nameText, name_source: nameSource, name_shape_ok: nameShapeOk,
             role_text: roleText.slice(0, 400), has_image: !!img, photo_like: photoLike };
  }

  function scoreGroup(elements) {
    const cards = elements.map(extractCard);
    const shapeOkCount = cards.filter(c => c.name_shape_ok).length;
    const shapeRatio = shapeOkCount / cards.length;
    if (shapeRatio < 0.5) return null;
    const credentialHits = cards.filter(c => /MBBS|MBChB|FRACGP|MD|FACRRM|FACRM|general practitioner|\bgp\b/i.test(c.role_text)).length;
    const anyPhoto = cards.some(c => c.photo_like);
    // A cluster with no photo on ANY card and no credential/GP-role hit
    // anywhere is almost certainly a nav/menu/link list, not doctor cards --
    // confirmed live (nav menus outside a literal <nav> tag, e.g. a plain
    // div-based header menu, aren't caught by the isNavLike() ancestor check
    // above but fail this bar every time a real doctor grid wouldn't).
    if (!anyPhoto && credentialHits === 0) return null;
    const score = shapeRatio * 10 + credentialHits * 5 + Math.min(cards.length, 10) * 0.1;
    return { score, card_count: cards.length, cards };
  }

  const microdata = microdataPeople();
  if (microdata.length >= 2) {
    return { method: 'dom_schema_microdata', card_count: microdata.length, cards: microdata };
  }

  const parentIds = new WeakMap();
  let nextId = 0;
  const idOf = el => { if (!parentIds.has(el)) parentIds.set(el, ++nextId); return parentIds.get(el); };
  const classKey = el => (typeof el.className === 'string' && el.className.trim())
    ? el.className.trim().split(/\s+/).sort().join('.') : '';
  const hookKey = el => (el.getAttribute('data-hook') || el.getAttribute('data-testid') ||
                          el.getAttribute('data-item-id') || '').replace(/[-_]?\d+$/, '');

  // Nav menus and footer link lists are structurally identical to a card
  // grid (repeated siblings, consistent class, often Title-Case text like
  // "About Us"/"Careers") -- confirmed live, this was winning the cluster on
  // real pages in this dataset. Exclude anything inside nav/header/footer or
  // a menu-ish class/id outright rather than relying on scoring alone.
  const isNavLike = el => !!el.closest('nav, header, footer, [class*="menu" i], [id*="menu" i], [class*="nav" i], [id*="nav" i]');

  const groups = new Map();
  document.querySelectorAll('div, li, article, section').forEach(el => {
    const parent = el.parentElement;
    if (!parent || isNavLike(el)) return;
    const key = hookKey(el) || classKey(el);
    if (!key) return;
    const groupKey = idOf(parent) + '::' + key;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(el);
  });

  const candidates = [...groups.values()].filter(g => g.length >= MIN_CARDS && g.length <= MAX_CARDS);
  const scored = candidates.map(scoreGroup).filter(Boolean);
  if (scored.length) {
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    return { method: 'sibling_class_cluster', card_count: best.card_count, cards: best.cards };
  }

  // Tier 3: no repeated structure at all -- genuine solo-GP sites have
  // nothing to cluster against by definition. If exactly one heading on the
  // page looks like a real name AND the page has a GP/credential signal
  // somewhere, treat it as one structurally-found profile rather than
  // falling straight to flat-text regex.
  const soloHeadings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(h => NAME_SHAPE.test((h.innerText || '').trim()));
  const hasImage = document.querySelectorAll('img').length >= 1;
  const bodyText = document.body.innerText || '';
  const hasGpSignal = /MBBS|MBChB|FRACGP|MD|FACRRM|FACRM|general practitioner|\bgp\b/i.test(bodyText);
  if (soloHeadings.length === 1 && hasImage && hasGpSignal) {
    const nameText = soloHeadings[0].innerText.trim();
    return {
      method: 'dom_single_profile', card_count: 1,
      cards: [{ name: nameText, name_source: 'heading', name_shape_ok: true,
                role_text: bodyText.slice(0, 800), has_image: true, photo_like: true }],
    };
  }

  return null;
}
"""

# Exclusion takes precedence over inclusion, same pattern as
# is_recruitment_page() overriding TEAM_PAGE_KEYWORDS -- a card whose role
# text mentions "nurse" is never a GP even if it also happens to contain
# "practitioner" via "nurse practitioner".
NON_GP_ROLE_KEYWORDS = [
    'nurse practitioner', 'registered nurse', 'enrolled nurse', ' nurse',
    'practice manager', 'receptionist', 'reception', 'administrat',
    'physiotherap', 'psycholog', 'podiatris', 'dietitian', 'diabetes educator',
    'exercise physiolog', 'counsellor', 'social worker', 'pharmacist',
    'phlebotomist', 'pathologist', 'radiographer', 'sonographer', 'midwife',
    'osteopath', 'chiropract', 'optometr', 'dentist', 'audiolog',
]

# Deliberately NOT including bare 'practitioner' -- 'nurse practitioner' and
# 'allied health practitioner' would false-positive against it.
GP_ROLE_KEYWORDS = [
    'general practitioner', 'gp registrar', 'gp principal', 'principal gp',
    'family doctor', 'family physician', 'medical practitioner',
    'rural generalist', 'locum gp', 'locum doctor', 'senior doctor',
    ' gp ', ' gp,', ' gp)', ' gp.', 'g.p.',
]


def classify_card_role(role_text):
    """GP/non-GP/unknown for one team-card's role text. 'unknown' means
    default-include (see confidence design) -- real GP-grid role text is
    often just bare credentials (e.g. ochrehealth.com.au's 'MBBS, FACRRM,
    MPHTM (JCU)') with the actual job-title word buried in prose elsewhere
    on the card, or simply absent because a single-specialty clinic's site
    never bothers to relabel every doctor as 'GP'."""
    haystack = (role_text or '').lower()
    if any(k in haystack for k in NON_GP_ROLE_KEYWORDS):
        return 'non_gp'
    if any(k in haystack for k in GP_ROLE_KEYWORDS):
        return 'gp'
    if re.search(CREDENTIAL_SUFFIXES, role_text or ''):
        return 'gp'
    return 'unknown'


def clean_card_name(raw_name):
    name = re.sub(r'(?i:^dr\.?\s+)', '', (raw_name or '').strip())
    return name.strip()
