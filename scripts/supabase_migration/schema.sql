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
  -- aged-care-specific (null for other markets) -- folded in from the standalone
  -- aged_care_providers table (see the "merge into clinics" block further down)
  entity_name text,
  business_name text,
  abn text,
  geocode_source text,
  geocode_confidence numeric,
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
alter table clinics add column if not exists entity_name text;
alter table clinics add column if not exists business_name text;
alter table clinics add column if not exists abn text;
alter table clinics add column if not exists geocode_source text;
alter table clinics add column if not exists geocode_confidence numeric;
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

-- get_clinics(p_market_id) -- RPC the client fetches via supabase.rpc(...),
-- same convention as get_sa3_geojson/get_aged_care_providers_geojson (not
-- itself tracked in this file, applied directly in Supabase). Originally
-- `select to_jsonb(c) - array['isochrone_geom', ...] from clinics c where
-- market_id = p_market_id` -- to_jsonb(c) serializes the FULL row, including
-- isochrone_geom (a MultiPolygon geography averaging ~17KB/row), before the
-- `-` array op discards it, so every call paid to convert ~140MB of geometry
-- to text for nothing. Confirmed via EXPLAIN ANALYZE: 9.8s execution for the
-- physio market alone (matches the "clicking Physio takes 10s" report).
-- Fixed by selecting only the ~50 columns the client actually uses in an
-- inner subquery first, so the heavy geometry columns are never touched --
-- same output shape/columns, 350ms execution (~28x).
-- CREATE OR REPLACE FUNCTION public.get_clinics(p_market_id text)
--  RETURNS jsonb LANGUAGE sql STABLE
--  SET search_path TO 'public', 'pg_catalog'
--  SET statement_timeout TO '30s'
-- AS $function$
--   select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
--   from (
--     select
--       market_id, clinic_id, name, address, address1, suburb, state_code,
--       state_name, postcode, website, phone, email, latitude, longitude,
--       sa1_code, sa2_code, sa2_name, sa2_area_km2, sa3_code, sa3_name,
--       sa4_code, sa4_name, gccsa_code, gccsa_name, geographic_area_class,
--       geographic_source_date, gnaf_address_id, ownership, clinic_format,
--       billing_type, corporate_chain, gp_count, google_review_count,
--       google_rating, nhsd_service_id, nhsd_service_type, pathology,
--       radiology_imaging, allied_health, doctor_names, format_confidence,
--       ndis, telehealth, rank, segments, primary_segment, confidence,
--       gp_count_last_scraped_at, gp_count_source_url, gp_count_confidence,
--       entity_name, business_name, abn, geocode_source, geocode_confidence,
--       phn_code, phn_name
--     from clinics c
--     where c.market_id = p_market_id
--   ) t;
-- $function$
-- (column list extended when aged_care_providers merged into clinics, then
-- again when phn_code/phn_name were backfilled onto clinics -- see those
-- migration blocks further down; re-apply this CREATE OR REPLACE if
-- get_clinics's live definition ever needs touching again, since it's a
-- fixed explicit column list, not select *. The PHN backfill migration added
-- the columns to clinics but didn't update this function -- same class of
-- gap as the aged_care_providers merge hit, caught the same way: checking
-- the client-visible output, not just the DB column, before calling it done.)

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

