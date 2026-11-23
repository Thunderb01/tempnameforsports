// ─────────────────────────────────────────────────────────────────────────────
// Player tags — rule-based tags ported from the original Excel tagging sheet.
//
// Pure, sport-agnostic, no I/O. A player can hold any number of tags; output
// order follows TAG_RULES order (= the spec's order).
//
//   getPlayerTags(input)            → [{ name, category }, ...]
//   tagInputsFromRepo(player, row)  → the spec-named input object, built from
//                                     a players row + its player_stats row
//
// Rules (all non-negotiable, see the PR that added this file):
//   - Comparison operators are exactly as in the spec (> vs >=).
//   - Missing data is never coerced to 0: if ANY input a tag depends on is
//     null/undefined/NaN, that tag is skipped for that player.
//   - Metric thresholds go through idx() (src/lib/playerTagsConfig.js). While
//     that table is incomplete, every tag that uses idx() is skipped — only
//     raw-stat tags are produced.
//   - Quirks inherited from the Excel are kept on purpose (Primary/Secondary
//     Playmaker usg gap, Paint Touch Creator exclusion, stacking tiers).
//
// Position here is the Guard/Wing/Big bucket the Excel used. The repo's
// closest equivalent is legacyBucketFor() in positions.js, which ALSO returns
// "Forward" (dual SF+PF). Forward is never "Guard", so Guard-only rules treat
// it as a non-match; Slasher (Guard OR Wing) is SKIPPED for Forward players
// because the Excel had no Forward bucket and whether it counts as Wing is an
// open question for the owner.
// ─────────────────────────────────────────────────────────────────────────────

import { IDX_TABLE, makeIdx, isIdxTableComplete } from "./playerTagsConfig.js";
import { expandPosition, legacyBucketFor } from "./positions.js";

export const TAG_CATEGORIES = Object.freeze({
  PLAYMAKING: "Playmaking",
  SHOOTING:   "Shooting/Scoring",
  SHOTMAKING: "Shotmaking",
  RIM:        "Rim/Interior",
  DEFENSE:    "Defense",
});

const C = TAG_CATEGORIES;
const POSITION_VALUES = ["Guard", "Wing", "Forward", "Big"];

