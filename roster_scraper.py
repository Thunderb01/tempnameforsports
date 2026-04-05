"""
roster_scraper.py — Scrape every D1 team roster → data/all_rosters.csv
=======================================================================
Builds the master roster CSV that the app ships with. Run this once
per season (or when you onboard a new program).

How it works:
  1. For each team in TEAMS (or a subset via --teams), fetch the BBRef
     roster page to get individual player URLs.
  2. For each player URL, scrape their stats page (same logic as scraper.py).
  3. Write everything to data/all_rosters.csv with a Team column.

Usage:
    # Scrape all teams in the default list (slow — ~4s per player request)
    python roster_scraper.py

    # Scrape specific teams only (good for testing / adding new programs)
    python roster_scraper.py --teams "Duke" "Kentucky" "Rutgers"

    # Resume after an interruption (skips teams already in the output CSV)
    python roster_scraper.py --resume

    # Override output path
    python roster_scraper.py --output data/all_rosters.csv

    # Override season year (default: current season)
    python roster_scraper.py --year 2026

Setup:
    pip install requests pandas lxml beautifulsoup4
"""

import argparse
import csv
import math
import os
import re
import sys
import time
from io import StringIO

try:
    import requests
    import pandas as pd
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Missing dependencies. Run:  pip install requests pandas lxml beautifulsoup4")

# ── Season ─────────────────────────────────────────────────────────────────────

import datetime
_now = datetime.date.today()
DEFAULT_YEAR = _now.year + 1 if _now.month >= 10 else _now.year  # Oct+ → next season

# ── D1 Teams → BBRef slugs ─────────────────────────────────────────────────────
# Add or correct slugs here. The slug is the path segment in BBRef URLs:
#   https://www.sports-reference.com/cbb/schools/{SLUG}/men/{YEAR}.html

