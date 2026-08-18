// ── positions.js ─────────────────────────────────────────────────────────────
// SINGLE source of truth for the five-position model (PG/SG/SF/PF/C) and every
// piece of lineup/slot-weight math that depends on it.
//
// Replaces what used to be four independent copies of the optimal-lineup
// algorithm (AppPage, its women's fork, useRosterBoard, and the inline
// auto-optimize button) and three copies of the slot-weight helper. Import
// from here rather than re-implementing — the copies had already drifted.
//
// ── The multi-position model ────────────────────────────────────────────────
// A player's `positions` array is an ELIGIBILITY SET, not a list of roles they
// occupy simultaneously. For any scoring or depth-chart purpose each player is
// assigned to exactly ONE position (see assignToPositions).
//
// This matters: the scoring functions sum every position bucket, so a player
// fanned out into two buckets would be counted twice. Versatile rosters would
// inflate non-linearly against specialist ones and silently reorder every
// national and conference ranking. Multi-position buys the optimizer
// flexibility about WHERE to place a player, never double credit.

export const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

// Traditional starting five, one per position. Auto-optimize may deviate.
export const DEFAULT_STARTER_COUNTS = { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 };

// Rows still carrying the old three-bucket vocabulary — saved rosters in
// localStorage, historical_stats, team_freshmen, custom_roster_players, and
// any players row not yet re-synced from Torvik — expand to the plausible set.
const LEGACY_BUCKET_TO_POSITIONS = {
  Guard: ["PG", "SG"],
  Wing:  ["SF"],
  Big:   ["PF", "C"],
};

// Raw single-letter codes seen in scraped data.
const RAW_CODE_TO_POSITIONS = {
  G: ["PG", "SG"],
  F: ["SF", "PF"],
  C: ["C"],
};

// Mirrors the old bucketPosition() default of "Wing": a player with no usable
// position still gets scored rather than silently dropping out of their team's
// roster score. SF is the direct five-position analog.
const UNKNOWN_POSITION_FALLBACK = ["SF"];

/**
 * Normalize any single stored position value into a list of five-position
 * codes. Handles the new vocabulary, the legacy three buckets, and raw
 * scraped codes.
 */
export function expandPosition(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];

  const upper = s.toUpperCase();
  if (POSITIONS.includes(upper)) return [upper];

  // Legacy buckets, case-insensitively ("Guard", "guard", "GUARD").
  const titled = upper.charAt(0) + upper.slice(1).toLowerCase();
  if (LEGACY_BUCKET_TO_POSITIONS[titled]) return [...LEGACY_BUCKET_TO_POSITIONS[titled]];

  if (RAW_CODE_TO_POSITIONS[upper]) return [...RAW_CODE_TO_POSITIONS[upper]];

  return [];
}

/**
 * The eligibility set for a player. Prefers the `positions` array, falls back
 * to the single stored position (`primary_position`, or `pos` as the board
 * hook renames it), then to SF so nobody drops out of scoring entirely.
 */
export function positionsFor(player) {
  if (!player) return [...UNKNOWN_POSITION_FALLBACK];

  if (Array.isArray(player.positions) && player.positions.length > 0) {
    const valid = player.positions
      .map(p => String(p).trim().toUpperCase())
      .filter(p => POSITIONS.includes(p));
    if (valid.length > 0) return [...new Set(valid)];
  }

  const single = expandPosition(player.primary_position ?? player.pos);
  return single.length > 0 ? single : [...UNKNOWN_POSITION_FALLBACK];
}

/** Human-readable label for a player's positions, e.g. "PG/SG". */
export function positionLabel(player) {
  const list = positionsFor(player);
  return list.length > 0 ? list.join("/") : "—";
}

// ── Coarse three-bucket view ────────────────────────────────────────────────
// The Full Board deliberately still presents Guard/Wing/Big: scanning hundreds
// of rows is easier against three groups than five, and it matches the
// percentile peer groups the metrics on that page are computed against. The
// five-position detail surfaces in player modals, the roster builder, and
// portal rankings.
export const LEGACY_BUCKETS = ["Guard", "Wing", "Big"];

