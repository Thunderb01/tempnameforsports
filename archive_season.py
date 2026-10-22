"""
archive_season.py — Snapshot a season's Full Board into season_board_archive
===============================================================================
Reads the schema in supabase/season_board_archive.sql first — this script is
useless without those tables.

Prep for a new season: takes a full snapshot of the live board (vw_players /
vw_w_players, plus archetype/tag columns off players / w_players) and writes
it into season_board_archive / w_season_board_archive, keyed by season_year.
This is what lets the Full Board get cleared for the new season without
losing the old one — Time Machine reads the archive, not the live tables.

Two separate, deliberately gated steps:

  1. Archive (default). Upserts a season_board_archive row per player on
     (season_year, player_id) — safe to re-run, never touches the live
     players/w_players/portal_transfers tables.

  2. Reset live board (--reset-live, requires --season and a successful
     archive first in the same run — or --skip-archive if you already
     archived and just want to reset). Clears player_status back to NULL on
     every players/w_players row and deletes portal_transfers/
     w_portal_transfers rows for that season_year. This is the actual
     "clear the board" step and is NOT reversible from this script — the
     archive you just wrote is the only copy of what you're clearing.
     Requires typing a confirmation phrase unless --yes is also passed.

Usage:
    python archive_season.py --season 2026 --dry-run          # preview counts only
    python archive_season.py --season 2026                    # archive men's + women's
    python archive_season.py --season 2026 --sport men         # archive one sport
    python archive_season.py --season 2026 --reset-live        # archive, then clear live board
    python archive_season.py --season 2026 --reset-live --skip-archive   # reset only (already archived)

Environment variables:
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

PAGE  = 1000
CHUNK = 500  # write batch size

# One config per sport — mirrors the men's/women's table-name fork used
# throughout the rest of the pipeline (see CLAUDE.md's fork-model table).
SPORTS = {
    "men": {
        "players_table":   "players",
        "view":            "vw_players",
        "portal_table":    "portal_transfers",
        "archive_table":   "season_board_archive",
        "team_col":        "current_team",
    },
    "women": {
        "players_table":   "w_players",
        "view":            "vw_w_players",
        "portal_table":    "w_portal_transfers",
        "archive_table":   "w_season_board_archive",
        "team_col":        "current_team",
    },
}

ARCHIVE_COLS = [
    "ppg", "rpg", "apg", "usg", "ast_tov", "fg_pct", "3p_pct", "ft_pct",
    "sei", "ath", "ris", "dds", "cdi",
    "nil_valuation", "open_market_low", "open_market_high", "projected_tier",
    "player_status", "transfer_status", "transfer_from_team", "transfer_to_team",
    "transfer_season_year", "positions",
]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--season", type=int, required=True, help="Season year to archive/reset, e.g. 2026")
    p.add_argument("--sport", choices=["men", "women", "both"], default="both")
    p.add_argument("--dry-run", action="store_true", help="Preview counts only, no writes")
    p.add_argument("--reset-live", action="store_true",
                   help="After archiving, clear player_status and this season's portal_transfers on the live tables")
    p.add_argument("--skip-archive", action="store_true",
                   help="With --reset-live: skip the archive step (use only if you already archived this season)")
    p.add_argument("--yes", action="store_true", help="Skip the --reset-live confirmation prompt")
    return p.parse_args()


def fetch_all(sb, table, columns, filters=None):
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


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def fetch_tags_by_id(sb, players_table):
    """players/w_players carries archetype/tags columns vw_players doesn't
    expose — fetch them separately and merge onto the view rows by id."""
    rows = fetch_all(sb, players_table,
                      "id, torvik_pid, archetype, archetypes, playmaker_tags, "
                      "shooting_tags, shotmaking_tags, defensive_tags, interior_tags")
    return {r["id"]: r for r in rows}


def build_archive_rows(season, view_rows, tags_by_id):
    out = []
    for r in view_rows:
        extra = tags_by_id.get(r["id"], {})
        row = {
            "season_year":      season,
            "player_id":        r["id"],
            "torvik_pid":       extra.get("torvik_pid"),
            "name":             r["name"],
            "team":             r.get("current_team"),
            "conference":       r.get("conference"),
            "primary_position": r.get("primary_position"),
            "year":             r.get("year"),
            "height":           r.get("height"),
            "hometown":         r.get("hometown"),
            "espn_id":          r.get("espn_id"),
            "archetype":        extra.get("archetype"),
            "archetypes":       extra.get("archetypes"),
            "playmaker_tags":   extra.get("playmaker_tags"),
            "shooting_tags":    extra.get("shooting_tags"),
            "shotmaking_tags":  extra.get("shotmaking_tags"),
            "defensive_tags":   extra.get("defensive_tags"),
            "interior_tags":    extra.get("interior_tags"),
        }
        for col in ARCHIVE_COLS:
            row[col] = r.get(col)
        out.append(row)
    return out


def archive_sport(sb, sport, season, dry_run):
    cfg = SPORTS[sport]
    print(f"\n[{sport}] Fetching {cfg['view']}…")
    view_rows = fetch_all(sb, cfg["view"], "*")
    print(f"  {len(view_rows)} rows")

    print(f"[{sport}] Fetching archetype/tag columns off {cfg['players_table']}…")
    tags_by_id = fetch_tags_by_id(sb, cfg["players_table"])

    rows = build_archive_rows(season, view_rows, tags_by_id)
    print(f"[{sport}] {len(rows)} rows to upsert into {cfg['archive_table']} for season {season}")

    if dry_run:
        print("  (dry-run — nothing written)")
        for row in rows[:3]:
            print(f"  sample: {row['name']} @ {row['team']} — nil=${row['nil_valuation']}, status={row['player_status']}")
        return len(rows)

    written = 0
    for chunk in chunked(rows, CHUNK):
        sb.table(cfg["archive_table"]).upsert(chunk, on_conflict="season_year,player_id").execute()
        written += len(chunk)
        print(f"  ... {written}/{len(rows)} written")

    return written


def reset_live_sport(sb, sport, season, dry_run):
    cfg = SPORTS[sport]
    print(f"\n[{sport}] Resetting live board for season {season}…")

    portal_rows = fetch_all(sb, cfg["portal_table"], "id", [lambda q: q.eq("season_year", season)])
    print(f"  {len(portal_rows)} {cfg['portal_table']} row(s) for season {season}")

    status_rows = fetch_all(sb, cfg["players_table"], "id", [lambda q: q.not_.is_("player_status", "null")])
    print(f"  {len(status_rows)} {cfg['players_table']} row(s) with a non-null player_status to clear")

    if dry_run:
        print("  (dry-run — nothing reset)")
        return

    if portal_rows:
        sb.table(cfg["portal_table"]).delete().eq("season_year", season).execute()
        print(f"  Deleted {len(portal_rows)} {cfg['portal_table']} row(s)")

    for chunk in chunked([r["id"] for r in status_rows], CHUNK):
        sb.table(cfg["players_table"]).update({"player_status": None}).in_("id", chunk).execute()
    if status_rows:
        print(f"  Cleared player_status on {len(status_rows)} {cfg['players_table']} row(s)")


def main():
    args = parse_args()
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    sports = ["men", "women"] if args.sport == "both" else [args.sport]

    if not (args.reset_live and args.skip_archive):
        total = 0
        for sport in sports:
            total += archive_sport(sb, sport, args.season, args.dry_run)
        print(f"\n{'DRY RUN — ' if args.dry_run else ''}Archived {total} row(s) across {len(sports)} sport(s) for season {args.season}.")

    if args.reset_live:
        if args.dry_run:
            print("\n--reset-live requested but --dry-run is set — previewing reset counts only, nothing will be cleared.")
            for sport in sports:
                reset_live_sport(sb, sport, args.season, dry_run=True)
            return

        if not args.yes:
            print(f"\nThis permanently clears player_status on every {'/'.join(SPORTS[s]['players_table'] for s in sports)} "
                  f"row and deletes every {'/'.join(SPORTS[s]['portal_table'] for s in sports)} row for season {args.season}.")
            print("The archive written above (or already on file, with --skip-archive) is the only copy of this data afterward.")
            confirm = input(f"Type the season year ({args.season}) to confirm: ")
            if confirm.strip() != str(args.season):
                sys.exit("Confirmation did not match — aborting, nothing was reset.")

        for sport in sports:
            reset_live_sport(sb, sport, args.season, dry_run=False)
        print(f"\nDone. Live board reset for season {args.season}.")


if __name__ == "__main__":
    main()