-- GP count data-integrity remediation, Phase 0 -- a "is this field populated"
-- view (clinic_data_coverage above) says nothing about whether a populated
-- value is actually correct. The original scraper (archive/old-scripts/
-- scrape_clinics_full.py's extract_doctor_names()) hard-caps its output at
-- doctor_names[:5], so any clinic with 6+ real GPs is mathematically
-- guaranteed to be undercounted -- a zero-rescrape, purely structural signal
-- we can compute today. doctor_names is confirmed comma-separated free text
-- (the same format src/js/app.js's computeGpAdjustmentFactors already parses
-- via raw.split(',')), so splitting on ',' here is a direct, safe reuse of
-- the existing format, not a new parsing convention.
--
-- Kept as its own view rather than folded into clinic_data_coverage: that
-- view answers "is it on file at all," this one answers "should you trust
-- the value that is on file" -- different questions, and conflating them
-- would make clinic_data_coverage's pct_populated numbers ambiguous about
-- which thing they're measuring.
create or replace view clinic_gp_count_reliability as
select
  clinic_id, market_id, sa3_code, gp_count, doctor_names,
  case
    when doctor_names is null then 'no_data'
    when array_length(regexp_split_to_array(trim(doctor_names), '\s*,\s*'), 1) = 5 then 'likely_undercount'
    else 'unverified'
  end as gp_count_reliability
from clinics
where market_id = 'gp';

-- Phase 1 -- real provenance, so this can't recur silently the way it did
-- the first time (several independent per-chain scrapers were merged by
-- enrich_billing_and_gp.py with no retained record of which value "won").
-- gp_count_confidence mirrors the existing format_confidence column's plain-
-- string convention (see clinics table definition above) rather than
-- inventing a new value-encoding scheme for confidence fields.
alter table clinics add column if not exists gp_count_last_scraped_at timestamptz;
alter table clinics add column if not exists gp_count_source_url text;
alter table clinics add column if not exists gp_count_confidence text; -- 'high' | 'unverified' | 'low' -- null means "not yet assessed", never defaulted to 'high'

-- Backfill: only the *provably* wrong subset gets flagged 'low' today.
-- Everything else stays null (not yet assessed) rather than being assumed
-- 'high' -- absence of the cap signal is not proof of correctness, only the
-- Phase 3 audit or a real Phase 4 re-scrape can earn a 'high'/'low' verdict
-- for the 'unverified' rows.
update clinics set gp_count_confidence = 'low'
from clinic_gp_count_reliability r
where clinics.clinic_id = r.clinic_id
  and clinics.market_id = r.market_id
  and r.gp_count_reliability = 'likely_undercount';

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

-- Phase 5 -- gp_count_confidence: one source of truth, plain-language values.
--
-- Phase 1 stored the scrape pipeline's own internal extraction-quality tier
-- ('high'/'medium'/'low') directly in gp_count_confidence, and
-- clinic_gp_count_reliability computed a SEPARATE signal from raw
-- doctor_names (the "hit exactly 5 names" cap heuristic) -- two independent
-- systems that inevitably drifted apart once the Phase 4 discover+scrape
-- pipeline started actually writing confirmed counts (e.g. a clinic
-- correctly marked gp_count_confidence:'high' after real verification still
-- read gp_count_reliability:'unverified' from the view, since the view had
-- no idea anything had changed).
--
-- Fix: gp_count_confidence now stores the user-facing situation directly --
-- 'confirmed' (independently checked, collapsing the old high+medium since
-- the frontend never distinguished them) or 'flagged' (specific reason to
-- doubt the count -- old 'low'). null still means "not independently
-- checked", never defaulted to a positive value. The view becomes a thin
-- passthrough of this same column instead of a second computation, so it
-- literally cannot disagree with the app's own badge (src/js/app.js
-- gpConfidenceBadge) or the "Ask Foundry" assistant's query_gp_count_reliability
-- tool (api/assistant.js) again.
update clinics set gp_count_confidence = 'confirmed' where gp_count_confidence in ('high', 'medium');
update clinics set gp_count_confidence = 'flagged' where gp_count_confidence = 'low';

drop view if exists clinic_gp_count_reliability;
create view clinic_gp_count_reliability as
select
  clinic_id, market_id, sa3_code, gp_count, doctor_names, gp_count_confidence,
  coalesce(
    gp_count_confidence,
    case when doctor_names is null then 'no_data' else 'unverified' end
  ) as gp_count_reliability
from clinics
where market_id = 'gp';

-- Aged care residential homes (ACQSC provider register, one row per physical
-- home -- not per business entity; a provider can operate several homes).
-- Source: acqsc-provider-register.xlsx, "Residential Care Home Details"
-- sheet, 2,933 rows, downloaded from the Aged Care Quality and Safety
-- Commission. Feeds the "Aged-care provider locations" Data Catalogue slot
-- (previously a placeholder marked available:false -- see CATALOGUE_CATEGORIES
-- in app.js -- since this app had no real aged-care dataset until now).
--
-- Coordinates were resolved in two passes, both real, neither fabricated:
--   1. G-NAF (the government address file) address match -- 2,724 rows
--      (92.9%). geocode_confidence = 1.0 for these.
--   2. The ~209 G-NAF couldn't resolve (typos, hospital/facility names
--      instead of a street address, embedded state/postcode text, etc.)
--      were run through Mapbox's Geocoding API as a second pass. Only
--      results at medium-or-higher relevance (>=0.7) were kept -- 186 more
--      rows. The ~23 that came back low/very-low confidence were left with
--      no coordinates at all rather than accepting a wrong one: verified
--      examples in that band included a Prospect SA address matched to a
--      suburb 80km away, and two NT addresses matched into Victoria and
--      Queensland respectively. geocode_source/geocode_confidence make
--      this distinction visible per row rather than silently blending two
--      different geocoding methods together.
--
-- Result: 2,910 of 2,933 homes (99.2%) have real coordinates; 23 are
-- honestly null pending manual lookup (see the "Needs Manual Review"
-- workbook from that session for exactly which ones and why).
create table if not exists aged_care_providers (
  site_id text primary key,
  entity_name text,
  business_name text,
  abn text,
  home_name text,
  street text,
  suburb text,
  state text,
  postcode text,
  full_address text,
  latitude numeric,
  longitude numeric,
  location geography(Point, 4326),
  geocode_source text,   -- 'gnaf' | 'mapbox' | null (unresolved)
  geocode_confidence numeric,  -- 1.0 for gnaf; Mapbox's own relevance score (0-1) for mapbox
  sa3_code text,
  sa3_name text,
  sa2_code text,
  sa2_name text,
  sa2_area_km2 numeric,
  sa4_code text,
  sa4_name text
);
alter table aged_care_providers add column if not exists sa2_code text;
alter table aged_care_providers add column if not exists sa2_name text;
alter table aged_care_providers add column if not exists sa2_area_km2 numeric;
alter table aged_care_providers add column if not exists sa4_code text;
alter table aged_care_providers add column if not exists sa4_name text;
create index if not exists aged_care_providers_location_idx on aged_care_providers using gist (location);
create index if not exists aged_care_providers_suburb_idx on aged_care_providers (suburb, state);

