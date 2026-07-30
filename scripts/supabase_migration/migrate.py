#!/usr/bin/env python3
"""
Migrate gp-clinic-map's live-app data (data/markets/*, data/shared/*) into the
new Supabase Postgres/PostGIS project. See:
  /Users/joshting/.claude/plans/starry-dancing-planet.md

Usage:
  python3 migrate.py schema              # create extension + tables
  python3 migrate.py markets             # markets table
  python3 migrate.py clinics             # clinics table (gp, physio; dental has no csv yet)
  python3 migrate.py isochrones          # clinics.isochrone_* columns (gp, physio) - folded
                                          # into clinics, not a separate table
  python3 migrate.py geo                 # sa3 (scores), sa2
  python3 migrate.py demographics        # sa3 (demographics, merged), sa1
  python3 migrate.py mmm                 # mmm_benchmark
  python3 migrate.py all                 # everything, in dependency order
  python3 migrate.py verify              # row-count verification against source files
"""
import glob
import json
import math
import os
import re
import sys

import pandas as pd
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(dotenv_path=os.path.join(REPO_ROOT, ".env"))

DB_URL = os.environ["SUPABASE_DB_URL"]
MARKETS = ["gp", "physio", "dental"]

CANONICAL_TO_CLINICS_COL = {
    "name": "name",
    "ownership": "ownership",
    "format": "clinic_format",
    "billing": "billing_type",
    "gp_count": "gp_count",
    "sa3_code": "sa3_code",
    "sa3_name": "sa3_name",
    "suburb": "suburb",
    "state_code": "state_code",
    "address": "address",
    "postcode": "postcode",
    "website": "website",
}

ALIAS_MAP = {
    "corporate_chain": ["Corporate Chain", "corporate_chain"],
    "phone": ["Phone", "phone"],
    "google_review_count": ["google_review_count"],
    "google_rating": ["google_rating"],
    "sa1_code": ["sa1_code"],
    "sa2_code": ["sa2_code"],
    "sa2_name": ["sa2_name"],
    "sa4_code": ["sa4_code"],
    "sa4_name": ["sa4_name"],
}

GP_EXTRA_MAP = {
    "Pathology": ("pathology", "bool"),
    "Radiology/Imaging": ("radiology_imaging", "bool"),
    "Allied Health": ("allied_health", "bool"),
    "Doctor Names Clean": ("doctor_names", "text"),
    "sa2_area_km2": ("sa2_area_km2", "float"),
    "gccsa_code": ("gccsa_code", "text"),
    "gccsa_name": ("gccsa_name", "text"),
    "state_name": ("state_name", "text"),
    "nhsd_service_id": ("nhsd_service_id", "text"),
    "nhsd_service_type": ("nhsd_service_type", "text"),
    "gnaf_address_id": ("gnaf_address_id", "text"),
    "geographic_area_class": ("geographic_area_class", "text"),
    "geographic_source_date": ("geographic_source_date", "text"),
    "Format_Confidence": ("format_confidence", "text"),
}

PHYSIO_EXTRA_MAP = {
    "Address1": ("address1", "text"),
    "Email": ("email", "text"),
    "NDIS": ("ndis", "bool"),
    "Telehealth": ("telehealth", "bool"),
    "rank": ("rank", "int"),
    "segments": ("segments", "list"),
    "primary_segment": ("primary_segment", "text"),
    "confidence": ("confidence", "text"),
}

# the 15 per-segment booleans are dropped: 100% derivable from `segments` (verified: 0
# mismatches across every physio row), so they're intentionally ignored source columns
# rather than mapped anywhere - not a gap in coverage.
IGNORED_COLUMNS_BY_MARKET = {
    "gp": set(),
    "physio": {
        "Women's Health / Pelvic Health", "Hand & Upper Limb", "Paediatrics",
        "Neurological Rehabilitation", "Oncology / Lymphoedema",
        "Respiratory / Cardiopulmonary", "Sports & Performance",
        "Musculoskeletal / Orthopaedic", "Pilates / Wellness",
        "Aged Care / Falls Prevention", "Hydrotherapy / Aquatic",
        "DVA / Veterans Health", "Occupational / Workplace Injury",
        "Rural / Mobile / Outreach", "General Physio",
    },
    "dental": set(),
}

