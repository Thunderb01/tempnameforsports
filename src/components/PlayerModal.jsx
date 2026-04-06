import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";


function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

function fmt(val, key) {
  if (val === null || val === undefined || val === "" || (typeof val === "number" && isNaN(val)) || val === "NaN") return "—";
  const pct = ["fg_pct","ft_pct","3p_pct"];
  if (pct.includes(key)) return `${Number(val).toFixed(1)}%`;
  if (key === "torvik_rim_pct") return `${(Number(val) * 100).toFixed(1)}%`;
  return Number(val) % 1 === 0 ? Number(val).toFixed(0) : Number(val).toFixed(1);
}

const STAT_ROWS = [
  { key: "calendar_year", label: "Season" },
  { key: "usg",           label: "USG" },
  { key: "ppg",           label: "PPG" },
  { key: "rpg",           label: "RPG" },
  { key: "apg",           label: "APG" },
  { key: "ast_tov",       label: "AST/TOV" },
  { key: "fg_pct",        label: "FG%" },
  { key: "3p_pct",        label: "3P%" },
  { key: "ft_pct",        label: "FT%" },
];

// const ADV_ROWS = [
//   { key: "cdi", label: "CDI" },
//   { key: "dds", label: "DDS" },
//   { key: "sei", label: "SEI" },
//   { key: "smi", label: "SMI" },
//   { key: "ris", label: "RIS" },
// ];

// Pentagon order (clockwise from top): Scoring Efficiency, ATH, Interior Impact, Defending, Playmaking
const PENTAGON_METRICS = [
  { key: "sei", label: "Scoring Efficiency", desc: "Powered by TS% and FGA for volume." },
  { key: "ath", label: "Athleticism",        desc: "Advanced metrics across lateral, vertical, and contact." },
  { key: "ris", label: "Rim Impact",         desc: "Driven by BLK%, DRB%, ORB%, and rim FG%." },
  { key: "dds", label: "Defending",          desc: "Driven by BLK%, STL%, DRB%, and FC/40." },
  { key: "cdi", label: "Playmaking",         desc: "Driven by AST%, TO%, and positional weighting." },
];

function letterGrade(val) {
  if (val === null || val === undefined) return "—";
  if (val >= 95) return "A+";
  if (val >= 90) return "A";
  if (val >= 85) return "A-";
  if (val >= 80) return "B+";
  if (val >= 75) return "B";
  if (val >= 70) return "B-";
  if (val >= 60) return "C+";
  if (val >= 50) return "C";
  if (val >= 40) return "C-";
  if (val >= 30) return "D+";
  if (val >= 20) return "D";
  return "F";
}

function gradeColor(grade) {
  if (grade.startsWith("A")) return "#4ade80";
  if (grade.startsWith("B")) return "#5b9cf6";
  if (grade.startsWith("C")) return "#f5a623";
  if (grade.startsWith("D")) return "#fb923c";
  if (grade === "F")         return "#e05c5c";
  return "rgba(255,255,255,.4)";
}

