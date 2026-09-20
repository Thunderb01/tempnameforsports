// ── yearLookup.js ────────────────────────────────────────────────────────────
// `players.year` / `w_players.year` is written in two different vocabularies
// depending on how the row was last touched:
//   - Torvik-driven imports (torvik_metrics.py/_w.py, import_w_torvik.py,
//     scraper_to_supabase.py) write full words: "Freshman", "Sophomore", …
//   - Manual admin edits and the roster builder's own dropdowns
//     (AdminPage.jsx, AppPage.jsx) write short codes: "Fr", "RS Fr", "Grad", …
// Any UI that filters/matches on `year` against a fixed option list has to
// normalize first or it silently matches nothing for half the rows.
const CLASS_TO_CODE = {
  fr: "Fr", freshman:  "Fr",
  so: "So", sophomore: "So",
  jr: "Jr", junior:    "Jr",
  sr: "Sr", senior:    "Sr",
  grad: "Grad", graduate: "Grad",
};

/** Normalize any stored `year` value to the short-code vocabulary used by
 * the filter/dropdown option lists ("Fr", "RS Fr", "So", … "5th Year"). */
export function normalizeYear(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const key = s.toLowerCase();

  if (CLASS_TO_CODE[key]) return CLASS_TO_CODE[key];

  // Redshirt variants: "RS Freshman", "Redshirt Fr", "rs fr", etc.
  const rsMatch = key.match(/^(?:rs|redshirt)\s+(.+)$/);
  if (rsMatch && CLASS_TO_CODE[rsMatch[1]]) return `RS ${CLASS_TO_CODE[rsMatch[1]]}`;

  // Unrecognized — pass through unchanged rather than guessing (covers
  // "5th Year", "JuCo", "G League", and anything else already in the DB).
  return s;
}