-- sa3_code/sa3_name: real point-in-polygon join against sa3.geom, not a
-- name/postcode guess -- matches 2,907 of 2,910 geocoded rows (the 3 misses
-- are ordinary suburban addresses sitting right on an sa3.geom boundary
-- seam, not a data problem with this table).
update aged_care_providers p set
  sa3_code = s.sa3_code,
  sa3_name = s.sa3_name
from sa3 s
where p.location is not null
  and p.sa3_code is null
  and ST_Contains(s.geom::geometry, p.location::geometry);

-- sa2_code/sa2_name/sa2_area_km2/sa4_code/sa4_name -- not a full scoring-market
-- migration (no market_id, no composite/tier config, no supply metric exists
-- in the ACQSC provider register to score against -- see the "should I merge
-- into clinics" discussion this followed), just the geography hierarchy that
-- was safely derivable from data already on hand: sa2 via the same
-- ST_Contains point-in-polygon pattern as sa3 above (matches 2,902 of 2,933
-- rows -- 23 have no coordinates at all, 8 sit on an sa2.geom boundary seam,
-- same seam issue as the 3 sa3 misses), sa2_area_km2 from that sa2 polygon's
-- own ST_Area, sa4_code by taking sa2_code's first 3 digits (ASGS 2021 codes
-- are hierarchical -- verified 100% match, all 7,845 clinics rows with both
-- codes set, not assumed), and sa4_name by joining clinics' own existing
-- sa4_code->sa4_name pairs (verified consistent -- 0 sa4_codes with more than
-- one distinct name across 89 codes -- and covers all 89 SA4s nationally, so
-- every code aged care could derive already has a real name available,
-- nothing invented). gccsa_code/gccsa_name were deliberately left out --
-- spot-checking clinics' own values for these turned up inconsistent/dirty
-- data (mixed code formats, some rows using the display name as the code),
-- so there was no reliable existing source to derive from.
update aged_care_providers p set
  sa2_code = s.sa2_code,
  sa2_name = s.sa2_name
from sa2 s
where p.location is not null
  and p.sa2_code is null
  and ST_Contains(s.geom::geometry, p.location::geometry);

update aged_care_providers p set
  sa2_area_km2 = ST_Area(s.geom) / 1000000.0
from sa2 s
where p.sa2_code = s.sa2_code
  and p.sa2_area_km2 is null;

update aged_care_providers set sa4_code = left(sa2_code, 3)
where sa2_code is not null and sa4_code is null;

update aged_care_providers p set sa4_name = lut.sa4_name
from (select distinct sa4_code, sa4_name from clinics where sa4_code is not null) lut
where p.sa4_code = lut.sa4_code
  and p.sa4_name is null;

-- phn -- PHN (Primary Health Network) boundaries, source: Digital Atlas of
-- Australia (digital.atlas.gov.au/datasets/primary-health-networks), Dept of
-- Health/Disability/Ageing, Aug 2023 vintage. The CSV export of this dataset
-- (attribute table only -- OBJECTID/PHN_CODE/PHN_NAME/state/Shape__Area/
-- Shape__Length, no geometry) is NOT enough to classify a clinic by PHN --
-- there's no way to point-in-polygon match a suburb to 1-of-10 PHNs in a
-- state from attributes alone. The GeoJSON export (same dataset, real
-- MultiPolygon boundaries, EPSG:4326) is what this table is loaded from.
--
-- geom_simplified: the raw GeoJSON is extremely high-resolution -- 2.19M
-- total vertices across just 31 polygons (Tasmania's PHN601 alone has
-- 625,504, presumably tracing every coastal inlet) -- a plain ST_Contains
-- join against `geom` timed out repeatedly against clinics (~19.6k rows),
-- even at a 4-minute statement_timeout. ST_SimplifyPreserveTopology at a
-- 0.001-degree (~100m) tolerance cut that to 141k vertices (~15x) and the
-- same join completed in 57s -- 100m is far more precision than classifying
-- which PHN a clinic sits in needs, nowhere near enough to matter for
-- boundary-line rendering (not this table's job). Kept `geom` too, at full
-- precision, in case something later actually needs it.
create table if not exists phn (
  phn_code text primary key,
  phn_name text,
  state_code text,
  state_name text,
  geom geography(MultiPolygon, 4326),
  geom_simplified geography(MultiPolygon, 4326)
);
create index if not exists phn_geom_idx on phn using gist (geom);
create index if not exists phn_geom_simplified_idx on phn using gist (geom_simplified);
-- Load: for each of the 31 features in the GeoJSON, insert phn_code
-- (PHN_CODE), phn_name (PHN_NAME), state_code (STE_CODE21), state_name
-- (STE_NAME21), and geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(<feature
-- geometry>), 4326)) -- ST_Multi because some features are Polygon rather
-- than MultiPolygon and the column is typed MultiPolygon. Then
-- geom_simplified = ST_Multi(ST_SimplifyPreserveTopology(geom::geometry,
-- 0.001))::geography.

