"""
update_tags_from_csv.py — Import Shotmaking / Rim/Interior / Defensive tags from CSV
======================================================================================
Reads BeyondThePortal_Backend board CSV and updates players in Supabase with the
three new tag columns: shotmaking_tags, interior_tags, defensive_tags.

Run ONCE after adding the columns via SQL (see below).

SQL to run first in Supabase SQL Editor:
    ALTER TABLE public.players
      ADD COLUMN IF NOT EXISTS shotmaking_tags text,
      ADD COLUMN IF NOT EXISTS interior_tags   text,
      ADD COLUMN IF NOT EXISTS defensive_tags  text;

Usage:
    python update_tags_from_csv.py --csv "BeyondThePortal_Backend - Board_Master(2).csv"
    python update_tags_from_csv.py --csv data/board.csv --dry-run

Environment variables:
    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="your-service-role-key"
"""

import argparse
import csv
import os
import sys

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--csv",     required=True, help="Path to the board CSV file")
    p.add_argument("--dry-run", action="store_true", help="Print updates without writing")
    args = p.parse_args()

    if not os.path.exists(args.csv):
        sys.exit(f"CSV not found: {args.csv}")

    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY, or use --dry-run.")
        db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    with open(args.csv, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    print(f"Loaded {len(rows)} rows from CSV\n")

    ok = fail = skip = 0

    for row in rows:
        name          = row.get("Name", "").strip()
        team          = row.get("Team", "").strip()
        shotmaking    = row.get("Shotmaking",    "").strip()
        interior      = row.get("Rim/Interior",  "").strip()
        defensive     = row.get("Defensive",     "").strip()

        if not name:
            skip += 1
            continue

        # All three are blank → nothing to update
        if not shotmaking and not interior and not defensive:
            skip += 1
            continue

        update_data = {}
        if shotmaking: update_data["shotmaking_tags"] = shotmaking
        if interior:   update_data["interior_tags"]   = interior
        if defensive:  update_data["defensive_tags"]  = defensive

        if args.dry_run:
            print(f"  DRY  {name:<35} | {team:<25} | shot={shotmaking!r} int={interior!r} def={defensive!r}")
            ok += 1
            continue

        # Try exact name + team match first
        res = db.table("players").select("id, name, current_team") \
                .eq("name", name) \
                .execute()

        matches = res.data or []

        # If multiple rows for same name, narrow by team
        if len(matches) > 1:
            team_matches = [m for m in matches if m["current_team"] == team]
            if team_matches:
                matches = team_matches

        if not matches:
            # Fuzzy: try first+last word of name
            parts = name.split()
            if len(parts) >= 2:
                res2 = db.table("players").select("id, name, current_team") \
                          .ilike("name", f"%{parts[0]}%{parts[-1]}%") \
                          .execute()
                matches = res2.data or []

        if not matches:
            print(f"  NOT FOUND  {name} / {team}")
            fail += 1
            continue

        player_id = matches[0]["id"]
        try:
            db.table("players").update(update_data).eq("id", player_id).execute()
            print(f"  ✓  {name:<35} | shot={shotmaking!r} int={interior!r} def={defensive!r}")
            ok += 1
        except Exception as e:
            print(f"  ✗  {name}: {e}")
            fail += 1

    print(f"\nDone: {ok} updated, {fail} failed/not found, {skip} skipped (no tags)")


if __name__ == "__main__":
    main()
