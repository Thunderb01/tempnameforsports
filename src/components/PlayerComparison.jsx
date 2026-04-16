import { useState, useMemo, useRef, useEffect } from "react";
import { money, letterGrade, gradeColor, tierColor, projectedTier } from "@/lib/display";

const STAT_ROWS = [
  { label: "PPG",      get: p => p.stats?.ppg,        fmt: v => Number(v).toFixed(1) },
  { label: "RPG",      get: p => p.stats?.rpg,        fmt: v => Number(v).toFixed(1) },
  { label: "APG",      get: p => p.stats?.apg,        fmt: v => Number(v).toFixed(1) },
  { label: "USG",      get: p => p.stats?.usg,        fmt: v => Number(v).toFixed(1) },
  { label: "AST/TOV",  get: p => p.stats?.ast_tov,   fmt: v => Number(v).toFixed(2) },
  { label: "FG%",      get: p => p.stats?.fg_pct,     fmt: v => `${Number(v).toFixed(1)}%` },
  { label: "3P%",      get: p => p.stats?.["3p_pct"], fmt: v => `${Number(v).toFixed(1)}%` },
  { label: "FT%",      get: p => p.stats?.ft_pct,     fmt: v => `${Number(v).toFixed(1)}%` },
];

const METRIC_ROWS = [
  { label: "Scoring Efficiency", get: p => p.stats?.sei },
  { label: "Athleticism",        get: p => p.stats?.ath },
  { label: "Rim Impact",         get: p => p.stats?.ris },
  { label: "Defending",          get: p => p.stats?.dds },
  { label: "Playmaking",         get: p => p.stats?.cdi },
];

const NIL_ROW = { label: "NIL Valuation", get: p => p.nilValuation };
const NUM_SLOTS = 4;

// ── Autocomplete slot ─────────────────────────────────────────────────────────
function PlayerAutocomplete({ value, onChange, allPlayers, label }) {
  const [query,  setQuery]  = useState("");
  const [open,   setOpen]   = useState(false);
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

  function pick(p) {
    onChange(p.id);
    setQuery("");
    setOpen(false);
  }

  function clear(e) {
    e.stopPropagation();
    onChange("");
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ fontSize: 10, opacity: .4, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4, fontWeight: 600 }}>
        {label}
      </div>

      {selected ? (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(91,156,246,.1)", border: "1px solid rgba(91,156,246,.35)",
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
          style={{ width: "100%", fontSize: 12 }}
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

// ── Main comparison table ─────────────────────────────────────────────────────
export function PlayerComparison({ initialIds = [], allPlayers = [] }) {
  const [slotIds, setSlotIds] = useState(() => {
    const base = ["", "", "", ""];
    initialIds.slice(0, NUM_SLOTS).forEach((id, i) => { base[i] = id ?? ""; });
    return base;
  });

  // When initialIds changes (e.g. navigating from modal), sync slot 0
  useEffect(() => {
    if (initialIds.length === 0) return;
    setSlotIds(prev => {
      const next = [...prev];
      initialIds.slice(0, NUM_SLOTS).forEach((id, i) => {
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

  const players = slotIds.map(id => (id ? playerById[id] ?? null : null));
  const activePlayers = players.filter(Boolean);

  function setSlot(i, id) {
    setSlotIds(prev => { const n = [...prev]; n[i] = id; return n; });
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

  const colW = `${Math.floor(82 / NUM_SLOTS)}%`;
  const thStyle = { padding: "8px 10px", fontSize: 11, fontWeight: 600, textAlign: "center", opacity: .45, borderBottom: "1px solid rgba(255,255,255,.1)" };
  const labelStyle = { padding: "7px 10px", fontSize: 12, opacity: .55, fontWeight: 500, whiteSpace: "nowrap", textAlign: "left" };
  const tdStyle = (i, getValue) => ({
    padding: "7px 10px", fontSize: 12, fontWeight: 600,
    textAlign: "center", fontVariantNumeric: "tabular-nums",
    background: cellBg(i, getValue), borderRadius: 4,
  });

  return (
    <div>
      {/* Slot selectors */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${NUM_SLOTS}, 1fr)`, gap: 12, marginBottom: 24 }}>
        {slotIds.map((id, i) => (
          <PlayerAutocomplete
            key={i}
            label={`Player ${i + 1}`}
            value={id}
            onChange={newId => setSlot(i, newId)}
            allPlayers={allPlayers}
          />
        ))}
      </div>

      {activePlayers.length === 0 ? (
        <div style={{ opacity: .35, fontSize: 13, textAlign: "center", padding: "32px 0" }}>
          Search for players above to compare.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <colgroup>
              <col style={{ width: "18%" }} />
              {players.map((_, i) => <col key={i} style={{ width: colW }} />)}
            </colgroup>
            <thead>
              <tr>
                <th style={thStyle} />
                {players.map((p, i) => (
                  <th key={i} style={{ ...thStyle, opacity: p ? 1 : .2 }}>
                    {p ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        {p.espn_id ? (
                          <img
                            src={`https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/${p.espn_id}.png`}
                            alt={p.name}
                            style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", background: "rgba(255,255,255,.06)" }}
                            onError={e => { e.target.style.display = "none"; }}
                          />
                        ) : (
                          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, opacity: .3 }}>
                            ?
                          </div>
                        )}
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{p.name}</div>
                          <div style={{ fontSize: 10, opacity: .5, marginTop: 2, fontWeight: 400 }}>
                            {[p.team, p.pos, p.year, p.height].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      </div>
                    ) : <span style={{ opacity: .2 }}>—</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={NUM_SLOTS + 1} style={{ padding: "10px 10px 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", opacity: .35 }}>NIL</td>
              </tr>
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
                  <td key={i} style={tdStyle(i, NIL_ROW.get)}>
                    {p ? `${money(p.marketLow)} – ${money(p.marketHigh)}` : <span style={{ opacity: .2 }}>—</span>}
                  </td>
                ))}
              </tr>

              <tr>
                <td colSpan={NUM_SLOTS + 1} style={{ padding: "10px 10px 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", opacity: .35 }}>Stats (Most Recent Season)</td>
              </tr>
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

              <tr>
                <td colSpan={NUM_SLOTS + 1} style={{ padding: "10px 10px 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", opacity: .35 }}>BtP Skill Profile</td>
              </tr>
              {METRIC_ROWS.map(row => (
                <tr key={row.label}>
                  <td style={labelStyle}>{row.label}</td>
                  {players.map((p, i) => {
                    const val = p ? row.get(p) : null;
                    const grade = letterGrade(val);
                    const color = gradeColor(grade);
                    return (
                      <td key={i} style={{ ...tdStyle(i, row.get), color }}>
                        {val != null ? <span>{Math.round(val)} <span style={{ fontSize: 11 }}>{grade}</span></span> : <span style={{ opacity: .2 }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, opacity: .4 }}>
            <span><span style={{ color: "#4ade80" }}>■</span> Best in category</span>
            <span><span style={{ color: "#e05c5c" }}>■</span> Lowest in category</span>
          </div>
        </div>
      )}
    </div>
  );
}
