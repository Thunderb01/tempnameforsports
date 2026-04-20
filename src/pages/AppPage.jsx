import { useState, useEffect, useMemo, useRef, memo, useCallback } from "react";
import { createPortal } from "react-dom";
import { SiteHeader }       from "@/components/SiteHeader";
import { PlayerCard }       from "@/components/PlayerCard";
import { PlayerModal }      from "@/components/PlayerModal";
import { PlayerFinder }     from "@/components/PlayerFinder";
import { useAuth }          from "@/hooks/useAuth";
import { useRosterBoard }   from "@/hooks/useRosterBoard";
import { useAdminTeam }     from "@/hooks/useAdminTeam";
import { TeamAutocomplete } from "@/components/TeamAutocomplete";
import { supabase }         from "@/lib/supabase";
import { exportRosterPDF }  from "@/lib/exportRoster";
import { track }            from "@/lib/track";
import { money }            from "@/lib/display";

// ── Retention badge ───────────────────────────────────────────────────────────
const RETENTION = {
  returning:       { label: "Returning",       color: "#4ade80" },
  undecided:       { label: "Undecided",       color: "#f5a623" },
  graduating:      { label: "Graduating",      color: "#9ca3af" },
  entering_portal: { label: "Entering Portal", color: "#e05c5c" },
  entering_draft:  { label: "Entering Draft",  color: "#a78bfa" },
  transferred:     { label: "Transferred",     color: "#94a3b8" },
};

