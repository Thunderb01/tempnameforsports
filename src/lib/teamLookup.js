// ── teamLookup.js ─────────────────────────────────────────────────────────────
// SINGLE source of truth for every team: data/team_conferences.csv
//
//   team,conference,aliases
//   Connecticut,BE,UConn
//   McNeese,Slnd,McNeese State|McNeese St.
//   Miami,ACC,Miami FL|Miami (FL)|Miami Florida
//   Miami (OH),MAC,Miami OH|Miami Ohio
//
// Each row defines ONE school by its canonical name (the "team" column,
// matching what's stored in vw_players.current_team), its conference, and a
// pipe-separated list of alias spellings that should all resolve to the same
// school. To add a team, fix a conference, or add a new alias, edit that
// CSV row — nothing else in the codebase needs to change.
//
// On module load this file:
//   1. Parses the CSV.
//   2. Builds an index mapping every variant (canonical AND each alias),
//      after running it through the spelling-normalizer, to the canonical
//      team name + conference.
//
// Three public functions read off that index:
//   - getTeamConference(team)    → conference code or null
//   - getCanonicalTeamName(team) → canonical team name (falls back to input)
//   - ALL_TEAMS                  → sorted array of canonical team names
//
// The CSV-driven design replaces the hand-maintained EXPLICIT_ALIASES map
// that used to live in this file. New aliases now go in the CSV alongside
// the team they belong to, so it's impossible to add an alias that points
// at a non-existent team.

import csvText from "@data/team_conferences.csv?raw";

// ── Normalization ────────────────────────────────────────────────────────────
// Strip stale "(N Yrs)" / "(N Years)" markers leaked from player metadata,
// e.g. "Murray State (2 Yrs)". Intentionally LEAVES disambiguating tags like
// "(OH)" / "(IL)" / "(MD)" alone — those are part of the canonical name.
function stripParenSuffix(s) {
  return s.replace(/\s*\(\s*\d+\s*(?:yrs?|years?)\s*\)\s*$/i, "");
}

export function normalizeTeamName(name) {
  if (!name) return "";
  let n = stripParenSuffix(String(name)).trim().toLowerCase();
  // "X State" → "x st" so Torvik-style and DB-style names normalize together
  n = n.replace(/\bstate\b/g, "st");
  // "Saint Mary's" → "st mary's"
  n = n.replace(/^saint\b/, "st").replace(/\bsaint\b/g, "st");
  // Drop periods and apostrophes; collapse whitespace
  n = n.replace(/[.']/g, "").replace(/\s+/g, " ").trim();
  return n;
}

// ── Parse CSV ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {  // skip header
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    // 3 columns: team, conference, aliases. Aliases is the only field that
    // could (in principle) contain a comma, but ours uses `|` to separate,
    // so a plain split is fine. Defensive: take the first two commas as
    // field boundaries and treat everything after as the aliases blob.
    const i1 = raw.indexOf(",");
    const i2 = raw.indexOf(",", i1 + 1);
    if (i1 < 0 || i2 < 0) continue;
    const team    = raw.slice(0, i1).trim();
    const conf    = raw.slice(i1 + 1, i2).trim();
    const aliases = raw.slice(i2 + 1).trim();
    if (!team) continue;
    const aliasList = aliases ? aliases.split("|").map(s => s.trim()).filter(Boolean) : [];
    rows.push({ team, conf, aliases: aliasList });
  }
  return rows;
}

// ── Build the lookup index ───────────────────────────────────────────────────
// Every variant (canonical + each alias), once normalized, maps to a single
// { canonical, conf } record. The same variant pointing at two canonicals is
// a data bug; we log it and last-write-wins so something still resolves.
const _byNorm = {};
const _canonicalConfs = {};
const _canonicalSet = new Set();

const _rows = parseCSV(csvText);
for (const { team, conf, aliases } of _rows) {
  _canonicalSet.add(team);
  if (conf) _canonicalConfs[team] = conf;
  const variants = [team, ...aliases];
  for (const v of variants) {
    const norm = normalizeTeamName(v);
    if (!norm) continue;
    if (norm in _byNorm && _byNorm[norm].canonical !== team) {
      if (typeof console !== "undefined") {
        console.warn(`[teamLookup] alias collision on "${v}" (normalized "${norm}"): ${_byNorm[norm].canonical} ↔ ${team}. Last definition wins.`);
      }
    }
    _byNorm[norm] = { canonical: team, conf };
  }
}

// ── Public lookups ───────────────────────────────────────────────────────────

function _resolve(team) {
  if (!team) return null;
  // Exact-canonical fast path
  if (_canonicalSet.has(team)) {
    return { canonical: team, conf: _canonicalConfs[team] ?? null };
  }
  // Normalized lookup (covers canonical + every alias)
  const norm = normalizeTeamName(team);
  if (norm in _byNorm) return _byNorm[norm];
  // Last-ditch: try the " st" suffix for bare-form strings like "Boise" when
  // the canonical is "Boise State". Safe because if the bare form already
  // exists as its own school (e.g. "Idaho"), the lookups above caught it.
  const withSt = `${norm} st`;
  if (withSt in _byNorm) return _byNorm[withSt];
  return null;
}

export function getTeamConference(team) {
  return _resolve(team)?.conf ?? null;
}

export function getCanonicalTeamName(team) {
  if (!team) return team;
  return _resolve(team)?.canonical ?? team;
}

// Sorted list of every canonical CSV team — drives the team-selector
// dropdown in useAdminTeam. Re-derived on every page load from the CSV,
// so any edit flows through here automatically.
export const ALL_TEAMS = [..._canonicalSet].sort((a, b) =>
  a.localeCompare(b, "en", { sensitivity: "base" })
);

// For debugging in the browser console
export const _teamLookupInternals = { _byNorm, _canonicalConfs, normalizeTeamName };