// Each rule: name, category, the inputs it depends on (all must be present),
// whether it uses idx(), and `test(p, idx, awarded)` → boolean.
// `skip(p)` (optional) marks an input combination as not-evaluable.
export const TAG_RULES = Object.freeze([
  // ── Playmaking ────────────────────────────────────────────────────────────
  { name: "Primary Playmaker", category: C.PLAYMAKING, usesIdx: true,
    inputs: ["usg", "creation"],
    test: (p, idx) => p.usg > 20 && p.creation > idx(150) },
  { name: "Secondary Playmaker", category: C.PLAYMAKING, usesIdx: true,
    inputs: ["usg", "creation"],
    test: (p, idx) => p.usg > 18 && p.creation > idx(130) && p.creation <= idx(150) },
  { name: "Ball Dominant", category: C.PLAYMAKING, usesIdx: false,
    inputs: ["usg"],
    test: p => p.usg > 24 },
  { name: "High-IQ Passer", category: C.PLAYMAKING, usesIdx: true,
    inputs: ["ast_to", "creation"],
    test: (p, idx) => p.ast_to > 2 && p.creation > idx(130) },
  { name: "Non-Passer", category: C.PLAYMAKING, usesIdx: true,
    inputs: ["creation"],
    test: (p, idx) => p.creation < idx(90) },
  { name: "Turnover-Prone", category: C.PLAYMAKING, usesIdx: false,
    inputs: ["ast_to", "to_pg"],
    test: p => p.ast_to < 1 && p.to_pg > 3 },
  { name: "Low-Mistake Handler", category: C.PLAYMAKING, usesIdx: false,
    inputs: ["position", "to_pg", "usg", "ast_to"],
    test: p => p.position === "Guard" && p.to_pg <= p.usg / 10 && p.ast_to >= 1.5 },
  // Mirrors the Excel's nested IF: only when Low-Mistake Handler was NOT
  // awarded. Depends on Low-Mistake Handler's inputs too, so if that tag
  // couldn't be evaluated (missing data) this one is skipped as well rather
  // than assuming "not awarded".
  { name: "Paint Touch Creator", category: C.PLAYMAKING, usesIdx: true,
    inputs: ["position", "rim_impact", "to_pg", "usg", "ast_to"],
    test: (p, idx, awarded) =>
      !awarded.has("Low-Mistake Handler") && p.position === "Guard" && p.rim_impact >= idx(110) },

  // ── Shooting and scoring ──────────────────────────────────────────────────
  { name: "Non-Shooter", category: C.SHOOTING, usesIdx: false,
    inputs: ["three_pa_pg"],
    test: p => p.three_pa_pg < 1 },
  { name: "Shooter", category: C.SHOOTING, usesIdx: false,
    inputs: ["three_pt_pct", "three_pa_pg"],
    test: p => p.three_pt_pct >= 0.35 && p.three_pt_pct < 0.40 && p.three_pa_pg >= 2 },
  { name: "Elite Shooter", category: C.SHOOTING, usesIdx: false,
    inputs: ["three_pt_pct", "three_pa_pg"],
    test: p => p.three_pt_pct >= 0.40 && p.three_pa_pg >= 2 },
  { name: "Volume Scorer", category: C.SHOOTING, usesIdx: true,
    inputs: ["usg", "scoring_efficiency"],
    test: (p, idx) => p.usg > 24 && p.scoring_efficiency > idx(120) },
  { name: "Efficient Scorer", category: C.SHOOTING, usesIdx: true,
    inputs: ["scoring_efficiency"],
    test: (p, idx) => p.scoring_efficiency >= idx(130) },
  { name: "Low-Efficiency Scorer", category: C.SHOOTING, usesIdx: true,
    inputs: ["scoring_efficiency", "usg"],
    test: (p, idx) => p.scoring_efficiency < idx(100) && p.usg > 22 },
  { name: "Low-USG Finisher", category: C.SHOOTING, usesIdx: true,
    inputs: ["scoring_efficiency", "usg"],
    test: (p, idx) => p.scoring_efficiency > idx(110) && p.usg < 20 },

  // ── Shotmaking ────────────────────────────────────────────────────────────
  // NOT IMPLEMENTED — see UNIMPLEMENTED_TAGS below.

  // ── Rim and interior ──────────────────────────────────────────────────────
  { name: "Slasher", category: C.RIM, usesIdx: true,
    inputs: ["position", "rim_impact"],
    skip: p => p.position === "Forward",
    test: (p, idx) => (p.position === "Guard" || p.position === "Wing") && p.rim_impact >= idx(120) },
  { name: "Elite Rim Pressure", category: C.RIM, usesIdx: true,
    inputs: ["rim_impact", "rim_ast_pct"],
    test: (p, idx) => p.rim_impact >= idx(120) && p.rim_ast_pct < 0.30 },
  { name: "Elite Rim Finisher", category: C.RIM, usesIdx: false,
    inputs: ["rim_fg_pct"],
    test: p => p.rim_fg_pct >= 0.65 },
  { name: "Offensive Glass Threat", category: C.RIM, usesIdx: false,
    inputs: ["orb_per40"],
    test: p => p.orb_per40 > 4 },
  { name: "Rim Protector", category: C.RIM, usesIdx: false,
    inputs: ["blk_per40"],
    test: p => p.blk_per40 > 1.5 },
  { name: "Interior Force", category: C.RIM, usesIdx: true,
    inputs: ["rim_impact"],
    test: (p, idx) => p.rim_impact >= idx(140) },

  // ── Defense ───────────────────────────────────────────────────────────────
  { name: "Disruptive Defender", category: C.DEFENSE, usesIdx: true,
    inputs: ["defensive_disruption"],
    test: (p, idx) => p.defensive_disruption >= idx(130) },
  { name: "Elite Disruptor", category: C.DEFENSE, usesIdx: true,
    inputs: ["defensive_disruption"],
    test: (p, idx) => p.defensive_disruption >= idx(150) },
  { name: "Stocks Monster", category: C.DEFENSE, usesIdx: false,
    inputs: ["stl_per40", "blk_per40"],
    test: p => p.stl_per40 + p.blk_per40 >= 3 },
  { name: "Steals Playmaker", category: C.DEFENSE, usesIdx: false,
    inputs: ["stl_per40"],
    test: p => p.stl_per40 >= 2 },
  { name: "Defensive Glass Cleaner", category: C.DEFENSE, usesIdx: false,
    inputs: ["drb_per40", "min_pct"],
    test: p => p.drb_per40 > 7 && p.min_pct > 0.40 },
  { name: "Foul-Prone Defender", category: C.DEFENSE, usesIdx: false,
    inputs: ["pf_per40"],
    test: p => p.pf_per40 >= 4.5 },
]);

