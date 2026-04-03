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
    p.add_argument("--dry-run",      action="store_true")
    p.add_argument("--skip-matched", action="store_true",
                   help="Skip players that already have cdi written in player_stats")
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
    "jackson st.":              "jackson state",
    "jacksonville st.":         "jacksonville state",
    "kansas st.":               "kansas state",
    "kennesaw st.":             "kennesaw state",
    "kent st.":                 "kent state",
    "long beach st.":           "long beach state",
    "michigan st.":             "michigan state",
    "mississippi st.":          "mississippi state",
    "mississippi valley st.":   "mississippi valley state",
    "missouri st.":             "missouri state",
    "montana st.":              "montana state",
    "morehead st.":             "morehead state",
    "morgan st.":               "morgan state",
    "murray st.":               "murray state",
    "new mexico st.":           "new mexico state",
    "nicholls st.":             "nicholls state",
    "norfolk st.":              "norfolk state",
    "north dakota st.":         "north dakota state",
    "northwestern st.":         "northwestern state",
    "ohio st.":                 "ohio state",
    "oklahoma st.":             "oklahoma state",
    "oregon st.":               "oregon state",
    "penn st.":                 "penn state",
    "portland st.":             "portland state",
    "sacramento st.":           "sacramento state",
    "sam houston st.":          "sam houston",
    "san diego st.":            "san diego state",
    "san jose st.":             "san jose state",
    "south carolina st.":       "south carolina state",
    "south dakota st.":         "south dakota state",
    "southeast missouri st.":   "southeast missouri state",
    "tarleton st.":             "tarleton state",
    "tennessee st.":            "tennessee state",
    "texas st.":                "texas state",
    "utah st.":                 "utah state",
    "washington st.":           "washington state",
    "weber st.":                "weber state",
    "wichita st.":              "wichita state",
    "wright st.":               "wright state",
    "youngstown st.":           "youngstown state",
    # Other common renames
    "n.c. state":               "nc state",
    "mississippi":              "ole miss",
    "illinois chicago":         "uic",
    "mcneese st.":              "mcneese",
    "texas a&m corpus chris":   "texas a&m corpus christi",
    "louisiana monroe":         "louisiana monroe",
    "little rock":              "little rock",
    "mount st. mary's":         "mount st. mary's",
    "cal st. fullerton":        "cal state fullerton",
    "cal st. northridge":       "cal state northridge",
    "cal st. bakersfield":      "cal state bakersfield",
    "loyola md":                "loyola maryland",
    "siue":                     "siu edwardsville",
    "siu":                      "southern illinois",
    "umkc":                     "kansas city",
    "umass lowell":             "umass lowell",
    "nebraska omaha":           "nebraska omaha",
    "ut arlington":             "ut arlington",
    "ut rio grande valley":     "utrgv",
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
    if any(x in role for x in ["big", "pf", "c", "center", "power"]):
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
    """
    CDI — Creation & Distribution Index
    Measures playmaking, ball creation, and decision-making quality.
    Inputs to consider: AST_per, TO_per, ast/tov, obpm, ogbpm, usg
    """
    
    # Example formula (scale and weights are arbitrary starting points — adjust as needed):
    # (
    #     Ast/40
    #     * (1 + (usage/100))
    #     * position_multiplier  # e.g. 1.15 for Bigs, 1.08 for Wings, 1.0 for Guards
    # )
    # / ((AR5/(AF5/40)) + 1),
    # Note I am using AST_per instead of ast/40, and TO_per instead of ast/tov, because AST_per and TO_per are already normalized for pace and opportunity, so they should be more stable inputs for a composite metric. But you could experiment with different combinations.


    pos_mult = df["pos_bucket"].map({"Big": 1.15, "Wing": 1.08, "Guard": 1.0})
    usg_mult = 1 + (df["usg"] / 100)
    tov_40   = (df["sb_tot_tov"] / df["sb_tot_mp"].replace(0, float("nan"))) * 40
    tov_mult = tov_40.fillna(1) + 1
    ast_col  = (df["sb_tot_ast"] / df["sb_tot_mp"].replace(0, float("nan"))) * 40
    ast_col  = ast_col.fillna(df["AST_per"])

    df["_cdi_raw"] = (ast_col * usg_mult * pos_mult) / tov_mult
 


    return percentrank_by_pos(df, "_cdi_raw").apply(clamp)
    # return pd.Series(None, index=df.index, dtype=float)


