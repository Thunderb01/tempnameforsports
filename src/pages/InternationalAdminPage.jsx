import { useState, useEffect, useRef, useCallback } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { supabase }   from "@/lib/supabase";
import { PROJECTED_TIER_OPTIONS, tierColor } from "@/lib/display";
import { DefCard } from "@/components/DefCard";
import { INTL_FIELDS, intlValues, resolveArchetypeList } from "@/lib/archetypeMatch";

// Load every row from a table, paging past PostgREST's 1000-row cap.
// `build` optionally adds filters/ordering to the query before paging.
async function fetchAllIntl(table, columns, build) {
  const PAGE = 1000;
  let from = 0, all = [];
  for (;;) {
    let q = supabase.from(table).select(columns);
    if (build) q = build(q);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ── Constants ────────────────────────────────────────────────────────────────
// Tier labels are now loaded from the international_tier_labels table at runtime.
// These are fallbacks used before the fetch resolves.
const TIERS = [1, 2, 3, 4, 5];
const TIER_LABELS_FALLBACK = { 1: "EuroLeague / Elite", 2: "Top Domestic", 3: "Mid Domestic", 4: "Developmental", 5: "Academy / Youth" };
const TIER_COLORS  = { 1: "#f59e0b", 2: "#5b9cf6", 3: "#4ade80", 4: "#9ca3af", 5: "#a78bfa" };
const STAT_TYPES   = ["Averages", "Totals", "Per_36", "Advanced_Stats"];
const SEASON_TYPES = ["Regular_Season", "Playoffs", "Cup", "International"];
const POSITIONS    = ["PG", "SG", "SF", "PF", "C", "G", "F"];
const STATUS_OPTIONS = ["uncommitted", "committed", "signed", "withdrawn"];
const STATUS_COLOR   = {
  uncommitted: "#94a3b8",
  committed:   "#5b9cf6",
  signed:      "#4ade80",
  withdrawn:   "#e05c5c",
};
const METRIC_KEYS  = [
  "offensive_footprint", "defensive_score", "winning_impact",
  "sos_performance",     "translation_grade",
];

const PROFILE_CSV_HEADERS = [
  "name", "league", "profile_url", "height", "primary_position",
  "country_of_origin", "age", "recruiting_class",
  "agent_name", "agent_contact", "film_url", "competition_tier",
  "player_status", "committed_team", "us_interest_level", "projected_tier",
  "archetype_overwrite", "scouting_notes",
  ...METRIC_KEYS,
];
const STATS_CSV_FIXED = ["player_name", "league", "season", "season_type", "stat_type", "team"];

const labelStyle = {
  display: "block", fontSize: 10, textTransform: "uppercase",
  letterSpacing: ".06em", opacity: .45, marginBottom: 5, fontWeight: 600,
};

// ── CSV parser ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.trim());
  const data = rows.slice(1)
    .filter(r => r.some(c => (c || "").trim() !== ""))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] || "").trim(); });
      return obj;
    });
  return { headers, rows: data };
}

