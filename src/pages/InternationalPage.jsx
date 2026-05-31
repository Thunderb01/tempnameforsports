import { useState, useEffect, useMemo } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { supabase }   from "@/lib/supabase";
import { useAuth }       from "@/hooks/useAuth";
import { useAdminTeam }  from "@/hooks/useAdminTeam";
import { useRosterBoard } from "@/hooks/useRosterBoard";
import { MultiSelectFilter, RangeFilter, FilterChips, parseHeight, formatHeight, playerHeightInches } from "@/components/Filters";
import { tierColor, PROJECTED_TIER_OPTIONS } from "@/lib/display";
import {
  IntlPlayerModal, AgentClientsPopup,
  AVERAGES_COLS, STAT_TYPE_COLS, STAT_TYPES, STAT_TYPE_LABELS,
  TIER_LABELS_FALLBACK, TIER_COLORS, TIER_BG,
  fmtStatByKey, getStat,
} from "@/components/IntlPlayerModal";

const PAGE_SIZE = 75;

// ── Main page ─────────────────────────────────────────────────────────────────
export function InternationalPage() {
  const { profile: userProfile, user } = useAuth();
  const userId = user?.id || "";
  const { activeTeam } = useAdminTeam(userProfile);
  const board = useRosterBoard(activeTeam, userId);

  const canAddToRoster = !!(activeTeam && userId);
  const rosterIds      = useMemo(() => new Set(board.state.roster.map(r => r.id)), [board.state.roster]);

  function handleAddIntlToRoster(intlProfile) {
    if (!intlProfile || !canAddToRoster) return;
    board.addIntlToRoster(intlProfile);
  }

  const [rows,         setRows]         = useState([]);
  const [profiles,     setProfiles]     = useState({});  // name → international_players row
  const [loading,      setLoading]      = useState(true);
  const [selected,     setSelected]     = useState(null);  // player_name
  const [searchInput,  setSearchInput]  = useState("");
  const [search,       setSearch]       = useState("");
  const [leagueFilter, setLeagueFilter] = useState([]);
  const [teamFilter,   setTeamFilter]   = useState("");
  const [tierFilter,   setTierFilter]   = useState([]);
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [posFilter,    setPosFilter]    = useState([]);
  const [classFilter,  setClassFilter]  = useState([]);
  const [projFilter,   setProjFilter]   = useState([]);
  const [heightMin,    setHeightMin]    = useState(null);
  const [heightMax,    setHeightMax]    = useState(null);
  const [ageMin,       setAgeMin]       = useState(null);
  const [ageMax,       setAgeMax]       = useState(null);
  const [statType,     setStatType]     = useState("Averages");
  const [sortKey,      setSortKey]      = useState("Projection");
  const [sortDir,      setSortDir]      = useState("desc");
  const [page,         setPage]         = useState(0);
  // "players" = the existing player-stats table; "agents" = browse by agent
  const [viewMode,     setViewMode]     = useState("players");
  const [agentSearch,  setAgentSearch]  = useState("");
  const [openAgent,    setOpenAgent]    = useState(null);   // agent_name whose client list popup is open

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => setPage(0), [search, leagueFilter, teamFilter, tierFilter, seasonFilter, posFilter, classFilter, projFilter, heightMin, heightMax, ageMin, ageMax, statType, sortKey, sortDir]);

  // ── Fetch stats ────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const fetchAll = async () => {
      const all = [];
      const PAGE = 1000;
      let p = 0;
      while (true) {
        const { data, error } = await supabase
          .from("international_players_stats")
          .select("player_name, league, season, season_type, stat_type, team, stats")
          .range(p * PAGE, (p + 1) * PAGE - 1);
        if (error) { console.error("international stats fetch:", error); break; }
        all.push(...(data || []));
        if ((data || []).length < PAGE) break;
        p++;
      }
      setRows(all);
      setLoading(false);
    };
    fetchAll();
  }, []);

  // ── Fetch player profiles ──────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from("international_players")
      // SELECT * so adding/removing columns in the DB doesn't break this fetch.
      .select("*")
      .then(({ data }) => {
        if (!data) return;
        const map = {};
        data.forEach(p => { map[p.name] = p; });
        setProfiles(map);
      });
  }, []);

  // ── Fetch tier labels (editable in admin) ──────────────────────────────────
  const [tierLabels, setTierLabels] = useState(TIER_LABELS_FALLBACK);
  useEffect(() => {
    supabase
      .from("international_tier_labels")
      .select("tier, label")
      .then(({ data }) => {
        if (!data?.length) return;
        const map = { ...TIER_LABELS_FALLBACK };
        data.forEach(r => { map[r.tier] = r.label; });
        setTierLabels(map);
      });
  }, []);

  // Derived filter options
  const leagues  = useMemo(() => [...new Set(rows.map(r => r.league))].sort(), [rows]);
  const seasons  = useMemo(() => [...new Set(rows.map(r => r.season))].sort((a, b) => b - a), [rows]);
  const positions = useMemo(() => {
    const ps = new Set();
    Object.values(profiles).forEach(p => { if (p.primary_position) ps.add(p.primary_position); });
    return [...ps].sort();
  }, [profiles]);
  const classes = useMemo(() => {
    const cs = new Set();
    Object.values(profiles).forEach(p => { if (p.recruiting_class) cs.add(p.recruiting_class); });
    return [...cs].sort();
  }, [profiles]);

  // Unique agents derived from profiles. Each entry tracks its client list +
  // a few summary stats so we can show "N clients · top tier" inline.
  const agents = useMemo(() => {
    const map = {};
    Object.values(profiles).forEach(p => {
      const name = (p.agent_name || "").trim();
      if (!name) return;
      if (!map[name]) map[name] = { name, contact: p.agent_contact || null, clients: [] };
      map[name].clients.push(p);
    });
    return Object.values(map)
      .map(a => {
        // Best-projected client and top translation grade for at-a-glance ranking
        const tgs = a.clients.map(c => c.metrics?.translation_grade).filter(v => v != null);
        return { ...a, topTG: tgs.length ? Math.max(...tgs) : null };
      })
      .sort((a, b) => b.clients.length - a.clients.length);
  }, [profiles]);

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.clients.some(c => (c.name || "").toLowerCase().includes(q))
    );
  }, [agents, agentSearch]);

  // ── Exactly one row per player profile. ────────────────────────────────────
  // Profiles drive the list (they're the source of truth — one row per
  // {name, league}). For each profile, attach the latest season's stats for
  // the active stat-type tab; if no matching stat row exists, render with
  // empty stats. Stat rows for the same (name, league) on OTHER seasons or
  // stat-types are NOT shown on the board — they're visible inside the modal,
  // which lists every season filtered by stat-type.
  //
  // Stat rows whose (name, league) doesn't match any profile (rare; usually a
  // scraper-side typo) still appear so nothing gets silently dropped.
  const combinedRows = useMemo(() => {
    // Step 1: index every stat row by (name|league|stat_type), keeping latest season.
    const statsByKey = new Map();
    for (const r of rows) {
      const key = `${r.player_name}|${r.league}|${r.stat_type}`;
      const cur = statsByKey.get(key);
      if (!cur || (r.season || 0) > (cur.season || 0)) {
        statsByKey.set(key, r);
      }
    }

    // Step 2: one row per profile.
    const profileRows = Object.values(profiles).map(p => {
      const key  = `${p.name}|${p.league}|${statType}`;
      const stat = statsByKey.get(key);
      if (stat) return stat;
      return {
        player_name: p.name,
        league:      p.league,
        team:        null,
        season:      null,
        season_type: null,
        stat_type:   statType,
        stats:       {},
        _profileOnly: true,
      };
    });

    // Step 3: any stat rows that don't match a profile by (name, league).
    const profileKeys = new Set(Object.values(profiles).map(p => `${p.name}|${p.league}`));
    const seenOrphans = new Set();
    const orphanStats = [];
    for (const r of rows) {
      if (r.stat_type !== statType) continue;
      const idKey = `${r.player_name}|${r.league}`;
      if (profileKeys.has(idKey)) continue;
      if (seenOrphans.has(idKey)) continue;
      seenOrphans.add(idKey);
      const statKey = `${r.player_name}|${r.league}|${statType}`;
      orphanStats.push(statsByKey.get(statKey));
    }

    return [...profileRows, ...orphanStats];
  }, [rows, profiles, statType]);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return combinedRows.filter(r => {
      if (r.stat_type !== statType) return false;
      if (leagueFilter.length && !leagueFilter.includes(r.league)) return false;
      if (seasonFilter !== "all" && !r._profileOnly && String(r.season) !== String(seasonFilter)) return false;
      if (teamFilter.trim() && !(r.team || "").toLowerCase().includes(teamFilter.trim().toLowerCase())) return false;
      if (q && !(r.player_name || "").toLowerCase().includes(q)) return false;
      const prof = profiles[r.player_name];
      if (tierFilter.length && !tierFilter.includes(String(prof?.competition_tier))) return false;
      if (posFilter.length  && !posFilter.includes(prof?.primary_position))         return false;
      if (classFilter.length && !classFilter.includes(prof?.recruiting_class))      return false;
      if (projFilter.length  && !projFilter.includes(prof?.projected_tier))         return false;
      if (heightMin != null || heightMax != null) {
        const inches = playerHeightInches(prof?.height);
        if (inches == null) return false;
        if (heightMin != null && inches < heightMin) return false;
        if (heightMax != null && inches > heightMax) return false;
      }
      if (ageMin != null || ageMax != null) {
        const a = prof?.age;
        if (a == null) return false;
        if (ageMin != null && a < ageMin) return false;
        if (ageMax != null && a > ageMax) return false;
      }
      return true;
    });
  }, [combinedRows, profiles, search, leagueFilter, teamFilter, tierFilter, seasonFilter, posFilter, classFilter, projFilter, heightMin, heightMax, ageMin, ageMax, statType]);

  // ── Sort ───────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortKey === "player_name" || sortKey === "team" || sortKey === "league") {
        const cmp = (a[sortKey] || "").toLowerCase().localeCompare((b[sortKey] || "").toLowerCase());
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "season") {
        const cmp = (a.season || 0) - (b.season || 0);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "tier") {
        const at = profiles[a.player_name]?.competition_tier ?? 99;
        const bt = profiles[b.player_name]?.competition_tier ?? 99;
        return sortDir === "asc" ? at - bt : bt - at;
      }
      if (sortKey === "projection") {
        // Higher tier (High Major + / Pre-Draft) sorts first when desc; rely on the
        // canonical PROJECTED_TIER_OPTIONS order from display.js.
        const order = PROJECTED_TIER_OPTIONS;
        const ar = order.indexOf(profiles[a.player_name]?.projected_tier ?? "");
        const br = order.indexOf(profiles[b.player_name]?.projected_tier ?? "");
        const ax = ar === -1 ? Infinity : ar;
        const bx = br === -1 ? Infinity : br;
        return sortDir === "asc" ? ax - bx : bx - ax;
      }
      const av = parseFloat(getStat(a.stats, sortKey));
      const bv = parseFloat(getStat(b.stats, sortKey));
      const cmp = (isNaN(av) ? -Infinity : av) - (isNaN(bv) ? -Infinity : bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, profiles, sortKey, sortDir]);

  const paginated  = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const statCols = STAT_TYPE_COLS[statType] ?? AVERAGES_COLS;

  const thStyle = (key) => ({
    padding: "8px 12px", fontWeight: 600, fontSize: 12, opacity: .5,
    textAlign: key === "player_name" || key === "team" ? "left" : "center",
    whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
    borderBottom: "1px solid rgba(255,255,255,.08)",
    background: sortKey === key ? "rgba(91,156,246,.07)" : "transparent",
  });
  const tdStyle = (align = "center") => ({
    padding: "8px 12px", textAlign: align, fontSize: 13,
    whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
    borderBottom: "1px solid rgba(255,255,255,.04)",
  });
  const sortArrow = (key) => sortKey === key
    ? <span style={{ marginLeft: 4, opacity: .6 }}>{sortDir === "asc" ? "↑" : "↓"}</span>
    : null;

  return (
    <>
      <SiteHeader />
      {selected && (
        <IntlPlayerModal
          profile={profiles[selected] || null}
          allRows={rows}
          tierLabels={tierLabels}
          onClose={() => setSelected(null)}
          onAddToRoster={handleAddIntlToRoster}
          alreadyOnRoster={!!(profiles[selected] && rosterIds.has(profiles[selected].id))}
          canAddToRoster={canAddToRoster}
          onSelectPlayer={(client) => {
            // Make sure the freshly-selected client's profile is in our local map
            // even if a slightly different copy lives there.
            if (client?.name) {
              setProfiles(prev => ({ ...prev, [client.name]: client }));
              setSelected(client.name);
            }
          }}
        />
      )}

      {openAgent && (
        <AgentClientsPopup
          agentName={openAgent}
          onClose={() => setOpenAgent(null)}
          onSelectPlayer={(client) => {
            setOpenAgent(null);
            if (client?.name) {
              setProfiles(prev => ({ ...prev, [client.name]: client }));
              setSelected(client.name);
            }
          }}
        />
      )}

      <div className="app-shell">
        <div className="app-top">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1 style={{ margin: 0 }}>International Players</h1>
            <div style={{ display: "flex", gap: 4 }}>
              {[["players", "Players"], ["agents", "Agents"]].map(([val, lbl]) => (
                <button key={val} onClick={() => setViewMode(val)} style={{
                  fontSize: 12, fontWeight: 600, padding: "4px 14px", borderRadius: 18, cursor: "pointer",
                  border: "1px solid",
                  background:  viewMode === val ? "rgba(91,156,246,.18)" : "transparent",
                  color:       viewMode === val ? "#5b9cf6" : "rgba(255,255,255,.45)",
                  borderColor: viewMode === val ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.12)",
                }}>{lbl}</button>
              ))}
            </div>
          </div>

          {/* ── Agents view ─────────────────────────────────────────────────── */}
          {viewMode === "agents" && (
            <div>
              <input className="input" type="search" placeholder="Search agents or clients…"
                style={{ width: "100%", maxWidth: 360, marginBottom: 14 }}
                value={agentSearch} onChange={e => setAgentSearch(e.target.value)} />
              <div style={{ fontSize: 12, opacity: .4, marginBottom: 10 }}>
                {filteredAgents.length} agent{filteredAgents.length === 1 ? "" : "s"} · click to view client list
              </div>
              <div style={{ border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, overflow: "hidden" }}>
                {filteredAgents.length === 0 ? (
                  <div style={{ padding: 32, textAlign: "center", opacity: .35, fontSize: 13 }}>
                    {loading ? "Loading…" : "No agents on file yet."}
                  </div>
                ) : filteredAgents.map((a, i) => (
                  <div key={a.name}
                    onClick={() => setOpenAgent(a.name)}
                    style={{
                      display: "grid", gridTemplateColumns: "1.6fr 90px 100px 1fr",
                      gap: 12, alignItems: "center",
                      padding: "12px 16px",
                      background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)",
                      borderBottom: i < filteredAgents.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none",
                      cursor: "pointer",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(91,156,246,.06)"}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)"}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
                    <div style={{ fontSize: 11, opacity: .55 }}>{a.clients.length} client{a.clients.length === 1 ? "" : "s"}</div>
                    <div style={{ fontSize: 11, opacity: .55 }}>
                      {a.topTG != null ? `top TG ${Math.round(a.topTG)}` : ""}
                    </div>
                    <div style={{ fontSize: 11, opacity: .45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.clients.slice(0, 4).map(c => c.name).join(" · ")}
                      {a.clients.length > 4 && ` · +${a.clients.length - 4} more`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stat type tabs */}
          {viewMode === "players" && (<>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {STAT_TYPES.map(t => (
              <button key={t} onClick={() => setStatType(t)} style={{
                fontSize: 12, fontWeight: 600, padding: "4px 14px", borderRadius: 20,
                cursor: "pointer", border: "1px solid", transition: "all .15s",
                background:  statType === t ? "rgba(91,156,246,.18)" : "transparent",
                color:       statType === t ? "#5b9cf6" : "rgba(255,255,255,.45)",
                borderColor: statType === t ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.12)",
              }}>
                {STAT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, alignItems: "center" }}>
            <input className="input" type="search" placeholder="Search players…"
              style={{ flex: 1, minWidth: 180 }}
              value={searchInput} onChange={e => setSearchInput(e.target.value)} />

            <input className="input" type="search" placeholder="Filter by team…"
              style={{ width: 160 }}
              value={teamFilter} onChange={e => setTeamFilter(e.target.value)} />

            <MultiSelectFilter label="leagues"   options={leagues}   value={leagueFilter} onChange={setLeagueFilter} width={170} />
            <MultiSelectFilter label="tiers"
              options={[1,2,3,4].map(t => ({ value: String(t), label: `Tier ${t} · ${tierLabels[t] || TIER_LABELS_FALLBACK[t]}` }))}
              value={tierFilter} onChange={setTierFilter} width={170} />
            {positions.length > 0 && (
              <MultiSelectFilter label="positions" options={positions} value={posFilter} onChange={setPosFilter} width={120} />
            )}
            {classes.length > 0 && (
              <MultiSelectFilter label="classes" options={classes} value={classFilter} onChange={setClassFilter} width={120} />
            )}
            <MultiSelectFilter label="projection" options={PROJECTED_TIER_OPTIONS}
              value={projFilter} onChange={setProjFilter} width={210} />
            <RangeFilter label="Ht"  min={heightMin} max={heightMax}
              onChange={(lo, hi) => { setHeightMin(lo); setHeightMax(hi); }}
              parse={parseHeight} format={formatHeight} placeholder={["min","max"]} width={55} />
            <RangeFilter label="Age" min={ageMin} max={ageMax}
              onChange={(lo, hi) => { setAgeMin(lo); setAgeMax(hi); }}
              placeholder={["min","max"]} width={45} />

            <select className="input" style={{ width: 120 }} value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)}>
              <option value="all">All seasons</option>
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <FilterChips
            items={[
              ...leagueFilter.map(v => ({ label: `League: ${v}`, onClear: () => setLeagueFilter(leagueFilter.filter(x => x !== v)) })),
              ...tierFilter.map(v   => ({ label: `Tier ${v}`,    onClear: () => setTierFilter(tierFilter.filter(x => x !== v)) })),
              ...posFilter.map(v    => ({ label: `Pos: ${v}`,    onClear: () => setPosFilter(posFilter.filter(x => x !== v)) })),
              ...classFilter.map(v  => ({ label: `Class: ${v}`,  onClear: () => setClassFilter(classFilter.filter(x => x !== v)) })),
              ...projFilter.map(v   => ({ label: `Proj: ${v}`,   onClear: () => setProjFilter(projFilter.filter(x => x !== v)) })),
              ...(heightMin != null ? [{ label: `Ht ≥ ${formatHeight(heightMin)}`, onClear: () => setHeightMin(null) }] : []),
              ...(heightMax != null ? [{ label: `Ht ≤ ${formatHeight(heightMax)}`, onClear: () => setHeightMax(null) }] : []),
              ...(ageMin != null    ? [{ label: `Age ≥ ${ageMin}`,                onClear: () => setAgeMin(null)    }] : []),
              ...(ageMax != null    ? [{ label: `Age ≤ ${ageMax}`,                onClear: () => setAgeMax(null)    }] : []),
              ...(teamFilter.trim() ? [{ label: `Team: ${teamFilter}`,           onClear: () => setTeamFilter("")   }] : []),
              ...(seasonFilter !== "all" ? [{ label: `Season: ${seasonFilter}`,  onClear: () => setSeasonFilter("all") }] : []),
            ]}
            onClearAll={() => {
              setLeagueFilter([]); setTierFilter([]); setPosFilter([]); setClassFilter([]); setProjFilter([]);
              setHeightMin(null); setHeightMax(null); setAgeMin(null); setAgeMax(null);
              setTeamFilter(""); setSeasonFilter("all");
            }}
          />

          <div style={{ fontSize: 12, opacity: .4, marginBottom: 10 }}>
            {loading ? "Loading…" : `${sorted.length} player${sorted.length === 1 ? "" : "s"}`}
            {" · click a row to view profile"}
          </div>
          </>
          )}
        </div>

        {/* Table */}
        {viewMode === "players" && (<>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle("player_name")} onClick={() => handleSort("player_name")}>Player{sortArrow("player_name")}</th>
                <th style={thStyle("team")}        onClick={() => handleSort("team")}>Team{sortArrow("team")}</th>
                <th style={thStyle("league")}      onClick={() => handleSort("league")}>League{sortArrow("league")}</th>
                <th style={thStyle("tier")}        onClick={() => handleSort("tier")}>Tier{sortArrow("tier")}</th>
                <th style={thStyle("projection")}  onClick={() => handleSort("projection")}>Projection{sortArrow("projection")}</th>
                <th style={thStyle("season")}      onClick={() => handleSort("season")}>Season{sortArrow("season")}</th>
                {statCols.map(c => (
                  <th key={c.key} style={thStyle(c.key)} onClick={() => handleSort(c.key)}>
                    {c.label}{sortArrow(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5 + statCols.length} style={{ padding: 32, textAlign: "center", opacity: .4 }}>Loading…</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={5 + statCols.length} style={{ padding: 32, textAlign: "center", opacity: .4 }}>No players found.</td></tr>
              ) : paginated.map((r, i) => {
                const prof = profiles[r.player_name];
                const tier = prof?.competition_tier;
                return (
                  <tr key={i}
                    onClick={() => setSelected(r.player_name)}
                    style={{
                      background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)",
                      cursor: "pointer",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(91,156,246,.06)"}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)"}
                  >
                    <td style={{ ...tdStyle("left"), fontWeight: 600 }}>
                      <div>{r.player_name}</div>
                      {prof?.primary_position && (
                        <div style={{ fontSize: 10, opacity: .4, fontWeight: 400 }}>{prof.primary_position}{prof.height ? ` · ${prof.height}` : ""}</div>
                      )}
                    </td>
                    <td style={{ ...tdStyle("left"), opacity: .7 }}>{r.team || "—"}</td>
                    <td style={{ ...tdStyle("left"), opacity: .55, fontSize: 12 }}>{r.league}</td>
                    <td style={{ ...tdStyle() }}>
                      {tier ? (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                          background: TIER_BG[tier], color: TIER_COLORS[tier],
                        }}>T{tier}</span>
                      ) : "—"}
                    </td>
                    <td style={{ ...tdStyle("left"), opacity: .8 }}>
                      {prof?.projected_tier ? (() => {
                        const c = tierColor(prof.projected_tier);
                        return (
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 10,
                            background: `${c}1f`, color: c, border: `1px solid ${c}55`,
                            whiteSpace: "nowrap",
                          }}>{prof.projected_tier}</span>
                        );
                      })() : <span style={{ opacity: .25 }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle(), opacity: .6 }}>{r.season || "—"}</td>
                    {statCols.map(c => (
                      <td key={c.key} style={tdStyle()}>
                        {fmtStatByKey(getStat(r.stats, c.key), c.key)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "24px 0", fontSize: 13 }}>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ opacity: .5 }}>Page {page + 1} of {totalPages}</span>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
        </>)}
      </div>
    </>
  );
}
