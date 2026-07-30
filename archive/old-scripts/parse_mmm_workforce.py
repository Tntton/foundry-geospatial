#!/usr/bin/env python3
"""Parse ABS HWD MMM CSVs and emit mmm_benchmark.json."""
import json
import pandas as pd

BASE = 'gp_workforce_2020_2025'
# 2025 is column index 6 (cols: label, 2020, 2021, 2022, 2023, 2024, 2025, CAGR)
YEAR_IDX = 6

def ascii_label(cell):
    """Strip non-ASCII chars and normalise whitespace."""
    return ''.join(c for c in str(cell) if c.isascii()).strip().upper()

def find_row(df, keyword, start=0):
    """Return index of first row (from start) whose ASCII label contains keyword."""
    for i in range(start, len(df)):
        if keyword in ascii_label(df.iloc[i, 0]):
            return i
    return None

def first_data_row(df, after):
    """First row after index 'after' that has a numeric value in the 2025 column."""
    for j in range(after + 1, after + 6):
        v = pd.to_numeric(df.iloc[j, YEAR_IDX], errors='coerce')
        if v == v:   # not nan
            return j
    return None

def get_val(df, row):
    return float(pd.to_numeric(df.iloc[row, YEAR_IDX], errors='coerce'))

benchmark = {}

for mm in range(1, 8):
    path = f'{BASE}/mm{mm}.csv'
    df = pd.read_csv(path, encoding='latin-1', header=None)

    # GPFTE Total
    gpfte_header = find_row(df, 'GPFULLTIMEEQUIVALENT')
    gpfte_row    = first_data_row(df, gpfte_header)

    # Age rows (scan for label containing '55' then '65')
    age55_row = find_row(df, '55')
    age65_row = find_row(df, '65+', start=age55_row + 1) if age55_row else find_row(df, '65+')

    # GPFTE per 100k
    per100k_header = find_row(df, 'PER100,000')
    per100k_row    = first_data_row(df, per100k_header)

    gpfte_total   = get_val(df, gpfte_row)
    gpfte_55_64   = get_val(df, age55_row)
    gpfte_65p     = get_val(df, age65_row)
    gpfte_per100k = get_val(df, per100k_row)

    gpfte_per_10k = round(gpfte_per100k / 10, 4)
    pct_55plus    = round((gpfte_55_64 + gpfte_65p) / gpfte_total * 100, 4)

    benchmark[str(mm)] = {
        'gpfte_per_10k': gpfte_per_10k,
        'pct_55plus': pct_55plus
    }
    print(f'MM{mm}: gpfte_per_10k={gpfte_per_10k:.2f}  pct_55plus={pct_55plus:.2f}%')

with open('data/mmm_benchmark.json', 'w') as f:
    json.dump(benchmark, f, indent=2)

print('\nWrote mmm_benchmark.json')