function RetentionBadge({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const [hovered, setHovered] = useState(null);
  const btnRef = useRef();
  const dropRef = useRef();
  const { label, color } = RETENTION[value] || RETENTION.returning;

  useEffect(() => {
    if (!open) return;
    const clickHandler = e => {
      const inBadge = btnRef.current?.closest("[data-retention-badge]")?.contains(e.target);
      const inDrop  = dropRef.current?.contains(e.target);
      if (!inBadge && !inDrop) setOpen(false);
    };
    const scrollHandler = () => setOpen(false);
    document.addEventListener("mousedown", clickHandler);
    window.addEventListener("scroll", scrollHandler, true);
    return () => {
      document.removeEventListener("mousedown", clickHandler);
      window.removeEventListener("scroll", scrollHandler, true);
    };
  }, [open]);

  function handleOpen() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen(v => !v);
  }

  return (
    <div data-retention-badge="" style={{ position: "relative", display: "inline-block" }} onClick={e => e.stopPropagation()}>
      <button ref={btnRef} onClick={handleOpen} style={{
        display: "flex", alignItems: "center", gap: 5,
        background: color, border: `1px solid ${color}`,
        borderRadius: 12, padding: "2px 8px 2px 6px", fontSize: 11,
        fontWeight: 600, color: "#0e1521", cursor: "pointer", whiteSpace: "nowrap",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0e152180", flexShrink: 0 }} />
        {label}
      </button>
      {open && createPortal(
        <div ref={dropRef} style={{
          position: "fixed", top: pos.top, right: pos.right, zIndex: 9999,
          background: "#111827", border: "1px solid #374151",
          borderRadius: 8, overflow: "hidden", minWidth: 160,
          boxShadow: "0 8px 24px rgba(0,0,0,.95)",
        }}>
          {Object.entries(RETENTION).map(([key, { label: lbl, color: c }]) => (
            <button key={key}
              onClick={() => { onChange(key); setOpen(false); }}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "7px 12px", fontSize: 12,
                background: hovered === key ? "#2d3748" : value === key ? "#1f2937" : "#111827",
                color: c, cursor: "pointer", border: "none", textAlign: "left",
              }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />
              {lbl}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── NIL input — local state, commits on blur only ────────────────────────────
const NilInput = memo(function NilInput({ value, onCommit }) {
  const [local, setLocal] = useState(value ?? 0);
  useEffect(() => { setLocal(value ?? 0); }, [value]);
  return (
    <div className="offer" onClick={e => e.stopPropagation()}>
      <label>NIL</label>
      <input className="input" type="number" min="0" step="1000"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={e => onCommit(e.target.value)} />
      <span className="muted">{money(Number(local) || 0)}</span>
    </div>
  );
});

// ── Custom players (freshmen / redshirts) ────────────────────────────────────
const CustomPlayersSection = memo(function CustomPlayersSection({ customPlayers, onAdd, onRemove, onNilChange, onNilBlur, activeTeam, userId }) {
  const nameRef = useRef(); const posRef = useRef(); const yearRef = useRef(); const nilRef = useRef();
  return (
    <>
      <div className="section-divider">Freshmen / Redshirts</div>
      {customPlayers.map(p => (
        <div key={p.id} className="row" style={{ opacity: .8 }}>
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
            <div className="row-sub" style={{ fontSize: 11 }}>{p.pos || "—"} · {p.year_label}</div>
            <div className="offer">
              <label>NIL</label>
              <input className="input" type="number" min="0" step="1000"
                value={p.nil_offer || 0}
                onChange={e => onNilChange(p.id, e.target.value)}
                onBlur={e => onNilBlur(p.id, e.target.value)} />
              <span className="muted">{money(p.nil_offer || 0)}</span>
            </div>
          </div>
          <div className="row-actions">
            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => onRemove(p.id)}>Remove</button>
          </div>
        </div>
      ))}
      <div style={{ padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", borderTop: "1px solid var(--border)" }}>
        <input className="input" placeholder="Name" style={{ flex: "1 1 130px", fontSize: 12, padding: "5px 8px" }} ref={nameRef} defaultValue="" />
        <input className="input" placeholder="Pos" style={{ width: 54, fontSize: 12, padding: "5px 8px" }} ref={posRef} defaultValue="" />
        <select className="input" style={{ fontSize: 12, padding: "5px 8px", width: 72 }} ref={yearRef} defaultValue="FR">
          <option value="FR">FR</option><option value="RS FR">RS FR</option>
          <option value="SO">SO</option><option value="RS SO">RS SO</option>
          <option value="JR">JR</option>
        </select>
        <input className="input" placeholder="NIL" type="number" min="0" step="1000" style={{ width: 90, fontSize: 12, padding: "5px 8px" }} ref={nilRef} defaultValue="" />
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={async () => {
          const name = nameRef.current?.value?.trim();
          if (!name) return;
          await onAdd({ name, nil_offer: nilRef.current?.value || 0, pos: posRef.current?.value || "", year_label: yearRef.current?.value || "FR" }, activeTeam, userId);
          nameRef.current.value = ""; nilRef.current.value = ""; posRef.current.value = ""; yearRef.current.value = "FR";
        }}>+ Add</button>
      </div>
    </>
  );
});

// ── View mode table columns ───────────────────────────────────────────────────
const VIEW_COLS = [
  { label: "Name",  get: p => p.name },
  { label: "Type",  get: p => p._type },
  { label: "Pos",   get: p => p.pos || p.primary_position || "—" },
  { label: "Yr",    get: p => p.year || "—" },
  { label: "Ht",    get: p => p.height || "—" },
  { label: "PPG",   get: p => p.stats?.ppg ?? "—" },
  { label: "RPG",   get: p => p.stats?.rpg ?? "—" },
  { label: "APG",   get: p => p.stats?.apg ?? "—" },
  { label: "NIL",   get: p => p.nilOffer ?? 0, isNil: true },
];

const TYPE_COLOR = {
  "Returning":   "rgba(255,255,255,.35)",
  "Undecided":   "#f5a623",
  "Transfer In": "#5b9cf6",
  "Incoming":    "#34d399",
  "FR/RS":       "rgba(255,255,255,.25)",
};

// ── Main component ────────────────────────────────────────────────────────────
export function AppPage() {
  const { profile, user } = useAuth();
  const userId = user?.id || "";
  const { isAdmin, isNonAffiliate, activeTeam, selectedTeam, setSelectedTeam, allTeams } = useAdminTeam(profile);
  const board = useRosterBoard(activeTeam, userId);

  const [viewMode,      setViewMode]      = useState("build");
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [search,        setSearch]        = useState("");
  const [posFilter,     setPosFilter]     = useState("all");
  const [portalOnly,    setPortalOnly]    = useState(true);
  const [availableIds,  setAvailableIds]  = useState(new Set());
  const [modal,         setModal]         = useState(null);
  const [settings,      setSettings]      = useState(null);
  const [finderOpen,    setFinderOpen]    = useState(false);
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [myRosters,     setMyRosters]     = useState([]);
  const [teamRosters,   setTeamRosters]   = useState([]);
  const [coaches,       setCoaches]       = useState({});
  const [loadingDrawer, setLoadingDrawer] = useState(false);
  const [saveName,      setSaveName]      = useState("");
  const [saving,        setSaving]        = useState(false);
  const [sortKey,       setSortKey]       = useState(null);
  const [sortDir,       setSortDir]       = useState("asc");

  const handleCustomNilChange = useCallback((id, val) => board.updateCustomPlayerNil(id, val), [board.updateCustomPlayerNil]);
  const handleCustomNilBlur   = useCallback((id, val) => board.persistCustomPlayerNil(id, val), [board.persistCustomPlayerNil]);
  const handleCustomRemove    = useCallback((id) => board.removeCustomPlayer(id), [board.removeCustomPlayer]);

  useEffect(() => {
    if (!sessionStorage.getItem("btp_pv_app")) {
      sessionStorage.setItem("btp_pv_app", "1");
      track("page_view", { page: "app" });
    }
  }, []);

  useEffect(() => {
    const fetches = [board.loadPortalBoard()];
    if (activeTeam) fetches.push(board.loadReturningRoster(activeTeam));
    if (activeTeam && userId) fetches.push(board.loadCustomPlayers(activeTeam, userId));
    Promise.all(fetches);
  }, [activeTeam, userId]);

  useEffect(() => {
    supabase.from("portal_transfers").select("player_id, status")
      .eq("season_year", 2026).neq("status", "withdrawn").not("player_id", "is", null)
      .then(({ data }) => {
        const uncommitted = new Set();
        (data || []).forEach(r => { if (r.status === "uncommitted") uncommitted.add(r.player_id); });
        setAvailableIds(uncommitted);
      });
  }, []);

  useEffect(() => { setSettings(board.state.settings); }, [board.state.settings]);

  function handleOpenModal(p) {
    track("player_modal_opened", { player_id: p.id, player_name: p.name, team: p.team, pos: p.pos });
    setModal(p);
  }

  // ── Board filter ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return board.state.board
      .filter(p => {
        if (portalOnly && !availableIds.has(p.id)) return false;
        if (q && !p.name.toLowerCase().includes(q) && !(p.team || "").toLowerCase().includes(q)) return false;
        if (posFilter !== "all" && p.pos !== posFilter) return false;
        return true;
      })
      .sort((a, b) => (b.marketHigh || 0) - (a.marketHigh || 0));
  }, [board.state.board, search, posFilter, portalOnly, availableIds]);

  // ── View mode: combined roster table ─────────────────────────────────────
  const rosterPlayers = useMemo(() => {
    const retentionById = board.state.retentionById || {};
    const nilById       = board.state.nilById       || {};
    const rosteredIds   = new Set(board.state.roster.map(e => e.id));
    const LEAVING       = new Set(["entering_portal", "entering_draft", "transferred", "graduating"]);

    const incoming = board.incomingTransfers
      .filter(p => !rosteredIds.has(p.id))
      .map(p => ({ ...p, _type: "Incoming", _typeKey: "incoming", nilOffer: 0 }));

    const transfers = board.state.roster
      .map(entry => { const p = board.byId(entry.id); return p ? { ...p, _type: "Transfer In", _typeKey: "transfer", nilOffer: entry.nilOffer } : null; })
      .filter(Boolean);

    const returning = board.returningPlayers
      .filter(p => (retentionById[p.id] || "returning") === "returning")
      .map(p => ({ ...p, _type: "Returning", _typeKey: "returning", nilOffer: nilById[p.id] || 0 }));

    const undecided = board.returningPlayers
      .filter(p => retentionById[p.id] === "undecided")
      .map(p => ({ ...p, _type: "Undecided", _typeKey: "undecided", nilOffer: nilById[p.id] || 0 }));

    const leaving = board.returningPlayers
      .filter(p => LEAVING.has(retentionById[p.id]))
      .map(p => ({ ...p, _type: RETENTION[retentionById[p.id]]?.label || retentionById[p.id], _typeKey: retentionById[p.id], nilOffer: nilById[p.id] || 0 }));

    const custom = board.customPlayers.map(p => ({
      id: p.id, name: p.name, pos: p.pos || "—", year: p.year_label,
      nilOffer: p.nil_offer || 0, _type: "FR/RS", _typeKey: "custom", stats: {},
    }));

    return [...incoming, ...transfers, ...returning, ...undecided, ...leaving, ...custom];
  }, [board.returningPlayers, board.incomingTransfers, board.state.board, board.state.roster, board.state.retentionById, board.state.nilById, board.customPlayers]);

  const sortedView = useMemo(() => {
    if (!sortKey) return rosterPlayers;
    const col = VIEW_COLS.find(c => c.label === sortKey);
    if (!col) return rosterPlayers;
    return [...rosterPlayers].sort((a, b) => {
      const av = col.get(a), bv = col.get(b);
      const an = parseFloat(String(av).replace(/[$,—]/g, ""));
      const bn = parseFloat(String(bv).replace(/[$,—]/g, ""));
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn
        : String(av === "—" ? "zzz" : av).localeCompare(String(bv === "—" ? "zzz" : bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rosterPlayers, sortKey, sortDir]);

  function handleSort(label) {
    setSortDir(prev => sortKey === label && prev === "asc" ? "desc" : "asc");
    setSortKey(label);
  }

  const calc = board.calc;

  const NIL_BY_LEVEL = { "High Major": 10_000_000, "Mid Major": 3_000_000, "Low Major": 1_500_000 };

  async function handleSettingChange(key, value) {
    let next = { ...board.state.settings, [key]: key === "program" ? value : Number(value) };
    if (key === "program" && value) {
      const { data } = await supabase.from("teams").select("level").eq("name", value).maybeSingle();
      if (data?.level && NIL_BY_LEVEL[data.level]) next = { ...next, nilTotal: NIL_BY_LEVEL[data.level] };
    }
    board.commitSettings(next);
    setSettings(next);
  }

  // ── Saved rosters ────────────────────────────────────────────────────────
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
        .insert({ name: saveName.trim(), team: activeTeam, user_id: userId, nil_budget: board.state.settings.nilTotal, roster_size: board.state.settings.scholarships, nil_max_pct: board.state.settings.maxPct })
        .select("id").single();
      if (rErr) throw rErr;

      const { retentionById = {}, nilById = {}, statusById = {}, shortlistIds = [] } = board.state;
      const returning = board.returningPlayers.map(p => ({ roster_id: row.id, player_id: p.id, player_type: retentionById[p.id] || "returning", nil_offer: nilById[p.id] || 0, status: statusById[p.id] || null, shortlisted: shortlistIds.includes(p.id) }));
      const transfers = board.state.roster.map(e => ({ roster_id: row.id, player_id: e.id, player_type: "transfer", nil_offer: e.nilOffer || 0, status: statusById[e.id] || null, shortlisted: shortlistIds.includes(e.id) }));
      const rosteredIds = new Set(board.state.roster.map(e => e.id));
      const shortlistedOnly = shortlistIds.filter(id => !rosteredIds.has(id)).map(id => ({ roster_id: row.id, player_id: id, player_type: "shortlisted", nil_offer: 0, status: statusById[id] || null, shortlisted: true }));

      const { error: pErr } = await supabase.from("saved_roster_players").insert([...returning, ...transfers, ...shortlistedOnly]);
      if (pErr) throw pErr;

      setMyRosters(prev => [{ id: row.id, name: saveName.trim(), created_at: new Date().toISOString(), user_id: userId }, ...prev]);
      setSaveName("");
    } catch (e) { alert("Save failed: " + e.message); }
    setSaving(false);
  }

  async function handleDeleteRoster(rosterId) {
    if (!confirm("Delete this saved roster?")) return;
    await supabase.from("saved_rosters").delete().eq("id", rosterId);
    setMyRosters(prev => prev.filter(r => r.id !== rosterId));
  }

  async function handleLoadRoster(rosterId) {
    const rosterMeta = [...myRosters, ...teamRosters].find(r => r.id === rosterId);
    const { data, error } = await supabase.from("saved_roster_players")
      .select("player_type, nil_offer, status, shortlisted, players(*, player_stats(*))").eq("roster_id", rosterId);
    if (error) { alert("Load failed: " + error.message); return; }

    if (rosterMeta?.nil_budget || rosterMeta?.roster_size) {
      board.commitSettings({ ...board.state.settings, ...(rosterMeta.nil_budget ? { nilTotal: rosterMeta.nil_budget } : {}), ...(rosterMeta.roster_size ? { scholarships: rosterMeta.roster_size } : {}), ...(rosterMeta.nil_max_pct ? { maxPct: rosterMeta.nil_max_pct } : {}) });
    }

    const players = (data || []).map(row => ({
      ...row.players, pos: row.players.primary_position, year: row.players.year,
      height: row.players.height ?? null, hometown: row.players.hometown ?? null,
      marketLow: row.players.open_market_low ?? 0, marketHigh: row.players.open_market_high ?? 0,
      stats: { ...(row.players.player_stats?.[0] || {}) },
      _typeKey: row.player_type, nilOffer: row.nil_offer, _status: row.status, _shortlisted: row.shortlisted,
    }));

    board.loadFromSaved(players);
    if (activeTeam) board.loadReturningRoster(activeTeam);
    setDrawerOpen(false);
  }

  if (!settings) return (
    <><SiteHeader /><div className="app-shell"><div className="empty">Loading…</div></div></>
  );

  const shortlistCount = board.state.shortlistIds.length;

  return (
    <>
      <SiteHeader />
      <div className="app-shell">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="app-top">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0 }}>Roster Builder</h1>
              {isAdmin && (
                <TeamAutocomplete value={selectedTeam}
                  onChange={t => { setSelectedTeam(t); handleSettingChange("program", t); }}
                  teams={allTeams} placeholder="Select team…" />
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!isNonAffiliate && (
                <>
                  <input className="input" placeholder="Name this roster…" style={{ width: 180 }}
                    value={saveName} onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSaveRoster()} />
                  <button className="btn btn-primary" disabled={!saveName.trim() || saving} onClick={handleSaveRoster}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                </>
              )}
              <button className="btn btn-ghost" onClick={() => {
                const ret = board.state.retentionById || {}, nil = board.state.nilById || {};
                const returning = board.returningPlayers.filter(p => (ret[p.id] || "returning") === "returning").map(p => ({ ...p, _type: "Returning", nilOffer: nil[p.id] || 0 }));
                const transfers = board.state.roster.map(r => { const p = board.byId(r.id); return p ? { ...p, _type: "Transfer In", nilOffer: r.nilOffer } : null; }).filter(Boolean);
                exportRosterPDF({ team: activeTeam, settings: board.state.settings, players: [...returning, ...transfers], projectedLow: calc.projectedLow, projectedHigh: calc.projectedHigh });
              }}>Export as PDF</button>
              <button className="btn btn-ghost" onClick={() => { setFinderOpen(true); track("finder_opened", {}); }}>Find Players</button>
              <button className="btn btn-ghost" onClick={() => setDrawerOpen(true)}>Saved Rosters</button>
              <button className="btn btn-ghost" style={{ color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
                onClick={() => { if (confirm("Reset all roster data?")) board.reset(activeTeam); }}>Reset</button>
            </div>
          </div>

          {/* Summary strip */}
          <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", padding: "10px 16px" }}>
              <div>
                <div style={labelStyle}>Roster</div>
                <div style={valueStyle}>{calc.totalRoster} / {settings.scholarships}</div>
              </div>
              <div>
                <div style={labelStyle}>NIL Budget</div>
                <div style={valueStyle}>{money(settings.nilTotal)}</div>
              </div>
              <div>
                <div style={labelStyle}>NIL Committed</div>
                <div style={valueStyle}>{money(calc.nilCommitted)}</div>
              </div>
              <div>
                <div style={labelStyle}>NIL Remaining</div>
                <div style={{ ...valueStyle, color: calc.nilRemaining < 0 ? "#e05c5c" : "inherit" }}>{money(calc.nilRemaining)}</div>
              </div>
              <div>
                <div style={labelStyle}>Max NIL / Player</div>
                <div style={valueStyle}>{money(calc.maxPerPlayer)}</div>
              </div>
              <div>
                <div style={labelStyle}>Projected Roster Value</div>
                <div style={valueStyle}>{money(calc.projectedLow)} – {money(calc.projectedHigh)}</div>
              </div>
              {calc.warnings.length > 0 && (
                <div style={{ fontSize: 12, color: "#f87171" }}>
                  ⚠ {calc.warnings[0]}{calc.warnings.length > 1 ? ` +${calc.warnings.length - 1} more` : ""}
                </div>
              )}
              <button className="btn btn-ghost" style={{ marginLeft: "auto", fontSize: 12 }} onClick={() => setSettingsOpen(v => !v)}>
                {settingsOpen ? "Hide Settings ▲" : "Settings ▼"}
              </button>
            </div>

            {settingsOpen && (
              <div style={{ borderTop: "1px solid var(--border)", padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 12 }}>
                {[
                  { id: "program",      label: "Program",        type: "text",   step: undefined },
                  { id: "scholarships", label: "Scholarships",   type: "number", step: 1 },
                  { id: "nilTotal",     label: "NIL Budget",     type: "number", step: 100000 },
                  { id: "maxPct",       label: "Max NIL / Player (%)", type: "number", step: 0.01 },
                ].map(({ id, label, type, step }) => (
                  <div key={id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, opacity: .5 }}>{label}</label>
                    <input className="input" type={type} step={step} value={settings[id] ?? ""}
                      onChange={e => handleSettingChange(id, e.target.value)} style={{ width: 140 }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Build / View toggle */}
          <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
            {["build", "view"].map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                padding: "6px 18px", borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer",
                background: viewMode === mode ? "rgba(255,255,255,.1)" : "transparent",
                border: viewMode === mode ? "1px solid rgba(255,255,255,.2)" : "1px solid transparent",
                color: viewMode === mode ? "#fff" : "rgba(255,255,255,.4)",
              }}>
                {mode === "build" ? "Build" : "View Roster"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Build mode ──────────────────────────────────────────────────── */}
        {viewMode === "build" && (
          <div className="app-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>

            {/* Board panel */}
            <div className="panel">
              <div className="panel-head">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h2>Board</h2>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShortlistOpen(true)}>
                    Shortlist{shortlistCount > 0 && (
                      <span style={{ marginLeft: 6, background: "var(--accent,#5b9cf6)", color: "#fff", borderRadius: 10, fontSize: 10, padding: "1px 6px", fontWeight: 600 }}>
                        {shortlistCount}
                      </span>
                    )}
                  </button>
                </div>
                <p className="muted">Portal targets. Status subject to change.</p>
                <div className="panel-tools">
                  <input className="input" type="search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
                  <select className="input" value={posFilter} onChange={e => setPosFilter(e.target.value)}>
                    <option value="all">All positions</option>
                    <option value="Guard">Guard</option>
                    <option value="Wing">Wing</option>
                    <option value="Big">Big</option>
                  </select>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, opacity: .7, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={portalOnly} onChange={e => setPortalOnly(e.target.checked)} />
                    Portal only
                  </label>
                </div>
              </div>
              <div className="list">
                {filtered.length === 0
                  ? <div className="empty">No players match your filters.</div>
                  : filtered.map(p => (
                    <PlayerCard key={p.id} player={p}
                      inRoster={board.inRoster(p.id)} inShortlist={board.inShort(p.id)}
                      onRoster={id => { track("roster_add", { player_id: id }); board.addToRoster(id); }}
                      onShortlist={id => { track("shortlist_add", { player_id: id }); board.addToShortlist(id); }}
                      onClick={handleOpenModal}
                    />
                  ))
                }
              </div>
            </div>

            {/* Roster panel */}
            <div className="panel">
              <div className="panel-head">
                <h2>Roster</h2>
                <p className="muted">Returning players + incoming transfers + portal adds.</p>
              </div>
              <div className="list">
                {(() => {
                  const retById = board.state.retentionById || {};
                  const nilById = board.state.nilById || {};
                  const LEAVING = new Set(["entering_portal", "entering_draft", "transferred", "graduating"]);

                  const returningGroup = board.returningPlayers.filter(p => { const s = retById[p.id] || "returning"; return s === "returning"; });
                  const undecidedGroup = board.returningPlayers.filter(p => retById[p.id] === "undecided");
                  const leavingGroup   = board.returningPlayers.filter(p => LEAVING.has(retById[p.id]));

                  const makeReturningRow = (p, dimmed = false) => {
                    const status = retById[p.id] || "returning";
                    const leaving = LEAVING.has(status);
                    return (
                      <div key={p.id} className="row row-click" style={{ opacity: dimmed ? .45 : .9 }}
                        onClick={e => { if (!e.target.closest("button,input")) handleOpenModal(p); }}>
                        <div className="row-main">
                          <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                          <div className="row-sub" style={{ fontSize: 11 }}>{p.primary_position || p.pos} · {p.year}</div>
                          {!leaving && (
                            <NilInput value={nilById[p.id] || 0} onCommit={val => board.updateReturningNil(p.id, val)} />
                          )}
                        </div>
                        <RetentionBadge value={status} onChange={val => board.setRetention(p.id, val)} />
                      </div>
                    );
                  };

                  const hasAnything = board.incomingTransfers.length || board.state.roster.length || board.returningPlayers.length || board.customPlayers.length;

                  return (
                    <>
                      {/* 1. Incoming transfers */}
                      {board.incomingTransfers.length > 0 && (
                        <>
                          <div className="sub-label" style={{ color: "#34d399" }}>Incoming Transfers ({board.incomingTransfers.length})</div>
                          {board.incomingTransfers.map(p => (
                            <div key={p.id} className="row row-click"
                              onClick={e => { if (!e.target.closest("button")) handleOpenModal(p); }}>
                              <div className="row-main">
                                <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                                <div className="row-sub" style={{ fontSize: 11 }}>from {p.team} · {p.pos} · {p.year}</div>
                              </div>
                              <div className="row-actions">
                                <button className="btn btn-primary" style={{ fontSize: 11 }}
                                  disabled={board.inRoster(p.id)}
                                  onClick={e => { e.stopPropagation(); board.addToRoster(p.id); }}>
                                  {board.inRoster(p.id) ? "Added" : "+ Roster"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </>
                      )}

                      {/* 2. Portal adds */}
                      {board.state.roster.length > 0 && (
                        <>
                          <div className="sub-label" style={{ color: "#5b9cf6" }}>Portal Adds ({board.state.roster.length})</div>
                          {board.state.roster.map(entry => {
                            const p = board.byId(entry.id);
                            if (!p) return null;
                            return (
                              <div key={entry.id} className="row row-click"
                                onClick={e => { if (!e.target.closest("button,input")) handleOpenModal(p); }}>
                                <div className="row-main">
                                  <div className="row-title">{p.name}</div>
                                  <div className="row-sub">{p.team} · {p.pos} · {p.year}</div>
                                  <NilInput value={entry.nilOffer || 0} onCommit={val => board.updateOffer(entry.id, val)} />
                                </div>
                                <div className="row-actions">
                                  <button className="btn btn-ghost"
                                    onClick={e => { e.stopPropagation(); board.removeFromRoster(entry.id); }}>Remove</button>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}

                      {/* 3. Returning */}
                      {returningGroup.length > 0 && (
                        <>
                          <div className="sub-label" style={{ color: "#4ade80" }}>Returning ({returningGroup.length})</div>
                          {returningGroup.map(p => makeReturningRow(p))}
                        </>
                      )}

                      {/* 4. Undecided */}
                      {undecidedGroup.length > 0 && (
                        <>
                          <div className="sub-label" style={{ color: "#f5a623" }}>Undecided ({undecidedGroup.length})</div>
                          {undecidedGroup.map(p => makeReturningRow(p))}
                        </>
                      )}

                      {/* 5. Shortlist */}
                      {board.state.shortlistIds.length > 0 && (
                        <>
                          <div className="sub-label">Shortlist ({board.state.shortlistIds.length})</div>
                          {board.state.shortlistIds.map(id => {
                            const p = board.byId(id);
                            if (!p) return null;
                            return (
                              <div key={id} className="row row-click"
                                onClick={e => { if (!e.target.closest("button")) handleOpenModal(p); }}>
                                <div className="row-main">
                                  <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                                  <div className="row-sub" style={{ fontSize: 11 }}>{p.team} · {p.pos} · {p.year}</div>
                                </div>
                                <div className="row-actions">
                                  <button className="btn btn-ghost" style={{ fontSize: 11 }}
                                    onClick={e => { e.stopPropagation(); board.removeFromShortlist(id); }}>✕</button>
                                  <button className="btn btn-primary" style={{ fontSize: 11 }}
                                    onClick={e => { e.stopPropagation(); board.addToRoster(id); }}>+ Roster</button>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}

                      {/* 6. Leaving */}
                      {leavingGroup.length > 0 && (
                        <>
                          <div className="sub-label" style={{ opacity: .5 }}>Leaving ({leavingGroup.length})</div>
                          {leavingGroup.map(p => makeReturningRow(p, true))}
                        </>
                      )}

                      {/* 7. Freshmen / Redshirts */}
                      <CustomPlayersSection
                        customPlayers={board.customPlayers}
                        onAdd={board.addCustomPlayer}
                        onRemove={handleCustomRemove}
                        onNilChange={handleCustomNilChange}
                        onNilBlur={handleCustomNilBlur}
                        activeTeam={activeTeam}
                        userId={userId}
                      />

                      {!hasAnything && <div className="empty">No roster players yet.</div>}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── View mode ───────────────────────────────────────────────────── */}
        {viewMode === "view" && (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            {sortedView.length === 0
              ? <div className="empty">No players yet. Add your returning roster and portal targets in Build mode.</div>
              : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {VIEW_COLS.map(col => (
                        <th key={col.label} style={{ ...thStyle, cursor: "pointer", userSelect: "none" }} onClick={() => handleSort(col.label)}>
                          {col.label}{sortKey === col.label ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </th>
                      ))}
                      <th style={thStyle} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedView.map((p, i) => (
                      <tr key={p.id ?? i} className="row-click"
                        style={{ borderBottom: "1px solid var(--border)" }}
                        onClick={e => { if (!e.target.closest("input,button")) handleOpenModal(p); }}>
                        {VIEW_COLS.map(col => (
                          <td key={col.label} style={{
                            ...tdStyle,
                            color: col.label === "Type" ? (TYPE_COLOR[p._type] || "inherit") : "inherit",
                            fontWeight: col.label === "Type" ? 500 : "inherit",
                          }}>
                            {col.label === "Type" && p._typeKey !== "transfer" && p._typeKey !== "incoming" && p._typeKey !== "custom" ? (
                              <div onClick={e => e.stopPropagation()}>
                                <RetentionBadge value={p._typeKey} onChange={val => board.setRetention(p.id, val)} />
                              </div>
                            ) : col.isNil ? (
                              <NilInput value={p.nilOffer || 0} onCommit={val => {
                                if (p._typeKey === "transfer") board.updateOffer(p.id, val);
                                else if (p._typeKey !== "incoming" && p._typeKey !== "custom") board.updateReturningNil(p.id, val);
                              }} />
                            ) : col.get(p)}
                          </td>
                        ))}
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {p._typeKey === "transfer" && (
                            <button className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "2px 8px", color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
                              onClick={e => { e.stopPropagation(); board.removeFromRoster(p.id); }}>Remove</button>
                          )}
                          {p._typeKey === "incoming" && <span style={{ fontSize: 11, opacity: .35 }}>committed</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        )}
      </div>

      {/* ── Shortlist drawer ────────────────────────────────────────────── */}
      {shortlistOpen && (
        <>
          <div className="modal-backdrop" onClick={() => setShortlistOpen(false)} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 201, width: "min(360px, 100vw)", background: "#0e1521", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Shortlist</h3>
              <button className="btn btn-ghost" onClick={() => setShortlistOpen(false)}>Close</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {board.state.shortlistIds.length === 0
                ? <div className="empty" style={{ padding: 20 }}>No shortlisted players yet.</div>
                : board.state.shortlistIds.map(id => {
                    const p = board.byId(id);
                    if (!p) return null;
                    return (
                      <div key={id} className="row row-click" style={{ padding: "10px 16px" }}
                        onClick={e => { if (!e.target.closest("button")) handleOpenModal(p); }}>
                        <div className="row-main">
                          <div className="row-title">{p.name}</div>
                          <div className="row-sub">{p.team} · {p.pos} · {p.year}</div>
                        </div>
                        <div className="row-actions">
                          <button className="btn btn-ghost" style={{ fontSize: 11 }}
                            onClick={e => { e.stopPropagation(); board.removeFromShortlist(id); }}>✕</button>
                          <button className="btn btn-primary" style={{ fontSize: 11 }}
                            onClick={e => { e.stopPropagation(); board.addToRoster(id); setShortlistOpen(false); }}>Roster</button>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>
        </>
      )}

      {/* ── Saved Rosters drawer ─────────────────────────────────────────── */}
      {drawerOpen && (
        <>
          <div className="modal-backdrop" onClick={() => setDrawerOpen(false)} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 201, width: "min(400px, 100vw)", background: "#0e1521", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Saved Rosters</h3>
              <button className="btn btn-ghost" onClick={() => setDrawerOpen(false)}>Close</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 24 }}>
              {loadingDrawer ? <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div> : (
                <>
                  <div>
                    <div style={drawerHeadStyle}>My Rosters ({myRosters.length})</div>
                    {myRosters.length === 0
                      ? <div style={{ fontSize: 13, opacity: .35 }}>No saved rosters yet.</div>
                      : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {myRosters.map(r => (
                            <div key={r.id} style={rosterCardStyle}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                                <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                              </div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => handleLoadRoster(r.id)}>Load</button>
                                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px", color: "#f77", borderColor: "rgba(220,70,70,.3)" }} onClick={() => handleDeleteRoster(r.id)}>Delete</button>
                              </div>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                  {teamRosters.length > 0 && (
                    <div>
                      <div style={drawerHeadStyle}>Staff Rosters ({teamRosters.length})</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {teamRosters.map(r => (
                          <div key={r.id}>
                            <div style={{ fontSize: 10, opacity: .35, marginBottom: 4, paddingLeft: 2 }}>{coaches[r.user_id] || "Coach"}</div>
                            <div style={rosterCardStyle}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                                <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                              </div>
                              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => handleLoadRoster(r.id)}>Load</button>
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

      {modal && <PlayerModal player={modal} onClose={() => setModal(null)} />}

      {finderOpen && (
        <PlayerFinder board={board} returningPlayers={board.returningPlayers}
          retentionById={board.state.retentionById} onClose={() => setFinderOpen(false)} />
      )}
    </>
  );
}

const labelStyle = { fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, fontWeight: 500 };
const valueStyle = { fontSize: 15, fontWeight: 600, marginTop: 2 };
const drawerHeadStyle = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, marginBottom: 10, fontWeight: 500 };
const rosterCardStyle = { background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
const thStyle = { padding: "10px 12px", textAlign: "left", background: "rgba(0,0,0,.6)", backdropFilter: "blur(6px)", position: "sticky", top: 0, whiteSpace: "nowrap", borderBottom: "1px solid var(--border)", fontWeight: 500, fontSize: 12 };
const tdStyle = { padding: "8px 12px", whiteSpace: "nowrap", verticalAlign: "middle" };
