"""
scraper.py — Basketball-Reference → BeyondThePortal CSV
=========================================================
Scrapes per-game college stats from sports-reference.com/cbb
and outputs a CSV that drops directly into:
    data/BeyondThePortal_GM_Tool - Import_Board.csv

Usage:
    pip install requests pandas lxml
    python scraper.py                        # defaults to current season
    python scraper.py --year 2025            # specific season
    python scraper.py --year 2025 --min-mpg 15 --min-games 10
    python scraper.py --players "Zaccharie Risacher,Cooper Flagg"  # specific players
"""

import argparse
import math
import re
import sys
import time
import os
import csv
from io import StringIO

try:
    import requests
    import pandas as pd
except ImportError:
    sys.exit(
        "Missing dependencies. Run:  pip install requests pandas lxml"
    )

# ── Constants ──────────────────────────────────────────────────────────────────

BASE_URL = "https://www.sports-reference.com/cbb"

# Map BBRef column names → your app's CSV headers
# BBRef per-game columns (as of 2024-25 season):
#   Rk, Player, Class, Pos, School (Team), Conf, G, GS, MP,
#   FG, FGA, FG%, 2P, 2PA, 2P%, 3P, 3PA, 3P%,
#   FT, FTA, FT%, ORB, DRB, TRB, AST, STL, BLK, TOV, PF, PTS

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

# BBRef class strings → app year strings
CLASS_MAP = {
    "FR": "Freshman",
    "SO": "Sophomore",
    "JR": "Junior",
    "SR": "Senior",
    "GR": "Senior",   # Graduate = Senior for our purposes
    # Sometimes spelled out
    "Freshman":  "Freshman",
    "Sophomore": "Sophomore",
    "Junior":    "Junior",
    "Senior":    "Senior",
}

