"""
torvik_update_players.py — Patch players table with height + hometown from Torvik CSV
======================================================================================
Reads a local Torvik CSV (default: data/trank_data.csv) and updates the `height` and
`hometown` columns in Supabase for every matched player.

Matching is done on (name, current_team). Rows that don't match any Supabase player
are reported at the end.

Usage:
    python torvik_update_players.py
    python torvik_update_players.py --csv data/torvik_2026.csv
    python torvik_update_players.py --dry-run

Prerequisites (run once in Supabase SQL Editor):
    ALTER TABLE public.players ADD COLUMN IF NOT EXISTS height text;
    ALTER TABLE public.players ADD COLUMN IF NOT EXISTS hometown text;

Environment variables:
    export SUPABASE_URL="https://xxxxxxxxxxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="your-service-role-key"
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


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--csv",     default="data/trank_data.csv")
    p.add_argument("--dry-run", action="store_true", help="Print updates without writing")
    return p.parse_args()


def normalise_name(s):
    """Lowercase + strip for fuzzy matching."""
    return str(s).strip().lower()


def main():
    args = parse_args()

    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars, or use --dry-run.")
        db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # ── Load CSV ──────────────────────────────────────────────────────────────
    print(f"Reading {args.csv} …")
    df = pd.read_csv(args.csv)

    required = {"player_name", "team", "ht", "type"}
    missing = required - set(df.columns)
    if missing:
        sys.exit(f"CSV is missing expected columns: {missing}")

    # Drop rows with no height AND no hometown — nothing to update
    df = df.dropna(subset=["ht", "type"], how="all")
    # Deduplicate: if same player appears for multiple seasons keep latest year
    if "year" in df.columns:
        df = df.sort_values("year", ascending=False).drop_duplicates(
            subset=["player_name", "team"], keep="first"
        )
    else:
        df = df.drop_duplicates(subset=["player_name", "team"], keep="first")

    print(f"  {len(df)} unique player rows in CSV")

    # ── Load players from Supabase ────────────────────────────────────────────
    if not args.dry_run:
        print("Fetching players from Supabase …")
        rows = []
        page, page_size = 0, 1000
        while True:
            res = db.table("players").select("id,name,current_team") \
                .range(page * page_size, (page + 1) * page_size - 1).execute()
            rows.extend(res.data)
            if len(res.data) < page_size:
                break
            page += 1
        print(f"  {len(rows)} players in Supabase")

        # Build lookup: (norm_name, norm_team) → id
        lookup = {
            (normalise_name(r["name"]), normalise_name(r["current_team"])): r["id"]
            for r in rows
        }
    else:
        lookup = {}

    # ── Match & update ────────────────────────────────────────────────────────
    updated, skipped = 0, []

    for _, row in df.iterrows():
        name     = str(row["player_name"]).strip()
        team     = str(row["team"]).strip()
        height   = str(row["ht"]).strip()   if pd.notna(row["ht"])   else None
        hometown = str(row["type"]).strip() if pd.notna(row["type"]) else None

        if not height and not hometown:
            continue

        key = (normalise_name(name), normalise_name(team))

        if args.dry_run:
            print(f"  {name} ({team}) → height={height}, hometown={hometown}")
            updated += 1
            continue

        player_id = lookup.get(key)
        if player_id is None:
            skipped.append(f"{name} / {team}")
            continue

        payload = {}
        if height:   payload["height"]   = height
        if hometown: payload["hometown"] = hometown

        try:
            db.table("players").update(payload).eq("id", player_id).execute()
            updated += 1
        except Exception as e:
            print(f"  ✗ DB error for {name}: {e}")

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n✓ {'Would update' if args.dry_run else 'Updated'} {updated} players.")
    if skipped:
        print(f"  {len(skipped)} not matched in Supabase:")
        for s in skipped[:20]:
            print(f"    - {s}")
        if len(skipped) > 20:
            print(f"    … and {len(skipped) - 20} more")


if __name__ == "__main__":
    main()
