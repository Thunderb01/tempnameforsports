import { createRosterBoardHook } from "./useRosterBoard";

const WOMENS_CONFIG = {
  vwPlayersTable:             "vw_w_players",
  teamPlayersTable:           "w_team_players",
  internationalPlayersTable:  "w_international_players",
  freshmanTiersTable:         "w_freshman_tiers",
  teamFreshmenTable:          "w_team_freshmen",
  customRosterPlayersTable:   "w_custom_roster_players",
  storageKeyPrefix:           "bp_w_roster_builder",
  legacyKeys:                 [],
  sessionBoardKey:            "bp_w_board_cache",
  sessionBoardVer:            11, // bumped from 10 — see useRosterBoard.js MENS_CONFIG comment
};

const _womens = createRosterBoardHook(WOMENS_CONFIG);
export const useWomensRosterBoard = _womens.useBoard;
export const getBoardCache        = _womens.getBoardCache;
export const setBoardCache        = _womens.setBoardCache;
export const clearBoardCache      = _womens.clearBoardCache;
