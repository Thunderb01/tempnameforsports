"""
match_utils.py — Shared player + team name normalisation and fuzzy matching
===========================================================================
Import this in torvik_metrics.py, import_portal.py, and any future scripts
that need to match player or team names against Supabase.

Usage:
    from match_utils import norm_name, norm_team, match_player, MatchResult

    # Build lookup once
    lookup = {(norm_name(p["name"]), norm_team(p["current_team"])): p["id"]
              for p in players}

    # Match each incoming row
    result = match_player("Kevin Jr.", "San Diego St.", lookup)
    if result.player_id:
        print(f"Matched via {result.method} (score={result.score})")
    else:
        print("No match")
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Any

# ── Optional rapidfuzz speedup ────────────────────────────────────────────────
# pip install rapidfuzz  (10-100× faster than difflib for large datasets)
try:
    from rapidfuzz.distance import JaroWinkler
    from rapidfuzz import fuzz as _rfuzz
    def _fuzzy_ratio(a: str, b: str) -> float:
        return _rfuzz.token_sort_ratio(a, b)
    def _jaro(a: str, b: str) -> float:
        return JaroWinkler.similarity(a, b) * 100
    _HAS_RAPIDFUZZ = True
except ImportError:
    from difflib import SequenceMatcher
    def _fuzzy_ratio(a: str, b: str) -> float:
        a_s = " ".join(sorted(a.split()))
        b_s = " ".join(sorted(b.split()))
        return SequenceMatcher(None, a_s, b_s).ratio() * 100
    def _jaro(a: str, b: str) -> float:
        return SequenceMatcher(None, a, b).ratio() * 100
    _HAS_RAPIDFUZZ = False


# ── Name normalisation ────────────────────────────────────────────────────────

# Suffixes stripped before matching (with or without trailing period)
_SUFFIX_RE = re.compile(
    r"\b(jr\.?|sr\.?|ii|iii|iv|v|vi)\b\.?",
    re.IGNORECASE,
)

# Quoted/parenthetical nicknames: 'Hamed "Larry" Olayinka' → 'Hamed Olayinka'
_NICKNAME_RE = re.compile(r'\s*["\(].*?["\)]\s*')

def _strip_accents(s: str) -> str:
    """Convert accented characters to ASCII equivalents: José→Jose, Dũng→Dung."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )

def norm_name(s: str) -> str:
    """
    Canonical player name for matching.

    Handles:
      - Accent marks       (José → jose)
      - Suffixes           (Jr., II, III, IV → removed)
      - Quoted nicknames   ("Larry" → removed)
      - Punctuation        (O'Brien → obrien, St. John → st john)
      - Extra whitespace
    """
    s = _strip_accents(str(s or "").strip())
    s = _NICKNAME_RE.sub(" ", s)        # remove quoted nicknames
    s = _SUFFIX_RE.sub(" ", s)          # remove Jr./II/III etc.
    s = re.sub(r"[.\'\`\-]", " ", s)   # punctuation → space  (O'Brien, St.-something)
    s = re.sub(r"[^a-z0-9 ]", "", s.lower())  # strip anything else
    return re.sub(r"\s+", " ", s).strip()


# ── Team name normalisation ───────────────────────────────────────────────────

