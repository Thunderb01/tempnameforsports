"""
backfill_archetypes.py — Compute + write archetype for every player in the DB
==============================================================================
Reads each player's primary_position and BTP metrics (sei, ath, ris, dds, cdi),
applies the same classification logic used in PlayerFinder.jsx, and writes the
result to players.archetype.

Prerequisites (run once in Supabase SQL Editor):
    ALTER TABLE public.players ADD COLUMN IF NOT EXISTS archetype text;

    -- Optional: drop the old tag columns once you've confirmed archetypes look good
    ALTER TABLE public.players
      DROP COLUMN IF EXISTS playmaker_tags,
      DROP COLUMN IF EXISTS specialist_tags,
      DROP COLUMN IF EXISTS shooting_tags,
      DROP COLUMN IF EXISTS shotmaking_tags,
      DROP COLUMN IF EXISTS interior_tags,
      DROP COLUMN IF EXISTS defensive_tags;

Usage:
    python backfill_archetypes.py
    python backfill_archetypes.py --dry-run      # print without writing
    python backfill_archetypes.py --overwrite     # re-compute even if archetype already set

Environment variables:
    SUPABASE_URL          https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY  your-service-role-key
"""

import argparse
import os
import sys

try:
    from supabase import create_client
except ImportError:
    sys.exit("Run: pip install supabase")

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


# ── Archetype logic (mirrors PlayerFinder.jsx classifyArchetype) ───────────────
def classify_archetype(pos, sei=0, ath=0, ris=0, dds=0, cdi=0):
    sei  = sei  or 0
    ath  = ath  or 0
    ris  = ris  or 0
    dds  = dds  or 0
    cdi  = cdi  or 0

    # Cross-position: high scoring efficiency, almost no rim presence, low creation
    if sei >= 65 and ris <= 35 and cdi <= 45:
        return "Three-Point Specialist"

    if pos == "Guard":
        if cdi >= 60 and cdi > sei:
            return "Playmaking Guard"
        if dds >= 62 and ath >= 58:
            return "Two-Way Guard"
        return "Scoring Guard"

    if pos == "Wing":
        if dds >= 62 and sei >= 50:
            return "3-and-D Wing"
        if sei >= 60 and ath >= 58:
            return "Scoring Wing"
        return "Versatile Wing"

    if pos == "Big":
        if ris >= 65 and dds >= 58:
            return "Two-Way Big"
        if ris >= 60:
            return "Rim Protector"
        return "Stretch Big"

    return None  # position unknown


# ── Definition-table archetypes (mirrors src/lib/archetypeMatch.js) ────────────
# Each field's `src` is the column on vw_players to read; the defs table uses
# `<key>_min` / `<key>_max`. Keeps parity with DOMESTIC_FIELDS on the JS side.
DOMESTIC_FIELD_DEFS = [
    ("ppg",    "ppg"),
    ("rpg",    "rpg"),
    ("apg",    "apg"),
    ("p3_pct", "3p_pct"),
    ("sei",    "sei"),
    ("ath",    "ath"),
    ("ris",    "ris"),
    ("dds",    "dds"),
    ("cdi",    "cdi"),
]


def norm_pct(v):
    if v is None or v == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n * 100 if 0 < n <= 1 else n


def _in_range(value, lo, hi):
    if lo is None and hi is None:
        return True
    if value is None or value == "":
        return False
    try:
        v = float(value)
    except (TypeError, ValueError):
        return False
    if lo is not None and v < float(lo):
        return False
    if hi is not None and v > float(hi):
        return False
    return True


def _def_has_range(d):
    return any(d.get(f"{k}_min") is not None or d.get(f"{k}_max") is not None
               for k, _ in DOMESTIC_FIELD_DEFS)


def match_archetype(row, defs):
    """First definition (by priority, then name) whose every set range contains
    the player's corresponding value. Returns the archetype name or None."""
    values = {}
    for key, src in DOMESTIC_FIELD_DEFS:
        raw = row.get(src)
        values[key] = norm_pct(raw) if key == "p3_pct" else raw
    ordered = sorted(defs, key=lambda d: (d.get("priority") or 0, str(d.get("name"))))
    for d in ordered:
        if not _def_has_range(d):
            continue
        if all(_in_range(values[k], d.get(f"{k}_min"), d.get(f"{k}_max")) for k, _ in DOMESTIC_FIELD_DEFS):
            return d.get("name")
    return None


