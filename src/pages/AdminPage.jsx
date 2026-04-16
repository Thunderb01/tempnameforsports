import { useState, useEffect } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { supabase }   from "@/lib/supabase";

const STATUS_OPTIONS = ["committed", "enrolled", "withdrawn"];
const CURRENT_SEASON = 2027;

const EMPTY_FORM = {
  player_name: "",
  torvik_pid:  "",
  from_team:   "",
  to_team:     "",
  season_year: CURRENT_SEASON,
  status:      "committed",
};

// ── Section wrapper ──────────────────────────────────────────────────────────
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

// ── Transfer form ────────────────────────────────────────────────────────────
function TransferForm({ initial = EMPTY_FORM, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560,
      background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
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
          <input className="input" style={{ width: "100%" }} value={form.from_team}
            onChange={e => set("from_team", e.target.value)} placeholder="e.g. Texas" />
        </div>
        <div>
          <label style={labelStyle}>To Team</label>
          <input className="input" style={{ width: "100%" }} value={form.to_team}
            onChange={e => set("to_team", e.target.value)} placeholder="e.g. Kentucky" />
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
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────
const STATUS_COLOR = { committed: "#5b9cf6", enrolled: "#4ade80", withdrawn: "#e05c5c" };
function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || "#94a3b8";
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20,
      fontSize: 11, fontWeight: 600, color, background: `${color}22`, border: `1px solid ${color}55` }}>
      {status}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
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

          {/* Tabs */}
          <div style={{ display: "flex", gap: 6, marginTop: 20 }}>
            {[
              { key: "transfers", label: "Portal Transfers" },
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
          {activeTab === "coaches"   && <CoachesTab />}
        </div>
      </div>
    </>
  );
}

// ── Portal Transfers tab ──────────────────────────────────────────────────────
function TransfersTab() {
  const [transfers, setTransfers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [editId,    setEditId]    = useState(null);
  const [yearFilter, setYearFilter] = useState(CURRENT_SEASON);

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

  return (
    <div>
      <Section title="Add Transfer">
        <TransferForm onSave={handleAdd} saving={saving} />
      </Section>

      <Section title={`Records — ${yearFilter} Season (${transfers.length})`}>
        {/* Year filter */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {[2026, 2027, 2028].map(y => (
            <button key={y} onClick={() => setYearFilter(y)} style={{
              fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 20, cursor: "pointer", border: "1px solid",
              background:  yearFilter === y ? "rgba(91,156,246,.2)" : "transparent",
              color:       yearFilter === y ? "#5b9cf6"             : "rgba(255,255,255,.35)",
              borderColor: yearFilter === y ? "rgba(91,156,246,.4)" : "rgba(255,255,255,.1)",
            }}>{y}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
        ) : transfers.length === 0 ? (
          <div style={{ opacity: .35, fontSize: 13 }}>No records for {yearFilter}.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {transfers.map(t => (
              <div key={t.id}>
                {editId === t.id ? (
                  <TransferForm
                    initial={{ player_name: t.player_name || "", torvik_pid: t.torvik_pid || "",
                      from_team: t.from_team, to_team: t.to_team,
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
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.player_name || <span style={{ opacity: .4 }}>—</span>}</div>
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

// ── Coaches tab ───────────────────────────────────────────────────────────────
function CoachesTab() {
  const [coaches,  setCoaches]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(null); // id being saved

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

const labelStyle = {
  display: "block", fontSize: 10, textTransform: "uppercase",
  letterSpacing: ".06em", opacity: .45, marginBottom: 5, fontWeight: 600,
};
