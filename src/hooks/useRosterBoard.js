import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/display";


// Module-level caches so data survives page navigation without re-fetching.
const SESSION_BOARD_KEY = "bp_board_cache";
const SESSION_BOARD_TTL  = 4 * 60 * 60 * 1000; // 4 hours
const SESSION_BOARD_VER  = 4; // bump to invalidate all cached sessions

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
const _rosterCache   = {}; // keyed by teamName
const _incomingCache = {}; // keyed by teamName

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

  const [returningPlayers,  setReturningPlayers]  = useState([]);
  const [incomingTransfers, setIncomingTransfers] = useState([]);

  const loadReturningRoster = useCallback(async (teamName) => {
    if (!teamName) return;

    // Use cached players if available, otherwise fetch
    let returning;
    if (_rosterCache[teamName]) {
      returning = _rosterCache[teamName];
      setReturningPlayers(returning);
    } else {
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

      const { data, error } = await supabase
        .from("vw_players")
        .select("*")
        .in("id", ids);

      if (error) { console.error("vw_players roster fetch:", error); return; }

      returning = (data || [])
        .map(row => ({
          ...row,
          team:           row.current_team,
          pos:            row.primary_position,
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
          stats: {
            ppg: row.ppg, rpg: row.rpg, apg: row.apg, usg: row.usg,
            ast_tov: row.ast_tov, fg_pct: row.fg_pct, "3p_pct": row["3p_pct"],
            ft_pct: row.ft_pct, sei: row.sei, ath: row.ath,
            ris: row.ris, dds: row.dds, cdi: row.cdi,
            calendar_year: row.calendar_year,
          },
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      _rosterCache[teamName] = returning;
      setReturningPlayers(returning);
    }

    // Always re-evaluate retention + incoming — runs on both cache hits and fresh fetches
    const returningIds   = returning.map(p => p.id);
    const returningIdSet = new Set(returningIds);

    const [{ data: portalData }, { data: incomingPortalData }] = await Promise.all([
      supabase
        .from("portal_transfers")
        .select("player_id, status")
        .eq("season_year", 2026)
        .neq("status", "withdrawn")
        .in("player_id", returningIds),
      supabase
        .from("portal_transfers")
        .select("player_id")
        .eq("season_year", 2026)
        .eq("status", "committed")
        .ilike("to_team", teamName)
        .not("player_id", "is", null),
    ]);

    // Fetch full player data for incoming transfers not already on this roster
    const incomingIds = (incomingPortalData || [])
      .map(r => r.player_id)
      .filter(id => id && !returningIdSet.has(id));

    if (_incomingCache[teamName]) {
      setIncomingTransfers(_incomingCache[teamName]);
    } else if (incomingIds.length > 0) {
      const { data: incomingData } = await supabase
        .from("vw_players")
        .select("*")
        .in("id", incomingIds);
      const mapped = (incomingData || []).map(row => ({
        id:             row.id,
        name:           row.name,
        team:           row.current_team,
        pos:            row.primary_position,
        year:           row.year,
        height:         row.height   ?? null,
        hometown:       row.hometown ?? null,
        espn_id:        row.espn_id  ?? null,
        marketLow:      row.open_market_low  ?? 0,
        marketHigh:     row.open_market_high ?? 0,
        nilValuation:   row.nil_valuation    ?? 0,
        stats: {
          ppg: row.ppg, rpg: row.rpg, apg: row.apg, usg: row.usg,
          sei: row.sei, ath: row.ath, ris: row.ris, dds: row.dds, cdi: row.cdi,
        },
      })).sort((a, b) => a.name.localeCompare(b.name));
      _incomingCache[teamName] = mapped;
      setIncomingTransfers(mapped);
    } else {
      _incomingCache[teamName] = [];
      setIncomingTransfers([]);
    }

    // Map player_id → portal retention bucket:
    //   uncommitted = still in portal looking
    //   committed   = already committed to a new school (show as transferred)
    const portalRetentionMap = {};
    (portalData || []).forEach(r => {
      portalRetentionMap[r.player_id] = r.status === "committed" ? "transferred" : "entering_portal";
    });

    const GRADUATING_YEARS = ["Senior", "Graduate", "SR", "GR"];
    setState(s => {
      const portalRetention  = {};  // always overrides saved state
      const defaultRetention = {};  // only fills missing entries
      const autoNil = {};
      returning.forEach(p => {
        if (portalRetentionMap[p.id]) {
          portalRetention[p.id] = portalRetentionMap[p.id]; // always wins
        } else if (!s.retentionById[p.id]) {
          defaultRetention[p.id] = GRADUATING_YEARS.includes(p.year) ? "graduating" : "returning";
        }
        if (!s.nilById[p.id] && p.nilValuation > 0) {
          autoNil[p.id] = Math.round(p.nilValuation);
        }
      });
      return {
        ...s,
        retentionById: { ...defaultRetention, ...s.retentionById, ...portalRetention },
        nilById:       { ...autoNil, ...s.nilById },
      };
    });
  }, []);

  // ── Custom players (freshmen / redshirts) ──────────────────────────────────

  const [customPlayers, setCustomPlayers] = useState([]);

  const loadCustomPlayers = useCallback(async (teamName, uid) => {
    if (!teamName || !uid) return;
    const { data, error } = await supabase
      .from("custom_roster_players")
      .select("*")
      .eq("team", teamName)
      .eq("user_id", uid)
      .order("created_at");
    if (error) { console.error("custom_roster_players fetch:", error); return; }
    setCustomPlayers(data || []);
  }, []);

  async function addCustomPlayer({ name, nil_offer = 0, pos = "", year_label = "FR" }, teamName, uid) {
    if (!name.trim() || !teamName || !uid) return;
    const { data, error } = await supabase
      .from("custom_roster_players")
      .insert({ name: name.trim(), nil_offer: Number(nil_offer) || 0, pos, year_label, team: teamName, user_id: uid })
      .select()
      .single();
    if (error) { console.error("add custom player:", error); return; }
    setCustomPlayers(prev => [...prev, data]);
  }

  async function removeCustomPlayer(id) {
    const { error } = await supabase.from("custom_roster_players").delete().eq("id", id);
    if (error) { console.error("remove custom player:", error); return; }
    setCustomPlayers(prev => prev.filter(p => p.id !== id));
  }

  // Updates local state immediately (fast), call persistCustomPlayerNil onBlur to save to DB
  function updateCustomPlayerNil(id, nil_offer) {
    const val = Math.max(0, Number(nil_offer) || 0);
    setCustomPlayers(prev => prev.map(p => p.id === id ? { ...p, nil_offer: val } : p));
  }

  async function persistCustomPlayerNil(id, nil_offer) {
    const val = Math.max(0, Number(nil_offer) || 0);
    const { error } = await supabase.from("custom_roster_players").update({ nil_offer: val }).eq("id", id);
    if (error) console.error("persist custom player nil:", error);
  }

  // ── Board actions ───────────────────────────────────────────────────────────

  const _boardById = useMemo(() => new Map(state.board.map(p => [p.id, p])), [state.board]);
  const _rosterIds = useMemo(() => new Set(state.roster.map(r => r.id)), [state.roster]);
  const _shortIds  = useMemo(() => new Set(state.shortlistIds), [state.shortlistIds]);

  const byId     = (id) => _boardById.get(id) ?? null;
  const inRoster = (id) => _rosterIds.has(id);
  const inShort  = (id) => _shortIds.has(id);

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

  const calc = useMemo(() => {
    const { settings, roster, retentionById, nilById } = state;
    const isGraduating = p => retentionById[p.id] === "graduating";
    const committedReturning = returningPlayers.filter(
      p => !isGraduating(p) && (retentionById[p.id] || "returning") === "returning"
    ).length;
    const customNil          = customPlayers.reduce((sum, p) => sum + (p.nil_offer || 0), 0);
    const incomingNotRostered = incomingTransfers.filter(p => !_rosterIds.has(p.id)).length;
    const totalRoster        = roster.length + committedReturning + customPlayers.length + incomingNotRostered;
    const activeReturning    = returningPlayers.filter(p => !isGraduating(p) && (retentionById[p.id] || "returning") === "returning");
    const returningNil       = activeReturning.reduce((sum, p) => sum + (nilById[p.id] || 0), 0);
    const nilCommitted       = roster.reduce((sum, r) => sum + (r.nilOffer || 0), 0) + returningNil + customNil;
    const nilRemaining       = settings.nilTotal - nilCommitted;
    const scholarshipsRemaining = settings.scholarships - totalRoster;
    const maxPerPlayer       = settings.nilTotal * settings.maxPct;

    // All returners not definitively leaving — includes undecided/portal/returning
    const LEAVING_STATUSES = new Set(["graduating", "transferred", "transferring"]);
    const activeRosterReturners = returningPlayers.filter(p => !LEAVING_STATUSES.has(retentionById[p.id] || "returning"));

    const rosterPlayers      = [
      ...activeReturning,
      ...roster.map(r => _boardById.get(r.id)).filter(Boolean),
      ...incomingTransfers.filter(p => !_rosterIds.has(p.id)),
    ];
    const projectedLow       = rosterPlayers.reduce((sum, p) => sum + (p.marketLow  || 0), 0);
    const projectedHigh      = rosterPlayers.reduce((sum, p) => sum + (p.marketHigh || 0), 0);

    // BTP Roster Score — same formula as Portal Rankings, adapted to p.stats shape
    const SLOT_WEIGHTS = [1.0, 0.55, 0.30, 0.15, 0.08];
    // Players whose most recent stats are from a prior season (didn't play enough this year)
    // but had meaningful minutes that year get an 80% NIL discount to reflect uncertainty.
    const CURRENT_STATS_YEAR = 2025;  // most recently completed season's calendar_year
    const MIN_PPG_MEANINGFUL  = 5;    // PPG threshold for "meaningful minutes" in prior year
    function isPriorYearEval(p) {
      const s = p.stats || {};
      const cy = s.calendar_year || 0;
      return cy > 0 && cy < CURRENT_STATS_YEAR && (s.ppg ?? 0) >= MIN_PPG_MEANINGFUL;
    }
    function btpPlayerScore(p) {
      const s = p.stats || {};
      const sei    = (s.sei || 0) * 15000;
      const ath    = (s.ath || 0) * 5000;
      const ris    = (s.ris || 0) * 4000;
      const dds    = (s.dds || 0) * 4000;
      const cdi    = (s.cdi || 0) * 4000;
      const market = (p.marketHigh || 0) * (isPriorYearEval(p) ? 0.8 : 1.0);
      return sei * 0.50 + market * 0.15 + ath * 0.13 + ris * 0.08 + dds * 0.08 + cdi * 0.06;
    }
    const scoringPool = [
      ...activeRosterReturners.map(p => ({ ...p, _priorYearEval: isPriorYearEval(p) })),
      ...roster.map(r => { const p = _boardById.get(r.id); return p ? { ...p, _priorYearEval: isPriorYearEval(p) } : null; }).filter(Boolean),
      ...incomingTransfers.filter(p => !_rosterIds.has(p.id)).map(p => ({ ...p, _priorYearEval: isPriorYearEval(p) })),
    ];
    const byPos = {};
    scoringPool.forEach(p => {
      const pos = p.pos || "Wing";
      if (!byPos[pos]) byPos[pos] = [];
      byPos[pos].push(p);
    });
    let rosterScore = 0;
    Object.values(byPos).forEach(group => {
      group.sort((a, b) => btpPlayerScore(b) - btpPlayerScore(a))
           .forEach((p, i) => { rosterScore += btpPlayerScore(p) * (SLOT_WEIGHTS[i] ?? 0.05); });
    });

    const warnings           = [];

    if (scholarshipsRemaining < 0)
      warnings.push(`Over scholarships by ${Math.abs(scholarshipsRemaining)}.`);
    if (nilRemaining < 0)
      warnings.push(`Over NIL budget by ${money(Math.abs(nilRemaining))}.`);
    roster.forEach(r => {
      if (r.nilOffer > maxPerPlayer) {
        const p = _boardById.get(r.id);
        warnings.push(`${p?.name ?? r.id} exceeds max/player (${money(maxPerPlayer)}).`);
      }
    });

    return { totalRoster, nilCommitted, nilRemaining, scholarshipsRemaining, maxPerPlayer, projectedLow, projectedHigh, rosterScore, scoringPool, warnings };
  }, [state, returningPlayers, incomingTransfers, customPlayers, _boardById, _rosterIds]);

  return {
    state,
    returningPlayers,
    incomingTransfers,
    customPlayers,
    calc,
    loadPortalBoard,
    loadReturningRoster,
    loadCustomPlayers,
    byId, inRoster, inShort,
    addToShortlist, removeFromShortlist,
    addToRoster, removeFromRoster,
    updateOffer, setStatus, setRetention, updateReturningNil, loadFromSaved, commitSettings, reset,
    addCustomPlayer, removeCustomPlayer, updateCustomPlayerNil, persistCustomPlayerNil,
  };
}