function parseNum(v) {
  if (v === "" || v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function downloadCSV(filename, headers, rows = []) {
  const lines = [headers.join(",")];
  rows.forEach(r => lines.push(headers.map(h => {
    const v = r[h] ?? "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, children, action }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", opacity: .4, fontWeight: 600 }}>
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile form
// ─────────────────────────────────────────────────────────────────────────────
function ProfileForm({ initial, onSave, onCancel, saving, tierLabels, archetypeNames = [] }) {
  const [form, setForm] = useState(() => ({
    name:                initial?.name                ?? "",
    league:              initial?.league              ?? "",
    profile_url:         initial?.profile_url         ?? "",
    height:              initial?.height              ?? "",
    primary_position:    initial?.primary_position    ?? "",
    country_of_origin:   initial?.country_of_origin   ?? "",
    age:                 initial?.age                 ?? "",
    recruiting_class:    initial?.recruiting_class    ?? "",
    agent_name:          initial?.agent_name          ?? "",
    agent_contact:       initial?.agent_contact       ?? "",
    film_url:            initial?.film_url            ?? "",
    competition_tier:    initial?.competition_tier    ?? 2,
    player_status:       initial?.player_status       ?? "uncommitted",
    committed_team:      initial?.committed_team      ?? "",
    us_interest_level:   initial?.us_interest_level   ?? "",
    projected_tier:      initial?.projected_tier      ?? "",
    archetype_overwrite: initial?.archetype_overwrite ?? "",
    scouting_notes:      initial?.scouting_notes      ?? "",
    metrics:             { ...(initial?.metrics || {}) },
  }));

  // Toggle for the "Recruiting Status" sub-field: "interest" (US college interest level)
  // vs "committed" (specific committed school). Initial choice based on what's set.
  const [recruitMode, setRecruitMode] = useState(() =>
    initial?.committed_team ? "committed" : "interest"
  );

  const set    = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setMet = (k, v) => setForm(f => ({ ...f, metrics: { ...f.metrics, [k]: parseNum(v) } }));

  function submit() {
    if (!form.name.trim() || !form.league.trim()) {
      alert("Name and league are required.");
      return;
    }
    onSave({
      ...form,
      name:              form.name.trim(),
      league:            form.league.trim(),
      profile_url:       form.profile_url.trim()       || null,
      height:            form.height.trim()            || null,
      primary_position:  form.primary_position         || null,
      country_of_origin: form.country_of_origin.trim() || null,
      age:               form.age === "" ? null : (parseInt(form.age, 10) || null),
      recruiting_class:  form.recruiting_class.trim()  || null,
      agent_name:        form.agent_name.trim()        || null,
      agent_contact:     form.agent_contact.trim()     || null,
      film_url:          form.film_url.trim()          || null,
      competition_tier:  parseInt(form.competition_tier, 10) || 2,
      player_status:     form.player_status || "uncommitted",
      // Toggle decides which of these two is saved; the other is cleared.
      committed_team:    recruitMode === "committed" ? (form.committed_team.trim() || null) : null,
      us_interest_level: recruitMode === "interest"  ? (form.us_interest_level || null)    : null,
      projected_tier:    form.projected_tier || null,
      archetype_overwrite: form.archetype_overwrite || null,
      scouting_notes:    form.scouting_notes.trim()    || null,
      metrics:           form.metrics,
    });
  }

  return (
    <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 12, padding: 20, marginBottom: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Name *</label>
          <input className="input" style={{ width: "100%" }} value={form.name} onChange={e => set("name", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>League *</label>
          <input className="input" style={{ width: "100%" }} value={form.league} onChange={e => set("league", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Height</label>
          <input className="input" style={{ width: "100%" }} placeholder='e.g. 6&apos;9"' value={form.height} onChange={e => set("height", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Position</label>
          <select className="input" style={{ width: "100%" }} value={form.primary_position} onChange={e => set("primary_position", e.target.value)}>
            <option value="">—</option>
            {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Country of origin</label>
          <input className="input" style={{ width: "100%" }} placeholder="e.g. Spain"
            value={form.country_of_origin} onChange={e => set("country_of_origin", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Age</label>
          <input className="input" type="number" min="14" max="50" style={{ width: "100%" }}
            value={form.age} onChange={e => set("age", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Recruiting class</label>
          <input className="input" style={{ width: "100%" }} placeholder="e.g. 2026"
            value={form.recruiting_class} onChange={e => set("recruiting_class", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Competition Tier</label>
          <select className="input" style={{ width: "100%" }} value={form.competition_tier} onChange={e => set("competition_tier", e.target.value)}>
            {TIERS.map(t => (
              <option key={t} value={t}>
                Tier {t} · {(tierLabels && tierLabels[t]) || TIER_LABELS_FALLBACK[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Recruiting Status</label>
          <select className="input" style={{ width: "100%" }} value={form.player_status}
            onChange={e => set("player_status", e.target.value)}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>
              {recruitMode === "interest" ? "US college interest" : "Committed team (D1)"}
            </label>
            <div style={{ display: "inline-flex", border: "1px solid rgba(255,255,255,.12)", borderRadius: 14, overflow: "hidden" }}>
              {[["interest", "Interest"], ["committed", "Committed"]].map(([val, lbl]) => (
                <button type="button" key={val}
                  onClick={() => setRecruitMode(val)}
                  style={{
                    fontSize: 10, fontWeight: 600, padding: "2px 9px", cursor: "pointer",
                    border: "none",
                    background:  recruitMode === val ? "rgba(91,156,246,.18)" : "transparent",
                    color:       recruitMode === val ? "#5b9cf6" : "rgba(255,255,255,.45)",
                  }}>{lbl}</button>
              ))}
            </div>
          </div>
          {recruitMode === "interest" ? (
            <select className="input" style={{ width: "100%" }}
              value={form.us_interest_level}
              onChange={e => set("us_interest_level", e.target.value)}>
              <option value="">— not set —</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          ) : (
            <input className="input" style={{ width: "100%" }}
              placeholder="e.g. Kentucky"
              value={form.committed_team}
              onChange={e => set("committed_team", e.target.value)} />
          )}
        </div>
        <div>
          <label style={labelStyle}>Projected Tier (D1 level)</label>
          <select className="input" style={{ width: "100%" }}
            value={form.projected_tier}
            onChange={e => set("projected_tier", e.target.value)}>
            <option value="">— not projected —</option>
            {PROJECTED_TIER_OPTIONS.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Archetype Override (exception only)</label>
          <select className="input" style={{ width: "100%" }}
            value={form.archetype_overwrite}
            onChange={e => set("archetype_overwrite", e.target.value)}>
            <option value="">— auto (from thresholds) —</option>
            {archetypeNames.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Profile URL (RealGM, etc.)</label>
          <input className="input" style={{ width: "100%" }} value={form.profile_url} onChange={e => set("profile_url", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Film URL (YouTube or direct video)</label>
          <input className="input" style={{ width: "100%" }} value={form.film_url} onChange={e => set("film_url", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Agent Name</label>
          <input className="input" style={{ width: "100%" }} value={form.agent_name} onChange={e => set("agent_name", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Agent Contact</label>
          <input className="input" style={{ width: "100%" }} value={form.agent_contact} onChange={e => set("agent_contact", e.target.value)} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Scouting notes</label>
          <textarea className="input" rows={5} style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
            placeholder="Strengths, weaknesses, fit, contextual flags, projection notes…"
            value={form.scouting_notes} onChange={e => set("scouting_notes", e.target.value)} />
        </div>
      </div>

      <div style={{ marginTop: 8, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.06)" }}>
        <div style={{ ...labelStyle, marginBottom: 10 }}>BTP Metrics (0-100)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {METRIC_KEYS.map(k => (
            <div key={k}>
              <label style={{ ...labelStyle, fontSize: 9 }}>{k.replace(/_/g, " ")}</label>
              <input className="input" type="number" min="0" max="100" style={{ width: "100%" }}
                value={form.metrics[k] ?? ""} onChange={e => setMet(k, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save Profile"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier labels editor (superadmin)
// ─────────────────────────────────────────────────────────────────────────────
function TierLabelsEditor({ labels, onSave, saving }) {
  const [local, setLocal] = useState(labels);
  useEffect(() => { setLocal(labels); }, [labels]);

  return (
    <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 11, opacity: .5, marginBottom: 12 }}>
        Labels for the 5 international competition tiers. These show up in the public
        International page filter, on player profiles, and in the admin dropdown.
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {TIERS.map(tier => (
          <div key={tier} style={{ display: "grid", gridTemplateColumns: "60px 1fr 120px", gap: 10, alignItems: "center" }}>
            <span style={{
              fontSize: 12, fontWeight: 700, textAlign: "center",
              padding: "4px 0", borderRadius: 6,
              background: `${TIER_COLORS[tier]}22`, color: TIER_COLORS[tier],
            }}>Tier {tier}</span>
            <input className="input" style={{ width: "100%" }} value={local[tier] ?? ""}
              onChange={e => setLocal(l => ({ ...l, [tier]: e.target.value }))} />
            <button className="btn btn-primary" style={{ fontSize: 11 }}
              disabled={saving || (local[tier] ?? "").trim() === "" || local[tier] === labels[tier]}
              onClick={() => onSave(tier, (local[tier] ?? "").trim())}>
              Save
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat row form (dynamic key/value)
// ─────────────────────────────────────────────────────────────────────────────
function StatRowForm({ initial, profile, onSave, onCancel, saving }) {
  const [season,      setSeason]      = useState(initial?.season ?? new Date().getFullYear());
  const [seasonType,  setSeasonType]  = useState(initial?.season_type ?? "Regular_Season");
  const [statType,    setStatType]    = useState(initial?.stat_type ?? "Averages");
  const [team,        setTeam]        = useState(initial?.team ?? "");
  const [pairs,       setPairs]       = useState(() => {
    const s = initial?.stats ?? {};
    const arr = Object.entries(s).map(([k, v]) => ({ k, v: v == null ? "" : String(v) }));
    return arr.length ? arr : [{ k: "", v: "" }];
  });

  function updatePair(i, field, val) {
    setPairs(p => p.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  }
  function addPair()    { setPairs(p => [...p, { k: "", v: "" }]); }
  function removePair(i){ setPairs(p => p.filter((_, idx) => idx !== i)); }

  function submit() {
    if (!season || !team.trim()) {
      alert("Season and team are required.");
      return;
    }
    const stats = {};
    pairs.forEach(({ k, v }) => {
      const key = k.trim();
      if (!key) return;
      const n = parseNum(v);
      stats[key] = n != null ? n : v;
    });
    onSave({
      player_name: profile.name,
      league:      profile.league,
      player_id:   profile.id,
      season:      parseInt(season, 10),
      season_type: seasonType,
      stat_type:   statType,
      team:        team.trim(),
      stats,
    });
  }

  return (
    <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Season</label>
          <input className="input" type="number" style={{ width: "100%" }} value={season} onChange={e => setSeason(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Season Type</label>
          <select className="input" style={{ width: "100%" }} value={seasonType} onChange={e => setSeasonType(e.target.value)}>
            {SEASON_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Stat Type</label>
          <select className="input" style={{ width: "100%" }} value={statType} onChange={e => setStatType(e.target.value)}>
            {STAT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Team</label>
          <input className="input" style={{ width: "100%" }} value={team} onChange={e => setTeam(e.target.value)} />
        </div>
      </div>

      <div style={{ ...labelStyle, marginBottom: 8 }}>Stats (add any keys you have)</div>
      <div style={{ display: "grid", gap: 6 }}>
        {pairs.map((p, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 32px", gap: 8 }}>
            <input className="input" placeholder="key (e.g. pts, fg%, ortg)" value={p.k} onChange={e => updatePair(i, "k", e.target.value)} />
            <input className="input" placeholder="value" value={p.v} onChange={e => updatePair(i, "v", e.target.value)} />
            <button className="btn btn-ghost" onClick={() => removePair(i)} style={{ padding: 0 }}>✕</button>
          </div>
        ))}
      </div>
      <button className="btn btn-ghost" onClick={addPair} style={{ fontSize: 12, marginTop: 8 }}>+ Add stat</button>

      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save Stats"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV importer
// ─────────────────────────────────────────────────────────────────────────────
function CSVImporter({ kind, onImport }) {
  const [rows,    setRows]    = useState([]);
  const [headers, setHeaders] = useState([]);
  const [error,   setError]   = useState("");
  const [busy,    setBusy]    = useState(false);
  const fileRef               = useRef(null);

  const required = kind === "profile" ? ["name", "league"] : ["player_name", "league", "season", "stat_type", "team"];

  function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { headers, rows } = parseCSV(String(reader.result));
        const missing = required.filter(c => !headers.includes(c));
        if (missing.length) {
          setError(`Missing required columns: ${missing.join(", ")}`);
          setHeaders([]); setRows([]); return;
        }
        setHeaders(headers); setRows(rows);
      } catch (err) {
        setError("Failed to parse CSV: " + err.message);
      }
    };
    reader.readAsText(f);
  }

  async function commit() {
    setBusy(true);
    try {
      await onImport(rows, headers);
      setRows([]); setHeaders([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError("Import failed: " + err.message);
    }
    setBusy(false);
  }

  function downloadTemplate() {
    if (kind === "profile") {
      downloadCSV("international_profiles_template.csv", PROFILE_CSV_HEADERS, [{
        name: "Sample Player", league: "ACB", profile_url: "",
        height: "6'9\"", primary_position: "SF",
        country_of_origin: "Spain", age: "19", recruiting_class: "2026",
        agent_name: "", agent_contact: "", film_url: "", competition_tier: "2",
        player_status: "uncommitted", committed_team: "", us_interest_level: "medium", projected_tier: "Mid Major",
        scouting_notes: "Quick first step, average defender, projects as bench guard.",
        offensive_footprint: "75", defensive_score: "68", winning_impact: "72",
        sos_performance: "70", translation_grade: "65",
      }]);
    } else {
      const headers = [...STATS_CSV_FIXED, "gp", "min", "pts", "reb", "ast", "stl", "blk", "to", "fg%", "3p%", "ft%"];
      downloadCSV("international_stats_template.csv", headers, [{
        player_name: "Sample Player", league: "ACB", season: "2026", season_type: "Regular_Season",
        stat_type: "Averages", team: "Sample FC",
        gp: "28", min: "30.2", pts: "16.5", reb: "8.3", ast: "3.1",
        stl: "0.9", blk: "1.8", to: "2.1", "fg%": "0.528", "3p%": "0.362", "ft%": "0.815",
      }]);
    }
  }

  return (
    <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 12, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {kind === "profile" ? "Player profiles" : "Player stats"}
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={downloadTemplate}>
          ↓ Download template
        </button>
      </div>

      <div style={{ fontSize: 11, opacity: .5, marginBottom: 12 }}>
        {kind === "profile"
          ? "Required: name, league. Optional: height, primary_position, country_of_origin, age, recruiting_class, agent_name, agent_contact, film_url, profile_url, competition_tier (1-5), scouting_notes, and 5 metric columns (offensive_footprint, defensive_score, winning_impact, sos_performance, translation_grade)."
          : "Required: player_name, league, season, stat_type, team. All other columns become stat keys in the JSONB (e.g. pts, reb, fg%, ortg). Optional: season_type (defaults to Regular_Season)."}
      </div>

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile}
        style={{ fontSize: 12, color: "rgba(255,255,255,.6)" }} />

      {error && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(224,92,92,.1)",
                      border: "1px solid rgba(224,92,92,.3)", borderRadius: 6, color: "#f87171", fontSize: 12 }}>
          {error}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, opacity: .6, marginBottom: 8 }}>
            Preview ({rows.length} rows) — showing first 5
          </div>
          <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,.07)", borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
              <thead>
                <tr>{headers.map(h => (
                  <th key={h} style={{ padding: "6px 10px", textAlign: "left", opacity: .5, whiteSpace: "nowrap",
                                       borderBottom: "1px solid rgba(255,255,255,.07)" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>{headers.map(h => (
                    <td key={h} style={{ padding: "5px 10px", whiteSpace: "nowrap", opacity: .8 }}>{r[h]}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={commit} disabled={busy}>
            {busy ? "Importing…" : `Import ${rows.length} rows`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export function InternationalAdminPage() {
  return (
    <>
      <SiteHeader />
      <div className="app-shell">
        <div className="app-top">
          <h1 style={{ margin: "0 0 16px" }}>International Admin</h1>
          <InternationalAdminContent />
        </div>
      </div>
    </>
  );
}

export function InternationalAdminContent() {
  const [tab,         setTab]         = useState("profiles");  // profiles | stats | tiers | csv
  const [profiles,    setProfiles]    = useState([]);
  const [search,      setSearch]      = useState("");
  const [editId,      setEditId]      = useState(null);  // 'new' | uuid
  const [editInitial, setEditInitial] = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [tierLabels,  setTierLabels]  = useState(TIER_LABELS_FALLBACK);

  const [statsProfile,    setStatsProfile]    = useState(null); // selected player for stats tab
  const [statsRows,       setStatsRows]       = useState([]);
  const [statEditId,      setStatEditId]      = useState(null); // 'new' | uuid
  const [statEditInitial, setStatEditInitial] = useState(null);

  const [archDefs,    setArchDefs]    = useState([]);
  const [recomputing, setRecomputing] = useState(false);
  const [archMsg,     setArchMsg]     = useState("");

  const loadArchDefs = useCallback(async () => {
    const { data, error } = await supabase.from("international_archetype_defs").select("*").order("priority");
    if (error) { console.error("archetype defs fetch:", error); return; }
    setArchDefs(data || []);
  }, []);

  async function addArchDef() {
    const { data, error } = await supabase.from("international_archetype_defs")
      .insert({ name: "New Archetype", priority: archDefs.length }).select();
    if (error) { alert("Add failed: " + error.message); return; }
    setArchDefs(prev => [...prev, ...(data || [])]);
  }

  async function saveArchDef(id, patch) {
    const { error } = await supabase.from("international_archetype_defs").update(patch).eq("id", id);
    if (error) { alert("Save failed: " + error.message); return; }
    setArchDefs(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
  }

  async function deleteArchDef(id) {
    if (!confirm("Delete this archetype definition?")) return;
    const { error } = await supabase.from("international_archetype_defs").delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    setArchDefs(prev => prev.filter(d => d.id !== id));
  }

  // Resolve + write `archetype` for every international player across both the
  // men's and women's intl pools. Reads metrics off the profile and the box
  // stats off the canonical stat row (latest Averages / Regular_Season).
  async function recomputeArchetypes() {
    if (!archDefs.length) { setArchMsg("Define at least one archetype before recomputing."); return; }
    setRecomputing(true); setArchMsg("Scanning players…");
    try {
      const pools = [
        { players: "international_players",   stats: "international_players_stats"   },
        { players: "w_international_players", stats: "w_international_players_stats" },
      ];
      let totChanged = 0, totScanned = 0;
      for (const pool of pools) {
        let profiles = [];
        try {
          profiles = await fetchAllIntl(pool.players, "id, archetype, archetypes, archetype_overwrite, metrics");
        } catch { continue; } // women's intl table may not exist on older DBs
        if (!profiles.length) continue;

        const statRows = await fetchAllIntl(pool.stats, "player_id, season, stats",
          q => q.eq("stat_type", "Averages").eq("season_type", "Regular_Season").order("season", { ascending: false }));
        const statsByPid = {};
        for (const s of statRows) {
          if (s.player_id && !(s.player_id in statsByPid)) statsByPid[s.player_id] = s.stats || {};
        }

        const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
        const changed = [];
        for (const p of profiles) {
          const vals = intlValues(p.metrics || {}, statsByPid[p.id] || {});
          const { list, primary } = resolveArchetypeList(p.archetype_overwrite, vals, archDefs, INTL_FIELDS);
          if ((primary || null) !== (p.archetype || null) || !sameList(list, p.archetypes)) {
            changed.push({ id: p.id, archetype: primary, archetypes: list });
          }
        }

        const CHUNK = 25;
        for (let i = 0; i < changed.length; i += CHUNK) {
          await Promise.all(changed.slice(i, i + CHUNK).map(c =>
            supabase.from(pool.players).update({ archetype: c.archetype, archetypes: c.archetypes }).eq("id", c.id)));
        }
        totChanged += changed.length; totScanned += profiles.length;
      }
      setArchMsg(`Done — ${totChanged} player${totChanged === 1 ? "" : "s"} updated (${totScanned} scanned).`);
      await loadProfiles();
    } catch (e) {
      setArchMsg("Recompute failed: " + e.message);
    }
    setRecomputing(false);
  }

  // ── Load profiles ─────────────────────────────────────────────────────────
  const loadProfiles = useCallback(async () => {
    const { data, error } = await supabase
      .from("international_players")
      .select("*")
      .order("name");
    if (error) { console.error(error); return; }
    setProfiles(data || []);
  }, []);

  // ── Load tier labels ──────────────────────────────────────────────────────
  const loadTierLabels = useCallback(async () => {
    const { data, error } = await supabase
      .from("international_tier_labels")
      .select("tier, label");
    if (error) { console.error("tier labels fetch:", error); return; }
    if (data?.length) {
      const map = { ...TIER_LABELS_FALLBACK };
      data.forEach(r => { map[r.tier] = r.label; });
      setTierLabels(map);
    }
  }, []);

  async function saveTierLabel(tier, label) {
    if (!label) return;
    setSaving(true);
    const { error } = await supabase
      .from("international_tier_labels")
      .upsert({ tier, label }, { onConflict: "tier" });
    setSaving(false);
    if (error) { alert("Save failed: " + error.message); return; }
    setTierLabels(prev => ({ ...prev, [tier]: label }));
  }

  useEffect(() => { loadProfiles(); loadTierLabels(); loadArchDefs(); }, [loadProfiles, loadTierLabels, loadArchDefs]);

  const loadStatsFor = useCallback(async (profile) => {
    if (!profile) { setStatsRows([]); return; }
    const { data, error } = await supabase
      .from("international_players_stats")
      .select("id, player_name, league, season, season_type, stat_type, team, stats")
      .eq("player_name", profile.name)
      .eq("league", profile.league)
      .order("season", { ascending: false });
    if (error) { console.error(error); return; }
    setStatsRows(data || []);
  }, []);

  useEffect(() => { loadStatsFor(statsProfile); }, [statsProfile, loadStatsFor]);

  // ── Profile save / delete ─────────────────────────────────────────────────
  async function saveProfile(payload) {
    setSaving(true);
    let res;
    if (editId === "new") {
      res = await supabase.from("international_players").insert(payload).select();
    } else {
      res = await supabase.from("international_players").update(payload).eq("id", editId).select();
    }
    if (res.error) {
      console.error("saveProfile error:", res.error);
      alert("Save failed: " + res.error.message);
      setSaving(false); return;
    }
    if (!res.data || res.data.length === 0) {
      console.warn("saveProfile: 0 rows affected — RLS likely blocking. Payload:", payload);
      alert("Save returned 0 rows. The international_players table is missing an UPDATE policy for your role — see RLS SQL below.");
      setSaving(false); return;
    }
    setEditId(null); setEditInitial(null);
    await loadProfiles();
    setSaving(false);
  }

  async function deleteProfile(id) {
    if (!confirm("Delete this player and all their stat rows?")) return;
    const { error } = await supabase.from("international_players").delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    await loadProfiles();
  }

  // ── Stat row save / delete ────────────────────────────────────────────────
  async function saveStatRow(payload) {
    setSaving(true);
    let res;
    if (statEditId === "new") {
      res = await supabase.from("international_players_stats").insert(payload).select();
    } else {
      res = await supabase.from("international_players_stats").update(payload).eq("id", statEditId).select();
    }
    if (res.error) {
      console.error("saveStatRow error:", res.error);
      alert("Save failed: " + res.error.message);
      setSaving(false); return;
    }
    if (!res.data || res.data.length === 0) {
      console.warn("saveStatRow: 0 rows affected — RLS likely blocking. Payload:", payload);
      alert("Save returned 0 rows. The international_players_stats table is missing an UPDATE policy for your role — see RLS SQL below.");
      setSaving(false); return;
    }
    setStatEditId(null); setStatEditInitial(null);
    await loadStatsFor(statsProfile);
    setSaving(false);
  }

  async function deleteStatRow(id) {
    if (!confirm("Delete this stat row?")) return;
    const { error } = await supabase.from("international_players_stats").delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    await loadStatsFor(statsProfile);
  }

  // ── CSV import handlers ────────────────────────────────────────────────────
  async function importProfilesCSV(rows) {
    const payloads = rows.map(r => {
      const metrics = {};
      METRIC_KEYS.forEach(k => {
        const n = parseNum(r[k]);
        if (n != null) metrics[k] = n;
      });
      return {
        name:              (r.name || "").trim(),
        league:            (r.league || "").trim(),
        profile_url:       r.profile_url?.trim()       || null,
        height:            r.height?.trim()            || null,
        primary_position:  r.primary_position?.trim()  || null,
        country_of_origin: r.country_of_origin?.trim() || null,
        age:               r.age !== undefined && r.age !== "" ? (parseInt(r.age, 10) || null) : null,
        recruiting_class:  r.recruiting_class?.trim()  || null,
        agent_name:        r.agent_name?.trim()        || null,
        agent_contact:     r.agent_contact?.trim()     || null,
        film_url:          r.film_url?.trim()          || null,
        competition_tier:  parseInt(r.competition_tier, 10) || 2,
        player_status:     r.player_status?.trim()     || null,
        committed_team:    r.committed_team?.trim()    || null,
        us_interest_level:   r.us_interest_level?.trim()   || null,
        projected_tier:      r.projected_tier?.trim()      || null,
        archetype_overwrite: r.archetype_overwrite?.trim() || null,
        scouting_notes:      r.scouting_notes?.trim()      || null,
        metrics,
      };
    }).filter(p => p.name && p.league);

    const { error } = await supabase
      .from("international_players")
      .upsert(payloads, { onConflict: "name,league" });
    if (error) throw error;
    alert(`Imported ${payloads.length} profiles.`);
    await loadProfiles();
  }

  async function importStatsCSV(rows, headers) {
    const statKeys = headers.filter(h => !STATS_CSV_FIXED.includes(h));

    // Build a name→id lookup so we can populate player_id FK.
    const { data: existing } = await supabase
      .from("international_players")
      .select("id, name, league");
    const idLookup = {};
    (existing || []).forEach(p => { idLookup[`${p.name}|${p.league}`] = p.id; });

    const payloads = rows.map(r => {
      const stats = {};
      statKeys.forEach(k => {
        const raw = r[k];
        if (raw === "" || raw == null) return;
        const n = parseNum(raw);
        stats[k] = n != null ? n : raw;
      });
      const key = `${(r.player_name || "").trim()}|${(r.league || "").trim()}`;
      return {
        player_id:   idLookup[key] || null,
        player_name: (r.player_name || "").trim(),
        league:      (r.league || "").trim(),
        season:      parseInt(r.season, 10),
        season_type: (r.season_type || "").trim() || "Regular_Season",
        stat_type:   (r.stat_type || "").trim() || "Averages",
        team:        (r.team || "").trim() || null,
        stats,
      };
    }).filter(p => p.player_name && p.league && p.season && p.team);

    const missing = payloads.filter(p => !p.player_id);
    if (missing.length) {
      const names = [...new Set(missing.map(m => `${m.player_name} (${m.league})`))].slice(0, 5);
      const ok = confirm(
        `${missing.length} stat rows reference players not in the profiles table:\n${names.join("\n")}\n\n` +
        "Import them anyway (player_id will be null)?"
      );
      if (!ok) return;
    }

    const { error } = await supabase
      .from("international_players_stats")
      .upsert(payloads, { onConflict: "player_name,league,season,season_type,stat_type,team" });
    if (error) throw error;
    alert(`Imported ${payloads.length} stat rows.`);
    if (statsProfile) await loadStatsFor(statsProfile);
  }

  // ── Filtered profile list ──────────────────────────────────────────────────
  const filteredProfiles = profiles.filter(p => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || (p.league || "").toLowerCase().includes(q);
  });

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
            {[
              { id: "profiles",   label: "Profiles" },
              { id: "stats",      label: "Stats" },
              { id: "archetypes", label: "Archetypes" },
              { id: "tiers",      label: "Tier Labels" },
              { id: "csv",        label: "CSV Import" },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                fontSize: 12, fontWeight: 600, padding: "6px 16px", borderRadius: 20, cursor: "pointer", border: "1px solid",
                background:  tab === t.id ? "rgba(91,156,246,.18)" : "transparent",
                color:       tab === t.id ? "#5b9cf6" : "rgba(255,255,255,.5)",
                borderColor: tab === t.id ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.12)",
              }}>{t.label}</button>
            ))}
          </div>

          {/* ── PROFILES TAB ───────────────────────────────────────────── */}
          {tab === "profiles" && (
            <Section
              title={`Player profiles (${filteredProfiles.length})`}
              action={editId == null && (
                <button className="btn btn-primary" style={{ fontSize: 12 }}
                  onClick={() => { setEditId("new"); setEditInitial(null); }}>
                  + Add player
                </button>
              )}
            >
              {editId != null && (
                <ProfileForm
                  initial={editInitial}
                  saving={saving}
                  tierLabels={tierLabels}
                  archetypeNames={archDefs.map(d => d.name)}
                  onSave={saveProfile}
                  onCancel={() => { setEditId(null); setEditInitial(null); }}
                />
              )}

              <input className="input" type="search" placeholder="Search by name or league…"
                style={{ width: "100%", marginBottom: 14 }}
                value={search} onChange={e => setSearch(e.target.value)} />

              <div style={{ border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, overflow: "hidden" }}>
                {filteredProfiles.length === 0 ? (
                  <div style={{ padding: 32, textAlign: "center", opacity: .35, fontSize: 13 }}>
                    No players yet. Click "+ Add player" or use CSV Import.
                  </div>
                ) : filteredProfiles.map((p, i) => (
                  <div key={p.id} style={{
                    display: "grid", gridTemplateColumns: "1.4fr 1fr 90px 70px 1.1fr 130px",
                    gap: 12, padding: "10px 14px", alignItems: "center",
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)",
                    borderBottom: "1px solid rgba(255,255,255,.04)",
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                      {p.height && <div style={{ fontSize: 10, opacity: .4 }}>{p.height} · {p.primary_position || "—"}</div>}
                    </div>
                    <div style={{ fontSize: 12, opacity: .6 }}>{p.league}</div>
                    <div style={{ fontSize: 11 }}>
                      <span style={{
                        padding: "2px 7px", borderRadius: 10, fontWeight: 700,
                        background: `${TIER_COLORS[p.competition_tier]}22`,
                        color: TIER_COLORS[p.competition_tier],
                      }}>T{p.competition_tier}</span>
                    </div>
                    <div style={{ fontSize: 10, opacity: .5 }}>
                      {Object.keys(p.metrics || {}).length} metrics
                    </div>
                    <div style={{ fontSize: 10 }}>
                      {(() => {
                        const st = p.player_status || "uncommitted";
                        const c  = STATUS_COLOR[st] || "#94a3b8";
                        return (
                          <span style={{ padding: "2px 7px", borderRadius: 10, fontWeight: 600,
                                          background: `${c}1f`, color: c, border: `1px solid ${c}55` }}>
                            {st}{(st === "committed" || st === "signed") && p.committed_team
                              ? ` → ${p.committed_team}` : ""}
                          </span>
                        );
                      })()}
                    </div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                        onClick={() => { setEditId(p.id); setEditInitial(p); }}>Edit</button>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px", color: "#f87171" }}
                        onClick={() => deleteProfile(p.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── STATS TAB ──────────────────────────────────────────────── */}
          {tab === "stats" && (
            <Section title="Player stats">
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Pick a player</label>
                <select className="input" style={{ width: "100%", maxWidth: 400 }}
                  value={statsProfile?.id || ""}
                  onChange={e => {
                    const p = profiles.find(x => x.id === e.target.value);
                    setStatsProfile(p || null);
                    setStatEditId(null); setStatEditInitial(null);
                  }}>
                  <option value="">—</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.name} ({p.league})</option>)}
                </select>
              </div>

              {statsProfile && (
                <>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                    {statEditId == null && (
                      <button className="btn btn-primary" style={{ fontSize: 12 }}
                        onClick={() => { setStatEditId("new"); setStatEditInitial(null); }}>
                        + Add stat row
                      </button>
                    )}
                  </div>

                  {statEditId != null && (
                    <StatRowForm
                      initial={statEditInitial}
                      profile={statsProfile}
                      saving={saving}
                      onSave={saveStatRow}
                      onCancel={() => { setStatEditId(null); setStatEditInitial(null); }}
                    />
                  )}

                  <div style={{ border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, overflow: "hidden" }}>
                    {statsRows.length === 0 ? (
                      <div style={{ padding: 32, textAlign: "center", opacity: .35, fontSize: 13 }}>
                        No stat rows for this player yet.
                      </div>
                    ) : statsRows.map((r, i) => (
                      <div key={r.id} style={{
                        padding: "10px 14px",
                        background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)",
                        borderBottom: "1px solid rgba(255,255,255,.04)",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{r.season}</span>
                            <span style={{ fontSize: 11, opacity: .5 }}>{r.stat_type.replace(/_/g, " ")}</span>
                            <span style={{ fontSize: 11, opacity: .5 }}>· {r.season_type.replace(/_/g, " ")}</span>
                            <span style={{ fontSize: 11, opacity: .5 }}>· {r.team}</span>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                              onClick={() => { setStatEditId(r.id); setStatEditInitial(r); }}>Edit</button>
                            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px", color: "#f87171" }}
                              onClick={() => deleteStatRow(r.id)}>Delete</button>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11, opacity: .65 }}>
                          {Object.entries(r.stats || {}).map(([k, v]) => (
                            <span key={k}><span style={{ opacity: .55 }}>{k}:</span> {v}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Section>
          )}

      {/* ── ARCHETYPES TAB ──────────────────────────────────────────── */}
      {tab === "archetypes" && (
        <Section title={`Archetype definitions (${archDefs.length})`}>
          <div style={{ fontSize: 12, opacity: .5, marginBottom: 16, maxWidth: 680 }}>
            A player matches an archetype when every set range contains their value. Box stats
            (PTS / REB / AST / 3P%) read from the latest <em>Averages · Regular Season</em> stat
            row; the five metrics read from the player's BTP metrics. Leave a field as
            <em> any–any</em> to ignore it. Lowest <strong>priority</strong> wins when several
            match. <strong>Recompute</strong> applies to all international players (men's &
            women's); per-player overrides always take precedence.
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={addArchDef}>+ Add archetype</button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={recomputing} onClick={recomputeArchetypes}>
              {recomputing ? "Recomputing…" : "↻ Recompute all players"}
            </button>
            {archMsg && <span style={{ fontSize: 12, opacity: .6 }}>{archMsg}</span>}
          </div>

          {archDefs.length === 0 ? (
            <div style={{ opacity: .35, fontSize: 13 }}>No archetypes defined yet. Click "+ Add archetype".</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {archDefs.map(def => (
                <DefCard key={def.id} def={def} fields={INTL_FIELDS}
                  onSave={patch => saveArchDef(def.id, patch)} onDelete={() => deleteArchDef(def.id)} />
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── TIER LABELS TAB ─────────────────────────────────────────── */}
      {tab === "tiers" && (
        <Section title="Competition tier labels">
          <TierLabelsEditor labels={tierLabels} onSave={saveTierLabel} saving={saving} />
        </Section>
      )}

      {/* ── CSV TAB ────────────────────────────────────────────────── */}
      {tab === "csv" && (
        <>
          <Section title="Import profiles">
            <CSVImporter kind="profile" onImport={importProfilesCSV} />
          </Section>
          <Section title="Import stats">
            <CSVImporter kind="stats" onImport={importStatsCSV} />
          </Section>
        </>
      )}
    </div>
  );
}
