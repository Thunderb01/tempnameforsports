"""
torvik_metrics.py — Load Torvik CSV → compute BtPM metrics + NIL valuation → write to Supabase
================================================================================================
Reads trank_data.csv, matches players to Supabase by (name, team), writes:
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
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS cdi float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS dds float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS sei float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS ath float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS ris float;
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS projected_tier text;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS nil_valuation float;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS birth_year int;

Environment variables:
    $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
    $env:SUPABASE_SERVICE_KEY="your-service-role-key"
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


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--csv",     default="data/trank_data.csv")
    p.add_argument("--dry-run",        action="store_true")
    p.add_argument("--skip-matched",   action="store_true",
                   help="Skip players that already have cdi written in player_stats")
    p.add_argument("--use-torvik-data", action="store_true",
                   help="Use Torvik CSV columns for all metrics instead of scraped Supabase totals")
    p.add_argument("--skip-nil",        action="store_true",
                   help="Do not overwrite nil_valuation on the players table")
    p.add_argument("--teams", nargs="+", metavar="TEAM",
                   help="Only process players from these teams (exact Torvik team name)")
    p.add_argument("--players", nargs="+", metavar="PLAYER",
                   help="Only process these players by name (exact Torvik player_name)")
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


# ── POSITION NORMALISATION ─────────────────────────────────────────────────────
# Torvik's 'role' column values (e.g. "Wing F", "Combo G", "Big") are mapped
# to three position buckets so percentile ranks are position-relative.

def normalise_pos(role):
    role = str(role).strip().lower()
    if any(x in role for x in ["guard", "combo g", "pure pg", "scoring pg"]):
        return "Guard"
    if any(x in role for x in ["wing", "small f", "sf"]):
        return "Wing"
    if any(x in role for x in ["big", "pf", "center", "power"]) or role in ("c",) or role.startswith("c ") or role.endswith(" c"):
        return "Big"
    return "Wing"  # default


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
    pos_mult = df["pos_bucket"].map({"Guard": 1.15, "Wing": 1.08, "Big": 1.0})

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
    DDS — Defensive Disruption Score
    Measures defensive impact and disruption ability.
    """
    pfr = df["pfr"].fillna(0)
    if use_torvik:
        stl = df["stl_per"].fillna(0)
        blk = df["blk_per"].fillna(0)
        drb = df["DRB_per"].fillna(0)
        df["_dds_raw"] = (stl + 0.75 * blk + 0.5 * drb - 0.5 * pfr).clip(lower=0)
    else:
        stl = df["sb_stl_40"].fillna(0)
        blk = df["sb_blk_40"].fillna(0)
        drb = df["sb_drb_40"].fillna(0)
        df["_dds_raw"] = (stl + 0.75 * blk + 0.5 * drb - 0.5 * pfr).clip(lower=0)

    return percentrank_by_pos(df, "_dds_raw").apply(clamp)