def load_defs(sb, table):
    try:
        res = sb.table(table).select("*").order("priority").execute()
        return res.data or []
    except Exception:
        return []


# ── Helpers ────────────────────────────────────────────────────────────────────
def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run",   action="store_true", help="Print without writing")
    p.add_argument("--overwrite", action="store_true", help="Re-compute even if archetype already set")
    p.add_argument("--analyze",   action="store_true", help="Show archetype distribution + metric ranges, no writes")
    p.add_argument("--womens",    action="store_true", help="Target the women's pool (w_players / vw_w_players / w_archetype_defs)")
    return p.parse_args()


# ── Analysis mode ──────────────────────────────────────────────────────────────
def run_analyze(players):
    from collections import defaultdict
    import statistics

    METRICS = ["sei", "ath", "ris", "dds", "cdi"]
    POSITIONS = ["Guard", "Wing", "Big"]

    # Classify every player that has metrics and a position
    classified = []
    skipped_no_pos, skipped_no_metrics = 0, 0
    for p in players:
        pos = p.get("primary_position")
        if not pos:
            skipped_no_pos += 1
            continue
        vals = [p.get(k) for k in METRICS]
        if all(v is None for v in vals):
            skipped_no_metrics += 1
            continue
        arch = classify_archetype(pos, **{k: p.get(k) for k in METRICS})
        classified.append({ "name": p.get("name", ""), "pos": pos, "arch": arch,
                             **{k: p.get(k) or 0 for k in METRICS} })

    total = len(classified)
    print(f"\n{'='*66}")
    print(f"  ARCHETYPE ANALYSIS  —  {total} evaluated players")
    print(f"  (skipped: {skipped_no_pos} no-position, {skipped_no_metrics} no-metrics)")
    print(f"{'='*66}\n")

    # ── Per-position breakdown ──────────────────────────────────────────────
    for pos in POSITIONS:
        group = [r for r in classified if r["pos"] == pos]
        if not group:
            continue
        by_arch = defaultdict(list)
        for r in group:
            by_arch[r["arch"] or "(none)"].append(r)

        print(f"  ── {pos}s  ({len(group)} players) {'─'*(44 - len(pos))}")
        print(f"  {'Archetype':<26}  {'Count':>5}  {'%':>5}  {'SEI':>4}  {'ATH':>4}  {'RIS':>4}  {'DDS':>4}  {'CDI':>4}")
        print(f"  {'-'*64}")
        for arch, rows in sorted(by_arch.items(), key=lambda x: -len(x[1])):
            pct  = len(rows) / len(group) * 100
            avgs = { k: statistics.mean(r[k] for r in rows) for k in METRICS }
            print(f"  {arch:<26}  {len(rows):>5}  {pct:>4.0f}%"
                  f"  {avgs['sei']:>4.0f}  {avgs['ath']:>4.0f}  {avgs['ris']:>4.0f}"
                  f"  {avgs['dds']:>4.0f}  {avgs['cdi']:>4.0f}")
        print()

    # ── Borderline players (within 5pts of a threshold) ────────────────────
    borderline = []
    for r in classified:
        reasons = []
        sei, ath, ris, dds, cdi, pos = r["sei"], r["ath"], r["ris"], r["dds"], r["cdi"], r["pos"]
        # Three-Point Specialist threshold
        if 60 <= sei <= 70 or 30 <= ris <= 40 or 40 <= cdi <= 50:
            reasons.append("near 3PT-Spec threshold")
        if pos == "Guard":
            if 55 <= cdi <= 65: reasons.append("CDI near PG/SG split")
            if 57 <= dds <= 67 or 53 <= ath <= 63: reasons.append("near Two-Way Guard")
        if pos == "Wing":
            if 57 <= dds <= 67 or 45 <= sei <= 55: reasons.append("near 3-and-D split")
            if 55 <= sei <= 65 or 53 <= ath <= 63: reasons.append("near Scoring Wing")
        if pos == "Big":
            if 60 <= ris <= 70 or 53 <= dds <= 63: reasons.append("near rim/stretch split")
        if reasons:
            borderline.append((r["name"], r["pos"], r["arch"], reasons))

    if borderline:
        print(f"  ── Borderline players ({len(borderline)}) {'─'*38}")
        print(f"  {'Player':<28}  {'Pos':<6}  {'Current Arch':<22}  Reason")
        print(f"  {'-'*80}")
        for name, pos, arch, reasons in borderline[:30]:
            print(f"  {name:<28}  {pos:<6}  {arch or '(none)':<22}  {'; '.join(reasons)}")
        if len(borderline) > 30:
            print(f"  … and {len(borderline) - 30} more")
        print()

    # ── Overall distribution ────────────────────────────────────────────────
    from collections import Counter
    all_arches = Counter(r["arch"] or "(none)" for r in classified)
    print(f"  ── National distribution {'─'*40}")
    for arch, cnt in all_arches.most_common():
        bar = "█" * int(cnt / max(all_arches.values()) * 30)
        print(f"  {arch:<26}  {cnt:>4}  {bar}")
    print()