def compute_dds(df):
    """
    DDS — Defensive Disruption Score
    Measures defensive impact and disruption ability.
    Inputs to consider: dbpm, dgbpm, stops, stl_per, blk_per, DRB_per, adrtg
    Note: lower drtg/adrtg = better defense, so negate when using percentrank.
    """
    # TODO: build composite + percentrank
    
    # MAX(0, BG2 + 0.75*BH2 + 0.5*BI2 - 0.5*N2),
    # 0

    df["_dds_raw"] = (df["sb_stl_40"] + 0.75 * df["sb_blk_40"] + 0.5 * df["sb_drb_40"] - 0.5 * df["pfr"]).clip(lower=0)

    return percentrank_by_pos(df, "_dds_raw").apply(clamp)


def compute_sei(df):
    """
    SEI — Scoring Efficiency Index
    Measures how efficiently a player scores relative to usage.
    Inputs to consider: ORtg, TS_per, eFG, obpm, usg, adjoe, ogbpm
    """
    # TODO: build composite + percentrank
    #     
    #   AV2 * SQRT( AH2 / (AF2/40) )


    df["_fga_40"] = (df["sb_tot_fga"] / df["sb_tot_mp"].replace(0, float("nan"))) * 40

    df["_sei_raw"] = df["TS_per"] * (df["_fga_40"])**0.5
    return percentrank_by_pos(df, "_sei_raw").apply(clamp)


