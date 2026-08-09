#!/usr/bin/env python3
"""
GP-count data-integrity remediation, Phase 5 -- flag no-op discrepancies.

merge_gp_count_independents.py already wrote gp_count/doctor_names for the
clinics confident enough to auto-merge. Everything else with a genuine
mismatch (recorded and scraped both exist, but disagree, and didn't clear
the merge bar) was left completely untouched -- including gp_count_confidence
staying null, which is indistinguishable client-side from "never scraped at
all". That's wrong: these clinics DO have a specific reason to doubt the
displayed count, unlike a clinic with zero scrape data.

Writes gp_count_confidence='low' + gp_count_source_url + gp_count_last_scraped_at
for exactly this bucket -- gp_count/doctor_names are NEVER touched here, only
provenance/confidence, so the displayed number doesn't change, just how much
it's trusted. The frontend (src/js/app.js gpConfidenceBadge) renders this as
"Likely inaccurate" instead of the default "Not independently checked".

Deliberately excludes:
  - Clinics with no scrape data at all (nothing to flag against -- stays the
    default "not independently checked").
  - Clinics already merged by merge_gp_count_independents.py (their
    gp_count_confidence already reflects the merge, would be regressed to
    'low' if this script naively re-touched them -- excluded by re-checking
    live DB state, not the stale pre-merge comparison CSV).

Writes a timestamped backup CSV of every row's pre-write state before
executing, same as merge_gp_count_independents.py. Requires SUPABASE_DB_URL
in .env.

Usage:
    python3 scripts/flag_gp_count_discrepancies.py [--dry-run]
"""

import argparse
import csv
import os
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(dotenv_path=os.path.join(REPO_ROOT, '.env'))
DB_URL = os.environ['SUPABASE_DB_URL']

COMPARISON_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gp_count_comparison_independents.csv')


def find_candidates(rows):
    """Recorded and scraped both exist, disagree, and weren't already
    auto-merged (that specific case: confidence=high AND scraped>recorded)."""
    return [
        r for r in rows
        if r['recorded_gp_count'] not in ('', None)
        and r['gp_count_scraped'] not in ('', None)
        and r['match'] == 'False'
        and not (r['gp_count_scrape_confidence'] == 'high' and int(r['gp_count_scraped']) > int(r['recorded_gp_count']))
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    with open(COMPARISON_CSV, newline='') as f:
        rows = list(csv.DictReader(f))
    candidates = find_candidates(rows)
    print(f'{len(candidates)} no-op discrepancy candidates found.')

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Re-check live state -- exclude anything merge_gp_count_independents.py
    # already touched (gp_count_confidence already 'high', not null), so a
    # stale pre-merge CSV snapshot can't regress an already-merged clinic.
    ids = [r['clinic_id'] for r in candidates]
    cur.execute(
        """select clinic_id, gp_count_confidence from clinics
           where market_id = 'gp' and clinic_id = any(%s)""",
        (ids,),
    )
    already_touched = {row['clinic_id'] for row in cur.fetchall() if row['gp_count_confidence'] is not None}
    to_flag = [r for r in candidates if r['clinic_id'] not in already_touched]
    print(f'{len(already_touched)} already have a confidence value (skipped), {len(to_flag)} to flag.')

    flag_ids = [r['clinic_id'] for r in to_flag]
    cur.execute(
        """select clinic_id, gp_count, doctor_names, gp_count_confidence,
                  gp_count_source_url, gp_count_last_scraped_at
           from clinics where market_id = 'gp' and clinic_id = any(%s)""",
        (flag_ids,),
    )
    backup_rows = cur.fetchall()
    backup_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        f"gp_count_flag_backup_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.csv",
    )
    with open(backup_path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['clinic_id', 'gp_count', 'doctor_names', 'gp_count_confidence',
                                           'gp_count_source_url', 'gp_count_last_scraped_at'])
        w.writeheader()
        w.writerows(backup_rows)
    print(f'Backed up pre-flag state for {len(backup_rows)} clinics -> {backup_path}')

    if args.dry_run:
        print('--dry-run: no writes executed.')
        conn.close()
        return

    now = datetime.now(timezone.utc)
    for r in to_flag:
        cur.execute(
            """update clinics set gp_count_confidence = 'low', gp_count_source_url = %s,
                      gp_count_last_scraped_at = %s
               where clinic_id = %s and market_id = 'gp'""",
            (r['source_url'], now, r['clinic_id']),
        )
    conn.commit()
    conn.close()
    print(f'Flagged {len(to_flag)} clinics as low confidence (gp_count/doctor_names untouched).')


if __name__ == '__main__':
    main()