def compute_sei(df, use_torvik=False):
    """
    SEI — Scoring Efficiency Index
    Measures how efficiently a player scores relative to usage.
    """
    ts = df["TS_per"].fillna(0)
    if use_torvik:
        usg = df["usg"].fillna(0)
        df["_sei_raw"] = ts * (usg ** 0.5)
    else:
        fga = df["sb_tot_fga"].fillna(0)
        mp  = df["sb_tot_mp"].replace(0, float("nan")).fillna(0)
        fga_40 = (fga / mp.replace(0, float("nan"))) * 40
        df["_sei_raw"] = ts * fga_40.fillna(0) ** 0.5

    return percentrank_by_pos(df, "_sei_raw").apply(clamp)


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
    # EXPLOSION: finishing through/above defenders
    EXPLOSION_W = {
        "Guard": (0.30, 0.20, 0.50),  # rim finish matters most for guards
        "Wing":  (0.35, 0.30, 0.35),
        "Big":   (0.40, 0.35, 0.25),  # dunks + rim finish dominate for bigs
    }
    def explosion(row):
        w = EXPLOSION_W.get(row["pos_bucket"], EXPLOSION_W["Wing"])
        return (row["_dunk_vol_per"] * w[0]
              + row["_dunk_rate_per"] * w[1]
              + row["_rim_fin_per"]   * w[2])

    # MOBILITY: lateral quickness, shot-blocking, rebounding
    MOBILITY_W = {
        "Guard": (0.55, 0.20, 0.25),  # steals dominate for guards
        "Wing":  (0.40, 0.30, 0.30),
        "Big":   (0.20, 0.45, 0.35),  # blocks + drb for bigs
    }
    def mobility(row):
        w = MOBILITY_W.get(row["pos_bucket"], MOBILITY_W["Wing"])
        return (row["_stl_per_per"] * w[0]
              + row["_blk_per_per"] * w[1]
              + row["_drb_per_per"] * w[2])

    # CONTACT: drawing fouls, offensive rebounding, winning 50/50s
    CONTACT_W = {
        "Guard": (0.60, 0.40),
        "Wing":  (0.50, 0.50),
        "Big":   (0.40, 0.60),
    }
    def contact(row):
        w = CONTACT_W.get(row["pos_bucket"], CONTACT_W["Wing"])
        return (row["_ftr_per"]     * w[0]
              + row["_orb_per_per"] * w[1])

    # ── Final ATH composite ───────────────────────────────────────────────────
    COMPONENT_W = {
        "Guard": (0.30, 0.45, 0.25),  # mobility-heavy
        "Wing":  (0.35, 0.35, 0.30),
        "Big":   (0.40, 0.25, 0.35),  # explosion + contact
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
        "MWC": 0.8, "A10": 0.8, "WCC": 0.8, "Amer": 0.8,
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
    pos_boost = df["pos_bucket"].map({"Big": 1.15, "Wing": 1.0, "Guard": 1.0}).fillna(1.0)

    # ── Age/Year Boost ────────────────────────────────────────────────────────
    yr_col = df["yr"]  # issue 3 fix: always use Torvik yr column (Fr, So, Jr, Sr, Gr)
    yr_boost = yr_col.map(
        {"So": 1, "Jr": .95, "Sr": 0.95, "Gr": 0.95, "Fr": 1.05}
    ).fillna(1.0)

    base_nil_final = (base_nil * pos_boost * yr_boost).clip(lower=0, upper=conf_ceiling)

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
        if v >= 2_200_000: return "P4 All-American / Pre-Draft"
        if v >= 1_500_000: return "P4 All-Conference"
        if v >= 1_000_000: return "P4 Starter / MM All-Conference"
        if v >=   400_000: return "P4 Rotation / MM Starter"
        if v >=   250_000: return "MM Role Player / LM All-Conference"
        return "LM Rotation"
        
    projected_tier = base_nil_final.apply(assign_tier)

    return base_nil_final, market_low, market_high, projected_tier



# ── MAIN ───────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

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

    # Filter out players with too little playing time to produce meaningful metrics
    low_minutes_keys = set()
    if "Min_per" in df.columns:
        before = len(df)
        low = df[df["Min_per"] < 10]
        low_minutes_keys = {
            (normalise(row["player_name"]), normalise_team(str(row["team"])))
            for _, row in low.iterrows()
        }
        df = df[df["Min_per"] >= 10].reset_index(drop=True)
        print(f"  {len(df)} rows after filtering Min_per < 10% ({before - len(df)} removed)")

    # ── Merge Supabase player_stats into df ───────────────────────────────────
    # Gives access to ppg, apg, rpg, stl_40, blk_40, ast/40, etc. in formulas.
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

        # Also need player name+team to join
        _pl_rows, _page = [], 0
        while True:
            _res = _db_tmp.table("players").select("id, name, current_team, height, weight") \
                          .range(_page * _ps, (_page + 1) * _ps - 1).execute()
            _pl_rows.extend(_res.data or [])
            if len(_res.data or []) < _ps:
                break
            _page += 1

        _pl_map = {p["id"]: p for p in _pl_rows}
        _sb_stats = []
        for r in _ps_rows:
            pl = _pl_map.get(r["player_id"], {})
            if pl:
                # Use player_stats.school for team matching (consistent with scraper)
                # Fall back to players.current_team if school is missing
                school = r.get("school") or pl.get("current_team", "")
                _sb_stats.append({
                    "_sb_name": normalise(pl["name"]),
                    "_sb_team": normalise_team(school),
                    "sb_height": pl.get("height"),
                    "sb_weight": pl.get("weight"),
                    **{f"sb_{k}": v for k, v in r.items() if k != "player_id"}
                })

        if _sb_stats:
            _sb_df = pd.DataFrame(_sb_stats).drop_duplicates(subset=["_sb_name", "_sb_team"])
            df["_sb_name"] = df["player_name"].apply(normalise)
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

    # ── Position buckets + pre-compute metrics over full df ───────────────────
    df = df.reset_index(drop=True)
    df["pos_bucket"] = df["role"].apply(normalise_pos) if "role" in df.columns else "Wing"

    # Physical percentiles (position-relative) — used inside compute_ath
    if "sb_height" in df.columns:
        df["_height_pct"] = percentrank_by_pos(df, "sb_height")
    if "sb_weight" in df.columns:
        df["_weight_pct"] = percentrank_by_pos(df, "sb_weight")

    use_torvik = args.use_torvik_data
    df["_cdi"] = compute_cdi(df)
    df["_dds"] = compute_dds(df, use_torvik=use_torvik)
    df["_sei"] = compute_sei(df, use_torvik=use_torvik)
    df["_ath"] = compute_ath(df, use_torvik=use_torvik)
    df["_ris"] = compute_ris(df, use_torvik=use_torvik)
    df["_nil"], df["_nil_low"], df["_nil_high"], df["_projected_tier"] = compute_nil_valuation(df)

    # ── Load players + stats from Supabase ────────────────────────────────────
    if not args.dry_run:
        print("Fetching players from Supabase …")
        players = []
        page, page_size = 0, 1000
        while True:
            res = db.table("players").select("id, name, current_team, height, nil_valuation") \
                    .range(page * page_size, (page + 1) * page_size - 1).execute()
            players.extend(res.data)
            if len(res.data) < page_size:
                break
            page += 1

        print(f"  {len(players)} players in Supabase")

        # Build lookup: (norm_name, norm_team) → player_id
        player_lookup = {
            (normalise(p["name"]), normalise(p["current_team"])): p["id"]
            for p in players
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

        # Build stats lookup: player_id → stats_row_year_key (paginated)
        _sr_rows, _page = [], 0
        while True:
            _sr = db.table("player_stats").select("id, player_id, year, cdi") \
                    .range(_page * 1000, (_page + 1) * 1000 - 1).execute()
            _sr_rows.extend(_sr.data or [])
            if len(_sr.data or []) < 1000:
                break
            _page += 1
        stats_lookup = {
            (r["player_id"], r["year"]): r["id"]
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

        # ── Extract raw Torvik inputs ─────────────────────────────────────────
        torvik = {
            "torvik_ortg":   safe(row.get("ORtg")),
            "torvik_usg":    safe(row.get("usg")),
            "torvik_efg":    safe(row.get("eFG")),
            "torvik_ts":     safe(row.get("TS_per")),
            "torvik_obpm":   safe(row.get("obpm")),
            "torvik_dbpm":   safe(row.get("dbpm")),
            "torvik_bpm":    safe(row.get("bpm")),
            "torvik_drtg":   safe(row.get("drtg")),
            "torvik_stops":  safe(row.get("stops")),
            "torvik_ast_pct":safe(row.get("AST_per")),
            "torvik_to_pct": safe(row.get("TO_per")),
            "torvik_orb_pct":safe(row.get("ORB_per")),
            "torvik_drb_pct":safe(row.get("DRB_per")),
            "torvik_rim_pct":safe(row.get("rimmade/(rimmade+rimmiss)")),
            "torvik_mid_pct":safe(row.get("midmade/(midmade+midmiss)")),
            "torvik_3p_pct": safe(row.get("TP_per")),
            "torvik_porpag": safe(row.get("porpag")),
            "torvik_adjoe":  safe(row.get("adjoe")),
            "torvik_min_pct":safe(row.get("Min_per")),
            "torvik_gp":     int(safe(row.get("GP"), 0) or 0),
        }

        # ── Pull pre-computed metrics ─────────────────────────────────────────
        idx = row.name  # DataFrame index after reset_index
        cdi      = safe(df.at[idx, "_cdi"])
        dds      = safe(df.at[idx, "_dds"])
        sei      = safe(df.at[idx, "_sei"])
        ath      = safe(df.at[idx, "_ath"])
        ris      = safe(df.at[idx, "_ris"])
        nil           = safe(df.at[idx, "_nil"])
        nil_low       = safe(df.at[idx, "_nil_low"])
        nil_high      = safe(df.at[idx, "_nil_high"])
        tier          = str(df.at[idx, "_projected_tier"]) if "_projected_tier" in df.columns else None

        # ── Parse birth year ──────────────────────────────────────────────────
        birth_year = None
        dob = str(row.get("dob", "")).strip()
        if dob and dob not in ("nan", ""):
            try:
                birth_year = int(dob[:4])
            except (ValueError, IndexError):
                pass

        if args.dry_run:
            print(f"  {name} ({team}) | cdi={cdi} dds={dds} sei={sei} ath={ath} ris={ris} | NIL={nil} | born={birth_year}")
            matched += 1
            continue

        # ── Match to Supabase ─────────────────────────────────────────────────
        key = (normalise(name), normalise_team(team))
        player_id = player_lookup.get(key)

        if not player_id:
            unmatched += 1
            print(f"  ✗ NO MATCH: {name} ({team})")
            unmatched_rows.append({"name": name, "team": team, "yr": yr})
            continue

        if args.skip_matched and player_id in already_matched:
            continue

        # Update player row
        player_patch = {}
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
        pos = normalise_pos(row.get("role", ""))
        if pos:
            player_patch["primary_position"] = pos
        YR_MAP = {"Fr": "Freshman", "So": "Sophomore", "Jr": "Junior", "Sr": "Senior", "Gr": "Graduate"}
        yr_raw = str(row.get("yr", "")).strip()
        yr_mapped = YR_MAP.get(yr_raw)
        if yr_mapped:
            player_patch["year"] = yr_mapped
        ht = str(row.get("ht", "")).strip()
        if ht and ht not in ("nan", "") and not player_height_lookup.get(player_id):
            player_patch["height"] = ht
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

        # Update player_stats row
        stats_patch = {**torvik}
        for key_m, val in [("cdi", cdi), ("dds", dds), ("sei", sei), ("ath", ath), ("ris", ris)]:
            if val is not None:
                stats_patch[key_m] = val
        if tier and not args.skip_nil:
            stats_patch["projected_tier"] = tier

        # Find the matching stats row (match on player_id + year class)
        stats_id = stats_lookup.get((player_id, yr))
        if stats_id:
            db.table("player_stats").update(stats_patch).eq("id", stats_id).execute()
        else:
            # Fallback: update most recent stats row for this player
            db.table("player_stats").update(stats_patch).eq("player_id", player_id).execute()

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

    # ── Null out metrics + zero NIL for low-minutes players ───────────────────
    if low_minutes_keys and not args.dry_run:
        zeroed = 0
        for key in low_minutes_keys:
            pid = player_lookup.get(key)
            if not pid:
                continue
            # Null all metrics so the modal shows "insufficient playing time"
            stats_patch = {"cdi": None, "dds": None, "sei": None, "ath": None, "ris": None}
            stats_id = stats_lookup.get((pid, ""))  # best effort
            db.table("player_stats").update(stats_patch).eq("player_id", pid).execute()
            if not args.skip_nil:
                db.table("players").update({"nil_valuation": 0}).eq("id", pid).execute()
            zeroed += 1
        print(f"  Cleared metrics/NIL for {zeroed} low-minutes players")

    if args.dry_run:
        print("(dry-run — nothing written)")


if __name__ == "__main__":
    main()