EXTRA_MAP_BY_MARKET = {"gp": GP_EXTRA_MAP, "physio": PHYSIO_EXTRA_MAP, "dental": {}}

# every clinics-table column that build_clinic_row can populate (used to build the
# insert statement/template programmatically instead of by hand)
FLATTENED_EXTRA_COLUMNS = sorted(
    {col for m in EXTRA_MAP_BY_MARKET.values() for col, _ in m.values()}
)

CLINICS_BASE_COLUMNS = [
    "market_id", "clinic_id", "name", "address", "suburb", "state_code", "postcode",
    "website", "phone", "latitude", "longitude", "ownership", "clinic_format",
    "billing_type", "corporate_chain", "gp_count", "google_review_count", "google_rating",
    "sa1_code", "sa2_code", "sa2_name", "sa3_code", "sa3_name", "sa4_code", "sa4_name",
]

CLINICS_ALL_COLUMNS = CLINICS_BASE_COLUMNS + FLATTENED_EXTRA_COLUMNS


def get_conn():
    return psycopg2.connect(DB_URL)


def clean_str(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    s = str(v).strip()
    if s == "" or s.lower() == "nan":
        return None
    if s.endswith(".0") and s[:-2].lstrip("-").isdigit():
        s = s[:-2]
    return s


def clean_int(v):
    s = clean_str(v)
    if s is None:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def clean_float(v):
    s = clean_str(v)
    if s is None:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def clean_bool(v):
    s = clean_str(v)
    if s is None:
        return None
    s = s.strip().lower()
    if s in ("1", "yes", "true", "y"):
        return True
    if s in ("0", "no", "false", "n"):
        return False
    return None


def _strip_currency_pct(v):
    s = clean_str(v)
    if s is None:
        return None
    return s.replace("$", "").replace("%", "").replace(",", "").strip()


def clean_money_float(v):
    s = _strip_currency_pct(v)
    return clean_float(s) if s is not None else None


def clean_money_int(v):
    s = _strip_currency_pct(v)
    return clean_int(s) if s is not None else None


def clean_str_list(v, sep=", "):
    s = clean_str(v)
    if s is None:
        return None
    return [item.strip() for item in s.split(sep) if item.strip()]


def run_schema():
    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
    with open(schema_path) as f:
        sql = f.read()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print("schema applied OK")
    finally:
        conn.close()


def load_markets():
    with open(os.path.join(REPO_ROOT, "data", "market-schema.json")) as f:
        market_schema = json.load(f)["markets"]

    rows = []
    for market_id in MARKETS:
        config_path = os.path.join(REPO_ROOT, "data", "markets", market_id, "market_config.json")
        with open(config_path) as f:
            config = json.load(f)
        canonical_fields = market_schema[market_id]["canonical_fields"]
        rows.append(
            {
                "market_id": market_id,
                "market_name": config.get("market_name"),
                "config": json.dumps(config),
                "canonical_fields": json.dumps(canonical_fields),
            }
        )

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """
                insert into markets (market_id, market_name, config, canonical_fields)
                values %s
                on conflict (market_id) do update set
                  market_name = excluded.market_name,
                  config = excluded.config,
                  canonical_fields = excluded.canonical_fields
                """,
                rows,
                template="(%(market_id)s, %(market_name)s, %(config)s::jsonb, %(canonical_fields)s::jsonb)",
            )
        conn.commit()
        print(f"markets: upserted {len(rows)} rows")
    finally:
        conn.close()


def get_canonical_fields():
    with open(os.path.join(REPO_ROOT, "data", "market-schema.json")) as f:
        return json.load(f)["markets"]


