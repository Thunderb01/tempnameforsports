import { useState, useMemo, useRef, useEffect } from "react";
import { money, letterGrade, tierColor, projectedTier } from "@/lib/display";

// One color per slot — consistent across the whole comparison
const SLOT_COLORS = ["#5b9cf6", "#f97316", "#4ade80", "#a78bfa"];

const STAT_ROWS = [
  { label: "PPG",     get: p => p.stats?.ppg,        fmt: v => Number(v).toFixed(1) },
  { label: "RPG",     get: p => p.stats?.rpg,        fmt: v => Number(v).toFixed(1) },
  { label: "APG",     get: p => p.stats?.apg,        fmt: v => Number(v).toFixed(1) },
  { label: "USG",     get: p => p.stats?.usg,        fmt: v => Number(v).toFixed(1) },
  { label: "AST/TOV", get: p => p.stats?.ast_tov,   fmt: v => Number(v).toFixed(2) },
  { label: "FG%",     get: p => p.stats?.fg_pct,     fmt: v => `${Number(v).toFixed(1)}%` },
  { label: "3P%",     get: p => p.stats?.["3p_pct"], fmt: v => `${Number(v).toFixed(1)}%` },
  { label: "FT%",     get: p => p.stats?.ft_pct,     fmt: v => `${Number(v).toFixed(1)}%` },
];

const METRIC_ROWS = [
  { label: "Scoring Efficiency", key: "sei", get: p => p.stats?.sei },
  { label: "Athleticism",        key: "ath", get: p => p.stats?.ath },
  { label: "Rim Impact",         key: "ris", get: p => p.stats?.ris },
  { label: "Defending",          key: "dds", get: p => p.stats?.dds },
  { label: "Playmaking",         key: "cdi", get: p => p.stats?.cdi },
];

