import { useState, useEffect, useMemo } from "react";
import { SiteHeader }   from "@/components/SiteHeader";
import { PlayerCard }   from "@/components/PlayerCard";
import { PlayerModal }  from "@/components/PlayerModal";
import { useAuth }      from "@/hooks/useAuth";
import { useRosterBoard } from "@/hooks/useRosterBoard";

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

const STATUSES = [
  { key: "none",       label: "No status" },
  { key: "interested", label: "Interested" },
  { key: "contacted",  label: "Contacted" },
  { key: "visit",      label: "Visit" },
  { key: "signed",     label: "Signed" },
  { key: "passed",     label: "Passed" },
];

export function AppPage() {
  
  const { profile } = useAuth();
  const team        = profile?.team || "";

  const board = useRosterBoard(team);
  //some debug logs to help track down state loading issues
  console.log("DEBUG profile:", profile);
  console.log("DEBUG team:", team);
  console.log("DEBUG board object:", board);
  console.log("DEBUG board.state:", board?.state);
  console.log("DEBUG board.state.board:", board?.state?.board);
  console.log("DEBUG board.returningPlayers:", board?.returningPlayers);
  console.log("DEBUG board.state.settings:", board?.state?.settings);
  console.log("DEBUG shortlistIds:", board?.state?.shortlistIds);
  console.log("DEBUG roster:", board?.state?.roster);

  //safe guards
  if (!board) return <div>board missing</div>;
  if (!board.state) return <div>board.state missing</div>;
  if (!Array.isArray(board.state.board)) return <div>board.state.board not array</div>;
  if (!Array.isArray(board.returningPlayers)) return <div>returningPlayers not array</div>;

  const [search,   setSearch]   = useState("");
  const [posFilter,setPosFilter]= useState("all");
  const [tagGroup, setTagGroup] = useState("all");
  const [tagFilter,setTagFilter]= useState("all");
  const [modal,    setModal]    = useState(null); // player object or null
  const [settings, setSettings] = useState(null); // loaded from board.state

  // Load data on mount
  useEffect(() => {
    board.loadPortalBoard();
    if (team) board.loadReturningRoster(team);
  }, [team]);

  // Sync local settings state
  useEffect(() => {
    setSettings(board.state.settings);
  }, [board.state.settings]);

  // ── Derived tag list ────────────────────────────────────────────────────────
  const allTags = useMemo(() => {
    const set = new Map();
    board.state.board.forEach(p => {
      const pool = tagGroup === "playmaker" ? p.playmakerTags
                 : tagGroup === "shooting"  ? p.shootingTags
                 : [...(p.playmakerTags||[]), ...(p.shootingTags||[])];
      (pool || []).forEach(t => {
        if (t && !set.has(t.toLowerCase())) set.set(t.toLowerCase(), t);
      });
    });
    return Array.from(set.values()).sort();
  }, [board.state.board, tagGroup]);

  // ── Filtered board ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return board.state.board.filter(p => {
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
  }, [board.state.board, search, posFilter, tagGroup, tagFilter]);

  const calc = board.calc();

  function handleSettingChange(key, value) {
    const next = { ...board.state.settings, [key]: key === "program" ? value : Number(value) };
    board.commitSettings(next);
    setSettings(next);
  }

  // ── Returning roster grouped by position ───────────────────────────────────
  // Must be before any conditional return to satisfy Rules of Hooks
  const returningByPos = useMemo(() => {
    const groups = {};
    board.returningPlayers.forEach(p => {
      const pos = p.primary_position || p.pos || "Other";
      if (!groups[pos]) groups[pos] = [];
      groups[pos].push(p);
    });
    return groups;
  }, [board.returningPlayers]);

  if (!settings) {
    return (
      <>
        <SiteHeader />
        <div className="app-shell">
          <div className="empty">Loading roster builder settings...</div>
        </div>
      </>
    );
  }

  // more debug logs to verify data is present before rendering
  const debug = {
    hasProfile: !!profile,
    team,
    hasState: !!board?.state,
    boardIsArray: Array.isArray(board?.state?.board),
    boardLength: Array.isArray(board?.state?.board) ? board.state.board.length : "not array",
    returningIsArray: Array.isArray(board?.returningPlayers),
    returningLength: Array.isArray(board?.returningPlayers) ? board.returningPlayers.length : "not array",
    hasSettings: !!board?.state?.settings,
    shortlistIsArray: Array.isArray(board?.state?.shortlistIds),
    rosterIsArray: Array.isArray(board?.state?.roster),
  };

  <pre style={{ padding: 12, background: "#111", color: "#0f0", fontSize: 12 }}>
    {JSON.stringify(debug, null, 2)}
  </pre>

  return (
    <>
      <SiteHeader />
      <div className="app-shell">

        {/* ── Top / Settings ── */}
        <div className="app-top">
          <h1>Roster Builder</h1>
          <div className="settings">
            {[
              { id: "program",     label: "Program",            type: "text",   step: undefined },
              { id: "scholarships",label: "Scholarships",        type: "number", step: 1 },
              { id: "nilTotal",    label: "NIL Budget",          type: "number", step: 100000 },
              { id: "maxPct",      label: "Max % per Player",    type: "number", step: 0.01 },
            ].map(({ id, label, type, step }) => (
              <div key={id} className="setting">
                <label>{label}</label>
                <input
                  className="input"
                  type={type}
                  step={step}
                  value={settings[id] ?? ""}
                  onChange={e => handleSettingChange(id, e.target.value)}
                />
              </div>
            ))}

            <div className="setting setting-wide">
              <div className="summary-grid">
                <div className="sum">
                  <div className="label">Program</div>
                  <div className="value">{settings.program || "—"}</div>
                </div>
                <div className="sum">
                  <div className="label">Roster</div>
                  <div className="value">{board.state.roster.length} / {settings.scholarships}</div>
                </div>
                <div className="sum">
                  <div className="label">Scholarships Left</div>
                  <div className="value">{calc.scholarshipsRemaining}</div>
                </div>
                <div className="sum">
                  <div className="label">NIL Committed</div>
                  <div className="value">{money(calc.nilCommitted)}</div>
                </div>
                <div className="sum">
                  <div className="label">NIL Remaining</div>
                  <div className="value">{money(calc.nilRemaining)}</div>
                </div>
                <div className="sum">
                  <div className="label">Max / Player</div>
                  <div className="value">{money(calc.maxPerPlayer)}</div>
                </div>
              </div>

              {calc.warnings.length > 0 ? (
                <div className="warn-box">
                  <div className="warn-title">Warnings</div>
                  <ul className="warn-list">
                    {calc.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              ) : (
                <div className="ok-box">No constraint violations.</div>
              )}
            </div>

            <div className="setting setting-wide" style={{ flexDirection: "row", gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => {
                const blob = new Blob([JSON.stringify(board.state, null, 2)], { type: "application/json" });
                const a = Object.assign(document.createElement("a"), {
                  href: URL.createObjectURL(blob), download: "roster-build.json"
                });
                a.click(); URL.revokeObjectURL(a.href);
              }}>Export Build</button>
              <button className="btn btn-ghost" style={{ color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
                onClick={() => { if (confirm("Reset all roster data?")) board.reset(); }}>
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* ── Three panels ── */}
        <div className="app-grid">

          {/* Board */}
          <div className="panel">
            <div className="panel-head">
              <h2>Board</h2>
              <p className="muted">Portal targets from your import board.</p>
              <div className="panel-tools">
                <input className="input" type="search" placeholder="Search…"
                  value={search} onChange={e => setSearch(e.target.value)} />
                <select className="input" value={posFilter} onChange={e => setPosFilter(e.target.value)}>
                  <option value="all">All positions</option>
                  <option value="Guard">Guard</option>
                  <option value="Wing">Wing</option>
                  <option value="Big">Big</option>
                </select>
                <select className="input" value={tagGroup} onChange={e => { setTagGroup(e.target.value); setTagFilter("all"); }}>
                  <option value="all">All tag types</option>
                  <option value="playmaker">Play Maker</option>
                  <option value="shooting">Shooting &amp; Scoring</option>
                </select>
                <select className="input" value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
                  <option value="all">All tags</option>
                  {allTags.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="list">
              {filtered.length === 0
                ? <div className="empty">No players match your filters.</div>
                : filtered.map(p => (
                  <PlayerCard key={p.id} player={p}
                    inRoster={board.inRoster(p.id)}
                    inShortlist={board.inShort(p.id)}
                    status={board.state.statusById[p.id]}
                    onRoster={board.addToRoster}
                    onShortlist={board.addToShortlist}
                    onStatus={board.setStatus}
                    onClick={setModal}
                  />
                ))
              }
            </div>
          </div>

          {/* Shortlist */}
          <div className="panel">
            <div className="panel-head">
              <h2>Shortlist</h2>
              <p className="muted">Targets you're actively pursuing.</p>
            </div>
            <div className="list">
              {board.state.shortlistIds.length === 0
                ? <div className="empty">No shortlisted players yet.</div>
                : board.state.shortlistIds.map(id => {
                    const p = board.byId(id);
                    if (!p) return null;
                    return (
                      <div key={id} className="row row-click"
                        onClick={e => { if (!e.target.closest("button,select")) setModal(p); }}>
                        <div className="row-main">
                          <div className="row-title">{p.name}</div>
                          <div className="row-sub">{p.team} · {p.pos} · {p.year}</div>
                          <div className="row-sub" style={{ marginTop: 8 }}>
                            <label className="status-control">
                              <span>Status</span>
                              <select value={board.state.statusById[id] || "none"}
                                onChange={e => board.setStatus(id, e.target.value)}
                                onClick={e => e.stopPropagation()}>
                                {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                              </select>
                            </label>
                          </div>
                        </div>
                        <div className="row-actions">
                          <button className="btn btn-ghost" onClick={e => { e.stopPropagation(); board.removeFromShortlist(id); }}>Remove</button>
                          <button className="btn btn-primary" onClick={e => { e.stopPropagation(); board.addToRoster(id); }}>Add to Roster</button>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>

          {/* Roster */}
          <div className="panel">
            <div className="panel-head">
              <h2>Roster</h2>
              <p className="muted">Returning players + portal adds.</p>
            </div>
            <div className="list">
              {/* Returning */}
              {board.returningPlayers.length > 0 && (
                <>
                  <div className="sub-label">Returning</div>
                  {Object.entries(returningByPos).map(([pos, players]) => (
                    <div key={pos}>
                      <div className="sub-label" style={{ opacity: .25, fontSize: 9 }}>{pos}s ({players.length})</div>
                      {players.map((p, i) => (
                        <div key={i} className="row" style={{ opacity: .75 }}>
                          <div className="row-main">
                            <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                            <div className="row-sub" style={{ fontSize: 11 }}>{p.primary_position || p.pos} · {p.year}</div>
                          </div>
                          <span style={{ fontSize: 11, opacity: .35, padding: "4px 6px" }}>Returning</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}

              {/* Portal adds */}
              {board.state.roster.length > 0 && board.returningPlayers.length > 0 && (
                <div className="section-divider">Portal Adds</div>
              )}
              {board.state.roster.length === 0 && board.returningPlayers.length === 0
                ? <div className="empty">No roster players yet.</div>
                : board.state.roster.map(entry => {
                    const p = board.byId(entry.id);
                    if (!p) return null;
                    return (
                      <div key={entry.id} className="row row-click"
                        onClick={e => { if (!e.target.closest("button,input,select")) setModal(p); }}>
                        <div className="row-main">
                          <div className="row-title">{p.name}</div>
                          <div className="row-sub">{p.team} · {p.pos} · {p.year}</div>
                          <div className="row-sub" style={{ marginTop: 8 }}>
                            <label className="status-control">
                              <span>Status</span>
                              <select value={board.state.statusById[entry.id] || "none"}
                                onChange={e => board.setStatus(entry.id, e.target.value)}
                                onClick={e => e.stopPropagation()}>
                                {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                              </select>
                            </label>
                          </div>
                          <div className="offer">
                            <label>NIL Offer</label>
                            <input className="input" type="number" min="0" step="1000"
                              value={entry.nilOffer || 0}
                              onChange={e => board.updateOffer(entry.id, e.target.value)}
                              onClick={e => e.stopPropagation()} />
                            <span className="muted">{money(entry.nilOffer)}</span>
                          </div>
                        </div>
                        <div className="row-actions">
                          <button className="btn btn-ghost" onClick={e => { e.stopPropagation(); board.removeFromRoster(entry.id); }}>
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>

        </div>
      </div>

      {modal && (
        <PlayerModal
          player={modal}
          status={board.state.statusById[modal.id]}
          onStatus={board.setStatus}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
