// ── teamLookup.js ─────────────────────────────────────────────────────────────
// One-stop helper for resolving a team's conference. Used to live as a raw
// `teamConferences[team]` lookup against a static JSON, which constantly
// missed because the JSON uses "Murray St." and vw_players uses "Murray State"
// (or "Murray State (2 Yrs)" when stale player metadata leaks through).
//
// The fix has two layers:
//   1. A `normalizeTeamName` pass that strips noise (trailing parens, periods,
//      whitespace, case) and collapses common abbreviations into a canonical
//      form ("Saint X" → "st x", "X State" → "x st").
//   2. A small `EXPLICIT_ALIASES` map for names normalization can't handle
//      cleanly (Loyola variants, Miami FL/OH disambiguation, etc.).
//
// Call `getTeamConference(name)` everywhere instead of indexing the JSON
// directly. The JSON itself stays untouched.

import teamConferences from "@/data/teamConferences.json";

// ── Normalization ────────────────────────────────────────────────────────────
function stripParenSuffix(s) {
  // "Murray State (2 Yrs)" → "Murray State"
  return s.replace(/\s*\([^)]*\)\s*$/, "");
}

export function normalizeTeamName(name) {
  if (!name) return "";
  let n = stripParenSuffix(String(name)).trim().toLowerCase();
  // "X State" → "X St" so it matches the JSON's "Murray St." form
  n = n.replace(/\bstate\b/g, "st");
  // "Saint Mary's" → "St Mary's"
  n = n.replace(/^saint\b/, "st");
  n = n.replace(/\bsaint\b/g, "st");
  // Drop periods and apostrophes; collapse extra whitespace
  n = n.replace(/[.']/g, "");
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

// ── Explicit aliases ─────────────────────────────────────────────────────────
// Map of (normalized variant) → (canonical normalized key that exists in JSON).
// These cover cases the regex normalizer can't resolve on its own — typically
// when the same school is referred to by two genuinely different strings.
const EXPLICIT_ALIASES = {
  // Loyola variants — three schools share the name
  "loyola chicago": "loyola (il)",
  "loyola il":      "loyola (il)",
  "loyola md":      "loyola (md)",
  "loyola maryland": "loyola (md)",
  "loyola marymount": "loyola marymount",
  // Miami variants
  "miami fl":       "miami (fl)",
  "miami florida":  "miami (fl)",
  "miami oh":       "miami (oh)",
  "miami ohio":     "miami (oh)",
  // Mount St. Mary's
  "mt st marys":    "mount st marys",
  "mount saint marys": "mount st marys",
  // BYU / Brigham Young
  "brigham young":  "byu",
  // Pittsburgh
  "pittsburgh":     "pitt",
  // North/South Carolina
  "north carolina state": "nc st",
  "n c state":      "nc st",
  // UNC
  "unc":            "north carolina",
  // UConn
  "uconn":          "connecticut",
  // SMU
  "southern methodist": "smu",
  // TCU
  "texas christian": "tcu",
  // UCF
  "central florida": "ucf",
  // USC
  "southern california": "usc",
  // UAB
  "alabama-birmingham": "uab",
  // UTEP / UTSA
  "texas el paso":  "utep",
  "texas-el paso":  "utep",
  "texas san antonio": "utsa",
  "texas-san antonio": "utsa",
  // FIU / FAU
  "florida international": "fiu",
  "florida atlantic":      "fau",
  // LIU
  "long island":    "liu",
  "long island u":  "liu",
};

// ── Pre-build the normalized index once ──────────────────────────────────────
const _index = {};
for (const [team, conf] of Object.entries(teamConferences)) {
  _index[normalizeTeamName(team)] = conf;
}

// ── Public lookup ────────────────────────────────────────────────────────────
export function getTeamConference(team) {
  if (!team) return null;
  // Exact-key fast path
  const exact = teamConferences[team];
  if (exact) return exact;
  // Normalized + alias-resolved lookup
  const norm  = normalizeTeamName(team);
  const alias = EXPLICIT_ALIASES[norm] ?? norm;
  return _index[alias] ?? null;
}

// For debugging in the console
export const _teamLookupInternals = { _index, EXPLICIT_ALIASES, normalizeTeamName };
