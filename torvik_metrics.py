"""
torvik_metrics.py — Load Torvik CSV → compute BtPM metrics + NIL valuation → write to Supabase
================================================================================================
Reads trank_data.csv, matches players to Supabase by (name, team), writes:
  - Raw Torvik inputs to player_stats (torvik_* columns)
  - Computed BtPM metrics to player_stats (cdi, dds, sei, smi, ris)
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
    ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS smi float;
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
    p.add_argument("--dry-run", action="store_true")
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
    tov_mult = df["TO_per"] + 1

    
    df["_cdi_raw"] = (df["AST_per"] * usg_mult * pos_mult) / tov_mult
 


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

    df["_dds_raw"] = (df["stl_per"] + 0.75 * df["blk_per"] + 0.5 * df["DRB_per"] - 0.5 * df["pfr"]).clip(lower=0)

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



    df["_sei_raw"] = df["TS_per"] * (df["usg"]/100)**0.5
    return percentrank_by_pos(df, "_sei_raw").apply(clamp)


def compute_smi(df):
    """
    SMI — Shot Making Index
    Measures shot quality and shot-making ability across zones.
    Inputs to consider: rimmade/(rimmade+rimmiss), midmade/(midmade+midmiss), TP_per, FT_per, eFG, TS_per, ftr
    """
    # TODO: build composite + percentrank
    return pd.Series(None, index=df.index, dtype=float)


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
    freethrow = 6 * (df["FT_per"])
    orb = 1.2 * df["ORB_per"]
    blk = 0.9 * df["blk_per"]
    drb = 0.4 * df["DRB_per"]
    df["_ris_raw"] = rimmade + freethrow + orb + blk + drb
    return percentrank_by_pos(df, "_ris_raw").apply(clamp)




def compute_nil_valuation(df):
    """
    NIL Valuation — estimated market value in dollars.
    Inputs: all BtPM metrics + raw Torvik stats.
    Return a Series of dollar amounts.
    """
    # TODO: define your formula, e.g.:
    # composite = (df["_cdi"] + df["_dds"] + df["_sei"] + df["_smi"] + df["_ris"]) / 5
    # return (composite - 80).clip(lower=0) * 5000
    return pd.Series(None, index=df.index, dtype=float)


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
                                  "fg_pct, ft_pct, 3p_pct") \
                          .range(_page * _ps, (_page + 1) * _ps - 1).execute()
            _ps_rows.extend(_res.data or [])
            if len(_res.data or []) < _ps:
                break
            _page += 1

        # Also need player name+team to join
        _pl_rows, _page = [], 0
        while True:
            _res = _db_tmp.table("players").select("id, name, current_team") \
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
                _sb_stats.append({
                    "_sb_name": normalise(pl["name"]),
                    "_sb_team": normalise(pl.get("current_team", "")),
                    **{f"sb_{k}": v for k, v in r.items() if k != "player_id"}
                })

        if _sb_stats:
            _sb_df = pd.DataFrame(_sb_stats).drop_duplicates(subset=["_sb_name", "_sb_team"])
            df["_sb_name"] = df["player_name"].apply(normalise)
            df["_sb_team"] = df["team"].apply(normalise)
            df = df.merge(_sb_df, on=["_sb_name", "_sb_team"], how="left")
            df = df.drop(columns=["_sb_name", "_sb_team"])
            print(f"  Merged {_sb_df.shape[0]} player_stats rows into df")
        else:
            print("  No player_stats rows fetched — skipping merge")
    # In dry-run mode, sb_* columns won't exist; formulas should guard with .get or fillna

    # ── Position buckets + pre-compute metrics over full df ───────────────────
    df = df.reset_index(drop=True)
    df["pos_bucket"] = df["role"].apply(normalise_pos) if "role" in df.columns else "Wing"

    df["_cdi"] = compute_cdi(df)
    df["_dds"] = compute_dds(df)
    df["_sei"] = compute_sei(df)
    df["_smi"] = compute_smi(df)
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

        # Build stats lookup: player_id → stats_row_year_key
        stats_res = db.table("player_stats").select("id, player_id, year").execute()
        stats_lookup = {
            (r["player_id"], r["year"]): r["id"]
            for r in (stats_res.data or [])
        }
    else:
        player_lookup = {}
        stats_lookup  = {}

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
        smi = safe(df.at[idx, "_smi"])
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
            print(f"  {name} ({team}) | cdi={cdi} dds={dds} sei={sei} smi={smi} ris={ris} | NIL={nil} | born={birth_year}")
            matched += 1
            continue

        # ── Match to Supabase ─────────────────────────────────────────────────
        key = (normalise(name), normalise(team))
        player_id = player_lookup.get(key)

        if not player_id:
            unmatched += 1
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
        for key_m, val in [("cdi", cdi), ("dds", dds), ("sei", sei), ("smi", smi), ("ris", ris)]:
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
