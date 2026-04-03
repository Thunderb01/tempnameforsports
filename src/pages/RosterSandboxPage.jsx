import { useState, useEffect, useMemo } from "react";
import { SiteHeader }     from "@/components/SiteHeader";
import { PlayerModal }    from "@/components/PlayerModal";
import { useAuth }        from "@/hooks/useAuth";
import { useRosterBoard } from "@/hooks/useRosterBoard";
import { useAdminTeam }       from "@/hooks/useAdminTeam";
import { TeamAutocomplete }   from "@/components/TeamAutocomplete";
import { supabase }       from "@/lib/supabase";

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const COLS = [
  { label: "Name",     get: p => p.name },
  { label: "Status",   get: p => p._type },
  { label: "Pos",      get: p => p.pos  || p.primary_position || "—" },
  { label: "Yr",       get: p => p.year || "—" },
  { label: "Ht",       get: p => p.height   || "—" },
  { label: "Hometown", get: p => p.hometown || "—" },
  { label: "PPG",      get: p => p.stats?.ppg ?? "—" },
  { label: "RPG",      get: p => p.stats?.rpg ?? "—" },
  { label: "APG",      get: p => p.stats?.apg ?? "—" },
  { label: "NIL",      get: p => p.nilOffer ?? 0, isNil: true },
];

const TYPE_COLOR = {
  "Returning":   "rgba(255,255,255,.35)",
  "Undecided":   "#f5a623",
  "Transfer In": "#5b9cf6",
};