TEAMS = {
    "Abilene Christian":      "abilene-christian",
    "Air Force":              "air-force",
    "Akron":                  "akron",
    "Alabama":                "alabama",
    "Alabama A&M":            "alabama-am",
    "Alabama State":          "alabama-state",
    "Albany":                 "albany-ny",
    "Alcorn State":           "alcorn-state",
    "American":               "american",
    "Appalachian State":      "appalachian-state",
    "Arizona":                "arizona",
    "Arizona State":          "arizona-state",
    "Arkansas":               "arkansas",
    "Arkansas-Pine Bluff":    "arkansas-pine-bluff",
    "Arkansas State":         "arkansas-state",
    "Army":                   "army",
    "Auburn":                 "auburn",
    "Austin Peay":            "austin-peay",
    "Ball State":             "ball-state",
    "Baylor":                 "baylor",
    "Bellarmine":             "bellarmine",
    "Belmont":                "belmont",
    "Bethune-Cookman":        "bethune-cookman",
    "Boise State":            "boise-state",
    "Boston College":         "boston-college",
    "Boston University":      "boston-university",
    "Bowling Green":          "bowling-green",
    "Bradley":                "bradley",
    "Brown":                  "brown",
    "Bryant":                 "bryant",
    "Bucknell":               "bucknell",
    "Buffalo":                "buffalo",
    "Butler":                 "butler",
    "BYU":                    "brigham-young",
    "Cal Baptist":            "california-baptist",
    "Cal Poly":               "cal-poly",
    "Cal State Bakersfield":  "california-state-bakersfield",
    "Cal State Fullerton":    "cal-state-fullerton",
    "Cal State Northridge":   "cal-state-northridge",
    "California":             "california",
    "Campbell":               "campbell",
    "Canisius":               "canisius",
    "Central Arkansas":       "central-arkansas",
    "Central Connecticut St.":    "central-connecticut-state",
    "Central Michigan":       "central-michigan",
    "Charleston":             "charleston",
    "Charlotte":              "charlotte",
    "Chattanooga":            "chattanooga",
    "Chicago State":          "chicago-state",
    "Cincinnati":             "cincinnati",
    "Clemson":                "clemson",
    "Cleveland State":        "cleveland-state",
    "Coastal Carolina":       "coastal-carolina",
    "Colgate":                "colgate",
    "Colorado":               "colorado",
    "Colorado State":         "colorado-state",
    "Columbia":               "columbia",
    "Connecticut":            "connecticut",
    "Coppin State":           "coppin-state",
    "Cornell":                "cornell",
    "Creighton":              "creighton",
    "Dartmouth":              "dartmouth",
    "Davidson":               "davidson",
    "Dayton":                 "dayton",
    "Delaware":               "delaware",
    "Delaware State":         "delaware-state",
    "Denver":                 "denver",
    "DePaul":                 "depaul",
    "Detroit Mercy":          "detroit-mercy",
    "Drake":                  "drake",
    "Drexel":                 "drexel",
    "Duke":                   "duke",
    "Duquesne":               "duquesne",
    "East Carolina":          "east-carolina",
    "East Tennessee State":   "east-tennessee-state",
    "Eastern Illinois":       "eastern-illinois",
    "Eastern Kentucky":       "eastern-kentucky",
    "Eastern Michigan":       "eastern-michigan",
    "Eastern Washington":     "eastern-washington",
    "Elon":                   "elon",
    "Evansville":             "evansville",
    "Fairfield":              "fairfield",
    "Fairleigh Dickinson":    "fairleigh-dickinson",
    "FIU":                    "florida-international",
    "Florida":                "florida",
    "Florida A&M":            "florida-am",
    "Florida Atlantic":       "florida-atlantic",
    "Florida Gulf Coast":     "florida-gulf-coast",
    "Florida State":          "florida-state",
    "Fordham":                "fordham",
    "Fresno State":           "fresno-state",
    "Furman":                 "furman",
    "Gardner-Webb":           "gardner-webb",
    "George Mason":           "george-mason",
    "George Washington":      "george-washington",
    "Georgetown":             "georgetown",
    "Georgia":                "georgia",
    "Georgia Southern":       "georgia-southern",
    "Georgia State":          "georgia-state",
    "Georgia Tech":           "georgia-tech",
    "Gonzaga":                "gonzaga",
    "Grambling":              "grambling",
    "Grand Canyon":           "grand-canyon",
    "Green Bay":              "wisconsin-green-bay",
    "Hampton":                "hampton",
    "Hartford":               "hartford",
    "Harvard":                "harvard",
    "Hawaii":                 "hawaii",
    "High Point":             "high-point",
    "Hofstra":                "hofstra",
    "Holy Cross":             "holy-cross",
    "Houston":                "houston",
    "Houston Christian":      "houston-christian",
    "Howard":                 "howard",
    "Idaho":                  "idaho",
    "Idaho State":            "idaho-state",
    "Illinois":               "illinois",
    "Illinois State":         "illinois-state",
    "Incarnate Word":         "incarnate-word",
    "Indiana":                "indiana",
    "Indiana State":          "indiana-state",
    "Iona":                   "iona",
    "Iowa":                   "iowa",
    "Iowa State":             "iowa-state",
    "Jackson State":          "jackson-state",
    "Jacksonville":           "jacksonville",
    "Jacksonville State":     "jacksonville-state",
    "James Madison":          "james-madison",
    "Kansas":                 "kansas",
    "Kansas State":           "kansas-state",
    "Kennesaw State":         "kennesaw-state",
    "Kent State":             "kent-state",
    "Kentucky":               "kentucky",
    "La Salle":               "la-salle",
    "Lafayette":              "lafayette",
    "Lamar":                  "lamar",
    "Lehigh":                 "lehigh",
    "Liberty":                "liberty",
    "Lindenwood":             "lindenwood",
    "Lipscomb":               "lipscomb",
    "Little Rock":            "little-rock",
    "Long Beach State":       "long-beach-state",
    "Long Island":            "long-island-university",
    "Longwood":               "longwood",
    "Louisiana":              "louisiana-lafayette",
    "Louisiana Tech":         "louisiana-tech",
    "Louisville":             "louisville",
    "Loyola Chicago":         "loyola-il",
    "Loyola Maryland":        "loyola-md",
    "Loyola Marymount":       "loyola-marymount",
    "LSU":                    "lsu",
    "Maine":                  "maine",
    "Manhattan":              "manhattan",
    "Marist":                 "marist",
    "Marquette":              "marquette",
    "Marshall":               "marshall",
    "Maryland":               "maryland",
    "Maryland-Eastern Shore": "maryland-eastern-shore",
    "Massachusetts":          "massachusetts",
    "McNeese":                "mcneese-state",
    "Memphis":                "memphis",
    "Mercer":                 "mercer",
    "Miami":                  "miami-fl",
    "Miami (OH)":             "miami-oh",
    "Michigan":               "michigan",
    "Michigan State":         "michigan-state",
    "Middle Tennessee":       "middle-tennessee",
    "Milwaukee":              "wisconsin-milwaukee",
    "Minnesota":              "minnesota",
    "Mississippi State":      "mississippi-state",
    "Mississippi Valley":     "mississippi-valley-state",
    "Missouri":               "missouri",
    "Missouri State":         "missouri-state",
    "Monmouth":               "monmouth",
    "Montana":                "montana",
    "Montana State":          "montana-state",
    "Morehead State":         "morehead-state",
    "Morgan State":           "morgan-state",
    "Mount St. Mary's":       "mount-st-marys",
    "Murray State":           "murray-state",
    "Navy":                   "navy",
    "Nebraska":               "nebraska",
    "Nevada":                 "nevada",
    "New Hampshire":          "new-hampshire",
    "New Mexico":             "new-mexico",
    "New Mexico State":       "new-mexico-state",
    "New Orleans":            "new-orleans",
    "Niagara":                "niagara",
    "Nicholls":               "nicholls-state",
    "NJIT":                   "njit",
    "Norfolk State":          "norfolk-state",
    "North Alabama":          "north-alabama",
    "North Carolina":         "north-carolina",
    "North Carolina A&T":     "north-carolina-at",
    "North Carolina Central": "north-carolina-central",
    "NC State":               "north-carolina-state",
    "North Dakota":           "north-dakota",
    "North Dakota State":     "north-dakota-state",
    "North Florida":          "north-florida",
    "North Texas":            "north-texas",
    "Northeastern":           "northeastern",
    "Northern Arizona":       "northern-arizona",
    "Northern Colorado":      "northern-colorado",
    "Northern Illinois":      "northern-illinois",
    "Northern Iowa":          "northern-iowa",
    "Northern Kentucky":      "northern-kentucky",
    "Northwestern":           "northwestern",
    "Northwestern State":     "northwestern-state",
    "Notre Dame":             "notre-dame",
    "Oakland":                "oakland",
    "Ohio":                   "ohio",
    "Ohio State":             "ohio-state",
    "Oklahoma":               "oklahoma",
    "Oklahoma State":         "oklahoma-state",
    "Old Dominion":           "old-dominion",
    "Ole Miss":               "mississippi",
    "Omaha":                  "nebraska-omaha",
    "Oregon":                 "oregon",
    "Oregon State":           "oregon-state",
    "Pacific":                "pacific",
    "Penn":                   "pennsylvania",
    "Penn State":             "penn-state",
    "Pepperdine":             "pepperdine",
    "Pittsburgh":             "pittsburgh",
    "Portland":               "portland",
    "Portland State":         "portland-state",
    "Prairie View A&M":       "prairie-view",
    "Presbyterian":           "presbyterian",
    "Princeton":              "princeton",
    "Providence":             "providence",
    "Purdue":                 "purdue",
    "Purdue Fort Wayne":      "purdue-fort-wayne",
    "Quinnipiac":             "quinnipiac",
    "Radford":                "radford",
    "Rhode Island":           "rhode-island",
    "Rice":                   "rice",
    "Richmond":               "richmond",
    "Rider":                  "rider",
    "Robert Morris":          "robert-morris",
    "Rutgers":                "rutgers",
    "Sacramento State":       "sacramento-state",
    "Saint Francis":          "saint-francis-pa",
    "Saint Joseph's":         "saint-josephs",
    "Saint Louis":            "saint-louis",
    "Saint Mary's":           "saint-marys-ca",
    "Saint Peter's":          "saint-peters",
    "Sam Houston":            "sam-houston-state",
    "Samford":                "samford",
    "San Diego":              "san-diego",
    "San Diego State":        "san-diego-state",
    "San Francisco":          "san-francisco",
    "San Jose State":         "san-jose-state",
    "Seton Hall":             "seton-hall",
    "Siena":                  "siena",
    "SMU":                    "southern-methodist",
    "South Alabama":          "south-alabama",
    "South Carolina":         "south-carolina",
    "South Carolina State":   "south-carolina-state",
    "South Dakota":           "south-dakota",
    "South Dakota State":     "south-dakota-state",
    "South Florida":          "south-florida",
    "Southeast Missouri":     "southeast-missouri-state",
    "Southeastern Louisiana": "southeastern-louisiana",
    "Southern":               "southern-university",
    "Southern Illinois":      "southern-illinois",
    "Southern Miss":          "southern-miss",
    "Southern Utah":          "southern-utah",
    "St. Bonaventure":        "st-bonaventure",
    "St. John's":             "st-johns",
    "Stanford":               "stanford",
    "Stephen F. Austin":      "stephen-f-austin",
    "Stetson":                "stetson",
    "Stony Brook":            "stony-brook",
    "Syracuse":               "syracuse",
    "Tarleton State":               "tarleton-state",
    "TCU":                    "texas-christian",
    "Temple":                 "temple",
    "Tennessee":              "tennessee",
    "Tennessee State":        "tennessee-state",
    "Tennessee Tech":         "tennessee-tech",
    "Texas":                  "texas",
    "Texas A&M":              "texas-am",
    "Texas A&M-Corpus Christi": "texas-am-corpus-christi",
    "Texas Southern":         "texas-southern",
    "Texas State":            "texas-state",
    "Texas Tech":             "texas-tech",
    "The Citadel":            "the-citadel",
    "Toledo":                 "toledo",
    "Towson":                 "towson",
    "Troy":                   "troy",
    "Tulane":                 "tulane",
    "Tulsa":                  "tulsa",
    "UAB":                    "alabama-birmingham",
    "UC Davis":               "california-davis",
    "UC Irvine":              "california-irvine",
    "UC Riverside":           "california-riverside",
    "UC San Diego":           "california-san-diego",
    "UCF":                    "central-florida",
    "UCLA":                   "ucla",
    "UIC":                    "illinois-chicago",
    "UL Monroe":              "louisiana-monroe",
    "UMass Lowell":           "massachusetts-lowell",
    "UMBC":                   "maryland-baltimore-county",
    "UNC Asheville":          "north-carolina-asheville",
    "UNC Greensboro":         "north-carolina-greensboro",
    "UNC Wilmington":         "north-carolina-wilmington",
    "UNLV":                   "nevada-las-vegas",
    "USC":                    "southern-california",
    "USC Upstate":            "south-carolina-upstate",
    "UT Arlington":           "texas-arlington",
    "UT Martin":              "tennessee-martin",
    "UTEP":                   "texas-el-paso",
    "UTSA":                   "texas-san-antonio",
    "Utah":                   "utah",
    "Utah State":             "utah-state",
    "Utah Tech":              "utah-tech",
    "Utah Valley":            "utah-valley",
    "Valparaiso":             "valparaiso",
    "VCU":                    "virginia-commonwealth",
    "Vermont":                "vermont",
    "Villanova":              "villanova",
    "Virginia":               "virginia",
    "Virginia Tech":          "virginia-tech",
    "VMI":                    "virginia-military-institute",
    "Wagner":                 "wagner",
    "Wake Forest":            "wake-forest",
    "Washington":             "washington",
    "Washington State":       "washington-state",
    "Weber State":            "weber-state",
    "West Virginia":          "west-virginia",
    "Western Carolina":       "western-carolina",
    "Western Illinois":       "western-illinois",
    "Western Kentucky":       "western-kentucky",
    "Western Michigan":       "western-michigan",
    "Wichita State":          "wichita-state",
    "William & Mary":         "william-mary",
    "Winthrop":               "winthrop",
    "Wisconsin":              "wisconsin",
    "Wofford":                "wofford",
    "Wright State":           "wright-state",
    "Wyoming":                "wyoming",
    "Xavier":                 "xavier",
    "Yale":                   "yale",
    "Youngstown State":       "youngstown-state",
}

