"""
fix_encoding.py — Fix mojibake player names in Supabase
========================================================
Fetches all players, detects names with encoding issues, fixes them,
and writes them back.

Usage:
    python fix_encoding.py
    python fix_encoding.py --dry-run
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


def fix(s):
    """Try to fix a mojibake string (latin-1 bytes decoded as utf-8 or vice versa)."""
    if not s:
        return s
    # Case 1: stored as latin-1 bytes in utf-8 column (e.g. ö stored as 0xf6)
    # Try encoding as latin-1 then decoding as utf-8
    try:
        fixed = s.encode("latin-1").decode("utf-8")
        if fixed != s:
            return fixed
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    # Case 2: utf-8 bytes interpreted as latin-1 (e.g. ö becomes Ã¶)
    try:
        fixed = s.encode("utf-8").decode("latin-1").encode("latin-1").decode("utf-8")
        if fixed != s:
            return fixed
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return s


def needs_fix(s):
    if not s:
        return False
    try:
        fixed = fix(s)
        return fixed != s
    except Exception:
        return False


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.")

    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Fetch all players (paginate past the 1000-row default limit)
    rows = []
    page = 0
    page_size = 1000
    while True:
        res = db.table("players").select("id, name") \
                .range(page * page_size, (page + 1) * page_size - 1) \
                .execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    print(f"Fetched {len(rows)} players\n")

    to_fix = [(r["id"], r["name"], fix(r["name"])) for r in rows if needs_fix(r["name"])]

    if not to_fix:
        print("No encoding issues found.")
        return

    print(f"Found {len(to_fix)} names to fix:\n")
    for pid, original, fixed in to_fix:
        print(f"  {original!r}  →  {fixed!r}")

    if args.dry_run:
        print("\n(dry-run) No changes written.")
        return

    print()
    ok = fail = 0
    for pid, original, fixed in to_fix:
        try:
            db.table("players").update({"name": fixed}).eq("id", pid).execute()
            print(f"  ✓ {original!r} → {fixed!r}")
            ok += 1
        except Exception as e:
            print(f"  ✗ {original!r}: {e}")
            fail += 1

    print(f"\nDone: {ok} fixed, {fail} failed")


if __name__ == "__main__":
    main()
