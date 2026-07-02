import { useState, useEffect, useRef, useCallback } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { supabase }   from "@/lib/supabase";
import { money, nilRange, letterGrade, gradeColor } from "@/lib/display";
import { InternationalAdminContent } from "@/pages/InternationalAdminPage";
import { DefCard } from "@/components/DefCard";
import { DOMESTIC_FIELDS, domesticValues, resolveArchetypeList, matchArchetypes } from "@/lib/archetypeMatch";
import { renderArticleBody } from "@/lib/renderArticle";

// Load every row from a table/view, paging past PostgREST's 1000-row cap.
async function fetchAllRows(table, columns) {
  const PAGE = 1000;
  let from = 0, all = [];
  for (;;) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Self-contained team search — queries vw_players.current_team (avoids teams table RLS)
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
        .from("vw_players")
        .select("current_team")
        .ilike("current_team", `%${q.trim()}%`)
        .not("current_team", "is", null)
        .limit(50);
      const unique = [...new Set((data || []).map(r => r.current_team))].sort();
      setSuggestions(unique.slice(0, 14));
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

const PLAYER_STATUS_OPTIONS = ["returning", "graduating", "transferring", "declared"];
const PLAYER_STATUS_COLOR   = {
  returning:   "#4ade80",
  graduating:  "#5b9cf6",
  transferring: "#f5a623",
  declared:    "#c084fc",
};

const YEAR_OPTIONS = ["Fr", "RS Fr", "So", "RS So", "Jr", "RS Jr", "Sr", "RS Sr", "Grad", "5th Year", "JuCo", "G League"];

const ARCHETYPE_OPTIONS = [
  "Three-Point Specialist",
  "Playmaking Guard", "Two-Way Guard", "Scoring Guard",
  "3-and-D Wing", "Scoring Wing", "Versatile Wing",
  "Two-Way Big", "Rim Protector", "Stretch Big",
];
const POSITION_OPTIONS = ["Guard", "Wing", "Big"];

const PENTAGON_METRICS = [
  { key: "sei", label: "SEI" },
  { key: "ath", label: "ATH" },
  { key: "ris", label: "RIS" },
  { key: "dds", label: "DDS" },
  { key: "cdi", label: "CDI" },
];

const EMPTY_FORM = {
  player_id:            null,
  existing_transfer_id: null,  // if set, Save will UPDATE this row instead of inserting
  player_name:          "",
  torvik_pid:           "",
  from_team:            "",
  to_team:              "",
  season_year:          CURRENT_SEASON,
  status:               "committed",
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
            {nilRange(player.open_market_low, player.open_market_high)}
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

    // Look up their existing transfer record to auto-fill fields and track the row ID
    const { data: existing } = await supabase
      .from("portal_transfers")
      .select("id, to_team, from_team, status, season_year, torvik_pid")
      .eq("player_id", p.id)
      .order("season_year", { ascending: false })
      .limit(1)
      .single();

    setForm(f => ({
      ...f,
      player_id:            p.id,
      player_name:          p.name,
      existing_transfer_id: existing?.id ?? null,
      from_team:            existing?.from_team  || p.current_team || f.from_team,
      to_team:              existing?.to_team    || f.to_team,
      status:               existing?.status     || f.status,
      season_year:          existing?.season_year ?? f.season_year,
      torvik_pid:           existing?.torvik_pid  || f.torvik_pid,
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
            disabled={saving || !form.player_name.trim()}
            onClick={() => onSave(form)}>
            {saving ? "Saving…" : form.existing_transfer_id ? "Update Record" : "Add New Record"}
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
              { key: "transfers",     label: "Portal Transfers" },
              { key: "players",       label: "Players" },
              { key: "archetypes",    label: "Archetypes" },
              { key: "freshmen",      label: "Freshmen Management" },
              { key: "news",          label: "News" },
              { key: "international", label: "International" },
              { key: "coaches",       label: "Coaches" },
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
          {activeTab === "transfers"     && <TransfersTab />}
          {activeTab === "players"       && <PlayersTab />}
          {activeTab === "archetypes"    && <ArchetypesTab />}
          {activeTab === "freshmen"      && <FreshmanTiersTab />}
          {activeTab === "news"          && <NewsTab />}
          {activeTab === "international" && <InternationalAdminContent />}
          {activeTab === "coaches"       && <CoachesTab />}
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
    const payload = {
      player_id:   form.player_id         || null,
      player_name: form.player_name.trim(),
      torvik_pid:  form.torvik_pid.trim() || null,
      from_team:   form.from_team.trim()  || null,
      to_team:     form.to_team.trim()    || null,
      season_year: form.season_year,
      status:      form.status,
    };

    let error;
    if (form.existing_transfer_id) {
      ({ error } = await supabase.from("portal_transfers").update(payload).eq("id", form.existing_transfer_id));
    } else {
      ({ error } = await supabase.from("portal_transfers").insert(payload));
    }
    if (error) { alert("Error: " + error.message); }
    else {
      // Auto-mark the linked player as transferring
      if (form.player_id) {
        await supabase.from("players").update({ player_status: "transferring" }).eq("id", form.player_id);
      }
      await fetchTransfers();
    }
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
    else {
      if (form.player_id) {
        await supabase.from("players").update({ player_status: "transferring" }).eq("id", form.player_id);
      }
      setEditId(null);
      await fetchTransfers();
    }
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
  const [query,      setQuery]      = useState("");
  const [results,    setResults]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [editPlayer, setEditPlayer] = useState(null);
  const [addMode,    setAddMode]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const timeoutRef = useRef(null);

  const search = useCallback((q) => {
    clearTimeout(timeoutRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    timeoutRef.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from("vw_players")
        .select("*")
        .ilike("name", `%${q.trim()}%`)
        .order("name")
        .limit(30);
      if (error) { console.error("Player search error:", error); setLoading(false); return; }
      const players = data || [];
      if (players.length) {
        const ids = players.map(p => p.id);
        const { data: statusRows } = await supabase
          .from("players")
          .select("id, player_status, archetype_overwrite, archetypes, archetype_override")
          .in("id", ids);
        const byId = Object.fromEntries((statusRows || []).map(r => [r.id, r]));
        setResults(players.map(p => ({
          ...p,
          player_status:       byId[p.id]?.player_status       ?? null,
          archetype_overwrite: byId[p.id]?.archetype_overwrite ?? null,
          archetypes:          byId[p.id]?.archetypes          ?? [],
          archetype_override:  byId[p.id]?.archetype_override  ?? null,
        })));
      } else {
        setResults([]);
      }
      setLoading(false);
    }, 250);
  }, []);

  useEffect(() => { search(query); }, [query]);

  function handleEdit(p) {
    setEditPlayer(p);
    setEditId(p.id);
    setAddMode(false);
  }

  async function handleSave(id, patch) {
    setSaving(true);
    const { data, error } = await supabase.from("players").update(patch).eq("id", id).select();
    if (error) {
      console.error("handleSave error:", error);
      alert("Error: " + error.message);
      setSaving(false);
      return;
    }
    if (!data || data.length === 0) {
      console.warn("handleSave: update returned no rows — likely RLS blocking write on players table");
      alert("Save failed: no rows updated. Check RLS policy on players table.");
      setSaving(false);
      return;
    }
    setResults(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
    setEditId(null);
    setEditPlayer(null);
    setSaving(false);
  }

  async function handleAdd(patch) {
    setSaving(true);
    const { data, error } = await supabase.from("players").insert(patch).select();
    if (error) {
      console.error("handleAdd error:", error);
      alert("Error: " + error.message);
      setSaving(false);
      return;
    }
    setAddMode(false);
    if (query.trim().length >= 2) search(query);
    setSaving(false);
  }

  async function handlePlayerStatusChange(id, player_status) {
    const { error } = await supabase.from("players").update({ player_status }).eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    setResults(prev => prev.map(p => p.id === id ? { ...p, player_status } : p));
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <input className="input" placeholder="Search player by name…" value={query}
          onChange={e => { setQuery(e.target.value); setEditId(null); setEditPlayer(null); setAddMode(false); }}
          style={{ width: 300 }} />
        {loading && <span style={{ fontSize: 12, opacity: .4 }}>Searching…</span>}
        <button className="btn btn-primary" style={{ fontSize: 12, marginLeft: "auto" }}
          onClick={() => { setAddMode(true); setEditId(null); setEditPlayer(null); }}>
          + Add Player
        </button>
      </div>

      {addMode && (
        <div style={{ marginBottom: 20 }}>
          <PlayerEditForm
            player={{}}
            mode="add"
            saving={saving}
            onSave={patch => handleAdd(patch)}
            onCancel={() => setAddMode(false)}
          />
        </div>
      )}

      {results.length === 0 && query.trim().length >= 2 && !loading && (
        <div style={{ opacity: .35, fontSize: 13 }}>No players found.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {results.map(p => (
          <div key={p.id}>
            {editId === p.id
              ? <PlayerEditForm
                  player={editPlayer || p}
                  mode="edit"
                  saving={saving}
                  onSave={patch => handleSave(p.id, patch)}
                  onCancel={() => { setEditId(null); setEditPlayer(null); }}
                />
              : (
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  background: "rgba(255,255,255,.03)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                    <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>
                      {[p.primary_position, p.year, p.current_team].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <select
                    className="input"
                    value={p.player_status || ""}
                    style={{ fontSize: 11, padding: "2px 6px", width: "auto",
                      color: PLAYER_STATUS_COLOR[p.player_status] || "rgba(255,255,255,.4)" }}
                    onChange={e => handlePlayerStatusChange(p.id, e.target.value || null)}
                  >
                    <option value="">— status —</option>
                    {PLAYER_STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                    onClick={() => handleEdit(p)}>Edit</button>
                </div>
              )
            }
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerEditForm({ player, mode = "edit", onSave, onCancel, saving }) {
  const isAdd = mode === "add";
  const [form, setForm] = useState({
    name:                player.name                || "",
    espn_id:             player.espn_id             || "",
    height:              player.height              || "",
    hometown:            player.hometown            || "",
    year:                player.year                || "",
    eligibility_years:   player.eligibility_years   ?? "",
    primary_position:    player.primary_position    || "",
    current_team:        player.current_team        || "",
    player_status:       player.player_status       || "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ── Archetypes ──────────────────────────────────────────────────────────
  // Definitions drive both the auto-match (computed live from this player's
  // metrics) and the available-to-add list + colors.
  const [defs, setDefs]   = useState([]);
  const [defsLoaded, setDefsLoaded] = useState(false);
  useEffect(() => {
    supabase.from("archetype_defs").select("*").order("priority")
      .then(({ data }) => { setDefs(data || []); setDefsLoaded(true); });
  }, []);

  const colorByName = Object.fromEntries(defs.map(d => [d.name, d.color || "#f5a623"]));
  const defNames    = [...new Set(defs.map(d => d.name))];
  // What the player would match purely from thresholds, computed live.
  const autoList    = matchArchetypes(domesticValues(player), defs, DOMESTIC_FIELDS);

  // overrideList: null = auto (use autoList); array = explicit set ([] = none).
  const [overrideList, setOverrideList] = useState(
    Array.isArray(player.archetype_override) ? player.archetype_override : null
  );
  const effective = overrideList != null ? overrideList : autoList;
  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

  function removeArch(name) { setOverrideList(effective.filter(x => x !== name)); }
  function addArch(name)    { if (name && !effective.includes(name)) setOverrideList([...effective, name]); }
  function resetAuto()      { setOverrideList(null); }

  function submit() {
    const num = (v) => v !== "" ? Number(v) : null;
    const patch = {
      name:              form.name.trim()          || null,
      espn_id:           form.espn_id.trim()       || null,
      height:            form.height.trim()        || null,
      hometown:          form.hometown.trim()      || null,
      year:              form.year                 || null,
      eligibility_years: num(form.eligibility_years),
      primary_position:  form.primary_position     || null,
      current_team:      form.current_team.trim()  || null,
      player_status:     form.player_status        || null,
    };
    // Only write archetype fields once definitions have loaded, so we never
    // clobber a player's archetypes with an empty auto-match.
    if (defsLoaded) {
      // Treat an explicit override that equals the auto-match as "auto" (null).
      const finalOverride = overrideList != null && !sameSet(overrideList, autoList) ? overrideList : null;
      const list = finalOverride != null ? finalOverride : autoList;
      patch.archetype_override  = finalOverride;   // jsonb: null | string[]
      patch.archetype_overwrite = null;            // retire the legacy single override
      patch.archetypes          = list;
      patch.archetype           = list[0] ?? null;
    }
    onSave(patch);
  }

  const pill = (name, onRemove) => {
    const c = colorByName[name] || "#f5a623";
    return (
      <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 6px 3px 10px",
        borderRadius: 20, fontSize: 12, fontWeight: 600, background: `${c}22`, color: c, border: `1px solid ${c}55` }}>
        {name}
        <button onClick={() => onRemove(name)} title="Shut off for this player"
          style={{ background: "none", border: "none", color: c, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
      </span>
    );
  };

  const sectionHead = (title) => (
    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .35,
      fontWeight: 600, marginBottom: 10, marginTop: 4 }}>{title}</div>
  );

  return (
    <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 18 }}>
        {isAdd ? "Add New Player" : (player.name || "Edit Player")}
      </div>

      {/* Identity */}
      {sectionHead("Identity")}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input className="input" style={{ width: "100%" }} value={form.name}
            onChange={e => set("name", e.target.value)} placeholder="Full name" />
        </div>
        <div>
          <label style={labelStyle}>ESPN ID</label>
          <input className="input" style={{ width: "100%" }} value={form.espn_id}
            onChange={e => set("espn_id", e.target.value)} placeholder="optional" />
        </div>
        <div>
          <label style={labelStyle}>Height</label>
          <input className="input" style={{ width: "100%" }} value={form.height}
            onChange={e => set("height", e.target.value)} placeholder='6&apos;4"' />
        </div>
        <div>
          <label style={labelStyle}>Hometown</label>
          <input className="input" style={{ width: "100%" }} value={form.hometown}
            onChange={e => set("hometown", e.target.value)} placeholder="City, ST" />
        </div>
      </div>

      {/* Classification */}
      {sectionHead("Classification")}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 2fr 2fr 1fr", gap: 10, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Class / Year</label>
          <select className="input" style={{ width: "100%" }} value={form.year} onChange={e => set("year", e.target.value)}>
            <option value="">— unset —</option>
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Elig. Years Left</label>
          <input className="input" style={{ width: "100%" }} type="number" min={1} max={5}
            value={form.eligibility_years} onChange={e => set("eligibility_years", e.target.value)}
            placeholder="1–5" />
        </div>
        <div>
          <label style={labelStyle}>Position</label>
          <select className="input" style={{ width: "100%" }} value={form.primary_position} onChange={e => set("primary_position", e.target.value)}>
            <option value="">— unset —</option>
            {POSITION_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Current Team</label>
          <input className="input" style={{ width: "100%" }} value={form.current_team}
            onChange={e => set("current_team", e.target.value)} placeholder="Team name" />
        </div>
        <div>
          <label style={labelStyle}>Player Status</label>
          <select className="input" style={{ width: "100%", color: PLAYER_STATUS_COLOR[form.player_status] || "inherit" }}
            value={form.player_status} onChange={e => set("player_status", e.target.value)}>
            <option value="">— unset —</option>
            {PLAYER_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>


      {/* Archetypes */}
      {sectionHead("Archetypes")}
      <div style={{ fontSize: 11, opacity: .35, marginBottom: 10, marginTop: -6 }}>
        Auto-assigned from the threshold definitions. Shut specific ones off with ×, or add a
        specific archetype below. Any change pins this player (overriding auto-match) until you reset.
        {overrideList != null && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}
            onClick={resetAuto}>Reset to auto</button>
        )}
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minHeight: 30 }}>
          {effective.length === 0 && (
            <span style={{ fontSize: 12, opacity: .35, fontStyle: "italic" }}>
              {overrideList != null ? "No archetypes (all shut off)" : (defsLoaded ? "No threshold matches" : "Loading…")}
            </span>
          )}
          {effective.map(name => pill(name, removeArch))}
        </div>
        {defNames.filter(n => !effective.includes(n)).length > 0 && (
          <select className="input" style={{ width: 240, marginTop: 10, fontSize: 12 }}
            value="" onChange={e => addArch(e.target.value)}>
            <option value="">+ Add archetype…</option>
            {defNames.filter(n => !effective.includes(n)).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <div style={{ fontSize: 11, opacity: .3, marginTop: 8 }}>
          {overrideList != null
            ? "Pinned — this exact set is saved for the player."
            : "Auto — follows the definitions on every recompute."}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving} onClick={submit}>
          {saving ? "Saving…" : isAdd ? "Add Player" : "Save Changes"}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Archetypes tab ─────────────────────────────────────────────────────────
// Superadmin-defined archetype definitions (named threshold ranges) for the
// domestic pools. A player's resolved archetype = override ?? threshold-match.
// "Recompute" reads the latest-season fields from the view, the per-player
// override from the base table, resolves, and writes `archetype`.
function ArchetypesTab() {
  const [sport, setSport] = useState("mens");
  const cfg = sport === "mens"
    ? { defs: "archetype_defs",   view: "vw_players",   players: "players"   }
    : { defs: "w_archetype_defs", view: "vw_w_players", players: "w_players" };

  const [defs,        setDefs]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [msg,         setMsg]         = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from(cfg.defs).select("*").order("priority");
    if (error) { alert("Load failed: " + error.message); setLoading(false); return; }
    setDefs(data || []);
    setLoading(false);
  }, [cfg.defs]);

  useEffect(() => { load(); }, [load]);

  async function addDef() {
    const { data, error } = await supabase.from(cfg.defs)
      .insert({ name: "New Archetype", priority: defs.length }).select();
    if (error) { alert("Add failed: " + error.message); return; }
    setDefs(prev => [...prev, ...(data || [])]);
  }

  async function saveDef(id, patch) {
    const { error } = await supabase.from(cfg.defs).update(patch).eq("id", id);
    if (error) { alert("Save failed: " + error.message); return; }
    setDefs(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
  }

  async function deleteDef(id) {
    if (!confirm("Delete this archetype definition?")) return;
    const { error } = await supabase.from(cfg.defs).delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    setDefs(prev => prev.filter(d => d.id !== id));
  }

  async function recompute() {
    if (!defs.length) { setMsg("Define at least one archetype before recomputing."); return; }
    setRecomputing(true); setMsg("Scanning players…");
    try {
      // Match fields come from the view (latest-season stats + metrics); the
      // current archetype + override live on the base table (the men's
      // vw_players doesn't expose archetype, so never read it from the view).
      const rows     = await fetchAllRows(cfg.view, "id, ppg, rpg, apg, 3p_pct, sei, ath, ris, dds, cdi");
      const baseRows = await fetchAllRows(cfg.players, "id, archetype, archetypes, archetype_overwrite, archetype_override");
      const baseById = Object.fromEntries(baseRows.map(r => [r.id, r]));

      const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
      const changed = [];
      for (const r of rows) {
        const base = baseById[r.id] || {};
        // Prefer the explicit override LIST; fall back to the legacy text override.
        const override = base.archetype_override != null ? base.archetype_override : base.archetype_overwrite;
        const { list, primary } = resolveArchetypeList(override, domesticValues(r), defs, DOMESTIC_FIELDS);
        if ((primary || null) !== (base.archetype || null) || !sameList(list, base.archetypes)) {
          changed.push({ id: r.id, archetype: primary, archetypes: list });
        }
      }

      const CHUNK = 25;
      for (let i = 0; i < changed.length; i += CHUNK) {
        await Promise.all(changed.slice(i, i + CHUNK).map(c =>
          supabase.from(cfg.players).update({ archetype: c.archetype, archetypes: c.archetypes }).eq("id", c.id)));
        setMsg(`Updating… ${Math.min(i + CHUNK, changed.length)}/${changed.length}`);
      }
      setMsg(`Done — ${changed.length} player${changed.length === 1 ? "" : "s"} updated (${rows.length} scanned).`);
    } catch (e) {
      setMsg("Recompute failed: " + e.message);
    }
    setRecomputing(false);
  }

  return (
    <div>
      {/* Men's / Women's toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[["mens", "Men's"], ["womens", "Women's"]].map(([val, lbl]) => (
          <button key={val} onClick={() => { setSport(val); setMsg(""); }} style={{
            fontSize: 12, fontWeight: 600, padding: "5px 16px", borderRadius: 20, cursor: "pointer", border: "1px solid",
            background:  sport === val ? "rgba(245,166,35,.15)" : "transparent",
            color:       sport === val ? "#f5a623"              : "rgba(255,255,255,.4)",
            borderColor: sport === val ? "rgba(245,166,35,.4)"  : "rgba(255,255,255,.12)",
          }}>{lbl}</button>
        ))}
      </div>

      <Section
        title={`Archetype definitions — ${sport === "mens" ? "Men's" : "Women's"} (${defs.length})`}
      >
        <div style={{ fontSize: 12, opacity: .45, marginBottom: 16, maxWidth: 680 }}>
          A player matches an archetype when every set range contains their latest-season value.
          Leave a field as <em>any–any</em> to ignore it. When several archetypes match, the lowest
          <strong> priority</strong> number wins. Click <strong>Recompute</strong> to apply changes to
          all players (per-player overrides always take precedence).
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
          <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={addDef}>+ Add archetype</button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={recomputing} onClick={recompute}>
            {recomputing ? "Recomputing…" : "↻ Recompute all players"}
          </button>
          {msg && <span style={{ fontSize: 12, opacity: .6 }}>{msg}</span>}
        </div>

        {loading ? (
          <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
        ) : defs.length === 0 ? (
          <div style={{ opacity: .35, fontSize: 13 }}>No archetypes defined yet. Click "+ Add archetype".</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {defs.map(def => (
              <DefCard key={def.id} def={def} fields={DOMESTIC_FIELDS}
                onSave={patch => saveDef(def.id, patch)} onDelete={() => deleteDef(def.id)} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Freshman Tiers tab ─────────────────────────────────────────────────────
// Admin-defined impact tiers for incoming freshmen. `effect` is the BTP score a
// freshman of that tier contributes to roster strength (slot-weighted like any
// player). Men's → freshman_tiers, Women's → w_freshman_tiers.
function FreshmanTiersTab() {
  const [sport, setSport] = useState("mens");
  const table = sport === "mens" ? "freshman_tiers" : "w_freshman_tiers";

  const [tiers,   setTiers]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from(table).select("*").order("sort");
    if (error) { alert("Load failed: " + error.message); setLoading(false); return; }
    setTiers(data || []);
    setLoading(false);
  }, [table]);

  useEffect(() => { load(); }, [load]);

  async function addTier() {
    const { data, error } = await supabase.from(table)
      .insert({ name: "New Tier", effect: 0, color: "#fbbf24", sort: tiers.length }).select();
    if (error) { alert("Add failed: " + error.message); return; }
    setTiers(prev => [...prev, ...(data || [])]);
  }

  async function saveTier(id, patch) {
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    if (error) { alert("Save failed: " + error.message); return; }
    setTiers(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }

  async function deleteTier(id) {
    if (!confirm("Delete this freshman tier?")) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    setTiers(prev => prev.filter(t => t.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[["mens", "Men's"], ["womens", "Women's"]].map(([val, lbl]) => (
          <button key={val} onClick={() => setSport(val)} style={{
            fontSize: 12, fontWeight: 600, padding: "5px 16px", borderRadius: 20, cursor: "pointer", border: "1px solid",
            background:  sport === val ? "rgba(245,166,35,.15)" : "transparent",
            color:       sport === val ? "#f5a623"              : "rgba(255,255,255,.4)",
            borderColor: sport === val ? "rgba(245,166,35,.4)"  : "rgba(255,255,255,.12)",
          }}>{lbl}</button>
        ))}
      </div>

      <Section title={`Freshman impact tiers — ${sport === "mens" ? "Men's" : "Women's"} (${tiers.length})`}>
        <div style={{ fontSize: 12, opacity: .5, marginBottom: 16, maxWidth: 680 }}>
          When a coach adds an incoming freshman to a roster and tags one of these tiers, the
          freshman is scored at that tier's <strong>effect</strong> — a BTP score (≈ a starter's
          value, where ~1,000,000 = "1M BTP") — and runs through the same starter/bench/depth
          weighting as everyone else. Higher effect = bigger bump to the roster grade. Applies
          live; no recompute needed.
        </div>

        <button className="btn btn-primary" style={{ fontSize: 12, marginBottom: 18 }} onClick={addTier}>+ Add tier</button>

        {loading ? (
          <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
        ) : tiers.length === 0 ? (
          <div style={{ opacity: .35, fontSize: 13 }}>No tiers yet. Click "+ Add tier".</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tiers.map(t => <FreshmanTierRow key={t.id} tier={t}
              onSave={patch => saveTier(t.id, patch)} onDelete={() => deleteTier(t.id)} />)}
          </div>
        )}
      </Section>

      <Section title="Incoming freshmen by team">
        <div style={{ fontSize: 12, opacity: .5, marginBottom: 8, maxWidth: 680 }}>
          Attach official incoming freshmen to a team. These are global — they appear (read-only)
          on every coach's build of that team and raise that team's score in the roster-strength
          comparison. Pick a team, then add freshmen with a position and an impact tier.
        </div>
        <div style={{ fontSize: 11, opacity: .55, marginBottom: 14, maxWidth: 680, fontStyle: "italic",
          color: "#fbbf24" }}>
          ⚠ Freshman BTP metrics and NIL valuations are pre-enrollment <strong>estimates/projections</strong>,
          not verified production data.
        </div>
        <TeamFreshmenManager sport={sport} tiers={tiers} />
      </Section>
    </div>
  );
}

// Per-team official freshmen manager (superadmin). Men's → team_freshmen,
// Women's → w_team_freshmen. `tiers` is the loaded freshman_tiers for the sport.
function TeamFreshmenManager({ sport, tiers }) {
  const table = sport === "mens" ? "team_freshmen" : "w_team_freshmen";
  const [team,    setTeam]    = useState("");
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const nameRef = useRef(); const posRef = useRef(); const tierRef = useRef();

  const load = useCallback(async (t) => {
    if (!t) { setRows([]); return; }
    setLoading(true);
    const { data, error } = await supabase.from(table)
      .select("id, name, pos, tier, sei, ath, ris, dds, cdi, nil_valuation").eq("team", t).order("created_at");
    if (error) { alert("Load failed: " + error.message); setLoading(false); return; }
    setRows(data || []);
    setLoading(false);
  }, [table]);

  useEffect(() => { load(team); }, [team, load]);

  async function add() {
    const name = nameRef.current?.value?.trim();
    if (!name || !team) return;
    const { data, error } = await supabase.from(table)
      .insert({ team, name, pos: posRef.current?.value || "Guard", tier: tierRef.current?.value || null })
      .select();
    if (error) { alert("Add failed: " + error.message); return; }
    setRows(prev => [...prev, ...(data || [])]);
    nameRef.current.value = ""; posRef.current.value = "Guard"; tierRef.current.value = "";
  }

  async function save(id, patch) {
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    if (error) { alert("Save failed: " + error.message); return; }
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }

  async function del(id) {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    setRows(prev => prev.filter(r => r.id !== id));
  }

  return (
    <div>
      <div style={{ maxWidth: 360, marginBottom: 16 }}>
        <label style={labelStyle}>Team</label>
        <TeamSearch value={team} onChange={setTeam} placeholder="Search team…" />
      </div>

      {!team ? (
        <div style={{ opacity: .35, fontSize: 13 }}>Pick a team to manage its incoming freshmen.</div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 14 }}>
            <input className="input" placeholder="Freshman name" style={{ flex: "1 1 180px", fontSize: 13 }} ref={nameRef} defaultValue="" />
            <select className="input" style={{ width: 96, fontSize: 13 }} ref={posRef} defaultValue="Guard">
              <option value="Guard">Guard</option><option value="Wing">Wing</option><option value="Big">Big</option>
            </select>
            <select className="input" style={{ width: 150, fontSize: 13 }} ref={tierRef} defaultValue="">
              <option value="">No impact</option>
              {tiers.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={add}>+ Add</button>
          </div>

          {loading ? (
            <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ opacity: .35, fontSize: 13 }}>No official freshmen for {team} yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rows.map(r => (
                <TeamFreshmanRow key={r.id} row={r} tiers={tiers}
                  onSave={patch => save(r.id, patch)} onDelete={() => del(r.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const FRESH_METRICS = ["sei", "ath", "ris", "dds", "cdi"];

// Editable official-freshman row: name, pos, tier (fallback score), and optional
// BTP metrics (0–100). When any metric is set, metrics drive the score instead.
function TeamFreshmanRow({ row, tiers, onSave, onDelete }) {
  const [form, setForm] = useState(row);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setForm(row); setDirty(false); }, [row.id]);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };

  const hasMetrics = FRESH_METRICS.some(k => form[k] != null && form[k] !== "");
  const tierColor  = Object.fromEntries(tiers.map(t => [t.name, t.color || "#fbbf24"]))[form.tier] || "#fbbf24";

  function save() {
    const num = v => (v === "" || v == null ? null : Number(v));
    onSave({
      name: (form.name || "").trim() || "Unnamed",
      pos:  form.pos || "Guard",
      tier: form.tier || null,
      nil_valuation: num(form.nil_valuation),
      ...Object.fromEntries(FRESH_METRICS.map(k => [k, num(form[k])])),
    });
    setDirty(false);
  }

  return (
    <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: "1 1 150px", fontSize: 13 }} value={form.name || ""}
          onChange={e => set("name", e.target.value)} />
        <select className="input" style={{ width: 90, fontSize: 12 }} value={form.pos || "Guard"} onChange={e => set("pos", e.target.value)}>
          <option value="Guard">Guard</option><option value="Wing">Wing</option><option value="Big">Big</option>
        </select>
        <select className="input" style={{ width: 140, fontSize: 12, opacity: hasMetrics ? .4 : 1 }}
          value={form.tier || ""} onChange={e => set("tier", e.target.value)}
          title={hasMetrics ? "Ignored while metrics are set" : "Fallback impact tier"}>
          <option value="">No tier</option>
          {tiers.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={!dirty} onClick={save}>
            {dirty ? "Save" : "Saved"}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
            onClick={onDelete}>Delete</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, fontWeight: 600 }}>
          BTP metrics {hasMetrics ? "(driving score)" : "(optional)"}
        </span>
        {FRESH_METRICS.map(k => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, opacity: .5, textTransform: "uppercase" }}>{k}</span>
            <input className="input" type="number" min="0" max="100" style={{ width: 56, fontSize: 12, padding: "3px 6px" }}
              value={form[k] ?? ""} onChange={e => set(k, e.target.value)} placeholder="—" />
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8, paddingLeft: 10, borderLeft: "1px solid var(--border)" }}>
          <span style={{ fontSize: 10, opacity: .5, textTransform: "uppercase" }}>NIL $</span>
          <input className="input" type="number" min="0" step="10000" style={{ width: 96, fontSize: 12, padding: "3px 6px" }}
            value={form.nil_valuation ?? ""} onChange={e => set("nil_valuation", e.target.value)} placeholder="—" />
        </div>
      </div>
    </div>
  );
}

function FreshmanTierRow({ tier, onSave, onDelete }) {
  const [form, setForm] = useState(tier);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setForm(tier); setDirty(false); }, [tier.id]);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };

  function save() {
    onSave({
      name: (form.name || "").trim() || "Unnamed",
      effect: Number(form.effect) || 0,
      color: form.color || "#fbbf24",
      sort: Number(form.sort) || 0,
    });
    setDirty(false);
  }

  const c = form.color || "#fbbf24";
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap",
      background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ flex: "1 1 180px" }}>
        <label style={labelStyle}>Name</label>
        <input className="input" style={{ width: "100%" }} value={form.name || ""}
          onChange={e => set("name", e.target.value)} placeholder="e.g. High Impact" />
      </div>
      <div style={{ width: 140 }}>
        <label style={labelStyle}>Effect (BTP score)</label>
        <input className="input" type="number" step="10000" style={{ width: "100%" }} value={form.effect ?? 0}
          onChange={e => set("effect", e.target.value)} />
      </div>
      <div style={{ width: 70 }}>
        <label style={labelStyle}>Sort</label>
        <input className="input" type="number" style={{ width: "100%" }} value={form.sort ?? 0}
          onChange={e => set("sort", e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Color</label>
        <input type="color" value={c} onChange={e => set("color", e.target.value)}
          style={{ width: 48, height: 32, padding: 0, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", cursor: "pointer" }} />
      </div>
      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
        background: `${c}22`, color: c, border: `1px solid ${c}55` }}>
        {(form.name || "Preview").trim() || "Preview"} · {(Number(form.effect) || 0) / 1000000}M
      </span>
      <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={!dirty} onClick={save}>
          {dirty ? "Save" : "Saved"}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 12, color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
          onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

// ── News tab ───────────────────────────────────────────────────────────────
// Superadmin authoring for the /news board. Body supports **bold**,
// [text](url), and [[p:<id>|Name]] player mentions (inserted via search).
const EMPTY_NEWS = { title: "", body: "", event_date: "", status: "draft", pinned: false, author_name: "" };

function NewsTab() {
  const [posts,   setPosts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);  // post object | 'new' | null

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("news_posts")
      .select("*")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) { alert("Load failed: " + error.message); setLoading(false); return; }
    setPosts(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function savePost(form) {
    const payload = {
      title:       form.title.trim() || "Untitled",
      body:        form.body,
      event_date:  form.event_date || null,
      status:      form.status,
      pinned:      !!form.pinned,
      author_name: form.author_name?.trim() || null,
      // stamp published_at the first time it goes live
      published_at: form.status === "published" ? (form.published_at || new Date().toISOString()) : form.published_at || null,
    };
    let res;
    if (editing === "new") res = await supabase.from("news_posts").insert(payload).select();
    else                   res = await supabase.from("news_posts").update(payload).eq("id", editing.id).select();
    if (res.error) { alert("Save failed: " + res.error.message); return; }
    setEditing(null);
    await load();
  }

  async function quickUpdate(id, patch) {
    const { error } = await supabase.from("news_posts").update(patch).eq("id", id);
    if (error) { alert("Update failed: " + error.message); return; }
    setPosts(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  async function deletePost(id) {
    if (!confirm("Delete this post?")) return;
    const { error } = await supabase.from("news_posts").delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    setPosts(prev => prev.filter(p => p.id !== id));
  }

  if (editing) {
    const initial = editing === "new" ? EMPTY_NEWS : editing;
    return <NewsEditor initial={initial} onSave={savePost} onCancel={() => setEditing(null)} />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 12, opacity: .5, maxWidth: 560 }}>
          Posts appear on the <strong>/news</strong> board for all coaches once published. Use
          <strong> Insert player</strong> to drop a link that opens the player's card.
        </div>
        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => setEditing("new")}>+ New post</button>
      </div>

      {loading ? (
        <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
      ) : posts.length === 0 ? (
        <div style={{ opacity: .35, fontSize: 13 }}>No posts yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {posts.map(p => {
            const isPub = p.status === "published";
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {p.pinned && <span title="Pinned" style={{ marginRight: 6 }}>📌</span>}
                    {p.title}
                  </div>
                  <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>
                    {p.event_date ? `Event ${p.event_date} · ` : ""}{isPub ? "Published" : "Draft"}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                  color: isPub ? "#4ade80" : "#94a3b8", background: isPub ? "rgba(74,222,128,.15)" : "rgba(148,163,184,.12)",
                  border: `1px solid ${isPub ? "rgba(74,222,128,.4)" : "rgba(148,163,184,.3)"}` }}>{p.status}</span>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => quickUpdate(p.id, { pinned: !p.pinned })}>{p.pinned ? "Unpin" : "Pin"}</button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => quickUpdate(p.id, isPub
                    ? { status: "draft" }
                    : { status: "published", published_at: p.published_at || new Date().toISOString() })}>
                  {isPub ? "Unpublish" : "Publish"}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => setEditing(p)}>Edit</button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
                  onClick={() => deletePost(p.id)}>Delete</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewsEditor({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_NEWS, ...initial, event_date: initial.event_date || "" });
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const bodyRef = useRef();
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Insert a [[p:id|name]] token at the textarea caret.
  function insertPlayer(p) {
    const token = `[[p:${p.id}|${p.name}]]`;
    const el = bodyRef.current;
    const body = form.body || "";
    const start = el?.selectionStart ?? body.length;
    const end   = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    set("body", next);
    // restore caret after the inserted token
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function submit() {
    if (!form.title.trim()) { alert("Title is required."); return; }
    setSaving(true);
    await onSave(form);
    setSaving(false);
  }

  return (
    <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, padding: 20, maxWidth: 760 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>{initial.id ? "Edit Post" : "New Post"}</div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Title</label>
          <input className="input" style={{ width: "100%" }} value={form.title} onChange={e => set("title", e.target.value)} placeholder="Headline" />
        </div>
        <div>
          <label style={labelStyle}>Event date (optional)</label>
          <input className="input" type="date" style={{ width: "100%" }} value={form.event_date} onChange={e => set("event_date", e.target.value)} />
        </div>
      </div>

      <div style={{ marginBottom: 6, display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Insert player link</label>
          <PlayerMentionSearch onSelect={insertPlayer} />
        </div>
        <div style={{ fontSize: 10, opacity: .4, paddingBottom: 8 }}>
          Formatting: <code>**bold**</code>, <code>[text](https://…)</code>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Body</label>
        <textarea ref={bodyRef} className="input" rows={12} style={{ width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
          value={form.body} onChange={e => set("body", e.target.value)}
          placeholder="Write the article… Use Insert player to add a clickable player chip." />
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <label style={labelStyle}>Status</label>
          <select className="input" style={{ width: 140 }} value={form.status} onChange={e => set("status", e.target.value)}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, opacity: .8, cursor: "pointer", marginTop: 16 }}>
          <input type="checkbox" checked={form.pinned} onChange={e => set("pinned", e.target.checked)} /> Pinned
        </label>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Author (optional)</label>
          <input className="input" style={{ width: 200 }} value={form.author_name || ""} onChange={e => set("author_name", e.target.value)} placeholder="e.g. BTP Staff" />
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 12, marginTop: 16 }} onClick={() => setShowPreview(v => !v)}>
          {showPreview ? "Hide preview" : "Preview"}
        </button>
      </div>

      {showPreview && (
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, marginBottom: 8 }}>Preview</div>
          <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>{form.title || "Untitled"}</h2>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,.82)" }}>{renderArticleBody(form.body)}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving} onClick={submit}>
          {saving ? "Saving…" : "Save Post"}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Debounced vw_players type-ahead; calls onSelect(player) and clears.
function PlayerMentionSearch({ onSelect }) {
  const [query,       setQuery]       = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [open,        setOpen]        = useState(false);
  const timeoutRef = useRef(null);
  const wrapRef    = useRef(null);

  function search(q) {
    setQuery(q);
    clearTimeout(timeoutRef.current);
    if (q.trim().length < 2) { setSuggestions([]); setOpen(false); return; }
    timeoutRef.current = setTimeout(async () => {
      const { data } = await supabase.from("vw_players")
        .select("id, name, primary_position, current_team")
        .ilike("name", `%${q.trim()}%`).limit(8);
      setSuggestions(data || []);
      setOpen(true);
    }, 220);
  }

  useEffect(() => {
    function handler(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input className="input" style={{ width: "100%" }} placeholder="Search player to insert…"
        value={query} onChange={e => search(e.target.value)} />
      {open && suggestions.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 999,
          background: "#1a2233", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,.5)" }}>
          {suggestions.map(p => (
            <div key={p.id} onMouseDown={() => { onSelect(p); setQuery(""); setSuggestions([]); setOpen(false); }}
              style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,.06)" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.06)"}
              onMouseLeave={e => e.currentTarget.style.background = ""}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
              <div style={{ fontSize: 11, opacity: .45 }}>{[p.primary_position, p.current_team].filter(Boolean).join(" · ")}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── International Players tab ──────────────────────────────────────────────
function InternationalPlayersTab() {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editId,  setEditId]  = useState(null);
  const [addMode, setAddMode] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const timeoutRef = useRef(null);

  const search = useCallback((q) => {
    clearTimeout(timeoutRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    timeoutRef.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from("international_players")
        .select("id, name, league, profile_url, created_at")
        .ilike("name", `%${q.trim()}%`)
        .order("name")
        .limit(30);
      if (error) { console.error("Intl player search error:", error); }
      setResults(data || []);
      setLoading(false);
    }, 250);
  }, []);

  useEffect(() => { search(query); }, [query]);

  async function handleSave(id, patch) {
    setSaving(true);
    const { error } = await supabase.from("international_players").update(patch).eq("id", id);
    if (error) { alert("Error: " + error.message); setSaving(false); return; }
    setResults(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
    setEditId(null);
    setSaving(false);
  }

  async function handleAdd(patch) {
    setSaving(true);
    const { error } = await supabase.from("international_players").insert(patch);
    if (error) { alert("Error: " + error.message); setSaving(false); return; }
    setAddMode(false);
    if (query.trim().length >= 2) search(query);
    setSaving(false);
  }

  async function handleDelete(id) {
    if (!confirm("Delete this player? This will also remove their stats records.")) return;
    const { error } = await supabase.from("international_players").delete().eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    setResults(prev => prev.filter(p => p.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <input className="input" placeholder="Search international player by name…" value={query}
          onChange={e => { setQuery(e.target.value); setEditId(null); setAddMode(false); }}
          style={{ width: 340 }} />
        {loading && <span style={{ fontSize: 12, opacity: .4 }}>Searching…</span>}
        <button className="btn btn-primary" style={{ fontSize: 12, marginLeft: "auto" }}
          onClick={() => { setAddMode(true); setEditId(null); }}>
          + Add International Player
        </button>
      </div>

      {addMode && (
        <div style={{ marginBottom: 20 }}>
          <IntlPlayerEditForm
            player={{}}
            mode="add"
            saving={saving}
            onSave={patch => handleAdd(patch)}
            onCancel={() => setAddMode(false)}
          />
        </div>
      )}

      {results.length === 0 && query.trim().length >= 2 && !loading && (
        <div style={{ opacity: .35, fontSize: 13 }}>No international players found.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {results.map(p => (
          <div key={p.id}>
            {editId === p.id
              ? <IntlPlayerEditForm
                  player={p}
                  mode="edit"
                  saving={saving}
                  onSave={patch => handleSave(p.id, patch)}
                  onCancel={() => setEditId(null)}
                />
              : (
                <div style={{ display: "flex", alignItems: "center", gap: 12,
                  background: "rgba(255,255,255,.03)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                    <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>{p.league}</div>
                    {p.profile_url && (
                      <div style={{ fontSize: 10, opacity: .3, marginTop: 2, fontFamily: "monospace",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 400 }}>
                        {p.profile_url}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                      onClick={() => setEditId(p.id)}>Edit</button>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
                      onClick={() => handleDelete(p.id)}>Delete</button>
                  </div>
                </div>
              )
            }
          </div>
        ))}
      </div>
    </div>
  );
}

function IntlPlayerEditForm({ player, mode = "edit", onSave, onCancel, saving }) {
  const isAdd = mode === "add";
  const [name,       setName]       = useState(player.name        || "");
  const [league,     setLeague]     = useState(player.league      || "");
  const [profileUrl, setProfileUrl] = useState(player.profile_url || "");

  function submit() {
    if (!name.trim())   { alert("Name is required.");   return; }
    if (!league.trim()) { alert("League is required."); return; }
    onSave({
      name:        name.trim(),
      league:      league.trim(),
      profile_url: profileUrl.trim() || null,
    });
  }

  return (
    <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, maxWidth: 640 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
        {isAdd ? "Add International Player" : (player.name || "Edit Player")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input className="input" style={{ width: "100%" }} value={name}
            onChange={e => setName(e.target.value)} placeholder="Full name" />
        </div>
        <div>
          <label style={labelStyle}>League</label>
          <input className="input" style={{ width: "100%" }} value={league}
            onChange={e => setLeague(e.target.value)} placeholder="e.g. Liga ACB" />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Profile URL (RealGM)</label>
        <input className="input" style={{ width: "100%" }} value={profileUrl}
          onChange={e => setProfileUrl(e.target.value)} placeholder="https://basketball.realgm.com/player/…" />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving} onClick={submit}>
          {saving ? "Saving…" : isAdd ? "Add Player" : "Save Changes"}
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
