"""
liga_u_scraper.py — RealGM Spanish Liga U stats scraper
========================================================
Scrapes per-game, totals, per-36, and advanced stats for every player
in the Spanish Liga U from basketball.realgm.com.

Usage:
    # Write to CSV only
    python liga_u_scraper.py --out data/liga_u.csv

    # Write to Supabase only
    python liga_u_scraper.py --supabase

    # Advanced stats, write both
    python liga_u_scraper.py --stat-type Advanced_Stats --supabase --out data/liga_u_adv.csv

    # Multiple seasons
    python liga_u_scraper.py --seasons 2025 2026 --stat-type Averages --supabase

Dependencies:
    pip install curl_cffi beautifulsoup4 lxml supabase
"""

import argparse
import csv
import os
import re
import time
import logging
from typing import Iterator

from curl_cffi import requests as curl_requests
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────

LEAGUE_ID    = 164
LEAGUE_SLUG  = "Spanish-Liga-U"
LEAGUE_NAME  = "Spanish Liga U"

BASE_URL = "https://basketball.realgm.com"

STAT_TYPES   = ["Averages", "Totals", "Per_36", "Advanced_Stats"]
QUALIFIERS   = ["Qualified", "All"]
SEASON_TYPES = ["Regular_Season", "Playoffs"]

REQUEST_DELAY = 2.0
MAX_PAGES     = 50

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


# ── URL builder ───────────────────────────────────────────────────────────────

def stats_url(
    season: int,
    stat_type: str = "Averages",
    qualifier: str = "Qualified",
    page: int = 1,
    season_type: str = "Regular_Season",
) -> str:
    return (
        f"{BASE_URL}/international/league/{LEAGUE_ID}/{LEAGUE_SLUG}"
        f"/stats/{season}/{stat_type}/{qualifier}/All/points/All/desc/{page}/{season_type}"
    )


# ── HTTP ──────────────────────────────────────────────────────────────────────

session = curl_requests.Session(impersonate="chrome124")


def warm_up_session() -> None:
    try:
        log.info("Warming up session on RealGM homepage...")
        session.get(BASE_URL, timeout=15)
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.warning(f"Warm-up failed (continuing anyway): {e}")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        log.info(f"GET {url}")
        r = session.get(url, timeout=15)
        r.raise_for_status()
        time.sleep(REQUEST_DELAY)
        return BeautifulSoup(r.text, "lxml")
    except Exception as e:
        log.error(f"Request failed: {e}")
        return None


# ── Parsing ───────────────────────────────────────────────────────────────────

def parse_rows(
    soup: BeautifulSoup,
    season: int,
    stat_type: str,
    season_type: str,
    debug_html: str | None = None,
) -> list[dict]:
    """Parse all player rows from the stats table on this page."""
    # Try tablesaw first, then fall back to any table with a thead
    table = (
        soup.find("table", class_=lambda c: c and "tablesaw" in c)
        or soup.find("table", id=lambda i: i and "stats" in (i or "").lower())
        or next((t for t in soup.find_all("table") if t.find("thead")), None)
    )
    if not table:
        if debug_html:
            with open(debug_html, "w", encoding="utf-8") as f:
                f.write(soup.prettify())
            log.warning(f"No table found — saved raw HTML to {debug_html}")
        else:
            log.warning("No table found. Re-run with --save-html debug.html to inspect the page.")
        return []

    col_headers = [th.get_text(strip=True).lower() for th in table.select("thead th")]
    rows = []

    for tr in table.select("tbody tr"):
        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
        if not cells or len(cells) < 3:
            continue

        raw = dict(zip(col_headers, cells))

        # Separate identity fields from stat columns
        player_name = raw.get("player") or raw.get("name") or ""
        team        = raw.get("team", "")

        # Everything that isn't identity is a stat
        stat_cols = {k: v for k, v in raw.items() if k not in ("player", "name", "team", "#", "rank")}

        row = {
            "player_name": player_name,
            "league":      LEAGUE_NAME,
            "season":      season,
            "season_type": season_type,
            "stat_type":   stat_type,
            "team":        team,
            "stats":       stat_cols,
        }

        # Grab profile URL — try data-th, data-title, then first td with a link
        name_td = (
            tr.find("td", {"data-th":    lambda t: t and "player" in t.lower()})
            or tr.find("td", {"data-title": lambda t: t and "player" in t.lower()})
            or next((td for td in tr.find_all("td") if td.find("a", href=lambda h: h and "/player/" in h)), None)
        )
        if name_td and name_td.find("a"):
            row["profile_url"] = BASE_URL + name_td.find("a")["href"]

        rows.append(row)

    return rows


