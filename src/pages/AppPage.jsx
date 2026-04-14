import { useState, useEffect, useMemo } from "react";
import { SiteHeader }   from "@/components/SiteHeader";
import { PlayerCard }   from "@/components/PlayerCard";
import { PlayerModal }  from "@/components/PlayerModal";
import { PlayerFinder } from "@/components/PlayerFinder";
import { useAuth }      from "@/hooks/useAuth";
import { useRosterBoard } from "@/hooks/useRosterBoard";
import { useAdminTeam }       from "@/hooks/useAdminTeam";
import { TeamAutocomplete }   from "@/components/TeamAutocomplete";
import { supabase }       from "@/lib/supabase";
import { exportRosterPDF } from "@/lib/exportRoster";
import { track } from "@/lib/track";;

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

// const STATUSES = [
//   { key: "none",       label: "No status" },
//   { key: "interested", label: "Interested" },
//   { key: "contacted",  label: "Contacted" },
//   { key: "visit",      label: "Visit" },
//   { key: "signed",     label: "Signed" },
//   { key: "passed",     label: "Passed" },
// ];

export function AppPage() {
  
  const { profile, user } = useAuth();
  const userId = user?.id || "";
  const { isAdmin, isNonAffiliate, activeTeam, selectedTeam, setSelectedTeam, allTeams } = useAdminTeam(profile);

  const board = useRosterBoard(activeTeam);

  const [search,   setSearch]   = useState("");
  const [posFilter,setPosFilter]= useState("all");
  const [modal,         setModal]         = useState(null);
  const [settings,      setSettings]      = useState(null);
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [finderOpen,    setFinderOpen]    = useState(false);
  const [myRosters,     setMyRosters]     = useState([]);
  const [teamRosters,   setTeamRosters]   = useState([]);
  const [coaches,       setCoaches]       = useState({});
  const [loadingDrawer, setLoadingDrawer] = useState(false);
  const [saveName,      setSaveName]      = useState("");
  const [saving,        setSaving]        = useState(false);

  // Page view tracking — sessionStorage guard prevents double-fires from
  // React Strict Mode and HMR remounts in development.
  useEffect(() => {
    if (!sessionStorage.getItem("btp_pv_app")) {
      sessionStorage.setItem("btp_pv_app", "1");
      track("page_view", { page: "app" });
    }
  }, []);

  // Load data on mount / when active team changes
  useEffect(() => {
    board.loadPortalBoard();
    if (activeTeam) board.loadReturningRoster(activeTeam);
  }, [activeTeam]);

  // Sync local settings state
  useEffect(() => {
    setSettings(board.state.settings);
  }, [board.state.settings]);

  function handleOpenModal(p) {
    track("player_modal_opened", { player_id: p.id, player_name: p.name, team: p.team, pos: p.pos });
    setModal(p);
  }

  // Load saved rosters when drawer opens
  useEffect(() => {
    if (!drawerOpen || !activeTeam) return;
    setLoadingDrawer(true);
    Promise.all([
      supabase.from("saved_rosters").select("id, name, created_at, user_id, nil_budget, roster_size, nil_max_pct").eq("team", activeTeam).order("created_at", { ascending: false }),
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

  async function handleSaveRoster() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const { data: row, error: rErr } = await supabase
        .from("saved_rosters")
        .insert({
          name:        saveName.trim(),
          team:        activeTeam,
          user_id:     userId,
          nil_budget:  board.state.settings.nilTotal,
          roster_size: board.state.settings.scholarships,
          nil_max_pct: board.state.settings.maxPct,
        })
        .select("id")
        .single();
      if (rErr) throw rErr;

      const retentionById = board.state.retentionById || {};
      const nilById       = board.state.nilById       || {};
      const statusById    = board.state.statusById    || {};
      const shortlistIds  = board.state.shortlistIds  || [];
      const returning = board.returningPlayers
        .map(p => ({
          roster_id:   row.id,
          player_id:   p.id,
          player_type: retentionById[p.id] || "returning",
          nil_offer:   nilById[p.id] || 0,
          status:      statusById[p.id] || null,
          shortlisted: shortlistIds.includes(p.id),
        }))
        ; // save all returning players including those leaving so status is restored on load
      const transfers = board.state.roster
        .map(e => ({
          roster_id:   row.id,
          player_id:   e.id,
          player_type: "transfer",
          nil_offer:   e.nilOffer || 0,
          status:      statusById[e.id] || null,
          shortlisted: shortlistIds.includes(e.id),
        }));

      // Save shortlisted portal players that aren't on the roster yet
      const rosteredIds = new Set(board.state.roster.map(e => e.id));
      const shortlistedOnly = shortlistIds
        .filter(id => !rosteredIds.has(id))
        .map(id => ({
          roster_id:   row.id,
          player_id:   id,
          player_type: "shortlisted",
          nil_offer:   0,
          status:      statusById[id] || null,
          shortlisted: true,
        }));

      const { error: pErr } = await supabase.from("saved_roster_players").insert([...returning, ...transfers, ...shortlistedOnly]);
      if (pErr) throw pErr;

      setMyRosters(prev => [{ id: row.id, name: saveName.trim(), created_at: new Date().toISOString(), user_id: userId }, ...prev]);
      setSaveName("");
    } catch (e) {
      alert("Save failed: " + e.message);
    }
    setSaving(false);
  }

  async function handleDeleteRoster(rosterId) {
    if (!confirm("Delete this saved roster?")) return;
    await supabase.from("saved_rosters").delete().eq("id", rosterId);
    setMyRosters(prev => prev.filter(r => r.id !== rosterId));
  }

  async function handleLoadRoster(rosterId) {
    const rosterMeta = [...myRosters, ...teamRosters].find(r => r.id === rosterId);
    const { data, error } = await supabase
      .from("saved_roster_players")
      .select("player_type, nil_offer, status, shortlisted, players(*, player_stats(*))")
      .eq("roster_id", rosterId);
    if (error) { alert("Load failed: " + error.message); return; }

    if (rosterMeta?.nil_budget || rosterMeta?.roster_size) {
      board.commitSettings({
        ...board.state.settings,
        ...(rosterMeta.nil_budget  ? { nilTotal:     rosterMeta.nil_budget }  : {}),
        ...(rosterMeta.roster_size ? { scholarships: rosterMeta.roster_size } : {}),
        ...(rosterMeta.nil_max_pct ? { maxPct:       rosterMeta.nil_max_pct } : {}),
      });
    }

    const players = (data || []).map(row => ({
      ...row.players,
      pos:        row.players.primary_position,
      year:       row.players.year,
      height:     row.players.height   ?? null,
      hometown:   row.players.hometown ?? null,
      marketLow:  row.players.open_market_low  ?? 0,
      marketHigh: row.players.open_market_high ?? 0,
      stats:      { ...(row.players.player_stats?.[0] || {}) },
      _typeKey:   row.player_type,
      nilOffer:   row.nil_offer,
      _status:    row.status,
      _shortlisted: row.shortlisted,
    }));

    board.loadFromSaved(players);
    if (activeTeam) board.loadReturningRoster(activeTeam);
    setDrawerOpen(false);
  }

  // ── Filtered + sorted board ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return board.state.board
      .filter(p => {
        if (q && !p.name.toLowerCase().includes(q) &&
                 !(p.team||"").toLowerCase().includes(q)) return false;
        if (posFilter !== "all" && p.pos !== posFilter) return false;
        return true;
      })
      .sort((a, b) => (b.marketHigh || 0) - (a.marketHigh || 0));
  }, [board.state.board, search, posFilter]);

  const calc = board.calc();

  const NIL_BY_LEVEL = {
    "High Major": 10_000_000,
    "Mid Major":   3_000_000,
    "Low Major":   1_500_000,
  };

  async function handleSettingChange(key, value) {
    let next = { ...board.state.settings, [key]: key === "program" ? value : Number(value) };
    if (key === "program" && value) {
      const { data } = await supabase
        .from("teams")
        .select("level")
        .eq("name", value)
        .maybeSingle();
      if (data?.level && NIL_BY_LEVEL[data.level]) {
        next = { ...next, nilTotal: NIL_BY_LEVEL[data.level] };
      }
    }
    board.commitSettings(next);
    setSettings(next);
  }

  // ── Returning roster grouped by retention status ────────────────────────────
  const returningByStatus = useMemo(() => {
    const groups = { returning: [], undecided: [], graduating: [], entering_portal: [], entering_draft: [], transferred: [] };
    board.returningPlayers.forEach(p => {
      const status = board.state.retentionById?.[p.id] || "returning";
      groups[status].push(p);
    });
    return groups;
  }, [board.returningPlayers, board.state.retentionById]);

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
    team: activeTeam,
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
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0 }}>Roster Builder</h1>
            {isAdmin && (
              <TeamAutocomplete
                value={selectedTeam}
                onChange={t => { setSelectedTeam(t); handleSettingChange("program", t); }}
                teams={allTeams}
                placeholder="Select team…"
              />
            )}
          </div>
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
                  <div className="value">{calc.totalRoster} / {settings.scholarships}</div>
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

            <div className="setting setting-wide" style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {!isNonAffiliate && (<>
              <input className="input" placeholder="Name this roster…" style={{ flex: 1, minWidth: 160 }}
                value={saveName} onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSaveRoster()} />
              <button className="btn btn-primary" disabled={!saveName.trim() || saving} onClick={handleSaveRoster}>
                {saving ? "Saving…" : "Save Roster"}
              </button>
              </>)}
              <button className="btn btn-ghost" onClick={() => {
                const retentionById = board.state.retentionById || {};
                const nilById       = board.state.nilById       || {};
                const returning = board.returningPlayers
                  .filter(p => (retentionById[p.id] || "returning") === "returning")
                  .map(p => ({ ...p, _type: "Returning", nilOffer: nilById[p.id] || 0 }));
                const transfers = board.state.roster
                  .map(r => { const p = board.byId(r.id); return p ? { ...p, _type: "Transfer In", nilOffer: r.nilOffer } : null; })
                  .filter(Boolean);
                track("pdf_exported", { team: activeTeam, roster_size: returning.length + transfers.length });
                exportRosterPDF({ team: activeTeam, settings: board.state.settings, players: [...returning, ...transfers] });
              }}>Export PDF</button>
              <button className="btn btn-ghost" onClick={() => { setFinderOpen(true); track("finder_opened", {}); }}>
                Find Players <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 400 }}>(Beta)</span>
              </button>
              <button className="btn btn-ghost" onClick={() => setDrawerOpen(true)}>
                Saved Rosters
              </button>
              <button className="btn btn-ghost" style={{ color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
                onClick={() => { if (confirm("Reset all roster data?")) board.reset(activeTeam); }}>
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
              <p className="muted">Portal targets from your import board. Player availability is subject to change — portal status is not guaranteed for all listed players.</p>
              <div className="panel-tools">
                <input className="input" type="search" placeholder="Search…"
                  value={search} onChange={e => setSearch(e.target.value)} />
                <select className="input" value={posFilter} onChange={e => setPosFilter(e.target.value)}>
                  <option value="all">All positions</option>
                  <option value="Guard">Guard</option>
                  <option value="Wing">Wing</option>
                  <option value="Big">Big</option>
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
                    onRoster={id => { track("roster_add",    { player_id: id, player_name: p.name, pos: p.pos }); board.addToRoster(id); }}
                    onShortlist={id => { track("shortlist_add", { player_id: id, player_name: p.name, pos: p.pos }); board.addToShortlist(id); }}
                    onClick={handleOpenModal}
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
                        onClick={e => { if (!e.target.closest("button,select")) handleOpenModal(p); }}>
                        <div className="row-main">
                          <div className="row-title">{p.name}</div>
                          <div className="row-sub">{p.team} · {p.pos} · {p.year}</div>
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
              {returningByStatus.returning.length > 0 && (
                <>
                  <div className="sub-label">Returning ({returningByStatus.returning.length})</div>
                  {returningByStatus.returning.map((p, i) => (
                    <div key={i} className="row row-click" style={{ opacity: .75 }}
                      onClick={e => { if (!e.target.closest("select,input")) handleOpenModal(p); }}>
                      <div className="row-main">
                        <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                        <div className="row-sub" style={{ fontSize: 11 }}>{p.primary_position || p.pos} · {p.year}</div>
                        <div className="offer">
                          <label>NIL</label>
                          <input className="input" type="number" min="0" step="1000"
                            value={board.state.nilById?.[p.id] || 0}
                            onChange={e => board.updateReturningNil(p.id, e.target.value)}
                            onClick={e => e.stopPropagation()} />
                          <span className="muted">{money(board.state.nilById?.[p.id] || 0)}</span>
                        </div>
                      </div>
                      <select className="input" style={{ fontSize: 11, padding: "3px 6px", width: "auto" }}
                        value="returning"
                        onChange={e => { e.stopPropagation(); board.setRetention(p.id, e.target.value); }}
                        onClick={e => e.stopPropagation()}>
                        <option value="returning">Returning</option>
                        <option value="undecided">Undecided</option>
                        <option value="graduating">Graduating</option>
                        <option value="entering_portal">Entering Portal</option>
                        <option value="entering_draft">Entering Draft</option>
                        <option value="transferred">Transferred</option>
                      </select>
                    </div>
                  ))}
                </>
              )}

              {/* Undecided */}
              {returningByStatus.undecided.length > 0 && (
                <>
                  <div className="sub-label" style={{ color: "var(--warning, #f5a623)" }}>Undecided ({returningByStatus.undecided.length})</div>
                  {returningByStatus.undecided.map((p, i) => (
                    <div key={i} className="row row-click"
                      onClick={e => { if (!e.target.closest("select,input")) handleOpenModal(p); }}>
                      <div className="row-main">
                        <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                        <div className="row-sub" style={{ fontSize: 11 }}>{p.primary_position || p.pos} · {p.year}</div>
                        <div className="offer">
                          <label>NIL</label>
                          <input className="input" type="number" min="0" step="1000"
                            value={board.state.nilById?.[p.id] || 0}
                            onChange={e => board.updateReturningNil(p.id, e.target.value)}
                            onClick={e => e.stopPropagation()} />
                          <span className="muted">{money(board.state.nilById?.[p.id] || 0)}</span>
                        </div>
                      </div>
                      <select className="input" style={{ fontSize: 11, padding: "3px 6px", width: "auto" }}
                        value="undecided"
                        onChange={e => { e.stopPropagation(); board.setRetention(p.id, e.target.value); }}
                        onClick={e => e.stopPropagation()}>
                        <option value="returning">Returning</option>
                        <option value="undecided">Undecided</option>
                        <option value="graduating">Graduating</option>
                        <option value="entering_portal">Entering Portal</option>
                        <option value="entering_draft">Entering Draft</option>
                        <option value="transferred">Transferred</option>
                      </select>
                    </div>
                  ))}
                </>
              )}

              {/* Entering Portal */}
              {returningByStatus.entering_portal.length > 0 && (
                <>
                  <div className="sub-label" style={{ color: "var(--danger, #e05c5c)" }}>Entering Portal ({returningByStatus.entering_portal.length})</div>
                  {returningByStatus.entering_portal.map((p, i) => (
                    <div key={i} className="row row-click" style={{ opacity: .6 }}
                      onClick={e => { if (!e.target.closest("select")) handleOpenModal(p); }}>
                      <div className="row-main">
                        <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                        <div className="row-sub" style={{ fontSize: 11 }}>{p.primary_position || p.pos} · {p.year}</div>
                      </div>
                      <select className="input" style={{ fontSize: 11, padding: "3px 6px", width: "auto" }}
                        value="entering_portal"
                        onChange={e => { e.stopPropagation(); board.setRetention(p.id, e.target.value); }}
                        onClick={e => e.stopPropagation()}>
                        <option value="returning">Returning</option>
                        <option value="undecided">Undecided</option>
                        <option value="graduating">Graduating</option>
                        <option value="entering_portal">Entering Portal</option>
                        <option value="entering_draft">Entering Draft</option>
                        <option value="transferred">Transferred</option>
                      </select>
                    </div>
                  ))}
                </>
              )}

              {/* Graduating */}
              {returningByStatus.graduating.length > 0 && (
                <>
                  <div className="sub-label" style={{ color: "var(--muted, rgba(255,255,255,.4))" }}>Graduating ({returningByStatus.graduating.length})</div>
                  {returningByStatus.graduating.map((p, i) => (
                    <div key={i} className="row row-click" style={{ opacity: .4 }}
                      onClick={e => { if (!e.target.closest("select")) handleOpenModal(p); }}>
                      <div className="row-main">
                        <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                        <div className="row-sub" style={{ fontSize: 11 }}>{p.primary_position || p.pos} · {p.year}</div>
                      </div>
                      <select className="input" style={{ fontSize: 11, padding: "3px 6px", width: "auto" }}
                        value="graduating"
                        onChange={e => { e.stopPropagation(); board.setRetention(p.id, e.target.value); }}
                        onClick={e => e.stopPropagation()}>
                        <option value="returning">Returning</option>
                        <option value="undecided">Undecided</option>
                        <option value="graduating">Graduating</option>
                        <option value="entering_portal">Entering Portal</option>
                        <option value="entering_draft">Entering Draft</option>
                        <option value="transferred">Transferred</option>
                      </select>
                    </div>
                  ))}
                </>
              )}

              {/* Entering Draft */}
              {returningByStatus.entering_draft.length > 0 && (
                <>
                  <div className="sub-label" style={{ color: "#a78bfa" }}>Entering Draft ({returningByStatus.entering_draft.length})</div>
                  {returningByStatus.entering_draft.map((p, i) => (
                    <div key={i} className="row row-click" style={{ opacity: .4 }}
                      onClick={e => { if (!e.target.closest("select")) handleOpenModal(p); }}>
                      <div className="row-main">
                        <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                        <div className="row-sub" style={{ fontSize: 11 }}>{p.primary_position || p.pos} · {p.year}</div>
                      </div>
                      <select className="input" style={{ fontSize: 11, padding: "3px 6px", width: "auto" }}
                        value="entering_draft"
                        onChange={e => { e.stopPropagation(); board.setRetention(p.id, e.target.value); }}
                        onClick={e => e.stopPropagation()}>
                        <option value="returning">Returning</option>
                        <option value="undecided">Undecided</option>
                        <option value="graduating">Graduating</option>
                        <option value="entering_portal">Entering Portal</option>
                        <option value="entering_draft">Entering Draft</option>
                        <option value="transferred">Transferred</option>
                      </select>
                    </div>
                  ))}
                </>
              )}

              {/* Transferred */}
              {returningByStatus.transferred.length > 0 && (
                <>
                  <div className="sub-label" style={{ color: "#94a3b8" }}>Transferred ({returningByStatus.transferred.length})</div>
                  {returningByStatus.transferred.map((p, i) => (
                    <div key={i} className="row row-click" style={{ opacity: .4 }}
                      onClick={e => { if (!e.target.closest("select")) handleOpenModal(p); }}>
                      <div className="row-main">
                        <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                        <div className="row-sub" style={{ fontSize: 11 }}>{p.primary_position || p.pos} · {p.year}</div>
                      </div>
                      <select className="input" style={{ fontSize: 11, padding: "3px 6px", width: "auto" }}
                        value="transferred"
                        onChange={e => { e.stopPropagation(); board.setRetention(p.id, e.target.value); }}
                        onClick={e => e.stopPropagation()}>
                        <option value="returning">Returning</option>
                        <option value="undecided">Undecided</option>
                        <option value="graduating">Graduating</option>
                        <option value="entering_portal">Entering Portal</option>
                        <option value="entering_draft">Entering Draft</option>
                        <option value="transferred">Transferred</option>
                      </select>
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
                        onClick={e => { if (!e.target.closest("button,input,select")) handleOpenModal(p); }}>
                        <div className="row-main">
                          <div className="row-title">{p.name}</div>
                          <div className="row-sub">{p.team} · {p.pos} · {p.year}</div>
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
          onClose={() => setModal(null)}
        />
      )}

      {finderOpen && (
        <PlayerFinder
          board={board}
          returningPlayers={board.returningPlayers}
          retentionById={board.state.retentionById}
          onClose={() => setFinderOpen(false)}
        />
      )}

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
                  <div>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, marginBottom: 10, fontWeight: 500 }}>
                      My Rosters ({myRosters.length})
                    </div>
                    {myRosters.length === 0
                      ? <div style={{ fontSize: 13, opacity: .35 }}>No saved rosters yet.</div>
                      : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {myRosters.map(r => (
                            <div key={r.id} style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                                <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                              </div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => handleLoadRoster(r.id)}>
                                  Load
                                </button>
                                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px", color: "#f77", borderColor: "rgba(220,70,70,.3)" }} onClick={() => handleDeleteRoster(r.id)}>
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                  {teamRosters.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, marginBottom: 10, fontWeight: 500 }}>
                        Staff Rosters ({teamRosters.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {teamRosters.map(r => (
                          <div key={r.id}>
                            <div style={{ fontSize: 10, opacity: .35, marginBottom: 4, paddingLeft: 2 }}>{coaches[r.user_id] || "Coach"}</div>
                            <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                                <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                              </div>
                              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => handleLoadRoster(r.id)}>
                                Load
                              </button>
                            </div>
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
    </>
  );
}
