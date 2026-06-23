import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { money, bucketPosition } from "@/lib/display";
import { getCanonicalTeamName } from "@/lib/teamLookup";


// Module-level caches so data survives page navigation without re-fetching.
const SESSION_BOARD_KEY = "bp_board_cache";
const SESSION_BOARD_TTL  = 4 * 60 * 60 * 1000; // 4 hours
const SESSION_BOARD_VER  = 6; // bump to invalidate all cached sessions

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
const STORAGE_VERSION    = 15; // bump this whenever the state shape changes

// Legacy keys to purge on load
const LEGACY_KEYS = ["bp_roster_builder_v1", "bp_roster_builder"];

// Each (user, team) pair gets its own slot so switching teams loads the right
// roster and edits to one team don't bleed into another.
function storageKey(team, userId) {
  const u = userId || "anon";
  const t = (team || "no_team").replace(/[^a-zA-Z0-9]/g, "_");
  return `${STORAGE_KEY_PREFIX}_v${STORAGE_VERSION}_${u}_${t}`;
}

// One-time cleanup of older single-key-per-user blobs (they conflated teams).
function purgeOldUserKey(userId) {
  if (!userId) return;
  const old = `${STORAGE_KEY_PREFIX}_${userId}`;
  if (localStorage.getItem(old)) localStorage.removeItem(old);
}

function loadLocal(team, userId) {
  try {
    LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
    purgeOldUserKey(userId);
    const key = storageKey(team, userId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed._version !== STORAGE_VERSION) {
      localStorage.removeItem(key); // stale schema — discard
      return null;
    }
    return { ...parsed, board: [] };
  } catch { return null; }
}

function saveLocal(state, team, userId) {
  localStorage.setItem(
    storageKey(team, userId),
    JSON.stringify({ ...state, _team: team, _version: STORAGE_VERSION }),
  );
}

function defaultState(team = "") {
  return {
    settings: { program: team, scholarships: 15, nilTotal: 4500000, maxPct: 0.30 },
    board:            [],
    shortlistIds:     [],
    roster:           [],   // [{ id, nilOffer, source? }]    source: "portal" (default) | "intl"
    statusById:       {},
    retentionById:    {},
    nilById:          {},   // returning player NIL valuations { [playerId]: number }
    removedIncomings: [],   // incoming-transfer IDs the user explicitly removed (auto-add will skip)
    intlPlayers:      {},   // cached international_players objects keyed by id (so they survive reloads without a fetch)
  };
}

