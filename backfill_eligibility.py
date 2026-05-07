"""
backfill_eligibility.py — Populate eligibility_years + normalize year labels in players table
==============================================================================================
Reads every player's current `year` value, maps it to:
  - a normalized class label  (e.g. "Junior" → "Jr")
  - an eligibility_years int  (e.g. "Jr" → 2)

Then writes both back to the players table.

Prerequisites (run once in Supabase SQL Editor):
    ALTER TABLE public.players ADD COLUMN IF NOT EXISTS eligibility_years integer;

Usage:
    python backfill_eligibility.py
    python backfill_eligibility.py --dry-run          # print changes, don't write
    python backfill_eligibility.py --dry-run --skip-unknowns  # suppress unknown-year rows

Environment variables:
    SUPABASE_URL          https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY  your-service-role-key  (bypasses RLS)
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

# ── Year mapping ───────────────────────────────────────────────────────────────
# key  : lowercase stripped value as stored in DB
# value: (normalized_label, eligibility_years_remaining_including_current_season)
YEAR_MAP = {
    # ── Freshman ──────────────────────────────────
    "fr":                  ("Fr",       4),
    "freshman":            ("Fr",       4),
    "true freshman":       ("Fr",       4),
    "1":                   ("Fr",       4),
    # ── Redshirt Freshman ─────────────────────────
    "rs fr":               ("RS Fr",    4),
    "r-fr":                ("RS Fr",    4),
    "rs freshman":         ("RS Fr",    4),
    "redshirt freshman":   ("RS Fr",    4),
    "redshirt fr":         ("RS Fr",    4),
    # ── Sophomore ─────────────────────────────────
    "so":                  ("So",       3),
    "sophomore":           ("So",       3),
    "2":                   ("So",       3),
    # ── Redshirt Sophomore ────────────────────────
    "rs so":               ("RS So",    3),
    "r-so":                ("RS So",    3),
    "rs sophomore":        ("RS So",    3),
    "redshirt sophomore":  ("RS So",    3),
    "redshirt so":         ("RS So",    3),
    # ── Junior ────────────────────────────────────
    "jr":                  ("Jr",       2),
    "junior":              ("Jr",       2),
    "3":                   ("Jr",       2),
    # ── Redshirt Junior ───────────────────────────
    "rs jr":               ("RS Jr",    2),
    "r-jr":                ("RS Jr",    2),
    "rs junior":           ("RS Jr",    2),
    "redshirt junior":     ("RS Jr",    2),
    "redshirt jr":         ("RS Jr",    2),
    # ── Senior ────────────────────────────────────
    "sr":                  ("Sr",       1),
    "senior":              ("Sr",       1),
    "4":                   ("Sr",       1),
    # ── Redshirt Senior ───────────────────────────
    "rs sr":               ("RS Sr",    1),
    "r-sr":                ("RS Sr",    1),
    "rs senior":           ("RS Sr",    1),
    "redshirt senior":     ("RS Sr",    1),
    "redshirt sr":         ("RS Sr",    1),
    # ── Graduate / 5th Year ───────────────────────
    "grad":                ("Grad",     1),
    "graduate":            ("Grad",     1),
    "gr":                  ("Grad",     1),
    "grad transfer":       ("Grad",     1),
    "graduate transfer":   ("Grad",     1),
    "5th year":            ("5th Year", 1),
    "fifth year":          ("5th Year", 1),
    "5th":                 ("5th Year", 1),
    "5":                   ("5th Year", 1),
    # ── JuCo ──────────────────────────────────────
    "juco":                ("JuCo",     2),
    "junior college":      ("JuCo",     2),
    "jc":                  ("JuCo",     2),
    # ── G League / Pro ────────────────────────────
    "g league":            ("G League", 4),
    "g-league":            ("G League", 4),
    "gleague":             ("G League", 4),
    "nba g league":        ("G League", 4),
    "overseas":            ("G League", 4),  # treat pro abroad same as G League
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run",       action="store_true", help="Print without writing")
    p.add_argument("--skip-unknowns", action="store_true", help="Don't print unrecognized year values")
    return p.parse_args()


def fetch_all_players(sb):
    """Page through the entire players table (service role bypasses RLS)."""
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        res = sb.table("players") \
                .select("id, name, year, eligibility_years") \
                .range(offset, offset + page_size - 1) \
                .execute()
        batch = res.data or []
        all_rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return all_rows


def main():
    args = parse_args()

    if not args.dry_run:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            sys.exit(
                "Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars, "
                "or pass --dry-run to preview without writing."
            )

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY) if not args.dry_run else None

    print("Fetching players…")
    if args.dry_run:
        # Can't query without creds in dry-run; load from a local snapshot if available
        print("[DRY-RUN] No DB connection — showing mapping table only.\n")
        print(f"{'Raw year value':<28}  {'→  Normalized':<14}  {'Elig. years'}")
        print("-" * 58)
        for raw, (label, elig) in sorted(YEAR_MAP.items()):
            print(f"  {raw:<26}  →  {label:<14}  {elig}")
        return

    players = fetch_all_players(sb)
    print(f"  {len(players)} players loaded.\n")

    updates      = []   # (id, year_label, eligibility_years)
    unknowns     = []   # (id, name, raw_year)
    already_set  = 0

    for p in players:
        raw = (p.get("year") or "").strip()
        key = raw.lower()

        if not key:
            # year is null — nothing to map
            continue

        if key in YEAR_MAP:
            label, elig = YEAR_MAP[key]
            # Skip if already correct (avoid unnecessary writes)
            if p.get("eligibility_years") == elig and p.get("year") == label:
                already_set += 1
                continue
            updates.append((p["id"], p["name"], raw, label, elig))
        else:
            unknowns.append((p["id"], p["name"], raw))

    # ── Report unknowns ────────────────────────────────────────────────────────
    if unknowns and not args.skip_unknowns:
        print(f"⚠  {len(unknowns)} player(s) with unrecognized year values:")
        for pid, name, raw in unknowns[:40]:
            print(f"    {name:<30}  year={repr(raw)}")
        if len(unknowns) > 40:
            print(f"    … and {len(unknowns) - 40} more")
        print()

    # ── Show planned changes ───────────────────────────────────────────────────
    print(f"  {already_set} players already correct — skipping.")
    print(f"  {len(updates)} players to update.\n")

    if not updates:
        print("Nothing to do.")
        return

    # Preview first 20
    print(f"{'Player':<32}  {'Old year':<16}  →  {'New year':<10}  Elig.")
    print("-" * 72)
    for _, name, old_raw, label, elig in updates[:20]:
        print(f"  {name:<30}  {old_raw:<16}  →  {label:<10}  {elig}")
    if len(updates) > 20:
        print(f"  … and {len(updates) - 20} more")
    print()

    # ── Write to DB ────────────────────────────────────────────────────────────
    confirm = input("Write these updates to Supabase? [y/N] ").strip().lower()
    if confirm != "y":
        print("Aborted.")
        return

    BATCH = 50
    written = 0
    errors  = 0
    for i in range(0, len(updates), BATCH):
        batch = updates[i : i + BATCH]
        for pid, name, old_raw, label, elig in batch:
            try:
                sb.table("players").update({
                    "year":              label,
                    "eligibility_years": elig,
                }).eq("id", pid).execute()
                written += 1
            except Exception as exc:
                print(f"  ERROR updating {name}: {exc}")
                errors += 1
        print(f"  {min(i + BATCH, len(updates))}/{len(updates)} done…", end="\r")

    print(f"\n✓ {written} players updated, {errors} errors.")

    if unknowns:
        print(
            f"\n{len(unknowns)} players still have unrecognized year values "
            "— edit them manually in the Admin → Players tab."
        )


if __name__ == "__main__":
    main()