def splits_url(profile_url: str, season: int) -> str | None:
    """Derive a player's international splits URL from their RealGM profile URL."""
    m = re.search(r"/player/([^/]+)/[^/]+/(\d+)", profile_url)
    if not m:
        return None
    name_slug, player_id = m.group(1), m.group(2)
    return (
        f"{BASE_URL}/player/{name_slug}/International/{player_id}"
        f"/{season}/By_Season/Per_Game/{LEAGUE_ID}/{LEAGUE_SLUG}"
    )


def parse_splits(soup: BeautifulSoup) -> list[dict]:
    """Parse the splits/season-breakdown table from a player's international page."""
    table = (
        soup.find("table", class_=lambda c: c and "tablesaw" in c)
        or next((t for t in soup.find_all("table") if t.find("thead")), None)
    )
    if not table:
        return []

    headers = [th.get_text(strip=True).lower() for th in table.select("thead th")]
    rows = []
    for tr in table.select("tbody tr"):
        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
        if not cells or len(cells) < 3:
            continue
        rows.append(dict(zip(headers, cells)))
    return rows


def scrape_splits(rows: list[dict], season: int) -> list[dict]:
    """
    Visit each unique player's splits page and return split records.
    Deduplicates by profile_url so multi-stat-type runs don't double-fetch.
    """
    seen: dict[str, str] = {}
    for r in rows:
        url = r.get("profile_url")
        if url and url not in seen:
            seen[url] = r["player_name"]

    missing = [r["player_name"] for r in rows if not r.get("profile_url")]
    if missing:
        log.warning(f"{len(missing)} player(s) had no profile_url: {missing[:5]}{'...' if len(missing) > 5 else ''}")
    log.info(f"Scraping splits for {len(seen)} unique player(s).")

    if not seen:
        log.error("No profile URLs found — splits cannot be fetched. Check parse_rows is capturing links.")
        return []

    split_records = []
    total = len(seen)
    for i, (profile_url, player_name) in enumerate(seen.items(), 1):
        url = splits_url(profile_url, season)
        if not url:
            log.warning(f"Could not derive splits URL for {player_name}")
            continue
        log.info(f"[{i}/{total}] Splits: {player_name}")
        soup = fetch(url)
        if not soup:
            log.warning(f"  Failed to fetch splits for {player_name}")
            continue
        splits = parse_splits(soup)
        log.info(f"  {len(splits)} split row(s)")
        for s in splits:
            split_records.append({
                "player_name": player_name,
                "profile_url": profile_url,
                "league":      LEAGUE_NAME,
                "season":      season,
                "split_stats": s,
            })

    return split_records


def has_next_page(soup: BeautifulSoup, current_page: int) -> bool:
    """Return True if a next page exists in the pagination."""
    pagination = soup.find("div", class_="pages")
    if not pagination:
        return False
    for link in pagination.find_all("a"):
        if f"/{current_page + 1}" in link.get("href", ""):
            return True
    return False


# ── Core scraper ──────────────────────────────────────────────────────────────

def scrape_season(
    season: int,
    stat_type: str = "Averages",
    qualifier: str = "Qualified",
    season_type: str = "Regular_Season",
    debug_html: str | None = None,
) -> Iterator[dict]:
    """Yield all player rows for a single season, paginating automatically."""
    for page in range(1, MAX_PAGES + 1):
        url  = stats_url(season, stat_type, qualifier, page, season_type)
        soup = fetch(url)

        if soup is None:
            log.warning(f"Failed to fetch page {page}, stopping.")
            break

        # Only save debug HTML on first page
        save_path = debug_html if page == 1 else None
        rows = parse_rows(soup, season, stat_type, season_type, debug_html=save_path)
        if not rows:
            log.info(f"No rows on page {page}, done with season {season}.")
            break

        log.info(f"  Season {season} page {page}: {len(rows)} players")
        yield from rows

        if not has_next_page(soup, page):
            break