/** Guard | Wing | Big for a player, derived from their primary position. */
export function legacyBucketFor(player) {
  switch (positionsFor(player)[0]) {
    case "PG":
    case "SG": return "Guard";
    case "PF":
    case "C":  return "Big";
    default:   return "Wing";   // SF
  }
}

/**
 * Weight a player contributes based on their rank within their position group:
 * starters full value, the next three off the bench a fifth, deeper depth
 * nearly nothing.
 */
export function slotWeight(slotIndex, startersN) {
  if (slotIndex < startersN)     return 1.00;   // starter
  if (slotIndex < startersN + 3) return 0.20;   // first 3 off the bench
  return 0.04;                                   // depth
}

/**
 * Distribute players across the five positions so each appears exactly once.
 *
 * Greedy and deterministic: best players pick first (score desc), and each
 * takes whichever position they're eligible for that currently pays the
 * highest slot weight — i.e. the one with unfilled starter capacity. Ties
 * break by POSITIONS order.
 *
 * Returns disjoint buckets, so every downstream sum stays correct without
 * needing its own dedupe.
 */
export function assignToPositions(players, starterCounts = DEFAULT_STARTER_COUNTS, scorer = () => 0) {
  const assigned = { PG: [], SG: [], SF: [], PF: [], C: [] };

  const ranked = players
    .filter(p => p && p.source !== "intl")   // international players are scored separately
    .map(p => ({ p, score: scorer(p) }))
    .sort((a, b) => b.score - a.score);

  for (const { p } of ranked) {
    const eligible = positionsFor(p);
    let best = eligible[0];
    let bestWeight = -Infinity;
    for (const pos of eligible) {
      const w = slotWeight(assigned[pos].length, starterCounts[pos] ?? 0);
      if (w > bestWeight) { bestWeight = w; best = pos; }
    }
    assigned[best].push(p);
  }

  return assigned;
}

/**
 * Best starter allocation for an already-assigned roster: one starter at every
 * position that has a player, then greedily fill to five with the highest
 * remaining scorer at any position.
 */
export function computeOptimalLineup(assigned, scorer) {
  const counts = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };

  const sortedScores = {};
  for (const pos of POSITIONS) {
    sortedScores[pos] = (assigned[pos] || []).map(scorer).sort((a, b) => b - a);
    if (sortedScores[pos].length > 0) counts[pos] = 1;
  }

  const used = { ...counts };
  let total = POSITIONS.reduce((n, pos) => n + counts[pos], 0);
  while (total < 5) {
    let bestPos = null;
    let bestScore = -Infinity;
    for (const pos of POSITIONS) {
      const next = sortedScores[pos][used[pos]];
      if (next == null) continue;
      if (next > bestScore) { bestScore = next; bestPos = pos; }
    }
    if (!bestPos) break;   // roster exhausted
    counts[bestPos]++;
    used[bestPos]++;
    total++;
  }

  return counts;
}

/**
 * Position-bucketed, weighted-slot roster score. The one implementation behind
 * both static team baselines and the user's live build.
 *
 * `lineup` is either an explicit { PG, SG, … } starter-count object or "auto"
 * to optimize per team.
 */
export function scoreRoster(players, scorer, lineup = "auto") {
  // Assign against the requested counts when they're known, so players land in
  // the slots that lineup actually values.
  const baseline = lineup === "auto" ? DEFAULT_STARTER_COUNTS : lineup;
  const assigned = assignToPositions(players, baseline, scorer);
  const resolved = lineup === "auto" ? computeOptimalLineup(assigned, scorer) : lineup;

  const posScores = {};
  let total = 0;
  for (const pos of POSITIONS) {
    const n = resolved[pos] ?? 0;
    const sorted = (assigned[pos] || []).map(scorer).sort((a, b) => b - a);
    let posTotal = 0;
    sorted.forEach((s, i) => { posTotal += s * slotWeight(i, n); });
    posScores[pos] = posTotal;
    total += posTotal;
  }
  return { score: total, posScores, assigned, lineup: resolved };
}
