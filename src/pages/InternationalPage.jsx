import { useState, useEffect, useMemo } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { supabase }   from "@/lib/supabase";

// Stat columns to display for each stat type
const AVERAGES_COLS = [
  { key: "gp",   label: "GP"  },
  { key: "min",  label: "MIN" },
  { key: "pts",  label: "PTS" },
  { key: "reb",  label: "REB" },
  { key: "ast",  label: "AST" },
  { key: "stl",  label: "STL" },
  { key: "blk",  label: "BLK" },
  { key: "to",   label: "TO"  },
  { key: "fg%",  label: "FG%" },
  { key: "3p%",  label: "3P%" },
  { key: "ft%",  label: "FT%" },
];

const ADVANCED_COLS = [
  { key: "gp",    label: "GP"   },
  { key: "min",   label: "MIN"  },
  { key: "ortg",  label: "ORtg" },
  { key: "drtg",  label: "DRtg" },
  { key: "per",   label: "PER"  },
  { key: "ts%",   label: "TS%"  },
  { key: "efg%",  label: "eFG%" },
  { key: "usg%",  label: "USG%" },
  { key: "ast%",  label: "AST%" },
  { key: "to%",   label: "TO%"  },
  { key: "orb%",  label: "ORB%" },
  { key: "drb%",  label: "DRB%" },
];