function RosterCard({ r, canDelete, onLoad, onDelete }) {
  return (
    <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
        <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>{fmtDate(r.created_at)}</div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={onLoad}>
          Load
        </button>
        {canDelete && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px", color: "#f77", borderColor: "rgba(220,70,70,.3)" }} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function RosterSandboxPage() {
  const { profile, user } = useAuth();
  const userId = user?.id || "";
  const { isAdmin, isNonAffiliate, activeTeam, selectedTeam, setSelectedTeam, allTeams } = useAdminTeam(profile);
  const board  = useRosterBoard(activeTeam);

  const [modal,          setModal]          = useState(null);
  const [drawerOpen,     setDrawerOpen]     = useState(false);
  const [activeRoster,   setActiveRoster]   = useState(null);
  const [saveName,       setSaveName]       = useState("");
  const [saving,         setSaving]         = useState(false);

  // All saved rosters for this team, keyed by coach
  const [myRosters,     setMyRosters]     = useState([]);
  const [teamRosters,   setTeamRosters]   = useState([]);
  const [coaches,       setCoaches]       = useState({});
  const [loadingDrawer, setLoadingDrawer] = useState(false);

  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  // Load portal board + returning roster on mount / when active team changes
  useEffect(() => {
    board.loadPortalBoard();
    if (activeTeam) board.loadReturningRoster(activeTeam);
  }, [activeTeam]);

  // Load saved rosters + coaches whenever drawer opens
  useEffect(() => {
    if (!drawerOpen || !activeTeam) return;
    setLoadingDrawer(true);

    Promise.all([
      supabase.from("saved_rosters").select("id, name, created_at, user_id").eq("team", activeTeam).order("created_at", { ascending: false }),
      supabase.from("coaches").select("user_id, display_name").eq("team", activeTeam),
    ]).then(([{ data: rosters }, { data: coachRows }]) => {
      const coachMap = {};
      (coachRows || []).forEach(c => { coachMap[c.user_id] = c.display_name || "Coach"; });
      setCoaches(coachMap);

      const all = rosters || [];
      setMyRosters(all.filter(r => r.user_id === userId));
      setTeamRosters(all.filter(r => r.user_id !== userId));
      setLoadingDrawer(false);
    });
  }, [drawerOpen, activeTeam, userId]);

  // ── Combined live player list ───────────────────────────────────────────────
  const rosterPlayers = useMemo(() => {
    const retentionById = board.state.retentionById || {};
    const nilById       = board.state.nilById       || {};

    const returning = board.returningPlayers
      .filter(p => (retentionById[p.id] || "returning") !== "entering_portal")
      .map(p => ({
        ...p,
        _type:    retentionById[p.id] === "undecided" ? "Undecided" : "Returning",
        _typeKey: retentionById[p.id] || "returning",
        nilOffer: nilById[p.id] || 0,
      }));

    const transfers = board.state.roster
      .map(entry => {
        const p = board.byId(entry.id);
        return p ? { ...p, _type: "Transfer In", _typeKey: "transfer", nilOffer: entry.nilOffer } : null;
      })
      .filter(Boolean);

    return [...returning, ...transfers];
  }, [board.returningPlayers, board.state.roster, board.state.retentionById, board.state.nilById]);

  const displayPlayers = activeRoster ? activeRoster.players : rosterPlayers;

  // ── Sort ────────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    if (!sortKey) return displayPlayers;
    const col = COLS.find(c => c.label === sortKey);
    if (!col) return displayPlayers;
    return [...displayPlayers].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      const an = parseFloat(String(av).replace(/[$,—]/g, ""));
      const bn = parseFloat(String(bv).replace(/[$,—]/g, ""));
      const cmp = !isNaN(an) && !isNaN(bn)
        ? an - bn
        : String(av === "—" ? "zzz" : av).localeCompare(String(bv === "—" ? "zzz" : bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [displayPlayers, sortKey, sortDir]);

  function handleSort(label) {
    setSortDir(prev => sortKey === label && prev === "asc" ? "desc" : "asc");
    setSortKey(label);
  }

  // ── Save roster ─────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const { data: row, error: rErr } = await supabase
        .from("saved_rosters")
        .insert({ name: saveName.trim(), team: activeTeam, user_id: userId })
        .select("id")
        .single();
      if (rErr) throw rErr;

      const playerRows = rosterPlayers.map(p => ({
        roster_id:   row.id,
        player_id:   p.id,
        player_type: p._typeKey,
        nil_offer:   p.nilOffer || 0,
      }));
      const { error: pErr } = await supabase.from("saved_roster_players").insert(playerRows);
      if (pErr) throw pErr;

      const newEntry = { id: row.id, name: saveName.trim(), created_at: new Date().toISOString(), user_id: userId };
      setMyRosters(prev => [newEntry, ...prev]);
      setSaveName("");
    } catch (e) {
      alert("Save failed: " + e.message);
    }
    setSaving(false);
  }

  // ── Load a saved roster ──────────────────────────────────────────────────────
  async function handleLoad(rosterId) {
    const { data, error } = await supabase
      .from("saved_roster_players")
      .select("player_type, nil_offer, players(*, player_stats(*))")
      .eq("roster_id", rosterId);
    if (error) { alert("Load failed: " + error.message); return; }

    const players = (data || []).map(row => ({
      ...row.players,
      pos:       row.players.primary_position,
      year:      row.players.year,
      height:    row.players.height   ?? null,
      hometown:  row.players.hometown ?? null,
      marketLow:  row.players.open_market_low  ?? 0,
      marketHigh: row.players.open_market_high ?? 0,
      stats:      { ...(row.players.player_stats?.[0] || {}) },
      _type:     row.player_type === "transfer" ? "Transfer In"
               : row.player_type === "undecided" ? "Undecided" : "Returning",
      _typeKey:  row.player_type,
      nilOffer:  row.nil_offer,
    }));

    board.loadFromSaved(players);
    setActiveRoster(null);
    setDrawerOpen(false);
  }

  // ── Delete a saved roster ────────────────────────────────────────────────────
  async function handleDelete(rosterId) {
    if (!confirm("Delete this saved roster?")) return;
    await supabase.from("saved_rosters").delete().eq("id", rosterId);
    setMyRosters(prev => prev.filter(r => r.id !== rosterId));
    if (activeRoster?.id === rosterId) setActiveRoster(null);
  }

  return (
    <>
      <SiteHeader />
      <div className="app-shell">

        {/* ── Header ── */}
        <div className="app-top">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0 }}>Roster Sandbox</h1>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {activeRoster
                  ? <>Viewing: <strong>{activeRoster.name}</strong></>
                  : `Live view · ${sorted.length} players`}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {isAdmin && (
                <TeamAutocomplete
                  value={selectedTeam}
                  onChange={setSelectedTeam}
                  teams={allTeams}
                  placeholder="Select team…"
                />
              )}
              {activeRoster && (
                <button className="btn btn-ghost" onClick={() => setActiveRoster(null)}>
                  ← Back to Live
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setDrawerOpen(true)}>
                Saved Rosters
              </button>
            </div>
          </div>

          {/* ── Summary strip ── */}
          {(() => {
            const calc = board.calc();
            const settings = board.state.settings;
            return (
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 14, padding: "10px 16px", background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, fontWeight: 500 }}>Program</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{settings.program || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, fontWeight: 500 }}>Roster</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{calc.totalRoster} / {settings.scholarships}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, fontWeight: 500 }}>NIL Committed</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{money(calc.nilCommitted)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, fontWeight: 500 }}>NIL Remaining</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, color: calc.nilRemaining < 0 ? "#e05c5c" : "inherit" }}>{money(calc.nilRemaining)}</div>
                </div>
              </div>
            );
          })()}

          {/* Save bar — only when in live mode and not a nonaffiliate */}
          {!activeRoster && !isNonAffiliate && (
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <input className="input" placeholder="Name this roster…" style={{ flex: 1, maxWidth: 280 }}
                value={saveName} onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSave()} />
              <button className="btn btn-primary" disabled={!saveName.trim() || saving} onClick={handleSave}>
                {saving ? "Saving…" : "Save Roster"}
              </button>
            </div>
          )}
        </div>

        {/* ── Table ── */}
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          {sorted.length === 0
            ? <div className="empty">No players yet. Load your returning roster and add portal targets in Roster Builder.</div>
            : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {COLS.map(col => (
                      <th key={col.label} style={{ ...thStyle, cursor: "pointer", userSelect: "none" }}
                        onClick={() => handleSort(col.label)}>
                        {col.label}{sortKey === col.label ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, i) => (
                    <tr key={p.id ?? i} className="row-click"
                      style={{ borderBottom: "1px solid var(--border)" }}
                      onClick={e => { if (!e.target.closest("input")) setModal(p); }}>
                      {COLS.map(col => (
                        <td key={col.label} style={{
                          ...tdStyle,
                          color:      col.label === "Status" ? TYPE_COLOR[p._type] || "inherit" : "inherit",
                          fontWeight: col.label === "Status" ? 500 : "inherit",
                        }}>
                          {col.isNil && !activeRoster ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <input
                                className="input"
                                type="number" min="0" step="1000"
                                value={p.nilOffer || 0}
                                style={{ width: 100, padding: "2px 6px", fontSize: 12 }}
                                onClick={e => e.stopPropagation()}
                                onChange={e => {
                                  p._typeKey === "transfer"
                                    ? board.updateOffer(p.id, e.target.value)
                                    : board.updateReturningNil(p.id, e.target.value);
                                }}
                              />
                              <span style={{ opacity: .5, fontSize: 11 }}>{money(p.nilOffer || 0)}</span>
                            </div>
                          ) : col.isNil ? (
                            money(p.nilOffer || 0)
                          ) : (
                            col.get(p)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>

      </div>

      {/* ── Saved Rosters Drawer ── */}
      {drawerOpen && (
        <>
          <div className="modal-backdrop" onClick={() => setDrawerOpen(false)} />
          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 201,
            width: "min(400px, 100vw)", background: "#0e1521",
            borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column",
          }}>
            <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Saved Rosters</h3>
              <button className="btn btn-ghost" onClick={() => setDrawerOpen(false)}>Close</button>
            </div>

            <div style={{ overflowY: "auto", flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 24 }}>
              {loadingDrawer ? (
                <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
              ) : (
                <>
                  {/* My rosters */}
                  <div>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, marginBottom: 10, fontWeight: 500 }}>
                      My Rosters ({myRosters.length})
                    </div>
                    {myRosters.length === 0
                      ? <div style={{ fontSize: 13, opacity: .35 }}>No saved rosters yet.</div>
                      : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {myRosters.map(r => <RosterCard key={r.id} r={r} canDelete={true} onLoad={() => handleLoad(r.id)} onDelete={() => handleDelete(r.id)} />)}
                        </div>
                    }
                  </div>

                  {/* Other coaches on same team */}
                  {teamRosters.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, marginBottom: 10, fontWeight: 500 }}>
                        Staff Rosters ({teamRosters.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {teamRosters.map(r => (
                          <div key={r.id}>
                            <div style={{ fontSize: 10, opacity: .35, marginBottom: 4, paddingLeft: 2 }}>
                              {coaches[r.user_id] || "Coach"}
                            </div>
                            <RosterCard r={r} canDelete={false} onLoad={() => handleLoad(r.id)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {modal && (
        <PlayerModal player={modal} onClose={() => setModal(null)} />
      )}
    </>
  );
}

const thStyle = {
  padding: "10px 12px", textAlign: "left",
  background: "rgba(0,0,0,.6)", backdropFilter: "blur(6px)",
  position: "sticky", top: 0, whiteSpace: "nowrap",
  borderBottom: "1px solid var(--border)", fontWeight: 500, fontSize: 12,
};

const tdStyle = {
  padding: "8px 12px", whiteSpace: "nowrap", verticalAlign: "middle",
};
