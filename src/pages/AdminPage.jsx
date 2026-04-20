import { useState, useEffect, useRef, useCallback } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { supabase }   from "@/lib/supabase";
import { money, letterGrade, gradeColor } from "@/lib/display";

// Self-contained team search — queries Supabase directly, no pre-loaded array needed
function TeamSearch({ value, onChange, placeholder = "Search team…" }) {
  const [query,       setQuery]       = useState(value || "");
  const [suggestions, setSuggestions] = useState([]);
  const [open,        setOpen]        = useState(false);
  const timeoutRef = useRef(null);
  const wrapRef    = useRef(null);

  useEffect(() => { setQuery(value || ""); }, [value]);

  function search(q) {
    setQuery(q);
    clearTimeout(timeoutRef.current);
    if (!q.trim()) { setSuggestions([]); setOpen(false); onChange(""); return; }
    timeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("teams")
        .select("name")
        .ilike("name", `%${q.trim()}%`)
        .order("name")
        .limit(12);
      setSuggestions((data || []).map(t => t.name));
      setOpen(true);
    }, 180);
  }

  function select(name) {
    setQuery(name);
    setSuggestions([]);
    setOpen(false);
    onChange(name);
  }

  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        className="input" style={{ width: "100%" }}
        placeholder={placeholder}
        value={query}
        onChange={e => search(e.target.value)}
      />
      {open && suggestions.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 999,
          background: "#1a2233", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,.5)", maxHeight: 220, overflowY: "auto" }}>
          {suggestions.map(name => (
            <div key={name} onMouseDown={() => select(name)}
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid rgba(255,255,255,.06)" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.06)"}
              onMouseLeave={e => e.currentTarget.style.background = ""}>
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_OPTIONS = ["uncommitted", "committed", "enrolled", "withdrawn"];
const CURRENT_SEASON = 2027;

const YEAR_OPTIONS     = ["Fr", "RS Fr", "So", "RS So", "Jr", "RS Jr", "Sr", "RS Sr", "Grad"];
const POSITION_OPTIONS = ["Guard", "Wing", "Big"];

const PENTAGON_METRICS = [
  { key: "sei", label: "SEI" },
  { key: "ath", label: "ATH" },
  { key: "ris", label: "RIS" },
  { key: "dds", label: "DDS" },
  { key: "cdi", label: "CDI" },
];

const EMPTY_FORM = {
  player_id:   null,
  player_name: "",
  torvik_pid:  "",
  from_team:   "",
  to_team:     "",
  season_year: CURRENT_SEASON,
  status:      "committed",
};

// ── Shared helpers ─────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", opacity: .4, fontWeight: 600, marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

const STATUS_COLOR = { committed: "#5b9cf6", enrolled: "#4ade80", withdrawn: "#e05c5c", uncommitted: "#94a3b8" };
function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || "#94a3b8";
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20,
      fontSize: 11, fontWeight: 600, color, background: `${color}22`, border: `1px solid ${color}55` }}>
      {status}
    </span>
  );
}

const labelStyle = {
  display: "block", fontSize: 10, textTransform: "uppercase",
  letterSpacing: ".06em", opacity: .45, marginBottom: 5, fontWeight: 600,
};