function SkillProfile({ stats }) {
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

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      {/* Pentagon */}
      <svg width="200" height="196" viewBox="0 0 200 196" style={{ flexShrink: 0 }}>
        {/* Background rings */}
        {[0.25, 0.5, 0.75, 1].map(s => (
          <polygon key={s} points={polygonPoints(s)} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
        ))}
        {/* Mean ring (50/100 = 0.5) highlighted */}
        <polygon points={polygonPoints(0.5)} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="1" strokeDasharray="3 3" />
        {/* Axes */}
        {angles.map((a, i) => (
          <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="rgba(255,255,255,.1)" strokeWidth="1" />
        ))}
        {/* Player area */}
        <polygon points={playerPoints} fill="rgba(91,156,246,.25)" stroke="#5b9cf6" strokeWidth="2" />
        {/* Labels */}
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
              <div style={{ width: 90, fontSize: 12, opacity: .6, flexShrink: 0, position: "relative", cursor: "default", whiteSpace: "nowrap" }}
                onMouseEnter={e => {
                  const tip = e.currentTarget.querySelector(".metric-tip");
                  if (tip) tip.style.display = "block";
                }}
                onMouseLeave={e => {
                  const tip = e.currentTarget.querySelector(".metric-tip");
                  if (tip) tip.style.display = "none";
                }}>
                {label}
                <div className="metric-tip" style={{
                  display: "none", position: "absolute", left: 0, bottom: "calc(100% + 6px)",
                  background: "#1e2a3a", border: "1px solid rgba(255,255,255,.12)",
                  borderRadius: 6, padding: "7px 10px", fontSize: 11, lineHeight: 1.5,
                  width: 200, color: "rgba(255,255,255,.75)", zIndex: 10,
                  boxShadow: "0 4px 16px rgba(0,0,0,.4)", pointerEvents: "none",
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 3, opacity: 1, color: "#fff" }}>{label}</div>
                  {desc}
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

export function PlayerModal({ player, onClose }) {
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!player?.id) return;
    setLoadingStats(true);
    supabase
      .from("player_stats")
      .select("*")
      .eq("player_id", player.id)
      .maybeSingle()
      .then(({ data }) => {
        console.log("player_stats row:", data);
        setStats(data ?? null);
        setLoadingStats(false);
      });
  }, [player?.id]);

  if (!player) return null;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-card">

          <div className="modal-head">
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {player.espn_id && (
                <img
                  src={`https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/${player.espn_id}.png`}
                  alt={player.name}
                  style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", background: "rgba(255,255,255,.06)", flexShrink: 0 }}
                  onError={e => { e.target.style.display = "none"; }}
                />
              )}
              <div>
                <div className="modal-kicker">Player Card</div>
                <h3 className="modal-title" id="modal-title">{player.name}</h3>
                <div className="modal-sub">
                  {[player.team, player.conf, player.pos, player.year, player.height, player.hometown]
                    .filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>

          <div className="modal-section">
            <h4>Market Production Value Range</h4>
            <div className="modal-sub">{money(player.marketLow)} – {money(player.marketHigh)}</div>
          </div>

          <div className="modal-section">
            <h4>Stats</h4>
            {loadingStats ? (
              <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
            ) : !stats ? (
              <div style={{ opacity: .4, fontSize: 13 }}>No stats on file.</div>
            ) : (
              <>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12, whiteSpace: "nowrap" }}>
                  <thead>
                    <tr>
                      {STAT_ROWS.map(({ key, label }) => (
                        <th key={key} style={{ padding: "4px 10px", opacity: .5, fontWeight: 600, textAlign: "center", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {STAT_ROWS.map(({ key }) => (
                        <td key={key} style={{ padding: "6px 10px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          {fmt(stats[key], key)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, marginBottom: 8, fontWeight: 500 }}>Beyond the Portal Metrics (BtPM)</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 12, whiteSpace: "nowrap" }}>
                    <thead>
                      <tr>
                        {ADV_ROWS.map(({ key, label }) => (
                          <th key={key} style={{ padding: "4px 10px", opacity: .5, fontWeight: 600, textAlign: "center", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {ADV_ROWS.map(({ key }) => (
                          <td key={key} style={{ padding: "6px 10px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                            {fmt(stats[key], key)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div> */}
              </>
            )}
          </div>

          <div className="modal-section">
            <h4>Beyond the Portal Skill Profile</h4>
            <div style={{ fontSize: 11, opacity: .4, marginBottom: 10 }}>
              Grades reflect percentile rank within position group (Guard, Wing, or Big).
            </div>
            {loadingStats ? (
              <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
            ) : !stats ? (
              <div style={{ opacity: .4, fontSize: 13 }}>No metrics on file.</div>
            ) : PENTAGON_METRICS.every(m => stats[m.key] == null) ? (
              <div style={{ opacity: .4, fontSize: 13, fontStyle: "italic" }}>
                Insufficient playing time to generate a skill profile.
              </div>
            ) : (
              <SkillProfile stats={stats} />
            )}
          </div>

        </div>
      </div>
    </>
  );
}
