import { useState, useRef, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// MultiSelectFilter
// Dropdown with checkboxes. value is an array; empty array means "all".
// ─────────────────────────────────────────────────────────────────────────────
export function MultiSelectFilter({ label, options, value, onChange, width = 150, allLabel }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handler(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggle(opt) {
    if (value.includes(opt)) onChange(value.filter(v => v !== opt));
    else onChange([...value, opt]);
  }

  const fallbackAll = `All ${label?.toLowerCase() ?? ""}`.trim();
  const display = value.length === 0
    ? (allLabel ?? fallbackAll)
    : value.length === 1
      ? String(value[0])
      : `${value.length} selected`;

  const active = value.length > 0;

  return (
    <div ref={wrapRef} style={{ position: "relative", width, flex: "0 0 auto" }}>
      <button type="button" onClick={() => setOpen(o => !o)} className="input"
        style={{
          width: "100%", minWidth: 0, textAlign: "left", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: active ? "rgba(91,156,246,.10)" : undefined,
          borderColor: active ? "rgba(91,156,246,.45)" : undefined,
        }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: active ? "#5b9cf6" : "inherit" }}>{display}</span>
        <span style={{ opacity: .5, marginLeft: 8 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: "100%",
          zIndex: 50, background: "#1a2233", border: "1px solid var(--border)",
          borderRadius: 8, maxHeight: 320, overflowY: "auto",
          boxShadow: "0 8px 24px rgba(0,0,0,.45)",
        }}>
          {value.length > 0 && (
            <div onClick={() => onChange([])} style={{
              padding: "6px 12px", fontSize: 11, opacity: .55, cursor: "pointer",
              borderBottom: "1px solid rgba(255,255,255,.06)",
            }}>✕ Clear ({value.length})</div>
          )}
          {options.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, opacity: .4 }}>No options</div>
          ) : options.map(opt => {
            const optVal = typeof opt === "object" ? opt.value : opt;
            const optLbl = typeof opt === "object" ? opt.label : opt;
            return (
              <label key={optVal} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 12px", cursor: "pointer", fontSize: 13, userSelect: "none",
              }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.06)"}
                onMouseLeave={e => e.currentTarget.style.background = ""}>
                <input type="checkbox" checked={value.includes(optVal)} onChange={() => toggle(optVal)} />
                <span>{optLbl}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RangeFilter — two number inputs.
// `format` / `parse` let callers specialize for height (6'4") etc.
// ─────────────────────────────────────────────────────────────────────────────
export function RangeFilter({ label, min, max, onChange, parse, format, placeholder = ["min", "max"], width = 70 }) {
  // Internal display state so user can type freely without losing focus on each keystroke.
  const [minText, setMinText] = useState(format ? format(min) : (min ?? ""));
  const [maxText, setMaxText] = useState(format ? format(max) : (max ?? ""));

  useEffect(() => { setMinText(format ? format(min) : (min ?? "")); }, [min, format]);
  useEffect(() => { setMaxText(format ? format(max) : (max ?? "")); }, [max, format]);

  function commitMin(s) {
    const v = parse ? parse(s) : (s === "" ? null : Number(s));
    onChange(v, max);
  }
  function commitMax(s) {
    const v = parse ? parse(s) : (s === "" ? null : Number(s));
    onChange(min, v);
  }

  const active = (min != null) || (max != null);

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {label && <span style={{ fontSize: 11, opacity: .5, marginRight: 4 }}>{label}</span>}
      <input className="input" placeholder={placeholder[0]} style={{
        width, minWidth: 0, fontSize: 13, flex: "0 0 auto",
        background: active && min != null ? "rgba(91,156,246,.10)" : undefined,
        borderColor: active && min != null ? "rgba(91,156,246,.45)" : undefined,
      }} value={minText} onChange={e => setMinText(e.target.value)}
        onBlur={e => commitMin(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      <span style={{ opacity: .35 }}>–</span>
      <input className="input" placeholder={placeholder[1]} style={{
        width, minWidth: 0, fontSize: 13, flex: "0 0 auto",
        background: active && max != null ? "rgba(91,156,246,.10)" : undefined,
        borderColor: active && max != null ? "rgba(91,156,246,.45)" : undefined,
      }} value={maxText} onChange={e => setMaxText(e.target.value)}
        onBlur={e => commitMax(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FilterChips — list of removable pills above the board.
// Pass items as { label, onClear } pairs.
// ─────────────────────────────────────────────────────────────────────────────
export function FilterChips({ items, onClearAll }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
      {items.map((item, i) => (
        <span key={i} onClick={item.onClear} style={{
          fontSize: 11, padding: "3px 9px", borderRadius: 14, cursor: "pointer",
          background: "rgba(91,156,246,.12)", color: "#5b9cf6",
          border: "1px solid rgba(91,156,246,.32)",
          display: "inline-flex", alignItems: "center", gap: 6, userSelect: "none",
        }}>
          {item.label}
          <span style={{ opacity: .7, fontWeight: 700 }}>✕</span>
        </span>
      ))}
      {items.length > 1 && onClearAll && (
        <button type="button" onClick={onClearAll} style={{
          fontSize: 11, padding: "3px 9px", borderRadius: 14, cursor: "pointer",
          background: "transparent", color: "rgba(255,255,255,.5)",
          border: "1px solid rgba(255,255,255,.15)",
        }}>Clear all</button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Height helpers
// Accepts inputs like 6'4", 6'4, 64 (inches), 6 4
// ─────────────────────────────────────────────────────────────────────────────
export function parseHeight(s) {
  if (s == null) return null;
  const text = String(s).trim().replace(/["”]/g, "");
  if (!text) return null;
  // 6'4 or 6'4" or 6' 4
  const m = text.match(/^(\d+)\s*['′]\s*(\d+)?$/);
  if (m) return parseInt(m[1], 10) * 12 + (parseInt(m[2], 10) || 0);
  // 6 4 (feet + inches with space)
  const m2 = text.match(/^(\d+)\s+(\d+)$/);
  if (m2) return parseInt(m2[1], 10) * 12 + parseInt(m2[2], 10);
  // Pure inches
  const n = parseInt(text, 10);
  return isNaN(n) ? null : n;
}

export function formatHeight(inches) {
  if (inches == null || isNaN(inches)) return "";
  const ft = Math.floor(inches / 12), inc = inches % 12;
  return `${ft}'${inc}`;
}

// Convert a player's stored height string (e.g. "6-9" or "6'9\"") to inches.
export function playerHeightInches(h) {
  if (!h || h === "—") return null;
  const text = String(h).trim();
  const m1 = text.match(/^(\d+)-(\d+)$/);
  if (m1) return parseInt(m1[1], 10) * 12 + parseInt(m1[2], 10);
  return parseHeight(text);
}
