"""
backfill_player_status.py — Set player_status for every rostered player
========================================================================
Logic (same priority order as useRosterBoard.js):
  1. Player appears in portal_transfers (season >= 2026)  → "transferring"
  2. eligibility_years == 1, OR year label is graduating  → "graduating"
  3. Has a current_team and none of the above             → "returning"
  Skips: no current_team, already has a status (unless --overwrite)

Usage:
    python backfill_player_status.py --dry-run     (preview, no writes)
    python backfill_player_status.py               (write to DB)
    python backfill_player_status.py --overwrite   (re-compute already-set)

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

GRADUATING_LABELS = {
    "Sr", "SR", "RS Sr", "RS SR", "Grad", "GR", "Graduate",
    "Senior", "RS Senior", "Graduate Student", "5th Year",
}

PORTAL_SEASON_MIN = 2026


# ── Helpers ────────────────────────────────────────────────────────────────────
def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run",   action="store_true")
    p.add_argument("--overwrite", action="store_true", help="Re-compute even if status already set")
    return p.parse_args()


def paginate(sb, table, select, **filters):
    rows, page_size, offset = [], 1000, 0
    while True:
        q = sb.table(table).select(select)
        for col, val in filters.items():
            q = q.eq(col, val)
        res = q.range(offset, offset + page_size - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def fetch_players(sb):
    # Metrics / year on vw_players; player_status / eligibility_years on players
    rows, page_size, offset = [], 1000, 0
    while True:
        res = (sb.table("vw_players")
               .select("id, name, current_team, year")
               .range(offset, offset + page_size - 1)
               .execute())
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    # Merge eligibility_years + player_status from players table
    extra_rows, offset = [], 0
    while True:
        res = (sb.table("players")
               .select("id, eligibility_years, player_status")
               .range(offset, offset + page_size - 1)
               .execute())
        batch = res.data or []
        extra_rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    extra_map = {r["id"]: r for r in extra_rows}
    for r in rows:
        extra = extra_map.get(r["id"], {})
        r["eligibility_years"] = extra.get("eligibility_years")
        r["player_status"]     = extra.get("player_status")
    return rows


def fetch_portal_ids(sb):
    rows, page_size, offset = [], 1000, 0
    while True:
        res = (sb.table("portal_transfers")
               .select("player_id")
               .gte("season_year", PORTAL_SEASON_MIN)
               .range(offset, offset + page_size - 1)
               .execute())
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return {r["player_id"] for r in rows if r.get("player_id")}


def classify_status(player, portal_ids):
    if player["id"] in portal_ids:
        return "transferring"
    elig = player.get("eligibility_years")
    year = (player.get("year") or "").strip()
    if elig == 1 or year in GRADUATING_LABELS:
        return "graduating"
    if player.get("current_team"):
        return "returning"
    return None  # no team → skip


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    args = parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    print("Fetching players…")
    players = fetch_players(sb)
    print(f"  {len(players)} players loaded.")

    print("Fetching portal transfers…")
    portal_ids = fetch_portal_ids(sb)
    print(f"  {len(portal_ids)} players in portal (season >= {PORTAL_SEASON_MIN}).\n")

    updates    = []   # (id, name, old_status, new_status)
    skipped    = 0
    no_team    = []

    for p in players:
        old = p.get("player_status")
        if old and not args.overwrite:
            skipped += 1
            continue

        new = classify_status(p, portal_ids)
        if new is None:
            no_team.append(p.get("name", p["id"]))
            continue

        if new != old:
            updates.append((p["id"], p.get("name", ""), old, new))

    # ── Report ────────────────────────────────────────────────────────────────
    print(f"  {skipped} already have a status — skipping (use --overwrite to redo).")
    if no_team:
        print(f"  {len(no_team)} players have no team — skipping:")
        for name in no_team[:10]:
            print(f"    {name}")
        if len(no_team) > 10:
            print(f"    … and {len(no_team) - 10} more")
    print(f"\n  {len(updates)} players to update.\n")

    if not updates:
        print("Nothing to do.")
        return

    # ── Distribution preview ──────────────────────────────────────────────────
    from collections import Counter
    dist = Counter(new for _, _, _, new in updates)
    print("Status distribution:")
    for status, count in sorted(dist.items(), key=lambda x: -x[1]):
        print(f"  {count:>4}  {status}")
    print()

    print(f"{'Player':<32}  {'Old':<14}  →  New")
    print("-" * 64)
    for _, name, old, new in updates[:25]:
        old_str = old or "(none)"
        print(f"  {name:<30}  {old_str:<14}  →  {new}")
    if len(updates) > 25:
        print(f"  … and {len(updates) - 25} more")
    print()

    if args.dry_run:
        print("[DRY-RUN] No changes written.")
        return

    confirm = input("Write to Supabase? [y/N] ").strip().lower()
    if confirm != "y":
        print("Aborted.")
        return

    BATCH, written, errors = 50, 0, 0
    for i in range(0, len(updates), BATCH):
        for pid, name, _, new in updates[i : i + BATCH]:
            try:
                sb.table("players").update({"player_status": new}).eq("id", pid).execute()
                written += 1
            except Exception as exc:
                print(f"  ERROR {name}: {exc}")
                errors += 1
        print(f"  {min(i + BATCH, len(updates))}/{len(updates)} done…", end="\r")

    print(f"\n✓ {written} players updated, {errors} errors.")


if __name__ == "__main__":
    main()
