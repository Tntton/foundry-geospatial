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
