import os
import httpx
from supabase import create_client

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

def build_indexes(players):
    by_nameteam = {}
    for p in players:
        key = (
            p["name"].lower().strip(),
            (p["current_team"] or "").lower().strip(),
        )
        by_nameteam[key] = p
    return by_nameteam

def match_player(entry, by_nameteam):
    # Match by full name + origin school (sourceId is 247 Sports ID — not stored in players table)
    origin = (entry.get("origin") or {}).get("name", "")
    name   = f"{entry['firstName']} {entry['lastName']}"
    return by_nameteam.get((name.lower().strip(), origin.lower().strip()))

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

    by_nameteam = build_indexes(players)

    rows, matched, unmatched_names = [], 0, []
    for entry in portal:
        origin = entry.get("origin") or {}
        dest   = entry.get("destination") or {}
        full_name = f"{entry['firstName']} {entry['lastName']}"
        mp = match_player(entry, by_nameteam)

        if mp:
            matched += 1
        else:
            unmatched_names.append(f"{full_name} ({origin.get('name', '?')})")

        rows.append({
            "api_id":      entry["id"],
            "player_name": full_name,
            "player_id":        mp["id"] if mp else None,
            "from_team":   origin.get("name"),
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
