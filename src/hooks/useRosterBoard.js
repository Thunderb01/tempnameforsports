import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const STORAGE_KEY    = "bp_roster_builder";
const STORAGE_VERSION = 7; // bump this whenever the state shape changes

// Legacy keys to purge on load
const LEGACY_KEYS = ["bp_roster_builder_v1"];

function loadLocal(team) {
  try {
    LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed._version !== STORAGE_VERSION) {
      localStorage.removeItem(STORAGE_KEY); // stale schema — discard
      return null;
    }
    // If the saved state belongs to a different team, discard it
    if (team && parsed._team && parsed._team !== team) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { ...parsed, board: [] };
  } catch { return null; }
}

function saveLocal(state, team) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, _team: team, _version: STORAGE_VERSION }));
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

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

/**
 * All roster-builder state in one hook.
 * Components just call the returned actions — no state management needed inline.
 */
export function useRosterBoard(team) {
  const [state, _setState] = useState(() => {
    const saved = loadLocal(team);
    return saved ?? defaultState(team);
  });

  // Sync program name from auth if blank or mismatched team
  useEffect(() => {
    if (team && !state.settings.program) {
      setState(s => ({ ...s, settings: { ...s.settings, program: team } }));
    }
  }, [team]);

  function setState(updater) {
    _setState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Only persist user-driven state — never the fetched board (too large for localStorage)
      const { board: _omit, ...persist } = next;
      saveLocal(persist, team);
      return next;
    });
  }

  // ── Portal board ────────────────────────────────────────────────────────────

  const loadPortalBoard = useCallback(async () => {
    const all = [];
    const PAGE = 1000;
    let page = 0;
    while (true) {
      const { data, error } = await supabase
        .from("players")
        .select("*, player_stats(*)")
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
      conf:           row.player_stats?.[0]?.conference ?? null,
      pos:            row.primary_position,
      year:           row.year,
      height:         row.height   ?? null,
      hometown:       row.hometown ?? null,
      espn_id:        row.espn_id  ?? null,
      marketLow:      row.open_market_low  ?? 0,
      marketHigh:     row.open_market_high ?? 0,
      playmakerTags:  row.playmaker_tags  ? row.playmaker_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
      shootingTags:   row.shooting_tags   ? row.shooting_tags.split(",").map(t => t.trim()).filter(Boolean)   : [],
      shotmakingTags: row.shotmaking_tags ? row.shotmaking_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      interiorTags:   row.interior_tags   ? row.interior_tags.split(",").map(t => t.trim()).filter(Boolean)   : [],
      defensiveTags:  row.defensive_tags  ? row.defensive_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
      tags:           [],
      stats:          { ...(row.player_stats?.[0] || {}) },
    }));

    setState(s => ({ ...s, board: players }));
  }, []);

  // ── Returning roster ────────────────────────────────────────────────────────

  const [returningPlayers, setReturningPlayers] = useState([]);

  const loadReturningRoster = useCallback(async (teamName) => {
    if (!teamName) return;
    const { data, error } = await supabase
      .from("team_players")
      .select("*, players(*, player_stats(*))")
      .eq("team", teamName);

    if (error) { console.error("team_players fetch:", error); return; }

    const returning = (data || [])
      .map(row => ({
        ...row.players,
        name:           row.players.name,
        team:           row.players.current_team,
        pos:            row.players.primary_position,
        year:           row.players.year,
        height:         row.players.height   ?? null,
        hometown:       row.players.hometown ?? null,
        espn_id:        row.players.espn_id  ?? null,
        marketLow:      row.players.open_market_low  ?? 0,
        marketHigh:     row.players.open_market_high ?? 0,
        playmakerTags:  row.players.playmaker_tags  ? row.players.playmaker_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
        shootingTags:   row.players.shooting_tags   ? row.players.shooting_tags.split(",").map(t => t.trim()).filter(Boolean)   : [],
        shotmakingTags: row.players.shotmaking_tags ? row.players.shotmaking_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        interiorTags:   row.players.interior_tags   ? row.players.interior_tags.split(",").map(t => t.trim()).filter(Boolean)   : [],
        defensiveTags:  row.players.defensive_tags  ? row.players.defensive_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
        stats:          { ...(row.players.player_stats?.[0] || {}) },
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    setReturningPlayers(returning);

    // Auto-set retention for seniors/graduates and portal players
    const GRADUATING_YEARS = ["Senior", "Graduate", "SR", "GR"];
    setState(s => {
      const auto = {};
      returning.forEach(p => {
        if (s.retentionById[p.id]) return; // don't override manual selections
        if (p.source === "portal") {
          auto[p.id] = "entering_portal";
        } else if (GRADUATING_YEARS.includes(p.year)) {
          auto[p.id] = "graduating";
        }
      });
      return Object.keys(auto).length
        ? { ...s, retentionById: { ...auto, ...s.retentionById } }
        : s;
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
    savedPlayers.forEach(p => {
      if (p._typeKey === "transfer") {
        roster.push({ id: p.id, nilOffer: p.nilOffer || 0 });
      } else {
        retentionById[p.id] = p._typeKey; // "returning" | "undecided"
        if (p.nilOffer) nilById[p.id] = p.nilOffer;
      }
    });
    setState(s => ({ ...s, roster, retentionById, nilById }));
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