# Position normalisation → app uses Guard / Wing / Big
POS_MAP = {
    "G":   "Guard",
    "G-F": "Wing",
    "F-G": "Wing",
    "F":   "Wing",
    "F-C": "Big",
    "C-F": "Big",
    "C":   "Big",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

REQUEST_DELAY = 4  # seconds between requests — BBRef rate-limits hard

# ── Helpers ────────────────────────────────────────────────────────────────────

def safe_float(val, default=0.0):
    try:
        return float(str(val).strip().replace("%", "").replace(",", ""))
    except (ValueError, TypeError):
        return default


def pct_str(val):
    """Format a 0-1 float as a percentage string like '53.7%'"""
    if val is None or math.isnan(val):
        return "0.00%"
    return f"{val * 100:.2f}%"


def fmt_currency(val):
    """Format a dollar value as '$1,088,875.43'"""
    if not val:
        return ""
    return f"${val:,.2f}"


def calc_ts_pct(pts, fga, fta):
    """True Shooting % = PTS / (2 * (FGA + 0.44*FTA))"""
    denom = 2 * (fga + 0.44 * fta)
    if denom == 0:
        return 0.0
    return pts / denom


def calc_usg(fga, fta, tov, team_fga, team_fta, team_tov, mp, team_mp):
    """
    USG% = 100 * ((FGA + 0.44*FTA + TOV) * (Team_MP/5))
              / (MP * (Team_FGA + 0.44*Team_FTA + Team_TOV))
    BBRef provides USG% directly on advanced pages; this is the fallback.
    """
    player_pos = fga + 0.44 * fta + tov
    team_pos   = team_fga + 0.44 * team_fta + team_tov
    if team_pos == 0 or mp == 0:
        return 0.0
    return 100 * (player_pos * (team_mp / 5)) / (mp * team_pos)


def calc_ast_tov(ast, tov):
    if tov == 0:
        return round(ast, 1) if ast else 0.0
    return round(ast / tov, 1)


def per40(stat, mp):
    """Scale a per-game stat to per-40-minutes."""
    if mp == 0:
        return 0.0
    return round((stat / mp) * 40, 1)


def normalise_pos(bbref_pos):
    raw = str(bbref_pos).strip().upper()
    # Try direct map first
    if raw in POS_MAP:
        return POS_MAP[raw]
    # Partial matches
    if raw.startswith("C"):
        return "Big"
    if raw.startswith("F"):
        return "Wing"
    return "Guard"


def normalise_class(bbref_class):
    raw = str(bbref_class).strip()
    return CLASS_MAP.get(raw, raw)  # fall back to original if unknown


# ── Scraping ───────────────────────────────────────────────────────────────────

def fetch_season_per_game(year: int) -> pd.DataFrame:
    """
    Fetch the per-game stats table for a given season.
    BBRef season year = the ending year (e.g. 2024-25 → year=2025).
    Table id: 'players_per_game'
    """
    url = f"{BASE_URL}/seasons/men/{year}-per-game.html"
    print(f"  Fetching season per-game table: {url}")

    resp = requests.get(url, headers=HEADERS, timeout=30)
    if resp.status_code == 429:
        print("  Rate-limited (429). Waiting 60s...")
        time.sleep(60)
        resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    # BBRef wraps some tables in HTML comments; strip them so pandas can see the table
    html = resp.text
    html = re.sub(r"<!--(.*?)-->", r"\1", html, flags=re.DOTALL)

    dfs = pd.read_html(StringIO(html), attrs={"id": "players_per_game"})
    if not dfs:
        raise ValueError(f"Could not find 'players_per_game' table at {url}")

    df = dfs[0]

    # BBRef repeats the header row every ~20 rows — drop them
    df = df[df["Player"] != "Player"].copy()
    df = df[df["Player"].notna()].copy()
    df.reset_index(drop=True, inplace=True)

    return df


def fetch_advanced(year: int) -> pd.DataFrame:
    """
    Fetch the advanced stats table (gives us USG% directly).
    Table id: 'players_advanced'
    """
    url = f"{BASE_URL}/seasons/men/{year}-advanced.html"
    print(f"  Fetching advanced table:        {url}")
    time.sleep(REQUEST_DELAY)

    resp = requests.get(url, headers=HEADERS, timeout=30)
    if resp.status_code == 429:
        print("  Rate-limited (429). Waiting 60s...")
        time.sleep(60)
        resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    html = re.sub(r"<!--(.*?)-->", r"\1", resp.text, flags=re.DOTALL)

    dfs = pd.read_html(StringIO(html), attrs={"id": "players_advanced"})
    if not dfs:
        raise ValueError(f"Could not find 'players_advanced' table at {url}")

    df = dfs[0]
    df = df[df["Player"] != "Player"].copy()
    df = df[df["Player"].notna()].copy()
    df.reset_index(drop=True, inplace=True)

    return df


# ── Building rows ──────────────────────────────────────────────────────────────

def build_rows(pg: pd.DataFrame, adv: pd.DataFrame, args) -> list[dict]:
    """
    Merge per-game + advanced, apply filters, and build app-format rows.
    """

    # Normalise column names (BBRef sometimes adds suffixes on multi-team players)
    pg.columns  = [str(c).strip() for c in pg.columns]
    adv.columns = [str(c).strip() for c in adv.columns]

    # Merge on Player + School so multi-team rows are handled
    # Keep the "TOT" (total) row for players who transferred mid-season
    pg_tot  = pg.copy()
    adv_tot = adv.copy()

    # If a player appears multiple times (different teams), keep the TOT row
    # BBRef marks the combined row with School="TOT"
    def dedup(df):
        if "School" not in df.columns:
            return df
        has_tot = df[df["School"] == "TOT"]["Player"].unique()
        mask = ~((df["School"] != "TOT") & (df["Player"].isin(has_tot)))
        return df[mask].copy()

    pg_tot  = dedup(pg_tot)
    adv_tot = dedup(adv_tot)

    # Merge — use left join so we always keep per-game rows
    # Advanced may have extra columns; take USG% from there
    adv_cols = ["Player", "School", "USG%"] if "USG%" in adv_tot.columns else ["Player", "School"]
    merged = pg_tot.merge(
        adv_tot[adv_cols].drop_duplicates(subset=["Player", "School"]),
        on=["Player", "School"],
        how="left",
    )

    rows = []
    skipped = 0

    for _, r in merged.iterrows():
        name = str(r.get("Player", "")).strip()
        if not name:
            continue

        # ── Filters ──────────────────────────────────────────────────
        games = safe_float(r.get("G", 0))
        mpg   = safe_float(r.get("MP", 0))

        if games < args.min_games:
            skipped += 1
            continue
        if mpg < args.min_mpg:
            skipped += 1
            continue

        # Specific player filter
        if args.players:
            target_names = [n.strip().lower() for n in args.players.split(",")]
            if not any(t in name.lower() for t in target_names):
                continue

        # ── Stats ─────────────────────────────────────────────────────
        ppg  = safe_float(r.get("PTS",  0))
        rpg  = safe_float(r.get("TRB",  0))
        apg  = safe_float(r.get("AST",  0))
        spg  = safe_float(r.get("STL",  0))
        bpg  = safe_float(r.get("BLK",  0))
        tpg  = safe_float(r.get("TOV",  0))
        orpg = safe_float(r.get("ORB",  0))
        drpg = safe_float(r.get("DRB",  0))
        fga  = safe_float(r.get("FGA",  0))
        fta  = safe_float(r.get("FTA",  0))
        tpa  = safe_float(r.get("3PA",  0))

        fg_pct = safe_float(r.get("FG%", 0))   # already 0-1 in BBRef
        ft_pct = safe_float(r.get("FT%", 0))
        tp_pct = safe_float(r.get("3P%", 0))

        # BBRef stores FG% as 0-1 (e.g. 0.537), not 53.7
        # Detect and normalise
        if fg_pct > 1.5:   # already in percent form (e.g. 53.7)
            fg_pct /= 100
        if ft_pct > 1.5:
            ft_pct /= 100
        if tp_pct > 1.5:
            tp_pct /= 100

        # USG% — prefer advanced table value
        usg_raw = safe_float(r.get("USG%", 0))
        if usg_raw > 1.5:
            usg = round(usg_raw, 1)        # already in percent form
        elif usg_raw > 0:
            usg = round(usg_raw * 100, 1)  # convert 0-1 → percent
        else:
            usg = 0.0

        # ATR% = Assist-to-Rebound ratio (not a BBRef stat — derive it)
        # Your CSV shows values like 65.7%, which = AST / (AST + REB) * 100
        # (this is a proxy for playmaking vs. rebounding role)
        atr = (apg / (apg + rpg)) * 100 if (apg + rpg) > 0 else 0.0

        ast_tov = calc_ast_tov(apg, tpg)
        stl_40  = per40(spg,  mpg)
        blk_40  = per40(bpg,  mpg)
        drb_40  = per40(drpg, mpg)
        orb_40  = per40(orpg, mpg)
        trb_40  = per40(rpg,  mpg)

        # ── Identity ──────────────────────────────────────────────────
        team = str(r.get("School", "")).strip()
        pos  = normalise_pos(r.get("Pos", "G"))
        yr   = normalise_class(r.get("Class", ""))

        # ── Proprietary fields (leave blank — you fill these) ─────────
        # Market values, CDI/DDS/SEI/SMI/RIS scores, and tags are your IP.
        # The scraper outputs empty strings so you can fill them manually
        # or via your valuation model.

        row = {
            "Name":                name,
            "Team":                team,
            "Primary Position":    pos,
            "Year":                yr,
            "USG%":                usg,
            "PPG":                 round(ppg,  1),
            "REB/G":               round(rpg,  1),
            "AST/G":               round(apg,  1),
            "3PA/G":               round(tpa,  1),
            "AST/TOV":             ast_tov,
            "STL/40":              stl_40,
            "BLK/40":              blk_40,
            "DRB/40":              drb_40,
            "ORB/40":              orb_40,
            "TRB/40":              trb_40,
            "FG%":                 pct_str(fg_pct),
            "ATR%":                f"{atr:.1f}%",
            "FT%":                 pct_str(ft_pct),
            "3P%":                 pct_str(tp_pct),
            "Open Market Low":     "",   # ← your valuation model
            "Open Market High":    "",   # ← your valuation model
            "CDI":                 "",
            "DDS":                 "",
            "SEI":                 "",
            "SMI":                 "",
            "RIS":                 "",
            "Playmaker Tags":      "",   # ← auto-tag logic below (optional)
            "Shooting/Scoring Tags": "",
        }

        # ── Optional: basic auto-tagging ──────────────────────────────
        # These are rough heuristics to give you a starting point.
        # Your manual tagging will be more nuanced.
        row["Playmaker Tags"]        = auto_playmaker_tag(apg, ast_tov, usg)
        row["Shooting/Scoring Tags"] = auto_shooting_tag(tp_pct, ppg, fg_pct, ft_pct, usg)

        rows.append(row)

    print(f"  Rows kept: {len(rows)}  |  Filtered out: {skipped}")
    return rows


# ── Auto-tagging (optional heuristics) ────────────────────────────────────────

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


def auto_shooting_tag(tp_pct, ppg, fg_pct, ft_pct, usg):
    tags = []
    if tp_pct >= 0.38 and usg < 22:
        tags.append("Elite Shooter")
        tags.append("Low-USG Finisher")
    elif tp_pct >= 0.35:
        tags.append("Shooter")
    if ppg >= 18 or usg >= 28:
        tags.append("Volume Scorer")
    if fg_pct >= 0.56 and ft_pct >= 0.72:
        tags.append("Efficient Scorer")
    if not tags:
        tags.append("Non-Shooter")
    return ", ".join(tags)


# ── Output ─────────────────────────────────────────────────────────────────────

def write_csv(rows: list[dict], output_path: str):
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=APP_CSV_HEADERS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"\n  ✓ Wrote {len(rows)} players to: {output_path}")


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args():
    import datetime
    current_month = datetime.date.today().month
    # BBRef season year = calendar year of spring semester
    default_year = datetime.date.today().year if current_month >= 10 else datetime.date.today().year

    p = argparse.ArgumentParser(description="Scrape BBRef college stats → BeyondThePortal CSV")
    p.add_argument("--year",      type=int,   default=default_year,
                   help="Season end year, e.g. 2025 for the 2024-25 season (default: current season)")
    p.add_argument("--min-mpg",   type=float, default=10.0,
                   help="Minimum minutes per game filter (default: 10)")
    p.add_argument("--min-games", type=int,   default=5,
                   help="Minimum games played filter (default: 5)")
    p.add_argument("--players",   type=str,   default=None,
                   help="Comma-separated list of player names to filter to (partial match OK)")
    p.add_argument("--output",    type=str,
                   default="data/BeyondThePortal_GM_Tool - Import_Board.csv",
                   help="Output CSV path (default: data/BeyondThePortal_GM_Tool - Import_Board.csv)")
    return p.parse_args()