# Combined from torvik_metrics.py + update_team_espn.py + import_portal.py
# Key  = what external sources give you (lower-cased)
# Value = what Supabase stores (lower-cased)
TEAM_ALIASES: dict[str, str] = {
    # ── "St." → "State" expansions ──────────────────────────────────────────
    "alabama st.":               "alabama state",
    "alcorn st.":                "alcorn state",
    "appalachian st.":           "appalachian state",
    "arkansas st.":              "arkansas state",
    "arizona st.":               "arizona state",
    "ball st.":                  "ball state",
    "boise st.":                 "boise state",
    "chicago st.":               "chicago state",
    "cleveland st.":             "cleveland state",
    "colorado st.":              "colorado state",
    "coppin st.":                "coppin state",
    "east tennessee st.":        "east tennessee state",
    "florida st.":               "florida state",
    "fresno st.":                "fresno state",
    "georgia st.":               "georgia state",
    "grambling st.":             "grambling state",
    "idaho st.":                 "idaho state",
    "illinois st.":              "illinois state",
    "indiana st.":               "indiana state",
    "iowa st.":                  "iowa state",
    "jacksonville st.":          "jacksonville state",
    "kansas st.":                "kansas state",
    "kent st.":                  "kent state",
    "long beach st.":            "long beach state",
    "michigan st.":              "michigan state",
    "mississippi st.":           "mississippi state",
    "missouri st.":              "missouri state",
    "montana st.":               "montana state",
    "morehead st.":              "morehead state",
    "morgan st.":                "morgan state",
    "murray st.":                "murray state",
    "new mexico st.":            "new mexico state",
    "nicholls st.":              "nicholls state",
    "norfolk st.":               "norfolk state",
    "north dakota st.":          "north dakota state",
    "ohio st.":                  "ohio state",
    "oklahoma st.":              "oklahoma state",
    "oregon st.":                "oregon state",
    "penn st.":                  "penn state",
    "sacramento st.":            "sacramento state",
    "sam houston st.":           "sam houston",
    "san diego st.":             "san diego state",
    "san jose st.":              "san jose state",
    "south dakota st.":          "south dakota state",
    "tarleton st.":              "tarleton state",
    "tennessee st.":             "tennessee state",
    "texas st.":                 "texas state",
    "utah st.":                  "utah state",
    "washington st.":            "washington state",
    "weber st.":                 "weber state",
    "wichita st.":               "wichita state",
    # ── Reverse: "State" in DB but abbreviated externally ───────────────────
    "jackson state":             "jackson st.",
    "kennesaw state":            "kennesaw st.",
    "mississippi valley state":  "mississippi valley st.",
    "central connecticut":       "central connecticut st.",
    # ── Common abbreviations / alternate names ───────────────────────────────
    "uconn":                     "connecticut",
    "connecticut":               "uconn",         # bidirectional - resolved by first match
    "unc":                       "north carolina",
    "pitt":                      "pittsburgh",
    "wku":                       "western kentucky",
    "wvu":                       "west virginia",
    "n.c. state":                "nc state",
    "mississippi":               "ole miss",
    "illinois chicago":          "uic",
    "mcneese st.":               "mcneese",
    "little rock":               "little rock",
    "siue":                      "siu edwardsville",
    "siu edwardsville":          "siue",
    "siu":                       "southern illinois",
    "umass lowell":              "umass lowell",
    "nebraska omaha":            "nebraska omaha",
    "ut arlington":              "ut arlington",
    "fgcu":                      "florida gulf coast",
    "miami fl":                  "miami",
    "miami oh":                  "miami (oh)",
    "louisiana monroe":          "louisiana monroe",
    "cal state fullerton":       "cal st. fullerton",
    "cal state northridge":      "cal st. northridge",
    "cal state bakersfield":     "cal st. bakersfield",
    "umkc":                      "kansas city",
    "vmi":                       "vmi",
    "unc asheville":             "unc asheville",
    "unc greensboro":            "unc greensboro",
    "unc wilmington":            "unc wilmington",
    "smu":                       "smu",
    "byu":                       "byu",
    "vcu":                       "vcu",
    "tcu":                       "tcu",
    "uab":                       "uab",
    "utsa":                      "utsa",
    "utep":                      "utep",
    "usc":                       "usc",
    "ucf":                       "ucf",
    "fiu":                       "fiu",
    "lsu":                       "lsu",
    "sfa":                       "stephen f. austin",
    "texas a&m":                 "texas a&m",
    # ── University suffix stripping (external sources include full name) ──────
    "san diego state university": "san diego state",
    "gonzaga university":         "gonzaga",
    "duke university":            "duke",
    "university of connecticut":  "uconn",
    "university of north carolina": "north carolina",
    # ── ESPN / CBD API specific ───────────────────────────────────────────────
    "app state":                 "appalachian state",
    "hawai'i":                   "hawaii",
    "ualbany":                   "albany",
    "siu-edwardsville":          "siu edwardsville",
    "long island university":    "liu",
    "incarnate word":            "uiw",
    "california baptist":        "cal baptist",
    "texas a&m-corpus christi":  "texas a&m-cc",
    "southeast missouri":        "southeast missouri state",
    "kansas city":               "umkc",
    "cal state fullerton":       "cal st. fullerton",
    "cal state bakersfield":     "cal st. bakersfield",
    "cal state northridge":      "cal st. northridge",
    "florida international":     "fiu",
    "south florida":             "usf",
    "purdue fort wayne":         "pfw",
    "ulm":                       "louisiana monroe",
    "tennessee-martin":          "ut martin",
    "sam houston state":         "sam houston",
    "st. thomas-minnesota":      "st. thomas",
    "st. thomas (mn)":           "st. thomas",
    "st. john's (ny)":           "st. john's",
    "san josé state":            "san jose state",
}

