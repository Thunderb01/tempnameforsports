"""
backfill_player_history.py — Link current players to their historical Torvik seasons
=======================================================================================
historical_stats already holds pre-computed BTP metrics (sei/ath/ris/dds/cdi) and NIL
valuations for every D1 season 2009-2025 (import_historical.py), keyed by Barttorvik's
torvik_pid. Current `players` rows also carry torvik_pid (set by torvik_metrics.py's
live pass). This script joins the two on torvik_pid and copies each matched player's
prior seasons into `player_stats`, keyed by (player_id, calendar_year) — the same
shape torvik_metrics.py already writes for the live season.

No new UI needed: PlayerModal already renders every player_stats row for a player as
a "Season 1 / Season 2 / ..." tab (ordered by calendar_year desc) — it just had
nothing but the current season to show before this. This also gives a real signal
for eligibility (how many prior D1 seasons actually exist for this player, vs. the
scraped class-year label alone) and a season-by-season history for whoever wants to
build trend-aware NIL/rating logic on top — neither of those is computed here, this
script only makes the underlying multi-season data available.

Never touches historical_stats. Never overwrites a player_stats row that already
exists for a given (player_id, calendar_year) — e.g. the live current-season row
torvik_metrics.py wrote — only inserts seasons that are missing.

Women's has no historical coverage yet: trank_ncaaw_2026.csv is a single season, no
import_historical.py-equivalent has been run for women's, so there's nothing to link
against. This script is men's-only until that exists.

Usage:
    python backfill_player_history.py --dry-run
    python backfill_player_history.py
    python backfill_player_history.py --team "Duke"        # spot-test one team
    python backfill_player_history.py --limit 25 --dry-run # quick sanity check

Env:
    SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import argparse
import os
import sys

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

PAGE = 1000
CHUNK = 200  # .in_() filter batch size — keep well under PostgREST URL length limits


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true", help="Preview counts, no DB writes")
    p.add_argument("--team",    type=str, default=None, help="Only this team (exact current_team match)")
    p.add_argument("--limit",   type=int, default=None, help="Only process the first N matched players")
    return p.parse_args()


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def fetch_all(sb, table, columns, filters=None):
    """Paginated select. `filters` is a list of callables, each taking the query
    builder and returning the filtered builder (so callers can chain .not_.is_(...)
    style filters as well as plain .eq()/.in_() calls)."""
    rows, page = [], 0
    while True:
        q = sb.table(table).select(columns).range(page * PAGE, (page + 1) * PAGE - 1)
        if filters:
            for apply_filter in filters:
                q = apply_filter(q)
        res = q.execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        page += 1
    return rows


def main():
    args = parse_args()
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print("Fetching current players with a torvik_pid…")
    filters = [lambda q: q.not_.is_("torvik_pid", "null")]
    if args.team:
        filters.append(lambda q: q.eq("current_team", args.team))
    players = fetch_all(sb, "players", "id, name, current_team, torvik_pid", filters)
    if args.limit:
        players = players[:args.limit]
    print(f"  {len(players)} players to check")
    if not players:
        print("Nothing to do.")
        return

    pid_to_player = {}  # torvik_pid -> [player rows] (a torvik_pid could in principle map to >1 row)
    for p in players:
        pid_to_player.setdefault(p["torvik_pid"], []).append(p)
    torvik_pids = list(pid_to_player.keys())

    print("Fetching existing player_stats seasons for these players (skip what's already there)…")
    player_ids = [p["id"] for p in players]
    existing = set()
    for chunk in chunked(player_ids, CHUNK):
        rows = fetch_all(sb, "player_stats", "player_id, calendar_year",
                          [lambda q, chunk=chunk: q.in_("player_id", chunk)])
        for r in rows:
            if r.get("calendar_year") is not None:
                existing.add((r["player_id"], r["calendar_year"]))
    print(f"  {len(existing)} existing (player_id, season) rows found")

    print("Fetching historical_stats rows for these players' torvik_pids…")
    hist_rows = []
    for chunk in chunked(torvik_pids, CHUNK):
        hist_rows.extend(fetch_all(
            sb, "historical_stats",
            "torvik_pid, year, team, conf, ppg, rpg, apg, \"3p_pct\", sei, ath, ris, dds, cdi, "
            "nil_valuation, open_market_low, open_market_high, projected_tier, "
            "torvik_usg, torvik_ts, torvik_efg, torvik_ortg, torvik_bpm, torvik_ast_pct, "
            "torvik_to_pct, torvik_blk_pct, torvik_stl_pct, torvik_orb_pct, torvik_drb_pct, "
            "torvik_min_pct, torvik_gp",
            [lambda q, chunk=chunk: q.in_("torvik_pid", chunk)],
        ))
    print(f"  {len(hist_rows)} historical season rows found for these players")

    to_insert = []
    matched_players = set()
    for h in hist_rows:
        for player in pid_to_player.get(h["torvik_pid"], []):
            key = (player["id"], h["year"])
            if key in existing:
                continue  # already have this season for this player — don't clobber
            existing.add(key)  # guard against duplicate hist rows for the same pid/year
            matched_players.add(player["id"])
            to_insert.append({
                "player_id":        player["id"],
                "calendar_year":    h["year"],
                "name":             player["name"],
                "school":           h.get("team"),
                "conference":       h.get("conf"),
                "ppg":              h.get("ppg"),
                "rpg":              h.get("rpg"),
                "apg":              h.get("apg"),
                "3p_pct":           h.get("3p_pct"),
                "sei":              h.get("sei"),
                "ath":              h.get("ath"),
                "ris":              h.get("ris"),
                "dds":              h.get("dds"),
                "cdi":              h.get("cdi"),
                "nil_valuation":    h.get("nil_valuation"),
                "open_market_low":  h.get("open_market_low"),
                "open_market_high": h.get("open_market_high"),
                "projected_tier":   h.get("projected_tier"),
                "torvik_usg":       h.get("torvik_usg"),
                "torvik_ts":        h.get("torvik_ts"),
                "torvik_efg":       h.get("torvik_efg"),
                "torvik_ortg":      h.get("torvik_ortg"),
                "torvik_bpm":       h.get("torvik_bpm"),
                "torvik_ast_pct":   h.get("torvik_ast_pct"),
                "torvik_to_pct":    h.get("torvik_to_pct"),
                "torvik_blk_pct":   h.get("torvik_blk_pct"),
                "torvik_stl_pct":   h.get("torvik_stl_pct"),
                "torvik_orb_pct":   h.get("torvik_orb_pct"),
                "torvik_drb_pct":   h.get("torvik_drb_pct"),
                "torvik_min_pct":   h.get("torvik_min_pct"),
                "torvik_gp":        h.get("torvik_gp"),
            })

    print(f"\n{len(to_insert)} new season rows to add, across {len(matched_players)} players "
          f"({len(players) - len(matched_players)} of the checked players had no new seasons to add).")

    if not to_insert:
        print("Nothing to do.")
        return

    if args.dry_run:
        print("\nSample (first 5):")
        for row in to_insert[:5]:
            print(f"  {row['name']} — {row['calendar_year']} @ {row['school']}: "
                  f"{row['ppg']} ppg, sei={row['sei']}, nil=${row['nil_valuation']}")
        print("\n(dry-run — nothing written)")
        return

    written = 0
    for chunk in chunked(to_insert, 500):
        sb.table("player_stats").insert(chunk).execute()
        written += len(chunk)
        print(f"  ... {written}/{len(to_insert)} written")

    print(f"\nDone. Wrote {written} historical season rows.")


if __name__ == "__main__":
    main()