def main():
    args = parse_args()

    print(f"\nBeyondThePortal BBRef Scraper")
    print(f"  Season: {args.year - 1}-{str(args.year)[-2:]}")
    print(f"  Filters: min {args.min_games} games, min {args.min_mpg} MPG")
    if args.players:
        print(f"  Player filter: {args.players}")
    print()

    print("Step 1/3  Fetching per-game stats...")
    pg = fetch_season_per_game(args.year)
    print(f"           {len(pg)} rows retrieved")

    time.sleep(REQUEST_DELAY)

    print("Step 2/3  Fetching advanced stats (USG%)...")
    try:
        adv = fetch_advanced(args.year)
        print(f"           {len(adv)} rows retrieved")
    except Exception as e:
        print(f"           Warning: could not fetch advanced table ({e})")
        print(f"           USG% will default to 0 — you can fill it manually")
        adv = pd.DataFrame(columns=["Player", "School"])

    print("Step 3/3  Building output rows...")
    rows = build_rows(pg, adv, args)

    write_csv(rows, args.output)

    print("\nDone! Drop the CSV into your /data folder and reload the app.")
    print("\nNote: Open Market values and proprietary scores (CDI/DDS/SEI/SMI/RIS)")
    print("      are left blank — populate them with your valuation model.")


if __name__ == "__main__":
    main()
