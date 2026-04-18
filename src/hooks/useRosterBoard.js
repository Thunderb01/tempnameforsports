import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/display";


// Module-level caches so data survives page navigation without re-fetching.
const SESSION_BOARD_KEY = "bp_board_cache";
const SESSION_BOARD_TTL  = 4 * 60 * 60 * 1000; // 4 hours
const SESSION_BOARD_VER  = 2; // bump to invalidate all cached sessions

function loadSessionCache() {
  try {
    const raw = sessionStorage.getItem(SESSION_BOARD_KEY);
    if (!raw) return [];
    const { players, ts, v } = JSON.parse(raw);
    if (v !== SESSION_BOARD_VER || Date.now() - ts > SESSION_BOARD_TTL) {
      sessionStorage.removeItem(SESSION_BOARD_KEY);
      return [];
    }
    return players ?? [];
  } catch { return []; }
}

function saveSessionCache(players) {
  try { sessionStorage.setItem(SESSION_BOARD_KEY, JSON.stringify({ players, ts: Date.now(), v: SESSION_BOARD_VER })); } catch {}
}

let _boardCache = loadSessionCache(); // warm from sessionStorage on module load
const _rosterCache = {}; // keyed by teamName

export function getBoardCache() { return _boardCache; }
export function setBoardCache(players) { _boardCache = players; }

const STORAGE_KEY_PREFIX = "bp_roster_builder";
const STORAGE_VERSION    = 13; // bump this whenever the state shape changes

// Legacy keys to purge on load
const LEGACY_KEYS = ["bp_roster_builder_v1", "bp_roster_builder"];

function storageKey(userId) {
  return userId ? `${STORAGE_KEY_PREFIX}_${userId}` : STORAGE_KEY_PREFIX;
}

function loadLocal(team, userId) {
  try {
    LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
    const key = storageKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed._version !== STORAGE_VERSION) {
      localStorage.removeItem(key); // stale schema — discard
      return null;
    }
    // If the saved state belongs to a different team, discard it
    if (team && parsed._team && parsed._team !== team) {
      localStorage.removeItem(key);
      return null;
    }
    return { ...parsed, board: [] };
  } catch { return null; }
}

function saveLocal(state, team, userId) {
  localStorage.setItem(storageKey(userId), JSON.stringify({ ...state, _team: team, _version: STORAGE_VERSION }));
}

function defaultState(team = "") {
  return {
    settings: { program: team, scholarships: 15, nilTotal: 4500000, maxPct: 0.30 },
    board:         [],
    shortlistIds:  [],
    roster:        [],   // [{ id, nilOffer }]
    statusById:    {},
    retentionById: {},
    nilById:       {},   // returning player NIL valuations { [playerId]: number }
  };
}

/**
 * All roster-builder state in one hook.
 * Components just call the returned actions — no state management needed inline.
 */
