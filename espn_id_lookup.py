"""
espn_id_lookup.py — Populate espn_id column in players table via ESPN search API
=================================================================================
Fetches all players from Supabase, queries ESPN's search endpoint by name,
then fuzzy-matches on team to pick the right result and writes espn_id back.

Usage:
    python espn_id_lookup.py
    python espn_id_lookup.py --dry-run
    python espn_id_lookup.py --limit 50          # only process first N players
    python espn_id_lookup.py --skip-existing     # skip players who already have espn_id

Prerequisites (run once in Supabase SQL Editor):
    ALTER TABLE public.players ADD COLUMN IF NOT EXISTS espn_id text;

Environment variables:
    $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
    $env:SUPABASE_SERVICE_KEY="your-service-role-key"
"""

import argparse
import os
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("Run: pip install requests")

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

ESPN_SEARCH_URL = "https://site.api.espn.com/apis/common/v3/search"
ESPN_HEADERS    = {"User-Agent": "Mozilla/5.0"}

# Delay between ESPN requests to avoid rate limiting
REQUEST_DELAY = 0.4  # seconds


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run",       action="store_true", help="Print matches without writing to Supabase")
    p.add_argument("--skip-existing", action="store_true", help="Skip players who already have an espn_id")
    p.add_argument("--limit",         type=int, default=0,  help="Only process first N players (0 = all)")
    return p.parse_args()


def normalise(s):
    return str(s).strip().lower()


def team_overlap(a, b):
    """Score how well two team name strings match (word overlap)."""
    a_words = set(normalise(a).split())
    b_words = set(normalise(b).split())
    shared  = a_words & b_words
    return len(shared) / max(len(a_words), len(b_words), 1)


def espn_search(name):
    """
    Hit ESPN's search endpoint and return a list of CBB athlete results.
    Each item has: id, displayName, team (display name).
    """
    try:
        resp = requests.get(
            ESPN_SEARCH_URL,
            params={"query": name, "limit": 10, "type": "athlete", "sport": "mens-college-basketball"},
            headers=ESPN_HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"    ESPN request error: {e}")
        return []

    results = []
    for item in data.get("items", []):
        for athlete in item.get("athletes", []):
            espn_id      = str(athlete.get("id", ""))
            display_name = athlete.get("displayName", "")
            team_name    = athlete.get("team", {}).get("displayName", "") if athlete.get("team") else ""
            if espn_id:
                results.append({"id": espn_id, "name": display_name, "team": team_name})

    return results


def find_best_match(player_name, player_team, espn_results):
    """
    Return (espn_id, confidence) for the best matching ESPN result.
    Confidence is 0–1; we require >= 0.5 to accept.
    """
    best_id    = None
    best_score = 0.0

    p_name_norm = normalise(player_name)

    for r in espn_results:
        name_match = normalise(r["name"]) == p_name_norm
        if not name_match:
            # Try partial — last name match at minimum
            r_last = normalise(r["name"]).split()[-1] if r["name"] else ""
            p_last = p_name_norm.split()[-1] if p_name_norm else ""
            if r_last != p_last:
                continue
            name_score = 0.7
        else:
            name_score = 1.0

        team_score = team_overlap(player_team or "", r["team"]) if r["team"] else 0.0
        score = name_score * 0.5 + team_score * 0.5

        if score > best_score:
            best_score = score
            best_id    = r["id"]

    return best_id, best_score


def fetch_all_players(sb, skip_existing):
    """Fetch all players from Supabase in pages of 1000."""
    players = []
    page    = 0
    page_size = 1000
    while True:
        query = sb.table("players").select("id, name, current_team, espn_id") \
                  .range(page * page_size, (page + 1) * page_size - 1)
        if skip_existing:
            query = query.is_("espn_id", "null")
        resp = query.execute()
        batch = resp.data or []
        players.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return players


def main():
    args = parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.")

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print("Fetching players from Supabase…")
    players = fetch_all_players(sb, args.skip_existing)
    print(f"  {len(players)} players to process")

    if args.limit:
        players = players[: args.limit]
        print(f"  (limited to {args.limit})")

    matched   = 0
    unmatched = 0
    skipped   = 0

    for i, p in enumerate(players, 1):
        name = p.get("name", "")
        team = p.get("current_team", "")
        pid  = p["id"]

        print(f"[{i}/{len(players)}] {name} ({team})", end=" … ")

        if not name:
            print("skipped (no name)")
            skipped += 1
            continue

        results = espn_search(name)
        time.sleep(REQUEST_DELAY)

        if not results:
            print("no ESPN results")
            unmatched += 1
            continue

        espn_id, confidence = find_best_match(name, team, results)

        if espn_id is None or confidence < 0.5:
            print(f"no confident match (best score: {confidence:.2f})")
            unmatched += 1
            continue

        print(f"matched espn_id={espn_id} (confidence={confidence:.2f})", end="")

        if args.dry_run:
            print(" [dry-run, not saved]")
        else:
            sb.table("players").update({"espn_id": espn_id}).eq("id", pid).execute()
            print(" ✓")
        matched += 1

    print(f"\nDone. Matched: {matched} | Unmatched: {unmatched} | Skipped: {skipped}")
    if args.dry_run:
        print("(dry-run — nothing written)")


if __name__ == "__main__":
    main()