// Map an international_players row to the same shape the rest of the app uses,
// while preserving the original intl-specific fields so the IntlPlayerModal can
// render directly from this object without a refetch.
//
// BTP metric mapping rationale: translation_grade is the overall composite, so
// it feeds sei (the dominant slot at 50% weight). Direct intl metrics fill the
// slots they best correspond to. For slots without a direct proxy (ath, ris),
// we default to 50 (median) NOT to translation_grade — copying TG into every
// slot was inflating intl player scores ~70% above what they should be.
function mapIntlPlayer(p) {
  const m  = p.metrics || {};
  const tg = m.translation_grade ?? 0;
  return {
    id:               p.id,
    source:           "intl",
    name:             p.name,
    team:             p.league,            // league shown where "team" usually goes
    conf:             null,
    pos:              bucketPosition(p.primary_position),
    year:             p.recruiting_class ? `'${String(p.recruiting_class).slice(-2)}` : "Intl",
    height:           p.height           ?? null,
    hometown:         p.country_of_origin ?? null,
    espn_id:          null,
    eligibility_years: null,
    marketLow:        0,
    marketHigh:       0,
    nilValuation:     0,
    archetype:        null,
    player_status:    null,
    competition_tier: p.competition_tier  ?? null,
    stats: {
      sei: tg,                                                // primary scoring projection
      ath: 50,                                                // no intl proxy → assume median
      ris: m.winning_impact      ?? 50,                       // closest intl analog
      dds: m.defensive_score     ?? 50,                       // direct match
      cdi: m.offensive_footprint ?? 50,                       // creation / usage proxy
    },
    // ── Fields preserved verbatim from the international_players row so the
    //    IntlPlayerModal can render off this object directly.
    league:            p.league,
    primary_position:  p.primary_position,
    age:               p.age,
    country_of_origin: p.country_of_origin,
    recruiting_class:  p.recruiting_class,
    profile_url:       p.profile_url,
    metrics:           m,
    scouting_notes:    p.scouting_notes,
    film_url:          p.film_url,
    agent_name:        p.agent_name,
    agent_contact:     p.agent_contact,
    player_status:     p.player_status,
    committed_team:    p.committed_team,
    us_interest_level: p.us_interest_level,
    projected_tier:    p.projected_tier,
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

  // When team or userId resolves (e.g. auth finishes) OR the team changes,
  // reload that team's saved roster — or fully reset to defaults if none.
  // Previously this only patched `settings.program`, which left the prior
  // team's roster, retention, intl cache, etc. in memory after switching.
  useEffect(() => {
    if (!team && !userId) return;
    const saved = loadLocal(team, userId);
    _setState(prev => {
      const base = saved ?? defaultState(team);
      return { ...base, board: prev.board };  // keep the in-memory portal board cache
    });
    // Clear the non-state caches that don't belong to the new team. They'll
    // refill when loadReturningRoster / loadCustomPlayers run for the new team.
    setReturningPlayers([]);
    setIncomingTransfers([]);
    setCustomPlayers([]);
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
      height:            row.height            ?? null,
      hometown:          row.hometown          ?? null,
      espn_id:           row.espn_id           ?? null,
      eligibility_years: row.eligibility_years ?? null,
      marketLow:         row.open_market_low   ?? 0,
      marketHigh:        row.open_market_high  ?? 0,
      nilValuation:      row.nil_valuation     ?? 0,
      archetype:         row.archetype         ?? null,
      player_status:     null,  // merged below from players table
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

    // Fetch player_status for all players so team comparison can exclude leavers
    try {
      const statusMap = {};
      let sPage = 0;
      while (true) {
        const { data: sData } = await supabase
          .from("players")
          .select("id, player_status")
          .not("player_status", "is", null)
          .range(sPage * 1000, (sPage + 1) * 1000 - 1);
        (sData || []).forEach(r => { statusMap[r.id] = r.player_status; });
        if ((sData || []).length < 1000) break;
        sPage++;
      }
      players.forEach(p => { if (statusMap[p.id]) p.player_status = statusMap[p.id]; });
    } catch (_) { /* RLS or column missing — comparison includes all players */ }

    // Reassign committed transfers to their destination team for scoring purposes.
    // Without this, a player committed to Texas but still in vw_players under his
    // old school counts toward the old school's roster strength, not Texas's —
    // so every team's static score systematically misses their incoming class.
    try {
      const commitsMap = {};   // player_id → to_team
      let cPage = 0;
      while (true) {
        const { data: cData } = await supabase
          .from("portal_transfers")
          .select("player_id, to_team")
          .gte("season_year", 2026)
          .eq("status", "committed")
          .not("to_team", "is", null)
          .not("player_id", "is", null)
          .range(cPage * 1000, (cPage + 1) * 1000 - 1);
        (cData || []).forEach(r => { commitsMap[r.player_id] = r.to_team; });
        if ((cData || []).length < 1000) break;
        cPage++;
      }
      players.forEach(p => {
        const dest = commitsMap[p.id];
        if (dest) {
          p._original_team = p.team;
          p.team           = dest;
          p._committed_to  = dest;
        }
      });
    } catch (_) { /* RLS or table missing — fall back to current_team only */ }

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
          team:              row.current_team,
          pos:               row.primary_position,
          espn_id:           row.espn_id           ?? null,
          eligibility_years: row.eligibility_years ?? null,
          marketLow:         row.open_market_low   ?? 0,
          marketHigh:        row.open_market_high  ?? 0,
          nilValuation:      row.nil_valuation     ?? 0,
          archetype: row.archetype ?? null,
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

    const [{ data: portalData }, { data: incomingPortalData }, { data: playerStatusData }] = await Promise.all([
      supabase
        .from("portal_transfers")
        .select("player_id, status")
        .gte("season_year", 2026)
        .neq("status", "withdrawn")
        .in("player_id", returningIds),
      supabase
        .from("portal_transfers")
        .select("player_id")
        .gte("season_year", 2026)
        .eq("status", "committed")
        .ilike("to_team", teamName)
        .not("player_id", "is", null),
      supabase
        .from("players")
        .select("id, player_status")
        .in("id", returningIds)
        .not("player_status", "is", null),
    ]);

    // Fetch full player data for incoming transfers not already on this roster
    const incomingIds = (incomingPortalData || [])
      .map(r => r.player_id)
      .filter(id => id && !returningIdSet.has(id));

    let incomingMapped = [];
    if (_incomingCache[teamName]) {
      incomingMapped = _incomingCache[teamName];
      setIncomingTransfers(incomingMapped);
    } else if (incomingIds.length > 0) {
      const { data: incomingData } = await supabase
        .from("vw_players")
        .select("*")
        .in("id", incomingIds);
      incomingMapped = (incomingData || []).map(row => ({
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
      _incomingCache[teamName] = incomingMapped;
      setIncomingTransfers(incomingMapped);
    } else {
      _incomingCache[teamName] = [];
      setIncomingTransfers([]);
    }

    // Auto-add incoming transfers to the roster. They're already committed to this
    // team, so requiring a manual "+ Roster" click was redundant. We respect
    // `removedIncomings` so a user-driven removal sticks across reloads.
    if (incomingMapped.length > 0) {
      setState(s => {
        const existing = new Set(s.roster.map(r => r.id));
        const removed  = new Set(s.removedIncomings || []);
        const toAdd    = incomingMapped
          .filter(p => !existing.has(p.id) && !removed.has(p.id))
          .map(p => ({ id: p.id, nilOffer: 0 }));
        if (toAdd.length === 0) return s;
        return { ...s, roster: [...toAdd, ...s.roster] };
      });
    }

    // ── International players committed to this team ───────────────────────
    // Mirrors the portal-transfer auto-add above: any international_players row
    // with player_status in ("committed", "signed") AND committed_team matching
    // this team gets auto-added to the roster as a source="intl" entry.
    try {
      const { data: intlCommitted } = await supabase
        .from("international_players")
        .select("*")
        .ilike("committed_team", teamName)
        .in("player_status", ["committed", "signed"]);

      const mappedIntl = (intlCommitted || []).map(mapIntlPlayer);
      if (mappedIntl.length > 0) {
        setState(s => {
          const existing = new Set(s.roster.map(r => r.id));
          const removed  = new Set(s.removedIncomings || []);
          const toAdd    = mappedIntl.filter(p => !existing.has(p.id) && !removed.has(p.id));
          if (toAdd.length === 0) return s;
          const newIntlCache = { ...(s.intlPlayers || {}) };
          toAdd.forEach(p => { newIntlCache[p.id] = p; });
          return {
            ...s,
            intlPlayers: newIntlCache,
            roster: [
              ...toAdd.map(p => ({ id: p.id, nilOffer: 0, source: "intl" })),
              ...s.roster,
            ],
          };
        });
      }
    } catch (e) {
      console.warn("intl committed-roster fetch failed:", e);
    }

    // Map player_id → portal retention bucket:
    //   uncommitted = still in portal looking
    //   committed   = already committed to a new school (show as transferred)
    const portalRetentionMap = {};
    (portalData || []).forEach(r => {
      portalRetentionMap[r.player_id] = r.status === "committed" ? "transferred" : "entering_portal";
    });

    // Admin-set player_status → retention value mapping
    const PLAYER_STATUS_TO_RETENTION = {
      returning:   "returning",
      graduating:  "graduating",
      transferring: "entering_portal",
      declared:    "entering_draft",
    };
    const adminStatusMap = {};
    (playerStatusData || []).forEach(r => {
      const mapped = PLAYER_STATUS_TO_RETENTION[r.player_status];
      if (mapped) adminStatusMap[r.id] = mapped;
    });

    // Fallback label list for players whose eligibility_years isn't set yet
    const GRADUATING_LABELS = ["Sr", "RS Sr", "Grad", "5th Year", "Senior", "RS Senior", "Graduate", "SR", "GR"];
    setState(s => {
      const portalRetention  = {};  // always overrides saved state
      const defaultRetention = {};  // only fills missing entries
      const autoNil = {};
      returning.forEach(p => {
        if (portalRetentionMap[p.id]) {
          portalRetention[p.id] = portalRetentionMap[p.id]; // always wins
        } else if (!s.retentionById[p.id]) {
          // eligibility_years === 1 is authoritative; fall back to label matching
          const isGraduating = p.eligibility_years === 1
            || (!p.eligibility_years && GRADUATING_LABELS.includes(p.year));
          defaultRetention[p.id] = adminStatusMap[p.id] ?? (isGraduating ? "graduating" : "returning");
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

  // ── Freshman impact tiers (admin-defined; effect = BTP score per freshman) ──
  const [freshmanTiers, setFreshmanTiers] = useState([]);
  useEffect(() => {
    supabase.from("freshman_tiers").select("name, effect, color, sort").order("sort")
      .then(({ data, error }) => { if (!error) setFreshmanTiers(data || []); });
  }, []);

  // ── Official team freshmen (superadmin-added; global, per team) ─────────────
  const [allTeamFreshmenRaw, setAllTeamFreshmenRaw] = useState([]);
  useEffect(() => {
    supabase.from("team_freshmen").select("id, team, name, pos, tier, recruiting_class, sei, ath, ris, dds, cdi, nil_valuation")
      .then(({ data, error }) => { if (!error) setAllTeamFreshmenRaw(data || []); });
  }, []);

  // Resolve each to a scoreable pseudo-player. If a superadmin gave BTP metrics,
  // they score like a real player (stats + NIL drive btpPlayerScore); otherwise
  // the tier's flat effect is used. NIL valuation is carried for display either way.
  const allTeamFreshmen = useMemo(() => {
    const effectByName = Object.fromEntries(freshmanTiers.map(t => [t.name, Number(t.effect) || 0]));
    return allTeamFreshmenRaw
      .map(f => {
        const hasMetrics = ["sei", "ath", "ris", "dds", "cdi"].some(k => f[k] != null);
        const nil = f.nil_valuation || 0;
        const base = { id: f.id, name: f.name, pos: f.pos, team: f.team, source: "domestic",
                       _isTeamFreshman: true, freshman_tier: f.tier,
                       nilValuation: nil, marketLow: nil, marketHigh: nil };
        if (hasMetrics) {
          return { ...base, stats: { sei: f.sei, ath: f.ath, ris: f.ris, dds: f.dds, cdi: f.cdi } };
        }
        if (f.tier && effectByName[f.tier] != null) return { ...base, _freshmanEffect: effectByName[f.tier] };
        return null;  // no metrics and no resolvable tier → not scoreable
      })
      .filter(Boolean);
  }, [allTeamFreshmenRaw, freshmanTiers]);

  // Subset for the team currently being built (auto-included on the roster).
  const teamFreshmen = useMemo(() => {
    if (!team) return [];
    const canon = getCanonicalTeamName(team);
    return allTeamFreshmen.filter(f => getCanonicalTeamName(f.team) === canon);
  }, [allTeamFreshmen, team]);

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

  async function addCustomPlayer({ name, nil_offer = 0, pos = "", year_label = "FR", freshman_tier = null }, teamName, uid) {
    if (!name.trim() || !teamName || !uid) return;
    const { data, error } = await supabase
      .from("custom_roster_players")
      .insert({ name: name.trim(), nil_offer: Number(nil_offer) || 0, pos, year_label, freshman_tier: freshman_tier || null, team: teamName, user_id: uid })
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
  const _intlById  = useMemo(() => new Map(Object.values(state.intlPlayers || {}).map(p => [p.id, p])), [state.intlPlayers]);
  const _rosterIds = useMemo(() => new Set(state.roster.map(r => r.id)), [state.roster]);
  const _shortIds  = useMemo(() => new Set(state.shortlistIds), [state.shortlistIds]);

  const byId     = (id) => _boardById.get(id) ?? _intlById.get(id) ?? null;
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
    const offer = Math.round(((p.marketLow || 0) + (p.marketHigh || 0)) / 2);
    setState(s => ({
      ...s,
      shortlistIds: s.shortlistIds.filter(x => x !== id),
      roster: [{ id, nilOffer: offer, source: "portal" }, ...s.roster],
    }));
  }

  /**
   * Add an international player to the roster.
   * Caches the mapped player object in state so it survives reloads without
   * another Supabase fetch.
   */
  function addIntlToRoster(intlRow, nilOffer = 0) {
    if (!intlRow || !intlRow.id || inRoster(intlRow.id)) return;
    const mapped = mapIntlPlayer(intlRow);
    setState(s => ({
      ...s,
      intlPlayers: { ...(s.intlPlayers || {}), [mapped.id]: mapped },
      roster: [{ id: mapped.id, nilOffer: Math.max(0, Number(nilOffer) || 0), source: "intl" }, ...s.roster],
    }));
  }

  function removeFromRoster(id) {
    const isIncoming = incomingTransfers.some(p => p.id === id);
    setState(s => {
      // If this id was an auto-added incoming-transfer OR an auto-added committed
      // international player, record the removal so loadReturningRoster doesn't
      // re-add it on the next page load.
      const entry      = s.roster.find(r => r.id === id);
      const wasIntlAutoAdd = entry?.source === "intl" && !!(s.intlPlayers && s.intlPlayers[id]);
      const shouldPersistRemoval = isIncoming || wasIntlAutoAdd;

      const next = {
        ...s,
        roster: s.roster.filter(r => r.id !== id),
        removedIncomings: shouldPersistRemoval && !(s.removedIncomings || []).includes(id)
          ? [...(s.removedIncomings || []), id]
          : (s.removedIncomings || []),
      };
      // Clean up intl cache when an intl entry is removed
      if (s.intlPlayers && s.intlPlayers[id]) {
        const { [id]: _, ...rest } = s.intlPlayers;
        next.intlPlayers = rest;
      }
      return next;
    });
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
    // Mirror CMP_LEAVING_STATUSES from AppPage by adding "declared" alongside
    // its retention-mapped form "entering_draft". Keeps the user's pool and
    // the every-team baseline filtering on equivalent sets.
    const LEAVING_STATUSES = new Set([
      "graduating", "transferred", "transferring",
      "entering_portal", "entering_draft", "declared",
    ]);
    const activeRosterReturners = returningPlayers.filter(p => !LEAVING_STATUSES.has(retentionById[p.id] || "returning"));

    // Resolve a roster entry against the portal board first, then the intl cache.
    const lookupRosterPlayer = (r) => _boardById.get(r.id) ?? _intlById.get(r.id) ?? null;

    const rosterPlayers      = [
      ...activeReturning,
      ...roster.map(lookupRosterPlayer).filter(Boolean),
      ...incomingTransfers.filter(p => !_rosterIds.has(p.id)),
    ];
    const projectedLow       = rosterPlayers.reduce((sum, p) => sum + (p.marketLow  || 0), 0);
    const projectedHigh      = rosterPlayers.reduce((sum, p) => sum + (p.marketHigh || 0), 0);

    // BTP Roster Score — matches RosterStrengthPanel's static-team scoring:
    // auto-optimal lineup per roster (≥1 Guard/Wing/Big, greedy fill to 5),
    // 1.00 weight for starter slots, 0.20 for the next 3 off the bench, 0.04
    // for depth. International players excluded.
    function slotWeight(i, n) {
      if (i < n)         return 1.00;
      if (i < n + 3)     return 0.20;
      return 0.04;
    }
    function pickOptimalLineup(scoresByPos) {
      const counts = { Guard: 0, Wing: 0, Big: 0 };
      for (const pos of ["Guard", "Wing", "Big"]) {
        if (scoresByPos[pos].length > 0) counts[pos] = 1;
      }
      const used = { ...counts };
      let total = counts.Guard + counts.Wing + counts.Big;
      while (total < 5) {
        let bestPos = null, bestScore = -Infinity;
        for (const pos of ["Guard", "Wing", "Big"]) {
          const next = scoresByPos[pos][used[pos]];
          if (next == null) continue;
          if (next > bestScore) { bestScore = next; bestPos = pos; }
        }
        if (!bestPos) break;
        counts[bestPos]++;
        used[bestPos]++;
        total++;
      }
      return counts;
    }
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
      // Incoming freshmen score by their admin-defined impact-tier effect.
      if (p._freshmanEffect != null) return p._freshmanEffect;
      const s = p.stats || {};
      const sei    = (s.sei || 0) * 15000;
      const ath    = (s.ath || 0) * 5000;
      const ris    = (s.ris || 0) * 4000;
      const dds    = (s.dds || 0) * 4000;
      const cdi    = (s.cdi || 0) * 4000;
      const market = (p.marketHigh || 0) * (isPriorYearEval(p) ? 0.8 : 1.0);
      return sei * 0.50 + market * 0.15 + ath * 0.13 + ris * 0.08 + dds * 0.08 + cdi * 0.06;
    }
    // Incoming freshmen tagged with an impact tier become scoreable pseudo-players.
    const freshmanEffectByName = Object.fromEntries(freshmanTiers.map(t => [t.name, Number(t.effect) || 0]));
    const freshmanPool = customPlayers
      .filter(p => p.freshman_tier && freshmanEffectByName[p.freshman_tier] != null)
      .map(p => ({ id: p.id, name: p.name, pos: p.pos, source: "domestic",
                   _freshmanEffect: freshmanEffectByName[p.freshman_tier] }));

    // Build the scoring pool, then dedupe by id so no player is ever counted
    // twice through slot weights — accidental overlap between activeReturners
    // and state.roster (or any other source) would otherwise inflate the
    // weighted contribution.
    const _seen = new Set();
    const scoringPool = [
      ...activeRosterReturners.map(p => ({ ...p, _priorYearEval: isPriorYearEval(p) })),
      ...roster.map(r => { const p = lookupRosterPlayer(r); return p ? { ...p, _priorYearEval: isPriorYearEval(p) } : null; }).filter(Boolean),
      ...incomingTransfers.filter(p => !_rosterIds.has(p.id)).map(p => ({ ...p, _priorYearEval: isPriorYearEval(p) })),
      ...freshmanPool,
      ...teamFreshmen,   // official, superadmin-added freshmen for this team
    ].filter(p => {
      if (!p?.id || _seen.has(p.id)) return false;
      _seen.add(p.id);
      return true;
    });
    const byPos = { Guard: [], Wing: [], Big: [] };
    scoringPool.forEach(p => {
      if (p?.source === "intl") return;
      byPos[bucketPosition(p.pos)].push(p);
    });
    const sortedScoresByPos = {
      Guard: byPos.Guard.map(btpPlayerScore).sort((a, b) => b - a),
      Wing:  byPos.Wing.map(btpPlayerScore).sort((a, b) => b - a),
      Big:   byPos.Big.map(btpPlayerScore).sort((a, b) => b - a),
    };
    const optimalLineup = pickOptimalLineup(sortedScoresByPos);
    let rosterScore = 0;
    for (const pos of ["Guard", "Wing", "Big"]) {
      const n = optimalLineup[pos] ?? 0;
      sortedScoresByPos[pos].forEach((s, i) => { rosterScore += s * slotWeight(i, n); });
    }

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
  }, [state, returningPlayers, incomingTransfers, customPlayers, freshmanTiers, teamFreshmen, _boardById, _intlById, _rosterIds]);

  return {
    state,
    returningPlayers,
    incomingTransfers,
    customPlayers,
    freshmanTiers,
    teamFreshmen,
    allTeamFreshmen,
    calc,
    loadPortalBoard,
    loadReturningRoster,
    loadCustomPlayers,
    byId, inRoster, inShort,
    addToShortlist, removeFromShortlist,
    addToRoster, addIntlToRoster, removeFromRoster,
    updateOffer, setStatus, setRetention, updateReturningNil, loadFromSaved, commitSettings, reset,
    addCustomPlayer, removeCustomPlayer, updateCustomPlayerNil, persistCustomPlayerNil,
  };
}