def compute_ath(df):
    """
    ATH — Athleticism Index
    Measures athleticism and physical impact.
    Inputs to consider: rimmade/(rimmade+rimmiss), midmade/(midmade+midmiss), TP_per, FT_per, eFG, TS_per, ftr
    """
    def _apply_weights(df, cols, weights_dict):
        def _row(row):
            w = weights_dict.get(row["pos_bucket"], weights_dict["Wing"])
            return sum(row[c] * w[i] for i, c in enumerate(cols))
        return df.apply(_row, axis=1)
    

    
    df["dunk_vol_per"] = percentrank_by_pos(df, "dunksmade")
    df["_raw_dunk_rate"] = df["dunksmade"] / df["rimmade"] if "rimmade" in df.columns else 0
    df["dunk_rate_per"] = percentrank_by_pos(df, "_raw_dunk_rate")
    df["atr_fin_per"] = percentrank_by_pos(df, "rimmade/(rimmade+rimmiss)")
    df["_raw_atr_shr"] = df["rimmade+rimmiss"] / df["sb_tot_fga"] if "sb_tot_fga" in df.columns else 0
    df["atr_shr_per"] = percentrank_by_pos(df, "_raw_atr_shr")
    df["orb_40_per"] = percentrank_by_pos(df, "sb_orb_40")
    df["rpg_per"] = percentrank_by_pos(df, "sb_rpg")
    # print("DEBUG name:", df["player_name"][:10].tolist())
    # print("DEBUG dunk_vol_per:", df["dunk_vol_per"][:10].tolist())
    # print("DEBUG _raw_dunk_rate:", df["_raw_dunk_rate"][:10].tolist())                                                        
    # print("DEBUG dunk_rate_per:", df["dunk_rate_per"][:10].tolist())
    # print("DEBUG atr_fin_per:", df["atr_fin_per"][:10].tolist())
    # print("DEBUG _raw_atr_shr:", df["_raw_atr_shr"][:10].tolist())
    # print("DEBUG atr_shr_per:", df["atr_shr_per"][:10].tolist())
    # print("DEBUG orb_40_per:", df["orb_40_per"][:10].tolist())
    # print("DEBUG rpg_per:", df["rpg_per"][:10].tolist())
    POP_WEIGHTS = {
        "Guard": [0.05, 0.1, 0.25, 0.3, 0.05, 0.25],  
        "Wing":  [0.1, 0.2, 0.2, 0.15, 0.2, 0.15],  
        "Big":   [0.2, 0.3, 0.1, 0.1, 0.25, 0.05],  
    }
    POP_COLS = ["dunk_vol_per", "dunk_rate_per", "atr_fin_per", "atr_shr_per", "orb_40_per", "rpg_per"]  
    
    df["stl_per_per"] = percentrank_by_pos(df, "stl_per")
    df["blk_per_per"] = percentrank_by_pos(df, "blk_per")
    df["foul_40_per"] = 1 - percentrank_by_pos(df, "pfr")
    df["drb_40_per"] = percentrank_by_pos(df, "sb_drb_40")
    # print("DEBUG stl_per_per:", df["stl_per_per"][:10].tolist())
    # print("DEBUG blk_per_per:", df["blk_per_per"][:10].tolist())
    # print("DEBUG foul_40_per:", df["foul_40_per"][:10].tolist())
    # print("DEBUG drb_40_per:", df["drb_40_per"][:10].tolist())
    LATERAL_WEIGHTS = {
        "Guard": [0.45, 0.05, 0.30, 0.20],
        "Wing":  [0.35, 0.20, 0.20, 0.25],
        "Big":   [0.15, 0.50, 0.25, 0.10],
    }
    LATERAL_COLS = ["stl_per_per", "blk_per_per", "foul_40_per", "drb_40_per"]  
    


    df["ftr_per"] = percentrank_by_pos(df, "ftr")
    print("DEBUG ftr_per:", df["ftr_per"][:5].tolist())
    
    CONTACT_WEIGHTS = {
        "Guard": [0.50, 0.30, 0.10, 0.10],
        "Wing":  [0.35, 0.25, 0.20, 0.20],
        "Big":   [0.15, 0.15, 0.35, 0.35],
    }
    CONTACT_COLS = ["ftr_per", "atr_fin_per", "orb_40_per", "drb_40_per"]

    # frame = position percentile of (weight * 1000) / height
    # df["_frame_raw"] = (df["sb_weight"] * 1000) / df["sb_height"].replace(0, float("nan"))
    # df["_frame_pct"] = percentrank_by_pos(df, "_frame_raw")
    # print("DEBUG sb_weight sample:", df["sb_weight"][:10].tolist() if "sb_weight" in df.columns else "MISSING")
    # print("DEBUG sb_height sample:", df["sb_height"][:10].tolist() if "sb_height" in df.columns else "MISSING")
    # print("DEBUG _frame_raw:", df["_frame_raw"][:10].tolist())
    # print("DEBUG _frame_pct:", df["_frame_pct"][:10].tolist())
    # print("DEBUG _height_pct:", df["_height_pct"][:10].tolist() if "_height_pct" in df.columns else "MISSING")

    # FRAME_WEIGHTS = {
    #     "Guard": [0.4, 0.6],
    #     "Wing":  [0.5, 0.5],
    #     "Big":   [0.6, 0.4],
    # }
    # FRAME_COLS = ["_frame_pct", "_height_pct"]

    pop        = _apply_weights(df, POP_COLS,     POP_WEIGHTS)
    lateral    = _apply_weights(df, LATERAL_COLS, LATERAL_WEIGHTS)
    contact    = _apply_weights(df, CONTACT_COLS, CONTACT_WEIGHTS)
    # framescore = _apply_weights(df, FRAME_COLS,   FRAME_WEIGHTS)
    
    #temporary formula: no framescore because weights are not scraper
    df["_ath_raw"] = (pop + (lateral * 2) + contact) / 4
    
    # print("pop sample:", pop[:10].tolist())
    # print("lateral sample:", lateral[:10].tolist())
    # print("contact sample:", contact[:10].tolist())
    # print("frame sample:", framescore[:10].tolist())
    # print("_ath_raw sample:", df["_ath_raw"][:10].tolist())
    return percentrank_by_pos(df, "_ath_raw").apply(clamp)


