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


# ── Helpers ────────────────────────────────────────────────────────────────────
def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run",   action="store_true", help="Print without writing")
    p.add_argument("--overwrite", action="store_true", help="Re-compute even if archetype already set")
    return p.parse_args()


def fetch_all_players(sb):
    rows, page_size, offset = [], 1000, 0
    while True:
        res = sb.table("players") \
                .select("id, name, primary_position, sei, ath, ris, dds, cdi, archetype") \
                .range(offset, offset + page_size - 1) \
                .execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    args = parse_args()

    if not args.dry_run and (not SUPABASE_URL or not SUPABASE_SERVICE_KEY):
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY, or pass --dry-run.")

    sb = None if args.dry_run else create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

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

    print("Fetching players…")
    players = fetch_all_players(sb)
    print(f"  {len(players)} players loaded.\n")

    updates    = []
    skipped    = 0
    no_pos     = []
    no_metrics = []

    for p in players:
        pos = p.get("primary_position")

        # Skip if archetype already set and not overwriting
        if p.get("archetype") and not args.overwrite:
            skipped += 1
            continue

        if not pos:
            no_pos.append(p.get("name", p["id"]))
            continue

        # Skip players with no metrics at all (unevaluated)
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
                sb.table("players").update({"archetype": arch}).eq("id", pid).execute()
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
