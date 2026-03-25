"""
generate_team_codes.py — Generate per-team access codes for the app
====================================================================
Creates two files:
  data/team_codes.json   — shipped with the app (hashed codes only, safe to publish)
  private/team_codes_PRIVATE.csv — YOUR copy with plaintext codes (never commit this)

Usage:
    python generate_team_codes.py

    # Regenerate codes for specific teams only (keeps existing codes for others)
    python generate_team_codes.py --teams "Duke" "Kentucky"

    # Use a custom code format (default: TEAMNAME + random 4-digit suffix)
    python generate_team_codes.py --format slug   # e.g. DUKE-7423
    python generate_team_codes.py --format word   # e.g. DUKE-TIGER-42

The JSON shipped with the app looks like:
    {
      "Duke":    { "hash": "sha256:abc123...", "season": "2025-26" },
      "Rutgers": { "hash": "sha256:def456...", "season": "2025-26" },
      ...
    }

The app hashes whatever the coach types and compares to the stored hash.
Codes are never stored in plaintext in the app — keep private/team_codes_PRIVATE.csv secure.
"""

import argparse
import csv
import hashlib
import json
import os
import random
import re
import string
import datetime

# Season label shown in the app
_now = datetime.date.today()
SEASON = f"{_now.year}-{str(_now.year + 1)[-2:]}" if _now.month >= 10 \
    else f"{_now.year - 1}-{str(_now.year)[-2:]}"

