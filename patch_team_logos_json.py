"""
patch_team_logos_json.py — Add missing teams to teamLogos.json
==============================================================
1. Reads all team names from Supabase `teams` table
2. Checks which are missing from src/data/teamLogos.json
3. Matches missing teams against team_espn.csv (run update_team_espn.py first)
4. Writes matches back into the JSON file

Usage:
    python patch_team_logos_json.py --dry-run    # preview, no writes
    python patch_team_logos_json.py              # patch the JSON

Env vars required:
    $env:SUPABASE_URL="https://..."
    $env:SUPABASE_SERVICE_KEY="..."
"""

import argparse, csv, json, os, re, sys

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
JSON_PATH    = "src/data/teamLogos.json"
CSV_PATH     = "team_espn.csv"

ALIASES = {
    "UConn":                    "Connecticut",
    "UMass":                    "Massachusetts",
    "USF":                      "South Florida",
    "FIU":                      "Florida International",
    "UCSB":                     "UC Santa Barbara",
    "LIU":                      "Long Island University",
    "UIW":                      "Incarnate Word",
    "PFW":                      "Purdue Fort Wayne",
    "Cal Baptist":              "California Baptist",
    "Louisiana Monroe":         "ULM",
    "Texas A&M-CC":             "Texas A&M-Corpus Christi",
    "Southeast Missouri State": "Southeast Missouri",
    "Southeast Missouri St.":   "Southeast Missouri State",
    "UMKC":                     "Kansas City",
    "CSU Fullerton":            "Cal State Fullerton",
    "Cal St. Fullerton":        "Cal State Fullerton",
    "CSU Bakersfield":          "Cal State Bakersfield",
    "Cal St. Bakersfield":      "Cal State Bakersfield",
    "CSU Northridge":           "Cal State Northridge",
    "Cal St. Northridge":       "Cal State Northridge",
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
    "Sam Houston":              "Sam Houston",
    "St. John's":               "St. John's",
    "St. Thomas":               "St. Thomas-Minnesota",
    "UT Martin":                "Tennessee-Martin",
    "Tennessee Martin":         "UT Martin",
    "Arkansas Pine Bluff":      "Arkansas-Pine Bluff",
    "Bethune Cookman":          "Bethune-Cookman",
    "Central Connecticut St.":  "Central Connecticut",
    "Delaware St.":             "Delaware State",
    "Gardner Webb":             "Gardner-Webb",
    "Jackson St.":              "Jackson State",
    "Kennesaw St.":             "Kennesaw State",
    "Nebraska Omaha":           "Omaha",
    "Northwestern St.":         "Northwestern State",
    "Portland St.":             "Portland State",
    "Queens":                   "Queens (NC)",
    "SIUE":                     "SIU Edwardsville",
    "San Jose State":           "San José State",
    "Southeastern Louisiana":   "SE Louisiana",
    "Texas A&M Corpus Chris":   "Texas A&M-Corpus Christi",
    "USC Upstate":              "South Carolina Upstate",
    "Wright St.":               "Wright State",
    "Youngstown St.":           "Youngstown State",
    "Mississippi Valley St.":   "Mississippi Valley State",
}


def normalise(s):
    return re.sub(r"\s+", " ", str(s).strip().lower())


def fetch_db_teams(sb):
    rows, page, PAGE = [], 0, 1000
    while True:
        res = sb.table("teams").select("name").range(page * PAGE, (page + 1) * PAGE - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        page += 1
    return [r["name"] for r in rows]


def load_espn_lookup():
    if not os.path.exists(CSV_PATH):
        sys.exit(f"ESPN CSV not found at {CSV_PATH}. Run update_team_espn.py --csv-only first.")
    lookup = {}
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            for variant in [row["display_name"], row["short_name"], row["location"], row["abbreviation"]]:
                key = normalise(variant)
                if key and key not in lookup:
                    lookup[key] = row["logo_url"]
    return lookup


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")

    print("Loading teamLogos.json...")
    with open(JSON_PATH, encoding="utf-8") as f:
        logos = json.load(f)
    print(f"  {len(logos)} entries")

    print("Fetching teams from Supabase...")
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    db_teams = fetch_db_teams(sb)
    print(f"  {len(db_teams)} teams")

    print("Loading ESPN CSV lookup...")
    espn = load_espn_lookup()

    missing     = [t for t in db_teams if t not in logos]
    print(f"\n{len(missing)} teams missing from JSON:")

    added, unmatched = [], []
    for name in sorted(missing):
        resolved  = ALIASES.get(name, name)
        logo_url  = espn.get(normalise(resolved))
        if logo_url:
            print(f"  + {name!r:40s} -> {logo_url}")
            added.append((name, logo_url))
        else:
            print(f"  ? {name!r:40s} (no ESPN match)")
            unmatched.append(name)

    print(f"\nMatched: {len(added)}  |  Still missing: {len(unmatched)}")

    if not args.dry_run and added:
        for name, url in added:
            logos[name] = url
        logos = dict(sorted(logos.items()))
        with open(JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(logos, f, indent=2, ensure_ascii=False)
        print(f"Wrote {JSON_PATH}")
    elif args.dry_run:
        print("(dry-run — JSON not modified)")


if __name__ == "__main__":
    main()
