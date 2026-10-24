"""
import_pbp_shot_assists.py — Fill assisted_pct_rim/mid/three from Torvik's PBP data
======================================================================================
Source: https://barttorvik.com/{year}_pbp_playerstat_array.json?csv=1

Each row is a 15-element array, no field names:
  [torvik_pid, name, school,
   rim_made, rim_missed, rim_assisted,
   mid_made, mid_missed, mid_assisted,
   three_made, three_missed, three_assisted,
   dunk_made, dunk_missed, dunk_assisted]

Confirmed by cross-referencing against trank_data_2026.csv: the leading
integer is Barttorvik's own `pid` — the same value already stored as
players.torvik_pid / w_players.torvik_pid. Matching on it is direct and
far more reliable than the name/team fuzzy matching match_utils exists for.

Per the BTP Metrics Spec, the "rim" shot bucket includes dunks — Torvik
tracks them as a separate category (confirmed: dunk counts don't overlap
with rim counts in this data), so this script sums dunk_made/missed/assisted
into rim before computing assisted_pct_rim. Mid and three are used as-is.

A bucket with 0 makes gets no value written for that bucket — this script
leaves "no data yet" (null) distinct from "confirmed zero assisted share"
(0.0). torvik_metrics.py's compute_shot_difficulty applies the spec's
"missing counts as 0" rule when it reads these columns, not this importer.

Usage:
    python import_pbp_shot_assists.py --season 2027 --dry-run
    python import_pbp_shot_assists.py --season 2027
    python import_pbp_shot_assists.py --season 2027 --sport women
    python import_pbp_shot_assists.py --season 2027 --json data/my_local_copy.json   # skip the network fetch

Environment variables:
    SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import argparse
import os
import sys

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

PAGE  = 1000
CHUNK = 500

SPORTS = {
    "men":   {"players_table": "players",   "stats_table": "player_stats"},
    "women": {"players_table": "w_players", "stats_table": "w_player_stats"},
}

# Column index map into each 15-element row — named here once so the rest
# of the script doesn't scatter magic indices.
IDX = {
    "pid": 0, "name": 1, "school": 2,
    "rim_made": 3, "rim_missed": 4, "rim_assisted": 5,
    "mid_made": 6, "mid_missed": 7, "mid_assisted": 8,
    "three_made": 9, "three_missed": 10, "three_assisted": 11,
    "dunk_made": 12, "dunk_missed": 13, "dunk_assisted": 14,
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--season", type=int, required=True, help="Season year, e.g. 2027 (matches the PBP JSON's {year} and player_stats.calendar_year)")
    p.add_argument("--sport", choices=["men", "women"], default="men")
    p.add_argument("--json", type=str, default=None, help="Local JSON file instead of fetching from barttorvik.com")
    p.add_argument("--dry-run", action="store_true", help="Preview counts and match rate only, no writes")
    return p.parse_args()


def fetch_pbp_json(season, local_path):
    if local_path:
        import json
        with open(local_path) as f:
            return json.load(f)
    url = f"https://barttorvik.com/{season}_pbp_playerstat_array.json?csv=1"
    print(f"Fetching {url} …")
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


def assisted_share(assisted, made):
    """None (not 0) when there are no makes to compute a share from —
    distinguishes 'no data' from 'confirmed zero assisted share'."""
    if not made:
        return None
    return round(assisted / made, 4)


def build_rows(pbp, season):
    """15-element arrays -> {torvik_pid: {assisted_pct_rim/mid/three}},
    with dunks summed into rim per the spec."""
    out = {}
    skipped_bad_shape = 0
    for r in pbp:
        if len(r) < 15:
            skipped_bad_shape += 1
            continue
        pid = r[IDX["pid"]]

        rim_made      = (r[IDX["rim_made"]]      or 0) + (r[IDX["dunk_made"]]      or 0)
        rim_assisted  = (r[IDX["rim_assisted"]]  or 0) + (r[IDX["dunk_assisted"]]  or 0)
        mid_made      = r[IDX["mid_made"]]      or 0
        mid_assisted  = r[IDX["mid_assisted"]]  or 0
        three_made    = r[IDX["three_made"]]    or 0
        three_assisted = r[IDX["three_assisted"]] or 0

        out[pid] = {
            "assisted_pct_rim":   assisted_share(rim_assisted, rim_made),
            "assisted_pct_mid":   assisted_share(mid_assisted, mid_made),
            "assisted_pct_three": assisted_share(three_assisted, three_made),
        }
    if skipped_bad_shape:
        print(f"  ⚠ Skipped {skipped_bad_shape} row(s) with fewer than 15 fields — unexpected shape")
    return out


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

    pbp = fetch_pbp_json(args.season, args.json)
    print(f"  {len(pbp)} players in the PBP data")

    by_pid = build_rows(pbp, args.season)
    with_any_data = sum(1 for v in by_pid.values() if any(x is not None for x in v.values()))
    print(f"  {with_any_data}/{len(by_pid)} have at least one bucket with makes (the rest had 0 makes everywhere — no assisted share to compute)")

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print(f"\nFetching {cfg['players_table']} (id, torvik_pid) …")
    players = fetch_all(sb, cfg["players_table"], "id, torvik_pid",
                         [lambda q: q.not_.is_("torvik_pid", "null")])
    pid_to_player_id = {p["torvik_pid"]: p["id"] for p in players}
    print(f"  {len(pid_to_player_id)} players with a torvik_pid")

    print(f"\nFetching existing {cfg['stats_table']} rows for season {args.season} …")
    stats_rows = fetch_all(sb, cfg["stats_table"], "id, player_id",
                            [lambda q: q.eq("calendar_year", args.season)])
    player_id_to_stats_id = {r["player_id"]: r["id"] for r in stats_rows}
    print(f"  {len(player_id_to_stats_id)} {cfg['stats_table']} row(s) for season {args.season}")

    updates = []
    matched = 0
    no_stats_row = []
    for pid, vals in by_pid.items():
        player_id = pid_to_player_id.get(pid)
        if not player_id:
            continue
        stats_id = player_id_to_stats_id.get(player_id)
        if not stats_id:
            no_stats_row.append(pid)
            continue
        if all(v is None for v in vals.values()):
            continue
        matched += 1
        updates.append((stats_id, vals))

    print(f"\nMatched {matched} player(s) with data to write.")
    if no_stats_row:
        print(f"  ⚠ {len(no_stats_row)} player(s) matched by torvik_pid but have no {cfg['stats_table']} row for season {args.season} yet "
              f"— run torvik_metrics.py for this season first, then re-run this importer.")

    if args.dry_run:
        print("\n(dry-run — nothing written)")
        for stats_id, vals in updates[:5]:
            print(f"  sample: stats_id={stats_id} -> {vals}")
        return

    written = 0
    for stats_id, vals in updates:
        sb.table(cfg["stats_table"]).update(vals).eq("id", stats_id).execute()
        written += 1
        if written % 500 == 0:
            print(f"  ... {written}/{len(updates)} written")

    print(f"\nDone. Wrote assisted_pct_rim/mid/three on {written} {cfg['stats_table']} row(s).")


if __name__ == "__main__":
    main()