def fetch_all_players(sb, view="vw_players", players_table="players", with_archetype=False):
    # Box stats + metrics live on the view; archetype + override live on the base table.
    rows, page_size, offset = [], 1000, 0
    while True:
        res = sb.table(view) \
                .select("id, name, primary_position, ppg, rpg, apg, 3p_pct, sei, ath, ris, dds, cdi") \
                .range(offset, offset + page_size - 1) \
                .execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    if with_archetype:
        try:
            arch_rows, offset = [], 0
            while True:
                res = sb.table(players_table).select("id, archetype, archetype_overwrite") \
                        .range(offset, offset + page_size - 1).execute()
                batch = res.data or []
                arch_rows.extend(batch)
                if len(batch) < page_size:
                    break
                offset += page_size
            by_id = {r["id"]: r for r in arch_rows}
            for r in rows:
                base = by_id.get(r["id"], {})
                r["archetype"]           = base.get("archetype")
                r["archetype_overwrite"] = base.get("archetype_overwrite")
        except Exception:
            # columns not yet added — treat all as unset
            for r in rows:
                r["archetype"] = None
                r["archetype_overwrite"] = None

    return rows


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    args = parse_args()

    if not args.dry_run and (not SUPABASE_URL or not SUPABASE_SERVICE_KEY):
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY, or pass --dry-run.")

    sb = None if args.dry_run else create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    if args.analyze:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY to run --analyze.")
        sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        print("Fetching players…")
        players = fetch_all_players(sb)
        print(f"  {len(players)} players loaded.")
        run_analyze(players)
        return

    if args.dry_run:
        print("[DRY-RUN] Showing archetype classification logic:\n")
        examples = [
            ("Guard", 75, 60, 20, 55, 65),
            ("Guard", 68, 90, 25, 70, 40),
            ("Guard", 70, 65, 30, 55, 50),
            ("Wing",  60, 65, 40, 68, 45),
            ("Wing",  72, 75, 35, 50, 40),
            ("Wing",  55, 60, 45, 50, 40),
            ("Big",   40, 65, 75, 68, 35),
            ("Big",   35, 60, 70, 50, 30),
            ("Big",   55, 60, 45, 50, 40),
            ("Guard", 70, 55, 25, 45, 40),  # Three-Point Specialist
        ]
        print(f"  {'Pos':<6} {'SEI':>4} {'ATH':>4} {'RIS':>4} {'DDS':>4} {'CDI':>4}  →  Archetype")
        print("  " + "-" * 60)
        for pos, sei, ath, ris, dds, cdi in examples:
            arch = classify_archetype(pos, sei, ath, ris, dds, cdi)
            print(f"  {pos:<6} {sei:>4} {ath:>4} {ris:>4} {dds:>4} {cdi:>4}  →  {arch}")
        print("\nRe-run without --dry-run to write to the DB.")
        return

    view          = "vw_w_players"     if args.womens else "vw_players"
    players_table = "w_players"        if args.womens else "players"
    defs_table    = "w_archetype_defs" if args.womens else "archetype_defs"

    print(f"Pool: {'women' if args.womens else 'men'}  (table={players_table})")
    defs = load_defs(sb, defs_table)
    print(f"  {len(defs)} archetype definitions loaded from {defs_table}"
          f"{' — falling back to built-in thresholds' if not defs else ''}.")

    print("Fetching players…")
    players = fetch_all_players(sb, view=view, players_table=players_table, with_archetype=True)
    print(f"  {len(players)} players loaded.\n")

    updates    = []
    skipped    = 0
    no_pos     = []
    no_metrics = []

    for p in players:
        pos = p.get("primary_position")
        overwrite = p.get("archetype_overwrite")

        # Skip if archetype already set and not overwriting
        if p.get("archetype") and not args.overwrite:
            skipped += 1
            continue

        # A manual override always wins — no position/metrics needed.
        if overwrite:
            if (overwrite or None) != (p.get("archetype") or None):
                updates.append((p["id"], p.get("name", ""), p.get("archetype"), overwrite))
            else:
                skipped += 1
            continue

        if defs:
            arch = match_archetype(p, defs)
        else:
            # Legacy fallback: built-in position-based thresholds (metrics only).
            if not pos:
                no_pos.append(p.get("name", p["id"]))
                continue
            metrics = [p.get("sei"), p.get("ath"), p.get("ris"), p.get("dds"), p.get("cdi")]
            if all(v is None for v in metrics):
                no_metrics.append(p.get("name", p["id"]))
                continue
            arch = classify_archetype(
                pos,
                sei=p.get("sei"), ath=p.get("ath"), ris=p.get("ris"),
                dds=p.get("dds"), cdi=p.get("cdi"),
            )

        if arch:
            updates.append((p["id"], p.get("name", ""), p.get("archetype"), arch))

    # ── Report ─────────────────────────────────────────────────────────────────
    print(f"  {skipped} already have an archetype — skipping (use --overwrite to redo).")
    if no_pos:
        print(f"  {len(no_pos)} players have no position set — skipping:")
        for name in no_pos[:10]:
            print(f"    {name}")
        if len(no_pos) > 10:
            print(f"    … and {len(no_pos) - 10} more")
    if no_metrics:
        print(f"  {len(no_metrics)} unevaluated players (no metrics) — skipping.")
    print(f"\n  {len(updates)} players to update.\n")

    if not updates:
        print("Nothing to do.")
        return

    # ── Preview ────────────────────────────────────────────────────────────────
    # Show archetype distribution
    from collections import Counter
    dist = Counter(arch for _, _, _, arch in updates)
    print("Archetype distribution:")
    for arch, count in sorted(dist.items(), key=lambda x: -x[1]):
        print(f"  {count:>4}  {arch}")
    print()

    # Show first 20 changes
    print(f"{'Player':<32}  {'Old':<22}  →  New")
    print("-" * 72)
    for _, name, old, new in updates[:20]:
        old_str = old or "(none)"
        print(f"  {name:<30}  {old_str:<22}  →  {new}")
    if len(updates) > 20:
        print(f"  … and {len(updates) - 20} more")
    print()

    confirm = input("Write to Supabase? [y/N] ").strip().lower()
    if confirm != "y":
        print("Aborted.")
        return

    BATCH, written, errors = 50, 0, 0
    for i in range(0, len(updates), BATCH):
        batch = updates[i : i + BATCH]
        for pid, name, _, arch in batch:
            try:
                sb.table(players_table).update({"archetype": arch}).eq("id", pid).execute()
                written += 1
            except Exception as exc:
                print(f"  ERROR {name}: {exc}")
                errors += 1
        print(f"  {min(i + BATCH, len(updates))}/{len(updates)} done…", end="\r")

    print(f"\n✓ {written} players updated, {errors} errors.")
    print("\nNext step — drop the old tag columns in Supabase SQL Editor:")
    print("""
  ALTER TABLE public.players
    DROP COLUMN IF EXISTS playmaker_tags,
    DROP COLUMN IF EXISTS specialist_tags,
    DROP COLUMN IF EXISTS shooting_tags,
    DROP COLUMN IF EXISTS shotmaking_tags,
    DROP COLUMN IF EXISTS interior_tags,
    DROP COLUMN IF EXISTS defensive_tags;
""")


if __name__ == "__main__":
    main()
