"""
scraper_to_supabase.py — Scrape D1 rosters → players + player_stats + team_players
====================================================================================
Targets the new 3-table schema. Every player gets a row in `players` and
a row in `player_stats`. Returning-roster players also get a row in `team_players`.

Usage:
    python scraper_to_supabase.py --teams "Duke" "Kentucky" "Rutgers"
    python scraper_to_supabase.py --teams "Duke" --dry-run
    python scraper_to_supabase.py --teams "Rutgers" --replace

Environment variables:
    export SUPABASE_URL="https://xxxxxxxxxxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="your-service-role-key"

Prerequisite SQL (run once in SQL Editor):
    ALTER TABLE public.players
      ADD CONSTRAINT players_name_team_source_key UNIQUE (name, current_team, source);
"""

import argparse
import datetime
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

POS_MAP = {
    "G": "Guard", "G-F": "Wing", "F-G": "Wing",
    "F": "Wing",  "F-C": "Big", "C-F": "Big", "C": "Big",
}
CLASS_MAP = {
    "FR": "Freshman", "SO": "Sophomore", "JR": "Junior",
    "SR": "Senior",   "GR": "Graduate",
}

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
    "Central Connecticut St.": "central-connecticut-state",
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
    "Lafayette": "lafayette", "Lamar": "lamar", "Lehigh": "lehigh", "Liberty": "liberty",
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
    "St. Bonaventure": "st-bonaventure", "St. John's": "st-johns-ny",
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
    "William & Mary": "william-mary", "Wisconsin": "wisconsin", "Wofford": "wofford",
    "Wyoming": "wyoming", "Xavier": "xavier", "Yale": "yale",
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def safe_float(val, default=0.0):
    try:
        return float(str(val).strip().replace("%", "").replace(",", ""))
    except (ValueError, TypeError):
        return default