CLINIC_CSV_PATHS = {
    "gp": os.path.join(REPO_ROOT, "data", "markets", "gp", "gp_clinics.csv"),
    "physio": os.path.join(REPO_ROOT, "data", "markets", "physio", "physio_clinics.csv"),
    "dental": os.path.join(REPO_ROOT, "data", "markets", "dental", "dental_clinics.csv"),
}


def build_clinic_row(market_id, row, canonical_fields):
    consumed = set()

    id_col = canonical_fields["id"]
    clinic_id = clean_str(row.get(id_col))
    consumed.add(id_col)

    lat_col = canonical_fields["latitude"]
    lon_col = canonical_fields["longitude"]
    lat = clean_float(row.get(lat_col))
    lon = clean_float(row.get(lon_col))
    consumed.update([lat_col, lon_col])

    out = {c: None for c in CLINICS_ALL_COLUMNS}
    out["market_id"] = market_id
    out["clinic_id"] = clinic_id
    out["latitude"] = lat
    out["longitude"] = lon

    for canon_key, table_col in CANONICAL_TO_CLINICS_COL.items():
        src_col = canonical_fields.get(canon_key)
        if src_col and src_col in row.index and src_col not in consumed:
            val = row[src_col]
            consumed.add(src_col)
            out[table_col] = clean_int(val) if table_col == "gp_count" else clean_str(val)

    for table_col, aliases in ALIAS_MAP.items():
        for alias in aliases:
            if alias in row.index and alias not in consumed and row[alias] is not None:
                val = row[alias]
                consumed.add(alias)
                if table_col == "google_review_count":
                    out[table_col] = clean_int(val)
                elif table_col == "google_rating":
                    out[table_col] = clean_float(val)
                else:
                    out[table_col] = clean_str(val)
                break

    extra_map = EXTRA_MAP_BY_MARKET.get(market_id, {})
    for src_col, (table_col, kind) in extra_map.items():
        if src_col in row.index and src_col not in consumed:
            val = row[src_col]
            consumed.add(src_col)
            if kind == "bool":
                out[table_col] = clean_bool(val)
            elif kind == "int":
                out[table_col] = clean_int(val)
            elif kind == "float":
                out[table_col] = clean_float(val)
            elif kind == "list":
                out[table_col] = clean_str_list(val)
            else:
                out[table_col] = clean_str(val)

    consumed.update(IGNORED_COLUMNS_BY_MARKET.get(market_id, set()))

    leftover = [col for col in row.index if col not in consumed]
    if leftover:
        raise ValueError(f"market={market_id}: unmapped columns {leftover} - add to CANONICAL_TO_CLINICS_COL/ALIAS_MAP/EXTRA_MAP_BY_MARKET")

    return out


# (column_name, value_expression) pairs used for both the INSERT column list and
# the VALUES template - built once so the two can never drift out of sync.
_CLINIC_COL_EXPRS = (
    [(c, f"%({c})s") for c in CLINICS_BASE_COLUMNS]
    + [(
        "location",
        "case when %(longitude)s is not null and %(latitude)s is not null "
        "then ST_SetSRID(ST_MakePoint(%(longitude)s, %(latitude)s), 4326)::geography else null end",
    )]
    + [(c, f"%({c})s") for c in FLATTENED_EXTRA_COLUMNS]
)


def load_clinics_for_market(market_id, market_schema):
    csv_path = CLINIC_CSV_PATHS[market_id]
    if not os.path.exists(csv_path):
        print(f"clinics[{market_id}]: no csv at {csv_path}, skipping")
        return 0

    df = pd.read_csv(csv_path)
    canonical_fields = market_schema[market_id]["canonical_fields"]
    rows = [build_clinic_row(market_id, row, canonical_fields) for _, row in df.iterrows()]

    col_names = [c for c, _ in _CLINIC_COL_EXPRS]
    update_clause = ", ".join(f"{c} = excluded.{c}" for c in col_names if c not in ("market_id", "clinic_id"))
    insert_sql = f"""
        insert into clinics ({', '.join(col_names)})
        values %s
        on conflict (market_id, clinic_id) do update set {update_clause}
    """
    template = "(" + ", ".join(expr for _, expr in _CLINIC_COL_EXPRS) + ")"

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for i in range(0, len(rows), 500):
                batch = rows[i : i + 500]
                psycopg2.extras.execute_values(cur, insert_sql, batch, template=template)
                conn.commit()
        print(f"clinics[{market_id}]: upserted {len(rows)} rows")
        return len(rows)
    finally:
        conn.close()


