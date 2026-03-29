"""
link_finder.py — Auto-find Sports Reference + Bart Torvik links for players
============================================================================
Reads a CSV of player names, searches for each one, and upserts the links
into the `players` table.

Usage:
    python link_finder.py --csv "Realignment - Sheet3.csv"
    python link_finder.py --csv "Realignment - Sheet3.csv" --dry-run

Environment variables:
    export SUPABASE_URL="https://xxxxxxxxxxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="your-service-role-key"
"""

import argparse
import csv
import os
import re
import sys
import time
import unicodedata

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Run: pip install requests beautifulsoup4")

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

REQUEST_DELAY = 4  # seconds between requests

# ── Helpers ────────────────────────────────────────────────────────────────────

def normalise(name):
    """Lowercase, strip accents, remove punctuation — for fuzzy matching."""
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()

def fetch(url):
    resp = requests.get(url, headers=HEADERS, timeout=20)
    if resp.status_code == 429:
        print("    Rate-limited. Waiting 90s...")
        time.sleep(90)
        resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    return resp.text

# ── Sports Reference search ────────────────────────────────────────────────────

def find_sr_link(name):
    """
    Search Sports Reference for a player by name.
    Returns the full URL to their player page, or None.
    """
    search_url = f"https://www.sports-reference.com/cbb/search/search.fcgi?search={requests.utils.quote(name)}"
    try:
        resp = requests.get(search_url, headers=HEADERS, timeout=20, allow_redirects=True)
    except Exception as e:
        print(f"    SR request failed: {e}")
        return None

    # If SR redirects directly to a player page, we're done
    if "/cbb/players/" in resp.url and resp.url != search_url:
        return resp.url.split("?")[0]

    # Otherwise parse the search results page
    soup = BeautifulSoup(resp.text, "html.parser")
    results = soup.select("div#players div.search-item-name a")

    if not results:
        return None

    norm_target = normalise(name)

    # Try exact normalised match first
    for a in results:
        if normalise(a.get_text()) == norm_target:
            href = a["href"]
            return ("https://www.sports-reference.com" + href).split("?")[0]

    # Fall back to first result
    href = results[0]["href"]
    matched_name = results[0].get_text(strip=True)
    print(f"    ⚠  No exact match for '{name}' — using '{matched_name}'")
    return ("https://www.sports-reference.com" + href).split("?")[0]

# ── Bart Torvik search ─────────────────────────────────────────────────────────

def find_torvik_link(name):
    """
    Search Bart Torvik for a player.
    Returns the full URL to their player page, or None.
    """
    search_url = f"https://www.barttorvik.com/playerpage.php?player={requests.utils.quote(name)}"
    try:
        resp = requests.get(search_url, headers=HEADERS, timeout=20, allow_redirects=True)
    except Exception as e:
        print(f"    Torvik request failed: {e}")
        return None

    # Torvik redirects to the player page if found
    if "playerid=" in resp.url:
        return resp.url

    # Try the search endpoint
    search_api = f"https://www.barttorvik.com/getplayer.php?name={requests.utils.quote(name)}"
    try:
        resp2 = requests.get(search_api, headers=HEADERS, timeout=20)
        data = resp2.json()
        if data and isinstance(data, list) and len(data) > 0:
            player_id = data[0].get("Playerid") or data[0].get("playerid")
            if player_id:
                return f"https://www.barttorvik.com/playerpage.php?playerid={player_id}"
    except Exception:
        pass

    return None

# ── Main ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--csv",     required=True, help="Path to CSV file with a 'name' column")
    p.add_argument("--dry-run", action="store_true", help="Print links without writing to DB")
    p.add_argument("--sr-only", action="store_true", help="Only look up Sports Reference links")
    return p.parse_args()

def main():
    args = parse_args()

    if not os.path.exists(args.csv):
        sys.exit(f"CSV not found: {args.csv}")

    with open(args.csv, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    # Filter to rows where links are missing
    names = [
        r["name"].strip() for r in rows
        if r.get("name", "").strip()
        and not r.get("sportsreference_link", "").strip()
    ]

    print(f"\nLink Finder — {len(names)} players to look up")
    if args.dry_run:
        print("(dry-run mode — nothing will be written to DB)\n")

    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.")
        db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    found = 0
    for i, name in enumerate(names, 1):
        print(f"[{i}/{len(names)}] {name}")

        sr_link = find_sr_link(name)
        time.sleep(REQUEST_DELAY)

        torvik_link = None
        if not args.sr_only:
            torvik_link = find_torvik_link(name)
            time.sleep(REQUEST_DELAY)

        if sr_link:
            print(f"    SR:     {sr_link}")
            found += 1
        else:
            print(f"    SR:     NOT FOUND")

        if not args.sr_only:
            print(f"    Torvik: {torvik_link or 'NOT FOUND'}")

        if not args.dry_run and (sr_link or torvik_link):
            # Match player in DB by normalised name
            res = db.table("players").select("id, name").ilike("name", name).execute()

            if not res.data:
                # Try without punctuation/accents
                res = db.table("players").select("id, name").ilike("name", f"%{name.split()[0]}%").execute()
                # Pick closest
                norm = normalise(name)
                res.data = [r for r in res.data if normalise(r["name"]) == norm] or res.data[:1]

            if not res.data:
                print(f"    ⚠  No DB match for '{name}' — skipping update")
                continue

            update = {}
            if sr_link:     update["sportsreference_link"] = sr_link
            if torvik_link: update["barttorvik_link"]      = torvik_link

            for player in res.data:
                db.table("players").update(update).eq("id", player["id"]).execute()
                print(f"    ✓ Updated player_id {player['id']}")

    print(f"\n✓ Done. {found}/{len(names)} players found on Sports Reference.")

if __name__ == "__main__":
    main()
