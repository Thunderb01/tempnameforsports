import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, nilRange, tierColor, projectedTier } from "@/lib/display";
import { SkillProfile, PENTAGON_METRICS } from "@/components/SkillProfile";

function fmt(val, key) {
  if (val === null || val === undefined || val === "" || (typeof val === "number" && isNaN(val)) || val === "NaN") return "—";
  const str = ["school"];
  if (str.includes(key)) return val;
  const pct = ["fg_pct","ft_pct","3p_pct","usg","torvik_usg","torvik_ts","torvik_efg","torvik_to_pct","torvik_ast_pct","torvik_blk_pct","torvik_stl_pct","torvik_orb_pct","torvik_drb_pct"];
  if (pct.includes(key)) return `${Number(val).toFixed(1)}%`;
  if (key === "torvik_rim_pct") return `${(Number(val) * 100).toFixed(1)}%`;
  return Number(val) % 1 === 0 ? Number(val).toFixed(0) : Number(val).toFixed(1);
}

const STAT_ROWS = [
  { key: "school",        label: "School" },
  { key: "calendar_year", label: "Season" },
  { key: "ppg",           label: "PTS/G" },
  { key: "rpg",           label: "REB/G" },
  { key: "apg",           label: "AST/G" },
  { key: "ast_tov",       label: "AST/TOV" },
  { key: "fg_pct",        label: "FG%" },
  { key: "3p_pct",        label: "3P%" },
  { key: "ft_pct",        label: "FT%" },
];

const ADV_ROWS = [
  { key: "school",          label: "School" },
  { key: "calendar_year",   label: "Season" },
  { key: "torvik_usg",      label: "USG%" },
  { key: "torvik_ts",       label: "TS%" },
  { key: "torvik_efg",      label: "eFG%" },
  { key: "torvik_to_pct",   label: "TO%" },
  { key: "torvik_ast_pct",  label: "AST%" },
  { key: "torvik_blk_pct",  label: "BLK%" },
  { key: "torvik_stl_pct",  label: "STL%" },
  { key: "torvik_orb_pct",  label: "ORB%" },
  { key: "torvik_drb_pct",  label: "DRB%" },
];

// const ADV_ROWS = [
//   { key: "cdi", label: "CDI" },
//   { key: "dds", label: "DDS" },
//   { key: "sei", label: "SEI" },
//   { key: "smi", label: "SMI" },
//   { key: "ris", label: "RIS" },
// ];

