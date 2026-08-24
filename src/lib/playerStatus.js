// Shared player_status vocabulary — used by both men's and women's admin
// editors and both Big Boards. Sport-agnostic: the column is a plain `text`
// field on `players` / `w_players`, so there's nothing sport-specific about
// the values themselves, only about which table holds them.
export const PLAYER_STATUS_OPTIONS = ["returning", "graduating", "transferring", "declared", "drafted"];

export const PLAYER_STATUS_LABELS = {
  returning:    "Returning",
  graduating:   "Graduating",
  transferring: "Transferring",
  declared:     "Declared for Draft",
  drafted:      "Drafted",
};

export const PLAYER_STATUS_COLOR = {
  returning:    "#4ade80",
  graduating:   "#5b9cf6",
  transferring: "#f5a623",
  declared:     "#c084fc",
  drafted:      "#fbbf24",
};