alter table clinics add column if not exists phn_code text;
alter table clinics add column if not exists phn_name text;
alter table aged_care_providers add column if not exists phn_code text;
alter table aged_care_providers add column if not exists phn_name text;

-- Matched 19,617 of 19,653 clinics (99.8%) and 2,910 of 2,933 aged care rows
-- (all geocoded ones) -- spot-checked against known geography (e.g. Roma QLD
-- -> Western Queensland, Wauchope NSW -> North Coast, Boolaroo NSW -> Hunter
-- New England and Central Coast), all correct. Remaining misses are rows
-- with no coordinates, or sitting on a phn.geom_simplified boundary seam --
-- same class of edge case as the sa2/sa3 boundary misses above.
update clinics c set
  phn_code = p.phn_code,
  phn_name = p.phn_name
from phn p
where c.location is not null
  and c.phn_code is null
  and ST_Contains(p.geom_simplified::geometry, c.location::geometry);

update aged_care_providers c set
  phn_code = p.phn_code,
  phn_name = p.phn_name
from phn p
where c.location is not null
  and c.phn_code is null
  and ST_Contains(p.geom_simplified::geometry, c.location::geometry);

-- Same RLS gotcha as every other new table in this file -- phn had RLS
-- auto-enabled but no policy (confirmed live: zero rows via the anon key,
-- direct DB connection unaffected since RLS doesn't apply there), so
-- get_phn_geojson() below returned data to me but not to the client until
-- this was added.
create policy "public read" on phn for select using (true);

-- RPC the client fetches via supabase.rpc(...) for the "PHN" map lens (a
-- categorical fill layer, not a numeric score -- see ensurePHNLayer() in
-- app.js). Uses geom_simplified, not geom, same reasoning as avoiding
-- isochrone_geom in get_clinics() below -- no need to ship full-precision
-- coastline detail through to_jsonb/ST_AsGeoJSON for a fill layer that's
-- never zoomed in close enough to need it.
-- CREATE OR REPLACE FUNCTION public.get_phn_geojson()
--  RETURNS jsonb LANGUAGE sql STABLE
--  SET search_path TO 'public', 'extensions', 'pg_catalog'
--  SET statement_timeout TO '30s'
-- AS $function$
--   select jsonb_build_object(
--     'type', 'FeatureCollection',
--     'features', coalesce(jsonb_agg(
--       jsonb_build_object(
--         'type', 'Feature',
--         'geometry', ST_AsGeoJSON(geom_simplified)::jsonb,
--         'properties', jsonb_build_object(
--           'PHNCode', phn_code, 'PHNName', phn_name, 'State', state_code
--         )
--       )
--     ), '[]'::jsonb)
--   )
--   from phn;
-- $function$

-- This project auto-enables RLS on new tables (confirmed live: sa3/clinics
-- both already carry an identical "public read" policy this table didn't
-- get automatically) -- without this, get_aged_care_providers_geojson()
-- below silently returns zero rows to the anon key the client uses, since
-- a plain SECURITY INVOKER function is still subject to the caller's RLS.
create policy "public read" on aged_care_providers for select using (true);

-- RPC the client fetches via supabase.rpc(...), same convention as the
-- (pre-existing, not itself tracked in this file) get_sa3_geojson/
-- get_sa2_geojson functions -- applied directly in Supabase, documented
-- here for the same reason those aren't duplicated here either.
-- CREATE OR REPLACE FUNCTION public.get_aged_care_providers_geojson()
--  RETURNS jsonb LANGUAGE sql STABLE
--  SET search_path TO 'public', 'extensions', 'pg_catalog'
--  SET statement_timeout TO '30s'
-- AS $function$
--   select jsonb_build_object(
--     'type', 'FeatureCollection',
--     'features', coalesce(jsonb_agg(
--       jsonb_build_object(
--         'type', 'Feature',
--         'geometry', ST_AsGeoJSON(location)::jsonb,
--         'properties', jsonb_build_object(
--           'SiteId', site_id, 'EntityName', entity_name, 'BusinessName', business_name,
--           'HomeName', home_name, 'Street', street, 'Suburb', suburb, 'State', state,
--           'Postcode', postcode, 'FullAddress', full_address, 'SA3Code', sa3_code,
--           'SA3Name', sa3_name, 'GeocodeSource', geocode_source, 'GeocodeConfidence', geocode_confidence
--         )
--       )
--     ), '[]'::jsonb)
--   )
--   from aged_care_providers
--   where location is not null;
-- $function$

-- Merge aged_care_providers into clinics (market_id='aged_care') -- decided
-- against earlier in the same session ("hold off until it's an actual scored
-- market"), then explicitly requested anyway once the SA2/SA4 backfill above
-- made the row shapes close enough to be worth unifying. Still not a scored
-- market: no adjustment factors, no isochrones, no composite/tier config
-- (scored: false) -- just a plain reference layer living in the same table
-- as GP/Physio/Dental now, loaded the exact same way (toggleClinicLayer ->
-- loadMarketData -> normalizeClinicData). clinics.market_id has an FK to
-- markets(market_id), and config/canonical_fields are NOT NULL, so a
-- placeholder markets row is required -- clinic_fields specifically IS read
-- by normalizeClinicData() regardless of whether a market is scored (missing
-- it threw "Cannot convert undefined or null to object" the first time this
-- was wired up), so it still needs the same id/name/lat/lon/sa3 mapping
-- physio/dental use, just no format/billing/ownership keys since aged care
-- has none of those yet.
insert into markets (market_id, market_name, config, canonical_fields)
values ('aged_care', 'Aged Care Providers',
        '{"scored": false, "note": "reference layer only, no composite/tier scoring yet",
          "market_id": "aged_care", "market_name": "Aged Care Providers",
          "clinic_fields": {"id": "clinic_id", "name": "clinic_name", "latitude": "latitude",
                             "longitude": "longitude", "sa3_code": "sa3_code", "sa3_name": "sa3_name"}}'::jsonb,
        '{}'::jsonb)
on conflict (market_id) do nothing;

-- entity_name/business_name/abn/geocode_source/geocode_confidence have no
-- equivalent existing clinics column (added to the create table above too,
-- for a fresh install) -- null for every GP/Physio/Dental row, same pattern
-- as the existing gp-specific/physio-specific column groups.
alter table clinics add column if not exists entity_name text;
alter table clinics add column if not exists business_name text;
alter table clinics add column if not exists abn text;
alter table clinics add column if not exists geocode_source text;
alter table clinics add column if not exists geocode_confidence numeric;

-- state_code: aged_care_providers only ever stores the 8 real state/territory
-- full names (verified: no "Other Territories" values, unlike clinics, which
-- has that value mapping inconsistently to both WA and NSW) -- a plain,
-- unambiguous 8-entry map, not guessed.
-- corporate_chain/ownership/clinic_format/billing_type/gp_count and every
-- other GP/Physio-specific column stay null here -- no source data exists yet
-- to classify aged-care operators as chain/independent (see the "what columns
-- does it need to fill" discussion earlier), so leaving them null keeps that
-- gap honest instead of overloading entity_name into a field it doesn't mean.
insert into clinics (
  market_id, clinic_id, name, address, suburb, state_code, state_name, postcode,
  latitude, longitude, location,
  sa1_code, sa2_code, sa2_name, sa2_area_km2, sa3_code, sa3_name, sa4_code, sa4_name,
  entity_name, business_name, abn, geocode_source, geocode_confidence
)
select
  'aged_care', site_id, home_name, street, suburb,
  case state
    when 'Australian Capital Territory' then 'ACT'
    when 'New South Wales' then 'NSW'
    when 'Northern Territory' then 'NT'
    when 'Queensland' then 'QLD'
    when 'South Australia' then 'SA'
    when 'Tasmania' then 'TAS'
    when 'Victoria' then 'VIC'
    when 'Western Australia' then 'WA'
  end,
  state, postcode,
  latitude, longitude, location,
  null, sa2_code, sa2_name, sa2_area_km2, sa3_code, sa3_name, sa4_code, sa4_name,
  entity_name, business_name, abn, geocode_source, geocode_confidence
from aged_care_providers
on conflict (market_id, clinic_id) do nothing;
-- Result: 2,933 of 2,933 rows inserted. The standalone aged_care_providers
-- table (and get_aged_care_providers_geojson()) were initially left in place
-- rather than dropped, since app.js still read aged care via that table/RPC
-- at the time (ensureAgedCareLayer()/fetchAgedCareGeojson()). Both steps
-- have since happened: app.js was rewired onto clinics/get_clinics
-- ('aged_care') (see PR that follows this commit), and once that was
-- confirmed working end-to-end, this table + its RPC were dropped as a
-- deliberate architecture cleanup pass (alongside three unrelated dead views
-- -- see below) rather than left duplicating clinics indefinitely:
drop function if exists get_aged_care_providers_geojson();
drop table if exists aged_care_providers;

-- clinic_data_coverage / clinic_data_coverage_by_market / clinic_gp_count_reliability
-- -- three views (not tables, so no duplicated storage, just unused schema
-- surface) with zero references anywhere -- checked every function body in
-- pg_proc and grepped app.js before dropping, not assumed dead. Likely
-- predate renderArchetypeCoverageBars() computing the same field-coverage
-- concept live client-side from State.clinicsByVertical. CASCADE needed:
-- clinic_data_coverage_by_market depends on clinic_data_coverage (verified
-- via pg_depend that nothing else does, so the cascade's blast radius is
-- exactly these two).
drop view if exists clinic_data_coverage cascade;
drop view if exists clinic_gp_count_reliability;

-- meta schema -- separates internal/reference tables (not queried by the
-- app, no RLS policy, no PostgREST exposure since Supabase's default
-- "Exposed schemas" API setting only includes public/graphql_public) from
-- the public schema's app-facing tables (clinics, sa3, etc., all queried
-- live via supabase.rpc(...) with the anon key). Access-tier split, not a
-- per-market or per-domain one -- see the per-market-table discussion this
-- followed (kept clinics as one table + market_id, not split per vertical).
create schema if not exists meta;

-- dataset_registry -- a plain provenance log, not consumed by the app itself
-- (no RPC, no client fetch). One row per dataset: where it came from, which
-- table actually holds it, and any processing caveats -- a reference point
-- so "what source did this come from" doesn't live only in scattered hint
-- strings across CATALOGUE_CATEGORIES (app.js) or this session's memory.
-- Add a row here whenever a new dataset gets uploaded.
create table if not exists meta.dataset_registry (
  dataset_key     text primary key,
  display_name    text not null,
  supabase_table  text,
  source_name     text,
  source_url      text,
  vintage         text,
  notes           text,
  added_at        timestamptz default now()
);

insert into meta.dataset_registry (dataset_key, display_name, supabase_table, source_name, source_url, vintage, notes) values
  ('clinics_gp', 'General practice clinics', 'clinics (market_id=gp)', 'National Health Services Directory (NHSD)', null, 'Mar 2025', null),
  ('clinics_physio', 'Physiotherapy clinics', 'clinics (market_id=physio)', 'National Health Services Directory (NHSD)', null, 'Mar 2025', null),
  ('clinics_dental', 'Dental clinics', 'clinics (market_id=dental)', 'National Health Services Directory (NHSD)', null, 'Mar 2025', 'Market slot exists but not yet populated (0 rows as of Sep 2026)'),
  ('sa3_geography_population', 'SA3 boundaries + estimated resident population', 'sa3', 'ABS ASGS boundaries + ABS ERP', null, 'Jun 2024', 'Table was originally named sa3_scored'),
  ('seifa', 'SEIFA IRSAD decile', 'sa2', 'ABS Census', null, '2021 Census', 'Table was originally named sa2_seifa'),
  ('workforce_dpa', 'Workforce risk & DPA flags', 'sa3 (dpa_bonded, dpa_gp_img, workforce_risk_score columns)', 'DoctorConnect', null, null, 'DPA = Distribution Priority Area status; workforce_risk_score is a Foundry-derived composite'),
  ('ownership_chain_classification', 'Ownership mix & chain penetration (corporate vs independent)', 'clinics (ownership, corporate_chain columns)', 'Foundry classification', null, 'Mar 2025', null),
  ('gp_billings', 'Bulk-billing rate, non-referred attendances', 'gp_billing_sa3_ltm', 'Services Australia (Medicare)', null, 'Dec 2024', null),
  ('aged_care_providers', 'Aged-care provider locations (residential care homes)', 'clinics (market_id=aged_care)', 'Aged Care Quality and Safety Commission (ACQSC)', null, 'Sep 2026', 'Geocoded via G-NAF (primary) + Mapbox fallback for G-NAF misses, medium-confidence or better only; 2,910 of 2,933 registered homes geocoded -- merged into clinics 2026-09-29 (2,933 of 2,933 rows), plus sa2/sa4 geography backfill (sa2/sa4: 2,902 of 2,933; sa3: 2,910 of 2,933) -- app.js rewired 2026-09-29 to load it via clinics/get_clinics(''aged_care'') same as GP/Physio/Dental (Step 1 + Data Catalogue both use the standard layerToggle mechanism now) -- standalone aged_care_providers table + get_aged_care_providers_geojson() RPC dropped 2026-09-29 once the rewire was confirmed working end-to-end (fully superseded by clinics, no remaining app.js references)'),
  ('hospital_ed_data', 'Public hospital ED presentations, timeliness and location', 'hospitals + hospital_ed_presentations + hospital_ed_seen_on_time + hospital_ed_timeliness', 'Australian Institute of Health and Welfare (AIHW) MyHospitals', null, 'Data as of 19 Aug 2026, version 2026081901', 'See the hospitals/hospital_ed_* section further down for the full geocoding provenance and data-quality-code notes -- not repeated here.')
on conflict (dataset_key) do nothing;

-- hospitals + hospital_ed_presentations/seen_on_time/timeliness -- built to
-- support an "opportunity hospital" analysis (high low-urgency ED volume +
-- high overflow/overcrowding = demand a GP-type provider could capture).
-- Source: AIHW MyHospitals "Emergency department" extract, 4 sheets sharing
-- a hospital+year grain (Presentations / Patients seen on time / Time in ED
-- - within 4 hrs / Time in ED), 311 distinct hospitals, 2011-12 to 2024-25.
--
-- Geocoding (the hard part -- the AIHW extract has no address, only a
-- hospital name + state): matched against NHSD (same facility directory
-- already used for GP/Physio clinics) first -- 216 of 311 matched safely,
-- using an exact/near-exact token-set comparison, NOT raw fuzzy string
-- similarity (that produced real false positives during development, e.g.
-- "Armidale Hospital" -> "Camden Hospital" on shared-length/shared-word
-- coincidence -- rejected). A conflict-word list (private/hospice/etc, must
-- appear on both sides or neither) caught two more subtle false positives:
-- "Maitland Hospital" -> "Maitland Private Hospital" and "Albany Hospital"
-- -> "Albany Hospice" (different facilities sharing a town name). Remaining
-- 95 were searched individually via Google Maps (name + state), address
-- text read from the result card; 94 resolved (one, Manly Hospital, closed
-- 2015 with no address recoverable anywhere -- left blank). Some major
-- public hospitals (Liverpool, John Hunter, Prince of Wales, Westmead,
-- Frankston, Bunbury, Broome, Royal Darwin...) turned out to exist in the
-- NHSD extract only as mistagged sub-department records (pharmacy, a named
-- clinic) under the wrong NHSD_SERVICE_TYPE, not as their own Hospital/ED
-- entry -- a real gap in that specific extract, confirmed by direct search
-- before falling back to Google Maps for those too.
--
-- Those 94 addresses were then geocoded via Mapbox (structured address
-- type, not the unreliable facility-name POI search used earlier in this
-- project's aged-care pipeline) -- 5 came back low-confidence because the
-- address has no street number (hospitals often occupy a whole block, e.g.
-- "Reserve Rd, St Leonards" for Royal North Shore), so those 5 were instead
-- read directly off Google's own resolved place-link coordinates (the same
-- precise !3d/!4d values embedded in its search-result hrefs).
--
-- 5 hospitals were left with no coordinates at all rather than guessed:
-- Manly Hospital (closed, unrecoverable), and 4 cases where today's
-- successor facility sits at a genuinely different physical site than the
-- one AIHW's older rows refer to -- Byron Bay Hospital (-> Byron Central
-- Hospital, different town, opened ~2022), Mater Children's Hospital and
-- Royal Children's Hospital [Queensland] (both likely predecessors folded
-- into Queensland Children's Hospital when it opened in 2014), and Princess
-- Margaret Hospital for Children (closed 2018, replaced by Perth Children's
-- Hospital at a new site). Using the successor's current address for these
-- would silently misplace every pre-transition year's data.
create table if not exists hospitals (
  hospital_name text primary key,  -- the AIHW "Reporting unit" name -- the join key hospital_ed_* uses
  matched_name text,               -- the real-world facility name (NHSD or Google Maps), for display
  state text,
  address text,
  suburb text,
  latitude numeric,
  longitude numeric,
  location geography(Point, 4326),
  source text,                     -- 'nhsd' | 'google_maps' | 'google_maps+mapbox' | null (unresolved)
  sa3_code text,
  sa3_name text,
  phn_code text,
  phn_name text,
  notes text                       -- populated for the 5 no-coordinate rows and other caveats above
);
create index if not exists hospitals_location_idx on hospitals using gist (location);