# All D1 teams — must match roster_scraper.py TEAMS keys
TEAMS = [
    "Abilene Christian", "Air Force", "Akron", "Alabama", "Alabama A&M",
    "Alabama State", "Albany", "Alcorn State", "American", "Appalachian State",
    "Arizona", "Arizona State", "Arkansas", "Arkansas-Pine Bluff", "Arkansas State",
    "Army", "Auburn", "Austin Peay", "Ball State", "Baylor", "Bellarmine",
    "Belmont", "Bethune-Cookman", "Boise State", "Boston College", "Boston University",
    "Bowling Green", "Bradley", "Brown", "Bryant", "Bucknell", "Buffalo", "Butler",
    "BYU", "Cal Baptist", "Cal Poly", "Cal State Bakersfield", "Cal State Fullerton",
    "Cal State Northridge", "California", "Campbell", "Canisius", "Central Arkansas",
    "Central Connecticut", "Central Michigan", "Charleston", "Charlotte", "Chattanooga",
    "Chicago State", "Cincinnati", "Clemson", "Cleveland State", "Coastal Carolina",
    "Colgate", "Colorado", "Colorado State", "Columbia", "Connecticut", "Coppin State",
    "Cornell", "Creighton", "Dartmouth", "Davidson", "Dayton", "Delaware",
    "Delaware State", "Denver", "DePaul", "Detroit Mercy", "Drake", "Drexel",
    "Duke", "Duquesne", "East Carolina", "East Tennessee State", "Eastern Illinois",
    "Eastern Kentucky", "Eastern Michigan", "Eastern Washington", "Elon", "Evansville",
    "Fairfield", "Fairleigh Dickinson", "FIU", "Florida", "Florida A&M",
    "Florida Atlantic", "Florida Gulf Coast", "Florida State", "Fordham", "Fresno State",
    "Furman", "Gardner-Webb", "George Mason", "George Washington", "Georgetown",
    "Georgia", "Georgia Southern", "Georgia State", "Georgia Tech", "Gonzaga",
    "Grambling", "Grand Canyon", "Green Bay", "Hampton", "Hartford", "Harvard",
    "Hawaii", "High Point", "Hofstra", "Holy Cross", "Houston", "Houston Christian",
    "Howard", "Idaho", "Idaho State", "Illinois", "Illinois State", "Incarnate Word",
    "Indiana", "Indiana State", "Iona", "Iowa", "Iowa State", "Jackson State",
    "Jacksonville", "Jacksonville State", "James Madison", "Kansas", "Kansas State",
    "Kennesaw State", "Kent State", "Kentucky", "La Salle", "Lafayette", "Lamar",
    "Lehigh", "Liberty", "Lindenwood", "Lipscomb", "Little Rock", "Long Beach State",
    "Long Island", "Longwood", "Louisiana", "Louisiana Tech", "Louisville",
    "Loyola Chicago", "Loyola Maryland", "Loyola Marymount", "LSU", "Maine",
    "Manhattan", "Marist", "Marquette", "Marshall", "Maryland", "Maryland-Eastern Shore",
    "Massachusetts", "McNeese", "Memphis", "Mercer", "Miami", "Miami (OH)",
    "Michigan", "Michigan State", "Middle Tennessee", "Milwaukee", "Minnesota",
    "Mississippi State", "Mississippi Valley", "Missouri", "Missouri State", "Monmouth",
    "Montana", "Montana State", "Morehead State", "Morgan State", "Mount St. Mary's",
    "Murray State", "Navy", "Nebraska", "Nevada", "New Hampshire", "New Mexico",
    "New Mexico State", "New Orleans", "Niagara", "Nicholls", "NJIT", "Norfolk State",
    "North Alabama", "North Carolina", "North Carolina A&T", "North Carolina Central",
    "NC State", "North Dakota", "North Dakota State", "North Florida", "North Texas",
    "Northeastern", "Northern Arizona", "Northern Colorado", "Northern Illinois",
    "Northern Iowa", "Northern Kentucky", "Northwestern", "Northwestern State",
    "Notre Dame", "Oakland", "Ohio", "Ohio State", "Oklahoma", "Oklahoma State",
    "Old Dominion", "Ole Miss", "Omaha", "Oregon", "Oregon State", "Pacific",
    "Penn", "Penn State", "Pepperdine", "Pittsburgh", "Portland", "Portland State",
    "Prairie View A&M", "Presbyterian", "Princeton", "Providence", "Purdue",
    "Purdue Fort Wayne", "Quinnipiac", "Radford", "Rhode Island", "Rice", "Richmond",
    "Rider", "Robert Morris", "Rutgers", "Sacramento State", "Saint Francis",
    "Saint Joseph's", "Saint Louis", "Saint Mary's", "Saint Peter's", "Sam Houston",
    "Samford", "San Diego", "San Diego State", "San Francisco", "San Jose State",
    "Seton Hall", "Siena", "SMU", "South Alabama", "South Carolina",
    "South Carolina State", "South Dakota", "South Dakota State", "South Florida",
    "Southeast Missouri", "Southeastern Louisiana", "Southern", "Southern Illinois",
    "Southern Miss", "Southern Utah", "St. Bonaventure", "St. John's", "Stanford",
    "Stephen F. Austin", "Stetson", "Stony Brook", "Syracuse", "TCU", "Temple",
    "Tennessee", "Tennessee State", "Tennessee Tech", "Texas", "Texas A&M",
    "Texas A&M-Corpus Christi", "Texas Southern", "Texas State", "Texas Tech",
    "The Citadel", "Toledo", "Towson", "Troy", "Tulane", "Tulsa", "UAB",
    "UC Davis", "UC Irvine", "UC Riverside", "UC San Diego", "UCF", "UCLA",
    "UIC", "UL Monroe", "UMass Lowell", "UMBC", "UNC Asheville", "UNC Greensboro",
    "UNC Wilmington", "UNLV", "USC", "USC Upstate", "UT Arlington", "UT Martin",
    "UTEP", "UTSA", "Utah", "Utah State", "Utah Tech", "Utah Valley",
    "Valparaiso", "VCU", "Vermont", "Villanova", "Virginia", "Virginia Tech",
    "VMI", "Wagner", "Wake Forest", "Washington", "Washington State", "Weber State",
    "West Virginia", "Western Carolina", "Western Illinois", "Western Kentucky",
    "Western Michigan", "Wichita State", "William & Mary", "Winthrop", "Wisconsin",
    "Wofford", "Wright State", "Wyoming", "Xavier", "Yale", "Youngstown State",
]

