"""
realgm_league_scraper.py — Generalised RealGM international-league scraper
==========================================================================
Same logic as liga_u_scraper.py but the league is a CLI argument so you can
run it against any RealGM league.

Quick start — test against French LNB Espoirs (defaults):
    # CSV only
    python realgm_league_scraper.py --out data/french_lnb_espoirs.csv

    # Write to Supabase
    python realgm_league_scraper.py --supabase

    # Multiple stat types
    python realgm_league_scraper.py --stat-type Totals    --supabase
    python realgm_league_scraper.py --stat-type Per_36    --supabase
    python realgm_league_scraper.py --stat-type Advanced_Stats --supabase

Pointing at a different league:
    python realgm_league_scraper.py \
      --league-id 164 \
      --league-slug Spanish-Liga-U \
      --league-name "Spanish Liga U" \
      --supabase

Find the league-id and slug in the RealGM URL:
    https://basketball.realgm.com/international/league/<ID>/<SLUG>/players
                                                       ^^^  ^^^^

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
    league_id:   int,
    league_slug: str,
    season:      int,
    stat_type:   str = "Averages",
    qualifier:   str = "Qualified",
    page:        int = 1,
    season_type: str = "Regular_Season",
) -> str:
    return (
        f"{BASE_URL}/international/league/{league_id}/{league_slug}"
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
# We deliberately store RealGM's raw column headers (lowercased) without
# aliasing. The frontend handles per-page header differences (PPG vs PTS, RPG vs
# REB, etc.) so re-scraping isn't required when conventions change.

def parse_rows(
    soup:        BeautifulSoup,
    league_name: str,
    season:      int,
    stat_type:   str,
    season_type: str,
    debug_html:  str | None = None,
) -> list[dict]:
    """Parse all player rows from the stats table on this page."""
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

        player_name = raw.get("player") or raw.get("name") or ""
        team        = raw.get("team", "")

        stat_cols = {k: v for k, v in raw.items() if k not in ("player", "name", "team", "#", "rank")}

        row = {
            "player_name": player_name,
            "league":      league_name,
            "season":      season,
            "season_type": season_type,
            "stat_type":   stat_type,
            "team":        team,
            "stats":       stat_cols,
        }

        name_td = (
            tr.find("td", {"data-th":    lambda t: t and "player" in t.lower()})
            or tr.find("td", {"data-title": lambda t: t and "player" in t.lower()})
            or next((td for td in tr.find_all("td") if td.find("a", href=lambda h: h and "/player/" in h)), None)
        )
        if name_td and name_td.find("a"):
            row["profile_url"] = BASE_URL + name_td.find("a")["href"]

        rows.append(row)

    return rows


def splits_url(profile_url: str, season: int, league_id: int, league_slug: str) -> str | None:
    """Derive a player's international splits URL from their RealGM profile URL."""
    m = re.search(r"/player/([^/]+)/[^/]+/(\d+)", profile_url)
    if not m:
        return None
    name_slug, player_id = m.group(1), m.group(2)
    return (
        f"{BASE_URL}/player/{name_slug}/International/{player_id}"
        f"/{season}/By_Season/Per_Game/{league_id}/{league_slug}"
    )


def parse_splits(soup: BeautifulSoup) -> list[dict]:
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


def scrape_splits(
    rows: list[dict], season: int, league_id: int, league_slug: str, league_name: str,
) -> list[dict]:
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
        log.error("No profile URLs found — splits cannot be fetched.")
        return []

    split_records = []
    total = len(seen)
    for i, (profile_url, player_name) in enumerate(seen.items(), 1):
        url = splits_url(profile_url, season, league_id, league_slug)
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
                "league":      league_name,
                "season":      season,
                "split_stats": s,
            })

    return split_records


def has_next_page(soup: BeautifulSoup, current_page: int) -> bool:
    pagination = soup.find("div", class_="pages")
    if not pagination:
        return False
    for link in pagination.find_all("a"):
        if f"/{current_page + 1}" in link.get("href", ""):
            return True
    return False


# ── Core scraper ──────────────────────────────────────────────────────────────

def scrape_season(
    league_id:   int,
    league_slug: str,
    league_name: str,
    season:      int,
    stat_type:   str = "Averages",
    qualifier:   str = "Qualified",
    season_type: str = "Regular_Season",
    debug_html:  str | None = None,
) -> Iterator[dict]:
    for page in range(1, MAX_PAGES + 1):
        url  = stats_url(league_id, league_slug, season, stat_type, qualifier, page, season_type)
        soup = fetch(url)

        if soup is None:
            log.warning(f"Failed to fetch page {page}, stopping.")
            break

        save_path = debug_html if page == 1 else None
        rows = parse_rows(soup, league_name, season, stat_type, season_type, debug_html=save_path)
        if not rows:
            log.info(f"No rows on page {page}, done with season {season}.")
            break

        log.info(f"  Season {season} page {page}: {len(rows)} players")
        yield from rows

        if not has_next_page(soup, page):
            break


