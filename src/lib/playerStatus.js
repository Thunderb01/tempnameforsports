// ── playerStatus.js ──────────────────────────────────────────────────────────
// SINGLE source of truth for the admin-set `players.player_status` /
// `w_players.player_status` value and everything derived from it.
//
// Previously this lived as three independently hand-maintained copies:
//   - CMP_LEAVING_STATUSES in AppPage.jsx (raw player_status values)
//   - LEAVING_STATUSES in useRosterBoard.js (superset incl. retention-mapped)
//   - LEAVING_STATUSES in useWomensRosterBoard.js (identical copy of the above)
// which had to be kept in sync by hand. Import from here instead.

// The four values an admin can set via /admin's Player Status dropdown.
export const PLAYER_STATUS_VALUES = ["returning", "graduating", "transferring", "declared"];

// Raw player_status values that mean "this player is leaving" — used to
// exclude a team's own outgoing players from static roster-strength scoring
// (AppPage's team-comparison view, which reads player_status directly).
export const LEAVING_PLAYER_STATUSES = new Set(["graduating", "transferring", "declared"]);

// Maps an admin-set player_status to the retention label stored per-player
// in the roster-builder's `retentionById` state.
export const PLAYER_STATUS_TO_RETENTION = {
  returning:    "returning",
  graduating:   "graduating",
  transferring: "entering_portal",
  declared:     "entering_draft",
};

// Superset covering both the raw player_status values (LEAVING_PLAYER_STATUSES)
// and the retention-mapped/portal-derived values `retentionById` can also hold
// ("entering_portal", "entering_draft", "transferred" — the last one only ever
// set from a committed portal transfer, never a raw player_status). Used
// wherever the leaving-check runs against retentionById instead of raw
// player_status (useRosterBoard's scoring pool filter).
export const LEAVING_RETENTION_STATUSES = new Set([
  ...LEAVING_PLAYER_STATUSES,
  "entering_portal",
  "entering_draft",
  "transferred",
]);
