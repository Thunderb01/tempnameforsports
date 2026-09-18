"""
merge_transfer_duplicates.py — Consolidate a player's rows across schools into one profile
=============================================================================================
`players` rows are deduped by (name, current_team, source) — not by identity. When a
player transfers, scraper_to_supabase.py creates a NEW row at the destination school;
the old row at their previous school is never deleted or merged. A player who has
transferred at any point since this pipeline started scraping them can end up with
multiple `players.id` rows for the same real person.

torvik_pid IS a stable per-person identifier (Barttorvik's own, confirmed by
historical_stats' unique(torvik_pid, year) constraint). This script groups `players`
by torvik_pid, and for every group with more than one row, merges them into one
canonical profile:

  1. Canonical row = the one with the most recent player_stats.calendar_year among
     the group (i.e. whichever row represents the season they most recently actually
     played) — falling back to "not currently marked transferring", then "has the
     most filled-in profile fields", then row id, if that's still a tie or there's no
     player_stats to compare.
  2. Copies person-level fields (height, hometown, espn_id, birth_year) from the other
     rows onto the canonical row, only where the canonical row is missing them. Does
     NOT copy season-specific fields (tags, position, year/class label, eligibility) —
     those describe a particular season's play and the canonical row's own current
     value is what should represent them going forward, not a stale season's.
  3. Repoints team_players and saved_roster_players FKs from every non-canonical id to
     the canonical id (same tables merge_duplicate_players.py repoints).
  4. Repoints (not deletes) player_stats rows from non-canonical ids onto the
     canonical id — that's the actual point, each duplicate typically holds a
     DIFFERENT season's stats. Only when the canonical row already has a row for
     that exact calendar_year does this delete the non-canonical one (can't have two
     rows claiming the same season for one player).
  5. Deletes the merged-away `players` rows.

Known unfixable residual risk: the roster builder's shortlist/roster state lives in
the browser's localStorage (per (user, team) — see CLAUDE.md), not in Supabase. A
coach who already added a soon-to-be-deleted duplicate row to their local roster will
have a dangling reference after this runs — no server-side script can fix that. Same
tradeoff merge_duplicate_players.py already accepted for its own merges.

Usage:
    python merge_transfer_duplicates.py --dry-run    # preview only, no writes
    python merge_transfer_duplicates.py              # write changes
    python merge_transfer_duplicates.py --torvik-pid 12345   # merge just one group, for spot-checking

Environment variables:
    SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import argparse
import os
import sys
from collections import defaultdict

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

PAGE = 1000

# Person-level fields only — never season-specific ones (see docstring point 2).
COPY_IF_MISSING = ["height", "hometown", "espn_id", "birth_year"]

PLAYER_COLUMNS = (
    "id, name, current_team, source, torvik_pid, player_status, "
    "height, hometown, espn_id, birth_year"
)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true",
                   help="Print what would happen without writing anything")
    p.add_argument("--torvik-pid", type=int, default=None,
                   help="Only process this one torvik_pid (spot-check a single merge)")
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


def filled_field_count(row):
    return sum(1 for c in COPY_IF_MISSING if row.get(c))


def choose_canonical(rows, latest_season_by_player):
    """Pick which row in a duplicate group stays. See docstring point 1."""
    def sort_key(r):
        latest_year = latest_season_by_player.get(r["id"], -1)
        not_transferring = 0 if r.get("player_status") == "transferring" else 1
        return (latest_year, not_transferring, filled_field_count(r))
    return max(rows, key=sort_key)


def merge_group(sb, torvik_pid, rows, latest_season_by_player, dry_run):
    canonical = choose_canonical(rows, latest_season_by_player)
    others = [r for r in rows if r["id"] != canonical["id"]]

    print(f"\n{'[DRY RUN] ' if dry_run else ''}Merging torvik_pid={torvik_pid} ({canonical['name']}) — "
          f"{len(rows)} rows found")
    print(f"  Keep    : {canonical['id']}  ({canonical.get('current_team')}, "
          f"last season {latest_season_by_player.get(canonical['id'], 'none')})")
    for o in others:
        print(f"  Merge in: {o['id']}  ({o.get('current_team')}, "
              f"last season {latest_season_by_player.get(o['id'], 'none')})")

    # 1. Copy missing person-level fields onto canonical, preferring whichever
    #    duplicate has a value first (order doesn't matter much here — these
    #    fields shouldn't disagree across a real person's rows).
    patch = {}
    for col in COPY_IF_MISSING:
        if canonical.get(col):
            continue
        for o in others:
            if o.get(col):
                patch[col] = o[col]
                break
    if patch:
        print(f"  Copy onto canonical: {patch}")
        if not dry_run:
            sb.table("players").update(patch).eq("id", canonical["id"]).execute()

    for o in others:
        old_id = o["id"]

        # 2. Repoint team_players / saved_roster_players
        for table in ("team_players", "saved_roster_players"):
            rows_here = sb.table(table).select("id").eq("player_id", old_id).execute().data or []
            if rows_here:
                print(f"  Repointing {len(rows_here)} {table} row(s) from {old_id}")
                if not dry_run:
                    sb.table(table).update({"player_id": canonical["id"]}).eq("player_id", old_id).execute()

        # 3. Repoint player_stats — collision-check by calendar_year first.
        stats_rows = (sb.table("player_stats").select("id, calendar_year")
                        .eq("player_id", old_id).execute().data or [])
        if stats_rows:
            canon_years = {
                r["calendar_year"] for r in
                (sb.table("player_stats").select("calendar_year").eq("player_id", canonical["id"]).execute().data or [])
                if r.get("calendar_year") is not None
            }
            for sr in stats_rows:
                yr = sr.get("calendar_year")
                if yr is not None and yr in canon_years:
                    print(f"  Season {yr} already exists on canonical — dropping duplicate stats row {sr['id']}")
                    if not dry_run:
                        sb.table("player_stats").delete().eq("id", sr["id"]).execute()
                else:
                    if not dry_run:
                        sb.table("player_stats").update({"player_id": canonical["id"]}).eq("id", sr["id"]).execute()
            print(f"  Repointed {len(stats_rows)} player_stats row(s) from {old_id} (season conflicts dropped, rest moved)")

        # 4. Delete the merged-away player row
        print(f"  Deleting player row {old_id}")
        if not dry_run:
            sb.table("players").delete().eq("id", old_id).execute()


def main():
    args = parse_args()
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print("Fetching players with a torvik_pid…")
    filters = [lambda q: q.not_.is_("torvik_pid", "null")]
    if args.torvik_pid is not None:
        filters.append(lambda q: q.eq("torvik_pid", args.torvik_pid))
    players = fetch_all(sb, "players", PLAYER_COLUMNS, filters)
    print(f"  {len(players)} players with a torvik_pid")

    groups = defaultdict(list)
    for p in players:
        groups[p["torvik_pid"]].append(p)
    dup_groups = {pid: rows for pid, rows in groups.items() if len(rows) > 1}
    print(f"  {len(dup_groups)} torvik_pid(s) with more than one players row")

    if not dup_groups:
        print("Nothing to merge.")
        return

    all_ids = [p["id"] for rows in dup_groups.values() for p in rows]
    print("Fetching each row's most recent season (to pick the canonical row)…")
    latest_season_by_player = {}
    for i in range(0, len(all_ids), 200):
        chunk = all_ids[i:i + 200]
        stats = (sb.table("player_stats").select("player_id, calendar_year")
                   .in_("player_id", chunk).execute().data or [])
        for s in stats:
            yr = s.get("calendar_year")
            pid = s.get("player_id")
            if yr is not None and (pid not in latest_season_by_player or yr > latest_season_by_player[pid]):
                latest_season_by_player[pid] = yr

    for torvik_pid, rows in dup_groups.items():
        merge_group(sb, torvik_pid, rows, latest_season_by_player, args.dry_run)

    print(f"\n{'DRY RUN complete — nothing written.' if args.dry_run else f'Done. Merged {len(dup_groups)} group(s).'}")


if __name__ == "__main__":
    main()