# Pattern-based normalisation applied AFTER alias lookup (order matters)
_TEAM_PATTERNS = [
    # "university" suffix/prefix noise
    (re.compile(r"\buniversity\b",    re.I), ""),
    (re.compile(r"\buniv\b\.?",       re.I), ""),
    (re.compile(r"\bcollege\b",       re.I), ""),
    # Clean up trailing/leading noise
    (re.compile(r"\bthe\b",           re.I), ""),
    (re.compile(r"[()]",                  0), ""),
]

def norm_team(s: str) -> str:
    """
    Canonical team name for matching.

    Handles:
      - Known aliases       (San Diego St. → san diego state)
      - University suffixes (San Diego State University → san diego state)
      - Accent marks        (San José → san jose)
      - Extra punctuation
    """
    s = _strip_accents(str(s or "").strip())
    n = re.sub(r"\s+", " ", s.lower()).strip()

    # Check alias dict first (exact key match)
    if n in TEAM_ALIASES:
        return TEAM_ALIASES[n]

    # Apply pattern cleanup
    for pattern, repl in _TEAM_PATTERNS:
        n = pattern.sub(repl, n)
    n = re.sub(r"\s+", " ", n).strip()

    # Re-check alias after cleanup (e.g. "University of Connecticut" → "connecticut")
    return TEAM_ALIASES.get(n, n)


# ── Match result ──────────────────────────────────────────────────────────────

@dataclass
class MatchResult:
    player_id: Any          # value from lookup dict, or None
    method: str | None      # "exact" | "name_only" | "fuzzy(NN)" | "last_name" | None
    score: float            # 0–100; 100 = exact


# ── Core matching function ────────────────────────────────────────────────────

def match_player(
    name: str,
    team: str,
    lookup: dict[tuple[str, str], Any],
    threshold: float = 88,
    allow_cross_team: bool = False,
) -> MatchResult:
    """
    Match a (name, team) pair against a lookup dict built from norm_name/norm_team.

    lookup should be:
        { (norm_name(p["name"]), norm_team(p["team"])): player_id, ... }

    Matching order:
      1. exact         — norm_name + norm_team both match
      2. name_only     — norm_name matches exactly, team differs (only if unique)
      3. fuzzy_same_team — fuzzy name match within same normalised team (score ≥ threshold)
      4. last_name     — last token of name matches exactly, same team (only if unique)
      5. fuzzy_cross   — fuzzy name match across ALL teams (score ≥ threshold+5, only if
                         allow_cross_team=True and unique result)

    Returns MatchResult(player_id, method, score).
    """
    n = norm_name(name)
    t = norm_team(team)

    # 1. Exact
    if (n, t) in lookup:
        return MatchResult(lookup[(n, t)], "exact", 100.0)

    # 2. Exact name, any team (handles team-name mismatches when player is unique by name)
    name_hits = {k: v for k, v in lookup.items() if k[0] == n}
    if len(name_hits) == 1:
        return MatchResult(next(iter(name_hits.values())), "name_only", 100.0)

    # 3. Fuzzy name within same team
    same_team = {k: v for k, v in lookup.items() if k[1] == t}
    best_score, best_id, best_key = 0.0, None, None
    for (ln, _), lid in same_team.items():
        score = _fuzzy_ratio(n, ln)
        if score > best_score:
            best_score, best_id, best_key = score, lid, ln
    if best_score >= threshold:
        return MatchResult(best_id, f"fuzzy({round(best_score)})", best_score)

    # 4. Last-name match within same team (handles "John Smith Jr." → "John Smith")
    last = n.split()[-1] if n else ""
    if last:
        last_hits = [(k, v) for k, v in same_team.items() if k[0].split()[-1] == last]
        if len(last_hits) == 1:
            return MatchResult(last_hits[0][1], "last_name", 90.0)

    # 5. Fuzzy across ALL teams (opt-in, high threshold, must be unique)
    if allow_cross_team:
        all_best: list[tuple[float, Any]] = []
        for (ln, _), lid in lookup.items():
            score = _fuzzy_ratio(n, ln)
            if score >= threshold + 5:
                all_best.append((score, lid))
        all_best.sort(reverse=True)
        if len(all_best) == 1 or (len(all_best) > 1 and all_best[0][0] > all_best[1][0] + 5):
            return MatchResult(all_best[0][1], f"fuzzy_cross({round(all_best[0][0])})", all_best[0][0])

    return MatchResult(None, None, 0.0)


