"""
import_portal.py — Sync transfer portal entries from CBD API → Supabase players table
=======================================================================================

Steps to run:
    1. Set environment variables:
           $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
           $env:SUPABASE_SERVICE_KEY="your-service-role-key"
           $env:CBD_API_TOKEN="your-collegebasketballdata-token"

    2. Install dependencies if needed:
           pip install httpx supabase

    3. Run:
           python import_portal.py

    The script will print matched/unmatched counts, then:
      - For a matched player: updates transfer_status/transfer_from_team/
        transfer_to_team/transfer_season_year/transfer_api_id on their
        existing `players` row, keyed by player id. player_status is only
        set to "transferring" if it's currently null or already
        "transferring" — an existing manually-set status (graduating,
        declared, returning) is never overwritten by this sync.
      - For an unmatched player: inserts a new minimal `players` row
        (name, current_team, player_status="transferring",
        source="portal_sync") carrying the transfer_* fields, upserted on
        transfer_api_id so re-running doesn't create duplicates.

    Re-running is safe — matched rows are plain updates-by-id (idempotent),
    unmatched/new rows upsert on transfer_api_id.
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
    """Pull all players for name+team matching, plus current player_status
    so we know whether it's safe to auto-set to 'transferring'."""
    all_rows, page, PAGE = [], 0, 1000
    while True:
        res = supabase.table("players") \
            .select("id, name, current_team, player_status") \
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

    player_lookup   = build_lookup(players)
    status_by_id    = {p["id"]: p.get("player_status") for p in players}

    matched, unmatched_names = 0, []
    new_rows = []
    updated = 0

    for entry in portal:
        origin = entry.get("origin") or {}
        dest   = entry.get("destination") or {}
        full_name   = f"{entry['firstName']} {entry['lastName']}"
        origin_team = origin.get("name", "")
        to_team     = dest.get("name") if dest else None
        transfer_status = map_status(entry)

        mr        = mu_match(full_name, origin_team, player_lookup)
        player_id = mr.player_id

        if player_id:
            matched += 1
            current_status = status_by_id.get(player_id)
            new_player_status = "transferring" if current_status in (None, "transferring") else current_status

            update = {"player_status": new_player_status}
            # Only write transfer detail when the player is actually ending up
            # "transferring" — writing it regardless (even when an existing
            # status like "declared" or "graduating" wins) leaves stale
            # transfer_status/transfer_to_team on players who aren't in the
            # portal, which board/rankings pages would otherwise still show.
            if new_player_status == "transferring":
                update.update({
                    "transfer_status":      transfer_status,
                    "transfer_from_team":   origin_team or None,
                    "transfer_to_team":     to_team,
                    "transfer_season_year": 2026,
                    "transfer_api_id":      entry["id"],
                })
            supabase.table("players").update(update).eq("id", player_id).execute()
            updated += 1
        else:
            unmatched_names.append(f"{full_name} ({origin_team or '?'})")
            new_rows.append({
                "name":                 full_name,
                "current_team":         origin_team or None,
                "player_status":        "transferring",
                "source":               "portal_sync",
                "transfer_status":      transfer_status,
                "transfer_from_team":   origin_team or None,
                "transfer_to_team":     to_team,
                "transfer_season_year": 2026,
                "transfer_api_id":      entry["id"],
            })

    print(f"Matched: {matched} / {len(portal)}  |  Unmatched: {len(unmatched_names)}")
    if unmatched_names:
        print("  Unmatched players (new players row will be created):")
        for n in unmatched_names[:20]:
            print(f"    {n}")
        if len(unmatched_names) > 20:
            print(f"    ... and {len(unmatched_names) - 20} more")

    if new_rows:
        BATCH = 200
        for i in range(0, len(new_rows), BATCH):
            supabase.table("players") \
                .upsert(new_rows[i:i+BATCH], on_conflict="transfer_api_id") \
                .execute()
            print(f"  Inserted/updated new rows {i+1}–{min(i+BATCH, len(new_rows))}")

    print(f"Done. {updated} existing players updated, {len(new_rows)} new players created.")

if __name__ == "__main__":
    main()
