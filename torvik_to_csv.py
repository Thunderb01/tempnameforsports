"""
torvik_to_csv.py — Download Bart Torvik player stats → CSV
============================================================
Pulls the full player advanced stats CSV from barttorvik.com
and saves a clean, headered version locally.

Confirmed against a real production run (2026-11-08): barttorvik.com's raw
response has NO header row -- the site's own CSV exports never have one,
whether fetched here or downloaded by hand. Without detecting that, the
first player's data gets consumed as column names and every downstream
df["player_name"]-style lookup breaks. This applies the known trank-CSV
schema (same one torvik_metrics.py/torvik_metrics_w.py's read_trank_csv()
uses -- kept in sync by hand since these are standalone, non-cross-
importing scripts by convention) so the saved file always has real headers,
whatever script reads it next.

Usage:
    python torvik_to_csv.py
    python torvik_to_csv.py --year 2025
    python torvik_to_csv.py --output data/torvik_2026.csv
"""

import argparse
import datetime
import os
import sys
from io import StringIO

try:
    import pandas as pd
    import requests
except ImportError:
    sys.exit("Run: pip install pandas requests")

_now = datetime.date.today()
DEFAULT_YEAR = _now.year + 1 if _now.month >= 10 else _now.year

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
}

# Kept in sync by hand with torvik_metrics.py's TRANK_BASE_COLUMNS -- see
# that file's "TRANK CSV READING" section for the full rationale.
TRANK_BASE_COLUMNS = [
    "player_name", "team", "conf", "GP", "Min_per", "ORtg", "usg", "eFG", "TS_per",
    "ORB_per", "DRB_per", "AST_per", "TO_per", "FTM", "FTA", "FT_per", "twoPM",
    "twoPA", "twoP_per", "TPM", "TPA", "TP_per", "blk_per", "stl_per", "ftr", "yr",
    "ht", "num", "porpag", "adjoe", "pfr", "year", "pid", "type", "Rec_Rank",
    "ast/tov", "rimmade", "rimmade+rimmiss", "midmade", "midmade+midmiss",
    "rimmade/(rimmade+rimmiss)", "midmade/(midmade+midmiss)", "dunksmade",
    "dunksmiss+dunksmade", "dunksmade/(dunksmiss+dunksmade)", "pick", "drtg",
    "adrtg", "dporpag", "stops", "bpm", "obpm", "dbpm", "gbpm", "mp", "ogbpm",
    "dgbpm", "oreb", "dreb", "treb", "ast", "stl", "blk", "pts", "role",
    "3p/100", "dob",
]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--year",   type=int, default=DEFAULT_YEAR)
    p.add_argument("--output", default=None)
    return p.parse_args()


def parse_trank_response(text):
    """CSV text -> headered DataFrame, whether or not the response itself
    has a header row."""
    first_line = text.split("\n", 1)[0]
    has_header = first_line.strip().split(",")[0].strip('"') == "player_name"
    if has_header:
        return pd.read_csv(StringIO(text))

    n_cols = len(next(pd.read_csv(StringIO(text), header=None, nrows=1).itertuples(index=False)))
    if n_cols < len(TRANK_BASE_COLUMNS):
        sys.exit(f"Response has only {n_cols} columns, expected at least "
                  f"{len(TRANK_BASE_COLUMNS)} (base trank schema) -- this doesn't "
                  f"look like a trank CSV at all.")
    names = TRANK_BASE_COLUMNS + [f"unk_{i}" for i in range(len(TRANK_BASE_COLUMNS), n_cols)]
    print(f"  (no header row in the response -- applying the known {len(TRANK_BASE_COLUMNS)}-column "
          f"trank schema{f' + {n_cols - len(TRANK_BASE_COLUMNS)} unnamed trailing column(s)' if n_cols > len(TRANK_BASE_COLUMNS) else ''})")
    return pd.read_csv(StringIO(text), header=None, names=names)


def main():
    args = parse_args()
    output = args.output or f"data/torvik_{args.year}.csv"

    url = f"https://barttorvik.com/getadvstats.php?year={args.year}&csv=1"
    print(f"Downloading: {url}")

    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    df = parse_trank_response(resp.text)

    print(f"Columns ({len(df.columns)}): {df.columns.tolist()}")
    print(f"Rows: {len(df)}")
    print(df.head(3).to_string())

    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    df.to_csv(output, index=False)
    print(f"\n✓ Saved to {output}")

if __name__ == "__main__":
    main()