export function PlayerModal({ player, onClose, onReplace, sport = "mens" }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [profileIdx, setProfileIdx] = useState(0);
  const [showAdv, setShowAdv] = useState(false);
  const [archetypes, setArchetypes] = useState([]);
  const [archColors, setArchColors] = useState({});

  const playersTable = sport === "womens" ? "w_players"        : "players";
  const defsTable    = sport === "womens" ? "w_archetype_defs" : "archetype_defs";

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
      .order("calendar_year", { ascending: false })
      .then(({ data }) => {
        setStats(data?.length ? data : null);
        setLoadingStats(false);
      });
  }, [player?.id]);

  // Resolved archetype list + their colors (falls back to the single archetype).
  useEffect(() => {
    if (!player?.id) { setArchetypes([]); return; }
    supabase.from(playersTable).select("archetype, archetypes").eq("id", player.id).maybeSingle()
      .then(({ data }) => {
        const list = Array.isArray(data?.archetypes) && data.archetypes.length
          ? data.archetypes
          : (data?.archetype ? [data.archetype] : (player.archetype ? [player.archetype] : []));
        setArchetypes(list);
      });
    supabase.from(defsTable).select("name, color")
      .then(({ data }) => setArchColors(Object.fromEntries((data || []).map(d => [d.name, d.color || "#38bdf8"]))));
  }, [player?.id, playersTable, defsTable]);

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
            <div style={{ display: "flex", gap: 8 }}>
              {onReplace && (
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={onReplace}>
                  Replace This Player
                </button>
              )}
              <button className="btn btn-ghost" style={{ fontSize: 12 }}
                onClick={() => { onClose(); navigate(`/compare?p0=${player.id}`); }}>
                Compare
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
            </div>
          </div>

          <>

          <div className="modal-section">
            <h4>Market Production Value Range</h4>
            <div className="modal-sub">{nilRange(player.marketLow, player.marketHigh)}</div>
            {player.nilValuation > 0 && (() => {
              const label = projectedTier(player.nilValuation);
              const color = tierColor(label);
              return (
                <div style={{ marginTop: 6, display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: `${color}22`, color, border: `1px solid ${color}55` }}>
                  {label}
                </div>
              );
            })()}
            {archetypes.map(name => {
              const c = archColors[name] || "#38bdf8";
              return (
                <div key={name} style={{ marginTop: 6, marginLeft: 6, display: "inline-block", padding: "3px 10px",
                  borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: `${c}22`, color: c, border: `1px solid ${c}55` }}>
                  {name}
                </div>
              );
            })}
          </div>

          <div className="modal-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Stats</h4>
              {stats && (
                <button
                  onClick={() => setShowAdv(v => !v)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, cursor: "pointer", border: "1px solid",
                    background: showAdv ? "rgba(91,156,246,.2)" : "transparent",
                    color:      showAdv ? "#5b9cf6" : "rgba(255,255,255,.4)",
                    borderColor: showAdv ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.15)",
                    transition: "all .15s",
                  }}
                >
                  Advanced
                </button>
              )}
            </div>
            {stats && stats[0]?.torvik_min_pct != null && stats[0].torvik_min_pct < 30 && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                background: "rgba(251,191,36,.07)", border: "1px solid rgba(251,191,36,.25)",
                borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12,
              }}>
                <span style={{ color: "#fbbf24", flexShrink: 0, marginTop: 1 }}>⚠</span>
                <span style={{ color: "rgba(255,255,255,.6)", lineHeight: 1.5 }}>
                  Small sample — this player logged under 30% of team minutes ({stats[0].torvik_min_pct?.toFixed(1)}%). Stats and metrics may not be inconsistent.
                </span>
              </div>
            )}
            {loadingStats ? (
              <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
            ) : !stats ? (
              <div style={{ opacity: .4, fontSize: 13 }}>No stats on file.</div>
            ) : (
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
                    {stats.map((row, i) => (
                      <tr key={row.calendar_year ?? i} style={i > 0 ? { opacity: 0.55 } : {}}>
                        {STAT_ROWS.map(({ key }) => (
                          <td key={key} style={{ padding: "6px 10px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                            {fmt(row[key], key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {showAdv && (
                      <>
                        <tr>
                          <td colSpan={STAT_ROWS.length} style={{ padding: "10px 10px 4px", opacity: .35, fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>
                            Advanced
                          </td>
                        </tr>
                        <tr>
                          {ADV_ROWS.map(({ key, label }) => (
                            <th key={key} style={{ padding: "4px 10px", opacity: .5, fontWeight: 600, textAlign: "center", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
                              {label}
                            </th>
                          ))}
                        </tr>
                        {stats.map((row, i) => (
                          <tr key={`adv-${row.calendar_year ?? i}`} style={i > 0 ? { opacity: 0.55 } : {}}>
                            {ADV_ROWS.map(({ key }) => (
                              <td key={key} style={{ padding: "6px 10px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                                {fmt(row[key], key)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="modal-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h4 style={{ margin: 0 }}>Beyond the Portal Skill Profile</h4>
              {stats?.length > 1 && (
                <div style={{ display: "flex", gap: 4 }}>
                  {stats.map((row, i) => (
                    <button key={row.calendar_year ?? i} onClick={() => setProfileIdx(i)} style={{
                      fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 20, cursor: "pointer", border: "1px solid",
                      background: profileIdx === i ? "rgba(91,156,246,.2)" : "transparent",
                      color:      profileIdx === i ? "#5b9cf6" : "rgba(255,255,255,.35)",
                      borderColor: profileIdx === i ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.12)",
                    }}>
                      {row.calendar_year ?? `Season ${i + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, opacity: .4, marginBottom: 10 }}>
              Grades reflect percentile rank within position group (Guard, Wing, or Big).
            </div>
            {loadingStats ? (
              <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
            ) : !stats ? (
              <div style={{ opacity: .4, fontSize: 13 }}>No metrics on file.</div>
            ) : PENTAGON_METRICS.every(m => stats[profileIdx]?.[m.key] == null) ? (
              <div style={{ opacity: .4, fontSize: 13, fontStyle: "italic" }}>
                Insufficient playing time to generate a skill profile.
              </div>
            ) : (
              <SkillProfile stats={stats[profileIdx]} />
            )}
          </div>

          </>

        </div>
      </div>
    </>
  );
}
