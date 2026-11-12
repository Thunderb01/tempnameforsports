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
self-fetch the PBP JSON instead of requiring --pbp-json. Confirmed 2026-11-11:
barttorvik.com 403s requests from GitHub-hosted Actions runner IPs (cloud/
datacenter ASNs are a common anti-bot target) -- but that's an IP-range
block, not anything about the request itself, so --fetch run from an
ordinary residential connection (i.e. your own machine, not a cloud CI
runner) isn't subject to it. Still worth a --fetch --dry-run once to be
sure before trusting it for a real run.

Every run (fetched or --csv) validates the CSV's shape -- row count, pid
non-null rate, Min_per distribution -- before anything writes to Supabase.
This is the guard that would have caught the 2026-11-08 incidents (a CSV
whose columns silently ended up misaligned without crashing) before either
reached production; see validate_csv_shape() below and CLAUDE.md.

--git-push commits the refreshed CSV + diagnostic files + sessionBoardVer
bump and pushes, once the run completes successfully -- so a full refresh,
publish included, is one command with nothing to remember afterward.

SUPABASE_URL / SUPABASE_SERVICE_KEY are read from .env.local in this
directory if python-dotenv is installed and the vars aren't already set in
your shell -- the same file the frontend's VITE_SUPABASE_* vars already
live in (see .env.example), so there's one env file for the whole repo,
not two. No more re-exporting them every new PowerShell session. Falls
back to whatever's already in your environment if python-dotenv isn't
installed or .env.local doesn't exist.

Usage:
    python run_season_pipeline.py --year 2027 --csv data/trank_data_2027.csv \
        --pbp-json data/2027_pbp_playerstat_array.json --dry-run
    python run_season_pipeline.py --year 2027 --csv data/trank_data_2027.csv \
        --pbp-json data/2027_pbp_playerstat_array.json

    python run_season_pipeline.py --year 2027 --fetch --dry-run   # verify --fetch once
    python run_season_pipeline.py --year 2027 --fetch --git-push  # the whole refresh, one command

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

try:
    from dotenv import load_dotenv
    # .env.local, not .env -- same file the frontend's Vite env vars already
    # live in (see .env.example), so there's one env file for the repo, not
    # two. Loaded into this process's environ; subprocess.run() below
    # inherits it automatically for every step script.
    load_dotenv(os.path.join(HERE, ".env.local"))
except ImportError:
    pass  # python-dotenv optional -- env vars can still be set the usual way

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
                         "barttorvik.com blocks GitHub-hosted CI runner IPs (confirmed 2026-11-11) but not "
                         "ordinary residential connections -- see this file's module docstring.")
    p.add_argument("--dry-run", action="store_true", help="Preview every step; write nothing, including the cache bump.")
    p.add_argument("--skip-repair", action="store_true", help="Skip the --repair-departed-on-board step.")
    p.add_argument("--skip-team-players-sync", action="store_true", help="Skip the team_players rebuild step (men's only; always skipped for women's).")
    p.add_argument("--skip-cache-bump", action="store_true", help="Skip bumping sessionBoardVer at the end.")
    p.add_argument("--git-push", action="store_true",
                    help="Commit the refreshed CSV + diagnostic files + sessionBoardVer bump and push, "
                         "once the run completes. Skipped under --dry-run (nothing would have changed).")
    return p.parse_args()


def validate_csv_shape(csv_path, sport):
    """Sanity-check a trank CSV's shape before anything writes to Supabase --
    row count, pid non-null rate, Min_per distribution. This is the guard
    that would have caught the 2026-11-08 incidents (a CSV whose columns
    silently ended up misaligned by a header/data-row mismatch, without
    crashing) before either reached production -- see CLAUDE.md. Reuses
    read_trank_csv() from the matching sport's metrics module rather than
    re-implementing the parsing a third time."""
    if sport == "men":
        from torvik_metrics import read_trank_csv
    else:
        from torvik_metrics_w import read_trank_csv

    print(f"\nValidating {csv_path} before any Supabase write …")
    df = read_trank_csv(csv_path)
    n = len(df)
    pid_rate = df["pid"].notna().mean() if "pid" in df.columns else 0
    qualified = int((df["Min_per"] >= 20).sum()) if "Min_per" in df.columns else 0
    qualified_ratio = qualified / n if n else 0
    print(f"  {n} rows, pid non-null rate {pid_rate:.1%}, {qualified} qualified at Min_per >= 20% ({qualified_ratio:.1%} of rows)")

    if n < 500:
        sys.exit(f"Only {n} rows in {csv_path} -- expected several thousand this far into the season. Stopping before any Supabase write.")
    if pid_rate < 0.9:
        sys.exit(f"Only {pid_rate:.1%} of rows in {csv_path} have a pid -- looks corrupted (same failure mode as the 2026-11-08 incidents). Stopping before any Supabase write.")
    if qualified_ratio < 0.10:
        sys.exit(f"Only {qualified_ratio:.1%} of rows in {csv_path} qualify at Min_per >= 20% -- looks corrupted. Stopping before any Supabase write.")


def git_commit_and_push(csv_path, sport):
    """Commit the refreshed CSV + diagnostic files + sessionBoardVer bump and
    push -- mirrors exactly what the (now cloud-IP-blocked, unused)
    season-pipeline.yml GitHub Action's last step did, so a fully local run
    is self-contained end to end with no separate git commands to remember."""
    candidates = [csv_path, os.path.join(HERE, "nil_changes.csv"),
                  os.path.join(HERE, "unmatched_players.csv"), CACHE_FILES[sport]]
    existing = [p for p in candidates if os.path.exists(p)]
    if not existing:
        print("\n(--git-push: nothing to commit)")
        return

    subprocess.run(["git", "add", *existing], cwd=HERE, check=True)
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=HERE).returncode == 0:
        print("\n(--git-push: no changes to commit)")
        return

    today = datetime.date.today().isoformat()
    subprocess.run(["git", "commit", "-m", f"Season data refresh ({today})"], cwd=HERE, check=True)
    subprocess.run(["git", "push"], cwd=HERE, check=True)
    print("\n✓ Committed and pushed.")


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

    validate_csv_shape(csv_path, args.sport)

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

    if args.git_push:
        git_commit_and_push(csv_path, args.sport)

    print("\n✓ Pipeline complete.")


if __name__ == "__main__":
    main()