def load_clinics():
    market_schema = get_canonical_fields()
    total = 0
    for market_id in MARKETS:
        total += load_clinics_for_market(market_id, market_schema)
    return total


ISOCHRONE_RE = re.compile(r"isochrone_(.+)\.geojson$")


def load_isochrones_for_market(market_id):
    # isochrones are folded into clinics.isochrone_* columns (strictly 1:1 with clinics
    # today - see plan Phase 2). This UPDATEs existing clinic rows rather than inserting
    # into a separate table.
    iso_dir = os.path.join(REPO_ROOT, "data", "markets", market_id, "isochrones")
    files = sorted(glob.glob(os.path.join(iso_dir, "isochrone_*.geojson")))
    if not files:
        print(f"isochrones[{market_id}]: no files, skipping")
        return 0

    update_sql = """
        update clinics set
          isochrone_geom = data.geom,
          isochrone_contour_minutes = data.contour_minutes,
          isochrone_color = data.color,
          isochrone_opacity = data.opacity,
          isochrone_metric = data.metric
        from (values %s) as data(market_id, clinic_id, contour_minutes, geom, color, opacity, metric)
        where clinics.market_id = data.market_id and clinics.clinic_id = data.clinic_id
    """
    template = (
        "(%(market_id)s, %(clinic_id)s, %(contour_minutes)s, "
        "ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326))::geography, "
        "%(color)s, %(opacity)s, %(metric)s)"
    )

    conn = get_conn()
    loaded = 0
    skipped = 0
    try:
        with conn.cursor() as cur:
            batch = []
            for fp in files:
                m = ISOCHRONE_RE.search(os.path.basename(fp))
                if not m:
                    skipped += 1
                    continue
                clinic_id = m.group(1)
                with open(fp) as f:
                    doc = json.load(f)
                for feat in doc.get("features", []):
                    props = feat.get("properties", {}) or {}
                    batch.append(
                        {
                            "market_id": market_id,
                            "clinic_id": clinic_id,
                            "contour_minutes": clean_int(props.get("contour")),
                            "geom": json.dumps(feat["geometry"]),
                            "color": clean_str(props.get("color") or props.get("fillColor") or props.get("fill")),
                            "opacity": clean_float(
                                props.get("opacity") or props.get("fillOpacity") or props.get("fill-opacity")
                            ),
                            "metric": clean_str(props.get("metric")),
                        }
                    )
                if len(batch) >= 500:
                    psycopg2.extras.execute_values(cur, update_sql, batch, template=template)
                    conn.commit()
                    loaded += len(batch)
                    print(f"isochrones[{market_id}]: {loaded} loaded...", end="\r")
                    batch = []
            if batch:
                psycopg2.extras.execute_values(cur, update_sql, batch, template=template)
                conn.commit()
                loaded += len(batch)
        print(f"\nisochrones[{market_id}]: updated {loaded} clinic rows (skipped {skipped} unmatched files)")
        return loaded
    finally:
        conn.close()


def load_isochrones():
    total = 0
    for market_id in ["gp", "physio", "dental"]:
        total += load_isochrones_for_market(market_id)
    return total