update hospitals set location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
where latitude is not null and longitude is not null and location is null;

-- Same ST_Contains point-in-polygon pattern used throughout this file --
-- 100% match on all 306 geocoded rows for both sa3 and phn (no boundary-seam
-- misses this time, unlike the aged_care_providers backfill).
update hospitals h set sa3_code = s.sa3_code, sa3_name = s.sa3_name
from sa3 s where h.location is not null and h.sa3_code is null
  and ST_Contains(s.geom::geometry, h.location::geometry);

update hospitals h set phn_code = p.phn_code, phn_name = p.phn_name
from phn p where h.location is not null and h.phn_code is null
  and ST_Contains(p.geom_simplified::geometry, h.location::geometry);

-- Three fact tables, one per AIHW measure, all keyed on (hospital_name,
-- year, ...) -- NOT folded into clinics like aged_care_providers was, since
-- this data is fundamentally a time series (one row per hospital PER YEAR
-- per category), not a snapshot entity clinics' one-row-per-facility shape
-- fits. hospital_ed_seen_on_time kept separate from hospital_ed_presentations
-- despite the similar (hospital, year, triage_category) grain because the
-- two sheets count different things -- "Presentations" includes every visit
-- type, "seen on time" explicitly excludes non-emergency-presentation
-- visits, so merging them would silently conflate two different
-- denominators. hospital_ed_timeliness merges the "within 4 hrs" and "time
-- in ED" sheets, which share the same (hospital, year, patient_cohort)
-- grain and are genuinely the same underlying fact, just split into two
-- CSV exports by MyHospitals.
--
-- data_quality: AIHW privacy-suppresses small counts as "<5" -- presentations
-- set to 5 (data_quality='suppressed_lt5') per explicit instruction, rather
-- than left null or a fabricated-precise midpoint. "NP"/"NP†" (could not
-- be calculated) and "-" (nothing reported) are left null with their own
-- reason codes ('not_calculable' / 'not_reported') -- genuinely different
-- meanings from a suppressed-but-real count, not collapsed into one flag.
create table if not exists hospital_ed_presentations (
  hospital_name text references hospitals(hospital_name),
  year text,
  triage_category text,
  presentations int,
  data_quality text,
  primary key (hospital_name, year, triage_category)
);
create index if not exists hospital_ed_presentations_hospital_idx on hospital_ed_presentations (hospital_name);

