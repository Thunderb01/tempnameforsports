import { useState, useEffect, useMemo, useCallback } from "react";
import { SiteHeader }  from "@/components/SiteHeader";
import { PlayerModal } from "@/components/PlayerModal";
import { supabase }    from "@/lib/supabase";
import { letterGrade, gradeColor } from "@/lib/display";

const CURRENT_YEAR = 2025;
const FIRST_YEAR   = 2009;
const YEARS = Array.from({ length: CURRENT_YEAR - FIRST_YEAR + 1 }, (_, i) => CURRENT_YEAR - i);

const METRIC_COLS = [
  { key: "sei", label: "SEI" },
  { key: "ath", label: "ATH" },
  { key: "ris", label: "RIS" },
  { key: "dds", label: "DDS" },
  { key: "cdi", label: "CDI" },
];

// Build the object PlayerModal expects. Metrics + box stats go inline in `stats`
// so the modal's inline-stats fallback renders the skill-profile pentagon (these
// players aren't in player_stats).
function toModalPlayer(r) {
  return {
    id:       r.id,
    name:     r.name,
    team:     r.team,
    conf:     r.conf,
    pos:      r.pos,
    year:     r.class_yr,
    height:   r.height,
    hometown: r.hometown,
    espn_id:  null,
    stats: {
      sei: r.sei, ath: r.ath, ris: r.ris, dds: r.dds, cdi: r.cdi,
      ppg: r.ppg, rpg: r.rpg, apg: r.apg, "3p_pct": r["3p_pct"],
      torvik_usg: r.torvik_usg, torvik_ts: r.torvik_ts, torvik_efg: r.torvik_efg,
      torvik_ast_pct: r.torvik_ast_pct, torvik_to_pct: r.torvik_to_pct,
      torvik_blk_pct: r.torvik_blk_pct, torvik_stl_pct: r.torvik_stl_pct,
      torvik_orb_pct: r.torvik_orb_pct, torvik_drb_pct: r.torvik_drb_pct,
    },
  };
}

export function HistoricalPage() {
  const [year,    setYear]    = useState(CURRENT_YEAR);
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [sortKey, setSortKey] = useState("sei");
  const [sortDir, setSortDir] = useState("desc");
  const [modal,   setModal]   = useState(null);

  // Load the selected season's players (only when this page is mounted / year changes).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const PAGE = 1000;
      let from = 0, all = [];
      for (;;) {
        const { data, error } = await supabase
          .from("historical_stats")
          .select("*")
          .eq("year", year)
          .range(from, from + PAGE - 1);
        if (error) { console.error("historical fetch:", error); break; }
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      if (alive) { setRows(all); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [year]);

  function handleSort(key) {
    setSortDir(d => sortKey === key && d === "desc" ? "asc" : "desc");
    setSortKey(key);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows;
    if (q) out = rows.filter(r =>
      (r.name || "").toLowerCase().includes(q) || (r.team || "").toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "string" || typeof bv === "string")
        return dir * String(av ?? "").localeCompare(String(bv ?? ""));
      return dir * ((av ?? -Infinity) - (bv ?? -Infinity));
    });
  }, [rows, search, sortKey, sortDir]);

  const shown = filtered.slice(0, 200);

  const Th = ({ k, label, w }) => (
    <th onClick={() => handleSort(k)} style={{ ...thStyle, cursor: "pointer", width: w }}>
      {label} <span style={{ opacity: sortKey === k ? 1 : .25 }}>{sortKey === k && sortDir === "asc" ? "▲" : "▼"}</span>
    </th>
  );

  return (
    <>
      <SiteHeader />
      <div className="app-shell">
        <div className="app-top">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0 }}>Time Machine</h1>
              <p className="muted" style={{ margin: "4px 0 0" }}>Beyond the Portal metrics for past players, back to 2009.</p>
            </div>
            <select className="input" style={{ width: 120 }} value={year} onChange={e => setYear(Number(e.target.value))}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div style={{ fontSize: 11, opacity: .5, fontStyle: "italic", marginTop: 10, maxWidth: 720 }}>
            Metrics are percentile ranks <strong>within each season</strong> — comparable within a
            year, not across eras (yet). A production-based estimate, not verified market data.
          </div>

          <input className="input" type="search" placeholder="Search player or team…"
            style={{ width: "100%", maxWidth: 360, marginTop: 14 }}
            value={search} onChange={e => setSearch(e.target.value)} />

          <div style={{ fontSize: 12, opacity: .45, margin: "10px 0 4px" }}>
            {loading ? "Loading…" : `${filtered.length} players · ${year}${filtered.length > 200 ? " (showing top 200 — refine search)" : ""}`}
          </div>
        </div>

        {!loading && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <Th k="name" label="Player" />
                  <Th k="team" label="Team" />
                  <th style={thStyle}>Conf</th>
                  <th style={thStyle}>Cl</th>
                  <th style={thStyle}>Pos</th>
                  {METRIC_COLS.map(m => <Th key={m.key} k={m.key} label={m.label} w={52} />)}
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} className="row-click"
                    style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                    onClick={() => setModal(toModalPlayer(r))}>
                    <td style={tdStyle}>{r.name}</td>
                    <td style={{ ...tdStyle, opacity: .8 }}>{r.team}</td>
                    <td style={{ ...tdStyle, opacity: .5, fontSize: 12 }}>{r.conf}</td>
                    <td style={{ ...tdStyle, opacity: .5, fontSize: 12 }}>{r.class_yr}</td>
                    <td style={{ ...tdStyle, opacity: .6, fontSize: 12 }}>{r.pos}</td>
                    {METRIC_COLS.map(m => {
                      const v = r[m.key];
                      const c = gradeColor(letterGrade(v));
                      return <td key={m.key} style={{ ...tdStyle, textAlign: "center", fontWeight: 700, color: c }}>
                        {v != null ? Math.round(v) : "—"}
                      </td>;
                    })}
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={10} style={{ ...tdStyle, opacity: .4, textAlign: "center", padding: 24 }}>
                    No players match.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ height: 40 }} />
      </div>

      {modal && <PlayerModal player={modal} onClose={() => setModal(null)} />}
    </>
  );
}

const thStyle = {
  padding: "9px 12px", textAlign: "left", background: "rgba(0,0,0,.5)",
  position: "sticky", top: 0, whiteSpace: "nowrap", borderBottom: "1px solid var(--border)",
  fontWeight: 500, fontSize: 12,
};
const tdStyle = { padding: "8px 12px", whiteSpace: "nowrap", verticalAlign: "middle" };