def pct(val):
    """Return percentage as a plain float (e.g. 0.452 → 45.2). Handles both forms."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    v = safe_float(val)
    return round(v * 100, 2) if v <= 1.5 else round(v, 2)

def per40(stat, mp):
    return round((stat / mp) * 40, 1) if mp else None

def calc_ast_tov(ast, tov):
    return round(ast / tov, 1) if tov else round(ast, 1)

def normalise_pos(raw):
    return POS_MAP.get(str(raw).strip(), "Guard")

def normalise_class(raw):
    return CLASS_MAP.get(str(raw).strip().upper(), str(raw).strip())

def fetch(url):
    resp = requests.get(url, headers=HEADERS, timeout=30)
    if resp.status_code == 429:
        print("    Rate-limited. Waiting 90s...")
        time.sleep(90)
        resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return resp.text

def strip_comments(html):
    return re.sub(r"<!--(.*?)-->", r"\1", html, flags=re.DOTALL)

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
    return match.iloc[-1] if not match.empty else (df.iloc[-1] if not df.empty else None)

def auto_playmaker_tags(apg, ast_tov, usg):
    tags = []
    if apg >= 6.0:      tags.append("Primary Playmaker")
    elif apg >= 4.0:    tags.append("Secondary Playmaker")
    if usg >= 25:       tags.append("Ball Dominant")
    if ast_tov >= 2.5:  tags.extend(["High-IQ Passer", "Low-Mistake Handler"])
    if not tags:        tags.append("Non-Passer")
    return ", ".join(tags)

def auto_shooting_tags(tp_pct, ppg, fg_pct, usg):
    # expects raw fractions or already-percent — normalise to fraction
    tp = tp_pct / 100 if tp_pct and tp_pct > 1.5 else (tp_pct or 0)
    fg = fg_pct / 100 if fg_pct and fg_pct > 1.5 else (fg_pct or 0)
    tags = []
    if tp >= 0.38 and usg < 22: tags.extend(["Elite Shooter", "Low-USG Finisher"])
    elif tp >= 0.35:             tags.append("Shooter")
    if ppg >= 18 or usg >= 28:  tags.append("Volume Scorer")
    if fg >= 0.56:               tags.append("Efficient Scorer")
    if not tags:                 tags.append("Non-Shooter")
    return ", ".join(tags)

# ── Scrape one player ──────────────────────────────────────────────────────────

def scrape_player(url, team_name, year):
    html = strip_comments(fetch(url))
    soup = BeautifulSoup(html, "html.parser")

    # Name
    tag  = soup.find("h1", {"itemprop": "name"}) or soup.find("h1")
    name = tag.get_text(strip=True) if tag else "Unknown"

    # Bio
    pos, yr = "", ""
    height, weight = None, None
    bio = soup.find("div", {"id": "info"})
    if bio:
        text = bio.get_text(" ", strip=True)
        pm = re.search(r"Position[:\s]+([A-Z\-]+)", text)
        if pm: pos = normalise_pos(pm.group(1))
        cm = re.search(r"\b(FR|SO|JR|SR|GR|Freshman|Sophomore|Junior|Senior|Graduate)\b", text, re.I)
        if cm: yr = normalise_class(cm.group(1))
        # Height: e.g. "6-4" or "6 ft 4 in"
        hm = re.search(r'\b(\d)-(\d{1,2})\b', text)
        if hm: height = f"{hm.group(1)}-{hm.group(2)}"
        # Weight: e.g. "210 lb"
        wm = re.search(r'(\d{2,3})\s*(?:lb|lbs)', text, re.I)
        if wm: weight = int(wm.group(1))

    pg  = parse_table(html, "players_per_game", year)
    adv = parse_table(html, "players_advanced", year)
    tot = parse_table(html, "players_totals",   year)

    if pg is None:
        print(f"      ⚠  No stats for {name} — skipping")
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
    fg_v = safe_float(pg.get("FG%",  0))
    ft_v = safe_float(pg.get("FT%",  0))
    tp_v = safe_float(pg.get("3P%",  0))

    ast_tov = calc_ast_tov(apg, tpg)
    atr     = round((apg / (apg + rpg)) * 100, 1) if (apg + rpg) > 0 else None

    usg = None
    if adv is not None and "USG%" in adv.index:
        raw_usg = safe_float(adv.get("USG%", 0))
        usg = round(raw_usg * 100 if raw_usg <= 1.5 else raw_usg, 1)

    if not pos and pg is not None: pos = normalise_pos(pg.get("Pos", "G"))
    if not yr  and pg is not None: yr  = normalise_class(pg.get("Class", ""))

    # Totals (raw counting stats for the season)
    t = tot if tot is not None else pg  # fall back to per-game row if totals missing
    tot_g   = int(safe_float(t.get("G",   0)))
    tot_gs  = int(safe_float(t.get("GS",  0)))
    tot_mp  = int(safe_float(t.get("MP",  0)))
    tot_fg  = int(safe_float(t.get("FG",  0)))
    tot_fga = int(safe_float(t.get("FGA", 0)))
    tot_3p  = int(safe_float(t.get("3P",  0)))
    tot_3pa = int(safe_float(t.get("3PA", 0)))
    tot_2p  = int(safe_float(t.get("2P",  0)))
    tot_2pa = int(safe_float(t.get("2PA", 0)))
    tot_ft  = int(safe_float(t.get("FT",  0)))
    tot_fta = int(safe_float(t.get("FTA", 0)))
    tot_orb = int(safe_float(t.get("ORB", 0)))
    tot_drb = int(safe_float(t.get("DRB", 0)))
    tot_trb = int(safe_float(t.get("TRB", 0)))
    tot_ast = int(safe_float(t.get("AST", 0)))
    tot_stl = int(safe_float(t.get("STL", 0)))
    tot_blk = int(safe_float(t.get("BLK", 0)))
    tot_tov = int(safe_float(t.get("TOV", 0)))
    tot_pf  = int(safe_float(t.get("PF",  0)))
    tot_pts = int(safe_float(t.get("PTS", 0)))

    # player row (for `players` table)
    player_row = {
        "name":             name,
        "current_team":     team_name,
        "primary_position": pos,
        "year":             yr,
        "source":           "program",
        "playmaker_tags":   auto_playmaker_tags(apg, ast_tov, usg or 0),
        "shooting_tags":    auto_shooting_tags(tp_v, ppg, fg_v, usg or 0),
        "height":           height,
        "weight":           weight,
    }

    # stats row (for `player_stats` table) — all numeric, pct as float
    stats_row = {
        "year":    yr,
        "name":    name,
        # per-game
        "ppg":     round(ppg,  1),
        "rpg":     round(rpg,  1),
        "apg":     round(apg,  1),
        "3pg":     round(tpa,  1),
        "usg":     usg,
        "ast_tov": ast_tov,
        "fg_pct":  pct(fg_v),
        "ft_pct":  pct(ft_v),
        "3p_pct":  pct(tp_v),
        "atr_pct": atr,
        "stl_40":  per40(spg,  mpg),
        "blk_40":  per40(bpg,  mpg),
        "drb_40":  per40(drpg, mpg),
        "orb_40":  per40(orpg, mpg),
        "trb_40":  per40(rpg,  mpg),
        # totals
        "tot_g":   tot_g,
        "tot_gs":  tot_gs,
        "tot_mp":  tot_mp,
        "tot_fg":  tot_fg,
        "tot_fga": tot_fga,
        "tot_3p":  tot_3p,
        "tot_3pa": tot_3pa,
        "tot_2p":  tot_2p,
        "tot_2pa": tot_2pa,
        "tot_ft":  tot_ft,
        "tot_fta": tot_fta,
        "tot_orb": tot_orb,
        "tot_drb": tot_drb,
        "tot_trb": tot_trb,
        "tot_ast": tot_ast,
        "tot_stl": tot_stl,
        "tot_blk": tot_blk,
        "tot_tov": tot_tov,
        "tot_pf":  tot_pf,
        "tot_pts": tot_pts,
        # school + conference from the stats table
        "school":     team_name,
        "conference": str(pg.get("Conf", "")).strip() if pg is not None else "",
        # cdi, dds, sei, ath, ris left null — filled by torvik_metrics.py
    }

    print(f"      ✓ {name} | {pos} | {yr} | {ppg} PPG / {rpg} RPG")
    return player_row, stats_row

def get_player_urls(team_name, slug, year):
    url  = f"https://www.sports-reference.com/cbb/schools/{slug}/men/{year}.html"
    print(f"  Fetching: {url}")
    html = fetch(url)
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", {"id": "roster"})
    if not table:
        print(f"    ⚠  No roster table for {team_name}")
        return []
    urls = []
    for a in table.find_all("a", href=re.compile(r"/cbb/players/")):
        href = "https://www.sports-reference.com" + a["href"] if not a["href"].startswith("http") else a["href"]
        href = href.split("?")[0].split("#")[0]
        if href not in urls:
            urls.append(href)
    print(f"    Found {len(urls)} players")
    return urls

# ── Main ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--teams",   nargs="+", metavar="TEAM")
    p.add_argument("--year",    type=int, default=DEFAULT_YEAR)
    p.add_argument("--replace", action="store_true", help="Delete existing team_players rows before inserting")
    p.add_argument("--dry-run", action="store_true", help="Print rows instead of writing to Supabase")
    return p.parse_args()

def main():
    args = parse_args()

    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars, or use --dry-run.")
        db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    target = {t: TEAMS[t] for t in (args.teams or TEAMS) if t in TEAMS}
    if args.teams:
        unknown = [t for t in args.teams if t not in TEAMS]
        if unknown: print(f"⚠  Unknown teams: {unknown}")

    print(f"\nBeyondThePortal → Supabase (players + player_stats + team_players)")
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

        if args.replace and not args.dry_run:
            db.table("team_players").delete().eq("team", team_name).eq("player_type", "returning").execute()
            print(f"  Deleted existing team_players rows for {team_name}")

        scraped = []
        for j, url in enumerate(urls, 1):
            print(f"    [{j}/{len(urls)}] {url}")
            try:
                result = scrape_player(url, team_name, args.year)
                if result:
                    scraped.append(result)
            except Exception as e:
                print(f"      ✗ {e}")
            if j < len(urls):
                time.sleep(REQUEST_DELAY)

        if not scraped:
            print(f"  No rows scraped for {team_name}"); continue

        if args.dry_run:
            print(json.dumps(scraped[:1], indent=2, default=str))
            print(f"  (dry-run) Would write {len(scraped)} players for {team_name}")
        else:
            for player_row, stats_row in scraped:
                try:
                    # 1. Upsert player → get id back
                    res = db.table("players").upsert(
                        player_row,
                        on_conflict="name,current_team,source"
                    ).execute()
                    player_id = res.data[0]["id"]

                    # 2. Upsert stats
                    db.table("player_stats").upsert(
                        {**stats_row, "player_id": player_id},
                        on_conflict="player_id,year"
                    ).execute()

                    # 3. Upsert team_players link
                    db.table("team_players").upsert(
                        {
                            "team":      team_name,
                            "player_id": player_id,
                            "name":      player_row["name"],
                            "year":      player_row["year"],
                        },
                        on_conflict="team,player_id"
                    ).execute()

                except Exception as e:
                    print(f"      ✗ DB error for {player_row.get('name')}: {e}")

            print(f"  ✓ Wrote {len(scraped)} players for {team_name}")

        total += len(scraped)
        if i < len(target):
            time.sleep(ROSTER_DELAY)

    print(f"\n✓ Done. {total} total players {'would be ' if args.dry_run else ''}written.")

if __name__ == "__main__":
    main()
