"""
scraper_to_supabase.py — Scrape D1 rosters → Supabase `rosters` table
======================================================================
Replaces the old all_rosters.csv workflow. Run this once per season
(or whenever you onboard a new program). Data is immediately live in
the app — no file commit or redeploy needed.

Usage:
    # Scrape specific teams (recommended for first run / testing)
    python scraper_to_supabase.py --teams "Duke" "Kentucky" "Rutgers"

    # Scrape all teams (slow — budget ~5s per player)
    python scraper_to_supabase.py

    # Dry run: scrape but print rows instead of upserting
    python scraper_to_supabase.py --teams "Duke" --dry-run

    # Replace a team's roster entirely (vs. upsert/merge)
    python scraper_to_supabase.py --teams "Rutgers" --replace

Environment variables (set before running):
    export SUPABASE_URL="https://xxxxxxxxxxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="your-service-role-key"

Supabase table schema (run in SQL Editor before first use):
------------------------------------------------------------
create table public.rosters (
  id              uuid primary key default gen_random_uuid(),
  team            text not null,
  name            text not null,
  primary_position text,
  year            text,
  ppg             numeric,
  reb_g           numeric,
  ast_g           numeric,
  usg_pct         numeric,
  fg_pct          text,
  three_p_pct     text,
  ft_pct          text,
  three_pa_g      numeric,
  ast_tov         numeric,
  stl_40          numeric,
  blk_40          numeric,
  playmaker_tags  text,
  shooting_tags   text,
  updated_at      timestamp with time zone default now(),
  unique (team, name)
);
alter table public.rosters enable row level security;
create policy "Coaches read own team"
  on public.rosters for select
  using (
    team = (select team from public.coaches where user_id = auth.uid() limit 1)
  );
------------------------------------------------------------
"""

import argparse
import json
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
    sys.exit("Run: pip install requests pandas lxml beautifulsoup4")

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

# ── Config ─────────────────────────────────────────────────────────────────────

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

import datetime
_now = datetime.date.today()
DEFAULT_YEAR = _now.year + 1 if _now.month >= 10 else _now.year