create table if not exists hospital_ed_seen_on_time (
  hospital_name text references hospitals(hospital_name),
  year text,
  triage_category text,
  peer_group text,
  presentations int,
  pct_seen_on_time numeric,
  peer_group_avg numeric,
  data_quality text,
  primary key (hospital_name, year, triage_category)
);
create index if not exists hospital_ed_seen_on_time_hospital_idx on hospital_ed_seen_on_time (hospital_name);

-- median_minutes/p90_minutes parsed from AIHW's own display strings (e.g.
-- "1 hrs 58 mins") into plain integer minutes for actual computation --
-- median_display/p90_display kept alongside for exact-original-text display.
create table if not exists hospital_ed_timeliness (
  hospital_name text references hospitals(hospital_name),
  year text,
  patient_cohort text,
  peer_group text,
  presentations int,
  pct_within_4hrs numeric,
  pct_within_4hrs_peer_avg numeric,
  median_minutes int,
  median_display text,
  p90_minutes int,
  p90_display text,
  p90_peer_avg_minutes int,
  data_quality text,
  primary key (hospital_name, year, patient_cohort)
);
create index if not exists hospital_ed_timeliness_hospital_idx on hospital_ed_timeliness (hospital_name);

-- Same RLS-auto-enabled-with-no-policy gotcha every new table in this project
-- has hit -- confirmed live, added before it silently broke the anon key.
create policy "public read" on hospitals for select using (true);
create policy "public read" on hospital_ed_presentations for select using (true);
create policy "public read" on hospital_ed_seen_on_time for select using (true);
create policy "public read" on hospital_ed_timeliness for select using (true);

