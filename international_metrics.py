"""
international_metrics.py — Compute BtP international metrics → write to Supabase
=================================================================================
Reads international_players + international_players_stats from Supabase, computes
five metrics (all 0–100 percentile-ranked within each league), then writes them
back to the `metrics` JSONB column on international_players.

Metrics (keys in the JSONB):
    offensive_footprint   Offensive Footprint %  (OFP — usage proxy)
    defensive_score       DDS-style defensive disruption score
    winning_impact        Performance differential in wins vs losses
    sos_performance       Performance differential vs above-.500 teams (Competition Quality)
    translation_grade     Weighted composite × league tier × height boost

Winning Impact and SOS Performance require per-player win/loss and
opponent-strength splits, which the base RealGM scraper does NOT capture. They
are written as null unless splits data exists in `international_players_splits`
(scraped separately). The other three metrics work with just Totals/Per_36/Advanced.

Usage:
    python international_metrics.py --dry-run                # preview, no DB writes
    python international_metrics.py                          # write to Supabase
    python international_metrics.py --league "Spanish Liga U"  # one league only
    python international_metrics.py --season 2026            # one season only

Environment variables:
    $env:SUPABASE_URL         = "https://YOUR_PROJECT.supabase.co"
    $env:SUPABASE_SERVICE_KEY = "your-service-role-key"
"""

import argparse
import math
import os
import sys
from collections import defaultdict

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")


SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


# ── Constants ─────────────────────────────────────────────────────────────────

POSITIONAL_HEIGHTS_CM = {  # for the translation-grade height boost
    "Guard":   188,
    "Wing":    195,
    "Forward": 203,
    "Big":     205,
}

TIER_MULTIPLIERS = {1: 1.00, 2: 0.90, 3: 0.80, 4: 0.70}