def scrape(
    seasons: list[int],
    stat_type: str = "Averages",
    qualifier: str = "Qualified",
    season_type: str = "Regular_Season",
    debug_html: str | None = None,
) -> list[dict]:
    """Scrape all seasons and return a flat list of player rows."""
    warm_up_session()
    all_rows = []
    for season in seasons:
        all_rows.extend(scrape_season(season, stat_type, qualifier, season_type, debug_html))
    return all_rows


# ── Output: CSV ───────────────────────────────────────────────────────────────

def write_csv(rows: list[dict], path: str) -> None:
    if not rows:
        log.warning("No data to write.")
        return
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    # Flatten stats dict into top-level columns for CSV
    flat = []
    all_stat_keys: list[str] = []
    for r in rows:
        for k in r.get("stats", {}):
            if k not in all_stat_keys:
                all_stat_keys.append(k)
    for r in rows:
        row = {k: v for k, v in r.items() if k not in ("stats", "profile_url")}
        for k in all_stat_keys:
            row[k] = r.get("stats", {}).get(k, "")
        flat.append(row)

    keys = [k for k in flat[0].keys()]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(flat)
    log.info(f"Wrote {len(flat)} rows to {path}")


# ── Output: CSV (splits) ─────────────────────────────────────────────────────

def write_splits_csv(split_records: list[dict], path: str) -> None:
    if not split_records:
        log.warning("No splits data to write.")
        return
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

    all_stat_keys: list[str] = []
    for r in split_records:
        for k in r.get("split_stats", {}):
            if k not in all_stat_keys:
                all_stat_keys.append(k)

    flat = []
    for r in split_records:
        row = {k: v for k, v in r.items() if k not in ("split_stats", "profile_url")}
        for k in all_stat_keys:
            row[k] = r.get("split_stats", {}).get(k, "")
        flat.append(row)

    keys = list(flat[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(flat)
    log.info(f"Wrote {len(flat)} split rows to {path}")


# ── Output: Supabase ──────────────────────────────────────────────────────────

def write_supabase(rows: list[dict], url: str, key: str) -> None:
    """
    Upsert scraped rows into:
      - international_players  (upsert by name + league)
      - international_players_stats (upsert by player_name + league + season + season_type + stat_type + team)
    """
    from supabase import create_client

    if not rows:
        log.warning("No data to write.")
        return

    sb = create_client(url, key)

    # ── 1. Upsert players ──────────────────────────────────────────────────────
    player_records = {}
    for r in rows:
        key_tuple = (r["player_name"], r["league"])
        if key_tuple not in player_records:
            player_records[key_tuple] = {
                "name":        r["player_name"],
                "league":      r["league"],
                "profile_url": r.get("profile_url"),
            }

    players_to_upsert = list(player_records.values())
    log.info(f"Upserting {len(players_to_upsert)} players into international_players...")
    sb.table("international_players").upsert(
        players_to_upsert,
        on_conflict="name,league",
    ).execute()

    # ── 2. Fetch player IDs ────────────────────────────────────────────────────
    result = sb.table("international_players").select("id,name").eq("league", rows[0]["league"]).execute()
    id_map = {p["name"]: p["id"] for p in result.data}

    # ── 3. Upsert stats ────────────────────────────────────────────────────────
    stats_records = []
    for r in rows:
        stats_records.append({
            "player_id":   id_map.get(r["player_name"]),
            "player_name": r["player_name"],
            "league":      r["league"],
            "season":      r["season"],
            "season_type": r["season_type"],
            "stat_type":   r["stat_type"],
            "team":        r.get("team"),
            "stats":       r.get("stats", {}),
        })

    log.info(f"Upserting {len(stats_records)} stat rows into international_players_stats...")
    # Batch in chunks of 500 to avoid payload limits
    chunk_size = 500
    for i in range(0, len(stats_records), chunk_size):
        chunk = stats_records[i : i + chunk_size]
        sb.table("international_players_stats").upsert(
            chunk,
            on_conflict="player_name,league,season,season_type,stat_type,team",
        ).execute()
        log.info(f"  Upserted rows {i+1}–{min(i+chunk_size, len(stats_records))}")

    log.info("Supabase write complete.")


def write_supabase_splits(split_records: list[dict], url: str, key: str) -> None:
    """
    Upsert split records into international_players_splits.
    'split' is extracted as a top-level column; remaining stats go into a JSONB blob.
    Unique key: (player_name, league, season, split).
    """
    from supabase import create_client

    if not split_records:
        log.warning("No splits data to write.")
        return

    sb = create_client(url, key)

    # Fetch player UUIDs for all names in this batch
    names = list({r["player_name"] for r in split_records})
    result = sb.table("international_players").select("id,name").in_("name", names).execute()
    id_map = {p["name"]: p["id"] for p in (result.data or [])}

    records = []
    for r in split_records:
        stats = dict(r.get("split_stats", {}))
        # Pull 'split' out as a top-level column so it can be used in the unique key
        split_label = stats.pop("split", None)
        records.append({
            "player_id":   id_map.get(r["player_name"]),
            "player_name": r["player_name"],
            "league":      r["league"],
            "season":      r["season"],
            "split":       split_label,
            "team":        stats.pop("team", None),
            "stats":       stats,  # remaining per-game numbers as JSONB
        })

    log.info(f"Upserting {len(records)} split rows into international_players_splits...")
    chunk_size = 500
    for i in range(0, len(records), chunk_size):
        chunk = records[i : i + chunk_size]
        try:
            resp = sb.table("international_players_splits").upsert(
                chunk,
                on_conflict="player_name,league,season,split",
            ).execute()
            if hasattr(resp, "error") and resp.error:
                log.error(f"  Supabase error on chunk {i//chunk_size + 1}: {resp.error}")
            else:
                log.info(f"  Upserted rows {i+1}–{min(i+chunk_size, len(records))}")
        except Exception as e:
            log.error(f"  Exception on chunk {i//chunk_size + 1}: {e}")

    log.info("Splits Supabase write complete.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Scrape RealGM Spanish Liga U stats")
    parser.add_argument("--season",      type=int, default=2026,
                        help="Season year (default: 2026)")
    parser.add_argument("--seasons",     type=int, nargs="+",
                        help="Multiple seasons e.g. --seasons 2024 2025 2026")
    parser.add_argument("--stat-type",   default="Averages", choices=STAT_TYPES,
                        help="Stat type (default: Averages)")
    parser.add_argument("--qualifier",   default="Qualified", choices=QUALIFIERS,
                        help="Qualified or All (default: Qualified)")
    parser.add_argument("--season-type", default="Regular_Season", choices=SEASON_TYPES,
                        help="Regular_Season or Playoffs (default: Regular_Season)")
    parser.add_argument("--out",         default=None,
                        help="Output CSV path for main stats (omit to skip CSV)")
    parser.add_argument("--splits",      action="store_true",
                        help="Also scrape each player's individual splits page")
    parser.add_argument("--splits-out",  default=None, metavar="FILE",
                        help="Output CSV path for splits data")
    parser.add_argument("--save-html",   default=None, metavar="FILE",
                        help="Save raw HTML of first page to FILE for debugging")
    parser.add_argument("--supabase",    action="store_true",
                        help="Write results to Supabase tables")
    parser.add_argument("--supabase-url", default=os.environ.get("SUPABASE_URL"),
                        help="Supabase project URL (or set SUPABASE_URL env var)")
    parser.add_argument("--supabase-key", default=os.environ.get("SUPABASE_SERVICE_KEY"),
                        help="Supabase service role key (or set SUPABASE_SERVICE_KEY env var)")
    args = parser.parse_args()

    if not args.out and not args.supabase and not args.splits_out:
        parser.error("Specify at least --out <file.csv>, --splits-out <file.csv>, or --supabase (or a combination).")

    seasons = args.seasons if args.seasons else [args.season]
    rows    = scrape(seasons, args.stat_type, args.qualifier, args.season_type, args.save_html)

    if args.out:
        write_csv(rows, args.out)

    if args.supabase:
        if not args.supabase_url or not args.supabase_key:
            parser.error("--supabase requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars (or --supabase-url / --supabase-key flags).")
        write_supabase(rows, args.supabase_url, args.supabase_key)

    if args.splits or args.splits_out:
        # Splits are per-season — use the first season if multiple were given
        split_season = seasons[0]
        if len(seasons) > 1:
            log.warning(f"Splits only supports one season at a time; using {split_season}.")
        split_records = scrape_splits(rows, split_season)

        if args.splits_out:
            write_splits_csv(split_records, args.splits_out)

        if args.supabase:
            write_supabase_splits(split_records, args.supabase_url, args.supabase_key)


if __name__ == "__main__":
    main()
