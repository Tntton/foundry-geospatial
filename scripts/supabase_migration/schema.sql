-- Schema for migrating gp-clinic-map's live data into Supabase (Postgres + PostGIS).
-- See /Users/joshting/.claude/plans/starry-dancing-planet.md for context.
--
-- markets.config / markets.canonical_fields stay as JSONB deliberately -- they're
-- nested config objects (colors per tier, weights per pillar), not a flat per-row
-- attribute bag, so flattening them wouldn't produce clean columns. Everything else
-- is fully flattened.
--
-- Table names are consolidated around ABS geography base units: sa3_scored -> sa3,
-- sa2_seifa -> sa2, demographics_sa1 -> sa1. isochrones folds into clinics (strictly
-- 1:1 today). demographics_sa3 folds into sa3. Renames are safe immediately (pure
-- data-preserving renames); the old isochrones/demographics_sa3 tables are dropped
-- only once migrate.py has reloaded their data into the new columns from source files
-- (see the "drop legacy tables" block at the bottom, applied as a separate pass).

create extension if not exists postgis;

create table if not exists markets (
  market_id text primary key,
  market_name text,
  config jsonb not null,
  canonical_fields jsonb not null
);

-- Columns are grouped logically (identity / descriptive / contact / geography /
-- business / reviews / nhsd / gp-specific / physio-specific / isochrone). Postgres
-- can't reorder existing columns in place -- this order only applies to a fresh
-- install; an already-existing table needs the one-off rebuild used to get the live
-- DB into this shape (create-copy-swap), not ALTER TABLE ADD COLUMN (always appends).
create table if not exists clinics (
  -- identity
  market_id text references markets(market_id),
  clinic_id text,
  -- descriptive
  name text,
  address text,
  address1 text,
  suburb text,
  state_code text,
  state_name text,
  postcode text,
  -- contact
  website text,
  phone text,
  email text,
  -- geography
  latitude numeric,
  longitude numeric,
  location geography(Point, 4326),
  sa1_code text,
  sa2_code text,
  sa2_name text,
  sa2_area_km2 numeric,
  sa3_code text,
  sa3_name text,
  sa4_code text,
  sa4_name text,
  gccsa_code text,
  gccsa_name text,
  geographic_area_class text,
  geographic_source_date text,
  gnaf_address_id text,
  -- business / classification
  ownership text,
  clinic_format text,
  billing_type text,
  corporate_chain text,
  gp_count int,
  -- reviews
  google_review_count int,
  google_rating numeric,
  -- nhsd identifiers
  nhsd_service_id text,
  nhsd_service_type text,
  -- gp-specific (null for other markets)
  pathology boolean,
  radiology_imaging boolean,
  allied_health boolean,
  doctor_names text,
  format_confidence text,
  -- physio-specific (null for other markets). The 15 per-segment booleans (hand_upper_limb,
  -- neurological_rehabilitation, etc.) were dropped -- 100% derivable from `segments`
  -- (verified: 0 mismatches across every physio row), so keeping both was pure duplication.
  ndis boolean,
  telehealth boolean,
  rank int,
  segments text[],
  primary_segment text,
  confidence text,
  -- isochrone (folded in from the old isochrones table, strictly 1:1 with clinics today)
  isochrone_geom geography(MultiPolygon, 4326),
  isochrone_contour_minutes int,
  isochrone_color text,
  isochrone_opacity numeric,
  isochrone_metric text,
  primary key (market_id, clinic_id)
);
-- for tables created before these columns existed
alter table clinics add column if not exists latitude numeric;
alter table clinics add column if not exists longitude numeric;
alter table clinics add column if not exists pathology boolean;
alter table clinics add column if not exists radiology_imaging boolean;
alter table clinics add column if not exists allied_health boolean;
alter table clinics add column if not exists doctor_names text;
alter table clinics add column if not exists sa2_area_km2 numeric;
alter table clinics add column if not exists gccsa_code text;
alter table clinics add column if not exists gccsa_name text;
alter table clinics add column if not exists state_name text;
alter table clinics add column if not exists nhsd_service_id text;
alter table clinics add column if not exists nhsd_service_type text;
alter table clinics add column if not exists gnaf_address_id text;
alter table clinics add column if not exists geographic_area_class text;
alter table clinics add column if not exists geographic_source_date text;
alter table clinics add column if not exists format_confidence text;
alter table clinics add column if not exists address1 text;
alter table clinics add column if not exists email text;
alter table clinics add column if not exists ndis boolean;
alter table clinics add column if not exists telehealth boolean;
alter table clinics add column if not exists rank int;
alter table clinics add column if not exists segments text[];
alter table clinics add column if not exists primary_segment text;
alter table clinics add column if not exists confidence text;
alter table clinics add column if not exists isochrone_geom geography(MultiPolygon, 4326);
alter table clinics add column if not exists isochrone_contour_minutes int;
alter table clinics add column if not exists isochrone_color text;
alter table clinics add column if not exists isochrone_opacity numeric;
alter table clinics add column if not exists isochrone_metric text;
alter table clinics drop column if exists extra;
-- the 15 redundant per-segment booleans, superseded by the segments array
alter table clinics drop column if exists womens_health_pelvic_health;
alter table clinics drop column if exists hand_upper_limb;
alter table clinics drop column if exists paediatrics;
alter table clinics drop column if exists neurological_rehabilitation;
alter table clinics drop column if exists oncology_lymphoedema;
alter table clinics drop column if exists respiratory_cardiopulmonary;
alter table clinics drop column if exists sports_performance;
alter table clinics drop column if exists musculoskeletal_orthopaedic;
alter table clinics drop column if exists pilates_wellness;
alter table clinics drop column if exists aged_care_falls_prevention;
alter table clinics drop column if exists hydrotherapy_aquatic;
alter table clinics drop column if exists dva_veterans_health;
alter table clinics drop column if exists occupational_workplace_injury;
alter table clinics drop column if exists rural_mobile_outreach;
alter table clinics drop column if exists general_physio;

create index if not exists clinics_location_idx on clinics using gist (location);
create index if not exists clinics_sa3_code_idx on clinics (sa3_code);
create index if not exists clinics_isochrone_geom_idx on clinics using gist (isochrone_geom);

-- sa3_scored -> sa3 (pure rename, safe immediately; data unaffected)
alter table if exists sa3_scored rename to sa3;