def scrape(
    league_id:   int,
    league_slug: str,
    league_name: str,
    seasons:     list[int],
    stat_type:   str = "Averages",
    qualifier:   str = "Qualified",
    season_type: str = "Regular_Season",
    debug_html:  str | None = None,
) -> list[dict]:
    warm_up_session()
    all_rows = []
    for season in seasons:
        all_rows.extend(scrape_season(
            league_id, league_slug, league_name,
            season, stat_type, qualifier, season_type, debug_html,
        ))
    return all_rows


# ── Output: CSV ───────────────────────────────────────────────────────────────

def write_csv(rows: list[dict], path: str) -> None:
    if not rows:
        log.warning("No data to write.")
        return
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
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

    keys = list(flat[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(flat)
    log.info(f"Wrote {len(flat)} rows to {path}")


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
    from supabase import create_client
    if not rows:
        log.warning("No data to write.")
        return
    sb = create_client(url, key)

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
    sb.table("international_players").upsert(players_to_upsert, on_conflict="name,league").execute()

    result = sb.table("international_players").select("id,name").eq("league", rows[0]["league"]).execute()
    id_map = {p["name"]: p["id"] for p in result.data}

    # Build stat rows, deduping on the unique-key tuple. Postgres rejects an
    # upsert batch that touches the same conflict-target row twice, so if RealGM
    # listed the same (name, league, season, season_type, stat_type, team) more
    # than once (e.g. mid-season trades or split tables) we keep the LAST one.
    stats_by_key = {}
    duplicates = 0
    for r in rows:
        key = (
            r["player_name"], r["league"], r["season"],
            r["season_type"], r["stat_type"], r.get("team"),
        )
        if key in stats_by_key:
            duplicates += 1
        stats_by_key[key] = {
            "player_id":   id_map.get(r["player_name"]),
            "player_name": r["player_name"],
            "league":      r["league"],
            "season":      r["season"],
            "season_type": r["season_type"],
            "stat_type":   r["stat_type"],
            "team":        r.get("team"),
            "stats":       r.get("stats", {}),
        }
    stats_records = list(stats_by_key.values())
    if duplicates:
        log.warning(f"Skipped {duplicates} duplicate stat row(s) (same player+team+season+stat_type appeared multiple times in scrape).")

    log.info(f"Upserting {len(stats_records)} stat rows into international_players_stats...")
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
    from supabase import create_client
    if not split_records:
        log.warning("No splits data to write.")
        return
    sb = create_client(url, key)

    names = list({r["player_name"] for r in split_records})
    result = sb.table("international_players").select("id,name").in_("name", names).execute()
    id_map = {p["name"]: p["id"] for p in (result.data or [])}

    # Same conflict-target rule as stats: dedupe within the batch.
    split_by_key = {}
    split_dups = 0
    for r in split_records:
        stats = dict(r.get("split_stats", {}))
        split_label = stats.pop("split", None)
        key = (r["player_name"], r["league"], r["season"], split_label)
        if key in split_by_key:
            split_dups += 1
        split_by_key[key] = {
            "player_id":   id_map.get(r["player_name"]),
            "player_name": r["player_name"],
            "league":      r["league"],
            "season":      r["season"],
            "split":       split_label,
            "team":        stats.pop("team", None),
            "stats":       stats,
        }
    records = list(split_by_key.values())
    if split_dups:
        log.warning(f"Skipped {split_dups} duplicate split row(s).")

    log.info(f"Upserting {len(records)} split rows into international_players_splits...")
    chunk_size = 500
    for i in range(0, len(records), chunk_size):
        chunk = records[i : i + chunk_size]
        try:
            resp = sb.table("international_players_splits").upsert(
                chunk, on_conflict="player_name,league,season,split",
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
    parser = argparse.ArgumentParser(description="Scrape any RealGM international league.")
    # Defaults point at French LNB Espoirs for easy testing.
    parser.add_argument("--league-id",   type=int, default=114,
                        help="RealGM numeric league id (default: 114 — French LNB Espoirs)")
    parser.add_argument("--league-slug", default="French-LNB-Espoirs",
                        help="RealGM URL slug (default: French-LNB-Espoirs)")
    parser.add_argument("--league-name", default="French LNB Espoirs",
                        help="Human-readable league name written to the DB (default: 'French LNB Espoirs')")

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

    log.info(f"Scraping league: {args.league_name} (id={args.league_id}, slug={args.league_slug})")

    seasons = args.seasons if args.seasons else [args.season]
    rows = scrape(
        args.league_id, args.league_slug, args.league_name,
        seasons, args.stat_type, args.qualifier, args.season_type, args.save_html,
    )

    if args.out:
        write_csv(rows, args.out)

    if args.supabase:
        if not args.supabase_url or not args.supabase_key:
            parser.error("--supabase requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars (or --supabase-url / --supabase-key flags).")
        write_supabase(rows, args.supabase_url, args.supabase_key)

    if args.splits or args.splits_out:
        split_season = seasons[0]
        if len(seasons) > 1:
            log.warning(f"Splits only supports one season at a time; using {split_season}.")
        split_records = scrape_splits(
            rows, split_season, args.league_id, args.league_slug, args.league_name,
        )

        if args.splits_out:
            write_splits_csv(split_records, args.splits_out)

        if args.supabase:
            write_supabase_splits(split_records, args.supabase_url, args.supabase_key)


if __name__ == "__main__":
    main()