def compute_ris(df):
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
    rimmade = df["rimmade"] * df["rimmade/(rimmade+rimmiss)"]**0.5
    freethrow = 6 * (df["sb_tot_fta"]/(df["sb_tot_fga"] + 1))
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
    # ── Stat weights (from Weights sheet) ────────────────────────────────────
    WEIGHTS = {
        "ppg":     0.15,
        "ts_pct":  0.12,
        "3p_pct":  0.08,
        "ast_pct": 0.02,  # AST% — Torvik AST_per
        "ast_tov": 0.10,
        "stl_40":  0.07,
        "blk_40":  0.07,
        "drb_40":  0.05,
        "orb_40":  0.04,
        # MPG weight = 0 (excluded)
        # Scout scores (BtPM metrics scaled to 0–1)
        "ath":     0.07,
        "dds":     0.08,
        "sei":     0.05,  # Versatility proxy
        "ris":     0.04,  # Motor proxy
        "cdi":     0.06,  # IQ proxy
    }

    # ── Percentile-rank each stat across full df (0–1 scale) ─────────────────
    def prank(series):
        return series.rank(pct=True, na_option="keep").fillna(0)

    stat_scores = (
        prank(df.get("sb_ppg",    df.get("ppg",    pd.Series(0, index=df.index)))) * WEIGHTS["ppg"]     +
        prank(df.get("sb_fg_pct", df.get("TS_per", pd.Series(0, index=df.index)))) * WEIGHTS["ts_pct"]  +
        prank(df.get("sb_3p_pct", df.get("TP_per", pd.Series(0, index=df.index)))) * WEIGHTS["3p_pct"]  +
        prank(df.get("AST_per",   pd.Series(0, index=df.index)))                   * WEIGHTS["ast_pct"] +
        prank(df.get("ast/tov",   pd.Series(0, index=df.index)))                   * WEIGHTS["ast_tov"] +
        prank(df.get("stl_per",   pd.Series(0, index=df.index)))                   * WEIGHTS["stl_40"]  +
        prank(df.get("blk_per",   pd.Series(0, index=df.index)))                   * WEIGHTS["blk_40"]  +
        prank(df.get("DRB_per",   pd.Series(0, index=df.index)))                   * WEIGHTS["drb_40"]  +
        prank(df.get("ORB_per",   pd.Series(0, index=df.index)))                   * WEIGHTS["orb_40"]
    )

    # BtPM metrics are 0–100; scale to 0–1 for consistency
    scout_scores = (
        (df["_ath"].fillna(0) / 100) * WEIGHTS["ath"] +
        (df["_dds"].fillna(0) / 100) * WEIGHTS["dds"] +
        (df["_sei"].fillna(0) / 100) * WEIGHTS["sei"] +
        (df["_ris"].fillna(0) / 100) * WEIGHTS["ris"] +
        (df["_cdi"].fillna(0) / 100) * WEIGHTS["cdi"]
    )

    total_score = (stat_scores + scout_scores).clip(0, 1)  # W

    # ── Conference adjustment (V) ─────────────────────────────────────────────
    CONF_WEIGHTS = {
        "ACC": 1.0, "B10": 1.0, "B12": 1.0, "SEC": 1.0, "BE": 1.0,
        "MWC": 0.9, "A10": 0.9, "WCC": 0.9, "AAC": 0.9,
        "MVC": 0.8, "SoCon": 0.8, "MAC": 0.8, "CUSA": 0.8,
    }
    conf_col = df.get("sb_conference", pd.Series("", index=df.index))
    conf_adj = conf_col.map(CONF_WEIGHTS).fillna(0.75)  # V

    # ── NIL Cap ───────────────────────────────────────────────────────────────
    nil_cap = 3_500_000  # matches sheet default

    # ── Base NIL = MIN(cap, cap × W² × (1 - (1-V⁴)(1-W)²)^1.2) ─────────────
    blend = (1 - (1 - conf_adj**4) * (1 - total_score)**2) ** 1.2
    base_nil = (nil_cap * total_score**2 * blend).clip(upper=nil_cap)

    # ── Position Boost ────────────────────────────────────────────────────────
    pos_boost = df["pos_bucket"].map({"Big": 1.15, "Wing": 1.0, "Guard": 1.0}).fillna(1.0)

    # ── Age/Year Boost ────────────────────────────────────────────────────────
    yr_col = df.get("sb_year", pd.Series("", index=df.index))
    yr_boost = yr_col.map(
        {"Sophomore": 1.15, "Junior": 1.08, "Senior": 0.95, "Graduate": 0.95, "Freshman": 1.15}
    ).fillna(1.0)

    return (base_nil * pos_boost * yr_boost).clip(lower=0)



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

    # Deduplicate: keep latest season per player+team
    if "year" in df.columns:
        df = df.sort_values("year", ascending=False).drop_duplicates(
            subset=["player_name", "team"], keep="first"
        )

    print(f"  {len(df)} rows after dedup")

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
                    "_sb_team": normalise(school),
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
            if unmatched_sb:
                print(f"  ⚠  Supabase teams with NO Torvik match: {sorted(unmatched_sb)}")
            if unmatched_csv:
                print(f"  ⚠  Torvik CSV teams with NO Supabase match: {sorted(unmatched_csv)}")
            df = df.drop(columns=["_sb_name", "_sb_team"])
            print(f"  Merged {_sb_df.shape[0]} player_stats rows into df")
        else:
            print("  No player_stats rows fetched — skipping merge")
    # In dry-run mode, sb_* columns won't exist; formulas should guard with .get or fillna
    print([c for c in df.columns if c.startswith("sb_")])

    print(df.columns.tolist())

    # ── Position buckets + pre-compute metrics over full df ───────────────────
    df = df.reset_index(drop=True)
    df["pos_bucket"] = df["role"].apply(normalise_pos) if "role" in df.columns else "Wing"

    # Physical percentiles (position-relative) — used inside compute_ath
    if "sb_height" in df.columns:
        df["_height_pct"] = percentrank_by_pos(df, "sb_height")
    if "sb_weight" in df.columns:
        df["_weight_pct"] = percentrank_by_pos(df, "sb_weight")

    df["_cdi"] = compute_cdi(df)
    df["_dds"] = compute_dds(df)
    df["_sei"] = compute_sei(df)
    df["_ath"] = compute_ath(df)
    df["_ris"] = compute_ris(df)
    df["_nil"] = compute_nil_valuation(df)

    # ── Load players + stats from Supabase ────────────────────────────────────
    if not args.dry_run:
        print("Fetching players from Supabase …")
        players = []
        page, page_size = 0, 1000
        while True:
            res = db.table("players").select("id, name, current_team") \
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
        player_lookup   = {}
        stats_lookup    = {}
        already_matched = set()

    # ── Process each row ──────────────────────────────────────────────────────
    matched   = 0
    unmatched = 0

    for _, row in df.iterrows():
        name = str(row.get("player_name", "")).strip()
        team = str(row.get("team", "")).strip()
        yr   = str(row.get("yr", "")).strip()

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
        cdi = safe(df.at[idx, "_cdi"])
        dds = safe(df.at[idx, "_dds"])
        sei = safe(df.at[idx, "_sei"])
        ath = safe(df.at[idx, "_ath"])
        ris = safe(df.at[idx, "_ris"])
        nil = safe(df.at[idx, "_nil"])

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
            continue

        if args.skip_matched and player_id in already_matched:
            continue

        # Update player row
        player_patch = {}
        if birth_year:
            player_patch["birth_year"] = birth_year
        if nil is not None:
            player_patch["nil_valuation"] = nil
        if player_patch:
            db.table("players").update(player_patch).eq("id", player_id).execute()

        # Update player_stats row
        stats_patch = {**torvik}
        for key_m, val in [("cdi", cdi), ("dds", dds), ("sei", sei), ("ath", ath), ("ris", ris)]:
            if val is not None:
                stats_patch[key_m] = val

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
    if args.dry_run:
        print("(dry-run — nothing written)")


if __name__ == "__main__":
    main()
