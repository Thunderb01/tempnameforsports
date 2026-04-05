import { useState, useEffect, useMemo } from "react";
import { SiteHeader }    from "@/components/SiteHeader";
import { PlayerModal }   from "@/components/PlayerModal";
import { useAuth }       from "@/hooks/useAuth";
import { useRosterBoard} from "@/hooks/useRosterBoard";

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

  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [posFilter, setPosFilter] = useState("all");
  const [tagGroup,       setTagGroup]       = useState("all");
  const [tagFilter,      setTagFilter]      = useState("all");
  const [viewMode,  setViewMode]  = useState("table"); // "cards" | "table"
  const [sortKey,   setSortKey]   = useState("Mkt High");
  const [sortDir,   setSortDir]   = useState("desc");
  const [modal,     setModal]     = useState(null);
  const [page,      setPage]      = useState(0);

  const PAGE_SIZE = 50;

  const players = board.state.board;

  // ── Load board via shared hook ───────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    board.loadPortalBoard().then(() => setLoading(false));
  }, []);

  // ── Tags ────────────────────────────────────────────────────────────────────
  function getTagPool(p, group) {
    if (group === "playmaker")  return p.playmakerTags  || [];
    if (group === "shooting")   return p.shootingTags   || [];
    if (group === "shotmaking") return p.shotmakingTags || [];
    if (group === "interior")   return p.interiorTags   || [];
    if (group === "defensive")  return p.defensiveTags  || [];
    return [
      ...(p.playmakerTags  || []),
      ...(p.shootingTags   || []),
      ...(p.shotmakingTags || []),
      ...(p.interiorTags   || []),
      ...(p.defensiveTags  || []),
    ];
  }

  const allTags = useMemo(() => {
    const set = new Map();
    players.forEach(p => {
      getTagPool(p, tagGroup).forEach(t => {
        if (t && !set.has(t.toLowerCase())) set.set(t.toLowerCase(), t);
      });
    });
    return Array.from(set.values()).sort();
  }, [players, tagGroup]);

  // Reset tag filter when tag group changes
  useEffect(() => setTagFilter("all"), [tagGroup]);

  // Reset to page 0 whenever filters or sort change
  useEffect(() => setPage(0), [search, posFilter, tagGroup, tagFilter, sortKey, sortDir]);

  // ── Filter + sort ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = players.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) &&
               !(p.team||"").toLowerCase().includes(q) &&
               !(p.hometown||"").toLowerCase().includes(q)) return false;
      if (posFilter !== "all" && p.pos !== posFilter) return false;
      if (tagFilter !== "all" && !getTagPool(p, tagGroup).includes(tagFilter)) return false;
      return true;
    });

    if (sortKey) {
      const col = COLS.find(c => c.label === sortKey);
      if (col) {
        out = [...out].sort((a, b) => {
          const av = col.get(a);
          const bv = col.get(b);
          const an = parseFloat(String(av).replace(/[%,$,—]/g, ""));
          const bn = parseFloat(String(bv).replace(/[%,$,—]/g, ""));
          const cmp = !isNaN(an) && !isNaN(bn)
            ? an - bn
            : String(av).localeCompare(String(bv));
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }

    return out;
  }, [players, search, posFilter, tagGroup, tagFilter, sortKey, sortDir]);

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
              <option value="shotmaking">Shotmaking</option>
              <option value="interior">Interior</option>
              <option value="defensive">Defense</option>
            </select>
            <select className="input" style={{ width: 180 }} value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
              <option value="all">All tags</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

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
                        {[
                          { tags: p.playmakerTags,  label: "Play Maker" },
                          { tags: p.shootingTags,   label: "Shooting & Scoring" },
                          { tags: p.shotmakingTags, label: "Shotmaking" },
                          { tags: p.interiorTags,   label: "Interior" },
                          { tags: p.defensiveTags,  label: "Defense" },
                        ].map(({ tags, label }) => {
                          const t = (tags || []).slice(0, 5);
                          if (!t.length) return null;
                          return (
                            <div key={label} className="row-sub tag-row">
                              <span className="muted" style={{ marginRight: 4 }}>{label}:</span>
                              {t.map(tag => <span key={tag} className="tag-chip">{tag}</span>)}
                            </div>
                          );
                        })}
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
