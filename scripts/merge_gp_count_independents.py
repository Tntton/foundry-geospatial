#!/usr/bin/env python3
"""
GP-count data-integrity remediation, Phase 5 -- merge into Supabase.

Applies the confidence-gated merge policy agreed in the Phase 5 plan to
`gp_count_comparison_independents.csv` (independent GP clinics only --
corporate chains are separately handled below, never touched by scrape
data). Four buckets, decided per clinic:

  - fill-in:      no recorded gp_count on file, scrape has one at
                   confidence >= medium -> write it (nothing to overwrite,
                   lower risk).
  - overwrite:    both exist and differ, confidence == high, AND the
                   scrape found MORE doctors than recorded -- validated
                   live as correcting genuine undercounts (the original
                   scraper's 5-name cap). The opposite direction
                   (recorded > scraped, even at high confidence) is
                   deliberately EXCLUDED from auto-merge: spot-checking
                   showed this is usually our own extraction dropping a
                   few individual cards on an otherwise-real roster, not
                   the recorded value being wrong -- auto-overwriting
                   those would risk making the data slightly worse, not
                   better.
  - provenance-only: both exist and already match -- no value change
                   needed, but still worth stamping source_url/
                   last_scraped_at/confidence since the number is now
                   independently verified.
  - no-op:        everything else (recorded exists, scraped missing;
                   low/medium-confidence mismatches; the excluded
                   recorded>scraped high-confidence direction) -- left
                   untouched, stays visible in the comparison CSV for
                   manual review.

Separately: corporate-chain clinics get gp_count_confidence backfilled to
'high' where still null -- the user did a deep, partly-manual QA pass on
these before this pipeline existed, so the recorded value is already
trustworthy; this just records that fact, no count/name values touch.

Writes a timestamped backup CSV of every row's pre-merge state (gp_count,
doctor_names, gp_count_confidence, gp_count_source_url,
gp_count_last_scraped_at) before executing any UPDATE, so this is
reversible. Requires SUPABASE_DB_URL in .env (schema-modify rights).

Usage:
    python3 scripts/merge_gp_count_independents.py [--dry-run]
"""

import argparse
import csv
import os
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from lib_gp_scrape import is_corporate_chain

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(dotenv_path=os.path.join(REPO_ROOT, '.env'))
DB_URL = os.environ['SUPABASE_DB_URL']

COMPARISON_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gp_count_comparison_independents.csv')
DISCOVERY_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gp_discovery_full.csv')


def classify_rows(rows):
    fill_in, overwrite, provenance_only, no_op = [], [], [], []
    for r in rows:
        rec, scr, conf = r['recorded_gp_count'], r['gp_count_scraped'], r['gp_count_scrape_confidence']
        has_rec, has_scr = rec not in ('', None), scr not in ('', None)

        if has_rec and has_scr and r['match'] == 'True':
            provenance_only.append(r)
        elif not has_rec and has_scr and conf in ('medium', 'high'):
            fill_in.append(r)
        elif (has_rec and has_scr and r['match'] == 'False' and conf == 'high'
              and int(scr) > int(rec)):
            overwrite.append(r)
        else:
            no_op.append(r)
    return fill_in, overwrite, provenance_only, no_op


def backup_and_merge(conn, fill_in, overwrite, provenance_only, corporate_ids_to_backfill, dry_run):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    touched_ids = [r['clinic_id'] for r in (fill_in + overwrite + provenance_only)] + corporate_ids_to_backfill

    cur.execute(
        """select clinic_id, gp_count, doctor_names, gp_count_confidence,
                  gp_count_source_url, gp_count_last_scraped_at
           from clinics where market_id = 'gp' and clinic_id = any(%s)""",
        (touched_ids,),
    )
    backup_rows = cur.fetchall()

    backup_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        f"gp_count_merge_backup_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.csv",
    )
    with open(backup_path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['clinic_id', 'gp_count', 'doctor_names',
                                           'gp_count_confidence', 'gp_count_source_url',
                                           'gp_count_last_scraped_at'])
        w.writeheader()
        w.writerows(backup_rows)
    print(f'Backed up pre-merge state for {len(backup_rows)} clinics -> {backup_path}')

    if dry_run:
        print('--dry-run: no writes executed.')
        return

    now = datetime.now(timezone.utc)
    for r in fill_in + overwrite:
        cur.execute(
            """update clinics set gp_count = %s, doctor_names = %s, gp_count_source_url = %s,
                      gp_count_last_scraped_at = %s, gp_count_confidence = %s
               where clinic_id = %s and market_id = 'gp'""",
            (int(r['gp_count_scraped']), r['doctor_names_scraped'], r['source_url'],
             now, r['gp_count_scrape_confidence'], r['clinic_id']),
        )
    for r in provenance_only:
        cur.execute(
            """update clinics set gp_count_source_url = %s, gp_count_last_scraped_at = %s,
                      gp_count_confidence = %s
               where clinic_id = %s and market_id = 'gp'""",
            (r['source_url'], now, r['gp_count_scrape_confidence'], r['clinic_id']),
        )
    if corporate_ids_to_backfill:
        cur.execute(
            """update clinics set gp_count_confidence = 'high'
               where market_id = 'gp' and clinic_id = any(%s) and gp_count_confidence is null""",
            (corporate_ids_to_backfill,),
        )

    conn.commit()
    print(f'Merged: {len(fill_in)} fill-in, {len(overwrite)} overwrite, '
          f'{len(provenance_only)} provenance-only, corporate backfill: {len(corporate_ids_to_backfill)}.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Back up and report counts, write nothing.')
    args = parser.parse_args()

    with open(COMPARISON_CSV, newline='') as f:
        rows = list(csv.DictReader(f))
    fill_in, overwrite, provenance_only, no_op = classify_rows(rows)
    print(f'fill-in: {len(fill_in)}, overwrite (scraped>recorded only): {len(overwrite)}, '
          f'provenance-only: {len(provenance_only)}, no-op: {len(no_op)}')

    with open(DISCOVERY_CSV, newline='') as f:
        discovery_rows = list(csv.DictReader(f))
    corporate_ids_to_backfill = [r['clinic_id'] for r in discovery_rows if is_corporate_chain(r.get('corporate_chain'))]
    print(f'corporate-chain clinics eligible for confidence backfill (where null): {len(corporate_ids_to_backfill)}')

    conn = psycopg2.connect(DB_URL)
    try:
        backup_and_merge(conn, fill_in, overwrite, provenance_only, corporate_ids_to_backfill, args.dry_run)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