// Spec tags deliberately left out, with the reason. Never returned.
export const UNIMPLEMENTED_TAGS = Object.freeze([
  { name: "Shot Maker",            category: C.SHOTMAKING, reason: "needs `shotmaking` (SMI); player_stats.smi exists but no pipeline populates it" },
  { name: "Elite Shot Maker",      category: C.SHOTMAKING, reason: "needs `shotmaking` (SMI); player_stats.smi exists but no pipeline populates it" },
  { name: "Tough-Shot Specialist", category: C.SHOTMAKING, reason: "needs `shotmaking` (SMI); player_stats.smi exists but no pipeline populates it" },
  { name: "Limited Self-Creation", category: C.SHOTMAKING, reason: "needs `shotmaking` (SMI); player_stats.smi exists but no pipeline populates it" },
]);

const isNum = v => typeof v === "number" && Number.isFinite(v);

function hasInput(p, key) {
  if (key === "position") return POSITION_VALUES.includes(p.position);
  return isNum(p[key]);
}

/**
 * Compute every tag the player qualifies for.
 *
 * @param {object} input  spec-named fields (see tagInputsFromRepo)
 * @param {object} [opts]
 * @param {object} [opts.table]  idx table override (tests only)
 * @returns {{name: string, category: string}[]}
 */
export function getPlayerTags(input, { table = IDX_TABLE } = {}) {
  const p = input || {};
  const idx = makeIdx(table);
  const idxReady = isIdxTableComplete(table);
  const awarded = new Set();
  const tags = [];
  for (const rule of TAG_RULES) {
    if (rule.usesIdx && !idxReady) continue;
    if (!rule.inputs.every(k => hasInput(p, k))) continue;
    if (rule.skip && rule.skip(p)) continue;
    if (rule.test(p, idx, awarded)) {
      awarded.add(rule.name);
      tags.push({ name: rule.name, category: rule.category });
    }
  }
  return tags;
}

// ── Adapter: repo rows → spec-named inputs ──────────────────────────────────
// `player` = a players/vw_players row (or board player object) for position;
// `stats`  = that player's player_stats row (DB column names). Nothing here
// fills a gap with 0 — an absent/blank value comes through as null and the
// tags that need it are skipped.

const num = v => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ratio = (a, b) => {
  const x = num(a), y = num(b);
  return x !== null && y !== null && y > 0 ? x / y : null;
};

/** Guard/Wing/Forward/Big, or null when the row has no usable position. */
function positionBucket(player) {
  if (!player) return null;
  const arr = Array.isArray(player.positions) ? player.positions : [];
  const known = arr.some(x => expandPosition(x).length)
    || expandPosition(player.primary_position).length
    || expandPosition(player.pos).length;
  // legacyBucketFor() falls back to "Wing" for unknown rows; don't let that
  // fallback stand in for real data here.
  return known ? legacyBucketFor(player) : null;
}

export function tagInputsFromRepo(player, stats) {
  const s = stats || {};
  const minPct = num(s.torvik_min_pct);
  return {
    position:             positionBucket(player),
    creation:             num(s.cdi),
    defensive_disruption: num(s.dds),
    scoring_efficiency:   num(s.sei),
    rim_impact:           num(s.ris),
    // Torvik Min_per is stored 0–100 (e.g. 42.5); the spec uses a decimal.
    min_pct:              minPct === null ? null : minPct / 100,
    usg:                  num(s.usg),
    // Box-score totals (Sports-Reference scrape) → per-40 / per-game.
    pf_per40:             (() => { const pf = num(s.tot_pf); return pf === null ? null : ratio(pf * 40, s.tot_mp); })(),
    to_pg:                ratio(s.tot_tov, s.tot_g),
    rim_ast_pct:          num(s.assisted_pct_rim),
    rim_fg_pct:           num(s.torvik_rim_pct),
    three_pt_pct:         num(s.torvik_3p_pct),
    three_pa_pg:          num(s["3pg"]),
    ast_to:               num(s.ast_tov),
    stl_per40:            num(s.stl_40),
    blk_per40:            num(s.blk_40),
    drb_per40:            num(s.drb_40),
    orb_per40:            num(s.orb_40),
  };
}
