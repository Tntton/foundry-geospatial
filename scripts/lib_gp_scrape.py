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

# Uncapped -- see the GP-count data-integrity plan for why a fixed cap is
# wrong on its own: it guarantees undercounting any practice with more GPs
# than the cap, independent of how good the underlying regex match is.
TITLE_PATTERNS = [
    r'Dr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',   # Dr. Name or Dr. First Last
    r'Dr\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',       # Dr Name
    r'GP:\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',      # GP: Name
    r'(?:Doctor|Practitioner)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',  # Doctor Name
]

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


def extract_doctor_names(text):
    """Extract doctor/GP names from a page's rendered text. No cap."""
    names, seen = [], set()
    for pattern in TITLE_PATTERNS:
        for match in re.finditer(pattern, text, re.IGNORECASE | re.MULTILINE):
            name = match.group(1).strip()
            if name and len(name) > 2 and name.lower() not in seen and not name.isdigit():
                seen.add(name.lower())
                names.append(name)
    return names


def score_team_page_link(href, link_text):
    """Score one homepage <a> tag as a candidate team/doctors page.
    Higher = more likely to be a dedicated GP listing, not just a passing
    mention. Returns 0 for links with no relevant keyword at all."""
    haystack = f'{href or ""} {link_text or ""}'.lower()
    return max((score for phrase, score in TEAM_PAGE_KEYWORDS if phrase in haystack), default=0)


def pick_best_team_page_link(links):
    """`links` is a list of {href, text} dicts (e.g. from a Playwright
    `page.eval_on_selector_all('a', ...)` call). Returns the highest-scoring
    href, or None if nothing on the page looks like a team/doctors page."""
    best_href, best_score = None, 0
    for link in links:
        score = score_team_page_link(link.get('href'), link.get('text'))
        if score > best_score:
            best_href, best_score = link.get('href'), score
    return best_href
