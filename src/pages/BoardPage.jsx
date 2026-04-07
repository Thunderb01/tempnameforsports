import { useState, useEffect, useMemo } from "react";
import { SiteHeader }    from "@/components/SiteHeader";
import { PlayerModal }   from "@/components/PlayerModal";
import { useAuth }       from "@/hooks/useAuth";
import { useRosterBoard} from "@/hooks/useRosterBoard";
import { supabase }      from "@/lib/supabase";

function heightToInches(h) {
  if (!h || h === "—") return -1;
  const m = String(h).match(/^(\d+)-(\d+)$/);
  return m ? parseInt(m[1]) * 12 + parseInt(m[2]) : -1;
}

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

// label → getter(player)
const COLS = [
  { label: "Player",    get: p => p.name },
  { label: "Team",      get: p => p.team },
  { label: "Pos",       get: p => p.pos },
  { label: "Yr",        get: p => p.year },
  { label: "Ht",        get: p => p.height   || "—" },
  { label: "Hometown",  get: p => p.hometown || "—" },
  { label: "PPG",       get: p => p.stats?.ppg    ?? "—" },
  { label: "RPG",       get: p => p.stats?.rpg    ?? "—" },
  { label: "APG",       get: p => p.stats?.apg    ?? "—" },
  { label: "Mkt Low",   get: p => money(p.marketLow) },
  { label: "Mkt High",  get: p => money(p.marketHigh) },
];

const STATUSES = [
  { key: "none",       label: "No status" },
  { key: "interested", label: "Interested" },
  { key: "contacted",  label: "Contacted" },
  { key: "visit",      label: "Visit" },
  { key: "signed",     label: "Signed" },
  { key: "passed",     label: "Passed" },
];