# Translation grade weights
TG_WEIGHTS = {
    "competition_quality": 0.30,
    "winning_impact":      0.25,
    "defensive_score":     0.22,
    "offensive_footprint": 0.23,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--league",  help="Only process this league (exact name match)")
    p.add_argument("--season",  type=int, help="Only use stats from this season (default: latest per player)")
    p.add_argument("--overwrite-tg", action="store_true",
                   help="Recompute translation_grade even if winning_impact/sos_performance are None")
    return p.parse_args()


def safe(v):
    """Return float or None if missing/unparseable. Treats '' / '—' / None as None."""
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip().replace("%", "").replace(",", "")
        if v in ("", "—", "-", "N/A"):
            return None
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def clamp(val, lo=0, hi=100):
    if val is None:
        return None
    return max(lo, min(hi, val))


def parse_height_cm(h):
    """Convert stored height ('6'9\"' or '6-9' or '205cm' or '205') to centimetres."""
    if not h:
        return None
    s = str(h).strip().lower().replace('"', "").replace("”", "")
    if s.endswith("cm"):
        return safe(s.replace("cm", "").strip())
    # Feet'inches
    for sep in ("'", "′", "-"):
        if sep in s:
            try:
                ft, inc = s.split(sep, 1)
                ft  = int(ft.strip())
                inc = int((inc or "0").strip() or 0)
                return round((ft * 12 + inc) * 2.54, 1)
            except ValueError:
                pass
    # Pure number — assume cm if > 100, else inches
    n = safe(s)
    if n is None:
        return None
    return round(n if n > 100 else n * 2.54, 1)


def bucket_position(pos):
    """Map raw position to one of Guard / Wing / Forward / Big (the 4 buckets used for the height boost)."""
    if not pos:
        return "Wing"
    p = str(pos).strip().upper()
    if p in ("PG", "SG", "G"):
        return "Guard"
    if p in ("SF",):
        return "Wing"
    if p in ("PF", "F"):
        return "Forward"
    if p in ("C",):
        return "Big"
    # Fuzzy fallbacks
    if "GUARD" in p:   return "Guard"
    if "FORWARD" in p: return "Forward"
    if "CENTER" in p:  return "Big"
    return "Wing"


def percentile_rank(values, *, ignore_none=True):
    """
    Convert a list of numeric values to percentile ranks (0–100).
    Returns a list of percentiles in the same order. None inputs stay None.
    Rank uses the share of strictly-lower values (so the max is 100 only when unique).
    """
    paired = [(i, v) for i, v in enumerate(values) if v is not None]
    if not paired:
        return [None] * len(values)
    sorted_vals = sorted(v for _, v in paired)
    n = len(sorted_vals)
    out = [None] * len(values)
    for idx, v in paired:
        # share of values strictly less than this one
        below = sum(1 for s in sorted_vals if s < v)
        out[idx] = round(below / (n - 1) * 100, 2) if n > 1 else 50.0
    return out


# ── Stat extraction ───────────────────────────────────────────────────────────

def get_stat(stats_dict, *keys):
    """Try each key in order, return first non-None safe float."""
    for k in keys:
        v = safe(stats_dict.get(k))
        if v is not None:
            return v
    return None


def player_totals(stats):
    """Pull totals dict for a player. stats is the JSONB for a Totals row."""
    return {
        "gp":   get_stat(stats, "gp",   "GP")     or 0,
        "min":  get_stat(stats, "min",  "MIN")    or 0,
        "fga":  get_stat(stats, "fga",  "FGA")    or 0,
        "fta":  get_stat(stats, "fta",  "FTA")    or 0,
        "tov":  get_stat(stats, "to",   "tov", "TOV", "TO") or 0,
        "ast":  get_stat(stats, "ast",  "AST")    or 0,
        "stl":  get_stat(stats, "stl",  "STL")    or 0,
        "blk":  get_stat(stats, "blk",  "BLK")    or 0,
        "orb":  get_stat(stats, "orb",  "ORB",    "oreb") or 0,
        "drb":  get_stat(stats, "drb",  "DRB",    "dreb") or 0,
        "pf":   get_stat(stats, "pf",   "PF",     "fouls") or 0,
    }


def player_per36(stats):
    """Pull per-36 rates for DDS computation."""
    return {
        "stl": get_stat(stats, "stl", "STL"),
        "blk": get_stat(stats, "blk", "BLK"),
        "drb": get_stat(stats, "drb", "DRB", "dreb"),
        "reb": get_stat(stats, "reb", "REB", "trb"),
        "pf":  get_stat(stats, "pf",  "PF"),
    }


# ── Metric formulas ───────────────────────────────────────────────────────────

def compute_offensive_footprint(player_t, team_t):
    """
    OFP% = 100 × ((FGA + 0.44 × FTA + TOV + AST) × (Tm MP / 5)) /
                 (MP × (Tm FGA + 0.44 × Tm FTA + Tm TOV + Tm AST))
    """
    if not player_t or not team_t:
        return None
    mp = player_t.get("min") or 0
    if mp <= 0:
        return None
    tm_denom = (
        (team_t.get("fga") or 0)
        + 0.44 * (team_t.get("fta") or 0)
        + (team_t.get("tov") or 0)
        + (team_t.get("ast") or 0)
    )
    if tm_denom <= 0:
        return None
    p_num = (
        (player_t.get("fga") or 0)
        + 0.44 * (player_t.get("fta") or 0)
        + (player_t.get("tov") or 0)
        + (player_t.get("ast") or 0)
    )
    tm_mp = (team_t.get("min") or 0) / 5.0
    if tm_mp <= 0:
        return None
    return 100.0 * (p_num * tm_mp) / (mp * tm_denom)


def compute_defensive_score_raw(per36, totals):
    """
    DDS-style. Pure rate-based — percentile-ranked across the league afterwards.
    Uses per-36 stl/blk/drb minus a fouling penalty.
    """
    if per36 is None:
        return None
    stl = per36.get("stl")
    blk = per36.get("blk")
    drb = per36.get("drb")
    # Fall back to total rebounds × 0.7 (rough drb share) if drb missing
    if drb is None and per36.get("reb") is not None:
        drb = per36.get("reb") * 0.7
    if stl is None and blk is None and drb is None:
        return None
    # Fouls per 36 — from totals
    pf_p36 = None
    if totals and totals.get("min", 0) > 0 and totals.get("pf") is not None:
        pf_p36 = totals["pf"] / totals["min"] * 36.0
    raw = (stl or 0) + 0.75 * (blk or 0) + 0.5 * (drb or 0)
    if pf_p36 is not None:
        raw -= 0.5 * pf_p36
    return max(0, raw)


def compute_winning_impact_raw(splits):
    """
    Winning Impact formula. Needs per-player win/loss splits:
      splits = { "win": {pts, ts, ast_tov, ast, tov, stl, blk, orb, drb},
                 "loss": { ... } }
    Returns None if either side is missing.

    0.30 * ((PTS_W - PTS_L) * (1 + (TS%_W - TS%_L))) + 0.15 * (AST/TO_W - AST/TO_L)
      + 0.10 * (AST_W - AST_L) - 0.15 * (TOV_W - TOV_L)
      + 0.10 * (STL_W - STL_L) + 0.08 * (BLK_W - BLK_L)
      + 0.07 * (ORB_W - ORB_L) + 0.05 * (DRB_W - DRB_L)
    """
    if not splits or "win" not in splits or "loss" not in splits:
        return None
    w, l = splits["win"], splits["loss"]

    def d(k):
        wv = safe(w.get(k));  lv = safe(l.get(k))
        if wv is None or lv is None: return 0.0
        return wv - lv

    pts_diff = d("pts")
    ts_diff  = d("ts")    # decimal (0.55 - 0.50 = 0.05)
    return (
        0.30 * (pts_diff * (1 + ts_diff))
        + 0.15 * d("ast_tov")
        + 0.10 * d("ast")
        - 0.15 * d("tov")
        + 0.10 * d("stl")
        + 0.08 * d("blk")
        + 0.07 * d("orb")
        + 0.05 * d("drb")
    )


def compute_competition_quality_raw(splits):
    """
    Competition Quality (CQI) — Above-.500 vs At-or-below-.500 opponents.
      splits = { "above": {...}, "below": {...} }

    0.25 * ((PTS_A - PTS_B) * (1 + (TS%_A - TS%_B))) + 0.15 * (AST/TO_A - AST/TO_B)
      + 0.08 * (AST_A - AST_B) - 0.15 * (TOV_A - TOV_B)
      + 0.12 * (STL_A - STL_B) + 0.08 * (BLK_A - BLK_B)
      + 0.05 * (ORB_A - ORB_B) + 0.07 * (DRB_A - DRB_B)
    """
    if not splits or "above" not in splits or "below" not in splits:
        return None
    a, b = splits["above"], splits["below"]

    def d(k):
        av = safe(a.get(k));  bv = safe(b.get(k))
        if av is None or bv is None: return 0.0
        return av - bv

    pts_diff = d("pts")
    ts_diff  = d("ts")
    return (
        0.25 * (pts_diff * (1 + ts_diff))
        + 0.15 * d("ast_tov")
        + 0.08 * d("ast")
        - 0.15 * d("tov")
        + 0.12 * d("stl")
        + 0.08 * d("blk")
        + 0.05 * d("orb")
        + 0.07 * d("drb")
    )


def height_boost(height_cm, position):
    """
    (Player Height - Positional Average) × 0.1, capped at +5 / -5.
    Returns 0 if either input is missing.
    """
    if height_cm is None or position is None:
        return 0
    avg = POSITIONAL_HEIGHTS_CM.get(bucket_position(position))
    if avg is None:
        return 0
    diff = height_cm - avg
    return max(-5, min(5, diff * 0.1))


def compute_translation_grade(percentiles, tier, height_cm, position):
    """
    Composite × tier × height boost.
      composite = ofp_p × 0.23 + def_p × 0.22 + wid_p × 0.25 + cqi_p × 0.30
      tg = composite × tier_mult + height_boost
    Returns None if any required percentile is missing.
    """
    ofp_p = percentiles.get("offensive_footprint")
    def_p = percentiles.get("defensive_score")
    wid_p = percentiles.get("winning_impact")
    cqi_p = percentiles.get("sos_performance")  # alias for Competition Quality
    if None in (ofp_p, def_p, wid_p, cqi_p):
        return None
    composite = (
        cqi_p * TG_WEIGHTS["competition_quality"]
        + wid_p * TG_WEIGHTS["winning_impact"]
        + def_p * TG_WEIGHTS["defensive_score"]
        + ofp_p * TG_WEIGHTS["offensive_footprint"]
    )
    mult  = TIER_MULTIPLIERS.get(tier, 0.80)
    boost = height_boost(height_cm, position)
    return round(clamp(composite * mult + boost), 2)


# ── Data loaders ──────────────────────────────────────────────────────────────

def load_profiles(db, league=None):
    rows, page, page_size = [], 0, 1000
    while True:
        q = db.table("international_players").select(
            "id, name, league, height, primary_position, competition_tier, metrics"
        )
        if league:
            q = q.eq("league", league)
        res = q.range(page * page_size, (page + 1) * page_size - 1).execute()
        rows.extend(res.data or [])
        if len(res.data or []) < page_size:
            break
        page += 1
    return rows


def load_stats(db, league=None, season=None):
    rows, page, page_size = [], 0, 1000
    while True:
        q = db.table("international_players_stats").select(
            "player_name, league, season, season_type, stat_type, team, stats"
        )
        if league:
            q = q.eq("league", league)
        if season:
            q = q.eq("season", season)
        res = q.range(page * page_size, (page + 1) * page_size - 1).execute()
        rows.extend(res.data or [])
        if len(res.data or []) < page_size:
            break
        page += 1
    return rows


def load_splits(db, league=None):
    """
    Optional splits table — if it exists and is populated, we can compute
    winning_impact and sos_performance. Empty list is fine.
    """
    try:
        rows, page, page_size = [], 0, 1000
        while True:
            q = db.table("international_players_splits").select(
                "player_name, league, season, split, split_stats"
            )
            if league:
                q = q.eq("league", league)
            res = q.range(page * page_size, (page + 1) * page_size - 1).execute()
            rows.extend(res.data or [])
            if len(res.data or []) < page_size:
                break
            page += 1
        return rows
    except Exception as e:
        print(f"  (no splits table or fetch failed — {e}; W/L-based metrics will be null)")
        return []


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.")
    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print("Loading international_players …")
    profiles = load_profiles(db, league=args.league)
    print(f"  {len(profiles)} profiles")

    print("Loading international_players_stats …")
    stats_rows = load_stats(db, league=args.league, season=args.season)
    print(f"  {len(stats_rows)} stat rows")

    print("Loading splits (optional) …")
    splits_rows = load_splits(db, league=args.league)
    print(f"  {len(splits_rows)} split rows")

    # Index stat rows by (player_name, league, stat_type, season_type) → stats dict.
    # When multiple seasons exist for the same player+stat_type, take the latest.
    stat_index = {}
    latest_season = {}
    for r in stats_rows:
        key = (r["player_name"], r["league"], r["stat_type"], r.get("season_type") or "Regular_Season")
        s   = r["season"] or 0
        if s >= latest_season.get(key, -1):
            latest_season[key] = s
            stat_index[key] = r

    # Index splits: { (player_name, league) -> {"win": {...}, "loss": {...}, "above": {...}, "below": {...}} }
    splits_index = defaultdict(dict)
    for r in splits_rows:
        key = (r["player_name"], r["league"])
        split = (r.get("split") or "").lower()
        if split in ("win", "wins", "w"):           bucket = "win"
        elif split in ("loss", "losses", "l"):      bucket = "loss"
        elif split in ("above", "above_500", ">.500", "above .500"): bucket = "above"
        elif split in ("below", "below_500", "≤.500", "below .500", "at_or_below"): bucket = "below"
        else:
            continue
        splits_index[key][bucket] = r.get("split_stats") or {}

    # Group profiles by league for per-league percentiling.
    by_league = defaultdict(list)
    for p in profiles:
        by_league[p["league"]].append(p)

    total_updates = 0
    total_skipped = 0

    for league_name, league_profiles in by_league.items():
        print(f"\n── League: {league_name} ({len(league_profiles)} players) ──")

        # ── 1. Aggregate team totals from Totals rows for this league ─────────
        team_totals = defaultdict(lambda: defaultdict(float))
        for p in league_profiles:
            key = (p["name"], league_name, "Totals", "Regular_Season")
            r   = stat_index.get(key)
            if not r:
                continue
            team = r.get("team")
            if not team:
                continue
            t = player_totals(r["stats"] or {})
            for k, v in t.items():
                team_totals[team][k] += v

        # ── 2. Raw per-player metrics ─────────────────────────────────────────
        raw_per_player = {}  # player_id -> {ofp, dds, wid, cqi}
        for p in league_profiles:
            pname = p["name"]
            totals_row = stat_index.get((pname, league_name, "Totals", "Regular_Season"))
            per36_row  = stat_index.get((pname, league_name, "Per_36",  "Regular_Season"))

            totals = player_totals(totals_row["stats"] or {}) if totals_row else None
            per36  = player_per36(per36_row["stats"]  or {}) if per36_row  else None

            # Player's team is the Totals row's team
            ptm = totals_row.get("team") if totals_row else None
            tm_t = team_totals.get(ptm) if ptm else None

            ofp = compute_offensive_footprint(totals, tm_t) if totals and tm_t else None
            dds = compute_defensive_score_raw(per36, totals)
            wid = compute_winning_impact_raw(splits_index.get((pname, league_name)))
            cqi = compute_competition_quality_raw(splits_index.get((pname, league_name)))

            raw_per_player[p["id"]] = {
                "offensive_footprint": ofp,
                "defensive_score":     dds,
                "winning_impact":      wid,
                "sos_performance":     cqi,
            }

        # ── 3. Percentile-rank within league ──────────────────────────────────
        ids   = [p["id"] for p in league_profiles]
        pct   = {}
        for metric in ("offensive_footprint", "defensive_score", "winning_impact", "sos_performance"):
            raw_vals = [raw_per_player[pid].get(metric) for pid in ids]
            pct_vals = percentile_rank(raw_vals)
            for pid, pv in zip(ids, pct_vals):
                pct.setdefault(pid, {})[metric] = pv

        # ── 4. Translation grade ──────────────────────────────────────────────
        for p in league_profiles:
            pid = p["id"]
            tg  = compute_translation_grade(
                pct[pid],
                tier      = p.get("competition_tier"),
                height_cm = parse_height_cm(p.get("height")),
                position  = p.get("primary_position"),
            )
            pct[pid]["translation_grade"] = tg

        # ── 5. Write back (merge with existing metrics) ───────────────────────
        for p in league_profiles:
            pid     = p["id"]
            new_met = {k: v for k, v in pct[pid].items() if v is not None}
            if not new_met:
                total_skipped += 1
                continue

            merged = dict(p.get("metrics") or {})
            merged.update(new_met)

            if args.dry_run:
                print(f"  {p['name']:30s}  OFP={merged.get('offensive_footprint')}  "
                      f"DDS={merged.get('defensive_score')}  WID={merged.get('winning_impact')}  "
                      f"CQI={merged.get('sos_performance')}  TG={merged.get('translation_grade')}")
                total_updates += 1
                continue

            res = db.table("international_players").update({"metrics": merged}).eq("id", pid).execute()
            if res.data:
                total_updates += 1
            else:
                print(f"  ⚠ no rows updated for {p['name']} — RLS may be blocking. payload={merged}")
                total_skipped += 1

    print(f"\nDone. Updated {total_updates} players, skipped {total_skipped}.")
    if args.dry_run:
        print("(dry-run — no DB writes)")


if __name__ == "__main__":
    main()
