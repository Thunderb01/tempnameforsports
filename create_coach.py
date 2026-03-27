"""
create_coach.py — Create coach accounts in Supabase
=====================================================
Creates a user in Supabase Auth and inserts their profile row in the
`coaches` table. Run this whenever you onboard a new program.

Setup:
    pip install supabase

Usage:
    # Single coach
    python create_coach.py --email "coach@rutgers.edu" --team "Rutgers" --name "Coach Smith"

    # Bulk from a CSV file (columns: email, team, name)
    python create_coach.py --csv coaches_to_add.csv

    # List all existing coaches
    python create_coach.py --list

Environment variables (set these before running):
    export SUPABASE_URL="https://xxxxxxxxxxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="your-service-role-key"

The service role key is in: Supabase dashboard → Settings → API → service_role
KEEP THIS KEY PRIVATE — it bypasses row-level security. Never commit it.
"""

import argparse
import csv
import os
import sys

try:
    from supabase import create_client
except ImportError:
    sys.exit("Missing dependency. Run:  pip install supabase")

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    sys.exit(
        "Missing environment variables.\n"
        "Set SUPABASE_URL and SUPABASE_SERVICE_KEY before running:\n\n"
        "  export SUPABASE_URL='https://xxxx.supabase.co'\n"
        "  export SUPABASE_SERVICE_KEY='your-service-role-key'\n"
    )

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ── Core functions ─────────────────────────────────────────────────────────────

def create_coach(email, team, name="", role="coach", send_invite=True):
    """
    Create a Supabase auth user and insert a coaches table row.
    Returns the user ID on success.
    """
    email = email.strip().lower()
    team  = team.strip()
    name  = name.strip()

    # Create the auth user (invite sends them an email to set their password)
    if send_invite:
        res = supabase.auth.admin.invite_user_by_email(email)
    else:
        # Create without sending email (useful for testing)
        res = supabase.auth.admin.create_user({
            "email":            email,
            "email_confirm":    True,
            "password":         "ChangeMe123!",  # they'll reset via forgot password
        })

    user_id = res.user.id

    # Insert coaches profile row
    supabase.table("coaches").insert({
        "user_id":      user_id,
        "team":         team,
        "display_name": name,
        "role":         role,
    }).execute()

    return user_id


def list_coaches():
    """Print all coaches from the coaches table."""
    res = supabase.table("coaches").select("*").order("team").execute()
    rows = res.data or []

    if not rows:
        print("No coaches found.")
        return

    print(f"\n{'Team':<25} {'Name':<25} {'Role':<10} {'User ID'}")
    print("-" * 80)
    for r in rows:
        print(f"{r.get('team',''):<25} {r.get('display_name',''):<25} {r.get('role',''):<10} {r.get('user_id','')}")
    print(f"\n{len(rows)} total coaches")


def delete_coach(email):
    """Remove a coach by email — deletes auth user + profile row."""
    # Find user by email
    res = supabase.auth.admin.list_users()
    user = next((u for u in res if u.email == email.lower().strip()), None)
    if not user:
        print(f"No user found with email: {email}")
        return

    # Delete from coaches table (cascade also handles it, but be explicit)
    supabase.table("coaches").delete().eq("user_id", user.id).execute()

    # Delete auth user
    supabase.auth.admin.delete_user(user.id)
    print(f"✓ Deleted coach: {email}")


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Manage Beyond the Portal coach accounts")
    sub = p.add_subparsers(dest="cmd")

    # create (default action when --email is passed without subcommand)
    p.add_argument("--email",  help="Coach email address")
    p.add_argument("--team",   help="Team name (must match all_rosters.csv exactly)")
    p.add_argument("--name",   default="", help="Coach display name")
    p.add_argument("--role",   default="coach", choices=["coach", "admin"])
    p.add_argument("--no-invite", action="store_true",
                   help="Create account without sending invite email (sets temp password)")

    p.add_argument("--csv",    help="Bulk create from CSV file (columns: email, team, name)")
    p.add_argument("--list",   action="store_true", help="List all coaches")
    p.add_argument("--delete", metavar="EMAIL", help="Delete a coach by email")

    return p.parse_args()


def main():
    args = parse_args()

    if args.list:
        list_coaches()
        return

    if args.delete:
        delete_coach(args.delete)
        return

    if args.csv:
        if not os.path.exists(args.csv):
            sys.exit(f"CSV file not found: {args.csv}")
        with open(args.csv, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows   = list(reader)

        if not rows:
            sys.exit("CSV is empty.")

        print(f"Creating {len(rows)} coach accounts...\n")
        ok, fail = 0, 0
        for row in rows:
            email = row.get("email", "").strip()
            team  = row.get("team",  "").strip()
            name  = row.get("name",  "").strip()

            if not email or not team:
                print(f"  ⚠  Skipping row with missing email or team: {row}")
                fail += 1
                continue

            try:
                uid = create_coach(email, team, name, send_invite=not args.no_invite)
                print(f"  ✓ {email:<40} → {team}  (uid: {uid})")
                ok += 1
            except Exception as e:
                print(f"  ✗ {email}: {e}")
                fail += 1

        print(f"\nDone: {ok} created, {fail} failed")
        return

    # Single coach
    if not args.email or not args.team:
        print("Usage: python create_coach.py --email EMAIL --team TEAM [--name NAME]\n")
        print("       python create_coach.py --list")
        print("       python create_coach.py --delete EMAIL")
        print("       python create_coach.py --csv coaches.csv")
        sys.exit(1)

    try:
        uid = create_coach(
            args.email, args.team, args.name,
            role=args.role,
            send_invite=not args.no_invite,
        )
        print(f"\n✓ Created coach account")
        print(f"  Email : {args.email}")
        print(f"  Team  : {args.team}")
        print(f"  UID   : {uid}")
        if args.no_invite:
            print(f"\n  Temporary password: ChangeMe123!")
            print(f"  Ask the coach to reset it via 'Forgot password?' on login.")
        else:
            print(f"\n  Invite email sent — coach will set their password via the link.")
    except Exception as e:
        sys.exit(f"✗ Failed to create coach: {e}")


if __name__ == "__main__":
    main()