# source property key -> (clinics/sa3_scored column, cleaner)
SA3_SCORED_PROP_MAP = {
    "State": ("state", clean_str),
    "Demand_Score": ("demand_score", clean_float),
    "Supply_Score": ("supply_score", clean_float),
    "Competition_Score": ("competition_score", clean_float),
    "Economics_Score": ("economics_score", clean_float),
    "Composite_Score": ("composite_score", clean_float),
    "Tier": ("tier", clean_int),
    "MMM_Dominant": ("mmm_dominant", clean_int),
    "Corporate_Share": ("corporate_share", clean_float),
    "Whitespace_Score": ("whitespace_score", clean_int),
    "MMM_GPFTE_per_10k": ("mmm_gpfte_per_10k", clean_float),
    "MMM_Pct_GP_55plus": ("mmm_pct_gp_55plus", clean_float),
    "DPA_Bonded": ("dpa_bonded", clean_bool),
    "DPA_GP_IMG": ("dpa_gp_img", clean_bool),
    "Workforce_Risk_Score": ("workforce_risk_score", clean_int),
    "NRA_Services_Count": ("nra_services_count", clean_int),
    "NRA_Total_Fees": ("nra_total_fees", clean_float),
    "NRA_Fees_Per_Service": ("nra_fees_per_service", clean_float),
    "NRA_BB_Rate": ("nra_bb_rate", clean_float),
    "NRA_Out_of_Pocket": ("nra_out_of_pocket", clean_float),
    "NRA_Fee_Charged_CAGR": ("nra_fee_charged_cagr", clean_float),
    "NRA_BB_Rate_CAGR": ("nra_bb_rate_cagr", clean_float),
    "NRA_Score_Fees_Per_Service": ("nra_score_fees_per_service", clean_int),
    "NRA_Score_Total_Fees": ("nra_score_total_fees", clean_int),
    "NRA_Score_Fee_CAGR": ("nra_score_fee_cagr", clean_int),
    "NRA_Score_BB_CAGR": ("nra_score_bb_cagr", clean_int),
    "UCC_Present": ("ucc_present", clean_bool),
}

SA3_SCORED_COLUMNS = ["sa3_code", "sa3_name"] + [col for col, _ in SA3_SCORED_PROP_MAP.values()]


def load_sa3_scored():
    path = os.path.join(REPO_ROOT, "data", "shared", "geographic", "processed", "sa3_scored.geojson")
    with open(path) as f:
        doc = json.load(f)

    col_exprs = (
        [("sa3_code", "%(sa3_code)s"), ("sa3_name", "%(sa3_name)s")]
        + [(col, f"%({col})s") for col, _ in SA3_SCORED_PROP_MAP.values()]
        + [("geom", "ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326))::geography")]
    )
    col_names = [c for c, _ in col_exprs]
    update_clause = ", ".join(f"{c} = excluded.{c}" for c in col_names if c != "sa3_code")
    insert_sql = f"""
        insert into sa3 ({', '.join(col_names)})
        values %s
        on conflict (sa3_code) do update set {update_clause}
    """
    template = "(" + ", ".join(expr for _, expr in col_exprs) + ")"

    rows = []
    for feat in doc["features"]:
        props = feat.get("properties", {}) or {}
        row = {
            "sa3_code": clean_str(props.get("SA3Code")),
            "sa3_name": clean_str(props.get("SA3Name")),
            "geom": json.dumps(feat["geometry"]),
        }
        for prop_key, (col, cleaner) in SA3_SCORED_PROP_MAP.items():
            row[col] = cleaner(props.get(prop_key))
        rows.append(row)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, insert_sql, rows, template=template)
        conn.commit()
        print(f"sa3 (scores): upserted {len(rows)} rows")
        return len(rows)
    finally:
        conn.close()


SA2_SEIFA_PROP_MAP = {
    "SA2Name": ("sa2_name", clean_str),
    "State": ("state", clean_str),
    "SA3Code": ("sa3_code", clean_str),
    "IRSAD_Score": ("irsad_score", clean_int),
    "IRSAD_Decile": ("irsad_decile", clean_int),
    "Population": ("population", clean_int),
}


