import { useState, useEffect, useMemo } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { supabase }   from "@/lib/supabase";

// ── Stat column definitions ───────────────────────────────────────────────────
const AVERAGES_COLS = [
  { key: "gp",  label: "GP"  }, { key: "min", label: "MIN" }, { key: "pts", label: "PTS" },
  { key: "reb", label: "REB" }, { key: "ast", label: "AST" }, { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" }, { key: "to",  label: "TO"  }, { key: "fg%", label: "FG%" },
  { key: "3p%", label: "3P%" }, { key: "ft%", label: "FT%" },
];
const ADVANCED_COLS = [
  { key: "gp",   label: "GP"   }, { key: "min",  label: "MIN"  }, { key: "ortg", label: "ORtg" },
  { key: "drtg", label: "DRtg" }, { key: "per",  label: "PER"  }, { key: "ts%",  label: "TS%"  },
  { key: "efg%", label: "eFG%" }, { key: "usg%", label: "USG%" }, { key: "ast%", label: "AST%" },
  { key: "to%",  label: "TO%"  }, { key: "orb%", label: "ORB%" }, { key: "drb%", label: "DRB%" },
];
const TOTALS_COLS = [
  { key: "gp",  label: "GP"  }, { key: "min", label: "MIN" }, { key: "pts", label: "PTS" },
  { key: "reb", label: "REB" }, { key: "ast", label: "AST" }, { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" }, { key: "to",  label: "TO"  }, { key: "fgm", label: "FGM" },
  { key: "fga", label: "FGA" }, { key: "3pm", label: "3PM" }, { key: "3pa", label: "3PA" },
];
const STAT_TYPE_COLS   = { Averages: AVERAGES_COLS, Totals: TOTALS_COLS, Per_36: AVERAGES_COLS, Advanced_Stats: ADVANCED_COLS };
const STAT_TYPES       = ["Averages", "Totals", "Per_36", "Advanced_Stats"];
const STAT_TYPE_LABELS = { Averages: "Averages", Totals: "Totals", Per_36: "Per 36", Advanced_Stats: "Advanced" };
const PCT_KEYS         = new Set(["fg%","3p%","ft%","ts%","efg%","usg%","ast%","to%","orb%","drb%"]);
const PAGE_SIZE        = 75;

// ── Competition tiers ─────────────────────────────────────────────────────────
const TIER_LABELS = { 1: "EuroLeague / Elite", 2: "Top Domestic", 3: "Mid Domestic", 4: "Developmental" };
const TIER_COLORS = { 1: "#f59e0b", 2: "#5b9cf6", 3: "#4ade80", 4: "#9ca3af" };
const TIER_BG     = { 1: "rgba(245,158,11,.15)", 2: "rgba(91,156,246,.15)", 3: "rgba(74,222,128,.15)", 4: "rgba(156,163,175,.12)" };

// ── BTP-style metrics shown in the profile ────────────────────────────────────
const INTL_METRICS = [
  { key: "offensive_footprint", label: "Offensive Footprint", desc: "Scoring volume × efficiency × creation" },
  { key: "defensive_score",     label: "Defensive Score",     desc: "Rim protection + perimeter D + disruption rate" },
  { key: "winning_impact",      label: "Winning Impact",      desc: "Performance uplift in wins vs losses" },
  { key: "sos_performance",     label: "SOS Performance",     desc: "Output scaled for strength of schedule" },
  { key: "starter_score",       label: "Starter Grade",       desc: "Production as starter vs off the bench" },
  { key: "competition_adj",     label: "Competition Adj.",    desc: "Score normalised to competition tier" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtStatByKey(val, key) {
  if (val === null || val === undefined || val === "") return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  if (PCT_KEYS.has(key)) {
    const display = n < 1.5 ? (n * 100).toFixed(1) : n.toFixed(1);
    return `${display}%`;
  }
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function metricColor(val) {
  if (val == null) return "rgba(255,255,255,.15)";
  if (val >= 70) return "#4ade80";
  if (val >= 50) return "#fcd34d";
  return "#f87171";
}

function getYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|[?&]v=)([^&\s]{11})/);
  return m?.[1] ?? null;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function MetricBar({ label, desc, value }) {
  const color = metricColor(value);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, opacity: .85 }}>{label}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
          {value != null ? Math.round(value) : "—"}
        </span>
      </div>
      <div style={{ height: 5, background: "rgba(255,255,255,.08)", borderRadius: 3 }}>
        <div style={{ width: `${Math.min(value ?? 0, 100)}%`, height: "100%", background: color, borderRadius: 3, transition: "width .4s ease" }} />
      </div>
      <div style={{ fontSize: 10, opacity: .32, marginTop: 3 }}>{desc}</div>
    </div>
  );
}

