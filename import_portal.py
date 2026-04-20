"""
import_portal.py — Sync transfer portal entries from CBD API → Supabase portal_transfers table
==============================================================================================

Steps to run:
    1. Set environment variables:
           $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
           $env:SUPABASE_SERVICE_KEY="your-service-role-key"
           $env:CBD_API_TOKEN="your-collegebasketballdata-token"

    2. (One-time) Make sure the portal_transfers table exists in Supabase with
       columns: api_id, player_name, player_id, from_team, to_team, season_year, status
       and a UNIQUE constraint on api_id so upserts are safe.

    3. Install dependencies if needed:
           pip install httpx supabase

    4. Run:
           python import_portal.py

    The script will print matched/unmatched counts and upsert all rows.
    Re-running is safe — existing rows are updated via api_id upsert.
"""

import os
import httpx
from supabase import create_client
from match_utils import build_lookup, match_player as mu_match

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]  # needs service role to bypass RLS
API_TOKEN    = os.environ["CBD_API_TOKEN"]          # collegebasketballdata token

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def fetch_portal(year=2026):
    r = httpx.get(
        f"https://api.collegebasketballdata.com/recruiting/portal",
        params={"year": year},
        headers={"Authorization": f"Bearer {API_TOKEN}", "accept": "application/json"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()

def load_players():
    """Pull all players for name+team matching."""
    all_rows, page, PAGE = [], 0, 1000
    while True:
        res = supabase.table("players") \
            .select("id, name, current_team") \
            .range(page * PAGE, (page + 1) * PAGE - 1) \
            .execute()
        all_rows.extend(res.data or [])
        if len(res.data or []) < PAGE:
            break
        page += 1
    return all_rows


def map_status(entry):
    elig = entry.get("eligibility", "Immediate")
    dest = entry.get("destination")
    if elig == "Withdrawn":
        return "withdrawn"
    if dest:
        return "committed"
    return "uncommitted"

def main():
    print("Fetching portal data from API...")
    portal = fetch_portal(2026)
    print(f"  {len(portal)} entries retrieved")

    print("Loading players from Supabase...")
    players = load_players()
    print(f"  {len(players)} players loaded")

    player_lookup = build_lookup(players)

    rows, matched, unmatched_names = [], 0, []
    for entry in portal:
        origin = entry.get("origin") or {}
        dest   = entry.get("destination") or {}
        full_name   = f"{entry['firstName']} {entry['lastName']}"
        origin_team = origin.get("name", "")
        mr          = mu_match(full_name, origin_team, player_lookup)
        player_id   = mr.player_id

        if player_id:
            matched += 1
        else:
            unmatched_names.append(f"{full_name} ({origin_team or '?'})")

        rows.append({
            "api_id":      entry["id"],
            "player_name": full_name,
            "player_id":   player_id,
            "from_team":   origin_team or None,
            "to_team":     dest.get("name") if dest else None,
            "season_year": 2026,
            "status":      map_status(entry),
        })

    print(f"Matched: {matched} / {len(portal)}  |  Unmatched: {len(unmatched_names)}")
    if unmatched_names:
        print("  Unmatched players (no player_id, still inserted):")
        for n in unmatched_names[:20]:
            print(f"    {n}")
        if len(unmatched_names) > 20:
            print(f"    ... and {len(unmatched_names) - 20} more")

    # Upsert in batches — api_id is the unique key so re-runs are safe
    BATCH = 200
    for i in range(0, len(rows), BATCH):
        supabase.table("portal_transfers") \
            .upsert(rows[i:i+BATCH], on_conflict="api_id") \
            .execute()
        print(f"  Upserted rows {i+1}–{min(i+BATCH, len(rows))}")

    print("Done.")

if __name__ == "__main__":
    main()
