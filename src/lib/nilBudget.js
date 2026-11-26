// ── nilBudget.js ──────────────────────────────────────────────────────────────
// NIL budget tiers: the ONLY place the frontend reads data/nil_budget_tiers.json
// (shared with torvik_metrics.py, which uses the same file to value players).
// `npm run check:lookups` fails the build if anything else imports it.
//
// Model: a team's NIL budget depends on its conference tier (HM $20M, high MM
// $12M, MM $8M, LM $4.5M). No player can command more than MAX_PLAYER_SHARE
// (30%) of a team budget. The pipeline stores each player's share of their own
// tier's budget (players.nil_cap_share), which is budget-independent — so the
// roster builder can price the same player against ANY team's projected spend:
//
//   value to your team = nil_cap_share × your NIL budget
//
// Pure module (no Vite-only imports) so scripts/test-nil-budget.mjs can run it
// under plain node. Team-name → budget goes through getTeamConference() at the
// call site, never a raw lookup.

import cfg from "../../data/nil_budget_tiers.json" with { type: "json" };

export const MAX_PLAYER_SHARE = cfg.max_player_share;
export const NIL_TIERS        = cfg.tiers;
export const DEFAULT_NIL_TIER = cfg.default_tier;

/** Conference code (e.g. "B10", "MWC") → tier key ("HM" | "HMM" | "MM" | "LM"). */
export function nilTierForConference(conf) {
  const key = conf == null ? "" : String(conf).trim();
  return cfg.conferences[key] ?? DEFAULT_NIL_TIER;
}

/** Conference code → that tier's full-team NIL budget, in dollars. */
export function teamBudgetForConference(conf) {
  return NIL_TIERS[nilTierForConference(conf)].team_budget;
}

/** Conference code → the most one player can be valued at in that tier. */
export function playerCeilingForConference(conf) {
  return teamBudgetForConference(conf) * MAX_PLAYER_SHARE;
}

// ── Dollar scale for display ─────────────────────────────────────────────────
// OVR badges, projected-tier labels and grade cutoffs were all calibrated
// against the old flat $3M per-player cap. Men's current-season values now top
// out at the high-major ceiling instead (30% × $20M = $6M), so those displays
// scale their thresholds by `ceiling / LEGACY_PLAYER_CEILING`.
//
// Still on the legacy scale: women's (torvik_metrics_w.py hasn't moved to
// budget tiers yet) and men's seasons archived before the revamp.
export const HM_PLAYER_CEILING      = NIL_TIERS.HM.team_budget * MAX_PLAYER_SHARE;
export const LEGACY_PLAYER_CEILING  = 3_000_000;
export const FIRST_BUDGET_TIER_SEASON = 2027;

/** Per-player dollar ceiling that a given sport/season's valuations were computed under. */
export function valueCeilingFor({ sport = "men", season = null } = {}) {
  if (String(sport).toLowerCase().startsWith("w")) return LEGACY_PLAYER_CEILING;
  if (season != null && Number(season) < FIRST_BUDGET_TIER_SEASON) return LEGACY_PLAYER_CEILING;
  return HM_PLAYER_CEILING;
}

/** Multiply a legacy-calibrated dollar threshold onto the given ceiling's scale. */
export function scaleLegacyDollars(amount, ceiling = HM_PLAYER_CEILING) {
  return amount * (ceiling / LEGACY_PLAYER_CEILING);
}

/**
 * What a player is worth to a team with the given NIL budget: their share of
 * a budget × that budget, capped at `maxShare` of it. Returns null when the
 * player has no stored share (women's, freshmen, custom/intl players, or rows
 * the pipeline hasn't re-run since the column existed) so callers can fall
 * back to the player's own market range.
 */
export function valueForTeamBudget(player, teamBudget, maxShare = MAX_PLAYER_SHARE) {
  const share  = Number(player?.nilCapShare);
  const budget = Number(teamBudget);
  if (!Number.isFinite(share) || share <= 0 || !Number.isFinite(budget) || budget <= 0) return null;
  return Math.round(Math.min(share, maxShare) * budget);
}