def load_sa2_seifa():
    path = os.path.join(REPO_ROOT, "data", "shared", "geographic", "stratification", "seifa", "sa2_seifa.geojson")
    with open(path) as f:
        doc = json.load(f)

    col_exprs = (
        [("sa2_code", "%(sa2_code)s")]
        + [(col, f"%({col})s") for col, _ in SA2_SEIFA_PROP_MAP.values()]
        + [("geom", "ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326))::geography")]
    )
    col_names = [c for c, _ in col_exprs]
    update_clause = ", ".join(f"{c} = excluded.{c}" for c in col_names if c != "sa2_code")
    insert_sql = f"""
        insert into sa2 ({', '.join(col_names)})
        values %s
        on conflict (sa2_code) do update set {update_clause}
    """
    template = "(" + ", ".join(expr for _, expr in col_exprs) + ")"

    rows = []
    for feat in doc["features"]:
        props = feat.get("properties", {}) or {}
        row = {
            "sa2_code": clean_str(props.get("SA2Code")),
            "geom": json.dumps(feat["geometry"]),
        }
        for prop_key, (col, cleaner) in SA2_SEIFA_PROP_MAP.items():
            row[col] = cleaner(props.get(prop_key))
        rows.append(row)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, insert_sql, rows, template=template)
        conn.commit()
        print(f"sa2: upserted {len(rows)} rows")
        return len(rows)
    finally:
        conn.close()


def load_geo():
    load_sa3_scored()
    load_sa2_seifa()


def load_demographics_sa3():
    path = os.path.join(REPO_ROOT, "data", "shared", "demographics", "population_sa3.csv")
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]

    # upserts into sa3 (folded from the old demographics_sa3 table) - only touches these
    # demographic columns, so it doesn't clobber the score columns load_sa3_scored sets,
    # and it's what inserts the 4 territory-only SA3 rows that have no scoring data.
    # clinic_count/clinics_per_10k/corporate_pct/independent_pct/nonprofit_pct are NOT
    # loaded here - they were GP-specific and already stale; compute live from `clinics`.
    insert_sql = """
        insert into sa3 (
            sa3_code, sa3_name, state, population_y25, pop_growth, pop_65plus_pct,
            median_household_income, mmm_classification
        )
        values %s
        on conflict (sa3_code) do update set
          sa3_name = excluded.sa3_name, state = excluded.state,
          population_y25 = excluded.population_y25, pop_growth = excluded.pop_growth,
          pop_65plus_pct = excluded.pop_65plus_pct,
          median_household_income = excluded.median_household_income,
          mmm_classification = excluded.mmm_classification
    """
    rows = []
    for _, row in df.iterrows():
        rows.append(
            {
                "sa3_code": clean_str(row["SA3 Code"]),
                "sa3_name": clean_str(row["SA3 Name"]),
                "state": clean_str(row["State"]),
                "population_y25": clean_int(row["D_Population_Y25"]),
                "pop_growth": clean_money_float(row["D_PopGrowth"]),
                "pop_65plus_pct": clean_money_float(row["D_Pop%65"]),
                "median_household_income": clean_money_float(row["E_Median_Household_Income"]),
                "mmm_classification": clean_int(row["E_MMM_Classification"]),
            }
        )

    template = (
        "(%(sa3_code)s, %(sa3_name)s, %(state)s, %(population_y25)s, %(pop_growth)s, "
        "%(pop_65plus_pct)s, %(median_household_income)s, %(mmm_classification)s)"
    )

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, insert_sql, rows, template=template)
        conn.commit()
        print(f"sa3 (demographics): upserted {len(rows)} rows")
        return len(rows)
    finally:
        conn.close()


