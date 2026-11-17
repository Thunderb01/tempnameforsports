// ─────────────────────────────────────────────────────────────────────────────
// Player tags — Excel-index → site-scale conversion (the ONE config location).
//
// The original tagging spreadsheet expressed metric thresholds on an index
// where 100 = average and 150 = 50% above average. The site's metrics
// (cdi/dds/sei/ris) are 1–100 within-position percentiles. Every metric
// threshold in src/lib/playerTags.js is written as idx(<Excel value>) and
// converted through this table.
//
// `null` = not yet decided by the owner. Do NOT fill these in by
// interpolation or guesswork: an index→percentile mapping depends on each
// metric's real distribution and is a product decision.
//
// While ANY entry is null, idx() throws for every input (even 150), and
// getPlayerTags() skips every metric-based tag (raw-stat tags still work).
// See isIdxTableComplete().
// ─────────────────────────────────────────────────────────────────────────────

export const IDX_TABLE = Object.freeze({
  90:  null,
  95:  null,
  100: null,
  110: null,
  120: null,
  125: null,
  130: null,
  140: null,
  150: 50,
});

const isFilled = v => typeof v === "number" && Number.isFinite(v);

export class IdxConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "IdxConfigError";
  }
}

/** True when every entry in `table` has a numeric site-scale value. */
export function isIdxTableComplete(table = IDX_TABLE) {
  return Object.values(table).every(isFilled);
}

/**
 * Build an idx() bound to a given table. Exposed so tests can exercise the
 * tag operators against a fully filled table without touching the real
 * config; production code uses the default `idx` export below.
 */
export function makeIdx(table) {
  return function idx(n) {
    if (!Object.prototype.hasOwnProperty.call(table, n)) {
      throw new IdxConfigError(`idx(${n}): no entry for Excel index ${n} in IDX_TABLE (no interpolation).`);
    }
    const unfilled = Object.keys(table).filter(k => !isFilled(table[k]));
    if (unfilled.length) {
      throw new IdxConfigError(`idx(${n}): IDX_TABLE has unfilled entries (${unfilled.join(", ")}).`);
    }
    return table[n];
  };
}

/** Convert an ORIGINAL Excel index value to the site's 1–100 scale. */
export const idx = makeIdx(IDX_TABLE);