function TierBadge({ tier }) {
  if (!tier) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
      background: TIER_BG[tier], color: TIER_COLORS[tier],
      border: `1px solid ${TIER_COLORS[tier]}55`,
    }}>
      Tier {tier} · {TIER_LABELS[tier]}
    </span>
  );
}

function IntlPlayerModal({ playerName, allRows, profile, onClose }) {
  const [statType, setStatType] = useState("Averages");
  const metrics  = profile?.metrics || {};
  const tier     = profile?.competition_tier;
  const ytId     = getYouTubeId(profile?.film_url);

  const playerRows = useMemo(() =>
    allRows.filter(r => r.player_name === playerName && r.stat_type === statType)
           .sort((a, b) => (b.season || 0) - (a.season || 0)),
    [allRows, playerName, statType]
  );

  const statCols = STAT_TYPE_COLS[statType] ?? AVERAGES_COLS;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 1000, overflowY: "auto", padding: "32px 16px" }}
      onClick={onClose}
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ background: "var(--bg, #0e1521)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: 28 }}>

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
            <div>
              <h2 style={{ margin: "0 0 8px", fontSize: 24 }}>{playerName}</h2>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {profile?.height         && <span style={{ fontSize: 13, opacity: .55 }}>{profile.height}</span>}
                {profile?.primary_position && <span style={{ fontSize: 13, opacity: .55 }}>· {profile.primary_position}</span>}
                {profile?.league          && <span style={{ fontSize: 13, opacity: .55 }}>· {profile.league}</span>}
                {tier && <TierBadge tier={tier} />}
              </div>
              {profile?.profile_url && (
                <a href={profile.profile_url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11, color: "#5b9cf6", opacity: .7, marginTop: 6, display: "inline-block" }}>
                  RealGM Profile ↗
                </a>
              )}
            </div>
            <button onClick={onClose} style={{
              background: "none", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8,
              color: "rgba(255,255,255,.5)", cursor: "pointer", fontSize: 16, padding: "4px 10px",
            }}>✕</button>
          </div>

          {/* ── Metrics ────────────────────────────────────────────────────── */}
          <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, padding: "16px 20px", marginBottom: 20 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em", opacity: .35, fontWeight: 600, marginBottom: 14 }}>
              BTP International Metrics
            </div>
            {INTL_METRICS.some(m => metrics[m.key] != null) ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px 32px" }}>
                {INTL_METRICS.map(m => <MetricBar key={m.key} label={m.label} desc={m.desc} value={metrics[m.key]} />)}
              </div>
            ) : (
              <div style={{ fontSize: 12, opacity: .3, textAlign: "center", padding: "12px 0" }}>
                Metrics not yet evaluated for this player.
              </div>
            )}
          </div>

          {/* ── Two-column: Film + Agent ────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

            {/* Film */}
            <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, padding: "16px 20px" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em", opacity: .35, fontWeight: 600, marginBottom: 12 }}>Film</div>
              {ytId ? (
                <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, borderRadius: 8, overflow: "hidden" }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${ytId}`}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Player film"
                  />
                </div>
              ) : profile?.film_url ? (
                <a href={profile.film_url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 13, color: "#5b9cf6", display: "flex", alignItems: "center", gap: 6 }}>
                  ▶ View Film ↗
                </a>
              ) : (
                <div style={{ fontSize: 12, opacity: .3 }}>No film linked yet.</div>
              )}
            </div>

            {/* Agent */}
            <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, padding: "16px 20px" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em", opacity: .35, fontWeight: 600, marginBottom: 12 }}>Agent</div>
              {profile?.agent_name ? (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{profile.agent_name}</div>
                  <div style={{ position: "relative", marginBottom: 12 }}>
                    <div style={{ fontSize: 12, opacity: .6, filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}>
                      {profile.agent_contact || "contact@agency.com"}
                    </div>
                    <div style={{
                      position: "absolute", inset: 0, display: "flex", alignItems: "center",
                      fontSize: 10, fontWeight: 600, opacity: .45, letterSpacing: ".05em",
                    }}>
                      CONTACT INFO PROTECTED
                    </div>
                  </div>
                  <button style={{
                    fontSize: 12, fontWeight: 600, padding: "6px 16px", borderRadius: 8, cursor: "pointer",
                    background: "rgba(91,156,246,.15)", color: "#5b9cf6", border: "1px solid rgba(91,156,246,.4)",
                  }}>
                    Contact Us to Connect
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: .3 }}>No agent info on file.</div>
              )}
            </div>
          </div>

          {/* ── Stats ──────────────────────────────────────────────────────── */}
          <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.07)", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em", opacity: .35, fontWeight: 600, marginRight: 8 }}>Stats</span>
              {STAT_TYPES.map(t => (
                <button key={t} onClick={() => setStatType(t)} style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 16, cursor: "pointer", border: "1px solid",
                  background:  statType === t ? "rgba(91,156,246,.18)" : "transparent",
                  color:       statType === t ? "#5b9cf6" : "rgba(255,255,255,.4)",
                  borderColor: statType === t ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.1)",
                }}>
                  {STAT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "8px 12px", textAlign: "left", opacity: .4, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,.07)" }}>Season</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", opacity: .4, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,.07)" }}>Team</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", opacity: .4, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,.07)" }}>Type</th>
                    {statCols.map(c => (
                      <th key={c.key} style={{ padding: "8px 10px", textAlign: "center", opacity: .4, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {playerRows.length === 0 ? (
                    <tr><td colSpan={3 + statCols.length} style={{ padding: 24, textAlign: "center", opacity: .3 }}>No stats available.</td></tr>
                  ) : playerRows.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)" }}>
                      <td style={{ padding: "7px 12px", opacity: .7, whiteSpace: "nowrap" }}>{r.season}</td>
                      <td style={{ padding: "7px 12px", opacity: .6, whiteSpace: "nowrap" }}>{r.team}</td>
                      <td style={{ padding: "7px 12px", opacity: .45, fontSize: 11, whiteSpace: "nowrap" }}>{r.season_type?.replace(/_/g, " ")}</td>
                      {statCols.map(c => (
                        <td key={c.key} style={{ padding: "7px 10px", textAlign: "center", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                          {fmtStatByKey(r.stats?.[c.key], c.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function InternationalPage() {
  const [rows,         setRows]         = useState([]);
  const [profiles,     setProfiles]     = useState({});  // name → international_players row
  const [loading,      setLoading]      = useState(true);
  const [selected,     setSelected]     = useState(null);  // player_name
  const [searchInput,  setSearchInput]  = useState("");
  const [search,       setSearch]       = useState("");
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [teamFilter,   setTeamFilter]   = useState("");
  const [tierFilter,   setTierFilter]   = useState("all");
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [posFilter,    setPosFilter]    = useState("all");
  const [statType,     setStatType]     = useState("Averages");
  const [sortKey,      setSortKey]      = useState("pts");
  const [sortDir,      setSortDir]      = useState("desc");
  const [page,         setPage]         = useState(0);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => setPage(0), [search, leagueFilter, teamFilter, tierFilter, seasonFilter, posFilter, statType, sortKey, sortDir]);

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
      .select("id, name, league, profile_url, height, primary_position, agent_name, agent_contact, film_url, competition_tier, metrics")
      .then(({ data }) => {
        if (!data) return;
        const map = {};
        data.forEach(p => { map[p.name] = p; });
        setProfiles(map);
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

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (r.stat_type !== statType) return false;
      if (leagueFilter !== "all" && r.league !== leagueFilter) return false;
      if (seasonFilter !== "all" && String(r.season) !== String(seasonFilter)) return false;
      if (teamFilter.trim() && !(r.team || "").toLowerCase().includes(teamFilter.trim().toLowerCase())) return false;
      if (q && !(r.player_name || "").toLowerCase().includes(q)) return false;
      if (tierFilter !== "all") {
        const tier = profiles[r.player_name]?.competition_tier;
        if (String(tier) !== tierFilter) return false;
      }
      if (posFilter !== "all") {
        const pos = profiles[r.player_name]?.primary_position;
        if (pos !== posFilter) return false;
      }
      return true;
    });
  }, [rows, profiles, search, leagueFilter, teamFilter, tierFilter, seasonFilter, posFilter, statType]);

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
      const av = parseFloat(a.stats?.[sortKey]);
      const bv = parseFloat(b.stats?.[sortKey]);
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
          playerName={selected}
          allRows={rows}
          profile={profiles[selected] || null}
          onClose={() => setSelected(null)}
        />
      )}

      <div className="app-shell">
        <div className="app-top">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1 style={{ margin: 0 }}>International Players</h1>
          </div>

          {/* Stat type tabs */}
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <input className="input" type="search" placeholder="Search players…"
              style={{ flex: 1, minWidth: 180 }}
              value={searchInput} onChange={e => setSearchInput(e.target.value)} />

            <input className="input" type="search" placeholder="Filter by team…"
              style={{ width: 160 }}
              value={teamFilter} onChange={e => setTeamFilter(e.target.value)} />

            <select className="input" style={{ width: 180 }} value={leagueFilter} onChange={e => setLeagueFilter(e.target.value)}>
              <option value="all">All leagues</option>
              {leagues.map(l => <option key={l} value={l}>{l}</option>)}
            </select>

            <select className="input" style={{ width: 120 }} value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)}>
              <option value="all">All seasons</option>
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            <select className="input" style={{ width: 150 }} value={tierFilter} onChange={e => setTierFilter(e.target.value)}>
              <option value="all">All tiers</option>
              {[1,2,3,4].map(t => <option key={t} value={String(t)}>Tier {t} · {TIER_LABELS[t]}</option>)}
            </select>

            {positions.length > 0 && (
              <select className="input" style={{ width: 120 }} value={posFilter} onChange={e => setPosFilter(e.target.value)}>
                <option value="all">All positions</option>
                {positions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          <div style={{ fontSize: 12, opacity: .4, marginBottom: 10 }}>
            {loading ? "Loading…" : `${sorted.length} player-seasons`}
            {" · click a row to view profile"}
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle("player_name")} onClick={() => handleSort("player_name")}>Player{sortArrow("player_name")}</th>
                <th style={thStyle("team")}        onClick={() => handleSort("team")}>Team{sortArrow("team")}</th>
                <th style={thStyle("league")}      onClick={() => handleSort("league")}>League{sortArrow("league")}</th>
                <th style={thStyle("tier")}        onClick={() => handleSort("tier")}>Tier{sortArrow("tier")}</th>
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
                    <td style={{ ...tdStyle("left"), opacity: .7 }}>{r.team}</td>
                    <td style={{ ...tdStyle("left"), opacity: .55, fontSize: 12 }}>{r.league}</td>
                    <td style={{ ...tdStyle() }}>
                      {tier ? (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                          background: TIER_BG[tier], color: TIER_COLORS[tier],
                        }}>T{tier}</span>
                      ) : "—"}
                    </td>
                    <td style={{ ...tdStyle(), opacity: .6 }}>{r.season}</td>
                    {statCols.map(c => (
                      <td key={c.key} style={tdStyle()}>
                        {fmtStatByKey(r.stats?.[c.key], c.key)}
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
      </div>
    </>
  );
}