-- RPC for the map layer -- same convention as get_aged_care_providers_geojson
-- was, get_phn_geojson, etc. The three hospital_ed_* fact tables are read
-- directly via PostgREST (no RPC needed -- verified live: a plain
-- ?hospital_name=eq....&order=year.desc query against the anon key works),
-- since they're already flat/filterable and don't need geometry conversion.
-- CREATE OR REPLACE FUNCTION public.get_hospitals_geojson()
--  RETURNS jsonb LANGUAGE sql STABLE
--  SET search_path TO 'public', 'extensions', 'pg_catalog'
--  SET statement_timeout TO '30s'
-- AS $function$
--   select jsonb_build_object(
--     'type', 'FeatureCollection',
--     'features', coalesce(jsonb_agg(
--       jsonb_build_object(
--         'type', 'Feature',
--         'geometry', ST_AsGeoJSON(location)::jsonb,
--         'properties', jsonb_build_object(
--           'HospitalName', hospital_name, 'MatchedName', matched_name, 'State', state,
--           'Address', address, 'Suburb', suburb, 'SA3Code', sa3_code, 'SA3Name', sa3_name,
--           'PHNCode', phn_code, 'PHNName', phn_name, 'Source', source
--         )
--       )
--     ), '[]'::jsonb)
--   )
--   from hospitals
--   where location is not null;
-- $function$
