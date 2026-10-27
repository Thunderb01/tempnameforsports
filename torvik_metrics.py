"""
torvik_metrics.py — Load Torvik CSV → compute BtPM metrics + NIL valuation → write to Supabase
================================================================================================
Reads trank_data_2026.csv, matches players to Supabase by (name, team), writes:
  - Raw Torvik inputs to player_stats (torvik_* columns)
  - Computed BtPM metrics to player_stats (cdi, dds, sei, ath, ris)
  - NIL valuation to players (nil_valuation)
  - Birth year to players (birth_year)

All metric formulas are stubbed with TODO markers — fill them in.
Scale: 100 = mean, 200 = maximum. Use clamp(0, 200).

Usage:
    python torvik_metrics.py --dry-run    # preview, no DB writes
    python torvik_metrics.py              # write to Supabase

Prerequisites — run once in Supabase SQL Editor:
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_ortg float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_usg float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_efg float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_ts float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_obpm float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_dbpm float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_bpm float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_drtg float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_stops float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_ast_pct float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_to_pct float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_orb_pct float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_drb_pct float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_rim_pct float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_mid_pct float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_3p_pct float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_porpag float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_adjoe float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_min_pct float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_gp int;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_blk_pct float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_stl_pct float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_ftr float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_pfr float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_adrtg float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_dporpag float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_ogbpm float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_dgbpm float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_gbpm float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS torvik_rec_rank float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS cdi float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS dds float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS sei float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS ath float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS ris float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS projected_tier text;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS nil_valuation float;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS birth_year int;

    -- BTP Metrics Spec — Shot Difficulty / Adjusted SEI / Shot Creation.
    -- Schema only for now: the Torvik CSV this script reads today has no
    -- "assisted share of makes" data for any shot zone (checked all 67
    -- columns — see CLAUDE.md's Metric peer groups section), so these
    -- three raw inputs and their downstream outputs sit unused until the
    -- new CSV pipeline that will carry assisted_pct_* actually lands.
    -- Nothing in compute_* reads or writes these yet.
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS assisted_pct_three float;        -- 0-1, assisted share of made threes
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS assisted_pct_rim float;          -- 0-1, assisted share of made rim shots (incl. dunks)
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS assisted_pct_mid float;          -- 0-1, assisted share of made midrange shots
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS shot_difficulty float;           -- position percentile of raw shot difficulty
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS shot_difficulty_modifier float;  -- raw difficulty / position-avg difficulty, clamped [0.9, 1.1]
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS adjusted_sei float;              -- position percentile of (raw SEI * shot_difficulty_modifier)
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS sei_diff float;                  -- adjusted_sei - sei, for comparing the two
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS shot_creation float;             -- position percentile; spec marks this "optional, may be retired"

Environment variables:
    $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
    $env:SUPABASE_SERVICE_KEY="your-service-role-key"
"""

import argparse
import csv
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

try:
    from match_utils import build_lookup, match_player as mu_match, norm_name
except ImportError:
    sys.exit("match_utils.py not found — make sure it's in the same directory.")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--csv",     default="data/trank_data_2026.csv")
    p.add_argument("--year",    type=int, default=2026,
                   help="Calendar year of this dataset (e.g. 2025 or 2026). Controls which player_stats row is written.")
    p.add_argument("--dry-run",        action="store_true")
    p.add_argument("--skip-matched",   action="store_true",
                   help="Skip players that already have cdi written in player_stats")
    p.add_argument("--use-torvik-data", action="store_true",
                   help="Use Torvik CSV columns for all metrics instead of scraped Supabase totals")
    p.add_argument("--skip-nil",        action="store_true",
                   help="Do not overwrite nil_valuation on the players table")
    p.add_argument("--historical",      action="store_true",
                   help="Historical mode: only write player_stats rows, skip updating players table (nil, position, etc.)")
    p.add_argument("--teams", nargs="+", metavar="TEAM",
                   help="Only process players from these teams (exact Torvik team name)")
    p.add_argument("--players", nargs="+", metavar="PLAYER",
                   help="Only process these players by name (exact Torvik player_name)")
    p.add_argument("--repair-positions-from", type=str, metavar="CSV", default=None,
                   help="One-time repair mode: fix players rows stuck at positions=[\"SF\"]/null "
                        "(from the blank-role overwrite bug) by re-deriving positions from this CSV's "
                        "real role data, matched by torvik_pid. Runs instead of the normal pipeline.")
    return p.parse_args()


def normalise(s):
    return str(s).strip().lower()


def safe(val, default=None):
    """Return float or default if missing/nan."""
    try:
        v = float(val)
        return None if pd.isna(v) else v
    except (TypeError, ValueError):
        return default


def clamp(val, lo=0, hi=100):
    """Clamp a computed metric to [lo, hi]. Returns None if val is None."""
    if val is None:
        return None
    return max(lo, min(hi, val))


# ── TORVIK TEAM NAME ALIASES ───────────────────────────────────────────────────
# Torvik CSV uses abbreviations/shortnames; map them to what the scraper stores.
TORVIK_TEAM_ALIASES = {
    # "St." → "State" (confirmed from unmatched list)
    "alabama st.":              "alabama state",
    "alcorn st.":               "alcorn state",
    "appalachian st.":          "appalachian state",
    "arkansas st.":             "arkansas state",
    "arizona st.":              "arizona state",
    "ball st.":                 "ball state",
    "boise st.":                "boise state",
    "central connecticut":  "central connecticut st.",
    "chicago st.":              "chicago state",
    "cleveland st.":            "cleveland state",
    "colorado st.":             "colorado state",
    "coppin st.":               "coppin state",
    "east tennessee st.":       "east tennessee state",
    "florida st.":              "florida state",
    "fresno st.":               "fresno state",
    "georgia st.":              "georgia state",
    "grambling st.":            "grambling state",
    "idaho st.":                "idaho state",
    "illinois st.":             "illinois state",
    "indiana st.":              "indiana state",
    "iowa st.":                 "iowa state",
    "jackson state":              "jackson st.",
    "jacksonville st.":         "jacksonville state",
    "kansas st.":               "kansas state",
    "kennesaw state":             "kennesaw st.",
    "kent st.":                 "kent state",
    "long beach st.":           "long beach state",
    "michigan st.":             "michigan state",
    "mississippi st.":          "mississippi state",
    "mississippi valley state":   "mississippi valley st.",
    "missouri st.":             "missouri state",
    "montana st.":              "montana state",
    "morehead st.":             "morehead state",
    "morgan st.":               "morgan state",
    "murray st.":               "murray state",
    "new mexico st.":           "new mexico state",
    "nicholls st.":             "nicholls state",
    "norfolk st.":              "norfolk state",
    "north dakota st.":         "north dakota state",
    # "northwestern st.":         "northwestern state",
    "ohio st.":                 "ohio state",
    "oklahoma st.":             "oklahoma state",
    "oregon st.":               "oregon state",
    "penn st.":                 "penn state",
    
    "sacramento st.":           "sacramento state",
    "sam houston st.":          "sam houston",
    "san diego st.":            "san diego state",
    "san jose st.":             "san jose state",
    
    "south dakota st.":         "south dakota state",
    # "southeast missouri st.":   "southeast missouri state",
    "tarleton st.":             "tarleton state",
    "tennessee st.":            "tennessee state",
    "texas st.":                "texas state",
    "utah st.":                 "utah state",
    "washington st.":           "washington state",
    "weber st.":                "weber state",
    "wichita st.":              "wichita state",
    # "wright st.":               "wright state",
    # "youngstown st.":           "youngstown state",
    # Other common renames
    "n.c. state":               "nc state",
    "mississippi":              "ole miss",
    "illinois chicago":         "uic",
    "mcneese st.":              "mcneese",
    # "texas a&m corpus chris":   "texas a&m corpus christi",
    "louisiana monroe":         "louisiana monroe",
    "little rock":              "little rock",
    "mount st. mary's":         "mount st. mary's",
    "cal state fullerton":        "cal st. fullerton",
    "cal state northridge":       "cal st. northridge",
    "cal state bakersfield":      "cal st. bakersfield",
   
    "siue":                     "siu edwardsville",
    "siu":                      "southern illinois",
    # "umkc":                     "kansas city",
    "umass lowell":             "umass lowell",
    "nebraska omaha":           "nebraska omaha",
    "ut arlington":             "ut arlington",
    # "ut rio grande valley":     "utrgv",
    "uconn":                    "connecticut",
    "fgcu":                     "florida gulf coast",
    "miami fl":                 "miami",
    "miami oh":                 "miami (oh)",
    "vmi":                      "vmi",
    "unc":                      "north carolina",
    "unc asheville":            "unc asheville",
    "unc greensboro":           "unc greensboro",
    "unc wilmington":           "unc wilmington",
    "pitt":                     "pittsburgh",
    "wku":                      "western kentucky",
    "wvu":                      "west virginia",
    "vcu":                      "vcu",
    "tcu":                      "tcu",
    "smu":                      "smu",
    "byu":                      "byu",
    "sfa":                      "stephen f. austin",
    "texas a&m":                "texas a&m",
    "uab":                      "uab",
    "utsa":                     "utsa",
    "utep":                     "utep",
    "usc":                      "usc",
    "ucf":                      "ucf",
    "fiu":                      "fiu",
    "lsu":                      "lsu",
}

def normalise_team(team_str):
    n = normalise(team_str)
    return TORVIK_TEAM_ALIASES.get(n, n)


# Maps Torvik display names → canonical display names for player_stats.school
# Add entries here when Torvik and SR use different names for the same school
# and normalise_team's alias (below) + team_conferences.csv's own casing
# don't already resolve it (e.g. a school team_conferences.csv doesn't list).
SCHOOL_DISPLAY_MAP = {
    "UConn": "Connecticut",
    # "Pitt":  "Pittsburgh",
    # "UNC":   "North Carolina",
    # "WKU":   "Western Kentucky",
    # "WVU":   "West Virginia",
    # "Miami FL": "Miami",
}

