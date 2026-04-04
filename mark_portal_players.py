"""
mark_portal_players.py — Mark existing players as portal entrants from a CSV
=============================================================================
Reads a CSV with name, team, (optional year) columns, matches each row to a
player in Supabase by name + team, and sets source = 'portal'.

Usage:
    python mark_portal_players.py --csv portal_players.csv
    python mark_portal_players.py --csv portal_players.csv --dry-run

CSV format (header required):
    name,team,year
    Drew Scharnowski,Belmont,Senior
    Aiden Sherrell,Alabama,Junior

Environment variables:
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

# Same alias map as torvik_metrics.py so team names match
TEAM_ALIASES = {
    "alabama st.": "alabama state", "alcorn st.": "alcorn state",
    "appalachian st.": "appalachian state", "arkansas st.": "arkansas state",
    "arizona st.": "arizona state", "ball st.": "ball state",
    "boise st.": "boise state", "chicago st.": "chicago state",
    "cleveland st.": "cleveland state", "colorado st.": "colorado state",
    "coppin st.": "coppin state", "east tennessee st.": "east tennessee state",
    "florida st.": "florida state", "fresno st.": "fresno state",
    "georgia st.": "georgia state", "idaho st.": "idaho state",
    "illinois st.": "illinois state", "indiana st.": "indiana state",
    "iowa st.": "iowa state", "jackson st.": "jackson state",
    "jacksonville st.": "jacksonville state", "kansas st.": "kansas state",
    "kent st.": "kent state", "long beach st.": "long beach state",
    "michigan st.": "michigan state", "mississippi st.": "mississippi state",
    "missouri st.": "missouri state", "montana st.": "montana state",
    "morehead st.": "morehead state", "morgan st.": "morgan state",
    "murray st.": "murray state", "new mexico st.": "new mexico state",
    "norfolk st.": "norfolk state", "north dakota st.": "north dakota state",
    "ohio st.": "ohio state", "oklahoma st.": "oklahoma state",
    "oregon st.": "oregon state", "penn st.": "penn state",
    "sacramento st.": "sacramento state", "sam houston st.": "sam houston",
    "san diego st.": "san diego state", "san jose st.": "san jose state",
    "tennessee st.": "tennessee state", "texas st.": "texas state",
    "utah st.": "utah state", "washington st.": "washington state",
    "weber st.": "weber state", "wichita st.": "wichita state",
    "n.c. state": "nc state", "mississippi": "ole miss",
    "illinois chicago": "uic", "uconn": "connecticut",
}


def normalise(s):
    return str(s).strip().lower()


def normalise_team(s):
    n = normalise(s)
    return TEAM_ALIASES.get(n, n)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--csv",     required=True, help="Path to portal players CSV")
    p.add_argument("--dry-run", action="store_true", help="Preview matches, no DB writes")
    p.add_argument("--unmark",  action="store_true", help="Remove portal source (set to 'program') instead of marking")
    return p.parse_args()


def main():
    args = parse_args()

    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars, or use --dry-run.")
        db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # ── Load CSV ──────────────────────────────────────────────────────────────
    try:
        df = pd.read_csv(args.csv)
    except FileNotFoundError:
        sys.exit(f"CSV not found: {args.csv}")

    if "name" not in df.columns or "team" not in df.columns:
        sys.exit("CSV must have at least 'name' and 'team' columns.")

    print(f"Loaded {len(df)} rows from {args.csv}")

    # ── Fetch all players from Supabase ───────────────────────────────────────
    if not args.dry_run:
        print("Fetching players from Supabase…")
        players, page, page_size = [], 0, 1000
        while True:
            res = db.table("players").select("id, name, current_team, year, source") \
                    .range(page * page_size, (page + 1) * page_size - 1).execute()
            players.extend(res.data or [])
            if len(res.data or []) < page_size:
                break
            page += 1
        print(f"  {len(players)} players in Supabase")

        # Build lookup: (norm_name, norm_team) → player record
        lookup = {
            (normalise(p["name"]), normalise_team(p.get("current_team", ""))): p
            for p in players
        }
    else:
        lookup = {}

    # ── Process each CSV row ──────────────────────────────────────────────────
    new_source = "program" if args.unmark else "portal"
    matched   = 0
    unmatched = 0

    for _, row in df.iterrows():
        name = str(row.get("name", "")).strip()
        team = str(row.get("team", "")).strip()
        year = str(row.get("year", "")).strip() if "year" in df.columns else ""

        key = (normalise(name), normalise_team(team))

        if args.dry_run:
            print(f"  would mark: {name} ({team}) {year} → source='{new_source}'")
            matched += 1
            continue

        player = lookup.get(key)
        if not player:
            print(f"  ✗ NOT FOUND: {name} ({team})")
            unmatched += 1
            continue

        if player.get("source") == new_source:
            print(f"  — already '{new_source}': {name} ({team})")
            matched += 1
            continue

        db.table("players").update({"source": new_source}).eq("id", player["id"]).execute()
        print(f"  ✓ {name} ({team}) {year} → source='{new_source}'")
        matched += 1

    print(f"\nDone. Matched: {matched} | Not found: {unmatched}")
    if args.dry_run:
        print("(dry-run — nothing written)")


if __name__ == "__main__":
    main()