def make_slug(name):
    """Convert team name to a short uppercase slug for use in codes."""
    # Remove punctuation, take first word or abbreviation
    clean = re.sub(r"[^A-Za-z0-9\s]", "", name).upper()
    words = clean.split()
    if len(words) == 1:
        return words[0][:8]
    # Acronym for multi-word names longer than 2 words
    if len(words) >= 3:
        return "".join(w[0] for w in words)
    return words[0][:6] + words[1][0]

def make_code_default(team_name):
    slug   = make_slug(team_name)
    suffix = str(random.randint(1000, 9999))
    return f"{slug}-{suffix}"

def make_code_word(team_name):
    words = ["EAGLE", "TIGER", "WOLF", "HAWK", "BEAR", "LION", "BULL",
             "STORM", "BLAZE", "RIDGE", "PEAK", "FORGE", "SWIFT", "IRON"]
    slug   = make_slug(team_name)
    word   = random.choice(words)
    suffix = str(random.randint(10, 99))
    return f"{slug}-{word}-{suffix}"

def hash_code(code):
    return "sha256:" + hashlib.sha256(code.strip().upper().encode()).hexdigest()

def load_existing_json(path):
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def load_existing_private(path):
    """Return dict of team -> plaintext code from private CSV."""
    if not os.path.exists(path):
        return {}
    codes = {}
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            codes[row["Team"]] = row["Code"]
    return codes

def parse_args():
    p = argparse.ArgumentParser(description="Generate per-team access codes")
    p.add_argument("--teams",  nargs="+", help="Specific teams to (re)generate codes for")
    p.add_argument("--format", choices=["default", "word"], default="default",
                   help="Code style (default: SLUG-1234, word: SLUG-WORD-12)")
    p.add_argument("--json-out",    default="data/team_codes.json",
                   help="Output path for hashed codes (safe to publish)")
    p.add_argument("--private-out", default="private/team_codes_PRIVATE.csv",
                   help="Output path for plaintext codes (KEEP PRIVATE)")
    return p.parse_args()

def main():
    args = parse_args()
    os.makedirs("data", exist_ok=True)
    os.makedirs("private", exist_ok=True)

    # Load what already exists so we don't rotate codes unnecessarily
    existing_json    = load_existing_json(args.json_out)
    existing_private = load_existing_private(args.private_out)

    teams_to_process = args.teams if args.teams else TEAMS
    unknown = [t for t in teams_to_process if t not in TEAMS]
    if unknown:
        print(f"⚠  Unknown teams: {unknown}")
        teams_to_process = [t for t in teams_to_process if t in TEAMS]

    code_fn = make_code_word if args.format == "word" else make_code_default

    # Build full output dicts (keep existing, add/replace requested)
    all_json    = dict(existing_json)
    all_private = dict(existing_private)

    for team in teams_to_process:
        if team in existing_private and team not in (args.teams or []):
            # Keep existing code unless explicitly regenerating
            continue
        code = code_fn(team)
        all_json[team]    = {"hash": hash_code(code), "season": SEASON}
        all_private[team] = code
        print(f"  {team:40s}  {code}")

    # Write hashed JSON (safe to ship with the app)
    with open(args.json_out, "w", encoding="utf-8") as f:
        json.dump(all_json, f, indent=2, sort_keys=True)

    # Write private plaintext CSV
    with open(args.private_out, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Team", "Code", "Season"])
        for team in sorted(all_private):
            writer.writerow([team, all_private[team], all_json.get(team, {}).get("season", SEASON)])

    print(f"\n✓ Hashed codes  → {args.json_out}  (safe to commit)")
    print(f"✓ Plaintext codes → {args.private_out}  (DO NOT COMMIT — send to coaches directly)")
    print(f"\nSeason: {SEASON}")
    print(f"Total teams: {len(all_json)}")

if __name__ == "__main__":
    main()
