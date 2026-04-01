"""
merge_duplicate_players.py — Merge portal + program duplicate player rows
=========================================================================
For each (name, current_team) pair that has both a source=portal and
source=program row, this script:

  1. Keeps the portal row UUID as canonical (it has market values)
  2. Copies height, hometown, espn_id, and tag columns from the program row
     into the portal row (only if the portal row is missing them)
  3. Repoints team_players and saved_roster_players FKs from program UUID
     → portal UUID
  4. Deletes the program row's player_stats entry (portal row keeps its own)
  5. Deletes the program row

Usage:
    python merge_duplicate_players.py --dry-run    # preview only
    python merge_duplicate_players.py              # write changes

Environment variables:
    $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
    $env:SUPABASE_SERVICE_KEY="your-service-role-key"
"""

import argparse
import os
import sys

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Tag columns to copy from program → portal if portal is missing them
TAG_COLS = ["playmaker_tags", "shooting_tags", "shotmaking_tags",
            "defensive_tags", "interior_tags"]

# Columns to copy from program → portal if portal value is null/empty
COPY_IF_MISSING = ["height", "hometown", "espn_id"] + TAG_COLS


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true",
                   help="Print what would happen without writing anything")
    return p.parse_args()


def fetch_all_players(sb):
    """Fetch all players in pages."""
    players = []
    page, page_size = 0, 1000
    while True:
        resp = sb.table("players") \
                 .select("id, name, current_team, source, height, hometown, "
                         "espn_id, playmaker_tags, shooting_tags, "
                         "shotmaking_tags, defensive_tags, interior_tags, "
                         "open_market_low, open_market_high") \
                 .range(page * page_size, (page + 1) * page_size - 1) \
                 .execute()
        batch = resp.data or []
        players.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return players


def find_pairs(players):
    """Return list of (portal_row, program_row) for each matched duplicate."""
    portal  = {(p["name"], p["current_team"]): p for p in players if p["source"] == "portal"}
    program = {(p["name"], p["current_team"]): p for p in players if p["source"] == "program"}

    pairs = []
    for key in portal:
        if key in program:
            pairs.append((portal[key], program[key]))
    return pairs


def merge_pair(sb, portal, program, dry_run):
    name = portal["name"]
    team = portal["current_team"]
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Merging: {name} ({team})")
    print(f"  Keep portal UUID : {portal['id']}")
    print(f"  Drop program UUID: {program['id']}")

    # 1. Build patch: copy missing fields from program → portal
    patch = {}
    for col in COPY_IF_MISSING:
        portal_val  = portal.get(col)
        program_val = program.get(col)
        if not portal_val and program_val:
            patch[col] = program_val
            print(f"  Copy {col}: {program_val!r}")

    if patch:
        if not dry_run:
            sb.table("players").update(patch).eq("id", portal["id"]).execute()
        print(f"  → Patched portal row with {list(patch.keys())}")
    else:
        print("  → Portal row already has all fields, nothing to copy")

    # 2. Repoint team_players
    resp = sb.table("team_players").select("id").eq("player_id", program["id"]).execute()
    tp_rows = resp.data or []
    if tp_rows:
        print(f"  Repointing {len(tp_rows)} team_players row(s)")
        if not dry_run:
            sb.table("team_players").update({"player_id": portal["id"]}) \
              .eq("player_id", program["id"]).execute()
    else:
        print("  No team_players rows to repoint")

    # 3. Repoint saved_roster_players
    resp = sb.table("saved_roster_players").select("id").eq("player_id", program["id"]).execute()
    srp_rows = resp.data or []
    if srp_rows:
        print(f"  Repointing {len(srp_rows)} saved_roster_players row(s)")
        if not dry_run:
            sb.table("saved_roster_players").update({"player_id": portal["id"]}) \
              .eq("player_id", program["id"]).execute()
    else:
        print("  No saved_roster_players rows to repoint")

    # 4. Delete program row's player_stats
    resp = sb.table("player_stats").select("id").eq("player_id", program["id"]).execute()
    ps_rows = resp.data or []
    if ps_rows:
        print(f"  Deleting {len(ps_rows)} player_stats row(s) for program UUID")
        if not dry_run:
            sb.table("player_stats").delete().eq("player_id", program["id"]).execute()
    else:
        print("  No player_stats rows to delete for program UUID")

    # 5. Delete the program player row
    print(f"  Deleting program player row {program['id']}")
    if not dry_run:
        sb.table("players").delete().eq("id", program["id"]).execute()


def main():
    args = parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.")

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print("Fetching all players…")
    players = fetch_all_players(sb)
    print(f"  {len(players)} total players")

    pairs = find_pairs(players)
    print(f"  {len(pairs)} duplicate pair(s) found")

    if not pairs:
        print("Nothing to merge.")
        return

    for portal, program in pairs:
        merge_pair(sb, portal, program, args.dry_run)

    print(f"\n{'DRY RUN complete — nothing written.' if args.dry_run else f'Done. Merged {len(pairs)} pair(s).'}")


if __name__ == "__main__":
    main()
