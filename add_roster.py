"""
add_roster.py — BBRef team roster page → append to players.txt
===============================================================
Scrapes all player URLs from a BBRef team roster page and appends
them to players.txt, skipping any URLs already in the file.

Usage:
    python add_roster.py https://www.sports-reference.com/cbb/schools/duke/men/2026.html
    python add_roster.py https://www.sports-reference.com/cbb/schools/duke/men/2026.html --players players.txt
"""

import argparse
import os
import re
import sys
import time

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Missing dependencies. Run:  pip install requests beautifulsoup4")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_roster(url):
    resp = requests.get(url, headers=HEADERS, timeout=30)
    if resp.status_code == 429:
        print("Rate-limited. Waiting 60s...")
        time.sleep(60)
        resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.text


def parse_player_urls(html):
    soup = BeautifulSoup(html, "html.parser")

    # Roster table has id="roster"
    table = soup.find("table", {"id": "roster"})
    if not table:
        sys.exit("Could not find roster table on that page. Make sure the URL is a BBRef team roster page.")

    urls = []
    for a in table.find_all("a", href=re.compile(r"/cbb/players/")):
        href = a["href"]
        if not href.startswith("http"):
            href = "https://www.sports-reference.com" + href
        # Strip any trailing query strings or fragments
        href = href.split("?")[0].split("#")[0]
        if href not in urls:
            urls.append(href)

    return urls


def load_existing(filepath):
    if not os.path.exists(filepath):
        return set()
    with open(filepath, "r", encoding="utf-8") as f:
        return {
            line.strip()
            for line in f
            if line.strip() and not line.startswith("#")
        }


def append_urls(filepath, new_urls, team_label):
    with open(filepath, "a", encoding="utf-8") as f:
        f.write(f"\n# {team_label}\n")
        for url in new_urls:
            f.write(url + "\n")


def parse_args():
    p = argparse.ArgumentParser(description="Append BBRef roster player URLs to players.txt")
    p.add_argument("roster_url", help="BBRef team roster URL, e.g. https://www.sports-reference.com/cbb/schools/duke/men/2026.html")
    p.add_argument("--players", default="players.txt", help="Path to players.txt (default: players.txt)")
    return p.parse_args()


def main():
    args = parse_args()

    # Extract a readable team label from the URL for the comment header
    # e.g. "duke/men/2026" → "Duke 2026"
    match = re.search(r"/cbb/schools/([^/]+)/\w+/(\d+)", args.roster_url)
    team_label = f"{match.group(1).replace('-', ' ').title()} {match.group(2)}" if match else args.roster_url

    print(f"\nFetching roster: {team_label}")
    print(f"  URL: {args.roster_url}")

    html      = fetch_roster(args.roster_url)
    all_urls  = parse_player_urls(html)
    existing  = load_existing(args.players)
    new_urls  = [u for u in all_urls if u not in existing]
    dupes     = len(all_urls) - len(new_urls)

    print(f"  Found {len(all_urls)} players on roster")
    if dupes:
        print(f"  Skipped {dupes} already in {args.players}")
    print(f"  Adding {len(new_urls)} new URLs to {args.players}")

    if new_urls:
        append_urls(args.players, new_urls, team_label)
        print(f"\n✓ Done! {args.players} updated.")
        print(f"  Run  python scraper.py  to fetch their stats.")
    else:
        print("\n  Nothing to add — all players already in players.txt.")


if __name__ == "__main__":
    main()
