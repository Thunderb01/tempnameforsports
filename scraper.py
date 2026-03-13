"""
scraper.py — BBRef player pages → BeyondThePortal CSV
======================================================
Reads a list of Basketball-Reference player URLs from players.txt,
scrapes each one, and outputs a CSV ready to drop into:
    data/BeyondThePortal_GM_Tool - Import_Board.csv

Setup:
    pip install requests pandas lxml beautifulsoup4

Usage:
    python scraper.py
    python scraper.py --players players.txt --output "data/BeyondThePortal_GM_Tool - Import_Board.csv"

players.txt format (one URL per line, # for comments):
    https://www.sports-reference.com/cbb/players/cameron-boozer-3.html
    https://www.sports-reference.com/cbb/players/cooper-flagg-1.html
    # this line is ignored
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

# ── Constants ──────────────────────────────────────────────────────────────────

REQUEST_DELAY = 4  # seconds between requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

APP_CSV_HEADERS = [
    "Name",
    "Team",
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
    "GR": "Senior",
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
    raw = str(raw).strip()
    return POS_MAP.get(raw, "Guard")


def normalise_class(raw):
    raw = str(raw).strip().upper()
    return CLASS_MAP.get(raw, raw)


def load_urls(filepath):
    if not os.path.exists(filepath):
        sys.exit(
            f"players.txt not found at: {filepath}\n"
            f"Create it with one BBRef player URL per line, e.g.:\n"
            f"  https://www.sports-reference.com/cbb/players/cooper-flagg-1.html"
        )
    urls = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "sports-reference.com/cbb/players/" not in line:
                print(f"  Skipping unrecognised line: {line}")
                continue
            urls.append(line)
    return urls


# ── Scraping ───────────────────────────────────────────────────────────────────

def fetch_page(url):
    resp = requests.get(url, headers=HEADERS, timeout=30)
    if resp.status_code == 429:
        print("    Rate-limited. Waiting 60s...")
        time.sleep(60)
        resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    # BBRef hides many tables in HTML comments — strip them so pandas can see them
    html = re.sub(r"<!--(.*?)-->", r"\1", resp.text, flags=re.DOTALL)
    return html


def parse_name(soup):
    tag = soup.find("h1", {"itemprop": "name"})
    if tag:
        return tag.get_text(strip=True)
    tag = soup.find("h1")
    return tag.get_text(strip=True) if tag else "Unknown"


def parse_bio(soup):
    """Extract team, position, and class year from the player bio."""
    team, pos, yr = "", "", ""

    bio = soup.find("div", {"id": "info"})
    if not bio:
        return team, pos, yr

    text = bio.get_text(" ", strip=True)

    # Position
    pos_match = re.search(r"Position[:\s]+([A-Z\-]+)", text)
    if pos_match:
        pos = normalise_pos(pos_match.group(1).strip())

    # Most recent school
    school_links = bio.find_all("a", href=re.compile(r"/cbb/schools/"))
    if school_links:
        team = school_links[-1].get_text(strip=True)

    # Class / eligibility
    class_match = re.search(
        r"\b(FR|SO|JR|SR|GR|Freshman|Sophomore|Junior|Senior|Graduate)\b", text, re.I
    )
    if class_match:
        yr = normalise_class(class_match.group(1))

    return team, pos, yr

def get_most_recent_row(df, year):
    """Return the row matching the given season year, e.g. 2026 → '2025-26'."""
    # Convert 2026 → "2025-26"
    season_str = f"{year - 1}-{str(year)[-2:]}"
    
    match = df[df["Season"].astype(str).str.startswith(season_str)]
    
    if match.empty:
        print(f"    ⚠  No row found for {season_str}, falling back to last row")
        return df.iloc[-1]
    
    return match.iloc[-1]

def parse_table(html, table_id):
    """Return the last (most recent) data row of a stats table as a Series."""
    try:
        dfs = pd.read_html(StringIO(html), attrs={"id": table_id})
    except Exception:
        return None

    if not dfs:
        return None

    df = dfs[0]
    df.columns = [str(c).strip() for c in df.columns]

    # Drop repeated header rows and career/summary rows
    if "Season" in df.columns:
        df = df[df["Season"].notna()].copy()
        df = df[~df["Season"].astype(str).str.contains("Career|Season", na=False)].copy()
        df = df[df["Season"].astype(str).str.startswith("2025-26")].copy()
    if df.empty:
        return None
    
    # print(df.iloc[0])

    # print(df.iloc[-1])

    return df.iloc[-1]   # most recent season


# ── Build one output row ───────────────────────────────────────────────────────

def scrape_player(url):
    html = fetch_page(url)
    soup = BeautifulSoup(html, "html.parser")

    name          = parse_name(soup)
    team, pos, yr = parse_bio(soup)
    pg            = parse_table(html, "players_per_game")
    adv           = parse_table(html, "players_advanced")
    totals        = parse_table(html, "players_totals")

    if pg is None:
        print(f"    ⚠  No per-game table found — skipping {name}")
        return None

    # ── Per-game stats ────────────────────────────────────────────────
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

    # ── Total stats ────────────────────────────────────────────────
    if totals is not None:
        tgp  = safe_float(totals.get("G",   0))
        tgs  = safe_float(totals.get("GS",  0))
        tmp  = safe_float(totals.get("MP",  0))
        tfg  = safe_float(totals.get("FG",  0))
        tfga = safe_float(totals.get("FGA", 0))
        tft  = safe_float(totals.get("FT",  0))
        t3p  = safe_float(totals.get("3P",  0))

        tov  = safe_float(totals.get("TOV", 0))
        tblk = safe_float(totals.get("BLK", 0))
        tstl = safe_float(totals.get("STL", 0))
        trb  = safe_float(totals.get("TRB", 0))
        tast = safe_float(totals.get("AST", 0))
        tpts = safe_float(totals.get("PTS", 0))

    # ── Derived stats ─────────────────────────────────────────────────
    ast_tov = calc_ast_tov(apg, tpg)
    stl_40  = per40(spg,  mpg)
    blk_40  = per40(bpg,  mpg)
    drb_40  = per40(drpg, mpg)
    orb_40  = per40(orpg, mpg)
    trb_40  = per40(rpg,  mpg)
    atr     = (apg / (apg + rpg)) * 100 if (apg + rpg) > 0 else 0.0

    # USG% from advanced table
    usg = 0.0
    if adv is not None and "USG%" in adv.index:
        usg = safe_float(adv.get("USG%", 0))
        if usg <= 1.5:
            usg *= 100
        usg = round(usg, 1)

    # Fallback: team/pos/yr from per-game table columns if bio parse missed them
    if not team:
        team = str(pg.get("School", "")).strip()
    if not pos:
        pos = normalise_pos(pg.get("Pos", "G"))
    if not yr:
        yr = normalise_class(pg.get("Class", ""))

    row = {
        "Name":                  name,
        "Team":                  team,
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

    print(f"    ✓ {name} | {team} | {pos} | {yr} | {ppg} PPG / {rpg} RPG / {apg} APG")
    return row


# ── Auto-tagging ───────────────────────────────────────────────────────────────

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


# ── Output ─────────────────────────────────────────────────────────────────────

def write_csv(rows, output_path):
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=APP_CSV_HEADERS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"\n✓ Wrote {len(rows)} players → {output_path}")


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Scrape BBRef player pages → BeyondThePortal CSV")
    p.add_argument("--players", default="players.txt",
                   help="Text file with one BBRef URL per line (default: players.txt)")
    p.add_argument("--year", type=int, default=2026,
               help="Season year to pull, e.g. 2026 for the 2025-26 season")
    p.add_argument("--output",  default="data/BeyondThePortal_GM_Tool - Import_Board.csv",
                   help="Output CSV path")
    
    return p.parse_args()


def main():
    args = parse_args()
    urls = load_urls(args.players)

    print(f"\nBeyondThePortal BBRef Scraper")
    print(f"  Players file : {args.players}  ({len(urls)} URLs)")
    print(f"  Output       : {args.output}\n")

    rows = []
    for i, url in enumerate(urls, 1):
        print(f"[{i}/{len(urls)}]")
        try:
            row = scrape_player(url)
            if row:
                rows.append(row)
        except Exception as e:
            print(f"    ✗ Error scraping {url}: {e}")
        if i < len(urls):
            time.sleep(REQUEST_DELAY)

    if not rows:
        sys.exit("No rows scraped — check your players.txt URLs.")

    write_csv(rows, args.output)
    print("\nDone! Open Market values and scores (CDI/DDS/SEI/SMI/RIS) are blank — fill with your model.")


if __name__ == "__main__":
    main()