REQUEST_DELAY = 5
ROSTER_DELAY  = 8

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# Full D1 team → BBRef slug map (same as roster_scraper.py)
TEAMS = {
    "Abilene Christian": "abilene-christian", "Air Force": "air-force",
    "Akron": "akron", "Alabama": "alabama", "Alabama A&M": "alabama-am",
    "Alabama State": "alabama-state", "Albany": "albany-ny",
    "Alcorn State": "alcorn-state", "American": "american",
    "Appalachian State": "appalachian-state", "Arizona": "arizona",
    "Arizona State": "arizona-state", "Arkansas": "arkansas",
    "Arkansas State": "arkansas-state", "Army": "army", "Auburn": "auburn",
    "Austin Peay": "austin-peay", "Ball State": "ball-state", "Baylor": "baylor",
    "Belmont": "belmont", "Boise State": "boise-state",
    "Boston College": "boston-college", "Boston University": "boston-university",
    "Bowling Green": "bowling-green", "Bradley": "bradley", "Brown": "brown",
    "Bryant": "bryant", "Bucknell": "bucknell", "Buffalo": "buffalo",
    "Butler": "butler", "BYU": "brigham-young", "California": "california",
    "Campbell": "campbell", "Central Arkansas": "central-arkansas",
    "Central Michigan": "central-michigan", "Charleston": "charleston",
    "Charlotte": "charlotte", "Chattanooga": "chattanooga",
    "Chicago State": "chicago-state", "Cincinnati": "cincinnati",
    "Clemson": "clemson", "Cleveland State": "cleveland-state",
    "Coastal Carolina": "coastal-carolina", "Colgate": "colgate",
    "Colorado": "colorado", "Colorado State": "colorado-state",
    "Columbia": "columbia", "Connecticut": "connecticut",
    "Coppin State": "coppin-state", "Cornell": "cornell",
    "Creighton": "creighton", "Dartmouth": "dartmouth", "Davidson": "davidson",
    "Dayton": "dayton", "Delaware": "delaware", "Denver": "denver",
    "DePaul": "depaul", "Detroit Mercy": "detroit-mercy", "Drake": "drake",
    "Drexel": "drexel", "Duke": "duke", "Duquesne": "duquesne",
    "East Carolina": "east-carolina",
    "East Tennessee State": "east-tennessee-state",
    "Eastern Kentucky": "eastern-kentucky", "Eastern Michigan": "eastern-michigan",
    "Eastern Washington": "eastern-washington", "Elon": "elon",
    "Evansville": "evansville", "Fairfield": "fairfield",
    "FIU": "florida-international", "Florida": "florida",
    "Florida Atlantic": "florida-atlantic",
    "Florida Gulf Coast": "florida-gulf-coast", "Florida State": "florida-state",
    "Fordham": "fordham", "Fresno State": "fresno-state", "Furman": "furman",
    "George Mason": "george-mason", "George Washington": "george-washington",
    "Georgetown": "georgetown", "Georgia": "georgia",
    "Georgia Southern": "georgia-southern", "Georgia State": "georgia-state",
    "Georgia Tech": "georgia-tech", "Gonzaga": "gonzaga",
    "Grand Canyon": "grand-canyon", "Green Bay": "wisconsin-green-bay",
    "Hampton": "hampton", "Harvard": "harvard", "Hawaii": "hawaii",
    "High Point": "high-point", "Hofstra": "hofstra", "Holy Cross": "holy-cross",
    "Houston": "houston", "Houston Christian": "houston-christian",
    "Howard": "howard", "Idaho": "idaho", "Idaho State": "idaho-state",
    "Illinois": "illinois", "Illinois State": "illinois-state",
    "Indiana": "indiana", "Indiana State": "indiana-state", "Iona": "iona",
    "Iowa": "iowa", "Iowa State": "iowa-state",
    "Jacksonville State": "jacksonville-state", "James Madison": "james-madison",
    "Kansas": "kansas", "Kansas State": "kansas-state",
    "Kent State": "kent-state", "Kentucky": "kentucky", "La Salle": "la-salle",
    "Lafayette": "lafayette", "Lehigh": "lehigh", "Liberty": "liberty",
    "Lipscomb": "lipscomb", "Long Beach State": "long-beach-state",
    "Longwood": "longwood", "Louisiana": "louisiana-lafayette",
    "Louisiana Tech": "louisiana-tech", "Louisville": "louisville",
    "Loyola Chicago": "loyola-il", "Loyola Marymount": "loyola-marymount",
    "LSU": "lsu", "Maine": "maine", "Manhattan": "manhattan",
    "Marquette": "marquette", "Marshall": "marshall", "Maryland": "maryland",
    "Massachusetts": "massachusetts", "McNeese": "mcneese-state",
    "Memphis": "memphis", "Mercer": "mercer", "Miami": "miami-fl",
    "Miami (OH)": "miami-oh", "Michigan": "michigan",
    "Michigan State": "michigan-state", "Middle Tennessee": "middle-tennessee",
    "Milwaukee": "wisconsin-milwaukee", "Minnesota": "minnesota",
    "Mississippi State": "mississippi-state", "Missouri": "missouri",
    "Missouri State": "missouri-state", "Monmouth": "monmouth",
    "Montana": "montana", "Montana State": "montana-state",
    "Morehead State": "morehead-state", "Morgan State": "morgan-state",
    "Murray State": "murray-state", "Navy": "navy", "Nebraska": "nebraska",
    "Nevada": "nevada", "New Hampshire": "new-hampshire",
    "New Mexico": "new-mexico", "New Mexico State": "new-mexico-state",
    "Niagara": "niagara", "NJIT": "njit", "Norfolk State": "norfolk-state",
    "North Alabama": "north-alabama", "North Carolina": "north-carolina",
    "NC State": "north-carolina-state", "North Dakota": "north-dakota",
    "North Dakota State": "north-dakota-state", "North Texas": "north-texas",
    "Northeastern": "northeastern", "Northern Arizona": "northern-arizona",
    "Northern Iowa": "northern-iowa", "Northwestern": "northwestern",
    "Notre Dame": "notre-dame", "Oakland": "oakland", "Ohio": "ohio",
    "Ohio State": "ohio-state", "Oklahoma": "oklahoma",
    "Oklahoma State": "oklahoma-state", "Old Dominion": "old-dominion",
    "Ole Miss": "mississippi", "Oregon": "oregon", "Oregon State": "oregon-state",
    "Penn": "pennsylvania", "Penn State": "penn-state",
    "Pepperdine": "pepperdine", "Pittsburgh": "pittsburgh",
    "Portland": "portland", "Princeton": "princeton", "Providence": "providence",
    "Purdue": "purdue", "Purdue Fort Wayne": "purdue-fort-wayne",
    "Quinnipiac": "quinnipiac", "Radford": "radford",
    "Rhode Island": "rhode-island", "Rice": "rice", "Richmond": "richmond",
    "Robert Morris": "robert-morris", "Rutgers": "rutgers",
    "Sacramento State": "sacramento-state", "Saint Joseph's": "saint-josephs",
    "Saint Louis": "saint-louis", "Saint Mary's": "saint-marys-ca",
    "Saint Peter's": "saint-peters", "Sam Houston": "sam-houston-state",
    "San Diego": "san-diego", "San Diego State": "san-diego-state",
    "San Francisco": "san-francisco", "San Jose State": "san-jose-state",
    "Seton Hall": "seton-hall", "Siena": "siena", "SMU": "southern-methodist",
    "South Carolina": "south-carolina", "South Dakota": "south-dakota",
    "South Dakota State": "south-dakota-state", "South Florida": "south-florida",
    "Southern Illinois": "southern-illinois", "Southern Miss": "southern-miss",
    "St. Bonaventure": "st-bonaventure", "St. John's": "st-johns",
    "Stanford": "stanford", "Stetson": "stetson", "Stony Brook": "stony-brook",
    "Syracuse": "syracuse", "TCU": "texas-christian", "Temple": "temple",
    "Tennessee": "tennessee", "Tennessee State": "tennessee-state",
    "Tennessee Tech": "tennessee-tech", "Texas": "texas",
    "Texas A&M": "texas-am", "Texas Southern": "texas-southern",
    "Texas State": "texas-state", "Texas Tech": "texas-tech",
    "Toledo": "toledo", "Towson": "towson", "Troy": "troy",
    "Tulane": "tulane", "Tulsa": "tulsa", "UAB": "alabama-birmingham",
    "UC Davis": "california-davis", "UC Irvine": "california-irvine",
    "UCF": "central-florida", "UCLA": "ucla", "UIC": "illinois-chicago",
    "UMBC": "maryland-baltimore-county",
    "UNC Greensboro": "north-carolina-greensboro",
    "UNC Wilmington": "north-carolina-wilmington",
    "UNLV": "nevada-las-vegas", "USC": "southern-california",
    "UTEP": "texas-el-paso", "UTSA": "texas-san-antonio",
    "Utah": "utah", "Utah State": "utah-state", "Utah Valley": "utah-valley",
    "VCU": "virginia-commonwealth", "Vermont": "vermont",
    "Villanova": "villanova", "Virginia": "virginia",
    "Virginia Tech": "virginia-tech", "Wake Forest": "wake-forest",
    "Washington": "washington", "Washington State": "washington-state",
    "Weber State": "weber-state", "West Virginia": "west-virginia",
    "Western Kentucky": "western-kentucky",
    "Western Michigan": "western-michigan", "Wichita State": "wichita-state",
    "Wisconsin": "wisconsin", "Wofford": "wofford",
    "Wyoming": "wyoming", "Xavier": "xavier", "Yale": "yale",
}