export function useRosterBoard(team, userId) {
  const [state, _setState] = useState(() => {
    const saved = loadLocal(team, userId);
    return saved ?? defaultState(team);
  });

  // When team or userId resolves (e.g. auth finishes), reload from localStorage
  useEffect(() => {
    if (!team && !userId) return;
    const saved = loadLocal(team, userId);
    if (saved) {
      _setState(prev => ({ ...saved, board: prev.board }));
    } else if (!state.settings.program && team) {
      setState(s => ({ ...s, settings: { ...s.settings, program: team } }));
    }
  }, [team, userId]);

  function setState(updater) {
    _setState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Only persist user-driven state — never the fetched board (too large for localStorage)
      const { board: _omit, ...persist } = next;
      saveLocal(persist, team, userId);
      return next;
    });
  }

  // ── Portal board ────────────────────────────────────────────────────────────

  const loadPortalBoard = useCallback(async () => {
    // Return cached data immediately if already fetched this session
    if (_boardCache.length > 0) {
      setState(s => ({ ...s, board: _boardCache }));
      return;
    }

    const all = [];
    const PAGE = 1000;
    let page = 0;
    while (true) {
      const { data, error } = await supabase
        .from("vw_players")
        .select("*")
        .order("name")
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) { console.error("players fetch:", error); return; }
      all.push(...(data || []));
      if ((data || []).length < PAGE) break;
      page++;
    }

    const players = all.map(row => ({
      id:             row.id,
      source:         row.source ?? "program",
      name:           row.name,
      team:           row.current_team,
      conf:           row.conference ?? null,
      pos:            row.primary_position,
      year:           row.year,
      height:         row.height   ?? null,
      hometown:       row.hometown ?? null,
      espn_id:        row.espn_id  ?? null,
      marketLow:      row.open_market_low  ?? 0,
      marketHigh:     row.open_market_high ?? 0,
      nilValuation:   row.nil_valuation    ?? 0,
      playmakerTags:  row.playmaker_tags  ? row.playmaker_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
      specialistTags: row.specialist_tags ? row.specialist_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      shootingTags:   row.shooting_tags   ? row.shooting_tags.split(",").map(t => t.trim()).filter(Boolean)   : [],
      shotmakingTags: row.shotmaking_tags ? row.shotmaking_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      interiorTags:   row.interior_tags   ? row.interior_tags.split(",").map(t => t.trim()).filter(Boolean)   : [],
      defensiveTags:  row.defensive_tags  ? row.defensive_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
      tags:           [],
      stats: {
        ppg:         row.ppg,
        rpg:         row.rpg,
        apg:         row.apg,
        usg:         row.usg,
        ast_tov:     row.ast_tov,
        fg_pct:      row.fg_pct,
        "3p_pct":    row["3p_pct"],
        ft_pct:      row.ft_pct,
        sei:         row.sei,
        ath:         row.ath,
        ris:         row.ris,
        dds:         row.dds,
        cdi:         row.cdi,
        calendar_year: row.calendar_year,
      },
    }));

    _boardCache = players;
    saveSessionCache(players);
    setState(s => ({ ...s, board: players }));
  }, []);

  // ── Returning roster ────────────────────────────────────────────────────────

  const [returningPlayers, setReturningPlayers] = useState([]);

  const loadReturningRoster = useCallback(async (teamName) => {
    if (!teamName) return;

    if (_rosterCache[teamName]) {
      setReturningPlayers(_rosterCache[teamName]);
      return;
    }

    // Step 1: get the player IDs for this team
    const { data: teamData, error: teamError } = await supabase
      .from("team_players")
      .select("player_id")
      .eq("team", teamName);

    if (teamError) { console.error("team_players fetch:", teamError); return; }
    const ids = (teamData || []).map(r => r.player_id);
    if (ids.length === 0) {
      _rosterCache[teamName] = [];
      setReturningPlayers([]);
      return;
    }

    // Step 2: fetch player data from the optimized view
    const { data, error } = await supabase
      .from("vw_players")
      .select("*")
      .in("id", ids);

    if (error) { console.error("vw_players roster fetch:", error); return; }

    const returning = (data || [])
      .map(row => ({
        ...row,
        team:           row.current_team,
        pos:            row.primary_position,
        marketLow:      row.open_market_low  ?? 0,
        marketHigh:     row.open_market_high ?? 0,
        nilValuation:   row.nil_valuation    ?? 0,
        playmakerTags:  row.playmaker_tags  ? row.playmaker_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
        specialistTags: row.specialist_tags ? row.specialist_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        shootingTags:   row.shooting_tags   ? row.shooting_tags.split(",").map(t => t.trim()).filter(Boolean)   : [],
        shotmakingTags: row.shotmaking_tags ? row.shotmaking_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        interiorTags:   row.interior_tags   ? row.interior_tags.split(",").map(t => t.trim()).filter(Boolean)   : [],
        defensiveTags:  row.defensive_tags  ? row.defensive_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
        stats: {
          ppg:          row.ppg,
          rpg:          row.rpg,
          apg:          row.apg,
          usg:          row.usg,
          ast_tov:      row.ast_tov,
          fg_pct:       row.fg_pct,
          "3p_pct":     row["3p_pct"],
          ft_pct:       row.ft_pct,
          sei:          row.sei,
          ath:          row.ath,
          ris:          row.ris,
          dds:          row.dds,
          cdi:          row.cdi,
          calendar_year: row.calendar_year,
        },
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    _rosterCache[teamName] = returning;
    setReturningPlayers(returning);

    // Fetch which of these players are in the transfer portal this season
    const returningIds = returning.map(p => p.id);
    const { data: portalData } = await supabase
      .from("portal_transfers")
      .select("player_id")
      .eq("season_year", 2026)
      .in("player_id", returningIds);
    const portalIds = new Set((portalData || []).map(r => r.player_id));

    // Auto-set retention based on portal status, year, and defaults
    const GRADUATING_YEARS = ["Senior", "Graduate", "SR", "GR"];
    setState(s => {
      const autoRetention = {};
      const autoNil = {};
      returning.forEach(p => {
        if (!s.retentionById[p.id]) {
          if (portalIds.has(p.id)) {
            autoRetention[p.id] = "entering_portal";
          } else if (GRADUATING_YEARS.includes(p.year)) {
            autoRetention[p.id] = "graduating";
          } else {
            autoRetention[p.id] = "returning";
          }
        }
        if (!s.nilById[p.id] && p.nilValuation > 0) {
          autoNil[p.id] = Math.round(p.nilValuation);
        }
      });
      return {
        ...s,
        retentionById: { ...autoRetention, ...s.retentionById },
        nilById:       { ...autoNil,       ...s.nilById       },
      };
    });
  }, []);

  // ── Board actions ───────────────────────────────────────────────────────────

  const byId      = id => state.board.find(p => p.id === id) ?? null;
  const inRoster  = id => state.roster.some(r => r.id === id);
  const inShort   = id => state.shortlistIds.includes(id);

  function addToShortlist(id) {
    if (!byId(id) || inShort(id) || inRoster(id)) return;
    setState(s => ({ ...s, shortlistIds: [id, ...s.shortlistIds] }));
  }

  function removeFromShortlist(id) {
    setState(s => ({ ...s, shortlistIds: s.shortlistIds.filter(x => x !== id) }));
  }

  function addToRoster(id) {
    const p = byId(id);
    if (!p || inRoster(id)) return;
    const offer = Math.round((p.marketLow + p.marketHigh) / 2);
    setState(s => ({
      ...s,
      shortlistIds: s.shortlistIds.filter(x => x !== id),
      roster: [{ id, nilOffer: offer }, ...s.roster],
    }));
  }

  function removeFromRoster(id) {
    setState(s => ({ ...s, roster: s.roster.filter(r => r.id !== id) }));
  }

  function updateOffer(id, nilOffer) {
    setState(s => ({
      ...s,
      roster: s.roster.map(r => r.id === id ? { ...r, nilOffer: Math.max(0, Number(nilOffer)) } : r),
    }));
  }

  function setStatus(id, statusKey) {
    setState(s => {
      const next = { ...s, statusById: { ...s.statusById, [id]: statusKey } };
      if (statusKey === "signed"  && !inRoster(id)) { addToRoster(id); }
      if (statusKey === "passed") {
        next.shortlistIds = next.shortlistIds.filter(x => x !== id);
        next.roster       = next.roster.filter(r => r.id !== id);
      }
      return next;
    });
  }

  function setRetention(id, value) {
    setState(s => ({ ...s, retentionById: { ...s.retentionById, [id]: value } }));
  }

  function updateReturningNil(id, nilValue) {
    setState(s => ({
      ...s,
      nilById: { ...s.nilById, [id]: Math.max(0, Number(nilValue) || 0) },
    }));
  }

  // Restores a saved roster into live state: portal adds + retention statuses
  function loadFromSaved(savedPlayers) {
    const roster        = [];
    const retentionById = {};
    const nilById       = {};
    const statusById    = {};
    const shortlistIds  = [];
    savedPlayers.forEach(p => {
      if (p._status)      statusById[p.id] = p._status;
      if (p._shortlisted) shortlistIds.push(p.id);
      if (p._typeKey === "transfer") {
        roster.push({ id: p.id, nilOffer: p.nilOffer || 0 });
      } else if (p._typeKey === "shortlisted") {
        // shortlisted-only portal players — already added to shortlistIds above
      } else {
        retentionById[p.id] = p._typeKey;
        if (p.nilOffer) nilById[p.id] = p.nilOffer;
      }
    });
    setState(s => ({ ...s, roster, retentionById, nilById, statusById, shortlistIds }));
  }

  function commitSettings(settings) {
    setState(s => ({ ...s, settings }));
  }

  function reset(teamName) {
    setState(s => ({
      ...s,
      shortlistIds:  [],
      roster:        [],
      statusById:    {},
      retentionById: {},
    }));
    if (teamName) loadReturningRoster(teamName);
  }

  // ── Calc ────────────────────────────────────────────────────────────────────

  function calc() {
    const { settings, roster, retentionById, nilById } = state;
    const isGraduating = p => retentionById[p.id] === "graduating";
    const committedReturning = returningPlayers.filter(
      p => !isGraduating(p) && (retentionById[p.id] || "returning") === "returning"
    ).length;
    const totalRoster        = roster.length + committedReturning;
    const returningNil       = returningPlayers
      .filter(p => !isGraduating(p) && (retentionById[p.id] || "returning") === "returning")
      .reduce((sum, p) => sum + (nilById[p.id] || 0), 0);
    const nilCommitted       = roster.reduce((sum, r) => sum + (r.nilOffer || 0), 0) + returningNil;
    const nilRemaining       = settings.nilTotal - nilCommitted;
    const scholarshipsRemaining = settings.scholarships - totalRoster;
    const maxPerPlayer       = settings.nilTotal * settings.maxPct;
    const warnings           = [];

    if (scholarshipsRemaining < 0)
      warnings.push(`Over scholarships by ${Math.abs(scholarshipsRemaining)}.`);
    if (nilRemaining < 0)
      warnings.push(`Over NIL budget by ${money(Math.abs(nilRemaining))}.`);
    roster.forEach(r => {
      if (r.nilOffer > maxPerPlayer) {
        const p = byId(r.id);
        warnings.push(`${p?.name ?? r.id} exceeds max/player (${money(maxPerPlayer)}).`);
      }
    });

    return { totalRoster, nilCommitted, nilRemaining, scholarshipsRemaining, maxPerPlayer, warnings };
  }

  return {
    state,
    returningPlayers,
    loadPortalBoard,
    loadReturningRoster,
    byId, inRoster, inShort,
    addToShortlist, removeFromShortlist,
    addToRoster, removeFromRoster,
    updateOffer, setStatus, setRetention, updateReturningNil, loadFromSaved, commitSettings, reset,
    calc,
  };
}