def load_demographics_sa1():
    path = os.path.join(REPO_ROOT, "data", "shared", "demographics", "population_sa1.csv")
    df = pd.read_csv(path)

    insert_sql = """
        insert into sa1 (sa1_code, sa2_code, sa3_code, latitude, longitude, location, population)
        values %s
        on conflict (sa1_code) do update set
          sa2_code = excluded.sa2_code, sa3_code = excluded.sa3_code,
          latitude = excluded.latitude, longitude = excluded.longitude,
          location = excluded.location, population = excluded.population
    """
    template = (
        "(%(sa1_code)s, %(sa2_code)s, %(sa3_code)s, %(lat)s, %(lon)s, "
        "case when %(lon)s is not null and %(lat)s is not null "
        "then ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography else null end, "
        "%(population)s)"
    )

    rows = []
    for _, row in df.iterrows():
        sa1_code = clean_str(row["sa1_code"])
        rows.append(
            {
                "sa1_code": sa1_code,
                # ASGS 2021 codes are hierarchical: SA1's first 9/5 digits are its
                # parent SA2/SA3 code (verified 100% match rate against sa2/sa3 tables)
                "sa2_code": sa1_code[:9] if sa1_code else None,
                "sa3_code": sa1_code[:5] if sa1_code else None,
                "lon": clean_float(row["lon"]),
                "lat": clean_float(row["lat"]),
                "population": clean_int(row["population"]),
            }
        )

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for i in range(0, len(rows), 1000):
                batch = rows[i : i + 1000]
                psycopg2.extras.execute_values(cur, insert_sql, batch, template=template)
                conn.commit()
        print(f"sa1: upserted {len(rows)} rows")
        return len(rows)
    finally:
        conn.close()


def load_demographics():
    load_demographics_sa3()
    load_demographics_sa1()


def load_mmm():
    path = os.path.join(REPO_ROOT, "data", "shared", "geographic", "stratification", "mmm", "mmm_benchmark.json")
    with open(path) as f:
        doc = json.load(f)

    rows = [
        {
            "mmm_classification": int(k),
            "gpfte_per_10k": v.get("gpfte_per_10k"),
            "pct_55plus": v.get("pct_55plus"),
        }
        for k, v in doc.items()
    ]

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """
                insert into mmm_benchmark (mmm_classification, gpfte_per_10k, pct_55plus)
                values %s
                on conflict (mmm_classification) do update set
                  gpfte_per_10k = excluded.gpfte_per_10k, pct_55plus = excluded.pct_55plus
                """,
                rows,
                template="(%(mmm_classification)s, %(gpfte_per_10k)s, %(pct_55plus)s)",
            )
        conn.commit()
        print(f"mmm_benchmark: upserted {len(rows)} rows")
        return len(rows)
    finally:
        conn.close()


GP_BILLING_SA3_LTM_COL_MAP = {
    "State": ("state", clean_str),
    "SA3": ("sa3_name", clean_str),
    "Quarter": ("period", clean_str),
    "Broad Type of Service": ("service_type", clean_str),
    "Services": ("services", clean_money_int),
    "Benefits ($)": ("benefits", clean_money_float),
    "Bulk Billed Services": ("bulk_billed_services", clean_money_int),
    "Patient Billed Services": ("patient_billed_services", clean_money_int),
    "Bulk Billed Benefits ($)": ("bulk_billed_benefits", clean_money_float),
    "Patient Billed Benefits ($)": ("patient_billed_benefits", clean_money_float),
    "MBS Bulk Billing Rate (%)": ("mbs_bulk_billing_rate", clean_money_float),
    "Avg Patient Contribution Per Service: Out of Hospital Patient Billed ($)": (
        "avg_patient_contribution", clean_money_float,
    ),
    "Schedule Fee ($)": ("schedule_fee", clean_money_float),
    "Fee Charged ($)": ("fee_charged", clean_money_float),
    "Bulk Billed Fee Charged ($)": ("bulk_billed_fee_charged", clean_money_float),
    "Patient Billed Fee Charged ($)": ("patient_billed_fee_charged", clean_money_float),
    "Out of Pocket ($)": ("out_of_pocket", clean_money_float),
    "Services L3Y CAGR": ("services_l3y_cagr", clean_money_float),
    "Benefits L3Y CAGR": ("benefits_l3y_cagr", clean_money_float),
    "Fee Charged L3Y CAGR": ("fee_charged_l3y_cagr", clean_money_float),
    "Out of Pocket L3Y CAGR": ("out_of_pocket_l3y_cagr", clean_money_float),
    "MBS BB Rate L3Y CAGR": ("mbs_bb_rate_l3y_cagr", clean_money_float),
}


