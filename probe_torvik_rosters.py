"""
probe_torvik_rosters.py — One-off probe of Bart Torvik's next-season roster
pages, to learn their actual response format (CSV vs HTML, column names,
Cloudflare challenge or not) before building a real importer against them.

Not meant to be kept long-term — delete once the real importer is built
and its assumptions are locked in from this probe's output.
"""
import datetime
import sys

try:
    import requests
except ImportError:
    sys.exit("Run: pip install requests")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
}

_now = datetime.date.today()
YEAR = _now.year if _now.month >= 7 else _now.year - 1  # "allrosters26" = 2026-27 season

CANDIDATES = [
    f"https://barttorvik.com/allrosters{YEAR % 100}.php?csv=1",
    f"https://barttorvik.com/allrosters{YEAR % 100}.php",
    f"https://barttorvik.com/trankpre.php?csv=1",
    f"https://barttorvik.com/trankpre.php",
    f"https://barttorvik.com/rostercast.php?team=Duke&year={YEAR}&csv=1",
    f"https://barttorvik.com/rostercast.php?team=Duke&year={YEAR}",
]

for url in CANDIDATES:
    print("=" * 80)
    print("GET", url)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        print("status:", resp.status_code)
        print("content-type:", resp.headers.get("content-type"))
        print("length:", len(resp.text))
        body = resp.text
        lowered = body[:2000].lower()
        if "verifying" in lowered or "cf-browser-verification" in lowered or "cloudflare" in lowered:
            print("!! Looks like a Cloudflare/bot-check page, not real data.")
        print("--- first 1500 chars ---")
        print(body[:1500])
    except Exception as e:
        print("ERROR:", e)
    print()