def _load_team_display_names():
    """lowercase team name -> canonical display-cased name, read from
    data/team_conferences.csv -- the same single source of truth
    teamLookup.js's getCanonicalTeamName() reads on the frontend (see
    CLAUDE.md's alias/lookup-table rules). Used to properly case
    normalise_team's alias values (which are plain lowercase, meant only as
    matching keys) instead of guessing at title-casing acronyms like "NC
    State", "UAB", or "SIU Edwardsville" by hand."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "team_conferences.csv")
    out = {}
    try:
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.reader(f):
                if not row or row[0] == "team":
                    continue
                name = row[0].strip()
                if name:
                    out[name.lower()] = name
    except FileNotFoundError:
        pass
    return out

_TEAM_DISPLAY_NAMES = _load_team_display_names()

def display_school(team_str):
    """Return the canonical display name for a school -- used when writing
    players.current_team and player_stats.school. Torvik's own spelling
    (team_str) is frequently abbreviated ("Ohio St.") where the rest of the
    app -- team_conferences.csv, team_players, the Roster Builder's team
    list -- expects the canonical spelling ("Ohio State"). current_team in
    particular is matched/joined against, not just displayed, so a mismatch
    here silently breaks that matching rather than just looking off.
    Resolves through normalise_team's alias map first, then looks up that
    alias's properly-cased canonical form in team_conferences.csv; falls
    back to team_str unchanged if team_conferences.csv has no entry for it."""
    if team_str in SCHOOL_DISPLAY_MAP:
        return SCHOOL_DISPLAY_MAP[team_str]
    canonical = _TEAM_DISPLAY_NAMES.get(normalise_team(team_str))
    return canonical or team_str


# ── POSITION NORMALISATION ─────────────────────────────────────────────────────
# Torvik's 'role' column values (e.g. "Wing F", "Combo G", "Big") are mapped
# to three position buckets so percentile ranks are position-relative.
#
# DO NOT CHANGE normalise_pos OR percentrank_by_pos WITHOUT INTENDING TO
# REVALUE THE ENTIRE DATABASE. Every BTP metric (sei/ath/ris/dds/cdi) and
# every NIL figure is a percentile computed *within* the bucket this returns,
# so altering the grouping silently rewrites every number in the app. The
# five-position model deliberately runs alongside this rather than replacing
# it — see torvik_role_to_positions below.
#
# Four buckets as of the BTP Metrics Spec (Guard/Wing/Forward/Big): "Forward"
# is Barttorvik's "Wing F" and "Stretch 4" roles, split out of what used to
# be a 3-bucket Guard/Wing/Big system (where both fell through to Wing — see
# git history for that prior version if you need it). This is a deliberate,
# one-time revaluation: re-running the pipeline after this change moves
# every Wing-F/Stretch-4 player's metrics (new peer group) and nudges
# everyone else's percentiles slightly (the Wing pool shrank). The
# five-position mapping below is unaffected either way — it already reported
# Stretch 4 as PF / Wing F as SF-PF for display/lineup purposes.

def normalise_pos(role):
    role = str(role).strip().lower()
    if any(x in role for x in ["guard", "combo g", "pure pg", "scoring pg"]):
        return "Guard"
    # Checked before the generic "wing" branch below — "wing f" would
    # otherwise match it first.
    if any(x in role for x in ["wing f", "stretch 4"]):
        return "Forward"
    if any(x in role for x in ["wing", "small f", "sf"]):
        return "Wing"
    if any(x in role for x in ["big", "pf", "center", "power"]) or role in ("c",) or role.startswith("c ") or role.endswith(" c"):
        return "Big"
    return "Wing"  # default -- ONLY a reasonable choice when there is truly no
    # other signal at all (see _bucket_from_positions below, which main()
    # tries FIRST whenever role is blank). Called directly by normalise_pos's
    # other callers (_BUCKET_TO_POSITIONS lookups, the five-position
    # fallback), which have no positions array to fall back to.


def _bucket_from_positions(positions):
    """Derive the Guard/Wing/Forward/Big metric peer group from a player's
    already-known five-position eligibility set (players.positions) --
    used as the pos_bucket fallback when this pass's Torvik role is blank
    (e.g. trank_data_2027.csv, a precursor CSV seeded from last season's
    stats before this season's role has been computed -- role is blank for
    every row). Returns None if there's nothing usable to go on, so the
    caller can fall back to normalise_pos's "Wing" default as the true last
    resort rather than the first choice.

    Mirrors src/lib/positions.js's legacyBucketFor() exactly: Forward
    requires the unambiguous dual SF+PF signature (Wing F), not just a bare
    SF or PF -- a bare SF is also what the legacy "Wing" bucket expansion
    and the unknown-position fallback produce, and a bare PF (no C) is what
    most ordinary PF-only bigs carry too, not just Stretch 4. Defaulting
    those to Forward previously dumped the Full Board's display bucket into
    Forward almost entirely (see CLAUDE.md) -- the same bug here would
    corrupt the actual percentile math, not just a display label.
    """
    if not positions:
        return None
    first = positions[0]
    if first in ("PG", "SG"):
        return "Guard"
    if first == "SF":
        return "Forward" if "PF" in positions else "Wing"
    if first == "PF":
        if "C" in positions:
            return "Big"
        return "Forward" if "SF" in positions else "Big"
    if first == "C":
        return "Big"
    return None


# ── FIVE-POSITION MAPPING ──────────────────────────────────────────────────────
# Torvik's eight roles → the PG/SG/SF/PF/C eligibility set stored in
# players.positions. Four roles are inherently dual, which is where
# multi-position eligibility comes from. This feeds display, filtering and
# lineup construction only — never the percentile math above.
TORVIK_ROLE_TO_POSITIONS = {
    "pure pg":    ["PG"],
    "scoring pg": ["PG"],
    "combo g":    ["PG", "SG"],
    "wing g":     ["SG", "SF"],
    "wing f":     ["SF", "PF"],
    "stretch 4":  ["PF"],
    "pf/c":       ["PF", "C"],
    "c":          ["C"],
}

# Fallback when Torvik has no role for a player: expand the three-bucket
# value so they still land somewhere plausible. Mirrors the same expansion in
# src/lib/positions.js.
_BUCKET_TO_POSITIONS = {"Guard": ["PG", "SG"], "Wing": ["SF"], "Forward": ["SF", "PF"], "Big": ["PF", "C"]}


def torvik_role_to_positions(role):
    """Map a Torvik role to its five-position eligibility set.

    Returns [] when the role is blank/unrecognised so callers can decide
    whether to fall back rather than silently writing a wrong position.
    """
    key = str(role).strip().lower()
    return list(TORVIK_ROLE_TO_POSITIONS.get(key, []))


def _is_corrupted_positions(positions):
    """True for the one shape the blank-role overwrite bug (and the
    pre-existing UNKNOWN_POSITION_FALLBACK / legacy "Wing"-bucket-expansion
    paths) can produce: null, or exactly the single-element ["SF"]. No real
    TORVIK_ROLE_TO_POSITIONS entry resolving to SF ever omits PF (that's
    Wing F), so this signature is unambiguous -- never a legitimate value."""
    if positions is None:
        return True
    return isinstance(positions, list) and len(positions) == 1 and positions[0] == "SF"


def repair_positions_from_prior_role(db, csv_path, dry_run):
    """One-time repair for rows stuck at positions=["SF"]/null from the
    blank-role overwrite bug (see CLAUDE.md's positions section) -- that fix
    only stops FUTURE runs from reclobbering the column, it does nothing for
    rows already written. Matches each corrupted players row by torvik_pid
    against `csv_path` (a CSV with real role data, e.g. last season's) and
    rewrites ONLY positions/primary_position via the same
    torvik_role_to_positions/normalise_pos this file's main pipeline uses --
    never stats, NIL, or year/class, so it can't drag stale data onto the
    current board the way re-running the full pipeline against an old CSV
    would. A row with no match in csv_path (no prior-season history) is left
    alone and reported, not guessed at."""
    if not os.path.exists(csv_path):
        sys.exit(f"Role CSV not found: {csv_path}")
    print(f"Reading real role data from {csv_path} …")
    role_df = pd.read_csv(csv_path)
    if "pid" not in role_df.columns or "role" not in role_df.columns:
        sys.exit(f"{csv_path} is missing a pid or role column")
    if "year" in role_df.columns:
        role_df = role_df.sort_values("year", ascending=False).drop_duplicates(subset=["pid"], keep="first")

    pid_to_role = {}
    for _, row in role_df.iterrows():
        pid = row.get("pid")
        role_str = str(row.get("role", "")).strip().lower()
        if pd.notna(pid) and role_str and role_str != "nan":
            pid_to_role[int(pid)] = row.get("role")
    print(f"  {len(pid_to_role)} pid(s) with a usable (non-blank) role in this file")

    print("\nFetching players (id, torvik_pid, positions, name, current_team) …")
    rows, page, page_size = [], 0, 1000
    while True:
        res = db.table("players").select("id, torvik_pid, positions, name, current_team") \
                .range(page * page_size, (page + 1) * page_size - 1).execute()
        rows.extend(res.data or [])
        if len(res.data or []) < page_size:
            break
        page += 1
    print(f"  {len(rows)} total rows")

    corrupted = [p for p in rows if _is_corrupted_positions(p.get("positions"))]
    print(f"  {len(corrupted)} row(s) currently stuck at positions=[\"SF\"] or null")

    updates, no_pid, no_role_match, unresolvable = [], 0, 0, 0
    for p in corrupted:
        pid = p.get("torvik_pid")
        if pid is None:
            no_pid += 1
            continue
        role_raw = pid_to_role.get(pid)
        if role_raw is None:
            no_role_match += 1
            continue
        positions = torvik_role_to_positions(role_raw)
        if not positions:
            positions = list(_BUCKET_TO_POSITIONS.get(normalise_pos(role_raw), []))
        if not positions:
            unresolvable += 1
            continue
        updates.append((p["id"], p.get("name"), p.get("current_team"), positions))

    print(f"\n{len(updates)} row(s) can be repaired from {csv_path}.")
    if no_pid:
        print(f"  ⚠ {no_pid} corrupted row(s) have no torvik_pid at all — can't match, skipped.")
    if no_role_match:
        print(f"  ⚠ {no_role_match} corrupted row(s) have a torvik_pid not found in {csv_path} "
              f"(no history there — e.g. a true new addition) — left as-is, skipped.")
    if unresolvable:
        print(f"  ⚠ {unresolvable} corrupted row(s) matched a pid but its role still didn't resolve — skipped.")

    if dry_run:
        print("\n(dry-run — nothing written)")
        for id_, name, team, positions in updates[:10]:
            print(f"  {name} ({team}): -> positions={positions}, primary_position={positions[0]}")
        return

    written = 0
    for id_, name, team, positions in updates:
        db.table("players").update({
            "positions": positions,
            "primary_position": positions[0],
        }).eq("id", id_).execute()
        written += 1
        if written % 500 == 0:
            print(f"  ... {written}/{len(updates)} repaired")
    print(f"\nDone. Repaired {written} row(s).")


def percentrank_by_pos(df, col, pos_col="pos_bucket", scale=100):
    """
    For each row, compute percentile rank of df[col] within its position group.
    Returns a Series of floats in [0, scale]. Higher = better.
    Lower = better columns (like drtg, to_per) should be passed negated.
    """
    result = pd.Series(index=df.index, dtype=float)
    for _, group in df.groupby(pos_col):
        vals = group[col].dropna()
        if vals.empty:
            continue
        result[group.index] = group[col].apply(
            lambda x: round((vals < x).sum() / len(vals) * scale, 2)
            if pd.notna(x) else None
        )
    return result


# ── METRIC FORMULAS ────────────────────────────────────────────────────────────
# Each function receives the full dataframe (already has pos_bucket column).
# Return a Series of floats in [0, 200] where 100 = median, 200 = elite.
#
# Available columns (see trank_data.csv header):
#   ORtg, usg, eFG, TS_per, ORB_per, DRB_per, AST_per, TO_per
#   obpm, dbpm, bpm, drtg, adrtg, stops, porpag, adjoe
#   rimmade/(rimmade+rimmiss), midmade/(midmade+midmiss), TP_per, FT_per
#   blk_per, stl_per, pfr, ftr, gbpm, ogbpm, dgbpm, Min_per, GP
#   ast/tov

def compute_cdi(df):
    # Forward (Wing F / Stretch 4) sits between Wing and Big in playmaking
    # responsibility — 1.04 is the Wing/Big midpoint, a placeholder like the
    # rest of these multipliers, not a tuned value. Without an explicit entry
    # here this .map() produces NaN for every Forward row (no fallback),
    # which would silently blank their CDI.
    pos_mult = df["pos_bucket"].map({"Guard": 1.15, "Wing": 1.08, "Forward": 1.04, "Big": 1.0})

    # AST_per: Torvik's pace-adjusted assist %, available for everyone
    ast_score = df["AST_per"]

    # ast_tov from Torvik — direct measure of decision quality
    # Use totals-derived when available, fall back to Torvik column
    ast_40  = (df["sb_tot_ast"] / df["sb_tot_mp"].replace(0, float("nan"))) * 40
    tov_40  = (df["sb_tot_tov"] / df["sb_tot_mp"].replace(0, float("nan"))) * 40
    ast_tov = (ast_40 / tov_40.replace(0, float("nan"))).fillna(df["ast/tov"])

    df["_cdi_raw"] = ast_score * (ast_tov ** 0.5) * pos_mult

    return percentrank_by_pos(df, "_cdi_raw").apply(clamp)



def compute_dds(df, use_torvik=False):
    """
    DDS — Defensive Disruption Score (BTP Metrics Spec)

    raw = stops_per40
        + 1.0  * (steals + 0.75 * blocks)
        + 0.1  * (position-average DRTG - this player's DRTG)
        - 0.25 * personal-foul rate

    No floor at zero, and defensive rebounds aren't added separately —
    Torvik's `stops` already includes them. Weights (1, 0.75, 0.1, 0.25) are
    placeholders per the spec, not tuned.

    `stops` and `drtg` are always read from Torvik's own columns — neither
    has a meaningful totals-mode equivalent (they're Torvik-computed, not
    derivable from raw box-score totals), unlike steals/blocks/fouls, which
    the spec explicitly gives a totals-mode (per-40) definition for.
    """
    stops = df["stops"].fillna(0)
    drtg  = df["drtg"]

    if use_torvik:
        stl = df["stl_per"].fillna(0)
        blk = df["blk_per"].fillna(0)
        pfr = df["pfr"].fillna(0)
    else:
        # Per-40 from scraped box-score totals, falling back to Torvik's own
        # rate stats wherever sb_tot_* totals aren't available for a player
        # (mirrors the fallback pattern compute_cdi already uses for ast/tov).
        mp_40 = (df["sb_tot_mp"].replace(0, float("nan")) / 40) if "sb_tot_mp" in df.columns else None
        if mp_40 is not None:
            stl = (df["sb_tot_stl"] / mp_40).fillna(df["stl_per"].fillna(0)) if "sb_tot_stl" in df.columns else df["stl_per"].fillna(0)
            blk = (df["sb_tot_blk"] / mp_40).fillna(df["blk_per"].fillna(0)) if "sb_tot_blk" in df.columns else df["blk_per"].fillna(0)
            pfr = (df["sb_tot_pf"]  / mp_40).fillna(df["pfr"].fillna(0))     if "sb_tot_pf"  in df.columns else df["pfr"].fillna(0)
        else:
            stl = df["stl_per"].fillna(0)
            blk = df["blk_per"].fillna(0)
            pfr = df["pfr"].fillna(0)

    # Position-average DRTG — computed over whatever's already in df (the
    # qualified, >= 20% minutes pool by the time this runs), grouped by the
    # same four-bucket pos_bucket every other BTP metric uses.
    pos_avg_drtg = df.groupby("pos_bucket")["drtg"].transform("mean")

    df["_dds_raw"] = (
        stops
        + 1.0  * (stl + 0.75 * blk)
        + 0.1  * (pos_avg_drtg - drtg)
        - 0.25 * pfr
    )

    return percentrank_by_pos(df, "_dds_raw").apply(clamp)


def compute_sei(df, use_torvik=False):
    """
    SEI — Scoring Efficiency Index
    Measures how efficiently a player scores relative to usage.
    For 3PT specialists (3PA/FGA >= 0.70, 3P% >= 37%), USG is floored at 15
    so catch-and-shoot players aren't penalized for low creation volume.
    Everyone uses the same formula so percentile ranks stay comparable.

    Special case: Bigs with fewer than 10 total 3PA have their TS% recomputed
    excluding 3-point shots so rare/failed 3PT attempts don't drag down their
    scoring efficiency percentile.
    """
    ts  = df["TS_per"].fillna(0)
    usg = df["usg"].fillna(0)

    # ── Adjust TS% for Bigs who barely shot threes ────────────────────────────
    # A Big who attempted < 10 threes all season shouldn't be penalized for those
    # misses. Recompute TS% using only 2PA + FTA for those players.
    big_low_tpa = (df["pos_bucket"] == "Big") & (df["TPA"].fillna(0) < 10)
    if big_low_tpa.any():
        fga     = (df["twoPA"].fillna(0) + df["TPA"].fillna(0)).replace(0, float("nan"))
        fta     = (df["ftr"].fillna(0) * fga).fillna(0)
        pts     = df["TS_per"].fillna(0) * 2 * (fga.fillna(0) + 0.44 * fta)
        adj_fga = df["twoPA"].fillna(0)
        adj_fta = df["ftr"].fillna(0) * adj_fga
        adj_pts = pts - df["TPM"].fillna(0) * 3
        denom   = (2 * (adj_fga + 0.44 * adj_fta)).replace(0, float("nan"))
        adj_ts  = (adj_pts / denom).fillna(df["TS_per"].fillna(0))
        ts = ts.where(~big_low_tpa, adj_ts)

    # Discount USG by TO rate so turnover-prone players don't get a free SEI boost.
    # e.g. USG=27 with 17% TO rate → effective USG = 27 * (1 - 0.17) = 22.4
    to_rate = df["TO_per"].fillna(0) / 100
    usg = usg * (1 - to_rate)

    total_fga  = (df["twoPA"].fillna(0) + df["TPA"].fillna(0)).replace(0, float("nan"))
    three_ratio = df["TPA"].fillna(0) / total_fga
    is_specialist = (three_ratio >= 0.70) & (df["TP_per"].fillna(0) >= 0.37)

    # Floor USG at 15 for specialists — keeps the formula comparable across all players
    usg_adj = usg.where(~is_specialist, usg.clip(lower=15))

    if use_torvik:
        df["_sei_raw"] = ts * (usg_adj ** 0.5)
    else:
        fga    = df["sb_tot_fga"].fillna(0) if "sb_tot_fga" in df.columns else usg_adj
        mp     = df["sb_tot_mp"].replace(0, float("nan")).fillna(0) if "sb_tot_mp" in df.columns else pd.Series(1, index=df.index)
        fga_40 = (fga / mp.replace(0, float("nan"))) * 40
        # For specialists with missing sb data, fall back to torvik usg_adj
        fga_40_adj = fga_40.where(fga_40 > 0, usg_adj)
        df["_sei_raw"] = ts * (fga_40_adj ** 0.5)

    return percentrank_by_pos(df, "_sei_raw").apply(clamp)


# ── Shot Difficulty / Adjusted SEI / Shot Creation (BTP Metrics Spec 3-5) ───────
# Needs assisted_pct_rim/mid/three on df (merged in main() from player_stats,
# written there by import_pbp_shot_assists.py) and attempts per bucket from
# the Torvik CSV. "Rim" already includes dunks by the time assisted_pct_rim
# reaches this file — the importer sums them — so attempts must be summed the
# same way here (rimmade+rimmiss + dunksmiss+dunksmade) to match.
#
# Do NOT use usage rate anywhere in here — SEI already rewards shot volume
# (explicit spec rule, section 6).

SHOT_BUCKET_WEIGHT = {"three": 1.0, "rim": 0.8, "mid": 0.6}

# Unassisted-to-assisted conversion ratio r, by position and bucket — how
# often unassisted shots go in compared to assisted ones. Spec's own table;
# not tuned by us.
SHOT_R_RATIO = {
    "three": {"Guard": 0.75, "Wing": 0.80, "Forward": 0.78, "Big": 0.85},
    "rim":   {"Guard": 0.80, "Wing": 0.85, "Forward": 0.85, "Big": 0.95},
    "mid":   {"Guard": 0.80, "Wing": 0.85, "Forward": 0.85, "Big": 0.90},
}

SHOT_DIFFICULTY_CREATION_DISCOUNT = 0.6
SHOT_DIFFICULTY_CLAMP = (0.9, 1.1)


def _shot_bucket_attempts(df):
    """attempts/makes per bucket from the Torvik CSV, rim combined with dunks."""
    rim_attempts   = df["rimmade+rimmiss"].fillna(0) + df["dunksmiss+dunksmade"].fillna(0)
    rim_makes      = df["rimmade"].fillna(0) + df["dunksmade"].fillna(0)
    mid_attempts   = df["midmade+midmiss"].fillna(0)
    mid_makes      = df["midmade"].fillna(0)
    three_attempts = df["TPA"].fillna(0)
    three_makes    = df["TPM"].fillna(0)
    return {
        "rim":   {"attempts": rim_attempts,   "makes": rim_makes},
        "mid":   {"attempts": mid_attempts,   "makes": mid_makes},
        "three": {"attempts": three_attempts, "makes": three_makes},
    }


def compute_shot_difficulty(df):
    """
    Shot Difficulty (BTP Metrics Spec section 3)

    Per bucket: estimate the assisted share of ATTEMPTS from the assisted
    share of MAKES (via the position/bucket r-ratio), apply the creation
    discount, weight by bucket, sum into a single "weighted attempts" figure
    — a lower value means a harder, more self-created shot profile.

    Returns (percentile, difficulty_modifier) — the modifier is what
    compute_adjusted_sei multiplies raw SEI by.
    """
    buckets = _shot_bucket_attempts(df)
    # Missing assisted share counts as 0 (spec section 6) — fully unassisted.
    asm = {
        "rim":   df["assisted_pct_rim"].fillna(0)   if "assisted_pct_rim"   in df.columns else pd.Series(0.0, index=df.index),
        "mid":   df["assisted_pct_mid"].fillna(0)   if "assisted_pct_mid"   in df.columns else pd.Series(0.0, index=df.index),
        "three": df["assisted_pct_three"].fillna(0) if "assisted_pct_three" in df.columns else pd.Series(0.0, index=df.index),
    }

    weighted_total = pd.Series(0.0, index=df.index)
    attempts_total = pd.Series(0.0, index=df.index)

    for bucket, data in buckets.items():
        r = df["pos_bucket"].map(SHOT_R_RATIO[bucket])
        a = asm[bucket]
        # (r * ASM) / ((1 - ASM) + r * ASM) — denominator never hits 0 for
        # r in (0, 1] and ASM in [0, 1], see compute_shot_difficulty's own
        # derivation notes in CLAUDE.md.
        estimated_assisted_attempts_share = (r * a) / ((1 - a) + r * a)
        creation_factor = 1 - SHOT_DIFFICULTY_CREATION_DISCOUNT * estimated_assisted_attempts_share
        weighted_total += data["attempts"] * SHOT_BUCKET_WEIGHT[bucket] * creation_factor
        attempts_total += data["attempts"]

    df["_shot_difficulty_raw"] = (weighted_total / attempts_total.replace(0, float("nan")))

    # Position-average difficulty is POOLED (sum of weighted / sum of total
    # across the group), not a mean of per-player ratios — spec section 3.
    _tmp = pd.DataFrame({"pos_bucket": df["pos_bucket"], "weighted": weighted_total, "total": attempts_total})
    pos_sums = _tmp.groupby("pos_bucket")[["weighted", "total"]].transform("sum")
    pos_avg_difficulty = pos_sums["weighted"] / pos_sums["total"].replace(0, float("nan"))

    modifier = (df["_shot_difficulty_raw"] / pos_avg_difficulty).clip(*SHOT_DIFFICULTY_CLAMP)
    df["_shot_difficulty_modifier"] = modifier

    n_low_clamp  = (modifier == SHOT_DIFFICULTY_CLAMP[0]).sum()
    n_high_clamp = (modifier == SHOT_DIFFICULTY_CLAMP[1]).sum()
    if n_low_clamp or n_high_clamp:
        print(f"  Shot Difficulty modifier clamp hits: {n_low_clamp} at {SHOT_DIFFICULTY_CLAMP[0]}, {n_high_clamp} at {SHOT_DIFFICULTY_CLAMP[1]} "
              f"(spec section 6: a large number here means the range needs widening)")

    return percentrank_by_pos(df, "_shot_difficulty_raw").apply(clamp), modifier


def compute_adjusted_sei(df):
    """
    Adjusted SEI (BTP Metrics Spec section 4) — raw SEI (compute_sei's
    _sei_raw side-effect column) times the Shot Difficulty modifier. Must be
    called after both compute_sei and compute_shot_difficulty have run on df.
    Returns (adjusted_sei_percentile, sei_diff) — sei_diff is
    adjusted_sei_percentile - the basic sei percentile, so the two are easy
    to compare (spec: "ideally with a column showing the difference").
    """
    df["_adjusted_sei_raw"] = df["_sei_raw"] * df["_shot_difficulty_modifier"]
    adjusted_pct = percentrank_by_pos(df, "_adjusted_sei_raw").apply(clamp)
    sei_diff = adjusted_pct - df["_sei"]
    return adjusted_pct, sei_diff


def compute_shot_creation(df):
    """
    Shot Creation (BTP Metrics Spec section 5) — "optional, may be retired."
    weighted_unassisted_makes = makes * (1 - ASM) * bucket_weight, summed
    across buckets; raw = that / (makes * bucket_weight, summed). A higher
    value means more of a player's own makes were unassisted (self-created).

    The spec also describes a test variant that drops the rim bucket
    entirely for Bigs — not implemented here, it's explicitly experimental.
    """
    buckets = _shot_bucket_attempts(df)
    asm = {
        "rim":   df["assisted_pct_rim"].fillna(0)   if "assisted_pct_rim"   in df.columns else pd.Series(0.0, index=df.index),
        "mid":   df["assisted_pct_mid"].fillna(0)   if "assisted_pct_mid"   in df.columns else pd.Series(0.0, index=df.index),
        "three": df["assisted_pct_three"].fillna(0) if "assisted_pct_three" in df.columns else pd.Series(0.0, index=df.index),
    }

    weighted_makes            = pd.Series(0.0, index=df.index)
    weighted_unassisted_makes = pd.Series(0.0, index=df.index)

    for bucket, data in buckets.items():
        w = SHOT_BUCKET_WEIGHT[bucket]
        weighted_makes            += data["makes"] * w
        weighted_unassisted_makes += data["makes"] * (1 - asm[bucket]) * w

    df["_shot_creation_raw"] = weighted_unassisted_makes / weighted_makes.replace(0, float("nan"))
    return percentrank_by_pos(df, "_shot_creation_raw").apply(clamp)


def compute_ath(df, use_torvik=False):
    """
    ATH — Athleticism Index
    Measures athleticism and physical impact.

    When use_torvik=True: pure Barttorvik columns, works for all ~3000 players.
    When use_torvik=False: uses scraped Supabase totals for per-40 stats.

    Three components:
      EXPLOSION  — finishing at the rim, dunking ability
      MOBILITY   — lateral quickness, steals, blocks, rebounding
      CONTACT    — drawing fouls, winning 50/50s at the rim

    Position weights shift emphasis:
      Guard  → mobility-heavy
      Wing   → balanced
      Big    → explosion + contact
    """
    # ── Shared Torvik columns (available regardless of flag) ──────────────────
    df["_dunk_vol_per"]  = percentrank_by_pos(df, "dunksmade")
    df["_dunk_rate_per"] = percentrank_by_pos(df, "dunksmade/(dunksmiss+dunksmade)")
    df["_rim_fin_per"]   = percentrank_by_pos(df, "rimmade/(rimmade+rimmiss)")
    df["_ftr_per"]       = percentrank_by_pos(df, "ftr")
    df["_stl_per_per"]   = percentrank_by_pos(df, "stl_per")
    df["_blk_per_per"]   = percentrank_by_pos(df, "blk_per")
    df["_orb_per_per"]   = percentrank_by_pos(df, "ORB_per")

    if use_torvik:
        df["_drb_per_per"] = percentrank_by_pos(df, "DRB_per")
    else:
        df["_drb_per_per"] = percentrank_by_pos(df, "sb_drb_40")

    # Fill NaN percentiles with 0 so players with no data (e.g. 0 dunks → 0/0 = NaN)
    # don't propagate NaN into component sums and inflate scores for others.
    for _col in ["_dunk_vol_per", "_dunk_rate_per", "_rim_fin_per", "_ftr_per",
                 "_stl_per_per", "_blk_per_per", "_orb_per_per", "_drb_per_per"]:
        df[_col] = df[_col].fillna(0)

    # ── Component scores ──────────────────────────────────────────────────────
    # Forward (Wing F / Stretch 4) rows in every dict below are the Wing/Big
    # midpoint — ATH isn't covered by the BTP Metrics Spec's Forward split,
    # so there's no tuned value to use yet. Without an explicit entry each
    # .get() would silently fall back to Wing's weights (same as today's
    # pre-split behavior); an explicit midpoint is a better placeholder than
    # quietly inheriting Wing. Revisit once ATH gets its own Forward pass.
    #
    # EXPLOSION: finishing through/above defenders
    EXPLOSION_W = {
        "Guard":   (0.30,  0.20,  0.50),  # rim finish matters most for guards
        "Wing":    (0.35,  0.30,  0.35),
        "Forward": (0.375, 0.325, 0.30),
        "Big":     (0.40,  0.35,  0.25),  # dunks + rim finish dominate for bigs
    }
    def explosion(row):
        w = EXPLOSION_W.get(row["pos_bucket"], EXPLOSION_W["Wing"])
        return (row["_dunk_vol_per"] * w[0]
              + row["_dunk_rate_per"] * w[1]
              + row["_rim_fin_per"]   * w[2])

    # MOBILITY: lateral quickness, shot-blocking, rebounding
    MOBILITY_W = {
        "Guard":   (0.55,  0.20,  0.25),  # steals dominate for guards
        "Wing":    (0.40,  0.30,  0.30),
        "Forward": (0.30,  0.375, 0.325),
        "Big":     (0.20,  0.45,  0.35),  # blocks + drb for bigs
    }
    def mobility(row):
        w = MOBILITY_W.get(row["pos_bucket"], MOBILITY_W["Wing"])
        return (row["_stl_per_per"] * w[0]
              + row["_blk_per_per"] * w[1]
              + row["_drb_per_per"] * w[2])

    # CONTACT: drawing fouls, offensive rebounding, winning 50/50s
    CONTACT_W = {
        "Guard":   (0.60,  0.40),
        "Wing":    (0.50,  0.50),
        "Forward": (0.45,  0.55),
        "Big":     (0.40,  0.60),
    }
    def contact(row):
        w = CONTACT_W.get(row["pos_bucket"], CONTACT_W["Wing"])
        return (row["_ftr_per"]     * w[0]
              + row["_orb_per_per"] * w[1])

    # ── Final ATH composite ───────────────────────────────────────────────────
    COMPONENT_W = {
        "Guard":   (0.30,  0.45,  0.25),  # mobility-heavy
        "Wing":    (0.35,  0.35,  0.30),
        "Forward": (0.375, 0.30,  0.325),
        "Big":     (0.40,  0.25,  0.35),  # explosion + contact
    }
    def ath_raw(row):
        w = COMPONENT_W.get(row["pos_bucket"], COMPONENT_W["Wing"])
        return (explosion(row) * w[0]
              + mobility(row)  * w[1]
              + contact(row)   * w[2])

    # Weight by minutes share so rate-stat flukes from small samples rank lower
    min_weight = (df["Min_per"] / 100).clip(0.15, 1.0)
    df["_ath_raw"] = df.apply(ath_raw, axis=1) * min_weight
    return percentrank_by_pos(df, "_ath_raw").apply(clamp)


def compute_ris(df, use_torvik=False):
    """
    RIS — Rebounding Impact Score
    Measures rebounding contribution and impact.
    Inputs to consider: ORB_per, DRB_per, porpag, stops
    """
    #     =IFERROR(
    #   IF( S4=0,
    #       "",
    #       ( R4 * (T4^0.5) )
    #       + 6*(AJ4/(AH4+1))
    #       + 1.2*BJ4
    #       + 0.9*BH4
    #       + 0.4*BI4
    #   ),
    # "")
    rim_pct = df["rimmade/(rimmade+rimmiss)"].fillna(0)
    rimmade = df["rimmade"].fillna(0) * rim_pct**0.5
    if use_torvik:
        freethrow = 6 * df["FT_per"] / 100
        orb = 1.2 * df["ORB_per"]
        blk = 0.9 * df["blk_per"]
        drb = 0.4 * df["DRB_per"]
    else:
        freethrow = 6 * (df["sb_tot_fta"] / (df["sb_tot_fga"] + 1))
        orb = 1.2 * df["sb_orb_40"]
        blk = 0.9 * df["sb_blk_40"]
        drb = 0.4 * df["sb_drb_40"]
    df["_ris_raw"] = rimmade + freethrow + orb + blk + drb
    return percentrank_by_pos(df, "_ris_raw").apply(clamp)




def compute_nil_valuation(df):
    """
    NIL Valuation matching the Weighted_Performance_Score sheet formula.

    Total Score = SUMPRODUCT of percentile-ranked stats × weights
    Base NIL    = MIN(cap, cap × W² × (1 - (1 - V⁴)(1 - W)²)^1.2)
    Final NIL   = Base NIL × Position Boost × Age Boost
    """
    # ── Stat weights — position-specific ─────────────────────────────────────
    GUARD_WEIGHTS = {
        "ppg":                   0.18,
        "mpg":                   0.05,
        "nil_def_score":         0.02,
        "nil_versatility_score": 0.02,
        "nil_motor_score":       0.03,
        "nil_iq_score":          0.06,
        "sei":                   0.22,
        "dds":                   0.05,
        "cdi":                   0.15,
        "ris":                   0.05,
        "ath":                   0.05,
        "3pt_score":             0.12,
    }
    WING_WEIGHTS = {
        "ppg":                   0.18,
        "mpg":                   0.05,
        "nil_def_score":         0.03,
        "nil_versatility_score": 0.04,
        "nil_motor_score":       0.06,
        "nil_iq_score":          0.05,
        "sei":                   0.20,
        "dds":                   0.10,
        "cdi":                   0.10,
        "ris":                   0.05,
        "ath":                   0.06,
        "3pt_score":             0.08,
    }
    BIG_WEIGHTS = {
        "ppg":                   0.15,
        "mpg":                   0.05,
        "nil_def_score":         0.04,
        "nil_versatility_score": 0.02,
        "nil_motor_score":       0.06,
        "nil_iq_score":          0.04,
        "sei":                   0.16,
        "dds":                   0.18,
        "cdi":                   0.06,
        "ris":                   0.14,
        "ath":                   0.08,
        "3pt_score":             0.02,
    }
    # Map each row to its weight dict; default Wing
    def w(key):
        """Return a per-row Series of weights for the given key."""
        return (
            (_pos == "Guard") * GUARD_WEIGHTS[key] +
            (_pos == "Wing")  * WING_WEIGHTS[key]  +
            (_pos == "Big")   * BIG_WEIGHTS[key]
        )

    # ── Percentile-rank each stat across full df (0–1 scale) ─────────────────
    def prank(series):
        return series.rank(pct=True, na_option="keep").fillna(0)

    # ── Position-specific stat bounds (clip before ranking) ──────────────────
    # Stat       Guard_Low  Guard_High  Wing_Low  Wing_High  Big_Low  Big_High
    # PPG         4.89       19.60       3.25      15.63      2.80     13.98
    # TS%         0.48        0.64       0.47       0.65      0.51      0.71
    # 3P%         0.25        0.44       0.21       0.43      0.00      0.71
    # 3PA/G       1.34        6.90       0.79       6.07      0.00      3.88
    # AST/G       0.92        5.28       0.30       2.55      0.27      2.07
    # TOV/G       0.73        3.11       0.35       2.49      0.44      2.06
    # AST/TOV     0.80        2.96       0.54       2.20      0.32      1.60
    # STL/40      0.80        2.79       0.49       2.11      0.48      1.89
    # BLK/40      0.00        0.84       0.04       1.57      0.36      3.70
    # DRB/40      2.09        5.91       2.58       7.46      4.07      8.92
    # ORB/40      0.31        2.46       0.69       3.18      1.69      5.45
    # MPG         0.80        2.79       0.49       2.11      0.48      0.71

    _pos = df["pos_bucket"]
    pts_clipped = df["pts"].copy()
    pts_clipped = pts_clipped.where(_pos != "Guard", pts_clipped.clip(4.89, 19.60))
    pts_clipped = pts_clipped.where(_pos != "Wing",  pts_clipped.clip(3.25, 15.63))
    pts_clipped = pts_clipped.where(_pos != "Big",   pts_clipped.clip(2.80, 13.98))

    stat_scores = (
        prank(pts_clipped)   * w("ppg") +  # pts per game (position-bounded)
        # prank(df["TS_per"])  * w("ts_pct")  +
        # prank(df["TP_per"])  * w("3p_pct")  +
        # prank(df["AST_per"]) * w("ast_pct") +
        # prank(df["ast/tov"]) * w("ast_tov") +
        # prank(df["stl_per"]) * w("stl_40")  +
        # prank(df["blk_per"]) * w("blk_40")  +
        # prank(df["DRB_per"]) * w("drb_40")  +
        # prank(df["ORB_per"]) * w("orb_40")  +
        prank(df["Min_per"]) * w("mpg")
    )

    # ── NIL Defensive metric  (position-specific, matches BtP sheet) ────────────
    # Components: DBPM, D-PRPG (dporpag), STL%, BLK%, DRB%, FC/40 (inverted)
    # All percentile-ranked across full population (0–1), then weighted by position.
    def pr(series):
        return series.fillna(0).rank(pct=True, na_option="bottom")
    def pr_inv(series):
        return 1 - series.fillna(series.max()).rank(pct=True, na_option="bottom")

    _dbpm  = pr(df["dbpm"])
    _dprpg = pr(df["dporpag"])
    _stl   = pr(df["stl_per"])
    _blk   = pr(df["blk_per"])
    _drb   = pr(df["DRB_per"])
    _fc    = pr_inv(df["pfr"])

    df["_nil_def_raw"] = (
        (_pos == "Guard") * (_dbpm*0.30 + _dprpg*0.20 + _stl*0.25 + _drb*0.10 + _fc*0.15) +
        (_pos == "Wing")  * (_dbpm*0.25 + _dprpg*0.25 + _stl*0.15 + _blk*0.10 + _drb*0.15 + _fc*0.10) +
        (_pos == "Big")   * (_dbpm*0.30 + _dprpg*0.20 + _blk*0.30 + _drb*0.15 + _fc*0.05)
    )
    # Re-rank within position groups (0–1) so Guards compete vs Guards, etc.
    nil_def_score = percentrank_by_pos(df, "_nil_def_raw", scale=1)

    # ── IQ/Playmaking metric  (position-specific, matches BtP sheet) ────────
    # Components: eFG%, ORtg, AST%, TO% (inverted), A/TO
    _efg   = pr(df["eFG"])
    _ortg  = pr(df["ORtg"])
    _ast   = pr(df["AST_per"])
    _to    = pr_inv(df["TO_per"])   # lower turnovers = better
    _ato   = pr(df["ast/tov"].fillna(0))

    df["_nil_iq_raw"] = (
        (_pos == "Guard") * (_efg*0.20 + _ortg*0.20 + _ast*0.25 + _to*0.20 + _ato*0.15) +
        (_pos == "Wing")  * (_efg*0.35 + _ortg*0.25 + _ast*0.15 + _to*0.15 + _ato*0.10) +
        (_pos == "Big")   * (_efg*0.40 + _ortg*0.30 + _ast*0.05 + _to*0.20 + _ato*0.05)
    )
    nil_iq_score = percentrank_by_pos(df, "_nil_iq_raw", scale=1)

    # ── Motor/Hustle metric (position-specific, matches BtP sheet) ─────────
    # Components: ORB/40, DRB/40, BLK/40, STL/40
    _orb40 = pr(df["ORB_per"])
    _drb40 = pr(df["DRB_per"])
    _blk40 = pr(df["blk_per"])
    _stl40 = pr(df["stl_per"])

    df["_nil_motor_raw"] = (
        (_pos == "Guard") * (_orb40*0.35 + _drb40*0.15 + _blk40*0.10 + _stl40*0.40) +
        (_pos == "Wing")  * (_orb40*0.25 + _drb40*0.25 + _blk40*0.25 + _stl40*0.25) +
        (_pos == "Big")   * (_orb40*0.25 + _drb40*0.30 + _blk40*0.35 + _stl40*0.10)
    )
    nil_motor_score = percentrank_by_pos(df, "_nil_motor_raw", scale=1)

    # ── Versatility Score (position-specific, matches BtP sheet) ─────────────────
    # --- Positional Size: pos-height percentile + overall height percentile ---
    # (frame excluded for now)
    # Guard: pos_h×0.75 + overall_h×0.25  (0.6 + 0.2 renorm without frame 0.2)
    # Wing:  pos_h×0.571 + overall_h×0.429 (0.4 + 0.3 renorm without frame 0.3)
    # Big:   pos_h×0.333 + overall_h×0.667 (0.2 + 0.4 renorm without frame 0.4)
    def height_to_inches(h):
        try:
            parts = str(h).split("-")
            return int(parts[0]) * 12 + int(parts[1])
        except Exception:
            return None
    if "sb_height" in df.columns:
        df["_height_in"] = df["sb_height"].apply(height_to_inches).astype(float)
        _h_pos = percentrank_by_pos(df, "_height_in", scale=1)
        _h_all = pr(df["_height_in"])
    else:
        _h_pos = pd.Series(0.5, index=df.index)
        _h_all = pd.Series(0.5, index=df.index)

    df["_nil_size_raw"] = (
        (_pos == "Guard") * (_h_pos*0.75  + _h_all*0.25) +
        (_pos == "Wing")  * (_h_pos*0.571 + _h_all*0.429) +
        (_pos == "Big")   * (_h_pos*0.333 + _h_all*0.667)
    )
    nil_size_score = percentrank_by_pos(df, "_nil_size_raw", scale=1)

    # --- Defensive Versatility: DBPM, D-PRPG, DRB%, STL%, BLK%, FC(inv) ---
    # Guard: DBPM×0.30 + DPRPG×0.15 + DRB×0.10 + STL×0.25 + BLK×0.05 + FC×0.15
    # Wing:  DBPM×0.25 + DPRPG×0.20 + DRB×0.15 + STL×0.15 + BLK×0.15 + FC×0.10
    # Big:   DBPM×0.25 + DPRPG×0.15 + DRB×0.20 + STL×0.15 + BLK×0.25 + FC×0.10
    df["_nil_defv_raw"] = (
        (_pos == "Guard") * (_dbpm*0.30 + _dprpg*0.15 + _drb*0.10 + _stl*0.25 + _blk*0.05 + _fc*0.15) +
        (_pos == "Wing")  * (_dbpm*0.25 + _dprpg*0.20 + _drb*0.15 + _stl*0.15 + _blk*0.15 + _fc*0.10) +
        (_pos == "Big")   * (_dbpm*0.25 + _dprpg*0.15 + _drb*0.20 + _stl*0.15 + _blk*0.25 + _fc*0.10)
    )
    nil_defv_score = percentrank_by_pos(df, "_nil_defv_raw", scale=1)

    # --- Lateral: same as mobility() in compute_ath ---
    # Guard: STL×0.55 + BLK×0.20 + DRB×0.25
    # Wing:  STL×0.40 + BLK×0.30 + DRB×0.30
    # Big:   STL×0.20 + BLK×0.45 + DRB×0.35
    # Uses already-computed per-position percentiles from compute_ath
    _s = df.get("_stl_per_per", pr(df["stl_per"]))
    _b = df.get("_blk_per_per", pr(df["blk_per"]))
    _d = df.get("_drb_per_per", pr(df["DRB_per"]))
    df["_nil_lateral_raw"] = (
        (_pos == "Guard") * (_s*0.55 + _b*0.20 + _d*0.25) +
        (_pos == "Wing")  * (_s*0.40 + _b*0.30 + _d*0.30) +
        (_pos == "Big")   * (_s*0.20 + _b*0.45 + _d*0.35)
    )
    nil_lateral_score = percentrank_by_pos(df, "_nil_lateral_raw", scale=1)

    # --- Versatility Score = Size×0.40 + DefVersatility×0.35 + Lateral×0.25 ---
    df["_nil_vers_raw"] = (
        nil_size_score  * 0.40 +
        nil_defv_score  * 0.35 +
        nil_lateral_score * 0.25
    )
    nil_versatility_score = percentrank_by_pos(df, "_nil_vers_raw", scale=1)

    # Scout scores — position-weighted
    scout_scores = (
        (df["_ath"].fillna(0) / 100) * w("ath") +
        nil_def_score                * w("nil_def_score") +
        nil_versatility_score        * w("nil_versatility_score") +
        nil_motor_score              * w("nil_motor_score") +
        nil_iq_score                 * w("nil_iq_score")
    )

    # ── 3PT Score (volume × efficiency, position-relative) ───────────────────
    # 3PA/G bounds: Guard [1.34, 6.90], Wing [0.79, 6.07], Big [0.00, 3.88]
    tpa_pg = (df["TPA"] / df["GP"].replace(0, float("nan"))).fillna(0)
    tpa_pg_clipped = tpa_pg.copy()
    tpa_pg_clipped = tpa_pg_clipped.where(_pos != "Guard", tpa_pg_clipped.clip(1.34, 6.90))
    tpa_pg_clipped = tpa_pg_clipped.where(_pos != "Wing",  tpa_pg_clipped.clip(0.79, 6.07))
    tpa_pg_clipped = tpa_pg_clipped.where(_pos != "Big",   tpa_pg_clipped.clip(0.00, 3.88))

    # 3P% bounds: Guard [0.25, 0.44], Wing [0.21, 0.43], Big [0.00, 0.71]
    tp_pct = df["TP_per"].fillna(0)  # TP_per is already a decimal (e.g. 0.381 = 38.1%)
    tp_pct_clipped = tp_pct.copy()
    tp_pct_clipped = tp_pct_clipped.where(_pos != "Guard", tp_pct_clipped.clip(0.25, 0.44))
    tp_pct_clipped = tp_pct_clipped.where(_pos != "Wing",  tp_pct_clipped.clip(0.21, 0.43))
    tp_pct_clipped = tp_pct_clipped.where(_pos != "Big",   tp_pct_clipped.clip(0.00, 0.71))

    df["_tpa_pg_clipped"]  = tpa_pg_clipped
    df["_tp_pct_clipped"]  = tp_pct_clipped
    _tpa_pct_pos  = percentrank_by_pos(df, "_tpa_pg_clipped", scale=1)  # volume pct by pos
    _tpct_pct_pos = percentrank_by_pos(df, "_tp_pct_clipped", scale=1)  # efficiency pct by pos
    df["_3pt_score_raw"] = _tpa_pct_pos * _tpct_pct_pos
    nil_3pt_score = percentrank_by_pos(df, "_3pt_score_raw", scale=1)

    # Beyond the Portal metrics — position-weighted
    btp_scores = (
        (df["_sei"].fillna(0) / 100) * w("sei") +
        (df["_dds"].fillna(0) / 100) * w("dds") +
        (df["_cdi"].fillna(0) / 100) * w("cdi") +
        (df["_ris"].fillna(0) / 100) * w("ris") +
        nil_3pt_score                * w("3pt_score")
    )

    total_score = (stat_scores + scout_scores + btp_scores).clip(0, 1)  # W

    # ── Conference adjustment (V) ─────────────────────────────────────────────
    CONF_WEIGHTS = {
        # High Major
        "ACC": 1.0, "B10": 1.0, "B12": 1.0, "SEC": 1.0, "BE": 1.0,
        # Mid Major
        "MWC": 0.8, "A10": 0.8, "WCC": 0.8, "Amer": 0.8, "P12": 0.8,
        # Low Major
        "MVC": 0.6, "SC": 0.6, "MAC": 0.6, "CUSA": 0.6,
        "SB": 0.6, "MAAC": 0.6, "CAA": 0.6, "ASun": 0.6,
        "Horz": 0.6, "BW": 0.6, "WAC": 0.6, "BSky": 0.6,
        "Slnd": 0.6, "OVC": 0.6, "Pat": 0.6, "NEC": 0.6,
        "AE": 0.6, "Ivy": 0.6, "BSth": 0.6, "Sum": 0.6,
        "MEAC": 0.6, "SWAC": 0.6,
    }
    conf_adj = df["conf"].map(CONF_WEIGHTS).fillna(0.6)  # V — default low major

    # ── NIL Cap + conference-adjusted ceiling ─────────────────────────────────
    # High Major (V=1.0) → $3M ceiling
    # Mid Major  (V=0.8) → $2.4M ceiling
    # Low Major  (V=0.6) → $1.8M ceiling
    nil_cap      = 3_000_000
    conf_ceiling = nil_cap * conf_adj  # per-player effective cap

    # ── Base NIL = MIN(conf_ceiling, conf_ceiling × W² × (1 - (1-V⁴)(1-W)²)^1.2) ──
    W = total_score
    V = conf_adj
    blend    = (1 - (1 - V**4) * (1 - W)**2) ** 1.5
    base_nil = (conf_ceiling * W**3 * blend).clip(upper=conf_ceiling)

    # ── Position Boost ────────────────────────────────────────────────────────
    # Explicit Forward entry (same 1.0 the .fillna below already gave it) —
    # written out so it's not relying on a silent fallback.
    pos_boost = df["pos_bucket"].map({"Big": 1.15, "Wing": 1.0, "Forward": 1.0, "Guard": 1.0}).fillna(1.0)

    # ── Age/Year Boost ────────────────────────────────────────────────────────
    yr_col = df["yr"]  # issue 3 fix: always use Torvik yr column (Fr, So, Jr, Sr, Gr)
    yr_boost = yr_col.map(
        {"So": 1, "Jr": .95, "Sr": 0.95, "Gr": 0.95, "Fr": 1.05}
    ).fillna(1.0)

# ── 3PT Specialist Boost ─────────────────────────────────────────────────
    # Players where 3PA/(2PA+3PA) >= 0.70 AND 3P% >= 37% are floor-spacers
    # with market value independent of low USG — apply a specialist multiplier.
    total_fga  = (df["twoPA"].fillna(0) + df["TPA"].fillna(0)).replace(0, float("nan"))
    three_ratio = df["TPA"].fillna(0) / total_fga
    is_specialist = (three_ratio >= 0.70) & (df["TP_per"].fillna(0) >= 0.37)
    # Scale boost from 1.0 at threshold to 1.20 at 100% 3PA ratio
    specialist_boost = (1 + 0.20 * ((three_ratio - 0.70) / 0.30).clip(0, 1)).where(is_specialist, 1.0)

    base_nil_final = (base_nil * pos_boost * yr_boost * specialist_boost).clip(lower=0, upper=conf_ceiling)

    # ── Minutes Volatility → Market Range ────────────────────────────────────
    # Min_per = % of team minutes played (0–100); higher = more certain starter
    min_rate = df["Min_per"].fillna(0) / 100
    min_volatility = min_rate.apply(lambda p:
        0.7  if p >= 0.60 else   # starter (60%+ of team minutes)
        0.8  if p >= 0.45 else   # rotation
        0.95 if p >= 0.30 else   # role player
        1.1  if p >= 0.20 else   # fringe
        1.3  if p >= 0.10 else   # spot minutes
        1.55                      # rarely played
    )
    nil_interval_pct = min_volatility / 4

    market_low  = (base_nil_final * (1 - nil_interval_pct)).clip(lower=0)
    market_high = base_nil_final * (1 + nil_interval_pct)

    # ── Projected Tier ────────────────────────────────────────────────────────
    def assign_tier(v):
        if v >= 2_200_000: return "HM All-American / Pre-Draft"
        if v >= 1_500_000: return "HM All-Conference"
        if v >= 1_000_000: return "HM Starter / MM All-Conference"
        if v >=   400_000: return "HM Rotation / MM Starter"
        if v >=   100_000: return "MM Role Player / LM All-Conference"
        return "LM Rotation"
        
    projected_tier = base_nil_final.apply(assign_tier)

    return base_nil_final, market_low, market_high, projected_tier, total_score



# ── MAIN ───────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    if args.repair_positions_from:
        # Repair mode needs to read current players rows even on --dry-run,
        # unlike the normal pipeline below (which only previews CSV-derived
        # computations without touching the DB on --dry-run).
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.")
        repair_positions_from_prior_role(
            create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY),
            args.repair_positions_from,
            args.dry_run,
        )
        return

    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.")
        db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # ── Load CSV ──────────────────────────────────────────────────────────────
    print(f"Reading {args.csv} …")
    df = pd.read_csv(args.csv)

    # ── Optional filters (applied AFTER metrics so percentiles use full population) ──
    # Store filter sets here; actual slicing happens in the write loop below.
    _team_filter   = set(args.teams)   if args.teams   else None
    _player_filter = set(args.players) if args.players else None

    # Deduplicate: keep latest season per player+team
    if "year" in df.columns:
        df = df.sort_values("year", ascending=False).drop_duplicates(
            subset=["player_name", "team"], keep="first"
        )

    print(f"  {len(df)} rows after dedup")

    # Split into qualified (Min_per >= 20%, per BTP Metrics Spec) and
    # low-minutes players. Metrics (CDI/DDS/SEI/ATH/RIS) are only computed on
    # qualified players so small-sample outliers don't skew percentile ranks —
    # this is also the pool percentrank_by_pos and position-average DRTG (DDS)
    # draw from. Low-minutes players still get their basic stats written
    # (ppg, rpg, fg_pct, etc.) but no metrics or NIL.
    if "Min_per" in df.columns:
        before = len(df)
        df_low = df[df["Min_per"] < 20].copy()
        df     = df[df["Min_per"] >= 20].reset_index(drop=True)
        print(f"  {len(df)} rows after filtering Min_per < 20% ({before - len(df)} set aside for stats-only write)")
    else:
        df_low = pd.DataFrame()

    # ── Merge Supabase player_stats into df ───────────────────────────────────
    # Gives access to ppg, apg, rpg, stl_40, blk_40, ast/40, etc. in formulas.
    _pid_to_positions = {}  # populated below; stays empty on --dry-run (no DB read)
    if not args.dry_run:
        _db_tmp = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY) if not args.dry_run else None
        print("Fetching player_stats from Supabase for merge …")
        _ps_rows, _page, _ps = [], 0, 1000
        while True:
            _res = _db_tmp.table("player_stats") \
                          .select("player_id, ppg, apg, rpg, stl_40, blk_40, "
                                  "drb_40, orb_40, trb_40, ast_40, ast_tov, usg, "
                                  "fg_pct, ft_pct, 3p_pct, "
                                  "tot_g, tot_gs, tot_mp, tot_fg, tot_fga, "
                                  "tot_3p, tot_3pa, tot_2p, tot_2pa, "
                                  "tot_ft, tot_fta, tot_orb, tot_drb, tot_trb, "
                                  "tot_ast, tot_stl, tot_blk, tot_tov, tot_pf, tot_pts, "
                                  "school, conference") \
                          .range(_page * _ps, (_page + 1) * _ps - 1).execute()
            _ps_rows.extend(_res.data or [])
            if len(_res.data or []) < _ps:
                break
            _page += 1

        # Also need player name+team to join (torvik_pid is used further down
        # to merge assisted_pct_rim/mid/three by pid rather than name/team)
        _pl_rows, _page = [], 0
        while True:
            _res = _db_tmp.table("players").select("id, name, current_team, height, weight, torvik_pid, positions") \
                          .range(_page * _ps, (_page + 1) * _ps - 1).execute()
            _pl_rows.extend(_res.data or [])
            if len(_res.data or []) < _ps:
                break
            _page += 1

        _pl_map = {p["id"]: p for p in _pl_rows}
        # torvik_pid -> already-known five-position eligibility set, for the
        # pos_bucket fallback below when this pass's role is blank.
        _pid_to_positions = {
            p["torvik_pid"]: p.get("positions")
            for p in _pl_rows
            if p.get("torvik_pid") is not None
        }
        _sb_stats = []
        for r in _ps_rows:
            pl = _pl_map.get(r["player_id"], {})
            if pl:
                # Always use players.current_team as the team key so _sb_df and
                # player_lookup both resolve to the same string — avoids mismatches
                # caused by player_stats.school diverging from players.current_team
                school = pl.get("current_team", "") or r.get("school", "")
                _sb_stats.append({
                    "_sb_name": norm_name(pl["name"]),
                    "_sb_team": normalise_team(school),
                    "sb_height": pl.get("height"),
                    "sb_weight": pl.get("weight"),
                    **{f"sb_{k}": v for k, v in r.items() if k != "player_id"}
                })

        if _sb_stats:
            _sb_df = pd.DataFrame(_sb_stats).drop_duplicates(subset=["_sb_name", "_sb_team"])
            df["_sb_name"] = df["player_name"].apply(norm_name)
            df["_sb_team"] = df["team"].apply(normalise_team)
            df = df.merge(_sb_df, on=["_sb_name", "_sb_team"], how="left")
            # Show teams from Supabase that don't appear in Torvik CSV after normalisation
            sb_teams  = set(_sb_df["_sb_team"].unique())
            csv_teams = set(df["_sb_team"].unique())
            unmatched_sb  = sb_teams - csv_teams
            unmatched_csv = csv_teams - sb_teams
            # if unmatched_sb:
            #     print(f"  ⚠  Supabase teams with NO Torvik match: {sorted(unmatched_sb)}")
            # if unmatched_csv:
            #     print(f"  ⚠  Torvik CSV teams with NO Supabase match: {sorted(unmatched_csv)}")
            df = df.drop(columns=["_sb_name", "_sb_team"])
            print(f"  Merged {_sb_df.shape[0]} player_stats rows into df")
        else:
            print("  No player_stats rows fetched — skipping merge")
    # In dry-run mode, sb_* columns won't exist; formulas should guard with .get or fillna
    # print([c for c in df.columns if c.startswith("sb_")])

    # print(df.columns.tolist())

    # ── Merge assisted_pct_rim/mid/three (written by import_pbp_shot_assists.py) ──
    # Keyed directly on df["pid"], which IS players.torvik_pid (confirmed by
    # cross-referencing trank_data_2026.csv's pid column against the live DB) —
    # no name/team normalisation needed, unlike the sb_* merge above. Scoped to
    # this run's --year since player_stats can hold multiple seasons per player
    # and assisted share is season-specific. Missing entirely (import hasn't
    # run yet, or dry-run) is fine — compute_shot_difficulty treats a missing
    # column as "no data", same as the spec's "missing counts as 0" rule.
    if not args.dry_run:
        print("Fetching assisted_pct_rim/mid/three for this season …")
        try:
            _assist_rows = []
            _page = 0
            while True:
                _res = db.table("player_stats") \
                          .select("player_id, assisted_pct_rim, assisted_pct_mid, assisted_pct_three") \
                          .eq("calendar_year", args.year) \
                          .range(_page * 1000, (_page + 1) * 1000 - 1).execute()
                _assist_rows.extend(_res.data or [])
                if len(_res.data or []) < 1000:
                    break
                _page += 1

            if _assist_rows:
                _pl_torvik = {p["id"]: p.get("torvik_pid") for p in _pl_rows}
                _assist_df = pd.DataFrame([
                    {"pid": _pl_torvik.get(r["player_id"]),
                     "assisted_pct_rim": r.get("assisted_pct_rim"),
                     "assisted_pct_mid": r.get("assisted_pct_mid"),
                     "assisted_pct_three": r.get("assisted_pct_three")}
                    for r in _assist_rows if _pl_torvik.get(r["player_id"]) is not None
                ]).drop_duplicates(subset=["pid"])
                df = df.merge(_assist_df, on="pid", how="left")
                _n_with_data = df[["assisted_pct_rim", "assisted_pct_mid", "assisted_pct_three"]].notna().any(axis=1).sum()
                print(f"  {_n_with_data}/{len(df)} qualified players have at least one assisted-share bucket")
            else:
                print("  No assisted_pct_* rows found for this season — run import_pbp_shot_assists.py first if you want Shot Difficulty/Adjusted SEI/Shot Creation populated")
        except Exception as e:
            # Most likely cause: the assisted_pct_* columns don't exist yet —
            # see the ALTER TABLE statements in this file's own docstring
            # Prerequisites block, meant to be run once in the Supabase SQL
            # Editor. This is an optional enrichment on top of everything
            # else this script does, so a failure here (missing columns, a
            # transient network hiccup, whatever) degrades to "no
            # assisted-share data" rather than losing the whole run — Shot
            # Difficulty/Adjusted SEI/Shot Creation just come out null this
            # time, same as if import_pbp_shot_assists.py hadn't run yet.
            print(f"  ⚠ Could not fetch assisted_pct_* ({e}) — continuing without it. "
                  f"If this is a missing-column error, run the assisted_pct_*/shot_difficulty/"
                  f"adjusted_sei/sei_diff/shot_creation ALTER TABLE statements from this file's "
                  f"Prerequisites block in the Supabase SQL Editor, then re-run.")

    # ── Position buckets + pre-compute metrics over full df ───────────────────
    df = df.reset_index(drop=True)

    def _pos_bucket_for_row(row):
        role_raw = row.get("role", "") if "role" in df.columns else ""
        role_str = str(role_raw).strip().lower()
        if role_str and role_str != "nan":
            return normalise_pos(role_raw)
        # Blank/NaN role this pass -- fall back to the player's already-
        # known five-position eligibility set (players.positions, from a
        # prior real-role run) rather than defaulting straight to "Wing".
        # Every percentile-based metric (sei/ath/ris/dds/cdi) and NIL are
        # computed WITHIN this bucket, so dumping every player into one
        # bucket here -- comparing guards against centers -- would corrupt
        # every rating on the board, not just mislabel a display column.
        pid = row.get("pid")
        positions = _pid_to_positions.get(int(pid)) if pd.notna(pid) else None
        return _bucket_from_positions(positions) or "Wing"

    df["pos_bucket"] = df.apply(_pos_bucket_for_row, axis=1)

    # Physical percentiles (position-relative) — used inside compute_ath
    if "sb_height" in df.columns:
        df["_height_pct"] = percentrank_by_pos(df, "sb_height")
    if "sb_weight" in df.columns:
        df["_weight_pct"] = percentrank_by_pos(df, "sb_weight")

    use_torvik = args.use_torvik_data
    df["_cdi"] = compute_cdi(df)
    df["_dds"] = compute_dds(df, use_torvik=use_torvik)
    df["_sei"] = compute_sei(df, use_torvik=use_torvik)
    # Shot Difficulty / Adjusted SEI — must run after compute_sei (reads its
    # _sei_raw/_sei side-effect columns). See each function's docstring.
    df["_shot_difficulty"], _shot_difficulty_modifier = compute_shot_difficulty(df)
    df["_adjusted_sei"], df["_sei_diff"] = compute_adjusted_sei(df)
    df["_shot_creation"] = compute_shot_creation(df)
    df["_ath"] = compute_ath(df, use_torvik=use_torvik)
    df["_ris"] = compute_ris(df, use_torvik=use_torvik)
    df["_nil"], df["_nil_low"], df["_nil_high"], df["_projected_tier"], df["_nil_perf_score"] = compute_nil_valuation(df)

    # ── Specialist tags ───────────────────────────────────────────────────────
    _total_fga   = (df["twoPA"].fillna(0) + df["TPA"].fillna(0)).replace(0, float("nan"))
    _three_ratio = df["TPA"].fillna(0) / _total_fga
    df["_specialist_3pt"] = (_three_ratio >= 0.70) & (df["TP_per"].fillna(0) >= 0.37)

    # ── Load players + stats from Supabase ────────────────────────────────────
    if not args.dry_run:
        print("Fetching players from Supabase …")
        players = []
        page, page_size = 0, 1000
        while True:
            res = db.table("players").select("id, name, current_team, height, nil_valuation, torvik_pid") \
                    .range(page * page_size, (page + 1) * page_size - 1).execute()
            players.extend(res.data)
            if len(res.data) < page_size:
                break
            page += 1

        print(f"  {len(players)} players in Supabase")

        # Build lookup: (norm_name, norm_team) → player_id  (via match_utils)
        player_lookup = build_lookup(players)
        # Build PID lookup: torvik_pid (int) → player_id
        pid_lookup = {
            p["torvik_pid"]: p["id"]
            for p in players
            if p.get("torvik_pid") is not None
        }
        # Track existing heights so we only backfill blanks
        player_height_lookup = {
            p["id"]: p.get("height")
            for p in players
        }
        # Track existing NIL for change detection
        player_nil_lookup = {
            p["id"]: p.get("nil_valuation")
            for p in players
        }

        # Build stats lookup: (player_id, calendar_year) → stats row id (paginated)
        _sr_rows, _page = [], 0
        while True:
            _sr = db.table("player_stats").select("id, player_id, calendar_year, cdi") \
                    .range(_page * 1000, (_page + 1) * 1000 - 1).execute()
            _sr_rows.extend(_sr.data or [])
            if len(_sr.data or []) < 1000:
                break
            _page += 1
        stats_lookup = {
            (r["player_id"], r["calendar_year"]): r["id"]
            for r in _sr_rows
        }
        already_matched = {
            r["player_id"]
            for r in _sr_rows
            if r.get("cdi") is not None
        }
    else:
        player_lookup          = {}
        player_height_lookup   = {}
        player_nil_lookup      = {}
        stats_lookup           = {}
        already_matched        = set()

    # ── Process each row ──────────────────────────────────────────────────────
    matched        = 0
    unmatched      = 0
    unmatched_rows = []
    nil_changes    = []

    for _, row in df.iterrows():
        name = str(row.get("player_name", "")).strip()
        team = str(row.get("team", "")).strip()
        yr   = str(row.get("yr", "")).strip()

        # Apply team/player filters here so percentiles use full population
        if _team_filter and team not in _team_filter:
            continue
        if _player_filter and name not in _player_filter:
            continue

        # ── Compute display stats from Torvik columns ─────────────────────────
        # pts, treb, ast are already per-game averages in the Torvik CSV
        _gp      = int(safe(row.get("GP"), 0) or 0)
        _twoPM   = safe(row.get("twoPM"))
        _twoPA   = safe(row.get("twoPA"))
        _tpm     = safe(row.get("TPM"))
        _tpa     = safe(row.get("TPA"))

        _fgm  = (_twoPM or 0) + (_tpm or 0)
        _fga  = (_twoPA or 0) + (_tpa or 0)
        _fg_pct  = round((_fgm / _fga) * 100, 1) if _fga else None
        _3p_pct  = round((safe(row.get("TP_per")) or 0) * 100, 1) if safe(row.get("TP_per")) is not None else None
        _ft_pct  = round((safe(row.get("FT_per")) or 0) * 100, 1) if safe(row.get("FT_per")) is not None else None

        torvik = {
            "torvik_ortg":    safe(row.get("ORtg")),
            "torvik_usg":     safe(row.get("usg")),
            "torvik_efg":     safe(row.get("eFG")),
            "torvik_ts":      safe(row.get("TS_per")),
            "torvik_obpm":    safe(row.get("obpm")),
            "torvik_dbpm":    safe(row.get("dbpm")),
            "torvik_bpm":     safe(row.get("bpm")),
            "torvik_drtg":    safe(row.get("drtg")),
            "torvik_stops":   safe(row.get("stops")),
            "torvik_ast_pct": safe(row.get("AST_per")),
            "torvik_to_pct":  safe(row.get("TO_per")),
            "torvik_orb_pct": safe(row.get("ORB_per")),
            "torvik_drb_pct": safe(row.get("DRB_per")),
            "torvik_rim_pct": safe(row.get("rimmade/(rimmade+rimmiss)")),
            "torvik_mid_pct": safe(row.get("midmade/(midmade+midmiss)")),
            "torvik_3p_pct":  safe(row.get("TP_per")),
            "torvik_porpag":  safe(row.get("porpag")),
            "torvik_adjoe":   safe(row.get("adjoe")),
            "torvik_min_pct": safe(row.get("Min_per")),
            "torvik_gp":      _gp,
            "torvik_blk_pct": safe(row.get("blk_per")),
            "torvik_stl_pct": safe(row.get("stl_per")),
            "torvik_ftr":     safe(row.get("ftr")),
            "torvik_pfr":     safe(row.get("pfr")),
            "torvik_adrtg":   safe(row.get("adrtg")),
            "torvik_dporpag": safe(row.get("dporpag")),
            "torvik_ogbpm":   safe(row.get("ogbpm")),
            "torvik_dgbpm":   safe(row.get("dgbpm")),
            "torvik_gbpm":    safe(row.get("gbpm")),
            "torvik_rec_rank":safe(row.get("Rec_Rank")),
            # ── Per-game stats (already per-game in Torvik CSV) ───────────────
            "ppg":    round(safe(row.get("pts")),  1) if safe(row.get("pts"))  is not None else None,
            "rpg":    round(safe(row.get("treb")), 1) if safe(row.get("treb")) is not None else None,
            "apg":    round(safe(row.get("ast")),  1) if safe(row.get("ast"))  is not None else None,
            "fg_pct": _fg_pct,
            "3p_pct": _3p_pct,
            "ft_pct": _ft_pct,
            "usg":     safe(row.get("usg")),
            "ast_tov": safe(row.get("ast/tov")),
        }

        # ── Pull pre-computed metrics ─────────────────────────────────────────
        idx = row.name  # DataFrame index after reset_index
        cdi      = safe(df.at[idx, "_cdi"])
        dds      = safe(df.at[idx, "_dds"])
        sei      = safe(df.at[idx, "_sei"])
        ath      = safe(df.at[idx, "_ath"])
        ris      = safe(df.at[idx, "_ris"])
        shot_difficulty          = safe(df.at[idx, "_shot_difficulty"])          if "_shot_difficulty"          in df.columns else None
        shot_difficulty_modifier = safe(df.at[idx, "_shot_difficulty_modifier"]) if "_shot_difficulty_modifier" in df.columns else None
        adjusted_sei             = safe(df.at[idx, "_adjusted_sei"])             if "_adjusted_sei"             in df.columns else None
        sei_diff                 = safe(df.at[idx, "_sei_diff"])                 if "_sei_diff"                 in df.columns else None
        shot_creation            = safe(df.at[idx, "_shot_creation"])            if "_shot_creation"            in df.columns else None
        nil           = safe(df.at[idx, "_nil"])
        nil_low       = safe(df.at[idx, "_nil_low"])
        nil_high      = safe(df.at[idx, "_nil_high"])
        tier          = str(df.at[idx, "_projected_tier"]) if "_projected_tier" in df.columns else None
        nil_perf_score = safe(df.at[idx, "_nil_perf_score"]) if "_nil_perf_score" in df.columns else None
        # is_3pt_specialist = bool(df.at[idx, "_specialist_3pt"]) if "_specialist_3pt" in df.columns else False

        # ── Parse birth year ──────────────────────────────────────────────────
        birth_year = None
        dob = str(row.get("dob", "")).strip()
        if dob and dob not in ("nan", ""):
            try:
                birth_year = int(dob[:4])
            except (ValueError, IndexError):
                pass

        if args.dry_run:
            print(f"  {name} ({team}) | cdi={cdi} dds={dds} sei={sei} ath={ath} ris={ris} | "
                  f"shot_difficulty={shot_difficulty} adjusted_sei={adjusted_sei} sei_diff={sei_diff} shot_creation={shot_creation} | "
                  f"NIL={nil} | born={birth_year}")
            matched += 1
            continue

        # ── Match to Supabase ─────────────────────────────────────────────────
        # Prefer torvik_pid (exact) over name+team (fuzzy via match_utils)
        torvik_pid_val = int(row["pid"]) if str(row.get("pid", "")).strip().isdigit() else None
        player_id = pid_lookup.get(torvik_pid_val) if torvik_pid_val else None
        if not player_id:
            _mr = mu_match(name, team, player_lookup)
            player_id = _mr.player_id

        if not player_id:
            unmatched += 1
            match_method = "pid" if torvik_pid_val else "name+team"
            print(f"  ✗ NO MATCH ({match_method}): {name} ({team})")
            unmatched_rows.append({"name": name, "team": team, "yr": yr})
            continue

        if args.skip_matched and player_id in already_matched:
            continue

        # ── Update players table (skip in historical mode) ────────────────────
        if not args.historical:
            # Matching this row in the current season's Torvik CSV confirms
            # the player belongs on the live board — flip it back on
            # regardless of whether anything else below changed. See
            # archive_season.py / CLAUDE.md's season rollover section.
            player_patch = {"on_board": True}
            if torvik_pid_val is not None:
                player_patch["torvik_pid"] = torvik_pid_val
            # Matching by torvik_pid is team-independent, so a transferred
            # player still matches their existing row even though their team
            # changed -- but nothing used to write the new team back, so
            # current_team stayed stuck at the player's OLD school forever.
            # display_school() is the same mapping already used for
            # player_stats.school, so players.current_team and
            # player_stats.school agree on the same display spelling.
            new_team = display_school(team)
            if new_team and new_team not in ("nan", ""):
                player_patch["current_team"] = new_team
            if birth_year:
                player_patch["birth_year"] = birth_year
            if nil is not None and not args.skip_nil:
                player_patch["nil_valuation"] = nil
            if nil_low is not None and not args.skip_nil:
                player_patch["open_market_low"] = nil_low
            if nil_high is not None and not args.skip_nil:
                player_patch["open_market_high"] = nil_high
            hometown = str(row.get("type", "")).strip()
            if hometown and hometown not in ("nan", ""):
                player_patch["hometown"] = hometown
            # Five-position eligibility set. A blank/NaN role (e.g. a
            # precursor CSV seeded from last season's stats, before this
            # season's role has been computed) must leave positions/
            # primary_position OUT of the patch entirely so the existing DB
            # value survives untouched — NOT fall back to a generic guess,
            # which would overwrite every player with the same bucket
            # regardless of what they actually play. normalise_pos's "Wing"
            # default (-> ["SF"]) is for a one-time blank-row display
            # purpose only, never for persisting to positions/primary_position.
            role_raw = row.get("role", "")
            role_str = str(role_raw).strip().lower()
            if role_str and role_str != "nan":
                positions = torvik_role_to_positions(role_raw)
                if not positions:
                    positions = list(_BUCKET_TO_POSITIONS.get(normalise_pos(role_raw), []))
                if positions:
                    player_patch["positions"] = positions
                    player_patch["primary_position"] = positions[0]
            YR_MAP = {"Fr": "Freshman", "So": "Sophomore", "Jr": "Junior", "Sr": "Senior", "Gr": "Graduate"}
            yr_raw = str(row.get("yr", "")).strip()
            yr_mapped = YR_MAP.get(yr_raw)
            if yr_mapped:
                player_patch["year"] = yr_mapped
            ht = str(row.get("ht", "")).strip()
            if ht and ht not in ("nan", "") and not player_height_lookup.get(player_id):
                player_patch["height"] = ht
            # player_patch["specialist_tags"] = "3pt_specialist" if is_3pt_specialist else None
            if player_patch:
                db.table("players").update(player_patch).eq("id", player_id).execute()
                if nil is not None:
                    old_nil = player_nil_lookup.get(player_id)
                    changed = old_nil is None or abs(nil - old_nil) > 1
                    if changed:
                        direction = "new" if old_nil is None else ("up" if nil > old_nil else "down")
                        nil_changes.append({
                            "name":     name,
                            "team":     team,
                            "position": row.get("pos_bucket", ""),
                            "old_nil":  round(old_nil) if old_nil else "",
                            "new_nil":  round(nil),
                            "change":   round(nil - old_nil) if old_nil else "",
                            "direction": direction,
                        })

        # ── Upsert player_stats row keyed on (player_id, calendar_year) ───────
        YR_MAP = {"Fr": "Freshman", "So": "Sophomore", "Jr": "Junior", "Sr": "Senior", "Gr": "Graduate"}
        # calendar_year belongs in the patch itself, not just the insert-only
        # literal below — otherwise a row matched via the update branch never
        # gets calendar_year set/corrected, and the frontend's Season column
        # (which queries/sorts by calendar_year) shows blank for it.
        stats_patch = {**torvik, "name": name, "school": display_school(team), "year": YR_MAP.get(yr, yr), "calendar_year": args.year}
        for key_m, val in [
            ("cdi", cdi), ("dds", dds), ("sei", sei), ("ath", ath), ("ris", ris),
            ("shot_difficulty", shot_difficulty), ("shot_difficulty_modifier", shot_difficulty_modifier),
            ("adjusted_sei", adjusted_sei), ("sei_diff", sei_diff), ("shot_creation", shot_creation),
        ]:
            if val is not None:
                stats_patch[key_m] = val
        if tier and not args.skip_nil:
            stats_patch["projected_tier"] = tier
        if nil_perf_score is not None and not args.skip_nil:
            stats_patch["nil_perf_score"] = round(float(nil_perf_score), 6)

        stats_id = stats_lookup.get((player_id, args.year))
        if stats_id:
            db.table("player_stats").update(stats_patch).eq("id", stats_id).execute()
        else:
            db.table("player_stats").insert({
                **stats_patch,
                "player_id":    player_id,
            }).execute()

        matched += 1
        print(f"  ✓ {name} ({team})")

    print(f"\nDone. Matched: {matched} | Unmatched: {unmatched}")
    import csv
    if unmatched_rows:
        out_path = "unmatched_players.csv"
        with open(out_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["name", "team", "yr"])
            writer.writeheader()
            writer.writerows(unmatched_rows)
        print(f"  → Unmatched players written to {out_path}")
    if nil_changes:
        nil_changes.sort(key=lambda x: abs(x["change"] or 0), reverse=True)
        out_path = "nil_changes.csv"
        with open(out_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["name", "team", "position", "old_nil", "new_nil", "change", "direction"])
            writer.writeheader()
            writer.writerows(nil_changes)
        print(f"  → NIL changes written to {out_path} ({len(nil_changes)} players updated)")

    # ── Write basic stats for low-minutes players (no metrics, no NIL) ───────
    if not df_low.empty and not args.dry_run:
        written = 0
        for _, row in df_low.iterrows():
            name = str(row.get("player_name", "")).strip()
            team = str(row.get("team", "")).strip()
            torvik_pid_val = int(row["pid"]) if str(row.get("pid", "")).strip().isdigit() else None
            player_id = pid_lookup.get(torvik_pid_val) if torvik_pid_val else None
            if not player_id:
                _mr = mu_match(name, team, player_lookup)
                player_id = _mr.player_id
            if not player_id:
                continue

            _gp    = int(safe(row.get("GP"), 0) or 0)
            _twoPM = safe(row.get("twoPM")); _twoPA = safe(row.get("twoPA"))
            _tpm   = safe(row.get("TPM"));   _tpa   = safe(row.get("TPA"))
            _fgm   = (_twoPM or 0) + (_tpm or 0)
            _fga   = (_twoPA or 0) + (_tpa or 0)

            stats_patch = {
                "torvik_ortg":    safe(row.get("ORtg")),
                "torvik_usg":     safe(row.get("usg")),
                "torvik_efg":     safe(row.get("eFG")),
                "torvik_ts":      safe(row.get("TS_per")),
                "torvik_obpm":    safe(row.get("obpm")),
                "torvik_dbpm":    safe(row.get("dbpm")),
                "torvik_bpm":     safe(row.get("bpm")),
                "torvik_drtg":    safe(row.get("drtg")),
                "torvik_stops":   safe(row.get("stops")),
                "torvik_ast_pct": safe(row.get("AST_per")),
                "torvik_to_pct":  safe(row.get("TO_per")),
                "torvik_orb_pct": safe(row.get("ORB_per")),
                "torvik_drb_pct": safe(row.get("DRB_per")),
                "torvik_rim_pct": safe(row.get("rimmade/(rimmade+rimmiss)")),
                "torvik_mid_pct": safe(row.get("midmade/(midmade+midmiss)")),
                "torvik_3p_pct":  safe(row.get("TP_per")),
                "torvik_porpag":  safe(row.get("porpag")),
                "torvik_adjoe":   safe(row.get("adjoe")),
                "torvik_min_pct": safe(row.get("Min_per")),
                "torvik_gp":      _gp,
                "torvik_blk_pct": safe(row.get("blk_per")),
                "torvik_stl_pct": safe(row.get("stl_per")),
                "torvik_ftr":     safe(row.get("ftr")),
                "torvik_pfr":     safe(row.get("pfr")),
                "torvik_adrtg":   safe(row.get("adrtg")),
                "torvik_dporpag": safe(row.get("dporpag")),
                "torvik_ogbpm":   safe(row.get("ogbpm")),
                "torvik_dgbpm":   safe(row.get("dgbpm")),
                "torvik_gbpm":    safe(row.get("gbpm")),
                "torvik_rec_rank":safe(row.get("Rec_Rank")),
                "ppg":    round(safe(row.get("pts")),  1) if safe(row.get("pts"))  is not None else None,
                "rpg":    round(safe(row.get("treb")), 1) if safe(row.get("treb")) is not None else None,
                "apg":    round(safe(row.get("ast")),  1) if safe(row.get("ast"))  is not None else None,
                "fg_pct": round((_fgm / _fga) * 100, 1) if _fga else None,
                "3p_pct": round((safe(row.get("TP_per")) or 0) * 100, 1) if safe(row.get("TP_per")) is not None else None,
                "ft_pct": round((safe(row.get("FT_per")) or 0) * 100, 1) if safe(row.get("FT_per")) is not None else None,
                "usg":     safe(row.get("usg")),
                "ast_tov": safe(row.get("ast/tov")),
                "cdi": None, "dds": None, "sei": None, "ath": None, "ris": None,
                "shot_difficulty": None, "shot_difficulty_modifier": None,
                "adjusted_sei": None, "sei_diff": None, "shot_creation": None,
                "name":   name,
                "school": display_school(team),
                "year":   {"Fr": "Freshman", "So": "Sophomore", "Jr": "Junior", "Sr": "Senior", "Gr": "Graduate"}.get(str(row.get("yr", "")).strip(), str(row.get("yr", "")).strip()),
                "calendar_year": args.year,
            }

            stats_id = stats_lookup.get((player_id, args.year))
            if stats_id:
                db.table("player_stats").update(stats_patch).eq("id", stats_id).execute()
            else:
                db.table("player_stats").insert({
                    **stats_patch,
                    "player_id":     player_id,
                }).execute()
            written += 1
        print(f"  Wrote basic stats for {written} low-minutes players (no metrics/NIL)")

    if args.dry_run:
        print("(dry-run — nothing written)")


if __name__ == "__main__":
    main()
