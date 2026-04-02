"""
espn_id_lookup.py — Populate espn_id column via ESPN team roster API
=====================================================================
Extracts ESPN team IDs from teamLogos.json, fetches each team's roster
from ESPN, then matches players by name against your Supabase players table.

Much more reliable than search — no API key needed, no broken search endpoint.

Usage:
    python espn_id_lookup.py --dry-run    # preview matches, no DB writes
    python espn_id_lookup.py              # write espn_id to Supabase
    python espn_id_lookup.py --skip-existing  # only fill null espn_id rows

Prerequisites (run once in Supabase SQL Editor):
    ALTER TABLE public.players ADD COLUMN IF NOT EXISTS espn_id text;

Environment variables:
    $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
    $env:SUPABASE_SERVICE_KEY="your-service-role-key"
"""

import argparse
import os
import re
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("Run: pip install requests")

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

ESPN_TEAMS_URL  = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams"
ESPN_ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/{team_id}/roster"
ESPN_HEADERS    = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
REQUEST_DELAY   = 0.4

# DB team name → ESPN display name (only needed when they differ)
TEAM_ALIASES = {
    "FIU":               "Florida International",
    "UConn":             "Connecticut",
    "UMass":             "Massachusetts",
    "USF":               "South Florida",
    "UCSB":              "UC Santa Barbara",
    "UC Riverside":      "UC Riverside",
    "UT Arlington":      "UT Arlington",
    "SIU Edwardsville":  "SIU Edwardsville",
    "SIUE":              "SIU Edwardsville",
    "LIU":               "LIU",
    "UIW":               "Incarnate Word",
    "IUPUI":             "IUPUI",
    "PFW":               "Purdue Fort Wayne",
    "Cal Baptist":       "California Baptist",
    "Louisiana Monroe":  "ULM",
    "Texas A&M-CC":      "Texas A&M-Corpus Christi",
    "Southeast Missouri State": "Southeast Missouri",
    "UMKC":              "Kansas City",
    "CSU Fullerton":     "Cal State Fullerton",
    "CSU Bakersfield":   "Cal State Bakersfield",
    "CSU Northridge":    "Cal State Northridge",
    "Sam Houston":       "Sam Houston",
    "UNC":               "North Carolina",
    "McNeese St.":       "McNeese",
    "Oklahoma St.":      "Oklahoma State",
    "Kansas St.":        "Kansas State",
    "Fresno St.":        "Fresno State",
    "Arizona St.":       "Arizona State",
    "FAU":               "Florida Atlantic",
    "South Dakota St.":  "South Dakota State",
    "South Carolina St.":"South Carolina State",
    "Appalachian St.":   "Appalachian State",
    "Oregon St.":        "Oregon State",
    "San Diego St.":     "San Diego State",
    "North Dakota St.":  "North Dakota State",
    "Mississippi St.":   "Mississippi State",
    "PIttsburgh":        "Pittsburgh",
    "Miami (FL)":        "Miami",
    "St. Joseph's":      "Saint Joseph's",
    "Cal Poly":          "Cal Poly",
    "UT Martin":         "UT Martin",
    "Loyola Maryland":   "Loyola Maryland",
    "UTSA":              "UTSA",
    "Albany":            "UAlbany",
    "San Jose State":    "San José State",
    "Connecticut":       "UConn",
    "Appalachian State": "App State",
    "Appalachian St.":   "App State",
    "Hawaii":            "Hawai'i",
    "St. John's":        "St. John's",
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run",       action="store_true")
    p.add_argument("--skip-existing", action="store_true")
    p.add_argument("--list-unmatched-teams", action="store_true")
    p.add_argument("--debug-teams",   action="store_true", help="Print raw ESPN teams API response and exit")
    return p.parse_args()


def strip_nickname(name):
    """Remove quoted nicknames: 'Hamed "Larry" Olayinka' → 'Hamed Olayinka'"""
    return re.sub(r'\s*["\'].*?["\']\s*', ' ', name).strip()


def normalise(s):
    return re.sub(r'\s+', ' ', str(s).strip().lower())



def load_team_map():
    """
    Returns {name_variant: espn_team_id} by fetching all teams from ESPN.
    Indexes each team by: shortDisplayName, displayName, abbreviation, and location.
    shortDisplayName is typically just the school name (e.g. "Alabama" not "Alabama Crimson Tide").
    """
    team_map = {}
    page = 1
    while True:
        try:
            resp = requests.get(
                ESPN_TEAMS_URL,
                params={"limit": 500, "page": page},
                headers=ESPN_HEADERS,
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"  ESPN teams fetch error (page {page}): {e}")
            break

        sports  = data.get("sports", [])
        leagues = sports[0].get("leagues", []) if sports else []
        teams   = leagues[0].get("teams", []) if leagues else []

        if not teams:
            break

        for entry in teams:
            t   = entry.get("team", {})
            tid = str(t.get("id", ""))
            if not tid:
                continue

            # Index by every useful name variant — first one set wins
            for name in [
                t.get("shortDisplayName", ""),   # e.g. "Alabama"
                t.get("displayName", ""),         # e.g. "Alabama Crimson Tide"
                t.get("name", ""),                # e.g. "Crimson Tide"
                t.get("location", ""),            # e.g. "Alabama"
                t.get("abbreviation", ""),        # e.g. "ALA"
                t.get("nickname", ""),
            ]:
                name = name.strip()
                if name and name not in team_map:
                    team_map[name] = tid

        page_count = data.get("pageCount", 1)
        if page >= page_count:
            break
        page += 1
        time.sleep(0.2)

    return team_map


def fetch_espn_roster(team_id):
    """Fetch ESPN roster for a team. Returns list of {espn_id, name}."""
    url = ESPN_ROSTER_URL.format(team_id=team_id)
    try:
        resp = requests.get(url, headers=ESPN_HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"    roster fetch error (team {team_id}): {e}")
        return []

    players = []
    for athlete in data.get("athletes", []):
        espn_id = str(athlete.get("id", ""))
        name    = athlete.get("displayName", "")
        if espn_id and name:
            players.append({"id": espn_id, "name": name})
    return players


def fetch_all_supabase_players(sb, skip_existing):
    players = []
    page, page_size = 0, 1000
    while True:
        q = sb.table("players").select("id, name, current_team, espn_id") \
              .range(page * page_size, (page + 1) * page_size - 1)
        if skip_existing:
            q = q.is_("espn_id", "null")
        resp = q.execute()
        batch = resp.data or []
        players.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return players


def main():
    args = parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.")

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print("Loading team map from ESPN…")
    team_map = load_team_map()
    print(f"  {len(team_map)} teams loaded from ESPN")

    if args.debug_teams:
        print("\nAll teams ESPN returned:")
        for name, tid in sorted(team_map.items()):
            print(f"  {tid:>6}  {name}")
        return

    print("Fetching players from Supabase…")
    players = fetch_all_supabase_players(sb, skip_existing=False)
    print(f"  {len(players)} players to process")

    # Group players by team so we only fetch each ESPN roster once
    by_team = {}
    for p in players:
        team = p.get("current_team", "") or ""
        by_team.setdefault(team, []).append(p)

    # --list-unmatched-teams: just print teams with no ESPN mapping and exit
    if args.list_unmatched_teams:
        print("\nTeams in DB with no ESPN team ID mapping:")
        missing = sorted(
            [(name, len(ps)) for name, ps in by_team.items()
             if not team_map.get(TEAM_ALIASES.get(name, name))],
            key=lambda x: -x[1]
        )
        for name, count in missing:
            resolved = TEAM_ALIASES.get(name, name)
            print(f"  {count:3d} players  {name!r}  (tried: {resolved!r})")
        print(f"\n{len(missing)} unmatched teams, {sum(c for _,c in missing)} total players affected")
        return

    matched   = 0
    unmatched = 0
    no_team   = 0

    for team_name, team_players in by_team.items():
        resolved     = TEAM_ALIASES.get(team_name, team_name)
        espn_team_id = team_map.get(resolved)
        if not espn_team_id:
            print(f"\n  [skip] No ESPN team ID for: {team_name!r} (tried {resolved!r}) ({len(team_players)} players)")
            no_team += len(team_players)
            continue

        print(f"\n  Fetching ESPN roster for {team_name} (id={espn_team_id})…")
        roster = fetch_espn_roster(espn_team_id)
        time.sleep(REQUEST_DELAY)

        # Build normalised lookup: name → espn_id
        espn_lookup = {normalise(r["name"]): r["id"] for r in roster}

        for p in team_players:
            raw_name      = p.get("name", "")
            clean_name    = strip_nickname(raw_name)
            norm_name     = normalise(clean_name)

            espn_id = espn_lookup.get(norm_name)

            # Fallback: last-name only match if exactly one result
            if not espn_id:
                last = norm_name.split()[-1] if norm_name else ""
                hits = [eid for n, eid in espn_lookup.items() if n.split()[-1] == last]
                if len(hits) == 1:
                    espn_id = hits[0]

            if espn_id:
                print(f"    ✓ {raw_name} → espn_id={espn_id}")
                if not args.dry_run:
                    sb.table("players").update({"espn_id": espn_id}).eq("id", p["id"]).execute()
                matched += 1
            else:
                print(f"    ✗ {raw_name} — not found in ESPN roster")
                unmatched += 1

    print(f"\nDone.")
    print(f"  Matched  : {matched}")
    print(f"  Unmatched: {unmatched}")
    print(f"  No ESPN team: {no_team}")
    if args.dry_run:
        print("  (dry-run — nothing written)")


if __name__ == "__main__":
    main()