create table if not exists sa3 (
  sa3_code text primary key,
  sa3_name text,
  geom geography(MultiPolygon, 4326),
  state text,
  demand_score numeric,
  supply_score numeric,
  competition_score numeric,
  economics_score numeric,
  composite_score numeric,
  tier int,
  mmm_dominant int,
  corporate_share numeric,
  whitespace_score int,
  mmm_gpfte_per_10k numeric,
  mmm_pct_gp_55plus numeric,
  dpa_bonded boolean,
  dpa_gp_img boolean,
  workforce_risk_score int,
  nra_services_count int,
  nra_total_fees numeric,
  nra_fees_per_service numeric,
  nra_bb_rate numeric,
  nra_out_of_pocket numeric,
  nra_fee_charged_cagr numeric,
  nra_bb_rate_cagr numeric,
  nra_score_fees_per_service int,
  nra_score_total_fees int,
  nra_score_fee_cagr int,
  nra_score_bb_cagr int,
  ucc_present boolean,
  -- folded in from the old demographics_sa3 table (kept distinct from mmm_dominant --
  -- the two disagree on 51/336 SA3s, different source computations). clinic_count,
  -- clinics_per_10k, corporate_pct, independent_pct, nonprofit_pct were dropped: they
  -- were GP-clinic-specific (not general SA3 demographics) and already stale (170/340
  -- rows disagreed with the live GP clinic count) -- compute live from `clinics`
  -- instead, e.g. `select count(*) from clinics where sa3_code=X and market_id=Y`.
  population_y25 int,
  pop_growth numeric,
  pop_65plus_pct numeric,
  median_household_income numeric,
  mmm_classification int
);
alter table sa3 add column if not exists state text;
alter table sa3 add column if not exists demand_score numeric;
alter table sa3 add column if not exists supply_score numeric;
alter table sa3 add column if not exists competition_score numeric;
alter table sa3 add column if not exists economics_score numeric;
alter table sa3 add column if not exists composite_score numeric;
alter table sa3 add column if not exists tier int;
alter table sa3 add column if not exists mmm_dominant int;
alter table sa3 add column if not exists corporate_share numeric;
alter table sa3 add column if not exists whitespace_score int;
alter table sa3 add column if not exists mmm_gpfte_per_10k numeric;
alter table sa3 add column if not exists mmm_pct_gp_55plus numeric;
alter table sa3 add column if not exists dpa_bonded boolean;
alter table sa3 add column if not exists dpa_gp_img boolean;
alter table sa3 add column if not exists workforce_risk_score int;
alter table sa3 add column if not exists nra_services_count int;
alter table sa3 add column if not exists nra_total_fees numeric;
alter table sa3 add column if not exists nra_fees_per_service numeric;
alter table sa3 add column if not exists nra_bb_rate numeric;
alter table sa3 add column if not exists nra_out_of_pocket numeric;
alter table sa3 add column if not exists nra_fee_charged_cagr numeric;
alter table sa3 add column if not exists nra_bb_rate_cagr numeric;
alter table sa3 add column if not exists nra_score_fees_per_service int;
alter table sa3 add column if not exists nra_score_total_fees int;
alter table sa3 add column if not exists nra_score_fee_cagr int;
alter table sa3 add column if not exists nra_score_bb_cagr int;
alter table sa3 add column if not exists ucc_present boolean;
alter table sa3 add column if not exists population_y25 int;
alter table sa3 add column if not exists pop_growth numeric;
alter table sa3 add column if not exists pop_65plus_pct numeric;
alter table sa3 add column if not exists median_household_income numeric;
alter table sa3 add column if not exists mmm_classification int;
-- GP-specific and stale (see comment above) - compute live from clinics instead
alter table sa3 drop column if exists clinic_count;
alter table sa3 drop column if exists clinics_per_10k;
alter table sa3 drop column if exists corporate_pct;
alter table sa3 drop column if exists independent_pct;
alter table sa3 drop column if exists nonprofit_pct;
alter table sa3 drop column if exists properties;

create index if not exists sa3_geom_idx on sa3 using gist (geom);

-- Nav copilot data-gap audit, Gap 2 -- "low competitive density" (clinics/km^2 within
-- a 15-min isochrone, clinic-level only, no region-level rollup exists) has no direct
-- equivalent at SA3 granularity. supply_score (clinics per 10,000 residents) already
-- captures the same directional idea (fewer clinics relative to population = more
-- attractive = higher score) using data already on hand -- different denominator and
-- spatial unit, but close enough in intent to alias rather than build new
-- infrastructure for. Deliberate decision: the copilot's tool logic should map "low
-- competitive density" queries onto this column as a semantic alias. Only invest in a
-- true region-level rollup of the isochrone-based metric (average/median clinic
-- density across all catchments within an SA3) if analysts find this proxy
-- meaningfully wrong in practice.
comment on column sa3.supply_score is 'Clinics per 10,000 residents. Also serves as the nav copilot''s semantic alias for "low/high competitive density" queries -- see schema.sql comment above this column''s definition for why, and when to stop aliasing and build a real rollup instead.';

-- sa2_seifa -> sa2 (pure rename, safe immediately; data unaffected)
alter table if exists sa2_seifa rename to sa2;

create table if not exists sa2 (
  sa2_code text primary key,
  geom geography(MultiPolygon, 4326),
  sa2_name text,
  state text,
  sa3_code text,
  irsad_score int,
  irsad_decile int,
  population int
);
alter table sa2 add column if not exists sa2_name text;
alter table sa2 add column if not exists state text;
alter table sa2 add column if not exists sa3_code text;
alter table sa2 add column if not exists irsad_score int;
alter table sa2 add column if not exists irsad_decile int;
alter table sa2 add column if not exists population int;
alter table sa2 drop column if exists properties;

create index if not exists sa2_geom_idx on sa2 using gist (geom);

-- demographics_sa1 -> sa1 (pure rename, safe immediately; data unaffected)
alter table if exists demographics_sa1 rename to sa1;

-- sa2_code/sa3_code are derived from sa1_code itself, not a separate correspondence
-- file: ASGS 2021 codes are hierarchical -- an SA1 code's first 9 digits *are* its
-- parent SA2 code, first 5 digits *are* its parent SA3 code. Verified 100% match rate
-- (all 61,811 rows) against the sa2/sa3 tables already loaded.
create table if not exists sa1 (
  sa1_code text primary key,
  sa2_code text,
  sa3_code text,
  latitude numeric,
  longitude numeric,
  location geography(Point, 4326),
  population int
);
alter table sa1 add column if not exists latitude numeric;
alter table sa1 add column if not exists longitude numeric;
alter table sa1 add column if not exists sa2_code text;
alter table sa1 add column if not exists sa3_code text;

create index if not exists sa1_sa2_code_idx on sa1 (sa2_code);
create index if not exists sa1_sa3_code_idx on sa1 (sa3_code);

create table if not exists mmm_benchmark (
  mmm_classification int primary key,
  gpfte_per_10k numeric,
  pct_55plus numeric
);

-- legacy tables dropped: their data was verified to have moved into clinics.isochrone_*
-- and sa3's demographic columns (see plan Phase 2 verification).
drop table if exists isochrones;
drop table if exists demographics_sa3;

