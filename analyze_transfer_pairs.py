"""
analyze_transfer_pairs.py — Exploratory: how much do stats actually shift after a transfer?
=============================================================================================
Mines historical_stats (2009-2025, every D1 season Barttorvik has, not just current
board players — this is a data-availability question, so use the full archive) for
"transfer pairs": the same torvik_pid appearing in two different teams in two
different (usually consecutive) seasons. That's the natural-experiment signal a
"how would this player perform on a new team" model would train on.

This script does NOT train anything. It answers the question that has to come
first: is there enough signal here to bother? It reports how many transfer pairs
exist, and how much sei/ath/ris/dds/cdi/ppg/rpg/apg/nil_valuation typically shift
between the "before" and "after" season — overall and by position bucket — and
writes the full pair-level table to a CSV for further inspection.

Excludes low-signal seasons (< MIN_GP games or < MIN_MIN_PCT minutes share) on
either side of a pair — same cutoff torvik_metrics.py uses to exclude garbage-time
seasons from live metrics, applied here so a few mop-up minutes don't masquerade
as a real breakout or decline.

Usage:
    python analyze_transfer_pairs.py                     # full run, writes CSV
    python analyze_transfer_pairs.py --min-gp 15          # stricter GP cutoff
    python analyze_transfer_pairs.py --out my_pairs.csv

Env:
    SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import argparse
import os
import sys

try:
    import pandas as pd
except ImportError:
    sys.exit("Run: pip install pandas")

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

PAGE = 1000
METRICS = ["sei", "ath", "ris", "dds", "cdi"]
BOX_STATS = ["ppg", "rpg", "apg"]
VALUE_COLS = ["nil_valuation", "open_market_low", "open_market_high"]

COLUMNS = (
    "torvik_pid, year, name, team, conf, pos, class_yr, "
    + ", ".join(METRICS) + ", " + ", ".join(BOX_STATS) + ", " + ", ".join(VALUE_COLS)
    + ", torvik_gp, torvik_min_pct"
)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--min-gp",      type=float, default=10, help="Exclude seasons with fewer games played")
    p.add_argument("--min-min-pct", type=float, default=10, help="Exclude seasons with lower minutes-share %%")
    p.add_argument("--out",         type=str,   default="transfer_pairs.csv")
    return p.parse_args()


def fetch_all_historical(sb):
    rows, page = [], 0
    while True:
        res = (sb.table("historical_stats")
                 .select(COLUMNS)
                 .range(page * PAGE, (page + 1) * PAGE - 1)
                 .execute())
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        page += 1
    return rows


def main():
    args = parse_args()
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print("Fetching historical_stats (this is the full 2009-2025 archive, ~tens of thousands of rows)…")
    rows = fetch_all_historical(sb)
    print(f"  {len(rows)} season rows fetched")
    if not rows:
        print("Nothing to analyze — historical_stats is empty.")
        return

    df = pd.DataFrame(rows)
    df = df.dropna(subset=["torvik_pid", "year", "team"])
    df["torvik_pid"] = df["torvik_pid"].astype(int)
    df["year"] = df["year"].astype(int)

    before_qc = len(df)
    df = df[(df["torvik_gp"].fillna(0) >= args.min_gp) & (df["torvik_min_pct"].fillna(0) >= args.min_min_pct)]
    print(f"  {len(df)} rows after excluding low-minutes seasons ({before_qc - len(df)} dropped, "
          f"< {args.min_gp} GP or < {args.min_min_pct}% minutes)")

    # A player needs >= 2 qualifying seasons to possibly have a transfer pair.
    counts = df.groupby("torvik_pid").size()
    multi_season_pids = counts[counts >= 2].index
    print(f"  {len(multi_season_pids)} distinct players have 2+ qualifying seasons")

    pairs = []
    for pid, group in df[df["torvik_pid"].isin(multi_season_pids)].groupby("torvik_pid"):
        g = group.sort_values("year").reset_index(drop=True)
        for i in range(len(g) - 1):
            a, b = g.iloc[i], g.iloc[i + 1]
            if a["team"] == b["team"]:
                continue  # same school, not a transfer
            pair = {
                "torvik_pid": pid,
                "name": b["name"],
                "from_year": int(a["year"]), "to_year": int(b["year"]),
                "year_gap": int(b["year"] - a["year"]),
                "from_team": a["team"], "to_team": b["team"],
                "from_conf": a.get("conf"), "to_conf": b.get("conf"),
                "pos": b.get("pos"),
                "class_yr_to": b.get("class_yr"),
            }
            for col in METRICS + BOX_STATS + VALUE_COLS:
                fv, tv = a.get(col), b.get(col)
                pair[f"{col}_from"] = fv
                pair[f"{col}_to"] = tv
                pair[f"{col}_delta"] = (tv - fv) if (pd.notna(fv) and pd.notna(tv)) else None
            pairs.append(pair)

    if not pairs:
        print("\nNo transfer pairs found. Nothing to report.")
        return

    pairs_df = pd.DataFrame(pairs)
    pairs_df.to_csv(args.out, index=False)
    print(f"\n{len(pairs_df)} transfer pairs found across {pairs_df['torvik_pid'].nunique()} players.")
    print(f"Written to {args.out}\n")

    print("── Delta summary (to-season minus from-season), all pairs ──")
    for col in METRICS + BOX_STATS:
        d = pairs_df[f"{col}_delta"].dropna()
        if len(d) == 0:
            continue
        print(f"  {col:>4}  n={len(d):<5}  mean={d.mean():+.2f}  median={d.median():+.2f}  std={d.std():.2f}")

    nil_d = pairs_df["nil_valuation_delta"].dropna()
    if len(nil_d) > 0:
        pct_up = (nil_d > 0).mean() * 100
        print(f"\n  NIL valuation: n={len(nil_d)}  mean Δ=${nil_d.mean():+,.0f}  median Δ=${nil_d.median():+,.0f}  "
              f"({pct_up:.0f}% of transfers saw NIL valuation increase)")

    print("\n── Same breakdown by position bucket ──")
    for pos, sub in pairs_df.groupby("pos"):
        print(f"\n  {pos} (n={len(sub)}):")
        for col in METRICS:
            d = sub[f"{col}_delta"].dropna()
            if len(d) == 0:
                continue
            print(f"    {col:>4}  mean={d.mean():+.2f}  median={d.median():+.2f}")

    same_year = (pairs_df["year_gap"] == 1).sum()
    gap_year  = (pairs_df["year_gap"] > 1).sum()
    print(f"\n── Timing ──\n  Consecutive-season transfers: {same_year}\n  Transfers with a gap year (redshirt/injury/JUCO/etc.): {gap_year}")


if __name__ == "__main__":
    main()
