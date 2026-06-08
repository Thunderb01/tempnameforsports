"""
import_w_torvik.py — Seed w_players + w_player_stats from a Torvik CSV
=========================================================================
Initial Women's data migration. Reads `data/trank_ncaaw_2026.csv` (same
column layout as the men's `trank_data_2026.csv`, minus the trailing
`dob` field) and upserts:

  - w_players      <- name, current_team, primary_position, year,
                     height, hometown, source='torvik', torvik_pid
  - w_player_stats <- raw torvik_* columns + ppg/rpg/apg/etc. converted
                     from the per-game-style columns in the CSV

This is the women's-side analog of the COMBINED work that
`scraper_to_supabase.py` + `torvik_metrics.py` do on the men's side, but
collapsed into one pass because we don't have a Sports-Reference scraper
for women's yet. It writes only the columns the frontend reads via
`vw_w_players`; BTP composite metrics (sei/ath/ris/dds/cdi) and NIL
valuation are left null for now and filled in by a follow-up pass once
we tune the women's scoring config.

Usage:
    python import_w_torvik.py --dry-run                # preview, no DB writes
    python import_w_torvik.py                          # write to Supabase
    python import_w_torvik.py --csv data/foo.csv       # alternate CSV
    python import_w_torvik.py --teams "South Carolina" "UConn"

Prerequisites:
    1. Run supabase/womens_tables.sql in the Supabase SQL Editor first.
    2. Set env vars:
       $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
       $env:SUPABASE_SERVICE_KEY="your-service-role-key"
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

# Default to women's; the script is named import_w_torvik for a reason.
DEFAULT_CSV  = "data/trank_ncaaw_2026.csv"
DEFAULT_YEAR = 2026


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--csv",     default=DEFAULT_CSV)
    p.add_argument("--year",    type=int, default=DEFAULT_YEAR,
                   help="Season year — written to w_player_stats.year and w_players.year-equivalent.")
    p.add_argument("--dry-run", action="store_true",
                   help="Preview the first 3 rows and exit; no DB writes.")
    p.add_argument("--teams",   nargs="+", metavar="TEAM",
                   help="Limit to these teams (exact Torvik team name).")
    p.add_argument("--limit",   type=int,
                   help="Limit number of rows processed (for spot-testing).")
    return p.parse_args()


def safe(val, default=None):
    """Return val unless it's NaN / None / empty string, in which case default."""
    if val is None:
        return default
    try:
        if pd.isna(val):
            return default
    except (TypeError, ValueError):
        pass
    if isinstance(val, str) and not val.strip():
        return default
    return val


def safe_float(val, default=None):
    v = safe(val)
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def safe_int(val, default=None):
    v = safe_float(val)
    if v is None:
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def build_player_row(row, year):
    """Map a Torvik CSV row → a w_players insert payload."""
    return {
        "name":             str(row["player_name"]).strip(),
        "current_team":     str(row["team"]).strip(),
        "primary_position": safe(row.get("role")),       # raw Torvik label, e.g. "Combo G"
        "year":             safe(row.get("yr")),         # Fr / So / Jr / Sr
        "height":           safe(row.get("ht")),         # e.g. "6-1"
        "hometown":         safe(row.get("type")),       # Torvik stores hometown in `type`
        # The men's `players` table has a CHECK constraint on source —
        # only "program" / "portal" / "intl" are allowed. `LIKE INCLUDING ALL`
        # copies that constraint to w_players, so we use "program" here to
        # match the men's Sports-Reference scraper convention. If you later
        # want to distinguish Torvik-seeded rows, ALTER TABLE w_players
        # DROP/recreate the check to add "torvik" and switch this back.
        "source":           "program",
        "torvik_pid":       safe_int(row.get("pid")),
    }