// ── Autocomplete slot ─────────────────────────────────────────────────────────
function PlayerAutocomplete({ value, onChange, allPlayers, label, color }) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const inputRef = useRef(null);

  const selected = value ? allPlayers.find(p => p.id === value) ?? null : null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allPlayers
      .filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.team?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [query, allPlayers]);

  function pick(p) { onChange(p.id); setQuery(""); setOpen(false); }
  function clear(e) {
    e.stopPropagation();
    onChange("");
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em",
        marginBottom: 4, fontWeight: 600,
        color,
        opacity: .8,
      }}>
        {label}
      </div>

      {selected ? (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: `${color}14`, border: `1px solid ${color}50`,
          borderRadius: 6, padding: "6px 10px", gap: 8,
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{selected.name}</div>
            <div style={{ fontSize: 10, opacity: .5, marginTop: 1 }}>{selected.team} · {selected.pos}</div>
          </div>
          <button onClick={clear} style={{
            background: "none", border: "none", color: "rgba(255,255,255,.4)",
            cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0,
          }}>×</button>
        </div>
      ) : (
        <input
          ref={inputRef}
          className="input"
          style={{ width: "100%", fontSize: 12, borderColor: `${color}40` }}
          placeholder="Search by name or team…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      )}

      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          background: "#111d2e", border: "1px solid rgba(255,255,255,.12)",
          borderRadius: 6, marginTop: 3, overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,.5)",
        }}>
          {results.map(p => (
            <div key={p.id}
              onMouseDown={() => pick(p)}
              style={{
                padding: "8px 12px", cursor: "pointer", fontSize: 12,
                borderBottom: "1px solid rgba(255,255,255,.06)",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.07)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <span style={{ opacity: .45, marginLeft: 8 }}>{p.team} · {p.pos}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BtP Metrics side panel ────────────────────────────────────────────────────
function MetricSidebar({ players, slotIds }) {
  // Same pentagon geometry as PlayerModal
  const cx = 100, cy = 98, r = 58;
  const n = 5;
  const angles = Array.from({ length: n }, (_, i) => (i * 2 * Math.PI / n) - Math.PI / 2);

  function gridPoints(scale) {
    return angles.map(a => `${cx + scale * r * Math.cos(a)},${cy + scale * r * Math.sin(a)}`).join(" ");
  }

  function playerPoints(p) {
    return angles.map((a, i) => {
      const val = p?.stats?.[METRIC_ROWS[i].key];
      const scale = val != null ? Math.min(Math.max(val / 100, 0), 1) : 0;
      return `${cx + scale * r * Math.cos(a)},${cy + scale * r * Math.sin(a)}`;
    }).join(" ");
  }

  const activePlayers = players.filter(Boolean);

  return (
    <div style={{
      width: 230, flexShrink: 0,
      background: "rgba(255,255,255,.03)",
      border: "1px solid rgba(255,255,255,.08)",
      borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", opacity: .4, marginBottom: 10 }}>
        BtP Skill Profile
      </div>

      {/* Pentagon SVG — same as PlayerModal, multiple players overlaid */}
      <svg width="200" height="196" viewBox="0 0 200 196" style={{ width: "100%", height: "auto" }}>
        {[0.25, 0.5, 0.75, 1].map(s => (
          <polygon key={s} points={gridPoints(s)} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
        ))}
        <polygon points={gridPoints(0.5)} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="1" strokeDasharray="3 3" />
        {angles.map((a, i) => (
          <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="rgba(255,255,255,.1)" strokeWidth="1" />
        ))}
        {/* Render in reverse so player 1 sits on top */}
        {[...activePlayers].reverse().map(p => {
          const slotIdx = slotIds.findIndex(id => id === p.id);
          const color = SLOT_COLORS[slotIdx >= 0 ? slotIdx : 0];
          return (
            <polygon key={p.id} points={playerPoints(p)} fill={`${color}28`} stroke={color} strokeWidth="1.75" />
          );
        })}
        {angles.map((a, i) => {
          const lr = r + 22;
          return (
            <text key={i}
              x={cx + lr * Math.cos(a)} y={cy + lr * Math.sin(a)}
              textAnchor="middle" dominantBaseline="middle"
              fill="rgba(255,255,255,.5)" fontSize="9" fontWeight="500">
              {METRIC_ROWS[i].label}
            </text>
          );
        })}
      </svg>

      {/* Player color legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 12px", marginTop: 6, marginBottom: 14 }}>
        {players.map((p, i) => {
          if (!p) return null;
          const color = SLOT_COLORS[slotIds.findIndex(id => id === p.id) >= 0 ? slotIds.findIndex(id => id === p.id) : i];
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ opacity: .65 }}>{p.name.split(" ").slice(-1)[0]}</span>
            </div>
          );
        })}
      </div>

      {/* Per-metric scores, colored per player */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {METRIC_ROWS.map(row => (
          <div key={row.key}>
            <div style={{ fontSize: 10, opacity: .38, marginBottom: 4, fontWeight: 600 }}>{row.label}</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {players.map((p, i) => {
                if (!p) return null;
                const slotIdx = slotIds.findIndex(id => id === p.id);
                const color = SLOT_COLORS[slotIdx >= 0 ? slotIdx : i];
                const val = row.get(p);
                const grade = letterGrade(val);
                return (
                  <div key={p.id} style={{ color, fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {val != null ? `${Math.round(val)} ${grade}` : <span style={{ opacity: .25 }}>—</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main comparison ───────────────────────────────────────────────────────────
export function PlayerComparison({ initialIds = [], allPlayers = [] }) {
  const [numSlots, setNumSlots] = useState(2);
  const [slotIds, setSlotIds] = useState(() => {
    const base = ["", "", "", ""];
    initialIds.slice(0, 4).forEach((id, i) => { base[i] = id ?? ""; });
    // If initialIds pre-filled more than 2 slots, show those slots
    return base;
  });

  // Expand to however many slots are pre-filled by URL params
  useEffect(() => {
    const filled = initialIds.filter(id => id && id !== "").length;
    if (filled > 2) setNumSlots(Math.min(4, filled));
  }, []);

  useEffect(() => {
    if (initialIds.length === 0) return;
    setSlotIds(prev => {
      const next = [...prev];
      initialIds.slice(0, 4).forEach((id, i) => {
        if (id && !next[i]) next[i] = id;
      });
      return next;
    });
  }, [initialIds.join(",")]);

  const playerById = useMemo(() => {
    const m = {};
    allPlayers.forEach(p => { m[p.id] = p; });
    return m;
  }, [allPlayers]);

  // Only consider the visible slots
  const visibleSlotIds = slotIds.slice(0, numSlots);
  const players = visibleSlotIds.map(id => (id ? playerById[id] ?? null : null));
  const activePlayers = players.filter(Boolean);

  function setSlot(i, id) {
    setSlotIds(prev => { const n = [...prev]; n[i] = id; return n; });
  }

  function addSlot() {
    setNumSlots(n => Math.min(4, n + 1));
  }

  function bestIdx(getValue) {
    const nums = players.map(p => {
      if (!p) return null;
      const v = getValue(p);
      return v != null && !isNaN(Number(v)) ? Number(v) : null;
    });
    const filled = nums.filter(v => v != null);
    if (filled.length < 2) return -1;
    const max = Math.max(...filled);
    return nums.findIndex(v => v === max);
  }

  function worstIdx(getValue) {
    const nums = players.map(p => {
      if (!p) return null;
      const v = getValue(p);
      return v != null && !isNaN(Number(v)) ? Number(v) : null;
    });
    const filled = nums.filter(v => v != null);
    if (filled.length < 2) return -1;
    const min = Math.min(...filled);
    return nums.findLastIndex(v => v === min);
  }

  function cellBg(i, getValue) {
    if (!players[i]) return "transparent";
    const bi = bestIdx(getValue);
    const wi = worstIdx(getValue);
    if (bi === wi) return "transparent";
    if (i === bi) return "rgba(74,222,128,.12)";
    if (i === wi) return "rgba(224,92,92,.10)";
    return "transparent";
  }

  const NIL_GET = p => p.nilValuation;

  const thStyle = {
    padding: "8px 10px", fontSize: 11, fontWeight: 600,
    textAlign: "center", opacity: .45,
    borderBottom: "1px solid rgba(255,255,255,.1)",
  };
  const labelStyle = {
    padding: "7px 10px", fontSize: 12, opacity: .55,
    fontWeight: 500, whiteSpace: "nowrap", textAlign: "left",
  };
  const tdStyle = (i, getValue) => ({
    padding: "7px 10px", fontSize: 12, fontWeight: 600,
    textAlign: "center", fontVariantNumeric: "tabular-nums",
    background: cellBg(i, getValue), borderRadius: 4,
  });

  const sectionHeader = (label) => (
    <tr>
      <td colSpan={numSlots + 1} style={{
        padding: "12px 10px 4px", fontSize: 10, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: ".08em", opacity: .35,
      }}>
        {label}
      </td>
    </tr>
  );

  return (
    <div>
      {/* ── Slot selectors ── */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${numSlots}, minmax(180px, 1fr))`,
          gap: 12, flex: 1,
        }}>
          {visibleSlotIds.map((id, i) => (
            <PlayerAutocomplete
              key={i}
              label={`Player ${i + 1}`}
              value={id}
              color={SLOT_COLORS[i]}
              onChange={newId => setSlot(i, newId)}
              allPlayers={allPlayers}
            />
          ))}
        </div>

        {numSlots < 4 && (
          <button
            className="btn btn-ghost"
            onClick={addSlot}
            style={{ flexShrink: 0, alignSelf: "flex-end", fontSize: 12 }}
          >
            + Add Player
          </button>
        )}
      </div>

      {activePlayers.length === 0 ? (
        <div style={{ opacity: .35, fontSize: 13, textAlign: "center", padding: "48px 0" }}>
          Search for players above to compare.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>

          {/* ── Main table ── */}
          <div style={{ flex: 1, overflowX: "auto", minWidth: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <colgroup>
                <col style={{ width: "18%" }} />
                {players.map((_, i) => <col key={i} style={{ width: `${Math.floor(82 / numSlots)}%` }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={thStyle} />
                  {players.map((p, i) => {
                    const color = SLOT_COLORS[i];
                    return (
                      <th key={i} style={{ ...thStyle, opacity: p ? 1 : .2, borderBottom: `2px solid ${p ? color : "transparent"}` }}>
                        {p ? (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                            {p.espn_id ? (
                              <img
                                src={`https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/${p.espn_id}.png`}
                                alt={p.name}
                                style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", background: "rgba(255,255,255,.06)", border: `2px solid ${color}60` }}
                                onError={e => { e.target.style.display = "none"; }}
                              />
                            ) : (
                              <div style={{ width: 52, height: 52, borderRadius: "50%", background: `${color}18`, border: `2px solid ${color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color, opacity: .6 }}>
                                ?
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color }}>{p.name}</div>
                              <div style={{ fontSize: 10, opacity: .5, marginTop: 2, fontWeight: 400 }}>
                                {[p.team, p.pos, p.year, p.height].filter(Boolean).join(" · ")}
                              </div>
                            </div>
                          </div>
                        ) : <span style={{ opacity: .2 }}>—</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sectionHeader("NIL")}
                <tr>
                  <td style={labelStyle}>Tier</td>
                  {players.map((p, i) => {
                    if (!p) return <td key={i} style={{ textAlign: "center", opacity: .2 }}>—</td>;
                    const lbl = projectedTier(p.nilValuation);
                    const clr = tierColor(lbl);
                    return (
                      <td key={i} style={{ padding: "6px 8px", textAlign: "center" }}>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, color: clr, background: `${clr}22`, border: `1px solid ${clr}55`, whiteSpace: "nowrap" }}>
                          {lbl}
                        </span>
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td style={labelStyle}>NIL Range</td>
                  {players.map((p, i) => (
                    <td key={i} style={tdStyle(i, NIL_GET)}>
                      {p ? `${money(p.marketLow)} – ${money(p.marketHigh)}` : <span style={{ opacity: .2 }}>—</span>}
                    </td>
                  ))}
                </tr>

                {sectionHeader("Stats (Most Recent Season)")}
                {STAT_ROWS.map(row => (
                  <tr key={row.label}>
                    <td style={labelStyle}>{row.label}</td>
                    {players.map((p, i) => {
                      const val = p ? row.get(p) : null;
                      return (
                        <td key={i} style={tdStyle(i, row.get)}>
                          {val != null ? row.fmt(val) : <span style={{ opacity: .2 }}>—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, opacity: .35 }}>
              <span><span style={{ color: "#4ade80" }}>■</span> Best in category</span>
              <span><span style={{ color: "#e05c5c" }}>■</span> Lowest in category</span>
            </div>
          </div>

          {/* ── BtP Metrics sidebar ── */}
          <MetricSidebar players={players} slotIds={visibleSlotIds} />

        </div>
      )}
    </div>
  );
}