def load_gp_billing_sa3_ltm():
    path = os.path.join(REPO_ROOT, "data", "markets", "gp", "billing", "GP NRA by SA3 FY25 + Growth.csv")
    # source file has 4 title/blank rows before the real header, and isn't valid utf-8
    # (Windows/Excel export - has a stray non-utf8 en-dash byte)
    df = pd.read_csv(path, skiprows=4, encoding="cp1252")

    col_names = [col for col, _ in GP_BILLING_SA3_LTM_COL_MAP.values()]
    update_clause = ", ".join(f"{c} = excluded.{c}" for c in col_names if c != "sa3_name")
    insert_sql = f"""
        insert into gp_billing_sa3_ltm ({', '.join(col_names)})
        values %s
        on conflict (sa3_name) do update set {update_clause}
    """
    template = "(" + ", ".join(f"%({c})s" for c in col_names) + ")"

    rows = []
    for _, row in df.iterrows():
        r = {}
        for src_col, (col, cleaner) in GP_BILLING_SA3_LTM_COL_MAP.items():
            r[col] = cleaner(row[src_col])
        rows.append(r)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, insert_sql, rows, template=template)
            # resolve sa3_code by name match against sa3.sa3_name where possible; left
            # null for the ~5 ABS merged-region rows that don't map to a single SA3
            cur.execute("""
                update gp_billing_sa3_ltm b set sa3_code = s.sa3_code
                from sa3 s where s.sa3_name = b.sa3_name
            """)
            matched = cur.rowcount
        conn.commit()
        print(f"gp_billing_sa3_ltm: upserted {len(rows)} rows ({matched} resolved to an sa3_code)")
        return len(rows)
    finally:
        conn.close()


def verify():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for market_id in MARKETS:
                cur.execute("select count(*) from clinics where market_id = %s", (market_id,))
                print(f"clinics[{market_id}]: {cur.fetchone()[0]}")
            cur.execute("select count(*) from clinics where isochrone_geom is not null")
            print(f"clinics with isochrone: {cur.fetchone()[0]}")
            for table in ["sa3", "sa2", "sa1", "mmm_benchmark", "markets"]:
                cur.execute(f"select count(*) from {table}")
                print(f"{table}: {cur.fetchone()[0]}")
            cur.execute("select count(*) from sa3 where demand_score is null")
            print(f"sa3 rows with no scoring (territory-only): {cur.fetchone()[0]}")
            cur.execute("select count(*) from sa3 where mmm_dominant is distinct from mmm_classification")
            print(f"sa3 rows where mmm_dominant != mmm_classification: {cur.fetchone()[0]}")
            cur.execute("select count(*) from gp_billing_sa3_ltm")
            print(f"gp_billing_sa3_ltm: {cur.fetchone()[0]}")
            cur.execute("select count(*) from gp_billing_sa3_ltm where sa3_code is null")
            print(f"gp_billing_sa3_ltm rows unresolved to an sa3_code: {cur.fetchone()[0]}")
    finally:
        conn.close()


STEPS = {
    "schema": run_schema,
    "markets": load_markets,
    "clinics": load_clinics,
    "isochrones": load_isochrones,
    "geo": load_geo,
    "demographics": load_demographics,
    "mmm": load_mmm,
    "billing": load_gp_billing_sa3_ltm,
    "verify": verify,
}

# "billing" depends on sa3 rows already existing (resolves sa3_code by name match), so
# it must run after "geo"
ALL_ORDER = ["schema", "markets", "clinics", "isochrones", "geo", "demographics", "mmm", "billing"]


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in STEPS and sys.argv[1] != "all":
        print(__doc__)
        sys.exit(1)
    step = sys.argv[1]
    if step == "all":
        for s in ALL_ORDER:
            print(f"=== {s} ===")
            STEPS[s]()
    else:
        STEPS[step]()


if __name__ == "__main__":
    main()
