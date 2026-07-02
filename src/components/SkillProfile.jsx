import { letterGrade, gradeColor } from "@/lib/display";

// Shared 5-axis BTP skill pentagon. Used by the player card (one player's stats)
// and the Roster Strength view (a roster-aggregated profile). `stats` is keyed
// by sei/ath/ris/dds/cdi, each 0–100. `accent` themes the polygon/fill.
export const PENTAGON_METRICS = [
  { key: "sei", label: "Scoring Efficiency", desc: "Powered by TS% and FGA for volume." },
  { key: "ath", label: "Athleticism",        desc: "Advanced metrics across lateral, vertical, and contact." },
  { key: "ris", label: "Rim Impact",         desc: "Driven by BLK%, DRB%, ORB%, and rim FG%." },
  { key: "dds", label: "Defending",          desc: "Driven by BLK%, STL%, DRB%, and FC/40." },
  { key: "cdi", label: "Playmaking",         desc: "Driven by AST%, TO%, and positional weighting." },
];

export function SkillProfile({ stats, accent = "#5b9cf6" }) {
  const cx = 100, cy = 98, r = 58;
  const n = 5;
  const angles = Array.from({ length: n }, (_, i) => (i * 2 * Math.PI / n) - Math.PI / 2);

  function polygonPoints(scale) {
    return angles.map(a => `${cx + scale * r * Math.cos(a)},${cy + scale * r * Math.sin(a)}`).join(" ");
  }

  const playerPoints = angles.map((a, i) => {
    const val = stats?.[PENTAGON_METRICS[i].key];
    const scale = val != null ? Math.min(Math.max(val / 100, 0), 1) : 0;
    return `${cx + scale * r * Math.cos(a)},${cy + scale * r * Math.sin(a)}`;
  }).join(" ");

  // accent color → translucent fill
  const fill = `${accent}40`;

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      {/* Pentagon */}
      <svg width="200" height="196" viewBox="0 0 200 196" style={{ flexShrink: 0 }}>
        {[0.25, 0.5, 0.75, 1].map(s => (
          <polygon key={s} points={polygonPoints(s)} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
        ))}
        <polygon points={polygonPoints(0.5)} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="1" strokeDasharray="3 3" />
        {angles.map((a, i) => (
          <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="rgba(255,255,255,.1)" strokeWidth="1" />
        ))}
        <polygon points={playerPoints} fill={fill} stroke={accent} strokeWidth="2" />
        {angles.map((a, i) => {
          const lr = r + 22;
          const x = cx + lr * Math.cos(a);
          const y = cy + lr * Math.sin(a);
          return (
            <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
              fill="rgba(255,255,255,.5)" fontSize="9" fontWeight="500">
              {PENTAGON_METRICS[i].label}
            </text>
          );
        })}
      </svg>

      {/* Bars + grades */}
      <div style={{ flex: 1, minWidth: 160, display: "flex", flexDirection: "column", gap: 10 }}>
        {PENTAGON_METRICS.map(({ key, label, desc }) => {
          const val = stats?.[key];
          const grade = letterGrade(val);
          const pct = val != null ? Math.min(Math.max(val / 100, 0), 1) * 100 : 0;
          const color = gradeColor(grade);
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 90, fontSize: 12, color: "rgba(255,255,255,.6)", flexShrink: 0, position: "relative", cursor: "default", whiteSpace: "nowrap" }}
                onMouseEnter={e => { const tip = e.currentTarget.querySelector(".metric-tip"); if (tip) tip.style.display = "block"; }}
                onMouseLeave={e => { const tip = e.currentTarget.querySelector(".metric-tip"); if (tip) tip.style.display = "none"; }}>
                {label}
                <div className="metric-tip" style={{
                  display: "none", position: "absolute", left: 0, bottom: "calc(100% + 6px)",
                  background: "#1e2d45", border: "1px solid rgba(255,255,255,.35)",
                  borderRadius: 6, padding: "8px 11px", fontSize: 11, lineHeight: 1.6,
                  width: 220, whiteSpace: "normal", wordBreak: "break-word",
                  color: "#fff", zIndex: 10,
                  boxShadow: "0 4px 20px rgba(0,0,0,.9)", pointerEvents: "none",
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: "#fff" }}>{label}</div>
                  <div style={{ opacity: .85 }}>{desc}</div>
                </div>
              </div>
              <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,.08)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width .4s ease" }} />
              </div>
              <div style={{ width: 32, fontSize: 11, opacity: .5, textAlign: "left", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{val != null ? Math.round(val) : "—"}</div>
              <div style={{ width: 32, fontSize: 12, fontWeight: 700, color, textAlign: "left", flexShrink: 0 }}>{grade}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
