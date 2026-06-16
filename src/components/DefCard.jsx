import { useState, useEffect } from "react";
import { RangeSlider } from "@/components/RangeSlider";

// One editable archetype definition (name + priority + a min/max range per
// field). `fields` is DOMESTIC_FIELDS or INTL_FIELDS from @/lib/archetypeMatch,
// so the same card drives both the domestic and international editors.

const labelStyle = {
  display: "block", fontSize: 10, textTransform: "uppercase",
  letterSpacing: ".06em", opacity: .45, marginBottom: 5, fontWeight: 600,
};

export function DefCard({ def, fields, onSave, onDelete }) {
  const [form, setForm]   = useState(def);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setForm(def); setDirty(false); }, [def.id]);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };
  const setRange = (key, mn, mx) => {
    setForm(f => ({ ...f, [`${key}_min`]: mn, [`${key}_max`]: mx }));
    setDirty(true);
  };

  function save() {
    const patch = { name: (form.name || "").trim() || "Unnamed", priority: Number(form.priority) || 0 };
    fields.forEach(f => {
      patch[`${f.key}_min`] = form[`${f.key}_min`] ?? null;
      patch[`${f.key}_max`] = form[`${f.key}_max`] ?? null;
    });
    onSave(patch);
    setDirty(false);
  }

  return (
    <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
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
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={!dirty} onClick={save}>
            {dirty ? "Save" : "Saved"}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12, color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
            onClick={onDelete}>Delete</button>
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
    </div>
  );
}
