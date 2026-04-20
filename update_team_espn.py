"""
update_team_espn.py — Populate espn_id + logo_url on the teams table
=====================================================================
Fetches every men's college basketball team from ESPN's public API,
matches each one to a row in your Supabase `teams` table by name,
and writes espn_id + logo_url back.

Also writes a CSV (team_espn.csv) of everything ESPN returned so you
can inspect coverage and manually fix any mismatches.

Usage:
    python update_team_espn.py --dry-run     # preview matches, no DB writes
    python update_team_espn.py               # write to Supabase
    python update_team_espn.py --csv-only    # just dump the CSV, skip Supabase

Prerequisites — run once in Supabase SQL Editor:
    ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS espn_id   text;
    ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS logo_url  text;

Environment variables:
    $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
    $env:SUPABASE_SERVICE_KEY="your-service-role-key"
"""

import argparse
import csv
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

ESPN_TEAMS_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball"
    "/mens-college-basketball/teams"
)
ESPN_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/120 Safari/537.36"
    )
}
CSV_OUT = "team_espn.csv"

# DB team name → ESPN displayName (add entries here when names don't match)
ALIASES = {
    "UConn":                    "Connecticut",
    "UMass":                    "Massachusetts",
    "USF":                      "South Florida",
    "FIU":                      "Florida International",
    "UCSB":                     "UC Santa Barbara",
    "UT Arlington":             "UT Arlington",
    "SIU Edwardsville":         "SIU-Edwardsville",
    "SIUE":                     "SIU-Edwardsville",
    "LIU":                      "Long Island University",
    "UIW":                      "Incarnate Word",
    "IUPUI":                    "IUPUI",
    "PFW":                      "Purdue Fort Wayne",
    "Cal Baptist":              "California Baptist",
    "Louisiana Monroe":         "ULM",
    "Texas A&M-CC":             "Texas A&M-Corpus Christi",
    "Southeast Missouri State": "Southeast Missouri",
    "UMKC":                     "Kansas City",
    "CSU Fullerton":            "Cal State Fullerton",
    "CSU Bakersfield":          "Cal State Bakersfield",
    "CSU Northridge":           "Cal State Northridge",
    "UNC":                      "North Carolina",
    "McNeese St.":              "McNeese",
    "Oklahoma St.":             "Oklahoma State",
    "Kansas St.":               "Kansas State",
    "Fresno St.":               "Fresno State",
    "Arizona St.":              "Arizona State",
    "FAU":                      "Florida Atlantic",
    "South Dakota St.":         "South Dakota State",
    "South Carolina St.":       "South Carolina State",
    "Appalachian St.":          "App State",
    "Appalachian State":        "App State",
    "Oregon St.":               "Oregon State",
    "San Diego St.":            "San Diego State",
    "North Dakota St.":         "North Dakota State",
    "Mississippi St.":          "Mississippi State",
    "Miami (FL)":               "Miami",
    "St. Joseph's":             "Saint Joseph's",
    "Albany":                   "UAlbany",
    "Hawaii":                   "Hawai'i",
    "Connecticut":              "UConn",
    "Sam Houston":              "Sam Houston State",
    "St. John's":               "St. John's (NY)",
    "St. Thomas":               "St. Thomas (MN)",
    "UT Martin":                "Tennessee-Martin",
}


def normalise(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower())


def fetch_all_espn_teams() -> list[dict]:
    """Return list of dicts: {espn_id, display_name, short_name, abbr, logo_url}"""
    teams = []
    page  = 1
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
            print(f"  ESPN fetch error (page {page}): {e}")
            break

        sports  = data.get("sports", [])
        leagues = sports[0].get("leagues", []) if sports else []
        entries = leagues[0].get("teams", []) if leagues else []
        if not entries:
            break

        for entry in entries:
            t = entry.get("team", {})
            espn_id = str(t.get("id", "")).strip()
            if not espn_id:
                continue
            logos = t.get("logos", [])
            # Prefer the largest logo (ESPN returns them in order; first is usually largest)
            logo_url = logos[0].get("href", "") if logos else ""
            teams.append({
                "espn_id":      espn_id,
                "display_name": t.get("displayName", "").strip(),
                "short_name":   t.get("shortDisplayName", "").strip(),
                "location":     t.get("location", "").strip(),
                "abbreviation": t.get("abbreviation", "").strip(),
                "logo_url":     logo_url,
            })

        page_count = data.get("pageCount", 1)
        if page >= page_count:
            break
        page += 1
        time.sleep(0.2)

    return teams


def build_lookup(espn_teams: list[dict]) -> dict[str, dict]:
    """
    Returns {normalised_name: team_dict} indexed by every name variant.
    Earlier entries take precedence (display_name is most reliable).
    """
    lookup: dict[str, dict] = {}
    for t in espn_teams:
        for variant in [
            t["display_name"],
            t["short_name"],
            t["location"],
            t["abbreviation"],
        ]:
            key = normalise(variant)
            if key and key not in lookup:
                lookup[key] = t
    return lookup


def fetch_db_teams(sb) -> list[dict]:
    rows, page, PAGE = [], 0, 1000
    while True:
        res = sb.table("teams").select("id, name, espn_id, logo_url") \
                .range(page * PAGE, (page + 1) * PAGE - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        page += 1
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",  action="store_true", help="Preview matches, no DB writes")
    parser.add_argument("--csv-only", action="store_true", help="Dump CSV and exit, skip Supabase")
    args = parser.parse_args()

    print("Fetching all teams from ESPN…")
    espn_teams = fetch_all_espn_teams()
    print(f"  {len(espn_teams)} teams returned by ESPN")

    # Write CSV regardless of mode — always useful to have
    with open(CSV_OUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["espn_id", "display_name", "short_name", "location", "abbreviation", "logo_url"])
        writer.writeheader()
        writer.writerows(espn_teams)
    print(f"  CSV written → {CSV_OUT}")

    if args.csv_only:
        return

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.")

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print("\nFetching teams from Supabase…")
    db_teams = fetch_db_teams(sb)
    print(f"  {len(db_teams)} teams in DB")

    lookup = build_lookup(espn_teams)

    matched   = 0
    unmatched = []

    for row in db_teams:
        db_name  = row.get("name", "") or ""
        resolved = ALIASES.get(db_name, db_name)
        team     = lookup.get(normalise(resolved))

        if not team:
            unmatched.append(db_name)
            continue

        print(f"  ✓ {db_name!r:40s} → espn_id={team['espn_id']}  {team['display_name']}")
        if not args.dry_run:
            sb.table("teams").update({
                "espn_id":  team["espn_id"],
                "logo_url": team["logo_url"],
            }).eq("id", row["id"]).execute()
        matched += 1

    print(f"\nMatched  : {matched}")
    print(f"Unmatched: {len(unmatched)}")
    if unmatched:
        print("  Teams with no ESPN match (add to ALIASES if needed):")
        for name in sorted(unmatched):
            print(f"    {name!r}")
    if args.dry_run:
        print("\n(dry-run — nothing written to Supabase)")


if __name__ == "__main__":
    main()