POS_MAP   = {"G":"Guard","G-F":"Wing","F-G":"Wing","F":"Wing","F-C":"Big","C-F":"Big","C":"Big"}
CLASS_MAP = {"FR":"Freshman","SO":"Sophomore","JR":"Junior","SR":"Senior","GR":"Graduate"}

# ── Helpers ────────────────────────────────────────────────────────────────────

def safe_float(val, default=0.0):
    try: return float(str(val).strip().replace("%","").replace(",",""))
    except: return default

def pct_str(val):
    if val is None or (isinstance(val, float) and math.isnan(val)): return "0.00%"
    return f"{val:.2f}%" if val > 1.5 else f"{val*100:.2f}%"

def per40(stat, mp): return round((stat/mp)*40, 1) if mp else 0.0
def calc_ast_tov(ast, tov): return round(ast/tov, 1) if tov else round(ast, 1)
def normalise_pos(raw): return POS_MAP.get(str(raw).strip(), "Guard")
def normalise_class(raw): return CLASS_MAP.get(str(raw).strip().upper(), str(raw).strip())

def fetch(url):
    resp = requests.get(url, headers=HEADERS, timeout=30)
    if resp.status_code == 429:
        print("    Rate-limited. Waiting 90s..."); time.sleep(90)
        resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.text

