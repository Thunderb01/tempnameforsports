// ─────────────────────────────────────────────────────────────────────────────
// Archetype matching — shared, sport-agnostic.
//
// An archetype DEFINITION carries a nullable min/max per matchable field
// (columns `<field>_min` / `<field>_max`). A player MATCHES a definition when
// every non-null range contains the player's corresponding value. When several
// definitions match, the lowest `priority` wins (then name, for stability).
//
// The resolved archetype that gets stored on the player row is:
//   archetype_overwrite ?? matchArchetype(values, defs) ?? null
//
// Field configs live here so the admin editors and the recompute routines all
// agree on which fields exist, their labels, and their slider ranges.
// ─────────────────────────────────────────────────────────────────────────────

// Domestic (men's & women's) — 4 box stats + the 5 BTP metrics (0–100 each).
// `key` is the field id used for the `<key>_min` / `<key>_max` defs columns AND
// (via `src`) the property to read off a vw_players row.
export const DOMESTIC_FIELDS = [
  { key: "ppg",    src: "ppg",      label: "PPG",  max: 35 },
  { key: "rpg",    src: "rpg",      label: "RPG",  max: 16 },
  { key: "apg",    src: "apg",      label: "APG",  max: 12 },
  { key: "p3_pct", src: "3p_pct",   label: "3P%",  max: 100, pct: true },
  { key: "sei",    src: "sei",      label: "SEI",  max: 100 },
  { key: "ath",    src: "ath",      label: "ATH",  max: 100 },
  { key: "ris",    src: "ris",      label: "RIS",  max: 100 },
  { key: "dds",    src: "dds",      label: "DDS",  max: 100 },
  { key: "cdi",    src: "cdi",      label: "CDI",  max: 100 },
];

// International — 4 box stats (from the stats JSONB) + the international five
// (from the metrics JSONB). `statKey` reads from the canonical stats row;
// `metricKey` reads from international_players.metrics.
export const INTL_FIELDS = [
  { key: "pts",                 label: "PTS",  max: 35, statKey: "pts" },
  { key: "reb",                 label: "REB",  max: 16, statKey: "reb" },
  { key: "ast",                 label: "AST",  max: 12, statKey: "ast" },
  { key: "p3_pct",              label: "3P%",  max: 100, statKey: "3p%", pct: true },
  { key: "offensive_footprint", label: "Off. Footprint", max: 100, metricKey: "offensive_footprint" },
  { key: "defensive_score",     label: "Def. Score",     max: 100, metricKey: "defensive_score" },
  { key: "winning_impact",      label: "Winning Impact", max: 100, metricKey: "winning_impact" },
  { key: "sos_performance",     label: "SOS Perf.",      max: 100, metricKey: "sos_performance" },
  { key: "translation_grade",   label: "Translation",    max: 100, metricKey: "translation_grade" },
];

// Percentages arrive on two scales: domestic "3p_pct" is 0–100 (e.g. 36.2),
// international "3p%" is a decimal (e.g. 0.362). Normalize everything to 0–100
// so the sliders and thresholds use a single scale.
export function normPct(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n > 0 && n <= 1 ? n * 100 : n;
}

// True when `value` falls within [min, max]. A null bound is open on that end.
// A null/undefined value can only satisfy a fully-open range (both bounds null).
export function inRange(value, min, max) {
  if (min == null && max == null) return true;
  if (value == null || value === "" || Number.isNaN(Number(value))) return false;
  const v = Number(value);
  if (min != null && v < Number(min)) return false;
  if (max != null && v > Number(max)) return false;
  return true;
}

// Does a definition constrain at least one field? Guards against an all-null
// definition silently matching everyone.
export function defHasRange(def, fields) {
  return fields.some(f => def[`${f.key}_min`] != null || def[`${f.key}_max`] != null);
}

// `values` is an object keyed by field.key (already normalized). Returns the
// name of the first matching definition by priority, or null.
export function matchArchetype(values, defs, fields) {
  const ordered = [...(defs || [])].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || String(a.name).localeCompare(String(b.name))
  );
  for (const def of ordered) {
    if (!defHasRange(def, fields)) continue;
    const ok = fields.every(f => inRange(values[f.key], def[`${f.key}_min`], def[`${f.key}_max`]));
    if (ok) return def.name;
  }
  return null;
}

// overwrite wins; otherwise threshold match; otherwise null.
export function resolveArchetype(overwrite, values, defs, fields) {
  if (overwrite && String(overwrite).trim()) return overwrite;
  return matchArchetype(values, defs, fields);
}

// Pull the normalized match-values off a vw_players row.
export function domesticValues(row) {
  const out = {};
  for (const f of DOMESTIC_FIELDS) {
    const raw = row[f.src];
    out[f.key] = f.pct ? normPct(raw) : (raw == null || raw === "" ? null : Number(raw));
  }
  return out;
}

// Pull the normalized match-values for an international player given their
// metrics object and a canonical stats object (both may be partial/empty).
export function intlValues(metrics, stats) {
  const out = {};
  for (const f of INTL_FIELDS) {
    let raw = null;
    if (f.statKey)        raw = stats?.[f.statKey];
    else if (f.metricKey) raw = metrics?.[f.metricKey];
    out[f.key] = f.pct ? normPct(raw) : (raw == null || raw === "" ? null : Number(raw));
  }
  return out;
}