export function BoardPage() {
  const { profile } = useAuth();
  const board = useRosterBoard(profile?.team);

  const [loading,      setLoading]     = useState(true);
  const [search,       setSearch]      = useState("");
  const [posFilter,    setPosFilter]   = useState("all");
  const [stateFilter,  setStateFilter] = useState("all");
  const [viewMode,     setViewMode]    = useState("table"); // "cards" | "table"
  const [sortKey,   setSortKey]   = useState("Mkt High");
  const [sortDir,   setSortDir]   = useState("desc");
  const [modal,     setModal]     = useState(null);
  const [page,        setPage]        = useState(0);
  const [hideNoNil,   setHideNoNil]   = useState(true);
  const [showProgram, setShowProgram] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confFilter,  setConfFilter]  = useState("all");
  const [conferences, setConferences] = useState([]);

  const ADVC_FIELDS = [
    { key: "sei", label: "Scoring Efficiency (SEI)", src: "metric" },
    { key: "ath", label: "Athleticism (ATH)",        src: "metric" },
    { key: "ris", label: "Rim Impact (RIS)",          src: "metric" },
    { key: "dds", label: "Defending (DDS)",           src: "metric" },
    { key: "cdi", label: "Playmaking (CDI)",          src: "metric" },
    { key: "usg", label: "USG%",                      src: "stat"   },
    { key: "ppg", label: "PPG",                       src: "stat"   },
    { key: "rpg", label: "RPG",                       src: "stat"   },
    { key: "apg", label: "APG",                       src: "stat"   },
  ];
  const emptyAdvc = () => Object.fromEntries(ADVC_FIELDS.map(f => [f.key, { min: "", max: "" }]));
  const [advcFilters, setAdvcFilters] = useState(emptyAdvc);

  function setAdvc(key, side, val) {
    setAdvcFilters(prev => ({ ...prev, [key]: { ...prev[key], [side]: val } }));
  }
  const advcActive = Object.values(advcFilters).some(f => f.min !== "" || f.max !== "");

  const PAGE_SIZE = 50;

  const players = board.state.board;

  // ── Load board via shared hook ───────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    board.loadPortalBoard().then(() => setLoading(false));
  }, []);

  // ── Tags ────────────────────────────────────────────────────────────────────
  // ── State/region → search terms ─────────────────────────────────────────────
  const STATE_OPTIONS = [
    { label: "Alabama",        terms: ["AL", "Alabama"] },
    { label: "Alaska",         terms: ["AK", "Alaska"] },
    { label: "Arizona",        terms: ["AZ", "Arizona"] },
    { label: "Arkansas",       terms: ["AR", "Arkansas"] },
    { label: "California",     terms: ["CA", "California"] },
    { label: "Colorado",       terms: ["CO", "Colorado"] },
    { label: "Connecticut",    terms: ["CT", "Connecticut"] },
    { label: "Delaware",       terms: ["DE", "Delaware"] },
    { label: "Florida",        terms: ["FL", "Florida"] },
    { label: "Georgia",        terms: ["GA", "Georgia"] },
    { label: "Hawaii",         terms: ["HI", "Hawaii"] },
    { label: "Idaho",          terms: ["ID", "Idaho"] },
    { label: "Illinois",       terms: ["IL", "Illinois"] },
    { label: "Indiana",        terms: ["IN", "Indiana"] },
    { label: "Iowa",           terms: ["IA", "Iowa"] },
    { label: "Kansas",         terms: ["KS", "Kansas"] },
    { label: "Kentucky",       terms: ["KY", "Kentucky"] },
    { label: "Louisiana",      terms: ["LA", "Louisiana"] },
    { label: "Maine",          terms: ["ME", "Maine"] },
    { label: "Maryland",       terms: ["MD", "Maryland"] },
    { label: "Massachusetts",  terms: ["MA", "Massachusetts"] },
    { label: "Michigan",       terms: ["MI", "Michigan"] },
    { label: "Minnesota",      terms: ["MN", "Minnesota"] },
    { label: "Mississippi",    terms: ["MS", "Mississippi"] },
    { label: "Missouri",       terms: ["MO", "Missouri"] },
    { label: "Montana",        terms: ["MT", "Montana"] },
    { label: "Nebraska",       terms: ["NE", "Nebraska"] },
    { label: "Nevada",         terms: ["NV", "Nevada"] },
    { label: "New Hampshire",  terms: ["NH", "New Hampshire"] },
    { label: "New Jersey",     terms: ["NJ", "New Jersey"] },
    { label: "New Mexico",     terms: ["NM", "New Mexico"] },
    { label: "New York",       terms: ["NY", "New York"] },
    { label: "North Carolina", terms: ["NC", "North Carolina"] },
    { label: "North Dakota",   terms: ["ND", "North Dakota"] },
    { label: "Ohio",           terms: ["OH", "Ohio"] },
    { label: "Oklahoma",       terms: ["OK", "Oklahoma"] },
    { label: "Oregon",         terms: ["OR", "Oregon"] },
    { label: "Pennsylvania",   terms: ["PA", "Pennsylvania"] },
    { label: "Rhode Island",   terms: ["RI", "Rhode Island"] },
    { label: "South Carolina", terms: ["SC", "South Carolina"] },
    { label: "South Dakota",   terms: ["SD", "South Dakota"] },
    { label: "Tennessee",      terms: ["TN", "Tennessee"] },
    { label: "Texas",          terms: ["TX", "Texas"] },
    { label: "Utah",           terms: ["UT", "Utah"] },
    { label: "Vermont",        terms: ["VT", "Vermont"] },
    { label: "Virginia",       terms: ["VA", "Virginia"] },
    { label: "Washington",     terms: ["WA", "Washington"] },
    { label: "West Virginia",  terms: ["WV", "West Virginia"] },
    { label: "Wisconsin",      terms: ["WI", "Wisconsin"] },
    { label: "Wyoming",        terms: ["WY", "Wyoming"] },
    { label: "Washington D.C.",terms: ["D.C.", "Washington DC", "Washington, DC"] },
    // International
    { label: "Australia",      terms: ["Australia"] },
    { label: "Bahamas",        terms: ["Bahamas"] },
    { label: "Cameroon",       terms: ["Cameroon"] },
    { label: "Canada",         terms: ["Canada"] },
    { label: "Congo / DRC",    terms: ["Congo", "Kinshasa"] },
    { label: "France",         terms: ["France"] },
    { label: "Germany",        terms: ["Germany"] },
    { label: "Ghana",          terms: ["Ghana"] },
    { label: "Guinea",         terms: ["Guinea"] },
    { label: "Lithuania",      terms: ["Lithuania"] },
    { label: "Mali",           terms: ["Mali"] },
    { label: "Nigeria",        terms: ["Nigeria"] },
    { label: "Senegal",        terms: ["Senegal"] },
    { label: "Serbia",         terms: ["Serbia"] },
    { label: "South Sudan",    terms: ["South Sudan"] },
    { label: "Spain",          terms: ["Spain"] },
    { label: "United Kingdom", terms: ["England", "United Kingdom", "UK"] },
  ];

  function matchesState(hometown, terms) {
    if (!hometown) return false;
    return terms.some(t => hometown.includes(t));
  }

  useEffect(() => {
    supabase.from("teams").select("conference").then(({ data }) => {
      const confs = [...new Set((data || []).map(t => t.conference).filter(Boolean))].sort();
      setConferences(confs);
    });
  }, []);

  // Reset to page 0 whenever filters or sort change
  useEffect(() => setPage(0), [search, posFilter, stateFilter, confFilter, sortKey, sortDir, hideNoNil, showProgram, advcFilters]);

  // ── Filter + sort ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const stateTerms = stateFilter !== "all"
      ? STATE_OPTIONS.find(o => o.label === stateFilter)?.terms ?? []
      : null;

    let out = players.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) &&
               !(p.team||"").toLowerCase().includes(q) &&
               !(p.hometown||"").toLowerCase().includes(q)) return false;
      if (posFilter !== "all" && p.pos !== posFilter) return false;
      if (confFilter !== "all" && p.conf !== confFilter) return false;
      if (stateTerms && !matchesState(p.hometown || "", stateTerms)) return false;
      if (hideNoNil && !(p.marketHigh > 0)) return false;
      if (!showProgram && p.source !== "portal") return false;
      for (const f of ADVC_FIELDS) {
        const val = f.src === "metric" ? p.stats?.[f.key] : p.stats?.[f.key];
        const { min, max } = advcFilters[f.key];
        if (min !== "" && (val == null || Number(val) < Number(min))) return false;
        if (max !== "" && (val == null || Number(val) > Number(max))) return false;
      }
      return true;
    });

    if (sortKey) {
      const col = COLS.find(c => c.label === sortKey);
      if (col) {
        out = [...out].sort((a, b) => {
          const av = col.get(a);
          const bv = col.get(b);
          let cmp;
          if (sortKey === "Ht") {
            cmp = heightToInches(av) - heightToInches(bv);
          } else {
            const an = parseFloat(String(av).replace(/[%,$,—]/g, ""));
            const bn = parseFloat(String(bv).replace(/[%,$,—]/g, ""));
            cmp = !isNaN(an) && !isNaN(bn)
              ? an - bn
              : String(av).localeCompare(String(bv));
          }
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }

    return out;
  }, [players, search, posFilter, confFilter, stateFilter, sortKey, sortDir, hideNoNil, showProgram, advcFilters]);

  // ── Roster state helpers (delegated to shared useRosterBoard hook) ──────────
  function inRoster(id)    { return board.inRoster(id); }
  function inShortlist(id) { return board.inShort(id); }

  function addToRoster(id) {
    // board.addToRoster uses byId which only knows board state from the hook's load.
    // Since BoardPage loads its own players list, we seed the board state first if needed.
    board.addToRoster(id);
  }

  function addToShortlist(id) {
    board.addToShortlist(id);
  }

  function setStatus(id, key) {
    board.setStatus(id, key);
  }

  // ── Sort handler ─────────────────────────────────────────────────────────────
  function handleSort(label) {
    setSortDir(prev => sortKey === label && prev === "asc" ? "desc" : "asc");
    setSortKey(label);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <SiteHeader />
      <div className="app-shell">
        <div className="app-top">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1 style={{ margin: 0 }}>Full Board</h1>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" style={{ position: "relative" }}
                onClick={() => setShowAdvanced(v => !v)}>
                Advanced Filters
                {advcActive && <span style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: "var(--accent, #6c8ebf)" }} />}
              </button>
              <button className="btn btn-ghost" onClick={() => setViewMode(v => v === "cards" ? "table" : "cards")}>
                {viewMode === "cards" ? "Table View" : "Card View"}
              </button>
            </div>
          </div>

          {/* Filters */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <input className="input" type="search" placeholder="Search players…"
              style={{ flex: 1, minWidth: 160 }}
              value={search} onChange={e => setSearch(e.target.value)} />
            <select className="input" style={{ width: 150 }} value={posFilter} onChange={e => setPosFilter(e.target.value)}>
              <option value="all">All positions</option>
              <option value="Guard">Guard</option>
              <option value="Wing">Wing</option>
              <option value="Big">Big</option>
            </select>
            <select className="input" style={{ width: 150 }} value={confFilter} onChange={e => setConfFilter(e.target.value)}>
              <option value="all">All conferences</option>
              {conferences.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="input" style={{ width: 180 }} value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
              <option value="all">All locations</option>
              {STATE_OPTIONS.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, opacity: .7, cursor: "pointer", userSelect: "none" }}>
              <input type="checkbox" checked={hideNoNil} onChange={e => setHideNoNil(e.target.checked)} />
              Evaluated players only
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, opacity: .7, cursor: "pointer", userSelect: "none" }}>
              <input type="checkbox" checked={showProgram} onChange={e => setShowProgram(e.target.checked)} />
              Include all players
            </label>
          </div>

          {/* Advanced filter panel */}
          {showAdvanced && (
            <div style={{
              background: "var(--panel)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "16px 20px", marginBottom: 14,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Advanced Filters</span>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 10px" }}
                  onClick={() => setAdvcFilters(emptyAdvc())}>
                  Clear all
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 32px" }}>
                {ADVC_FIELDS.map(f => (
                  <div key={f.key}>
                    <div style={{ fontSize: 12, opacity: .6, marginBottom: 4 }}>{f.label}</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input className="input" type="number" placeholder="Min"
                        style={{ width: "50%", fontSize: 13 }}
                        value={advcFilters[f.key].min}
                        onChange={e => setAdvc(f.key, "min", e.target.value)} />
                      <input className="input" type="number" placeholder="Max"
                        style={{ width: "50%", fontSize: 13 }}
                        value={advcFilters[f.key].max}
                        onChange={e => setAdvc(f.key, "max", e.target.value)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, opacity: .45, marginBottom: 10 }}>
            {loading ? "Loading…" : `${filtered.length} of ${players.length} players`}
            {viewMode === "table" && !loading && " · click header to sort"}
          </div>

        </div>

        {/* Card view */}
        {viewMode === "cards" && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {filtered.length === 0
              ? <div className="empty">No players match your filters.</div>
              : filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(p => {
                  return (
                    <div key={p.id} className="row row-click"
                      style={{ background: "var(--panel)", borderRadius: 8, marginBottom: 2 }}
                      onClick={e => { if (!e.target.closest("button,select")) setModal(p); }}>
                      <div className="row-main">
                        <div className="row-title">{p.name}</div>
                        <div className="row-sub">
                          {[p.team, p.pos, p.year, p.height, p.hometown].filter(Boolean).join(" · ")}
                        </div>
                        <div className="row-sub">Market: {money(p.marketLow)} – {money(p.marketHigh)}</div>
                        {(() => {
                          const s = p.stats || {};
                          const st = v => v != null && String(v) !== "NaN" ? Number(v).toFixed(1) : null;
                          const line = [
                            st(s.usg)  && `USG ${st(s.usg)}`,
                            st(s.ppg)  && `PPG ${st(s.ppg)}`,
                            st(s.rpg)  && `RPG ${st(s.rpg)}`,
                            st(s.apg)  && `APG ${st(s.apg)}`,
                          ].filter(Boolean).join("  ·  ");
                          return line ? <div className="row-sub" style={{ opacity: .75 }}>{line}</div> : null;
                        })()}
                        <div className="row-sub" style={{ marginTop: 8 }}>
                          <label className="status-control">
                            <span>Status</span>
                            <select value={board.state.statusById?.[p.id] || "none"}
                              onChange={e => setStatus(p.id, e.target.value)}
                              onClick={e => e.stopPropagation()}>
                              {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                            </select>
                          </label>
                        </div>
                      </div>
                      <div className="row-actions">
                        <button className="btn btn-ghost"
                          disabled={inShortlist(p.id) || inRoster(p.id)}
                          onClick={e => { e.stopPropagation(); addToShortlist(p.id); }}>
                          Shortlist
                        </button>
                        <button className="btn btn-primary"
                          disabled={inRoster(p.id)}
                          onClick={e => { e.stopPropagation(); addToRoster(p.id); }}>
                          Roster
                        </button>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        )}

        {/* Table view */}
        {viewMode === "table" && !loading && (
          <div style={{ overflowX: "auto" }}>
            {filtered.length === 0
              ? <div className="empty">No players match your filters.</div>
              : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Action</th>
                      {COLS.map(col => (
                        <th key={col.label} style={{ ...thStyle, cursor: "pointer", userSelect: "none" }}
                          onClick={() => handleSort(col.label)}>
                          {col.label}{" "}
                          <span style={{ opacity: sortKey === col.label ? 1 : 0.25 }}>
                            {sortKey === col.label && sortDir === "desc" ? "▼" : "▲"}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(p => (
                      <tr key={p.id} className="row-click"
                        onClick={e => { if (!e.target.closest("button,select")) setModal(p); }}
                        style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={tdStyle}>
                          <button className="btn btn-primary" style={{ fontSize: 11, padding: "3px 8px" }}
                            disabled={inRoster(p.id)}
                            onClick={e => { e.stopPropagation(); addToRoster(p.id); }}>
                            Roster
                          </button>{" "}
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }}
                            disabled={inShortlist(p.id) || inRoster(p.id)}
                            onClick={e => { e.stopPropagation(); addToShortlist(p.id); }}>
                            Shortlist
                          </button>
                        </td>
                        {COLS.map(col => (
                          <td key={col.label} style={tdStyle}>{col.get(p)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        )}

        {/* ── Pagination ── */}
        {!loading && filtered.length > PAGE_SIZE && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 20 }}>
            <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              ← Prev
            </button>
            <span style={{ fontSize: 13, opacity: .55 }}>
              Page {page + 1} of {Math.ceil(filtered.length / PAGE_SIZE)}
            </span>
            <button className="btn btn-ghost" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(p => p + 1)}>
              Next →
            </button>
          </div>
        )}

        {/* ── Disclaimer ── */}
        <div style={{ marginTop: 24, textAlign: "center", fontSize: 11, opacity: .4 }}>
          This is Demo, all players are portal eligible, but not all have announced official intent to enter the portal
        </div>
      </div>

      {modal && (
        <PlayerModal
          player={modal}
          status={board.state.statusById?.[modal.id]}
          onStatus={setStatus}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

const thStyle = {
  padding: "10px 12px",
  textAlign: "left",
  background: "rgba(0,0,0,.6)",
  backdropFilter: "blur(6px)",
  position: "sticky",
  top: 0,
  whiteSpace: "nowrap",
  borderBottom: "1px solid var(--border)",
  fontWeight: 500,
  fontSize: 12,
};

const tdStyle = {
  padding: "8px 12px",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};