def strip_comments(html):
    return re.sub(r"<!--(.*?)-->", r"\1", html, flags=re.DOTALL)

def parse_table(html, table_id, year):
    try: dfs = pd.read_html(StringIO(html), attrs={"id": table_id})
    except: return None
    if not dfs: return None
    df = dfs[0]; df.columns = [str(c).strip() for c in df.columns]
    if "Season" not in df.columns: return df.iloc[-1] if not df.empty else None
    df = df[df["Season"].notna()]
    df = df[~df["Season"].astype(str).str.contains("Career|Season", na=False)]
    season = f"{year-1}-{str(year)[-2:]}"
    match = df[df["Season"].astype(str).str.startswith(season)]
    return match.iloc[-1] if not match.empty else (df.iloc[-1] if not df.empty else None)

def auto_playmaker_tag(apg, ast_tov, usg):
    tags = []
    if apg >= 6.0: tags.append("Primary Playmaker")
    elif apg >= 4.0: tags.append("Secondary Playmaker")
    if usg >= 25: tags.append("Ball Dominant")
    if ast_tov >= 2.5: tags.extend(["High-IQ Passer","Low-Mistake Handler"])
    if not tags: tags.append("Non-Passer")
    return ", ".join(tags)

def auto_shooting_tag(tp_pct, ppg, fg_pct, usg):
    if tp_pct > 1.5: tp_pct /= 100
    if fg_pct > 1.5: fg_pct /= 100
    tags = []
    if tp_pct >= 0.38 and usg < 22: tags.extend(["Elite Shooter","Low-USG Finisher"])
    elif tp_pct >= 0.35: tags.append("Shooter")
    if ppg >= 18 or usg >= 28: tags.append("Volume Scorer")
    if fg_pct >= 0.56: tags.append("Efficient Scorer")
    if not tags: tags.append("Non-Shooter")
    return ", ".join(tags)

# ── Scrape one player ──────────────────────────────────────────────────────────

def scrape_player(url, team_name, year):
    html  = strip_comments(fetch(url))
    soup  = BeautifulSoup(html, "html.parser")

    tag  = soup.find("h1", {"itemprop": "name"}) or soup.find("h1")
    name = tag.get_text(strip=True) if tag else "Unknown"

    team_parsed, pos, yr = "", "", ""
    bio = soup.find("div", {"id": "info"})
    if bio:
        text = bio.get_text(" ", strip=True)
        pm = re.search(r"Position[:\s]+([A-Z\-]+)", text)
        if pm: pos = normalise_pos(pm.group(1))
        links = bio.find_all("a", href=re.compile(r"/cbb/schools/"))
        if links: team_parsed = links[-1].get_text(strip=True)
        cm = re.search(r"\b(FR|SO|JR|SR|GR|Freshman|Sophomore|Junior|Senior|Graduate)\b", text, re.I)
        if cm: yr = normalise_class(cm.group(1))

    pg     = parse_table(html, "players_per_game", year)
    adv    = parse_table(html, "players_advanced", year)

    if pg is None:
        print(f"      ⚠  No stats for {name} — skipping"); return None

    ppg  = safe_float(pg.get("PTS", 0)); rpg = safe_float(pg.get("TRB", 0))
    apg  = safe_float(pg.get("AST", 0)); spg = safe_float(pg.get("STL", 0))
    bpg  = safe_float(pg.get("BLK", 0)); tpg = safe_float(pg.get("TOV", 0))
    orpg = safe_float(pg.get("ORB", 0)); drpg= safe_float(pg.get("DRB", 0))
    mpg  = safe_float(pg.get("MP",  0)); tpa = safe_float(pg.get("3PA", 0))
    fg   = safe_float(pg.get("FG%", 0)); ft  = safe_float(pg.get("FT%", 0))
    tp   = safe_float(pg.get("3P%", 0))

    ast_tov = calc_ast_tov(apg, tpg)
    usg = 0.0
    if adv is not None and "USG%" in adv.index:
        usg = safe_float(adv.get("USG%", 0))
        if usg <= 1.5: usg *= 100
        usg = round(usg, 1)

    if not pos and pg is not None: pos = normalise_pos(pg.get("Pos","G"))
    if not yr  and pg is not None: yr  = normalise_class(pg.get("Class",""))

    row = {
        "team":            team_name,
        "name":            name,
        "primary_position":pos,
        "year":            yr,
        "ppg":             round(ppg, 1),
        "reb_g":           round(rpg, 1),
        "ast_g":           round(apg, 1),
        "usg_pct":         usg,
        "fg_pct":          pct_str(fg),
        "three_p_pct":     pct_str(tp),
        "ft_pct":          pct_str(ft),
        "three_pa_g":      round(tpa, 1),
        "ast_tov":         ast_tov,
        "stl_40":          per40(spg, mpg),
        "blk_40":          per40(bpg, mpg),
        "playmaker_tags":  auto_playmaker_tag(apg, ast_tov, usg),
        "shooting_tags":   auto_shooting_tag(tp, ppg, fg, usg),
    }
    print(f"      ✓ {name} | {pos} | {yr} | {ppg} PPG")
    return row

