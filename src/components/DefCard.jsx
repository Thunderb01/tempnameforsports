import { useState, useEffect } from "react";
import { RangeSlider } from "@/components/RangeSlider";

// One editable archetype definition (name + priority + a min/max range per
// field). `fields` is DOMESTIC_FIELDS or INTL_FIELDS from @/lib/archetypeMatch,
// so the same card drives both the domestic and international editors.
// Cards are collapsible — minimized by default so the list stays scannable;
// a brand-new ("New Archetype", no ranges) card opens expanded for editing.

const labelStyle = {
  display: "block", fontSize: 10, textTransform: "uppercase",
  letterSpacing: ".06em", opacity: .45, marginBottom: 5, fontWeight: 600,
};

function rangeSummary(form, fields) {
  return fields.map(f => {
    const mn = form[`${f.key}_min`], mx = form[`${f.key}_max`];
    if (mn == null && mx == null) return null;
    if (mn != null && mx != null) return `${f.label} ${mn}–${mx}`;
    if (mn != null) return `${f.label} ≥${mn}`;
    return `${f.label} ≤${mx}`;
  }).filter(Boolean);
}

export function DefCard({ def, fields, onSave, onDelete }) {
  const [form, setForm]   = useState(def);
  const [dirty, setDirty] = useState(false);
  const isFresh = (def.name === "New Archetype") &&
    fields.every(f => def[`${f.key}_min`] == null && def[`${f.key}_max`] == null);
  const [open, setOpen]   = useState(isFresh);
  useEffect(() => { setForm(def); setDirty(false); }, [def.id]);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };
  const setRange = (key, mn, mx) => {
    setForm(f => ({ ...f, [`${key}_min`]: mn, [`${key}_max`]: mx }));
    setDirty(true);
  };

  function save() {
    const patch = {
      name: (form.name || "").trim() || "Unnamed",
      priority: Number(form.priority) || 0,
      color: form.color || "#f5a623",
    };
    fields.forEach(f => {
      patch[`${f.key}_min`] = form[`${f.key}_min`] ?? null;
      patch[`${f.key}_max`] = form[`${f.key}_max`] ?? null;
    });
    onSave(patch);
    setDirty(false);
  }

  const color   = form.color || "#f5a623";
  const summary = rangeSummary(form, fields);

  return (
    <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, padding: open ? 16 : "10px 14px" }}>
      {/* Header — always visible, click chevron to expand/collapse */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={() => setOpen(o => !o)} title={open ? "Collapse" : "Expand"}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,.5)", cursor: "pointer",
            fontSize: 12, padding: 2, lineHeight: 1, flexShrink: 0 }}>
          {open ? "▾" : "▸"}
        </button>

        <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
          background: `${color}22`, color, border: `1px solid ${color}55`, flexShrink: 0,
          cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
          {(form.name || "Unnamed").trim() || "Unnamed"}
        </span>
        <span style={{ fontSize: 11, opacity: .4, flexShrink: 0 }}>priority {form.priority ?? 0}</span>

        {/* Collapsed summary of active ranges */}
        {!open && (
          <span style={{ fontSize: 11, opacity: summary.length ? .5 : .3, fontStyle: summary.length ? "normal" : "italic",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {summary.length ? summary.join("  ·  ") : "no thresholds set"}
          </span>
        )}

        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexShrink: 0 }}>
          {dirty && (
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={save}>Save</button>
          )}
          <button className="btn btn-ghost" style={{ fontSize: 12, color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
            onClick={onDelete}>Delete</button>
        </div>
      </div>

      {/* Body — only when expanded */}
      {open && (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", margin: "14px 0", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <label style={labelStyle}>Name</label>
              <input className="input" style={{ width: "100%" }} value={form.name || ""}
                onChange={e => set("name", e.target.value)} placeholder="e.g. Stretch Big" />
            </div>
            <div style={{ width: 90 }}>
              <label style={labelStyle}>Priority</label>
              <input className="input" type="number" style={{ width: "100%" }} value={form.priority ?? 0}
                onChange={e => set("priority", e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Color</label>
              <input type="color" value={color} onChange={e => set("color", e.target.value)}
                style={{ width: 48, height: 32, padding: 0, border: "1px solid var(--border)", borderRadius: 6,
                  background: "transparent", cursor: "pointer" }} />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fields.map(f => (
              <RangeSlider key={f.key} label={f.label} scaleMax={f.max} step={f.max <= 16 ? 0.5 : 1}
                min={form[`${f.key}_min`] ?? null}
                max={form[`${f.key}_max`] ?? null}
                onChange={(mn, mx) => setRange(f.key, mn, mx)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
