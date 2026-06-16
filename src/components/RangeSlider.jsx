import { useEffect } from "react";

// Dual-handle min/max slider with synced numeric boxes.
// Value model: `min` / `max` are numbers or null. null = unbounded on that end
// (left thumb fully left → null min; right thumb fully right → null max).
// onChange(nextMin, nextMax) fires with nulls at the extremes.

const ACCENT = "#f5a623";
let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const css = `
.bp-range {
  position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%);
  width: 100%; height: 0; margin: 0; pointer-events: none;
  -webkit-appearance: none; appearance: none; background: transparent;
}
.bp-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; pointer-events: auto;
  width: 15px; height: 15px; border-radius: 50%; background: ${ACCENT};
  border: 2px solid #0b1020; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.5);
}
.bp-range::-moz-range-thumb {
  pointer-events: auto; width: 15px; height: 15px; border-radius: 50%;
  background: ${ACCENT}; border: 2px solid #0b1020; cursor: pointer;
}
.bp-range::-webkit-slider-runnable-track { background: transparent; border: none; }
.bp-range::-moz-range-track { background: transparent; border: none; }
`;
  const el = document.createElement("style");
  el.setAttribute("data-bp-range", "");
  el.textContent = css;
  document.head.appendChild(el);
}

export function RangeSlider({ label, scaleMax = 100, step = 1, min: vMin, max: vMax, onChange }) {
  useEffect(() => { injectStyles(); }, []);

  const max = scaleMax;
  // Resolve nulls to the track extremes for the sliders' positions.
  const lo = vMin == null ? 0   : Number(vMin);
  const hi = vMax == null ? max : Number(vMax);
  const loPct = (Math.min(lo, max) / max) * 100;
  const hiPct = (Math.min(hi, max) / max) * 100;

  function handleLo(raw) {
    let n = Number(raw);
    if (n > hi) n = hi;                       // don't cross the high thumb
    onChange(n <= 0 ? null : n, vMax);        // floored at 0 → unbounded
  }
  function handleHi(raw) {
    let n = Number(raw);
    if (n < lo) n = lo;                        // don't cross the low thumb
    onChange(vMin, n >= max ? null : n);       // maxed out → unbounded
  }

  // Numeric box edits — empty clears to null.
  function boxLo(v) {
    if (v === "") return onChange(null, vMax);
    const n = Number(v);
    if (Number.isNaN(n)) return;
    onChange(n, vMax);
  }
  function boxHi(v) {
    if (v === "") return onChange(vMin, null);
    const n = Number(v);
    if (Number.isNaN(n)) return;
    onChange(vMin, n);
  }

  const boxStyle = {
    width: 52, fontSize: 11, padding: "3px 6px", textAlign: "center",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 56, fontSize: 10, opacity: .55, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>
        {label}
      </div>

      {/* Track + thumbs */}
      <div style={{ position: "relative", flex: 1, height: 22, minWidth: 120 }}>
        <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 4, transform: "translateY(-50%)",
          background: "rgba(255,255,255,.1)", borderRadius: 3 }} />
        <div style={{ position: "absolute", top: "50%", height: 4, transform: "translateY(-50%)",
          left: `${loPct}%`, width: `${Math.max(hiPct - loPct, 0)}%`,
          background: ACCENT, borderRadius: 3, opacity: .8 }} />
        <input type="range" className="bp-range" min={0} max={max} step={step}
          value={lo} onChange={e => handleLo(e.target.value)} />
        <input type="range" className="bp-range" min={0} max={max} step={step}
          value={hi} onChange={e => handleHi(e.target.value)} />
      </div>

      {/* Numeric min / max */}
      <input className="input" style={boxStyle} placeholder="any"
        value={vMin ?? ""} onChange={e => boxLo(e.target.value)} />
      <span style={{ opacity: .3, fontSize: 11 }}>–</span>
      <input className="input" style={boxStyle} placeholder="any"
        value={vMax ?? ""} onChange={e => boxHi(e.target.value)} />
    </div>
  );
}