def build_stats_row(row, year):
    """Map a Torvik CSV row → a w_player_stats insert payload.

    The Torvik CSV's `pts/oreb/dreb/treb/ast/stl/blk` columns are already
    per-game (averaged over GP). We surface them as ppg/rpg/apg/etc. so
    the frontend's per-game displays render without extra plumbing.
    """
    fg_pct = None
    twoPA = safe_float(row.get("twoPA"))
    twoPM = safe_float(row.get("twoPM"))
    TPA   = safe_float(row.get("TPA"))
    TPM   = safe_float(row.get("TPM"))
    GP    = safe_float(row.get("GP")) or 0
    if twoPA is not None and TPA is not None and (twoPA + TPA) > 0:
        fg_pct = ((twoPM or 0) + (TPM or 0)) / (twoPA + TPA)
    # Torvik CSV stores TPA/TPM as season totals; the frontend's "3pg" is per-game.
    threes_per_game = (TPA / GP) if (TPA is not None and GP > 0) else None

    return {
        "year":            year,
        "name":            str(row["player_name"]).strip(),
        # per-game from Torvik per-game fields
        "ppg":             safe_float(row.get("pts")),
        "rpg":             safe_float(row.get("treb")),
        "apg":             safe_float(row.get("ast")),
        "3pg":             threes_per_game,
        "usg":             safe_float(row.get("usg")),
        "ast_tov":         safe_float(row.get("ast/tov")),
        "fg_pct":          fg_pct,
        "ft_pct":          safe_float(row.get("FT_per")),
        "3p_pct":          safe_float(row.get("TP_per")),
        # raw Torvik composite columns (drive any later metric pass)
        "torvik_ortg":     safe_float(row.get("ORtg")),
        "torvik_usg":      safe_float(row.get("usg")),
        "torvik_efg":      safe_float(row.get("eFG")),
        "torvik_ts":       safe_float(row.get("TS_per")),
        "torvik_obpm":     safe_float(row.get("obpm")),
        "torvik_dbpm":     safe_float(row.get("dbpm")),
        "torvik_bpm":      safe_float(row.get("bpm")),
        "torvik_drtg":     safe_float(row.get("drtg")),
        "torvik_stops":    safe_float(row.get("stops")),
        "torvik_ast_pct":  safe_float(row.get("AST_per")),
        "torvik_to_pct":   safe_float(row.get("TO_per")),
        "torvik_orb_pct":  safe_float(row.get("ORB_per")),
        "torvik_drb_pct":  safe_float(row.get("DRB_per")),
        "torvik_3p_pct":   safe_float(row.get("TP_per")),
        "torvik_porpag":   safe_float(row.get("porpag")),
        "torvik_adjoe":    safe_float(row.get("adjoe")),
        "torvik_min_pct":  safe_float(row.get("Min_per")),
        "torvik_gp":       safe_int(row.get("GP")),
        "torvik_blk_pct":  safe_float(row.get("blk_per")),
        "torvik_stl_pct":  safe_float(row.get("stl_per")),
        "torvik_ftr":      safe_float(row.get("ftr")),
        "torvik_pfr":      safe_float(row.get("pfr")),
        "torvik_adrtg":    safe_float(row.get("adrtg")),
        "torvik_dporpag":  safe_float(row.get("dporpag")),
        "torvik_ogbpm":    safe_float(row.get("ogbpm")),
        "torvik_dgbpm":    safe_float(row.get("dgbpm")),
        "torvik_gbpm":     safe_float(row.get("gbpm")),
        "torvik_rec_rank": safe_float(row.get("Rec_Rank")),
        # school + conference from CSV
        "school":          str(row["team"]).strip(),
        "conference":      safe(row.get("conf")),
        # cdi / dds / sei / ath / ris / projected_tier left null — fill in a
        # follow-up pass once the women's scoring config is tuned.
    }


def main():
    args = parse_args()

    # ── Load CSV ──────────────────────────────────────────────────────────────
    if not os.path.exists(args.csv):
        sys.exit(f"CSV not found: {args.csv}")
    print(f"Reading {args.csv} ...")
    df = pd.read_csv(args.csv)

    required = {"player_name", "team", "conf", "yr", "ht", "role", "pid"}
    missing = required - set(df.columns)
    if missing:
        sys.exit(f"CSV is missing expected columns: {missing}")

    # Dedup: keep latest year per (player, team) — same convention as men's
    if "year" in df.columns:
        df = df.sort_values("year", ascending=False).drop_duplicates(
            subset=["player_name", "team"], keep="first"
        )
    print(f"  {len(df)} unique rows after dedup")

    # Filters
    if args.teams:
        df = df[df["team"].isin(set(args.teams))]
        print(f"  {len(df)} rows after --teams filter")
    if args.limit:
        df = df.head(args.limit)
        print(f"  {len(df)} rows after --limit")

    # ── Dry-run: print and exit ───────────────────────────────────────────────
    if args.dry_run:
        print("\nDry-run preview (first 3 rows) — no DB writes:\n")
        for _, row in df.head(3).iterrows():
            pr = build_player_row(row, args.year)
            sr = build_stats_row(row, args.year)
            print(f"  w_players      <- {pr}")
            print(f"  w_player_stats <- {sr}\n")
        print(f"Would upsert {len(df)} player + {len(df)} stats rows.")
        return

    # ── Write to Supabase ─────────────────────────────────────────────────────
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars, or use --dry-run.")
    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    written_players = 0
    written_stats   = 0
    errors          = []

    for _, row in df.iterrows():
        try:
            player_payload = build_player_row(row, args.year)
            stats_payload  = build_stats_row(row, args.year)

            # 1. Upsert player → get id back
            res = db.table("w_players").upsert(
                player_payload,
                on_conflict="name,current_team,source",
            ).execute()
            player_id = res.data[0]["id"]
            written_players += 1

            # 2. Stats: manual SELECT → UPDATE-or-INSERT.
            # We don't rely on ON CONFLICT here because the men's `player_stats`
            # table's UNIQUE on (player_id, year) — if it exists — wasn't always
            # carried over by `LIKE INCLUDING ALL`. The select-then-write path
            # works regardless of the constraint state.
            stats_with_pid = {**stats_payload, "player_id": player_id}
            existing = (
                db.table("w_player_stats")
                  .select("id")
                  .eq("player_id", player_id)
                  .eq("year", args.year)
                  .limit(1)
                  .execute()
            )
            if existing.data:
                db.table("w_player_stats").update(stats_with_pid) \
                  .eq("id", existing.data[0]["id"]).execute()
            else:
                db.table("w_player_stats").insert(stats_with_pid).execute()
            written_stats += 1

        except Exception as e:
            errors.append((player_payload.get("name"), player_payload.get("current_team"), str(e)))
            if len(errors) <= 5:
                print(f"  [ERR] {player_payload.get('name')} ({player_payload.get('current_team')}): {e}")

        # Progress every 250 rows
        if (written_players + written_stats) % 500 == 0:
            print(f"  ... {written_players} players / {written_stats} stats so far")

    print(f"\n[OK] Done.")
    print(f"  w_players upserted     : {written_players}")
    print(f"  w_player_stats upserted: {written_stats}")
    if errors:
        print(f"  Errors                 : {len(errors)}")
        if len(errors) > 5:
            print(f"   (showing first 5; full list in script)")


if __name__ == "__main__":
    main()
