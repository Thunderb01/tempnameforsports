"""
run_season_pipeline.py — Run the full season data-refresh sequence in order
==============================================================================
Wraps the existing, already-tested pipeline scripts as subprocesses instead
of reimplementing their logic -- this file is pure sequencing. It exists
because the actual failure mode this whole project kept hitting wasn't any
one script being wrong, it was the SEQUENCE being run by hand: a step
skipped, run out of order, or the frontend cache version forgotten. See
CLAUDE.md's pipeline-order notes before changing the order below.

Sequence (men's):
  1. import_pbp_shot_assists.py --season <year> [--json <pbp-json>]
  2. torvik_metrics.py --csv <csv> --year <year>
  3. torvik_metrics.py --repair-departed-on-board <csv>
  4. scraper_to_supabase.py --sync-team-players-from-db
  5. bump sessionBoardVer in src/hooks/useRosterBoard.js
     (useWomensRosterBoard.js instead for --sport women)

Women's has no team_players-equivalent sync script (w_team_players has no
writer anywhere in this codebase -- a pre-existing gap, not something this
orchestrator papers over), so step 4 is skipped for --sport women.

Each step's real stdout/stderr streams through live, unmodified -- this
script does not capture, swallow, or summarize it. If a step exits non-zero,
the pipeline stops immediately; no later step ever runs against a state a
prior step failed to produce.

--dry-run passes --dry-run through to every step that supports it (all of
them). It previews the whole sequence without writing anything -- including
skipping the cache-version bump, since there's nothing to invalidate yet.
Review the dry-run output, then re-run without --dry-run.

--fetch downloads the trank CSV live via torvik_to_csv.py (barttorvik.com's
getadvstats.php) instead of requiring --csv, and lets import_pbp_shot_assists.py
self-fetch the PBP JSON instead of requiring --pbp-json. This has NOT been
verified against barttorvik.com's live response from this codebase's own
sandboxed dev environment (outbound access to barttorvik.com is blocked
there) -- the shape matches what torvik_metrics.py expects based on the
existing trank_adv_*.csv files fetched the same way, but run --fetch
--dry-run once yourself and check the printed column list before trusting
it for a real run.

Usage:
    python run_season_pipeline.py --year 2027 --csv data/trank_data_2027.csv \
        --pbp-json data/2027_pbp_playerstat_array.json --dry-run
    python run_season_pipeline.py --year 2027 --csv data/trank_data_2027.csv \
        --pbp-json data/2027_pbp_playerstat_array.json

    python run_season_pipeline.py --year 2027 --fetch --dry-run   # verify --fetch once
    python run_season_pipeline.py --year 2027 --fetch

    python run_season_pipeline.py --year 2027 --sport women --csv data/trank_ncaaw_2026.csv

    # Skip individual steps:
    python run_season_pipeline.py --year 2027 --csv ... --pbp-json ... --skip-repair
    python run_season_pipeline.py --year 2027 --csv ... --pbp-json ... --skip-team-players-sync
    python run_season_pipeline.py --year 2027 --csv ... --pbp-json ... --skip-cache-bump

Environment variables (passed through unchanged to each step):
    SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import argparse
import datetime
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

CACHE_FILES = {
    "men":   os.path.join(HERE, "src", "hooks", "useRosterBoard.js"),
    "women": os.path.join(HERE, "src", "hooks", "useWomensRosterBoard.js"),
}


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--year", type=int, required=True, help="Season year, e.g. 2027")
    p.add_argument("--sport", choices=["men", "women"], default="men")
    p.add_argument("--csv", type=str, default=None, help="Trank CSV path. Required unless --fetch.")
    p.add_argument("--pbp-json", type=str, default=None,
                    help="Local PBP JSON path. If omitted (and --fetch not set), "
                         "import_pbp_shot_assists.py falls back to its own live fetch.")
    p.add_argument("--fetch", action="store_true",
                    help="Download the trank CSV live via torvik_to_csv.py instead of requiring --csv, "
                         "and let the PBP step self-fetch instead of requiring --pbp-json. "
                         "UNVERIFIED from this sandbox -- see this file's module docstring.")
    p.add_argument("--dry-run", action="store_true", help="Preview every step; write nothing, including the cache bump.")
    p.add_argument("--skip-repair", action="store_true", help="Skip the --repair-departed-on-board step.")
    p.add_argument("--skip-team-players-sync", action="store_true", help="Skip the team_players rebuild step (men's only; always skipped for women's).")
    p.add_argument("--skip-cache-bump", action="store_true", help="Skip bumping sessionBoardVer at the end.")
    return p.parse_args()


def run_step(label, cmd):
    print(f"\n{'═' * 70}\n▶ {label}\n  {' '.join(cmd)}\n{'═' * 70}")
    result = subprocess.run(cmd, cwd=HERE)
    if result.returncode != 0:
        sys.exit(f"\n✗ Step failed ({label}), exit code {result.returncode}. Stopping -- no later step will run.")


def bump_session_board_ver(sport):
    path = CACHE_FILES[sport]
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()

    m = re.search(r"sessionBoardVer:\s*(\d+),(\s*//.*)?", src)
    if not m:
        sys.exit(f"Could not find sessionBoardVer in {path} -- bump it by hand and re-check this regex.")

    old_ver = int(m.group(1))
    new_ver = old_ver + 1
    today = datetime.date.today().isoformat()
    note = f" {old_ver}→{new_ver}: run_season_pipeline.py ({today}) -- data refresh, no other invalidation path."

    # Append the note to whatever comment text already followed
    # sessionBoardVer on that line, rather than replacing it.
    existing_comment = m.group(0).split("//", 1)[1] if "//" in m.group(0) else ""
    new_line = f"sessionBoardVer:            {new_ver}, //{existing_comment}{note}"

    new_src = src[:m.start()] + new_line + src[m.end():]
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_src)
    print(f"\n✓ Bumped sessionBoardVer in {os.path.relpath(path, HERE)}: {old_ver} → {new_ver}")


def main():
    args = parse_args()

    if not args.fetch and not args.csv:
        sys.exit("Either --csv or --fetch is required.")
    if not args.fetch and not args.pbp_json:
        print("No --pbp-json given and --fetch not set -- import_pbp_shot_assists.py will "
              "fall back to its own live fetch for this step only.")

    csv_path = args.csv
    if args.fetch:
        # torvik_to_csv.py has no --dry-run of its own, so this download
        # runs even under --dry-run -- intentional: it only writes a local
        # file (no DB write), and the rest of the pipeline needs the real
        # downloaded data to preview anything meaningful against.
        fetched_path = os.path.join(HERE, "data", f"torvik_{args.year}.csv")
        run_step(
            "Fetch trank CSV live (torvik_to_csv.py)",
            [sys.executable, "torvik_to_csv.py", "--year", str(args.year), "--output", fetched_path],
        )
        csv_path = fetched_path

    metrics_script = "torvik_metrics.py" if args.sport == "men" else "torvik_metrics_w.py"

    pbp_cmd = [sys.executable, "import_pbp_shot_assists.py", "--season", str(args.year), "--sport", args.sport]
    if args.pbp_json and not args.fetch:
        pbp_cmd += ["--json", args.pbp_json]
    if args.dry_run:
        pbp_cmd += ["--dry-run"]
    run_step("1/4 Import PBP shot-assist data", pbp_cmd)

    metrics_cmd = [sys.executable, metrics_script, "--csv", csv_path, "--year", str(args.year)]
    if args.dry_run:
        metrics_cmd += ["--dry-run"]
    run_step("2/4 Refresh metrics + sync roster (torvik_metrics.py)", metrics_cmd)

    if not args.skip_repair:
        repair_cmd = [sys.executable, metrics_script, "--repair-departed-on-board", csv_path]
        if args.dry_run:
            repair_cmd += ["--dry-run"]
        run_step("3/4 Remove departed players from the board", repair_cmd)
    else:
        print("\n(skipped: --repair-departed-on-board)")

    if args.sport == "men" and not args.skip_team_players_sync:
        sync_cmd = [sys.executable, "scraper_to_supabase.py", "--sync-team-players-from-db"]
        if args.dry_run:
            sync_cmd += ["--dry-run"]
        run_step("4/4 Rebuild team_players from current_team", sync_cmd)
    elif args.sport == "women":
        print("\n(skipped: no team_players sync script exists for women's -- w_team_players has no writer)")
    else:
        print("\n(skipped: --skip-team-players-sync)")

    if args.dry_run:
        print("\n(dry-run complete -- nothing was written, sessionBoardVer was not bumped)")
        return

    if not args.skip_cache_bump:
        bump_session_board_ver(args.sport)
    else:
        print("\n(skipped: --skip-cache-bump -- remember to bump sessionBoardVer by hand)")

    print("\n✓ Pipeline complete.")


if __name__ == "__main__":
    main()
