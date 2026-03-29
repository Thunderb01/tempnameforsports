import { useState, useEffect, useMemo } from "react";
import { SiteHeader }  from "@/components/SiteHeader";
import { PlayerModal } from "@/components/PlayerModal";
import { useAuth }     from "@/hooks/useAuth";
import { supabase }    from "@/lib/supabase";

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

const STORAGE_KEY = "bp_roster_builder_v1";

function loadRosterState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { roster: [], shortlistIds: [], statusById: {} };
  } catch { return { roster: [], shortlistIds: [], statusById: {} }; }
}

function saveRosterState(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

const VISIBLE_COLS = [
  "Name", "Team", "Primary Position", "Year",
  "PPG", "REB/G", "AST/G", "Open Market Low", "Open Market High",
  "Playmaker Tags", "Shooting/Scoring Tags",
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

  const [players,   setPlayers]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [search,    setSearch]    = useState("");
  const [posFilter, setPosFilter] = useState("all");
  const [tagGroup,  setTagGroup]  = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [viewMode,  setViewMode]  = useState("cards"); // "cards" | "table"
  const [sortKey,   setSortKey]   = useState(null);
  const [sortDir,   setSortDir]   = useState("asc");
  const [modal,     setModal]     = useState(null);
  const [rState,    setRState]    = useState(loadRosterState);

  // ── Load board from Supabase ────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    supabase
      .from("players")
      .select("*")
      .eq("source", "portal")
      .order("name")
      .then(({ data, error: err }) => {
        if (err) { setError(err.message); setLoading(false); return; }
        setPlayers((data || []).map(row => ({
          id:            row.id,
          name:          row.name,
          team:          row.current_team,
          pos:           row.primary_position,
          year:          row.year,
          marketLow:     row.market_low  ?? 0,
          marketHigh:    row.market_high ?? 0,
          playmakerTags: row.playmaker_tags ? row.playmaker_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
          shootingTags:  row.shooting_tags  ? row.shooting_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
          stats:         { name: row.name, team: row.current_team, primary_position: row.primary_position, year: row.year, market_low: row.market_low, market_high: row.market_high, open_market_low: row.open_market_low, open_market_high: row.open_market_high, playmaker_tags: row.playmaker_tags, shooting_tags: row.shooting_tags, ...(row.stats || {}) },
        })));
        setLoading(false);
      });
  }, []);

  // ── Tags ────────────────────────────────────────────────────────────────────
  const allTags = useMemo(() => {
    const set = new Map();
    players.forEach(p => {
      const pool = tagGroup === "playmaker" ? p.playmakerTags
                 : tagGroup === "shooting"  ? p.shootingTags
                 : [...(p.playmakerTags||[]), ...(p.shootingTags||[])];
      (pool||[]).forEach(t => { if (t && !set.has(t.toLowerCase())) set.set(t.toLowerCase(), t); });
    });
    return Array.from(set.values()).sort();
  }, [players, tagGroup]);

  // Reset tag filter when tag group changes
  useEffect(() => setTagFilter("all"), [tagGroup]);

  // ── Filter + sort ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = players.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) &&
               !(p.team||"").toLowerCase().includes(q)) return false;
      if (posFilter !== "all" && p.pos !== posFilter) return false;
      if (tagFilter !== "all") {
        const pool = tagGroup === "playmaker" ? p.playmakerTags
                   : tagGroup === "shooting"  ? p.shootingTags
                   : [...(p.playmakerTags||[]), ...(p.shootingTags||[])];
        if (!(pool||[]).includes(tagFilter)) return false;
      }
      return true;
    });

    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = a.stats?.[sortKey] ?? "";
        const bv = b.stats?.[sortKey] ?? "";
        const an = parseFloat(String(av).replace(/[%,$]/g, ""));
        const bn = parseFloat(String(bv).replace(/[%,$]/g, ""));
        const cmp = !isNaN(an) && !isNaN(bn)
          ? an - bn
          : String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return out;
  }, [players, search, posFilter, tagGroup, tagFilter, sortKey, sortDir]);

  // ── Roster state helpers ────────────────────────────────────────────────────
  function updateRState(updater) {
    setRState(prev => {
      const next = updater(prev);
      // Merge into full localStorage state
      const full = loadRosterState();
      saveRosterState({ ...full, ...next });
      return next;
    });
  }

  function inRoster(id)    { return rState.roster?.some(r => r.id === id); }
  function inShortlist(id) { return rState.shortlistIds?.includes(id); }

  function addToRoster(id) {
    const p = players.find(x => x.id === id);
    if (!p || inRoster(id)) return;
    const offer = Math.round((p.marketLow + p.marketHigh) / 2);
    updateRState(s => ({
      ...s,
      shortlistIds: (s.shortlistIds||[]).filter(x => x !== id),
      roster: [{ id, nilOffer: offer }, ...(s.roster||[])],
    }));
  }

  function addToShortlist(id) {
    if (inShortlist(id) || inRoster(id)) return;
    updateRState(s => ({ ...s, shortlistIds: [id, ...(s.shortlistIds||[])] }));
  }

  function setStatus(id, key) {
    updateRState(s => {
      const next = { ...s, statusById: { ...(s.statusById||{}), [id]: key } };
      if (key === "signed"  && !inRoster(id)) {
        const p = players.find(x => x.id === id);
        const offer = p ? Math.round((p.marketLow + p.marketHigh) / 2) : 0;
        next.roster = [{ id, nilOffer: offer }, ...(next.roster||[])];
      }
      if (key === "passed") {
        next.shortlistIds = (next.shortlistIds||[]).filter(x => x !== id);
        next.roster       = (next.roster||[]).filter(r => r.id !== id);
      }
      return next;
    });
  }

  // ── Sort handler ─────────────────────────────────────────────────────────────
  function handleSort(col) {
    setSortDir(prev => sortKey === col && prev === "asc" ? "desc" : "asc");
    setSortKey(col);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <SiteHeader />
      <div className="app-shell">
        <div className="app-top">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1 style={{ margin: 0 }}>Full Board</h1>
            <button className="btn btn-ghost" onClick={() => setViewMode(v => v === "cards" ? "table" : "cards")}>
              {viewMode === "cards" ? "Table View" : "Card View"}
            </button>
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
            <select className="input" style={{ width: 160 }} value={tagGroup} onChange={e => setTagGroup(e.target.value)}>
              <option value="all">All tag types</option>
              <option value="playmaker">Play Maker</option>
              <option value="shooting">Shooting &amp; Scoring</option>
            </select>
            <select className="input" style={{ width: 180 }} value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
              <option value="all">All tags</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div style={{ fontSize: 12, opacity: .45, marginBottom: 10 }}>
            {loading ? "Loading…" : error ? `Error: ${error}` : `${filtered.length} of ${players.length} players`}
            {viewMode === "table" && !loading && " · click header to sort"}
          </div>
        </div>

        {/* Card view */}
        {viewMode === "cards" && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {filtered.length === 0
              ? <div className="empty">No players match your filters.</div>
              : filtered.map(p => {
                  const pm = (p.playmakerTags||[]).slice(0, 5);
                  const ss = (p.shootingTags||[]).slice(0, 5);
                  return (
                    <div key={p.id} className="row row-click"
                      style={{ background: "var(--panel)", borderRadius: 8, marginBottom: 2 }}
                      onClick={e => { if (!e.target.closest("button,select")) setModal(p); }}>
                      <div className="row-main">
                        <div className="row-title">{p.name}</div>
                        <div className="row-sub">{p.team} · {p.pos} · {p.year}</div>
                        <div className="row-sub">Market: {money(p.marketLow)} – {money(p.marketHigh)}</div>
                        {pm.length > 0 && (
                          <div className="row-sub tag-row">
                            <span className="muted" style={{ marginRight: 4 }}>Play Maker:</span>
                            {pm.map(t => <span key={t} className="tag-chip">{t}</span>)}
                          </div>
                        )}
                        {ss.length > 0 && (
                          <div className="row-sub tag-row">
                            <span className="muted" style={{ marginRight: 4 }}>Shooting &amp; Scoring:</span>
                            {ss.map(t => <span key={t} className="tag-chip">{t}</span>)}
                          </div>
                        )}
                        <div className="row-sub" style={{ marginTop: 8 }}>
                          <label className="status-control">
                            <span>Status</span>
                            <select value={rState.statusById?.[p.id] || "none"}
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
                      {VISIBLE_COLS.map(col => (
                        <th key={col} style={{ ...thStyle, cursor: "pointer", userSelect: "none" }}
                          onClick={() => handleSort(col)}>
                          {col}{sortKey === col ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(p => (
                      <tr key={p.id} className="row-click"
                        onClick={e => { if (!e.target.closest("button,select")) setModal(p); }}
                        style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={tdStyle}>
                          <button className="btn btn-primary" style={{ fontSize: 11, padding: "3px 8px" }}
                            disabled={inRoster(p.id)}
                            onClick={e => { e.stopPropagation(); addToRoster(p.id); }}>
                            Add
                          </button>{" "}
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }}
                            disabled={inShortlist(p.id) || inRoster(p.id)}
                            onClick={e => { e.stopPropagation(); addToShortlist(p.id); }}>
                            Shortlist
                          </button>
                        </td>
                        {VISIBLE_COLS.map(col => {
                          const raw = p.stats?.[col] ?? p.stats?.[col.toLowerCase()] ?? "";
                          return <td key={col} style={tdStyle}>{String(raw)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        )}
      </div>

      {modal && (
        <PlayerModal
          player={modal}
          status={rState.statusById?.[modal.id]}
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
