"""
import_historical.py — Retro-compute BTP metrics for past players -> historical_stats
=====================================================================================
Reads Barttorvik advanced-stats CSVs (headerless, one file per season) and writes
BTP metrics (sei/ath/ris/dds/cdi) + box stats to the ISOLATED `historical_stats`
table. Never touches players / player_stats / vw_players.

The metric formulas are REUSED from torvik_metrics.py (no duplication), run in
"use_torvik" mode so everything is computed from the CSV alone — no Supabase
reads needed for the metrics. Metrics are within-season position percentiles, so
each year is self-contained.

CSV source (download once into data/):
    https://barttorvik.com/getadvstats.php?year=<YEAR>&csv=1  ->  data/trank_adv_<YEAR>.csv
These are headerless but share the exact column order of data/trank_data_2026.csv,
so we read them with names taken from that file's header.

Prereq: run supabase/historical.sql first.

Usage:
    python import_historical.py --year 2012
    python import_historical.py --all                 # loops 2009–2025
    python import_historical.py --year 2015 --dry-run  # compute, print, no write

Env:
    SUPABASE_URL          https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY  service-role key (bypasses RLS)
"""

import argparse
import csv
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

try:
    import pandas as pd
except ImportError:
    sys.exit("Run: pip install pandas")

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

# Reuse the exact metric formulas + helpers from the live pipeline.
from torvik_metrics import (
    compute_cdi, compute_dds, compute_sei, compute_ath, compute_ris,
    normalise_pos, clamp,
)

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

HEADER_FILE = "data/trank_data_2026.csv"   # source of the column names
FIRST_YEAR, LAST_YEAR = 2009, 2025
BATCH = 1000   # rows per upsert request

# One Supabase client per worker thread (httpx clients aren't safe to share).
_local = threading.local()
def _client():
    if not hasattr(_local, "sb"):
        _local.sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _local.sb

def _upsert_chunk(chunk):
    _client().table("historical_stats").upsert(chunk, on_conflict="torvik_pid,year").execute()
    return len(chunk)

# Columns that are text; everything else is coerced to numeric.
TEXT_COLS = {"player_name", "team", "conf", "yr", "ht", "type", "role", "dob"}


def load_header():
    with open(HEADER_FILE, newline="") as f:
        return next(csv.reader(f))


def read_year_csv(path, header):
    df = pd.read_csv(path, header=None, names=header, dtype=str, keep_default_na=False)
    # Coerce numeric columns (leave text columns alone).
    for col in df.columns:
        if col not in TEXT_COLS:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def prep(df):
    """Add the derived columns the compute_* functions expect."""
    df["pos_bucket"] = df["role"].apply(normalise_pos)
    # compute_cdi references these Supabase-join columns; absent here -> NaN so it
    # falls back to the CSV's ast/tov. Create them so it doesn't KeyError.
    for c in ("sb_tot_ast", "sb_tot_mp", "sb_tot_tov"):
        df[c] = float("nan")
    return df


def num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if pd.isna(f) else f


def build_rows(df, year):
    df = prep(df)
    df["_cdi"] = compute_cdi(df)
    df["_dds"] = compute_dds(df, use_torvik=True)
    df["_sei"] = compute_sei(df, use_torvik=True)
    df["_ath"] = compute_ath(df, use_torvik=True)
    df["_ris"] = compute_ris(df, use_torvik=True)

    rows = []
    for _, r in df.iterrows():
        pid = r.get("pid")
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            continue  # need a stable Barttorvik pid to dedupe seasons
        name = str(r.get("player_name") or "").strip()
        if not name:
            continue

        tp = num(r.get("TP_per"))  # decimal (0.349) -> store as 0–100
        rows.append({
            "torvik_pid":  pid,
            "year":        int(year),
            "name":        name,
            "team":        (str(r.get("team")).strip() or None),
            "conf":        (str(r.get("conf")).strip() or None),
            "pos":         r.get("pos_bucket") or None,
            "class_yr":    (str(r.get("yr")).strip() or None),
            "height":      (str(r.get("ht")).strip() or None),
            "hometown":    (str(r.get("type")).strip() or None),
            "ppg":         num(r.get("pts")),
            "rpg":         num(r.get("treb")),
            "apg":         num(r.get("ast")),
            "3p_pct":      (round(tp * 100, 1) if tp is not None else None),
            "sei":         num(r.get("_sei")),
            "ath":         num(r.get("_ath")),
            "ris":         num(r.get("_ris")),
            "dds":         num(r.get("_dds")),
            "cdi":         num(r.get("_cdi")),
            # NIL / projected_tier deferred (v1) — left null.
            "torvik_usg":     num(r.get("usg")),
            "torvik_ts":      num(r.get("TS_per")),
            "torvik_efg":     num(r.get("eFG")),
            "torvik_ortg":    num(r.get("ORtg")),
            "torvik_bpm":     num(r.get("bpm")),
            "torvik_ast_pct": num(r.get("AST_per")),
            "torvik_to_pct":  num(r.get("TO_per")),
            "torvik_blk_pct": num(r.get("blk_per")),
            "torvik_stl_pct": num(r.get("stl_per")),
            "torvik_orb_pct": num(r.get("ORB_per")),
            "torvik_drb_pct": num(r.get("DRB_per")),
            "torvik_min_pct": num(r.get("Min_per")),
            "torvik_gp":      (int(r["GP"]) if num(r.get("GP")) is not None else None),
        })
    return rows


def process_year(year, csv_path, dry_run, workers):
    if not os.path.exists(csv_path):
        print(f"  x {year}: {csv_path} not found — skipping.")
        return
    df = read_year_csv(csv_path, load_header())
    rows = build_rows(df, year)
    print(f"  {year}: {len(rows)} players -> historical_stats")

    if dry_run:
        for r in rows[:8]:
            print(f"    {r['name']:<24} {r['team']:<18} {r['pos']:<5} "
                  f"SEI {r['sei']:>3} ATH {r['ath']:>3} RIS {r['ris']:>3} DDS {r['dds']:>3} CDI {r['cdi']:>3}")
        if len(rows) > 8:
            print(f"    ... and {len(rows) - 8} more")
        return

    chunks = [rows[i:i + BATCH] for i in range(0, len(rows), BATCH)]
    written = 0
    # Fire batches concurrently — the bottleneck is HTTP round-trips, not the DB.
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for n in ex.map(_upsert_chunk, chunks):
            written += n
            print(f"    {written}/{len(rows)} written...", end="\r")
    print(f"\n  OK: {year} done ({written} rows).")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--year", type=int, help="Single season to import.")
    p.add_argument("--all",  action="store_true", help=f"Loop {FIRST_YEAR}–{LAST_YEAR}.")
    p.add_argument("--csv",  help="Override CSV path (default data/trank_adv_<year>.csv).")
    p.add_argument("--dry-run", action="store_true", help="Compute + print, no writes.")
    p.add_argument("--workers", type=int, default=8, help="Concurrent upload workers (default 8).")
    args = p.parse_args()

    if not args.year and not args.all:
        sys.exit("Pass --year <YYYY> or --all.")

    if not args.dry_run and (not SUPABASE_URL or not SUPABASE_SERVICE_KEY):
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or use --dry-run).")

    years = range(FIRST_YEAR, LAST_YEAR + 1) if args.all else [args.year]
    print(f"Importing {len(list(years))} season(s){' [DRY-RUN]' if args.dry_run else ''}...")
    for y in years:
        path = args.csv if (args.csv and args.year) else f"data/trank_adv_{y}.csv"
        process_year(y, path, args.dry_run, args.workers)


if __name__ == "__main__":
    main()
