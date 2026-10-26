"""
repair_positions_from_prior_role.py — Fix players stuck at positions=["SF"]
===============================================================================
Root cause (fixed in torvik_metrics.py / torvik_metrics_w.py, see CLAUDE.md):
a blank/NaN `role` cell used to fall through normalise_pos's "Wing" default
(-> ["SF"]) and get written unconditionally, so every player processed from
a blank-role CSV (data/trank_data_2027.csv -- role is blank for all 3260
rows, since it's a precursor seeded from last season's stats before this
season's role has been computed) got positions=["SF"] / primary_position=
"SF" written over whatever was there before.

That fix only stops FUTURE runs from re-clobbering the column -- it does
nothing for rows already sitting in the DB with positions=["SF"]. This
script is the one-time repair: it re-derives positions from a CSV that
actually has real role data (last season's, by default) and overwrites
ONLY the rows that are currently stuck in the corrupted state. It touches
positions/primary_position alone -- no stats, no NIL, no year/class, so it
can't drag stale last-season values onto this season's board the way
re-running the full torvik_metrics.py pipeline against an old CSV would.

Matches players to the repair CSV by torvik_pid (same stable id used
everywhere else in this pipeline -- see import_pbp_shot_assists.py).
A player with no torvik_pid match in the repair CSV (e.g. a true new
addition with no prior-season history) is left alone and reported, not
guessed at.

"Corrupted" = positions IS NULL, or positions is exactly the single-
element ["SF"] list -- the only value this bug (and the pre-existing
UNKNOWN_POSITION_FALLBACK / legacy "Wing"-bucket-expansion paths) can
produce. A real, intentional bare ["SF"] does not occur anywhere in this
pipeline: every TORVIK_ROLE_TO_POSITIONS entry that resolves to SF also
carries PF (Wing F), so this signature is unambiguous.

Usage:
    python repair_positions_from_prior_role.py --sport men --dry-run
    python repair_positions_from_prior_role.py --sport men
    python repair_positions_from_prior_role.py --sport women
    python repair_positions_from_prior_role.py --sport men --role-csv data/trank_data_2026.csv

Environment variables:
    SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import argparse
import os
import sys

try:
    import pandas as pd
except ImportError:
    sys.exit("Run: pip install pandas")

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

PAGE  = 1000
CHUNK = 500

SPORTS = {
    "men":   {"table": "players",   "role_module": "torvik_metrics",   "default_csv": "data/trank_data_2026.csv"},
    "women": {"table": "w_players",  "role_module": "torvik_metrics_w", "default_csv": "data/trank_ncaaw_2026.csv"},
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--sport", choices=["men", "women"], default="men")
    p.add_argument("--role-csv", type=str, default=None,
                   help="CSV with real role data to repair from (default: last season's file for the sport)")
    p.add_argument("--dry-run", action="store_true", help="Preview counts and sample updates only, no writes")
    return p.parse_args()


def is_corrupted(positions):
    if positions is None:
        return True
    if isinstance(positions, list) and len(positions) == 1 and positions[0] == "SF":
        return True
    return False


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


def main():
    args = parse_args()
    cfg = SPORTS[args.sport]

    if cfg["role_module"] == "torvik_metrics":
        from torvik_metrics import torvik_role_to_positions, normalise_pos, _BUCKET_TO_POSITIONS
    else:
        from torvik_metrics_w import torvik_role_to_positions, normalise_pos, _BUCKET_TO_POSITIONS

    role_csv = args.role_csv or cfg["default_csv"]
    if not os.path.exists(role_csv):
        sys.exit(f"Role CSV not found: {role_csv}")
    print(f"Reading real role data from {role_csv} ...")
    role_df = pd.read_csv(role_csv)
    if "pid" not in role_df.columns or "role" not in role_df.columns:
        sys.exit(f"{role_csv} is missing a pid or role column")

    # Dedup: most recent season's row per pid, in case the CSV spans years.
    if "year" in role_df.columns:
        role_df = role_df.sort_values("year", ascending=False).drop_duplicates(subset=["pid"], keep="first")

    pid_to_role = {}
    for _, row in role_df.iterrows():
        pid = row.get("pid")
        role_str = str(row.get("role", "")).strip().lower()
        if pd.notna(pid) and role_str and role_str != "nan":
            pid_to_role[int(pid)] = row.get("role")
    print(f"  {len(pid_to_role)} pid(s) with a usable (non-blank) role in this file")

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print(f"\nFetching {cfg['table']} (id, torvik_pid, positions, name, current_team) ...")
    players = fetch_all(sb, cfg["table"], "id, torvik_pid, positions, name, current_team")
    print(f"  {len(players)} total rows")

    corrupted = [p for p in players if is_corrupted(p.get("positions"))]
    print(f"  {len(corrupted)} row(s) currently stuck at positions=[\"SF\"] or null")

    updates = []
    no_pid = 0
    no_role_match = 0
    unresolvable_role = 0
    for p in corrupted:
        pid = p.get("torvik_pid")
        if pid is None:
            no_pid += 1
            continue
        role_raw = pid_to_role.get(int(pid))
        if role_raw is None:
            no_role_match += 1
            continue
        positions = torvik_role_to_positions(role_raw)
        if not positions:
            positions = list(_BUCKET_TO_POSITIONS.get(normalise_pos(role_raw), []))
        if not positions:
            unresolvable_role += 1
            continue
        updates.append((p["id"], p.get("name"), p.get("current_team"), positions))

    print(f"\n{len(updates)} row(s) can be repaired from {role_csv}.")
    if no_pid:
        print(f"  ⚠ {no_pid} corrupted row(s) have no torvik_pid at all — can't match, skipped.")
    if no_role_match:
        print(f"  ⚠ {no_role_match} corrupted row(s) have a torvik_pid not found in {role_csv} "
              f"(no history there — e.g. a true new addition) — left as-is, skipped.")
    if unresolvable_role:
        print(f"  ⚠ {unresolvable_role} corrupted row(s) matched a pid but its role still didn't resolve — skipped.")

    if args.dry_run:
        print("\n(dry-run — nothing written)")
        for id_, name, team, positions in updates[:10]:
            print(f"  {name} ({team}): -> positions={positions}, primary_position={positions[0]}")
        return

    written = 0
    for id_, name, team, positions in updates:
        sb.table(cfg["table"]).update({
            "positions": positions,
            "primary_position": positions[0],
        }).eq("id", id_).execute()
        written += 1
        if written % 500 == 0:
            print(f"  ... {written}/{len(updates)} repaired")

    print(f"\nDone. Repaired {written} row(s).")


if __name__ == "__main__":
    main()