# ── Convenience: build lookup from a list of player dicts ────────────────────

def build_lookup(
    players: list[dict],
    name_key: str = "name",
    team_key: str = "current_team",
    id_key:   str = "id",
) -> dict[tuple[str, str], Any]:
    """
    Build a (norm_name, norm_team) → id lookup from a list of player dicts.
    Duplicate keys (same normalised name+team) keep the last entry.
    """
    return {
        (norm_name(p[name_key]), norm_team(p.get(team_key) or "")): p[id_key]
        for p in players
        if p.get(name_key)
    }


# ── Quick CLI diagnostic ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    print("match_utils.py — quick sanity check")
    print(f"  rapidfuzz available: {_HAS_RAPIDFUZZ}")

    tests_name = [
        ("Kevin Porter Jr.",   "kevin porter"),
        ("José Alvarado",      "jose alvarado"),
        ("Scottie Barnes II",  "scottie barnes"),
        ("O'Connell, Sean",    "oconnell sean"),
        ("Dũng Nguyễn",        "dung nguyen"),
        ('Hamed "Larry" Sulaimon', "hamed sulaimon"),
        ("St. John Smith",     "st john smith"),
    ]
    print("\nnorm_name tests:")
    for raw, expected in tests_name:
        result = norm_name(raw)
        status = "✓" if result == expected else f"✗ (got {result!r})"
        print(f"  {raw!r:35s} → {result!r:25s}  {status}")

    tests_team = [
        ("San Diego St.",             "san diego state"),
        ("San Diego State University","san diego state"),
        ("UConn",                     "connecticut"),
        ("Hawai'i",                   "hawaii"),
        ("App State",                 "appalachian state"),
        ("SIU-Edwardsville",          "siu edwardsville"),
        ("San José State",            "san jose state"),
    ]
    print("\nnorm_team tests:")
    for raw, expected in tests_team:
        result = norm_team(raw)
        status = "✓" if result == expected else f"✗ (got {result!r})"
        print(f"  {raw!r:35s} → {result!r:25s}  {status}")

    # Fuzzy matching demo
    fake_lookup = build_lookup([
        {"id": 1, "name": "Kevin Porter",        "current_team": "Houston"},
        {"id": 2, "name": "Jose Alvarado",        "current_team": "Georgia Tech"},
        {"id": 3, "name": "Scottie Barnes",       "current_team": "Florida State"},
        {"id": 4, "name": "Mike O'Connell",       "current_team": "Iowa"},
    ])
    tests_match = [
        ("Kevin Porter Jr.",     "Houston",       1),
        ("José Alvarado",        "Georgia Tech",  2),
        ("Scottie Barnes III",   "Florida St.",   3),
        ("Mike OConnell",        "Iowa",          4),
    ]
    print("\nmatch_player tests:")
    for name, team, expected_id in tests_match:
        r = match_player(name, team, fake_lookup)
        status = "✓" if r.player_id == expected_id else f"✗ (got {r.player_id})"
        print(f"  {name!r:30s} @ {team!r:15s} → id={r.player_id} via {r.method}  {status}")
