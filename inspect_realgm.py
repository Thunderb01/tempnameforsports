"""
inspect_realgm.py — fetch one RealGM URL and dump everything useful for debugging
==================================================================================
Uses the same curl_cffi Chrome-impersonation as realgm_league_scraper.py so it
gets past RealGM's bot block.

Usage:
    python inspect_realgm.py https://basketball.realgm.com/player/Maidy-Douglas/International/205813
    python inspect_realgm.py <url> --save inspect.html

Prints:
  - All <a> hrefs whose text or href hints at splits/wins/losses/by result
  - Every <table> on the page: caption, headers, first row sample, first cell of each row
"""

import argparse
import sys
import time
from curl_cffi import requests as curl_requests
from bs4 import BeautifulSoup

session = curl_requests.Session(impersonate="chrome124")


def fetch(url):
    print(f"GET {url}")
    # warm up first to set cookies, mirrors realgm_league_scraper behaviour
    session.get("https://basketball.realgm.com", timeout=15)
    time.sleep(1.5)
    r = session.get(url, timeout=15)
    print(f"  HTTP {r.status_code}, {len(r.text)} bytes")
    r.raise_for_status()
    return BeautifulSoup(r.text, "lxml")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--save", default=None, help="Save raw HTML to this path")
    args = p.parse_args()

    soup = fetch(args.url)

    if args.save:
        with open(args.save, "w", encoding="utf-8") as f:
            f.write(soup.prettify())
        print(f"  Saved HTML to {args.save}")

    print("\n── Interesting links (Splits / Wins / Losses / Result) ───────────────")
    keywords = ("splits", "wins", "losses", "result", "by_result", "above", "below")
    found = 0
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if any(k in href.lower() or k in text.lower() for k in keywords):
            print(f"  • [{text or '(no text)'}] → {href}")
            found += 1
    if found == 0:
        print("  (none)")

    print("\n── Tables on this page ────────────────────────────────────────────────")
    tables = soup.find_all("table")
    if not tables:
        print("  (no tables)")
        return

    for i, t in enumerate(tables, 1):
        cap = t.find("caption")
        thead = t.find("thead")
        title_attr = t.get("data-table-title") or t.get("title") or t.get("id") or ""
        # Look for the closest preceding heading for context
        prev_h = None
        for tag in t.find_all_previous(["h1", "h2", "h3", "h4", "h5"]):
            prev_h = tag.get_text(strip=True)
            break

        headers = [th.get_text(strip=True) for th in (thead.select("th") if thead else [])]
        rows = t.select("tbody tr")
        first_cell_per_row = [tr.find("td").get_text(strip=True) if tr.find("td") else "" for tr in rows[:6]]

        print(f"\n  Table {i}:")
        if prev_h: print(f"    preceding heading: {prev_h!r}")
        if cap:    print(f"    caption: {cap.get_text(strip=True)!r}")
        if title_attr: print(f"    title/id attr: {title_attr!r}")
        print(f"    headers ({len(headers)}): {headers}")
        print(f"    {len(rows)} body row(s):")
        for ri, tr in enumerate(rows):
            tds = tr.find_all("td")
            first  = tds[0].get_text(strip=True) if len(tds) > 0 else ""
            second = tds[1].get_text(strip=True) if len(tds) > 1 else ""
            print(f"      {ri+1:>2}. [{first}] · [{second}]")

if __name__ == "__main__":
    main()
