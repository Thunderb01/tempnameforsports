import { useState, useMemo, useEffect } from "react";
import { PlayerModal } from "@/components/PlayerModal";

// BtP skill metrics shown in the finder
const METRICS = [
  { key: "sei", label: "Scoring Efficiency" },
  { key: "dds", label: "Defending" },
  { key: "cdi", label: "Playmaking" },
  { key: "ath", label: "Athleticism" },
  { key: "ris", label: "Rim Impact" },
];

const PRIORITY_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 1, label: "Low" },
  { value: 2, label: "Med" },
  { value: 3, label: "High" },
];

const POSITIONS = ["All", "Guard", "Wing", "Big"];

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function cosineSimilarity(a, b) {
  const dot  = a.reduce((s, v, i) => s + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}

function metricVec(stats) {
  return METRICS.map(m => stats?.[m.key] ?? 0);
}

function gradeColor(val) {
  if (val == null) return "rgba(255,255,255,.25)";
  if (val >= 85) return "#4ade80";
  if (val >= 70) return "#5b9cf6";
  if (val >= 50) return "#f5a623";
  if (val >= 30) return "#fb923c";
  return "#e05c5c";
}

export function PlayerFinder({ board, returningPlayers, retentionById, onClose }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const [mode, setMode]           = useState("need"); // "need" | "replace"
  const [posFilter, setPosFilter] = useState("All");
  const [maxNil, setMaxNil]       = useState(board.state.settings.nilTotal ?? 3000000);
  const [priorities, setPriorities] = useState({ sei: 2, dds: 1, cdi: 1, ath: 1, ris: 1 });
  const [replaceId, setReplaceId] = useState("");
  const [results, setResults]     = useState(null);
  const [modal, setModal]         = useState(null);

  // Players leaving / undecided — candidates for "replace" mode
  const leavingPlayers = useMemo(() => {
    return returningPlayers.filter(p => {
      const s = retentionById?.[p.id] || "returning";
      return ["graduating", "entering_portal", "entering_draft", "transferred", "undecided"].includes(s);
    });
  }, [returningPlayers, retentionById]);

  // Portal board players eligible to be found (not already on roster)
  const eligible = useMemo(() => {
    return board.state.board.filter(p => !board.inRoster(p.id));
  }, [board.state.board, board.state.roster]);

  function handleFind() {
    let pool = eligible;

    // Position filter
    if (posFilter !== "All") {
      pool = pool.filter(p => p.pos === posFilter);
    }

    // Budget filter — use marketLow as the minimum the player might accept
    pool = pool.filter(p => p.marketLow <= maxNil);

    let scored;

    if (mode === "need") {
      const totalWeight = Object.values(priorities).reduce((s, v) => s + v, 0) || 1;
      scored = pool.map(p => {
        const score = METRICS.reduce((s, m) => {
          const w = priorities[m.key] || 0;
          return s + w * (p.stats?.[m.key] ?? 0);
        }, 0) / totalWeight;
        return { ...p, _score: score, _pct: null };
      });
    } else {
      // Replace player — cosine similarity to leaving player's metric vector
      const leaving = [...returningPlayers, ...board.state.board].find(p => p.id === replaceId);
      if (!leaving) return;
      const refVec = metricVec(leaving.stats);
      scored = pool.map(p => {
        const sim = cosineSimilarity(refVec, metricVec(p.stats));
        return { ...p, _score: sim, _pct: Math.round(sim * 100) };
      });
    }

    scored.sort((a, b) => b._score - a._score);
    setResults(scored.slice(0, 20));
  }

  const replacePlayer = [...returningPlayers, ...board.state.board].find(p => p.id === replaceId);

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" style={{ width: "min(720px, calc(100vw - 32px))" }}>
        <div className="modal-card">

          {/* Header */}
          <div className="modal-head">
            <div>
              <div className="modal-kicker">Roster Builder</div>
              <h3 className="modal-title">Player Finder</h3>
            </div>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>

          {/* Mode toggle */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {[{ v: "need", label: "By Need" }, { v: "replace", label: "Replace a Player" }].map(({ v, label }) => (
              <button key={v} onClick={() => { setMode(v); setResults(null); }} style={{
                fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 20, cursor: "pointer",
                border: "1px solid",
                background:   mode === v ? "rgba(91,156,246,.2)" : "transparent",
                color:        mode === v ? "#5b9cf6" : "rgba(255,255,255,.4)",
                borderColor:  mode === v ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.12)",
              }}>{label}</button>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Replace player picker */}
            {mode === "replace" && (
              <div>
                <div style={{ fontSize: 11, opacity: .5, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".06em" }}>Player to Replace</div>
                <select className="input" value={replaceId} onChange={e => { setReplaceId(e.target.value); setResults(null); }}
                  style={{ width: "100%", maxWidth: 340 }}>
                  <option value="">— Select a player —</option>
                  {leavingPlayers.length > 0 && (
                    <optgroup label="Leaving / Undecided">
                      {leavingPlayers.map(p => <option key={p.id} value={p.id}>{p.name} ({p.pos})</option>)}
                    </optgroup>
                  )}
                  <optgroup label="Current Roster (Returning)">
                    {returningPlayers
                      .filter(p => !leavingPlayers.find(l => l.id === p.id))
                      .map(p => <option key={p.id} value={p.id}>{p.name} ({p.pos})</option>)}
                  </optgroup>
                </select>
                {replacePlayer && (
                  <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {METRICS.map(m => {
                      const val = replacePlayer.stats?.[m.key];
                      return (
                        <div key={m.key} style={{ fontSize: 11 }}>
                          <span style={{ opacity: .4 }}>{m.label}: </span>
                          <span style={{ fontWeight: 700, color: gradeColor(val) }}>{val != null ? Math.round(val) : "—"}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Position + budget row */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <div style={{ fontSize: 11, opacity: .5, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".06em" }}>Position</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {POSITIONS.map(pos => (
                    <button key={pos} onClick={() => setPosFilter(pos)} style={{
                      fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 20, cursor: "pointer", border: "1px solid",
                      background:  posFilter === pos ? "rgba(255,255,255,.1)" : "transparent",
                      color:       posFilter === pos ? "#fff" : "rgba(255,255,255,.35)",
                      borderColor: posFilter === pos ? "rgba(255,255,255,.25)" : "rgba(255,255,255,.1)",
                    }}>{pos}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, opacity: .5, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".06em" }}>Max NIL Offer</div>
                <input className="input" type="number" step={50000} value={maxNil}
                  onChange={e => setMaxNil(Number(e.target.value))}
                  style={{ width: 140 }} />
              </div>
            </div>

            {/* Skill priorities (By Need mode only) */}
            {mode === "need" && (
              <div>
                <div style={{ fontSize: 11, opacity: .5, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".06em" }}>Skill Priorities</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {METRICS.map(({ key, label }) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 150, fontSize: 12, opacity: .7 }}>{label}</div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {PRIORITY_OPTIONS.map(opt => (
                          <button key={opt.value} onClick={() => setPriorities(p => ({ ...p, [key]: opt.value }))} style={{
                            fontSize: 11, padding: "3px 10px", borderRadius: 12, cursor: "pointer", border: "1px solid",
                            background:  priorities[key] === opt.value ? "rgba(91,156,246,.25)" : "transparent",
                            color:       priorities[key] === opt.value ? "#5b9cf6" : "rgba(255,255,255,.3)",
                            borderColor: priorities[key] === opt.value ? "rgba(91,156,246,.4)" : "rgba(255,255,255,.08)",
                          }}>{opt.label}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}
              onClick={handleFind}
              disabled={mode === "replace" && !replaceId}>
              Find Players
            </button>
          </div>

          {/* Results */}
          {results !== null && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, opacity: .4, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
                {results.length} matches
              </div>
              {results.length === 0 ? (
                <div style={{ opacity: .4, fontSize: 13 }}>No players found within these constraints.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {results.map((p, i) => (
                    <div key={p.id} style={{
                      background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)",
                      borderRadius: 8, padding: "10px 14px",
                      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                    }}>
                      {/* Rank */}
                      <div style={{ width: 22, fontSize: 11, opacity: .3, flexShrink: 0, textAlign: "right" }}>#{i + 1}</div>

                      {/* Name + meta */}
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <button onClick={() => setModal(p)} style={{
                          background: "none", border: "none", color: "#fff", fontWeight: 600, fontSize: 13,
                          padding: 0, cursor: "pointer", textAlign: "left",
                        }}>{p.name}</button>
                        <div style={{ fontSize: 11, opacity: .4, marginTop: 1 }}>
                          {[p.team, p.pos, p.year].filter(Boolean).join(" · ")}
                        </div>
                      </div>

                      {/* Metrics */}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {METRICS.map(m => {
                          const val = p.stats?.[m.key];
                          return (
                            <div key={m.key} style={{ fontSize: 11, textAlign: "center" }}>
                              <div style={{ opacity: .35, marginBottom: 1 }}>{m.label.split(" ")[0]}</div>
                              <div style={{ fontWeight: 700, color: gradeColor(val) }}>{val != null ? Math.round(val) : "—"}</div>
                            </div>
                          );
                        })}
                      </div>

                      {/* NIL range */}
                      <div style={{ fontSize: 11, opacity: .5, flexShrink: 0, textAlign: "right" }}>
                        {money(p.marketLow)}–{money(p.marketHigh)}
                      </div>

                      {/* Match score (replace mode) */}
                      {mode === "replace" && p._pct != null && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: gradeColor(p._pct), flexShrink: 0 }}>
                          {p._pct}% match
                        </div>
                      )}

                      {/* Actions */}
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        {!board.inShort(p.id) && !board.inRoster(p.id) && (
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                            onClick={() => board.addToShortlist(p.id)}>
                            + Shortlist
                          </button>
                        )}
                        {board.inShort(p.id) && !board.inRoster(p.id) && (
                          <span style={{ fontSize: 11, opacity: .4, padding: "3px 0" }}>Shortlisted</span>
                        )}
                        {!board.inRoster(p.id) && (
                          <button className="btn btn-primary" style={{ fontSize: 11, padding: "3px 10px" }}
                            onClick={() => board.addToRoster(p.id)}>
                            + Roster
                          </button>
                        )}
                        {board.inRoster(p.id) && (
                          <span style={{ fontSize: 11, opacity: .4, padding: "3px 0" }}>On Roster</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {modal && <PlayerModal player={modal} onClose={() => setModal(null)} />}
    </>
  );
}