-- GP NRA (Medicare billing) LTM snapshot + 3-year CAGR growth, by SA3. Not part of the
-- original migration scope (raw billing CSVs aren't fetched by the live app), added on
-- request. sa3_name is the primary key (unique within the source file); sa3_code is
-- resolved by name-matching against sa3.sa3_name where possible and left null for the
-- ABS merged-region rows (e.g. "Blue Mountains & Blue Mountains - South") that don't
-- correspond to a single SA3 - not an enforced foreign key for that reason.
create table if not exists gp_billing_sa3_ltm (
  sa3_name text primary key,
  state text,
  sa3_code text,
  period text,
  service_type text,
  services int,
  benefits numeric,
  bulk_billed_services int,
  patient_billed_services int,
  bulk_billed_benefits numeric,
  patient_billed_benefits numeric,
  mbs_bulk_billing_rate numeric,
  avg_patient_contribution numeric,
  schedule_fee numeric,
  fee_charged numeric,
  bulk_billed_fee_charged numeric,
  patient_billed_fee_charged numeric,
  out_of_pocket numeric,
  services_l3y_cagr numeric,
  benefits_l3y_cagr numeric,
  fee_charged_l3y_cagr numeric,
  out_of_pocket_l3y_cagr numeric,
  mbs_bb_rate_l3y_cagr numeric
);
create index if not exists gp_billing_sa3_ltm_sa3_code_idx on gp_billing_sa3_ltm (sa3_code);

-- One-off backfill (not idempotent, run once): sa3.nra_* was originally loaded from a
-- separate, older sa3_scored.geojson pipeline (see load_sa3_scored() in migrate.py),
-- entirely independent of this table's own CSV ingestion. Verified live: the level
-- fields (services, total fees, fees/service, bb_rate, out-of-pocket) already agreed
-- to the dollar -- sa3 just stores them rounded. But the two *_l3y_cagr growth-rate
-- fields disagreed on direction (not just magnitude) for 167 of 328 resolved SA3s --
-- e.g. sa3 said bulk-billing was falling in a region where this table's fresher CSV
-- said it was rising. Confirmed with the user this table is the more current source,
-- and refreshed all 7 raw nra_* columns from it (not just the two CAGRs, so sa3 is a
-- clean current mirror rather than a partial fix):
--   update sa3 s set
--     nra_services_count = b.services,
--     nra_total_fees = round(b.fee_charged, 2),
--     nra_fees_per_service = round(b.fee_charged / nullif(b.services,0), 2),
--     nra_bb_rate = b.mbs_bulk_billing_rate,
--     nra_out_of_pocket = round(b.out_of_pocket, 2),
--     nra_fee_charged_cagr = b.fee_charged_l3y_cagr,
--     nra_bb_rate_cagr = b.mbs_bb_rate_l3y_cagr
--   from gp_billing_sa3_ltm b where b.sa3_code = s.sa3_code;
-- KNOWN GAP left open, not silently patched: nra_score_bb_cagr/nra_score_fee_cagr
-- (0-100 columns derived from the two CAGR fields just refreshed) are now stale
-- relative to the new raw values. They looked like a simple percentile-rank of the
-- raw value at a glance, but verified against the full dataset that guess only
-- matches ~93-98% of rows, not exactly -- not safe to silently recompute with an
-- approximated formula. Whoever owns the original scoring pipeline (the one that
-- produces sa3_scored.geojson) needs to rerun it with the corrected CAGR inputs to
-- get these two score columns right; nra_score_fees_per_service/nra_score_total_fees
-- are unaffected (their own raw inputs didn't change).

-- Named-region gazetteer (nav copilot data-gap audit, Gap 1 -- "blocking, even the
-- anchor query fails without it"). Colloquial region names like "South-East
-- Queensland" or "Western Sydney" are not ABS boundaries -- they don't exist as rows
-- anywhere in sa3/sa2/sa1. Without this table, a copilot asked for one of these names
-- has no way to resolve it except guessing SA3 membership from the model's own
-- training knowledge, which is non-deterministic and unauditable. This table makes
-- that resolution a deterministic lookup instead: region name -> explicit list of
-- sa3_code. Curated by hand, once, from the real sa3_code/sa4_name pairs already in
-- `clinics` (not guessed from ABS code-prefix structure, which doesn't reliably imply
-- SA4 grouping -- e.g. QLD sa3_code 31401 "The Hills District" sits in "Moreton Bay -
-- South", not adjacent to its numeric neighbours' SA4).
create table if not exists region_definitions (
  region_name text primary key,
  aliases text[] not null default '{}',
  description text,
  source text
);

create table if not exists region_gazetteer_members (
  region_name text references region_definitions(region_name) on delete cascade,
  sa3_code text references sa3(sa3_code),
  primary key (region_name, sa3_code)
);
create index if not exists region_gazetteer_members_sa3_idx on region_gazetteer_members (sa3_code);

-- Seed: the 3 example regions from the audit brief. Each is a judgment call on a
-- colloquial name with no single official boundary -- documented in `source` so the
-- call is visible and revisable, not silently baked in.
insert into region_definitions (region_name, aliases, description, source) values
  ('South-East Queensland', array['SEQ'],
   'Brisbane, Gold Coast, Ipswich, Logan, Moreton Bay and Sunshine Coast SA4s.',
   'Curated manually. Deliberately excludes Toowoomba: officially one of the 12 SEQ Regional Plan LGAs, but colloquially and in market reports Toowoomba is usually treated as its own separate region (over the range, different market dynamics). Revisit if that assumption turns out wrong in practice.'),
  ('Western Sydney', array['Greater Western Sydney', 'West Sydney'],
   'Blacktown, Parramatta, Outer West/Blue Mountains, Baulkham Hills/Hawkesbury, South West and Outer South West Sydney SA4s.',
   'Curated manually, broad definition (matches WSROC''s member-council footprint / common market-report usage) rather than the narrower Parramatta+Blacktown-only usage -- no single ABS boundary exists for this name either way.'),
  ('Greater Melbourne', array[]::text[],
   'All Melbourne- SA4s plus Mornington Peninsula.',
   'Matches the ABS Greater Melbourne GCCSA definition -- the one region of the three with a real, non-judgment-call official boundary.')
on conflict (region_name) do update set
  aliases = excluded.aliases,
  description = excluded.description,
  source = excluded.source;

insert into region_gazetteer_members (region_name, sa3_code) values
  -- South-East Queensland (56 SA3s: Brisbane East/North/South/West/Inner, Gold Coast,
  -- Ipswich, Logan-Beaudesert, Moreton Bay North/South, Sunshine Coast)
  ('South-East Queensland', '30101'), ('South-East Queensland', '30102'), ('South-East Queensland', '30103'),
  ('South-East Queensland', '30201'), ('South-East Queensland', '30202'), ('South-East Queensland', '30203'), ('South-East Queensland', '30204'),
  ('South-East Queensland', '30301'), ('South-East Queensland', '30302'), ('South-East Queensland', '30303'), ('South-East Queensland', '30304'), ('South-East Queensland', '30305'), ('South-East Queensland', '30306'),
  ('South-East Queensland', '30401'), ('South-East Queensland', '30402'), ('South-East Queensland', '30403'), ('South-East Queensland', '30404'),
  ('South-East Queensland', '30501'), ('South-East Queensland', '30502'), ('South-East Queensland', '30503'), ('South-East Queensland', '30504'),
  ('South-East Queensland', '30901'), ('South-East Queensland', '30902'), ('South-East Queensland', '30903'), ('South-East Queensland', '30904'), ('South-East Queensland', '30905'), ('South-East Queensland', '30906'), ('South-East Queensland', '30907'), ('South-East Queensland', '30908'), ('South-East Queensland', '30909'), ('South-East Queensland', '30910'),
  ('South-East Queensland', '31001'), ('South-East Queensland', '31002'), ('South-East Queensland', '31003'), ('South-East Queensland', '31004'),
  ('South-East Queensland', '31101'), ('South-East Queensland', '31102'), ('South-East Queensland', '31103'), ('South-East Queensland', '31104'), ('South-East Queensland', '31105'), ('South-East Queensland', '31106'),
  ('South-East Queensland', '31301'), ('South-East Queensland', '31302'), ('South-East Queensland', '31303'), ('South-East Queensland', '31304'), ('South-East Queensland', '31305'),
  ('South-East Queensland', '31401'), ('South-East Queensland', '31402'), ('South-East Queensland', '31403'),
  ('South-East Queensland', '31601'), ('South-East Queensland', '31602'), ('South-East Queensland', '31603'), ('South-East Queensland', '31605'), ('South-East Queensland', '31606'), ('South-East Queensland', '31607'), ('South-East Queensland', '31608'),
  -- Western Sydney (21 SA3s: Blacktown, Parramatta, Outer West/Blue Mountains,
  -- Baulkham Hills/Hawkesbury, South West, Outer South West)
  ('Western Sydney', '11501'), ('Western Sydney', '11502'), ('Western Sydney', '11503'), ('Western Sydney', '11504'),
  ('Western Sydney', '11601'), ('Western Sydney', '11602'), ('Western Sydney', '11603'),
  ('Western Sydney', '12301'), ('Western Sydney', '12302'), ('Western Sydney', '12303'),
  ('Western Sydney', '12401'), ('Western Sydney', '12403'), ('Western Sydney', '12404'), ('Western Sydney', '12405'),
  ('Western Sydney', '12501'), ('Western Sydney', '12502'), ('Western Sydney', '12503'), ('Western Sydney', '12504'),
  ('Western Sydney', '12701'), ('Western Sydney', '12702'), ('Western Sydney', '12703'),
  -- Greater Melbourne (40 SA3s: all Melbourne- SA4s + Mornington Peninsula)
  ('Greater Melbourne', '20601'), ('Greater Melbourne', '20602'), ('Greater Melbourne', '20603'), ('Greater Melbourne', '20604'), ('Greater Melbourne', '20605'), ('Greater Melbourne', '20606'), ('Greater Melbourne', '20607'),
  ('Greater Melbourne', '20701'), ('Greater Melbourne', '20702'), ('Greater Melbourne', '20703'),
  ('Greater Melbourne', '20801'), ('Greater Melbourne', '20802'), ('Greater Melbourne', '20803'), ('Greater Melbourne', '20804'),
  ('Greater Melbourne', '20901'), ('Greater Melbourne', '20902'), ('Greater Melbourne', '20903'), ('Greater Melbourne', '20904'),
  ('Greater Melbourne', '21001'), ('Greater Melbourne', '21002'), ('Greater Melbourne', '21003'), ('Greater Melbourne', '21004'), ('Greater Melbourne', '21005'),
  ('Greater Melbourne', '21101'), ('Greater Melbourne', '21102'), ('Greater Melbourne', '21103'), ('Greater Melbourne', '21104'), ('Greater Melbourne', '21105'),
  ('Greater Melbourne', '21201'), ('Greater Melbourne', '21202'), ('Greater Melbourne', '21203'), ('Greater Melbourne', '21204'), ('Greater Melbourne', '21205'),
  ('Greater Melbourne', '21301'), ('Greater Melbourne', '21302'), ('Greater Melbourne', '21303'), ('Greater Melbourne', '21304'), ('Greater Melbourne', '21305'),
  ('Greater Melbourne', '21401'), ('Greater Melbourne', '21402')
on conflict (region_name, sa3_code) do nothing;

-- Nav copilot data-gap audit, Gap 3 -- "the field exists, but isn't populated widely
-- enough to trust silently." A query like "clinics with more than 5 GPs" would
-- silently exclude the ~61% of GP clinics with unknown (not zero) headcount unless
-- the copilot's response says so explicitly. This view gives per-region, per-field
-- population counts so a response can say "12 of 47 clinics, X have this field on
-- file" instead of implying completeness. Scoped per (market_id, sa3_code) rather
-- than a single market-wide average: a market-wide number can hide a region sitting
-- at 0% while another sits at 100%, and the brief's own example response
-- ("...out of 47 in this region...") is inherently region-scoped, not market-wide.
--
-- Field-to-market scoping, corrected after initially computing every field for every
-- market regardless of relevance: pathology/radiology_imaging/allied_health/
-- doctor_names/gp_count are gp-specific by schema design (clinics' own "gp-specific
-- (null for other markets)" comment) -- computing them for physio/dental produced a
-- wall of misleading 0.0% rows that read as "this market's data is a mess" when the
-- fields simply don't apply there, exactly the false-completeness-signal this gap is
-- supposed to prevent. Scoped those branches to market_id='gp' only. billing_type/
-- clinic_format stay cross-market -- schema treats them as shared columns, and 0% for
-- physio there is a genuine gap (data conceptually applies, just not collected), not
-- a structural non-applicability. Physio's own relevant fields (rank/primary_segment/
-- confidence/ndis/telehealth/segments) are added market-scoped the same way --
-- verified live they're actually 100% populated already, so this mostly documents
-- that physio's own data is clean, not a new gap to close. ownership/corporate_chain
-- are deliberately excluded -- 100% populated for gp today, not a completeness
-- concern (and not applicable to physio/dental per the same live check). total=0 for
-- a (market_id, sa3_code) pair with pct_populated null means "no clinics recorded
-- here at all" -- a bigger gap than sparse coverage, and the copilot's response logic
-- needs to tell those two cases apart (confirmed live: market_id='dental' currently
-- has zero rows in `clinics` market-wide -- not a coverage problem, a missing-dataset
-- problem, so it produces no rows in this view at all rather than misleading zeros).
create or replace view clinic_data_coverage as
select market_id, sa3_code, field, total, populated,
       round(100.0 * populated / nullif(total, 0), 1) as pct_populated
from (
  -- gp-only fields (schema-designated "gp-specific (null for other markets)")
  select market_id, sa3_code, 'gp_count' as field, count(*) as total, count(gp_count) as populated from clinics where market_id = 'gp' group by market_id, sa3_code
  union all
  select market_id, sa3_code, 'allied_health', count(*), count(allied_health) from clinics where market_id = 'gp' group by market_id, sa3_code
  union all
  select market_id, sa3_code, 'pathology', count(*), count(pathology) from clinics where market_id = 'gp' group by market_id, sa3_code
  union all
  select market_id, sa3_code, 'radiology_imaging', count(*), count(radiology_imaging) from clinics where market_id = 'gp' group by market_id, sa3_code
  union all
  select market_id, sa3_code, 'doctor_names', count(*), count(doctor_names) from clinics where market_id = 'gp' group by market_id, sa3_code
  -- shared fields, computed across every market -- 0% here is a real gap, not a
  -- structural non-applicability
  union all
  select market_id, sa3_code, 'billing_type', count(*), count(billing_type) from clinics group by market_id, sa3_code
  union all
  select market_id, sa3_code, 'clinic_format', count(*), count(clinic_format) from clinics group by market_id, sa3_code
  -- physio-only fields
  union all
  select market_id, sa3_code, 'rank', count(*), count(rank) from clinics where market_id = 'physio' group by market_id, sa3_code
  union all
  select market_id, sa3_code, 'primary_segment', count(*), count(primary_segment) from clinics where market_id = 'physio' group by market_id, sa3_code
  union all
  select market_id, sa3_code, 'confidence', count(*), count(confidence) from clinics where market_id = 'physio' group by market_id, sa3_code
  union all
  select market_id, sa3_code, 'segments', count(*), count(segments) from clinics where market_id = 'physio' group by market_id, sa3_code
  union all
  select market_id, sa3_code, 'ndis', count(*), count(ndis) from clinics where market_id = 'physio' group by market_id, sa3_code
  union all
  select market_id, sa3_code, 'telehealth', count(*), count(telehealth) from clinics where market_id = 'physio' group by market_id, sa3_code
) t;

-- Market-wide rollup of the same view, for "how complete is X overall" queries that
-- aren't scoped to one region. Sums the per-region counts rather than re-querying
-- `clinics` directly, so the two views can never disagree with each other.
create or replace view clinic_data_coverage_by_market as
select market_id, field,
       sum(total) as total,
       sum(populated) as populated,
       round(100.0 * sum(populated) / nullif(sum(total), 0), 1) as pct_populated
from clinic_data_coverage
group by market_id, field;

-- Comprehensive national gazetteer expansion (follow-up to Gap 1). Every ABS SA4
-- becomes its own gazetteer entry under its real, official name -- not a judgment
-- call, purely mechanical: sa3 has no sa4_code column at all, so even a single-SA4
-- name like "Illawarra" or "Cairns" can't be resolved today without an entry here,
-- official ABS name or not. Generated programmatically from clinics.sa4_code/
-- sa4_name (the same real, geocoded source used for the original 3 regions) --
-- not hand-typed, to eliminate transcription risk at this scale (89 SA4s, 340 SA3s).
-- 4 SA3s have zero clinics recorded (reserves/uninhabited: Illawarra Catchment
-- Reserve, Blue Mountains - South, Uriarra - Namadgi, Jervis Bay) so they don't
-- surface via a clinics-table join; their SA4 membership is inferred from the
-- sa3_code prefix instead, a rule confirmed reliable with zero exceptions across
-- all 336 clinics-verified (sa4,sa3) pairs before being applied to these 4.
insert into region_definitions (region_name, aliases, description, source) values
  ('Capital Region', array[]::text[], 'ABS SA4 101 (Capital Region).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Central Coast', array[]::text[], 'ABS SA4 102 (Central Coast).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Central West', array[]::text[], 'ABS SA4 103 (Central West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Coffs Harbour - Grafton', array[]::text[], 'ABS SA4 104 (Coffs Harbour - Grafton).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Far West and Orana', array[]::text[], 'ABS SA4 105 (Far West and Orana).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Hunter Valley exc Newcastle', array[]::text[], 'ABS SA4 106 (Hunter Valley exc Newcastle).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Illawarra', array[]::text[], 'ABS SA4 107 (Illawarra).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Mid North Coast', array[]::text[], 'ABS SA4 108 (Mid North Coast).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Murray', array[]::text[], 'ABS SA4 109 (Murray).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('New England and North West', array[]::text[], 'ABS SA4 110 (New England and North West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Newcastle and Lake Macquarie', array[]::text[], 'ABS SA4 111 (Newcastle and Lake Macquarie).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Richmond - Tweed', array[]::text[], 'ABS SA4 112 (Richmond - Tweed).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Riverina', array[]::text[], 'ABS SA4 113 (Riverina).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Southern Highlands and Shoalhaven', array[]::text[], 'ABS SA4 114 (Southern Highlands and Shoalhaven).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Baulkham Hills and Hawkesbury', array[]::text[], 'ABS SA4 115 (Sydney - Baulkham Hills and Hawkesbury).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Blacktown', array[]::text[], 'ABS SA4 116 (Sydney - Blacktown).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - City and Inner South', array[]::text[], 'ABS SA4 117 (Sydney - City and Inner South).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Eastern Suburbs', array[]::text[], 'ABS SA4 118 (Sydney - Eastern Suburbs).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Inner South West', array[]::text[], 'ABS SA4 119 (Sydney - Inner South West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Inner West', array[]::text[], 'ABS SA4 120 (Sydney - Inner West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - North Sydney and Hornsby', array[]::text[], 'ABS SA4 121 (Sydney - North Sydney and Hornsby).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Northern Beaches', array[]::text[], 'ABS SA4 122 (Sydney - Northern Beaches).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Outer South West', array[]::text[], 'ABS SA4 123 (Sydney - Outer South West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Outer West and Blue Mountains', array[]::text[], 'ABS SA4 124 (Sydney - Outer West and Blue Mountains).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Parramatta', array[]::text[], 'ABS SA4 125 (Sydney - Parramatta).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Ryde', array[]::text[], 'ABS SA4 126 (Sydney - Ryde).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - South West', array[]::text[], 'ABS SA4 127 (Sydney - South West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sydney - Sutherland', array[]::text[], 'ABS SA4 128 (Sydney - Sutherland).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Ballarat', array[]::text[], 'ABS SA4 201 (Ballarat).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Bendigo', array[]::text[], 'ABS SA4 202 (Bendigo).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Geelong', array[]::text[], 'ABS SA4 203 (Geelong).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Hume', array[]::text[], 'ABS SA4 204 (Hume).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Latrobe - Gippsland', array[]::text[], 'ABS SA4 205 (Latrobe - Gippsland).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Melbourne - Inner', array[]::text[], 'ABS SA4 206 (Melbourne - Inner).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Melbourne - Inner East', array[]::text[], 'ABS SA4 207 (Melbourne - Inner East).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Melbourne - Inner South', array[]::text[], 'ABS SA4 208 (Melbourne - Inner South).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Melbourne - North East', array[]::text[], 'ABS SA4 209 (Melbourne - North East).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Melbourne - North West', array[]::text[], 'ABS SA4 210 (Melbourne - North West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Melbourne - Outer East', array[]::text[], 'ABS SA4 211 (Melbourne - Outer East).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Melbourne - South East', array[]::text[], 'ABS SA4 212 (Melbourne - South East).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Melbourne - West', array[]::text[], 'ABS SA4 213 (Melbourne - West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Mornington Peninsula', array[]::text[], 'ABS SA4 214 (Mornington Peninsula).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('North West', array[]::text[], 'ABS SA4 215 (North West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Shepparton', array[]::text[], 'ABS SA4 216 (Shepparton).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Warrnambool and South West', array[]::text[], 'ABS SA4 217 (Warrnambool and South West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Brisbane - East', array[]::text[], 'ABS SA4 301 (Brisbane - East).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Brisbane - North', array[]::text[], 'ABS SA4 302 (Brisbane - North).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Brisbane - South', array[]::text[], 'ABS SA4 303 (Brisbane - South).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Brisbane - West', array[]::text[], 'ABS SA4 304 (Brisbane - West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Brisbane Inner City', array[]::text[], 'ABS SA4 305 (Brisbane Inner City).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Cairns', array[]::text[], 'ABS SA4 306 (Cairns).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Darling Downs - Maranoa', array[]::text[], 'ABS SA4 307 (Darling Downs - Maranoa).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Central Queensland', array[]::text[], 'ABS SA4 308 (Central Queensland).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Gold Coast', array[]::text[], 'ABS SA4 309 (Gold Coast).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Ipswich', array[]::text[], 'ABS SA4 310 (Ipswich).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Logan - Beaudesert', array[]::text[], 'ABS SA4 311 (Logan - Beaudesert).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Mackay - Isaac - Whitsunday', array[]::text[], 'ABS SA4 312 (Mackay - Isaac - Whitsunday).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Moreton Bay - North', array[]::text[], 'ABS SA4 313 (Moreton Bay - North).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Moreton Bay - South', array[]::text[], 'ABS SA4 314 (Moreton Bay - South).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Queensland - Outback', array[]::text[], 'ABS SA4 315 (Queensland - Outback).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Sunshine Coast', array[]::text[], 'ABS SA4 316 (Sunshine Coast).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Toowoomba', array[]::text[], 'ABS SA4 317 (Toowoomba).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Townsville', array[]::text[], 'ABS SA4 318 (Townsville).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Wide Bay', array[]::text[], 'ABS SA4 319 (Wide Bay).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Adelaide - Central and Hills', array[]::text[], 'ABS SA4 401 (Adelaide - Central and Hills).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Adelaide - North', array[]::text[], 'ABS SA4 402 (Adelaide - North).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Adelaide - South', array[]::text[], 'ABS SA4 403 (Adelaide - South).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Adelaide - West', array[]::text[], 'ABS SA4 404 (Adelaide - West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Barossa - Yorke - Mid North', array[]::text[], 'ABS SA4 405 (Barossa - Yorke - Mid North).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('South Australia - Outback', array[]::text[], 'ABS SA4 406 (South Australia - Outback).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('South Australia - South East', array[]::text[], 'ABS SA4 407 (South Australia - South East).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Bunbury', array[]::text[], 'ABS SA4 501 (Bunbury).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Mandurah', array[]::text[], 'ABS SA4 502 (Mandurah).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Perth - Inner', array[]::text[], 'ABS SA4 503 (Perth - Inner).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Perth - North East', array[]::text[], 'ABS SA4 504 (Perth - North East).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Perth - North West', array[]::text[], 'ABS SA4 505 (Perth - North West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Perth - South East', array[]::text[], 'ABS SA4 506 (Perth - South East).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Perth - South West', array[]::text[], 'ABS SA4 507 (Perth - South West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Western Australia - Wheat Belt', array[]::text[], 'ABS SA4 509 (Western Australia - Wheat Belt).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Western Australia - Outback (North)', array[]::text[], 'ABS SA4 510 (Western Australia - Outback (North)).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Western Australia - Outback (South)', array[]::text[], 'ABS SA4 511 (Western Australia - Outback (South)).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Hobart', array['Greater Hobart'], 'ABS SA4 601 (Hobart).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Launceston and North East', array[]::text[], 'ABS SA4 602 (Launceston and North East).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('South East', array[]::text[], 'ABS SA4 603 (South East).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('West and North West', array[]::text[], 'ABS SA4 604 (West and North West).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Darwin', array['Greater Darwin'], 'ABS SA4 701 (Darwin).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Northern Territory - Outback', array[]::text[], 'ABS SA4 702 (Northern Territory - Outback).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Australian Capital Territory', array['ACT','Canberra','Greater Canberra'], 'ABS SA4 801 (Australian Capital Territory).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Other Territories', array[]::text[], 'ABS SA4 901 (Other Territories).', 'Official ABS SA4 boundary -- mechanically generated, not a judgment call.'),
  ('Greater Sydney', array[]::text[], 'All 14 Sydney SA4s (official ABS Greater Sydney GCCSA).', 'Matches the ABS Greater Sydney GCCSA definition exactly -- excludes Central Coast, Hunter/Newcastle, and Illawarra, which ABS treats as outside Greater Sydney.'),
  ('Greater Brisbane', array[]::text[], 'Brisbane, Ipswich, Logan-Beaudesert and Moreton Bay SA4s (official ABS Greater Brisbane GCCSA).', 'Matches the ABS Greater Brisbane GCCSA definition exactly -- narrower than the "South-East Queensland" gazetteer entry, which also includes Gold Coast and Sunshine Coast (both outside the official GCCSA boundary, part of "Rest of Qld").'),
  ('Greater Perth', array[]::text[], 'All 5 Perth SA4s plus Mandurah.', 'Matches the current ABS Greater Perth GCCSA definition, which includes Mandurah following a boundary update -- flagged as the one judgment call in this group (older ABS releases excluded Mandurah); revisit if that turns out to be the wrong vintage for this app''s purposes.'),
  ('Greater Adelaide', array[]::text[], 'All 4 Adelaide SA4s (official ABS Greater Adelaide GCCSA).', 'Matches the ABS Greater Adelaide GCCSA definition exactly -- excludes Barossa-Yorke-Mid North, which ABS treats as outside Greater Adelaide.')
on conflict (region_name) do update set aliases = excluded.aliases, description = excluded.description, source = excluded.source;

insert into region_gazetteer_members (region_name, sa3_code) values
  ('Capital Region', '10102'),
  ('Capital Region', '10103'),
  ('Capital Region', '10104'),
  ('Capital Region', '10105'),
  ('Capital Region', '10106'),
  ('Central Coast', '10201'),
  ('Central Coast', '10202'),
  ('Central West', '10301'),
  ('Central West', '10302'),
  ('Central West', '10303'),
  ('Central West', '10304'),
  ('Coffs Harbour - Grafton', '10401'),
  ('Coffs Harbour - Grafton', '10402'),
  ('Far West and Orana', '10501'),
  ('Far West and Orana', '10502'),
  ('Far West and Orana', '10503'),
  ('Hunter Valley exc Newcastle', '10601'),
  ('Hunter Valley exc Newcastle', '10602'),
  ('Hunter Valley exc Newcastle', '10603'),
  ('Hunter Valley exc Newcastle', '10604'),
  ('Illawarra', '10701'),
  ('Illawarra', '10702'),
  ('Illawarra', '10703'),
  ('Illawarra', '10704'),
  ('Mid North Coast', '10801'),
  ('Mid North Coast', '10802'),
  ('Mid North Coast', '10803'),
  ('Mid North Coast', '10804'),
  ('Mid North Coast', '10805'),
  ('Murray', '10901'),
  ('Murray', '10902'),
  ('Murray', '10903'),
  ('New England and North West', '11001'),
  ('New England and North West', '11002'),
  ('New England and North West', '11003'),
  ('New England and North West', '11004'),
  ('Newcastle and Lake Macquarie', '11101'),
  ('Newcastle and Lake Macquarie', '11102'),
  ('Newcastle and Lake Macquarie', '11103'),
  ('Richmond - Tweed', '11201'),
  ('Richmond - Tweed', '11202'),
  ('Richmond - Tweed', '11203'),
  ('Riverina', '11301'),
  ('Riverina', '11302'),
  ('Riverina', '11303'),
  ('Southern Highlands and Shoalhaven', '11401'),
  ('Southern Highlands and Shoalhaven', '11402'),
  ('Sydney - Baulkham Hills and Hawkesbury', '11501'),
  ('Sydney - Baulkham Hills and Hawkesbury', '11502'),
  ('Sydney - Baulkham Hills and Hawkesbury', '11503'),
  ('Sydney - Baulkham Hills and Hawkesbury', '11504'),
  ('Sydney - Blacktown', '11601'),
  ('Sydney - Blacktown', '11602'),
  ('Sydney - Blacktown', '11603'),
  ('Sydney - City and Inner South', '11701'),
  ('Sydney - City and Inner South', '11702'),
  ('Sydney - City and Inner South', '11703'),
  ('Sydney - Eastern Suburbs', '11801'),
  ('Sydney - Eastern Suburbs', '11802'),
  ('Sydney - Inner South West', '11901'),
  ('Sydney - Inner South West', '11902'),
  ('Sydney - Inner South West', '11903'),
  ('Sydney - Inner South West', '11904'),
  ('Sydney - Inner West', '12001'),
  ('Sydney - Inner West', '12002'),
  ('Sydney - Inner West', '12003'),
  ('Sydney - North Sydney and Hornsby', '12101'),
  ('Sydney - North Sydney and Hornsby', '12102'),
  ('Sydney - North Sydney and Hornsby', '12103'),
  ('Sydney - North Sydney and Hornsby', '12104'),
  ('Sydney - Northern Beaches', '12201'),
  ('Sydney - Northern Beaches', '12202'),
  ('Sydney - Northern Beaches', '12203'),
  ('Sydney - Outer South West', '12301'),
  ('Sydney - Outer South West', '12302'),
  ('Sydney - Outer South West', '12303'),
  ('Sydney - Outer West and Blue Mountains', '12401'),
  ('Sydney - Outer West and Blue Mountains', '12402'),
  ('Sydney - Outer West and Blue Mountains', '12403'),
  ('Sydney - Outer West and Blue Mountains', '12404'),
  ('Sydney - Outer West and Blue Mountains', '12405'),
  ('Sydney - Parramatta', '12501'),
  ('Sydney - Parramatta', '12502'),
  ('Sydney - Parramatta', '12503'),
  ('Sydney - Parramatta', '12504'),
  ('Sydney - Ryde', '12601'),
  ('Sydney - Ryde', '12602'),
  ('Sydney - South West', '12701'),
  ('Sydney - South West', '12702'),
  ('Sydney - South West', '12703'),
  ('Sydney - Sutherland', '12801'),
  ('Sydney - Sutherland', '12802'),
  ('Ballarat', '20101'),
  ('Ballarat', '20102'),
  ('Ballarat', '20103'),
  ('Bendigo', '20201'),
  ('Bendigo', '20202'),
  ('Bendigo', '20203'),
  ('Geelong', '20301'),
  ('Geelong', '20302'),
  ('Geelong', '20303'),
  ('Hume', '20401'),
  ('Hume', '20402'),
  ('Hume', '20403'),
  ('Latrobe - Gippsland', '20501'),
  ('Latrobe - Gippsland', '20502'),
  ('Latrobe - Gippsland', '20503'),
  ('Latrobe - Gippsland', '20504'),
  ('Latrobe - Gippsland', '20505'),
  ('Melbourne - Inner', '20601'),
  ('Melbourne - Inner', '20602'),
  ('Melbourne - Inner', '20603'),
  ('Melbourne - Inner', '20604'),
  ('Melbourne - Inner', '20605'),
  ('Melbourne - Inner', '20606'),
  ('Melbourne - Inner', '20607'),
  ('Melbourne - Inner East', '20701'),
  ('Melbourne - Inner East', '20702'),
  ('Melbourne - Inner East', '20703'),
  ('Melbourne - Inner South', '20801'),
  ('Melbourne - Inner South', '20802'),
  ('Melbourne - Inner South', '20803'),
  ('Melbourne - Inner South', '20804'),
  ('Melbourne - North East', '20901'),
  ('Melbourne - North East', '20902'),
  ('Melbourne - North East', '20903'),
  ('Melbourne - North East', '20904'),
  ('Melbourne - North West', '21001'),
  ('Melbourne - North West', '21002'),
  ('Melbourne - North West', '21003'),
  ('Melbourne - North West', '21004'),
  ('Melbourne - North West', '21005'),
  ('Melbourne - Outer East', '21101'),
  ('Melbourne - Outer East', '21102'),
  ('Melbourne - Outer East', '21103'),
  ('Melbourne - Outer East', '21104'),
  ('Melbourne - Outer East', '21105'),
  ('Melbourne - South East', '21201'),
  ('Melbourne - South East', '21202'),
  ('Melbourne - South East', '21203'),
  ('Melbourne - South East', '21204'),
  ('Melbourne - South East', '21205'),
  ('Melbourne - West', '21301'),
  ('Melbourne - West', '21302'),
  ('Melbourne - West', '21303'),
  ('Melbourne - West', '21304'),
  ('Melbourne - West', '21305'),
  ('Mornington Peninsula', '21401'),
  ('Mornington Peninsula', '21402'),
  ('North West', '21501'),
  ('North West', '21502'),
  ('North West', '21503'),
  ('Shepparton', '21601'),
  ('Shepparton', '21602'),
  ('Shepparton', '21603'),
  ('Warrnambool and South West', '21701'),
  ('Warrnambool and South West', '21703'),
  ('Warrnambool and South West', '21704'),
  ('Brisbane - East', '30101'),
  ('Brisbane - East', '30102'),
  ('Brisbane - East', '30103'),
  ('Brisbane - North', '30201'),
  ('Brisbane - North', '30202'),
  ('Brisbane - North', '30203'),
  ('Brisbane - North', '30204'),
  ('Brisbane - South', '30301'),
  ('Brisbane - South', '30302'),
  ('Brisbane - South', '30303'),
  ('Brisbane - South', '30304'),
  ('Brisbane - South', '30305'),
  ('Brisbane - South', '30306'),
  ('Brisbane - West', '30401'),
  ('Brisbane - West', '30402'),
  ('Brisbane - West', '30403'),
  ('Brisbane - West', '30404'),
  ('Brisbane Inner City', '30501'),
  ('Brisbane Inner City', '30502'),
  ('Brisbane Inner City', '30503'),
  ('Brisbane Inner City', '30504'),
  ('Cairns', '30601'),
  ('Cairns', '30602'),
  ('Cairns', '30603'),
  ('Cairns', '30604'),
  ('Cairns', '30605'),
  ('Darling Downs - Maranoa', '30701'),
  ('Darling Downs - Maranoa', '30702'),
  ('Darling Downs - Maranoa', '30703'),
  ('Central Queensland', '30801'),
  ('Central Queensland', '30803'),
  ('Central Queensland', '30804'),
  ('Central Queensland', '30805'),
  ('Gold Coast', '30901'),
  ('Gold Coast', '30902'),
  ('Gold Coast', '30903'),
  ('Gold Coast', '30904'),
  ('Gold Coast', '30905'),
  ('Gold Coast', '30906'),
  ('Gold Coast', '30907'),
  ('Gold Coast', '30908'),
  ('Gold Coast', '30909'),
  ('Gold Coast', '30910'),
  ('Ipswich', '31001'),
  ('Ipswich', '31002'),
  ('Ipswich', '31003'),
  ('Ipswich', '31004'),
  ('Logan - Beaudesert', '31101'),
  ('Logan - Beaudesert', '31102'),
  ('Logan - Beaudesert', '31103'),
  ('Logan - Beaudesert', '31104'),
  ('Logan - Beaudesert', '31105'),
  ('Logan - Beaudesert', '31106'),
  ('Mackay - Isaac - Whitsunday', '31201'),
  ('Mackay - Isaac - Whitsunday', '31202'),
  ('Mackay - Isaac - Whitsunday', '31203'),
  ('Moreton Bay - North', '31301'),
  ('Moreton Bay - North', '31302'),
  ('Moreton Bay - North', '31303'),
  ('Moreton Bay - North', '31304'),
  ('Moreton Bay - North', '31305'),
  ('Moreton Bay - South', '31401'),
  ('Moreton Bay - South', '31402'),
  ('Moreton Bay - South', '31403'),
  ('Queensland - Outback', '31501'),
  ('Queensland - Outback', '31502'),
  ('Queensland - Outback', '31503'),
  ('Sunshine Coast', '31601'),
  ('Sunshine Coast', '31602'),
  ('Sunshine Coast', '31603'),
  ('Sunshine Coast', '31605'),
  ('Sunshine Coast', '31606'),
  ('Sunshine Coast', '31607'),
  ('Sunshine Coast', '31608'),
  ('Toowoomba', '31701'),
  ('Townsville', '31801'),
  ('Townsville', '31802'),
  ('Wide Bay', '31901'),
  ('Wide Bay', '31902'),
  ('Wide Bay', '31903'),
  ('Wide Bay', '31904'),
  ('Wide Bay', '31905'),
  ('Adelaide - Central and Hills', '40101'),
  ('Adelaide - Central and Hills', '40102'),
  ('Adelaide - Central and Hills', '40103'),
  ('Adelaide - Central and Hills', '40104'),
  ('Adelaide - Central and Hills', '40105'),
  ('Adelaide - Central and Hills', '40106'),
  ('Adelaide - Central and Hills', '40107'),
  ('Adelaide - North', '40201'),
  ('Adelaide - North', '40202'),
  ('Adelaide - North', '40203'),
  ('Adelaide - North', '40204'),
  ('Adelaide - North', '40205'),
  ('Adelaide - South', '40301'),
  ('Adelaide - South', '40302'),
  ('Adelaide - South', '40303'),
  ('Adelaide - South', '40304'),
  ('Adelaide - West', '40401'),
  ('Adelaide - West', '40402'),
  ('Adelaide - West', '40403'),
  ('Barossa - Yorke - Mid North', '40501'),
  ('Barossa - Yorke - Mid North', '40502'),
  ('Barossa - Yorke - Mid North', '40503'),
  ('Barossa - Yorke - Mid North', '40504'),
  ('South Australia - Outback', '40601'),
  ('South Australia - Outback', '40602'),
  ('South Australia - South East', '40701'),
  ('South Australia - South East', '40702'),
  ('South Australia - South East', '40703'),
  ('Bunbury', '50101'),
  ('Bunbury', '50102'),
  ('Bunbury', '50103'),
  ('Mandurah', '50201'),
  ('Perth - Inner', '50301'),
  ('Perth - Inner', '50302'),
  ('Perth - North East', '50401'),
  ('Perth - North East', '50402'),
  ('Perth - North East', '50403'),
  ('Perth - North West', '50501'),
  ('Perth - North West', '50502'),
  ('Perth - North West', '50503'),
  ('Perth - South East', '50601'),
  ('Perth - South East', '50602'),
  ('Perth - South East', '50603'),
  ('Perth - South East', '50604'),
  ('Perth - South East', '50605'),
  ('Perth - South East', '50606'),
  ('Perth - South East', '50607'),
  ('Perth - South West', '50701'),
  ('Perth - South West', '50702'),
  ('Perth - South West', '50703'),
  ('Perth - South West', '50704'),
  ('Perth - South West', '50705'),
  ('Western Australia - Wheat Belt', '50901'),
  ('Western Australia - Wheat Belt', '50902'),
  ('Western Australia - Wheat Belt', '50903'),
  ('Western Australia - Outback (North)', '51001'),
  ('Western Australia - Outback (North)', '51002'),
  ('Western Australia - Outback (North)', '51003'),
  ('Western Australia - Outback (South)', '51101'),
  ('Western Australia - Outback (South)', '51102'),
  ('Western Australia - Outback (South)', '51103'),
  ('Western Australia - Outback (South)', '51104'),
  ('Hobart', '60101'),
  ('Hobart', '60102'),
  ('Hobart', '60103'),
  ('Hobart', '60104'),
  ('Hobart', '60105'),
  ('Hobart', '60106'),
  ('Launceston and North East', '60201'),
  ('Launceston and North East', '60202'),
  ('Launceston and North East', '60203'),
  ('South East', '60301'),
  ('South East', '60302'),
  ('South East', '60303'),
  ('West and North West', '60401'),
  ('West and North West', '60402'),
  ('West and North West', '60403'),
  ('Darwin', '70101'),
  ('Darwin', '70102'),
  ('Darwin', '70103'),
  ('Darwin', '70104'),
  ('Northern Territory - Outback', '70201'),
  ('Northern Territory - Outback', '70202'),
  ('Northern Territory - Outback', '70203'),
  ('Northern Territory - Outback', '70204'),
  ('Northern Territory - Outback', '70205'),
  ('Australian Capital Territory', '80101'),
  ('Australian Capital Territory', '80103'),
  ('Australian Capital Territory', '80104'),
  ('Australian Capital Territory', '80105'),
  ('Australian Capital Territory', '80106'),
  ('Australian Capital Territory', '80107'),
  ('Australian Capital Territory', '80108'),
  ('Australian Capital Territory', '80109'),
  ('Australian Capital Territory', '80110'),
  ('Australian Capital Territory', '80111'),
  ('Other Territories', '90101'),
  ('Other Territories', '90102'),
  ('Other Territories', '90103'),
  ('Other Territories', '90104'),
  ('Greater Sydney', '11501'),
  ('Greater Sydney', '11502'),
  ('Greater Sydney', '11503'),
  ('Greater Sydney', '11504'),
  ('Greater Sydney', '11601'),
  ('Greater Sydney', '11602'),
  ('Greater Sydney', '11603'),
  ('Greater Sydney', '11701'),
  ('Greater Sydney', '11702'),
  ('Greater Sydney', '11703'),
  ('Greater Sydney', '11801'),
  ('Greater Sydney', '11802'),
  ('Greater Sydney', '11901'),
  ('Greater Sydney', '11902'),
  ('Greater Sydney', '11903'),
  ('Greater Sydney', '11904'),
  ('Greater Sydney', '12001'),
  ('Greater Sydney', '12002'),
  ('Greater Sydney', '12003'),
  ('Greater Sydney', '12101'),
  ('Greater Sydney', '12102'),
  ('Greater Sydney', '12103'),
  ('Greater Sydney', '12104'),
  ('Greater Sydney', '12201'),
  ('Greater Sydney', '12202'),
  ('Greater Sydney', '12203'),
  ('Greater Sydney', '12301'),
  ('Greater Sydney', '12302'),
  ('Greater Sydney', '12303'),
  ('Greater Sydney', '12401'),
  ('Greater Sydney', '12402'),
  ('Greater Sydney', '12403'),
  ('Greater Sydney', '12404'),
  ('Greater Sydney', '12405'),
  ('Greater Sydney', '12501'),
  ('Greater Sydney', '12502'),
  ('Greater Sydney', '12503'),
  ('Greater Sydney', '12504'),
  ('Greater Sydney', '12601'),
  ('Greater Sydney', '12602'),
  ('Greater Sydney', '12701'),
  ('Greater Sydney', '12702'),
  ('Greater Sydney', '12703'),
  ('Greater Sydney', '12801'),
  ('Greater Sydney', '12802'),
  ('Greater Brisbane', '30101'),
  ('Greater Brisbane', '30102'),
  ('Greater Brisbane', '30103'),
  ('Greater Brisbane', '30201'),
  ('Greater Brisbane', '30202'),
  ('Greater Brisbane', '30203'),
  ('Greater Brisbane', '30204'),
  ('Greater Brisbane', '30301'),
  ('Greater Brisbane', '30302'),
  ('Greater Brisbane', '30303'),
  ('Greater Brisbane', '30304'),
  ('Greater Brisbane', '30305'),
  ('Greater Brisbane', '30306'),
  ('Greater Brisbane', '30401'),
  ('Greater Brisbane', '30402'),
  ('Greater Brisbane', '30403'),
  ('Greater Brisbane', '30404'),
  ('Greater Brisbane', '30501'),
  ('Greater Brisbane', '30502'),
  ('Greater Brisbane', '30503'),
  ('Greater Brisbane', '30504'),
  ('Greater Brisbane', '31001'),
  ('Greater Brisbane', '31002'),
  ('Greater Brisbane', '31003'),
  ('Greater Brisbane', '31004'),
  ('Greater Brisbane', '31101'),
  ('Greater Brisbane', '31102'),
  ('Greater Brisbane', '31103'),
  ('Greater Brisbane', '31104'),
  ('Greater Brisbane', '31105'),
  ('Greater Brisbane', '31106'),
  ('Greater Brisbane', '31301'),
  ('Greater Brisbane', '31302'),
  ('Greater Brisbane', '31303'),
  ('Greater Brisbane', '31304'),
  ('Greater Brisbane', '31305'),
  ('Greater Brisbane', '31401'),
  ('Greater Brisbane', '31402'),
  ('Greater Brisbane', '31403'),
  ('Greater Perth', '50201'),
  ('Greater Perth', '50301'),
  ('Greater Perth', '50302'),
  ('Greater Perth', '50401'),
  ('Greater Perth', '50402'),
  ('Greater Perth', '50403'),
  ('Greater Perth', '50501'),
  ('Greater Perth', '50502'),
  ('Greater Perth', '50503'),
  ('Greater Perth', '50601'),
  ('Greater Perth', '50602'),
  ('Greater Perth', '50603'),
  ('Greater Perth', '50604'),
  ('Greater Perth', '50605'),
  ('Greater Perth', '50606'),
  ('Greater Perth', '50607'),
  ('Greater Perth', '50701'),
  ('Greater Perth', '50702'),
  ('Greater Perth', '50703'),
  ('Greater Perth', '50704'),
  ('Greater Perth', '50705'),
  ('Greater Adelaide', '40101'),
  ('Greater Adelaide', '40102'),
  ('Greater Adelaide', '40103'),
  ('Greater Adelaide', '40104'),
  ('Greater Adelaide', '40105'),
  ('Greater Adelaide', '40106'),
  ('Greater Adelaide', '40107'),
  ('Greater Adelaide', '40201'),
  ('Greater Adelaide', '40202'),
  ('Greater Adelaide', '40203'),
  ('Greater Adelaide', '40204'),
  ('Greater Adelaide', '40205'),
  ('Greater Adelaide', '40301'),
  ('Greater Adelaide', '40302'),
  ('Greater Adelaide', '40303'),
  ('Greater Adelaide', '40304'),
  ('Greater Adelaide', '40401'),
  ('Greater Adelaide', '40402'),
  ('Greater Adelaide', '40403')
on conflict (region_name, sa3_code) do nothing;