# ── Constants ──────────────────────────────────────────────────────────────────

REQUEST_DELAY = 5   # seconds between player page requests (be polite to BBRef)
ROSTER_DELAY  = 8   # seconds between team roster page requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

OUTPUT_HEADERS = [
    "Team",
    "Name",
    "Primary Position",
    "Year",
    "USG%",
    "PPG",
    "REB/G",
    "AST/G",
    "3PA/G",
    "AST/TOV",
    "STL/40",
    "BLK/40",
    "DRB/40",
    "ORB/40",
    "TRB/40",
    "FG%",
    "ATR%",
    "FT%",
    "3P%",
    "Open Market Low",
    "Open Market High",
    "CDI",
    "DDS",
    "SEI",
    "SMI",
    "RIS",
    "Playmaker Tags",
    "Shooting/Scoring Tags",
]

POS_MAP = {
    "G":   "Guard",
    "G-F": "Wing",
    "F-G": "Wing",
    "F":   "Wing",
    "F-C": "Big",
    "C-F": "Big",
    "C":   "Big",
}

CLASS_MAP = {
    "FR": "Freshman",
    "SO": "Sophomore",
    "JR": "Junior",
    "SR": "Senior",
    "GR": "Graduate",
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def safe_float(val, default=0.0):
    try:
        return float(str(val).strip().replace("%", "").replace(",", ""))
    except (ValueError, TypeError):
        return default

def pct_str(val):
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return "0.00%"
    if val > 1.5:
        return f"{val:.2f}%"
    return f"{val * 100:.2f}%"

def per40(stat, mp):
    if mp == 0:
        return 0.0
    return round((stat / mp) * 40, 1)

def calc_ast_tov(ast, tov):
    if tov == 0:
        return round(ast, 1)
    return round(ast / tov, 1)

def normalise_pos(raw):
    return POS_MAP.get(str(raw).strip(), "Guard")

def normalise_class(raw):
    return CLASS_MAP.get(str(raw).strip().upper(), str(raw).strip())

def fetch(url, label="page"):
    resp = requests.get(url, headers=HEADERS, timeout=30)
    if resp.status_code == 429:
        print(f"    Rate-limited fetching {label}. Waiting 90s...")
        time.sleep(90)
        resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return resp.text

def strip_comments(html):
    """BBRef hides many tables inside HTML comments — strip them."""
    return re.sub(r"<!--(.*?)-->", r"\1", html, flags=re.DOTALL)

# ── Step 1: Get player URLs from a team roster page ───────────────────────────

def get_player_urls(team_name, slug, year):
    url  = f"https://www.sports-reference.com/cbb/schools/{slug}/men/{year}.html"
    print(f"  Fetching roster page: {url}")
    html = fetch(url, label=team_name)
    soup = BeautifulSoup(html, "html.parser")

    table = soup.find("table", {"id": "roster"})
    if not table:
        print(f"    ⚠  No roster table found for {team_name} — skipping")
        return []

    urls = []
    for a in table.find_all("a", href=re.compile(r"/cbb/players/")):
        href = a["href"]
        if not href.startswith("http"):
            href = "https://www.sports-reference.com" + href
        href = href.split("?")[0].split("#")[0]
        if href not in urls:
            urls.append(href)

    print(f"    Found {len(urls)} players on roster")
    return urls

# ── Step 2: Scrape one player page ────────────────────────────────────────────

def parse_table(html, table_id, year):
    try:
        dfs = pd.read_html(StringIO(html), attrs={"id": table_id})
    except Exception:
        return None
    if not dfs:
        return None
    df = dfs[0]
    df.columns = [str(c).strip() for c in df.columns]
    if "Season" not in df.columns:
        return df.iloc[-1] if not df.empty else None
    df = df[df["Season"].notna()]
    df = df[~df["Season"].astype(str).str.contains("Career|Season", na=False)]
    season_str = f"{year-1}-{str(year)[-2:]}"
    match = df[df["Season"].astype(str).str.startswith(season_str)]
    if match.empty:
        return df.iloc[-1] if not df.empty else None
    return match.iloc[-1]

def scrape_player(url, team_name, year):
    html  = fetch(url, label=url)
    html  = strip_comments(html)
    soup  = BeautifulSoup(html, "html.parser")

    # Name
    tag  = soup.find("h1", {"itemprop": "name"}) or soup.find("h1")
    name = tag.get_text(strip=True) if tag else "Unknown"

    # Bio
    team_parsed, pos, yr = "", "", ""
    bio = soup.find("div", {"id": "info"})
    if bio:
        text = bio.get_text(" ", strip=True)
        pm = re.search(r"Position[:\s]+([A-Z\-]+)", text)
        if pm:
            pos = normalise_pos(pm.group(1))
        links = bio.find_all("a", href=re.compile(r"/cbb/schools/"))
        if links:
            team_parsed = links[-1].get_text(strip=True)
        cm = re.search(r"\b(FR|SO|JR|SR|GR|Freshman|Sophomore|Junior|Senior|Graduate)\b", text, re.I)
        if cm:
            yr = normalise_class(cm.group(1))

    pg     = parse_table(html, "players_per_game", year)
    adv    = parse_table(html, "players_advanced", year)
    totals = parse_table(html, "players_totals", year)

    if pg is None:
        print(f"      ⚠  No per-game stats for {name} — skipping")
        return None

    ppg  = safe_float(pg.get("PTS",  0))
    rpg  = safe_float(pg.get("TRB",  0))
    apg  = safe_float(pg.get("AST",  0))
    spg  = safe_float(pg.get("STL",  0))
    bpg  = safe_float(pg.get("BLK",  0))
    tpg  = safe_float(pg.get("TOV",  0))
    orpg = safe_float(pg.get("ORB",  0))
    drpg = safe_float(pg.get("DRB",  0))
    mpg  = safe_float(pg.get("MP",   0))
    tpa  = safe_float(pg.get("3PA",  0))
    fg_pct = safe_float(pg.get("FG%", 0))
    ft_pct = safe_float(pg.get("FT%", 0))
    tp_pct = safe_float(pg.get("3P%", 0))

    ast_tov = calc_ast_tov(apg, tpg)
    stl_40  = per40(spg,  mpg)
    blk_40  = per40(bpg,  mpg)
    drb_40  = per40(drpg, mpg)
    orb_40  = per40(orpg, mpg)
    trb_40  = per40(rpg,  mpg)
    atr     = (apg / (apg + rpg)) * 100 if (apg + rpg) > 0 else 0.0

    usg = 0.0
    if adv is not None and "USG%" in adv.index:
        usg = safe_float(adv.get("USG%", 0))
        if usg <= 1.5:
            usg *= 100
        usg = round(usg, 1)

    if not team_parsed and pg is not None:
        team_parsed = str(pg.get("School", "")).strip()
    if not pos and pg is not None:
        pos = normalise_pos(pg.get("Pos", "G"))
    if not yr and pg is not None:
        yr = normalise_class(pg.get("Class", ""))

    row = {
        "Team":                  team_name,   # use the canonical name we indexed, not parsed
        "Name":                  name,
        "Primary Position":      pos,
        "Year":                  yr,
        "USG%":                  usg,
        "PPG":                   round(ppg,  1),
        "REB/G":                 round(rpg,  1),
        "AST/G":                 round(apg,  1),
        "3PA/G":                 round(tpa,  1),
        "AST/TOV":               ast_tov,
        "STL/40":                stl_40,
        "BLK/40":                blk_40,
        "DRB/40":                drb_40,
        "ORB/40":                orb_40,
        "TRB/40":                trb_40,
        "FG%":                   pct_str(fg_pct),
        "ATR%":                  f"{atr:.1f}%",
        "FT%":                   pct_str(ft_pct),
        "3P%":                   pct_str(tp_pct),
        "Open Market Low":       "",
        "Open Market High":      "",
        "CDI":                   "",
        "DDS":                   "",
        "SEI":                   "",
        "SMI":                   "",
        "RIS":                   "",
        "Playmaker Tags":        auto_playmaker_tag(apg, ast_tov, usg),
        "Shooting/Scoring Tags": auto_shooting_tag(tp_pct, ppg, fg_pct, usg),
    }

    print(f"      ✓ {name} | {pos} | {yr} | {ppg} PPG / {rpg} RPG")
    return row

# ── Auto-tagging (carried over from scraper.py) ───────────────────────────────

def auto_playmaker_tag(apg, ast_tov, usg):
    tags = []
    if apg >= 6.0:
        tags.append("Primary Playmaker")
    elif apg >= 4.0:
        tags.append("Secondary Playmaker")
    if usg >= 25:
        tags.append("Ball Dominant")
    if ast_tov >= 2.5:
        tags.append("High-IQ Passer")
        tags.append("Low-Mistake Handler")
    if not tags:
        tags.append("Non-Passer")
    return ", ".join(tags)

def auto_shooting_tag(tp_pct, ppg, fg_pct, usg):
    if tp_pct > 1.5:
        tp_pct /= 100
    if fg_pct > 1.5:
        fg_pct /= 100
    tags = []
    if tp_pct >= 0.38 and usg < 22:
        tags.append("Elite Shooter")
        tags.append("Low-USG Finisher")
    elif tp_pct >= 0.35:
        tags.append("Shooter")
    if ppg >= 18 or usg >= 28:
        tags.append("Volume Scorer")
    if fg_pct >= 0.56:
        tags.append("Efficient Scorer")
    if not tags:
        tags.append("Non-Shooter")
    return ", ".join(tags)

# ── Resume support: load already-scraped teams from output CSV ────────────────

def load_completed_teams(output_path):
    if not os.path.exists(output_path):
        return set()
    completed = set()
    with open(output_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            t = row.get("Team", "").strip()
            if t:
                completed.add(t)
    return completed

# ── Main ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Scrape all D1 rosters → data/all_rosters.csv")
    p.add_argument("--teams",  nargs="+", metavar="TEAM",
                   help="Specific team names to scrape (default: all). Use quotes for multi-word names.")
    p.add_argument("--year",   type=int, default=DEFAULT_YEAR,
                   help=f"Season year, e.g. 2026 for 2025-26 (default: {DEFAULT_YEAR})")
    p.add_argument("--output", default="data/all_rosters.csv",
                   help="Output CSV path (default: data/all_rosters.csv)")
    p.add_argument("--resume", action="store_true",
                   help="Skip teams that already appear in the output CSV")
    return p.parse_args()


def main():
    args = parse_args()

    # Resolve team list
    if args.teams:
        missing = [t for t in args.teams if t not in TEAMS]
        if missing:
            print(f"⚠  Unknown team names (check spelling): {missing}")
        target_teams = {t: TEAMS[t] for t in args.teams if t in TEAMS}
    else:
        target_teams = TEAMS

    # Resume: skip already-completed teams
    completed = load_completed_teams(args.output) if args.resume else set()
    if completed:
        print(f"Resume mode: skipping {len(completed)} already-scraped teams")
        target_teams = {k: v for k, v in target_teams.items() if k not in completed}

    if not target_teams:
        print("Nothing to scrape — all teams already done. Remove --resume or delete output to re-run.")
        return

    print(f"\nBeyondThePortal Roster Scraper")
    print(f"  Season : {args.year-1}-{str(args.year)[-2:]}")
    print(f"  Teams  : {len(target_teams)}")
    print(f"  Output : {args.output}")
    if args.resume:
        print(f"  Mode   : resume (appending)")
    print()

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    # Open file in append mode if resuming, write mode otherwise
    write_mode = "a" if args.resume and os.path.exists(args.output) else "w"

    with open(args.output, write_mode, newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_HEADERS)
        if write_mode == "w":
            writer.writeheader()

        total_players = 0
        for team_idx, (team_name, slug) in enumerate(target_teams.items(), 1):
            print(f"\n[{team_idx}/{len(target_teams)}] {team_name}")

            try:
                player_urls = get_player_urls(team_name, slug, args.year)
            except Exception as e:
                print(f"    ✗ Could not fetch roster for {team_name}: {e}")
                continue

            if not player_urls:
                continue

            team_rows = []
            for p_idx, url in enumerate(player_urls, 1):
                print(f"    [{p_idx}/{len(player_urls)}] {url}")
                try:
                    row = scrape_player(url, team_name, args.year)
                    if row:
                        team_rows.append(row)
                except Exception as e:
                    print(f"      ✗ Error: {e}")

                if p_idx < len(player_urls):
                    time.sleep(REQUEST_DELAY)

            writer.writerows(team_rows)
            f.flush()  # write to disk after each team so --resume works
            total_players += len(team_rows)
            print(f"  → {len(team_rows)} players written for {team_name}")

            if team_idx < len(target_teams):
                print(f"  Waiting {ROSTER_DELAY}s before next team...")
                time.sleep(ROSTER_DELAY)

    print(f"\n✓ Done! {total_players} total players written to {args.output}")
    print("  Open Market values and model scores (CDI/DDS/SEI/SMI/RIS) are blank — fill with your model.")


if __name__ == "__main__":
    main()
