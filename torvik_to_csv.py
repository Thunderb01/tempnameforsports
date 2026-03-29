"""
torvik_to_csv.py — Download Bart Torvik player stats → CSV
============================================================
Pulls the full player advanced stats CSV from barttorvik.com
and saves a clean version locally.

Usage:
    python torvik_to_csv.py
    python torvik_to_csv.py --year 2025
    python torvik_to_csv.py --output data/torvik_2026.csv
"""

import argparse
import datetime
import sys

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

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--year",   type=int, default=DEFAULT_YEAR)
    p.add_argument("--output", default=None)
    return p.parse_args()

def main():
    args = parse_args()
    output = args.output or f"data/torvik_{args.year}.csv"

    url = f"https://barttorvik.com/advstats.php?year={args.year}&csv=1"
    print(f"Downloading: {url}")

    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    from io import StringIO
    df = pd.read_csv(StringIO(resp.text))

    print(f"Columns ({len(df.columns)}): {df.columns.tolist()}")
    print(f"Rows: {len(df)}")
    print(df.head(3).to_string())

    import os
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    df.to_csv(output, index=False)
    print(f"\n✓ Saved to {output}")

if __name__ == "__main__":
    main()
