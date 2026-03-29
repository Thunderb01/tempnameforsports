import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const STORAGE_KEY = "bp_roster_builder_v1";

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveLocal(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function defaultState(team = "") {
  return {
    settings: { program: team, scholarships: 15, nilTotal: 4500000, maxPct: 0.30 },
    board:         [],
    shortlistIds:  [],
    roster:        [],   // [{ id, nilOffer }]
    statusById:    {},
    retentionById: {},
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
    const saved = loadLocal();
    return saved ?? defaultState(team);
  });

  // Sync program name from auth if state was blank
  useEffect(() => {
    if (team && !state.settings.program) {
      setState(s => ({ ...s, settings: { ...s.settings, program: team } }));
    }
  }, [team]);

  function setState(updater) {
    _setState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveLocal(next);
      return next;
    });
  }

  // ── Portal board ────────────────────────────────────────────────────────────

  const loadPortalBoard = useCallback(async () => {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("source", "portal")
      .order("name");

    if (error) { console.error("players fetch:", error); return; }

    const players = (data || []).map(row => ({
      id:            row.id,
      name:          row.name,
      team:          row.current_team,
      pos:           row.primary_position,
      year:          row.year,
      height:        row.height   ?? null,
      hometown:      row.hometown ?? null,
      marketLow:     row.open_market_low  ?? 0,
      marketHigh:    row.open_market_high ?? 0,
      playmakerTags: row.playmaker_tags ? row.playmaker_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      shootingTags:  row.shooting_tags  ? row.shooting_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
      tags:          [],
      stats:         { name: row.name, team: row.current_team, primary_position: row.primary_position, year: row.year, market_low: row.market_low, market_high: row.market_high, open_market_low: row.open_market_low, open_market_high: row.open_market_high, playmaker_tags: row.playmaker_tags, shooting_tags: row.shooting_tags, ...(row.stats || {}) },
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
        name:        row.players.name,
        team:        row.players.current_team,
        pos:         row.players.primary_position,
        year:        row.players.year,
        height:      row.players.height   ?? null,
        hometown:    row.players.hometown ?? null,
        marketLow:   row.players.open_market_low  ?? 0,
        marketHigh:  row.players.open_market_high ?? 0,
        stats:       { ...(row.players.player_stats?.[0] || {}) },
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    setReturningPlayers(returning);
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

  function commitSettings(settings) {
    setState(s => ({ ...s, settings }));
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    _setState(defaultState(team));
  }

  // ── Calc ────────────────────────────────────────────────────────────────────

  function calc() {
    const { settings, roster, retentionById } = state;
    const committedReturning = returningPlayers.filter(
      p => (retentionById[p.id] || "returning") === "returning"
    ).length;
    const totalRoster        = roster.length + committedReturning;
    const nilCommitted       = roster.reduce((sum, r) => sum + (r.nilOffer || 0), 0);
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
    updateOffer, setStatus, setRetention, commitSettings, reset,
    calc,
  };
}