def get_player_urls(team_name, slug, year):
    url  = f"https://www.sports-reference.com/cbb/schools/{slug}/men/{year}.html"
    print(f"  Fetching: {url}")
    html = fetch(url)
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", {"id": "roster"})
    if not table: print(f"    ⚠  No roster table for {team_name}"); return []
    urls = []
    for a in table.find_all("a", href=re.compile(r"/cbb/players/")):
        href = "https://www.sports-reference.com" + a["href"] if not a["href"].startswith("http") else a["href"]
        href = href.split("?")[0].split("#")[0]
        if href not in urls: urls.append(href)
    print(f"    Found {len(urls)} players")
    return urls

# ── Main ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--teams",    nargs="+", metavar="TEAM")
    p.add_argument("--year",     type=int, default=DEFAULT_YEAR)
    p.add_argument("--replace",  action="store_true", help="Delete existing rows for each team before inserting")
    p.add_argument("--dry-run",  action="store_true", help="Print rows instead of upserting to Supabase")
    return p.parse_args()

def main():
    args = parse_args()

    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            sys.exit(
                "Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.\n"
                "Or use --dry-run to test without a DB connection."
            )
        db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    target = {t: TEAMS[t] for t in (args.teams or TEAMS) if t in TEAMS}
    if args.teams:
        unknown = [t for t in args.teams if t not in TEAMS]
        if unknown: print(f"⚠  Unknown teams: {unknown}")

    print(f"\nBeyondThePortal → Supabase Roster Scraper")
    print(f"  Season : {args.year-1}-{str(args.year)[-2:]}")
    print(f"  Teams  : {len(target)}")
    print(f"  Mode   : {'dry-run' if args.dry_run else ('replace' if args.replace else 'upsert')}\n")

    total = 0
    for i, (team_name, slug) in enumerate(target.items(), 1):
        print(f"\n[{i}/{len(target)}] {team_name}")
        try:
            urls = get_player_urls(team_name, slug, args.year)
        except Exception as e:
            print(f"  ✗ Roster page failed: {e}"); continue

        rows = []
        for j, url in enumerate(urls, 1):
            print(f"    [{j}/{len(urls)}] {url}")
            try:
                row = scrape_player(url, team_name, args.year)
                if row: rows.append(row)
            except Exception as e:
                print(f"      ✗ {e}")
            if j < len(urls): time.sleep(REQUEST_DELAY)

        if not rows:
            print(f"  No rows scraped for {team_name}"); continue

        if args.dry_run:
            print(json.dumps(rows[:2], indent=2))
            print(f"  (dry-run) Would upsert {len(rows)} rows for {team_name}")
        else:
            if args.replace:
                db.table("rosters").delete().eq("team", team_name).execute()
                print(f"  Deleted existing rows for {team_name}")
            result = db.table("rosters").upsert(rows, on_conflict="team,name").execute()
            print(f"  ✓ Upserted {len(rows)} players for {team_name}")

        total += len(rows)
        if i < len(target): time.sleep(ROSTER_DELAY)

    print(f"\n✓ Done. {total} total players {'would be ' if args.dry_run else ''}written to Supabase.")

if __name__ == "__main__":
    main()