const TOTALS_COLS = [
  { key: "gp",  label: "GP"  },
  { key: "min", label: "MIN" },
  { key: "pts", label: "PTS" },
  { key: "reb", label: "REB" },
  { key: "ast", label: "AST" },
  { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" },
  { key: "to",  label: "TO"  },
  { key: "fgm", label: "FGM" },
  { key: "fga", label: "FGA" },
  { key: "3pm", label: "3PM" },
  { key: "3pa", label: "3PA" },
];

const STAT_TYPE_COLS = {
  Averages:      AVERAGES_COLS,
  Totals:        TOTALS_COLS,
  Per_36:        AVERAGES_COLS,
  Advanced_Stats: ADVANCED_COLS,
};

const STAT_TYPES = ["Averages", "Totals", "Per_36", "Advanced_Stats"];
const STAT_TYPE_LABELS = {
  Averages:      "Averages",
  Totals:        "Totals",
  Per_36:        "Per 36",
  Advanced_Stats: "Advanced",
};

const PCT_KEYS = new Set(["fg%","3p%","ft%","ts%","efg%","usg%","ast%","to%","orb%","drb%"]);

function fmtStat(val) {
  if (val === null || val === undefined || val === "") return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return PCT_KEYS.has("") ? n.toFixed(1) : n % 1 === 0 ? String(n) : n.toFixed(1);
}

function fmtStatByKey(val, key) {
  if (val === null || val === undefined || val === "") return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  if (PCT_KEYS.has(key)) {
    // RealGM stores pct as decimal (e.g. .474) or as whole number (47.4) — normalise
    const display = n < 1.5 ? (n * 100).toFixed(1) : n.toFixed(1);
    return `${display}%`;
  }
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

const PAGE_SIZE = 75;

export function InternationalPage() {
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [teamFilter,   setTeamFilter]   = useState("");
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [statType,     setStatType]     = useState("Averages");
  const [sortKey,      setSortKey]      = useState("pts");
  const [sortDir,      setSortDir]      = useState("desc");
  const [page,         setPage]         = useState(0);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => setPage(0), [search, leagueFilter, teamFilter, seasonFilter, statType, sortKey, sortDir]);

  // ── Fetch ──────────────────────────────────────────────────────────────────
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

  // Derived filter options
  const leagues = useMemo(() => [...new Set(rows.map(r => r.league))].sort(), [rows]);
  const seasons = useMemo(() => [...new Set(rows.map(r => r.season))].sort((a, b) => b - a), [rows]);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (r.stat_type !== statType) return false;
      if (leagueFilter !== "all" && r.league !== leagueFilter) return false;
      if (seasonFilter !== "all" && String(r.season) !== String(seasonFilter)) return false;
      if (teamFilter.trim() && !(r.team || "").toLowerCase().includes(teamFilter.trim().toLowerCase())) return false;
      if (q && !(r.player_name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, leagueFilter, teamFilter, seasonFilter, statType]);

  // ── Sort ───────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av, bv;
      if (sortKey === "player_name" || sortKey === "team" || sortKey === "league") {
        av = (a[sortKey] || "").toLowerCase();
        bv = (b[sortKey] || "").toLowerCase();
        const cmp = av.localeCompare(bv);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "season") {
        const cmp = (a.season || 0) - (b.season || 0);
        return sortDir === "asc" ? cmp : -cmp;
      }
      av = parseFloat(a.stats?.[sortKey]);
      bv = parseFloat(b.stats?.[sortKey]);
      const an = isNaN(av) ? -Infinity : av;
      const bn = isNaN(bv) ? -Infinity : bv;
      const cmp = an - bn;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const statCols = STAT_TYPE_COLS[statType] ?? AVERAGES_COLS;

  const thStyle = (key) => ({
    padding: "8px 12px",
    textAlign: key === "player_name" || key === "team" ? "left" : "center",
    fontWeight: 600,
    fontSize: 12,
    opacity: .5,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    borderBottom: "1px solid rgba(255,255,255,.08)",
    background: sortKey === key ? "rgba(91,156,246,.07)" : "transparent",
  });

  const tdStyle = (align = "center") => ({
    padding: "7px 12px",
    textAlign: align,
    fontSize: 13,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    borderBottom: "1px solid rgba(255,255,255,.04)",
  });

  function sortArrow(key) {
    if (sortKey !== key) return null;
    return <span style={{ marginLeft: 4, opacity: .6 }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  return (
    <>
      <SiteHeader />
      <div className="app-shell">
        <div className="app-top">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1 style={{ margin: 0 }}>International Players</h1>
          </div>

          {/* Stat type tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {STAT_TYPES.map(t => (
              <button key={t} onClick={() => setStatType(t)} style={{
                fontSize: 12, fontWeight: 600, padding: "4px 14px", borderRadius: 20, cursor: "pointer", border: "1px solid",
                background:   statType === t ? "rgba(91,156,246,.18)" : "transparent",
                color:        statType === t ? "#5b9cf6" : "rgba(255,255,255,.45)",
                borderColor:  statType === t ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.12)",
                transition: "all .15s",
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
              style={{ width: 180 }}
              value={teamFilter} onChange={e => setTeamFilter(e.target.value)} />

            <select className="input" style={{ width: 180 }} value={leagueFilter} onChange={e => setLeagueFilter(e.target.value)}>
              <option value="all">All leagues</option>
              {leagues.map(l => <option key={l} value={l}>{l}</option>)}
            </select>

            <select className="input" style={{ width: 120 }} value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)}>
              <option value="all">All seasons</option>
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ fontSize: 12, opacity: .4, marginBottom: 10 }}>
            {loading ? "Loading…" : `${sorted.length} players`}
            {" · click a column header to sort"}
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle("player_name")} onClick={() => handleSort("player_name")}>
                  Player{sortArrow("player_name")}
                </th>
                <th style={thStyle("team")} onClick={() => handleSort("team")}>
                  Team{sortArrow("team")}
                </th>
                <th style={thStyle("league")} onClick={() => handleSort("league")}>
                  League{sortArrow("league")}
                </th>
                <th style={thStyle("season")} onClick={() => handleSort("season")}>
                  Season{sortArrow("season")}
                </th>
                {statCols.map(c => (
                  <th key={c.key} style={thStyle(c.key)} onClick={() => handleSort(c.key)}>
                    {c.label}{sortArrow(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4 + statCols.length} style={{ padding: 32, textAlign: "center", opacity: .4 }}>Loading…</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={4 + statCols.length} style={{ padding: 32, textAlign: "center", opacity: .4 }}>No players found.</td></tr>
              ) : paginated.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)" }}>
                  <td style={{ ...tdStyle("left"), fontWeight: 600 }}>{r.player_name}</td>
                  <td style={{ ...tdStyle("left"), opacity: .7 }}>{r.team}</td>
                  <td style={{ ...tdStyle("left"), opacity: .55, fontSize: 12 }}>{r.league}</td>
                  <td style={{ ...tdStyle(), opacity: .6 }}>{r.season}</td>
                  {statCols.map(c => (
                    <td key={c.key} style={tdStyle()}>
                      {fmtStatByKey(r.stats?.[c.key], c.key)}
                    </td>
                  ))}
                </tr>
              ))}
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