// ── Player typeahead ───────────────────────────────────────────────────────
function PlayerSearch({ value, playerName, onChange }) {
  const [query,       setQuery]       = useState(playerName || "");
  const [suggestions, setSuggestions] = useState([]);
  const [open,        setOpen]        = useState(false);
  const timeoutRef = useRef(null);
  const wrapRef    = useRef(null);

  useEffect(() => { setQuery(playerName || ""); }, [playerName]);

  function search(q) {
    setQuery(q);
    clearTimeout(timeoutRef.current);
    if (q.trim().length < 2) { setSuggestions([]); setOpen(false); return; }
    timeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("vw_players")
        .select("id, name, primary_position, year, current_team, espn_id, open_market_high, open_market_low, sei, ath, ris, dds, cdi")
        .ilike("name", `%${q.trim()}%`)
        .limit(8);
      setSuggestions(data || []);
      setOpen(true);
    }, 220);
  }

  function select(p) {
    setQuery(p.name);
    setSuggestions([]);
    setOpen(false);
    onChange(p);
  }

  function clear() {
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    onChange(null);
  }

  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="input" style={{ width: "100%" }}
          placeholder="Search player…"
          value={query}
          onChange={e => search(e.target.value)}
          onFocus={() => suggestions.length && setOpen(true)}
        />
        {value && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "0 8px", flexShrink: 0 }} onClick={clear}>✕</button>
        )}
      </div>
      {value && (
        <div style={{ fontSize: 10, opacity: .35, marginTop: 3 }}>Linked: {value}</div>
      )}
      {open && suggestions.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 999,
          background: "#1a2233", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,.5)" }}>
          {suggestions.map(p => (
            <div key={p.id} onMouseDown={() => select(p)}
              style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,.06)" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.06)"}
              onMouseLeave={e => e.currentTarget.style.background = ""}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
              <div style={{ fontSize: 11, opacity: .45 }}>{p.primary_position} · {p.year} · {p.current_team}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Player preview panel ───────────────────────────────────────────────────
function PlayerPreviewPanel({ player }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!player?.id) { setStats(null); return; }
    supabase
      .from("player_stats")
      .select("ppg, rpg, apg, fg_pct, 3p_pct, ft_pct, usg, calendar_year")
      .eq("player_id", player.id)
      .order("calendar_year", { ascending: false })
      .limit(1)
      .then(({ data }) => setStats(data?.[0] || null));
  }, [player?.id]);

  if (!player) return null;

  function fmt(val, key) {
    if (val == null || val === "") return "—";
    const pct = ["fg_pct", "ft_pct", "3p_pct"];
    if (pct.includes(key)) return `${Number(val).toFixed(1)}%`;
    return Number(val) % 1 === 0 ? String(Number(val)) : Number(val).toFixed(1);
  }

  return (
    <div style={{ width: 280, flexShrink: 0, background: "rgba(255,255,255,.03)", border: "1px solid var(--border)",
      borderRadius: 10, padding: 16, alignSelf: "flex-start", position: "sticky", top: 80 }}>

      {/* Header */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
        {player.espn_id
          ? <img
              src={`https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/${player.espn_id}.png`}
              alt={player.name}
              style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", background: "rgba(255,255,255,.06)", flexShrink: 0 }}
              onError={e => { e.target.style.display = "none"; }}
            />
          : <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,.07)", flexShrink: 0 }} />
        }
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{player.name}</div>
          <div style={{ fontSize: 11, opacity: .45, marginTop: 2 }}>
            {[player.primary_position, player.year, player.current_team].filter(Boolean).join(" · ")}
          </div>
          <div style={{ fontSize: 11, marginTop: 4, opacity: .7 }}>
            {money(player.open_market_low)} – {money(player.open_market_high)}
          </div>
        </div>
      </div>

      {/* BTP Metrics */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, fontWeight: 600, marginBottom: 8 }}>
          BTP Metrics
        </div>
        {PENTAGON_METRICS.map(({ key, label }) => {
          const val   = player[key];
          const grade = letterGrade(val);
          const color = gradeColor(grade);
          const pct   = val != null ? Math.min(Math.max(val / 100, 0), 1) * 100 : 0;
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 28, fontSize: 10, opacity: .5, fontWeight: 600 }}>{label}</div>
              <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,.08)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
              </div>
              <div style={{ width: 26, fontSize: 11, fontWeight: 700, color, textAlign: "right" }}>{grade}</div>
              <div style={{ width: 24, fontSize: 10, opacity: .4, textAlign: "right" }}>{val != null ? Math.round(val) : "—"}</div>
            </div>
          );
        })}
      </div>

      {/* Stats */}
      {stats && (
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, fontWeight: 600, marginBottom: 8 }}>
            Stats {stats.calendar_year ? `(${stats.calendar_year})` : ""}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {[["PPG", "ppg"], ["RPG", "rpg"], ["APG", "apg"], ["FG%", "fg_pct"], ["3P%", "3p_pct"], ["FT%", "ft_pct"]].map(([lbl, key]) => (
              <div key={key} style={{ background: "rgba(255,255,255,.04)", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 10, opacity: .4, marginBottom: 2 }}>{lbl}</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(stats[key], key)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Transfer form ──────────────────────────────────────────────────────────
function TransferForm({ initial = EMPTY_FORM, onSave, onCancel, saving }) {
  const [form,          setForm]          = useState(initial);
  const [linkedPlayer,  setLinkedPlayer]  = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // When editing an existing record that already has a player_name set, keep it
  useEffect(() => { setForm(initial); setLinkedPlayer(null); }, [initial.player_id]);

  async function handlePlayerSelect(p) {
    if (!p) {
      setLinkedPlayer(null);
      setForm(f => ({ ...f, player_id: null, player_name: "" }));
      return;
    }
    setLinkedPlayer(p);

    // Look up their existing transfer record to auto-fill to_team / status
    const { data: existing } = await supabase
      .from("portal_transfers")
      .select("to_team, from_team, status, season_year")
      .eq("player_id", p.id)
      .order("season_year", { ascending: false })
      .limit(1)
      .single();

    setForm(f => ({
      ...f,
      player_id:   p.id,
      player_name: p.name,
      from_team:   existing?.from_team || p.current_team || f.from_team,
      to_team:     existing?.to_team   || f.to_team,
      status:      existing?.status    || f.status,
      season_year: existing?.season_year ?? f.season_year,
    }));
  }

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* Form card */}
      <div style={{ flex: "1 1 480px", maxWidth: 560, display: "flex", flexDirection: "column", gap: 10,
        background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Link Player (auto-fills from existing transfer record)</label>
          <PlayerSearch
            value={form.player_id}
            playerName={form.player_name}
            onChange={handlePlayerSelect}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>Player Name</label>
            <input className="input" style={{ width: "100%" }} value={form.player_name}
              onChange={e => set("player_name", e.target.value)} placeholder="e.g. Tre Johnson" />
          </div>
          <div>
            <label style={labelStyle}>Torvik PID</label>
            <input className="input" style={{ width: "100%" }} value={form.torvik_pid}
              onChange={e => set("torvik_pid", e.target.value)} placeholder="optional" />
          </div>

          <div>
            <label style={labelStyle}>From Team</label>
            <TeamSearch value={form.from_team} placeholder="From team…" onChange={v => set("from_team", v)} />
          </div>
          <div>
            <label style={labelStyle}>To Team</label>
            <TeamSearch value={form.to_team} placeholder="To team…" onChange={v => set("to_team", v)} />
          </div>

          <div>
            <label style={labelStyle}>Season Year</label>
            <input className="input" style={{ width: "100%" }} type="number" value={form.season_year}
              onChange={e => set("season_year", Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select className="input" style={{ width: "100%" }} value={form.status}
              onChange={e => set("status", e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button className="btn btn-primary" style={{ fontSize: 12 }}
            disabled={saving || !form.player_name.trim() || !form.from_team.trim() || !form.to_team.trim()}
            onClick={() => onSave(form)}>
            {saving ? "Saving…" : "Save"}
          </button>
          {onCancel && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancel}>Cancel</button>
          )}
        </div>
      </div>

      {/* Player preview */}
      <PlayerPreviewPanel player={linkedPlayer} />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export function AdminPage() {
  const [activeTab, setActiveTab] = useState("transfers");

  return (
    <>
      <SiteHeader />
      <div className="app-shell">
        <div className="app-top">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h1 style={{ margin: 0 }}>Admin</h1>
              <p className="muted" style={{ margin: "4px 0 0" }}>Superadmin tools — portal data management</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 20 }}>
            {[
              { key: "transfers", label: "Portal Transfers" },
              { key: "players",   label: "Players" },
              { key: "coaches",   label: "Coaches" },
            ].map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                fontSize: 12, fontWeight: 600, padding: "5px 16px", borderRadius: 20, cursor: "pointer", border: "1px solid",
                background:  activeTab === t.key ? "rgba(245,166,35,.15)" : "transparent",
                color:       activeTab === t.key ? "#f5a623"              : "rgba(255,255,255,.4)",
                borderColor: activeTab === t.key ? "rgba(245,166,35,.4)"  : "rgba(255,255,255,.12)",
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          {activeTab === "transfers" && <TransfersTab />}
          {activeTab === "players"   && <PlayersTab />}
          {activeTab === "coaches"   && <CoachesTab />}
        </div>
      </div>
    </>
  );
}

// ── Portal Transfers tab ───────────────────────────────────────────────────
function TransfersTab() {
  const [transfers,  setTransfers]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [yearFilter, setYearFilter] = useState(CURRENT_SEASON);
  const [search,     setSearch]     = useState("");

  useEffect(() => { fetchTransfers(); }, [yearFilter]);

  async function fetchTransfers() {
    setLoading(true);
    const { data } = await supabase
      .from("portal_transfers")
      .select("*")
      .eq("season_year", yearFilter)
      .order("created_at", { ascending: false });
    setTransfers(data || []);
    setLoading(false);
  }

  async function handleAdd(form) {
    setSaving(true);
    const { error } = await supabase.from("portal_transfers").insert({
      player_id:   form.player_id   || null,
      player_name: form.player_name.trim(),
      torvik_pid:  form.torvik_pid.trim() || null,
      from_team:   form.from_team.trim(),
      to_team:     form.to_team.trim(),
      season_year: form.season_year,
      status:      form.status,
    });
    if (error) { alert("Error: " + error.message); }
    else { await fetchTransfers(); }
    setSaving(false);
  }

  async function handleUpdate(id, form) {
    setSaving(true);
    const { error } = await supabase.from("portal_transfers").update({
      player_id:   form.player_id   || null,
      player_name: form.player_name.trim(),
      torvik_pid:  form.torvik_pid.trim() || null,
      from_team:   form.from_team.trim(),
      to_team:     form.to_team.trim(),
      season_year: form.season_year,
      status:      form.status,
    }).eq("id", id);
    if (error) { alert("Error: " + error.message); }
    else { setEditId(null); await fetchTransfers(); }
    setSaving(false);
  }

  async function handleDelete(id) {
    if (!confirm("Delete this transfer record?")) return;
    await supabase.from("portal_transfers").delete().eq("id", id);
    setTransfers(prev => prev.filter(t => t.id !== id));
  }

  async function handleStatusChange(id, status) {
    await supabase.from("portal_transfers").update({ status }).eq("id", id);
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  }

  const filtered = transfers.filter(t => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (t.player_name || "").toLowerCase().includes(q)
        || (t.from_team   || "").toLowerCase().includes(q)
        || (t.to_team     || "").toLowerCase().includes(q);
  });

  return (
    <div>
      <Section title="Add Transfer">
        <TransferForm onSave={handleAdd} saving={saving} />
      </Section>

      <Section title={`Records — ${yearFilter} Season (${transfers.length})`}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[2026, 2027, 2028].map(y => (
              <button key={y} onClick={() => setYearFilter(y)} style={{
                fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 20, cursor: "pointer", border: "1px solid",
                background:  yearFilter === y ? "rgba(91,156,246,.2)" : "transparent",
                color:       yearFilter === y ? "#5b9cf6"             : "rgba(255,255,255,.35)",
                borderColor: yearFilter === y ? "rgba(91,156,246,.4)" : "rgba(255,255,255,.1)",
              }}>{y}</button>
            ))}
          </div>
          <input className="input" placeholder="Search…" value={search}
            onChange={e => setSearch(e.target.value)} style={{ width: 200, fontSize: 12 }} />
        </div>

        {loading ? (
          <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ opacity: .35, fontSize: 13 }}>No records.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map(t => (
              <div key={t.id}>
                {editId === t.id ? (
                  <TransferForm
                                       initial={{ player_id: t.player_id || null, player_name: t.player_name || "",
                      torvik_pid: t.torvik_pid || "", from_team: t.from_team, to_team: t.to_team,
                      season_year: t.season_year, status: t.status }}
                    saving={saving}
                    onSave={form => handleUpdate(t.id, form)}
                    onCancel={() => setEditId(null)}
                  />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                    background: "rgba(255,255,255,.03)", border: "1px solid var(--border)",
                    borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {t.player_name || <span style={{ opacity: .4 }}>—</span>}
                        {!t.player_id && <span style={{ marginLeft: 6, fontSize: 10, opacity: .35, fontWeight: 400 }}>unlinked</span>}
                      </div>
                      <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>
                        {t.from_team} → {t.to_team} · {t.season_year}
                        {t.torvik_pid && <span style={{ marginLeft: 6, opacity: .6 }}>pid: {t.torvik_pid}</span>}
                      </div>
                    </div>
                    <select className="input" value={t.status} style={{ fontSize: 11, padding: "2px 6px", width: "auto" }}
                      onChange={e => handleStatusChange(t.id, e.target.value)}>
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                    <StatusBadge status={t.status} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                        onClick={() => setEditId(t.id)}>Edit</button>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
                        onClick={() => handleDelete(t.id)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Players tab ────────────────────────────────────────────────────────────
function PlayersTab() {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editId,  setEditId]  = useState(null);
  const [saving,  setSaving]  = useState(false);
  const timeoutRef = useRef(null);

  const search = useCallback((q) => {
    clearTimeout(timeoutRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    timeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("vw_players")
        .select("id, name, primary_position, year, current_team, open_market_high, open_market_low, nil_valuation")
        .ilike("name", `%${q.trim()}%`)
        .order("name")
        .limit(30);
      setResults(data || []);
      setLoading(false);
    }, 250);
  }, []);

  useEffect(() => { search(query); }, [query]);

  async function handleSave(id, patch) {
    setSaving(true);
    const { error } = await supabase.from("players").update(patch).eq("id", id);
    if (error) { alert("Error: " + error.message); setSaving(false); return; }
    setResults(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
    setEditId(null);
    setSaving(false);
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <input className="input" placeholder="Search player by name…" value={query}
          onChange={e => setQuery(e.target.value)} style={{ width: 300 }} />
        {loading && <span style={{ marginLeft: 10, fontSize: 12, opacity: .4 }}>Searching…</span>}
      </div>

      {results.length === 0 && query.trim().length >= 2 && !loading && (
        <div style={{ opacity: .35, fontSize: 13 }}>No players found.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {results.map(p => (
          <div key={p.id}>
            {editId === p.id
              ? <PlayerEditForm player={p} saving={saving} onSave={patch => handleSave(p.id, patch)} onCancel={() => setEditId(null)} />
              : (
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  background: "rgba(255,255,255,.03)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                    <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>
                      {p.primary_position} · {p.year} · {p.current_team}
                    </div>
                  </div>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                    onClick={() => setEditId(p.id)}>Edit</button>
                </div>
              )
            }
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerEditForm({ player, onSave, onCancel, saving }) {
  const [year,    setYear]    = useState(player.year             || "");
  const [pos,     setPos]     = useState(player.primary_position || "");
  const [team,    setTeam]    = useState(player.current_team     || "");
  const [mktLow,  setMktLow]  = useState(player.open_market_low  ?? "");
  const [mktHigh, setMktHigh] = useState(player.open_market_high ?? "");
  const [nilVal,  setNilVal]  = useState(player.nil_valuation    ?? "");

  function submit() {
    onSave({
      year:             year    || null,
      primary_position: pos     || null,
      current_team:     team    || null,
      open_market_low:  mktLow  !== "" ? Number(mktLow)  : null,
      open_market_high: mktHigh !== "" ? Number(mktHigh) : null,
      nil_valuation:    nilVal  !== "" ? Number(nilVal)  : null,
    });
  }

  return (
    <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, maxWidth: 640 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>{player.name}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle}>Year / Eligibility</label>
          <select className="input" style={{ width: "100%" }} value={year} onChange={e => setYear(e.target.value)}>
            <option value="">— unset —</option>
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Position</label>
          <select className="input" style={{ width: "100%" }} value={pos} onChange={e => setPos(e.target.value)}>
            <option value="">— unset —</option>
            {POSITION_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Current Team</label>
          <input className="input" style={{ width: "100%" }} value={team}
            onChange={e => setTeam(e.target.value)} placeholder="Team name" />
        </div>
        <div>
          <label style={labelStyle}>Market Low ($)</label>
          <input className="input" style={{ width: "100%" }} type="number" value={mktLow}
            onChange={e => setMktLow(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label style={labelStyle}>Market High ($)</label>
          <input className="input" style={{ width: "100%" }} type="number" value={mktHigh}
            onChange={e => setMktHigh(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label style={labelStyle}>NIL Valuation ($)</label>
          <input className="input" style={{ width: "100%" }} type="number" value={nilVal}
            onChange={e => setNilVal(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving} onClick={submit}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Coaches tab ────────────────────────────────────────────────────────────
function CoachesTab() {
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(null);

  useEffect(() => {
    supabase.from("coaches").select("user_id, display_name, team, role").order("team")
      .then(({ data }) => { setCoaches(data || []); setLoading(false); });
  }, []);

  async function handleRoleChange(userId, role) {
    setSaving(userId);
    const { error } = await supabase.from("coaches").update({ role }).eq("user_id", userId);
    if (error) { alert("Error: " + error.message); }
    else { setCoaches(prev => prev.map(c => c.user_id === userId ? { ...c, role } : c)); }
    setSaving(null);
  }

  const ROLE_OPTIONS = ["coach", "admin", "nonaffiliate", "superadmin"];
  const ROLE_COLOR   = { superadmin: "#f5a623", admin: "#5b9cf6", nonaffiliate: "#94a3b8", coach: "rgba(255,255,255,.5)" };

  if (loading) return <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {coaches.map(c => (
        <div key={c.user_id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{c.display_name || <span style={{ opacity: .4 }}>Unnamed</span>}</div>
            <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>{c.team} · {c.user_id}</div>
          </div>
          <select className="input" value={c.role || "coach"}
            style={{ fontSize: 11, padding: "2px 6px", width: "auto", color: ROLE_COLOR[c.role] || "inherit" }}
            disabled={saving === c.user_id}
            onChange={e => handleRoleChange(c.user_id, e.target.value)}>
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {saving === c.user_id && <span style={{ fontSize: 11, opacity: .4 }}>Saving…</span>}
        </div>
      ))}
    </div>
  );
}
