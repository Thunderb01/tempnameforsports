import { useState, useEffect, useMemo } from "react";
import { SiteHeader }  from "@/components/SiteHeader";
import { PlayerModal } from "@/components/PlayerModal";
import { BoardPage }   from "@/pages/BoardPage";
import { supabase }    from "@/lib/supabase";
import { letterGrade, gradeColor, money, overallRating, overallColor } from "@/lib/display";
import { useNilVisible } from "@/hooks/useNilVisible";

const FIRST_YEAR = 2009; // historical_stats coverage starts here — genuinely fixed, not a season-rollover value

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
    marketLow:    r.open_market_low,
    marketHigh:   r.open_market_high,
    nilValuation: r.nil_valuation,
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

// Time Machine shows two eras of data, back to back in the same year dropdown:
//
//   - "Archive" seasons (season_board_archive / w_season_board_archive) — a
//     full Full Board snapshot (stats, archetypes, tags, transfer status,
//     NIL) written by archive_season.py when a season gets cleared off the
//     live board. These render through BoardPage itself in a read-only
//     mode, reusing all of its filters/cards/table instead of hand-copying
//     them here — see BoardPage's `season`/`headerExtra` props.
//   - "Legacy" seasons (historical_stats, 2009–) — bare Torvik-derived
//     metrics only, no portal/archetype data was ever collected for these,
//     by design (see supabase/historical.sql). Kept as the simple read-only
//     table this page has always used.
//
// Both year ranges are discovered from the DB rather than hardcoded, so a
// newly archived season just shows up here — no file to edit at rollover.
export function HistoricalPage() {
  const [archiveYears, setArchiveYears] = useState([]); // desc, e.g. [2027, 2026]
  const [legacyYears,  setLegacyYears]  = useState([]); // desc, e.g. [2025, ..., 2009]
  const [yearsLoaded,  setYearsLoaded]  = useState(false);
  const [year,         setYear]         = useState(null);
  const [sport,        setSport]        = useState("men");

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: mArchive }, { data: wArchive }, { data: legacyMax }, { data: legacyMin }] = await Promise.all([
        supabase.from("season_board_archive").select("season_year").order("season_year", { ascending: false }).limit(1),
        supabase.from("w_season_board_archive").select("season_year").order("season_year", { ascending: false }).limit(1),
        supabase.from("historical_stats").select("year").order("year", { ascending: false }).limit(1),
        supabase.from("historical_stats").select("year").order("year", { ascending: true }).limit(1),
      ]);
      if (!alive) return;

      const mMax = mArchive?.[0]?.season_year ?? null;
      const wMax = wArchive?.[0]?.season_year ?? null;
      const archiveMax = mMax != null || wMax != null ? Math.max(mMax ?? 0, wMax ?? 0) : null;
      // Archive seasons get written one per rollover — assume contiguous back
      // to 2026 (when this archive table was introduced) rather than probing
      // for gaps.
      const archive = archiveMax != null
        ? Array.from({ length: archiveMax - 2026 + 1 }, (_, i) => archiveMax - i)
        : [];

      const lMax = legacyMax?.[0]?.year ?? null;
      const lMin = legacyMin?.[0]?.year ?? FIRST_YEAR;
      const legacy = lMax != null
        ? Array.from({ length: lMax - lMin + 1 }, (_, i) => lMax - i)
        : [];

      setArchiveYears(archive);
      setLegacyYears(legacy);
      setYear(archive[0] ?? legacy[0] ?? null);
      setYearsLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  const isArchiveYear = archiveYears.includes(year);

  const yearSelect = (
    <select className="input" style={{ width: 120 }} value={year ?? ""} onChange={e => setYear(Number(e.target.value))}>
      {archiveYears.length > 0 && (
        <optgroup label="Full board archive">
          {archiveYears.map(y => <option key={y} value={y}>{y}</option>)}
        </optgroup>
      )}
      {legacyYears.length > 0 && (
        <optgroup label="Stats only">
          {legacyYears.map(y => <option key={y} value={y}>{y}</option>)}
        </optgroup>
      )}
    </select>
  );

  const sportToggle = isArchiveYear && (
    <div title="Switch between men's and women's archived data"
      style={{ display: "inline-flex", border: "1px solid rgba(255,255,255,.15)", borderRadius: 999, overflow: "hidden" }}>
      {[["men", "M"], ["women", "W"]].map(([val, lbl]) => (
        <button key={val} onClick={() => setSport(val)} style={{
          fontSize: 12, fontWeight: 700, padding: "3px 11px",
          background: sport === val ? (val === "women" ? "rgba(244,114,182,.20)" : "rgba(91,156,246,.20)") : "transparent",
          color:      sport === val ? (val === "women" ? "#f472b6"             : "#5b9cf6")            : "rgba(255,255,255,.50)",
          border: "none", cursor: "pointer", outline: "none",
        }}>{lbl}</button>
      ))}
    </div>
  );

  if (!yearsLoaded) {
    return (
      <>
        <SiteHeader />
        <div className="app-shell"><div className="empty">Loading…</div></div>
      </>
    );
  }

  if (isArchiveYear) {
    return (
      <BoardPage
        key={`${sport}-${year}`}
        sport={sport}
        season={year}
        title="Time Machine"
        headerExtra={<>{sportToggle}{yearSelect}</>}
      />
    );
  }

  return <LegacyHistoricalBoard year={year} yearSelect={yearSelect} />;
}

// The original bare-stats Time Machine view, kept for pre-archive seasons
// (historical_stats has no archetype/tag/transfer data to show as a real
// board — see the module comment above).
function LegacyHistoricalBoard({ year, yearSelect }) {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [sortKey, setSortKey] = useState("nil_valuation");
  const [sortDir, setSortDir] = useState("desc");
  const [modal,   setModal]   = useState(null);
  const [nilVisible] = useNilVisible();

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
              <p className="muted" style={{ margin: "4px 0 0" }}>Beyond the Portal metrics for past players, back to {FIRST_YEAR}.</p>
            </div>
            {yearSelect}
          </div>

          <div style={{ fontSize: 11, opacity: .5, fontStyle: "italic", marginTop: 10, maxWidth: 720 }}>
            Metrics are percentile ranks <strong>within each season</strong> — comparable within a
            year, not across eras (yet). A production-based estimate, not verified market data.
            Seasons before the full board archive only have stats on file, no archetypes, tags,
            or transfer-portal history.
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
                  <Th k="nil_valuation" label="OVR" w={110} />
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
                    {(() => {
                      const ovr = overallRating(r.nil_valuation);
                      return (
                        <td style={{ ...tdStyle, fontWeight: 700, color: overallColor(ovr) }}>
                          {ovr ?? "—"}
                          {nilVisible && r.nil_valuation ? <span style={{ opacity: .5, fontWeight: 400, fontSize: 12 }}>{"  "}{money(r.nil_valuation)}</span> : null}
                        </td>
                      );
                    })()}
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
                  <tr><td colSpan={11} style={{ ...tdStyle, opacity: .4, textAlign: "center", padding: 24 }}>
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
