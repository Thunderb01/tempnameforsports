import { useState, useEffect, useMemo } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { PlayerModal } from "@/components/PlayerModal";
import { supabase }   from "@/lib/supabase";
import { useTeamLogos } from "@/hooks/useTeamLogos";
import { money }      from "@/lib/display";

// ── Previous BTP scoring formula (kept for reference) ─────────────────────
// const SLOT_WEIGHTS = [1.0, 0.55, 0.30, 0.15, 0.08];
// function playerScore(p) {
//   const sei    = (p.sei || 0) * 15000;
//   const ath    = (p.ath || 0) * 5000;
//   const ris    = (p.ris || 0) * 4000;
//   const dds    = (p.dds || 0) * 4000;
//   const cdi    = (p.cdi || 0) * 4000;
//   const market = (p.open_market_high || 0);
//   return sei * 0.50 + market * 0.15 + ath * 0.13 + ris * 0.08 + dds * 0.08 + cdi * 0.06;
// }
// function scoreTeam(players) {
//   const byPos = {};
//   players.forEach(p => {
//     const pos = p.primary_position || "Wing";
//     if (!byPos[pos]) byPos[pos] = [];
//     byPos[pos].push(p);
//   });
//   let total = 0;
//   Object.values(byPos).forEach(group => {
//     group.sort((a, b) => playerScore(b) - playerScore(a))
//          .forEach((p, i) => { total += playerScore(p) * (SLOT_WEIGHTS[i] ?? 0.05); });
//   });
//   return total;
// }
// ──────────────────────────────────────────────────────────────────────────────

// Individual player score used only for sorting within the expand row
function playerScore(p) {
  return p.open_market_high || 0;
}

// Team score = average NIL valuation across all portal commits
function scoreTeam(players) {
  if (!players.length) return 0;
  return players.reduce((sum, p) => sum + (p.open_market_high || 0), 0) / players.length;
}

// Grade cutoffs mirror projected NIL tiers (HM All-American = A+, HM All-Conference = A, etc.)
function grade(nilValue) {
  const v = Number(nilValue) || 0;
  if (v >= 2_000_000) return { label: "A+", color: "#4ade80" };  // HM All-American / Pre-Draft
  if (v >= 1_600_000) return { label: "A",  color: "#4ade80" };  // HM All-Conference (high)
  if (v >= 1_200_000) return { label: "A-", color: "#86efac" };  // HM All-Conference
  if (v >=   700_000) return { label: "B+", color: "#a3e635" };  // HM Starter (high)
  if (v >=   550_000) return { label: "B",  color: "#bef264" };  // HM Starter
  if (v >=   400_000) return { label: "B-", color: "#d9f99d" };  // HM Starter / MM All-Conference
  if (v >=   300_000) return { label: "C+", color: "#fde68a" };  // HM Rotation (high)
  if (v >=   200_000) return { label: "C",  color: "#fcd34d" };  // HM Rotation / MM Starter
  if (v >=   150_000) return { label: "C-", color: "#fbbf24" };  // HM Rotation (low)
  if (v >=   100_000) return { label: "D",  color: "#fb923c" };  // MM Starter / LM All-Conference
  return { label: "F", color: "#f87171" };                        // LM Rotation
}

function displayName(name) {
  return (name || "").replace(/\s+(II|III|IV|V|Jr\.?|Sr\.?)$/i, "").trim();
}

function toModalPlayer(p) {
  return {
    id:           p.id,
    name:         p.name,
    espn_id:      p.espn_id   ?? null,
    team:         p.current_team ?? null,
    conf:         p.conference ?? null,
    pos:          p.primary_position ?? null,
    year:         p.year ?? null,
    height:       p.height   ?? null,
    hometown:     p.hometown ?? null,
    marketLow:    p.open_market_low  ?? 0,
    marketHigh:   p.open_market_high ?? 0,
    nilValuation: p.nil_valuation    ?? 0,
  };
}

const POS_ORDER = ["Guard", "Wing", "Big"];

function TeamExpandRow({ r, colCount, onOpenModal }) {
  const sortedPlayers = useMemo(() => {
    return [...r.players].sort((a, b) => {
      const posA = POS_ORDER.indexOf(a.primary_position || "Wing");
      const posB = POS_ORDER.indexOf(b.primary_position || "Wing");
      if (posA !== posB) return posA - posB;
      return playerScore(b) - playerScore(a);
    });
  }, [r.players]);

  const posCounts = POS_ORDER.map(pos => ({
    pos,
    players: (r.byPos[pos] || []).sort((a, b) => playerScore(b) - playerScore(a)),
  })).filter(g => g.players.length > 0);

  return (
    <tr>
      <td colSpan={colCount} style={{ padding: 0, background: "rgba(0,0,0,.35)", borderBottom: "2px solid var(--border)" }}>
        <div style={{ padding: "16px 20px" }}>
          {/* Position group bars */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            {posCounts.map(({ pos, players }) => {
              return (
                <div key={pos} style={{ flex: "1 1 200px", minWidth: 180, background: "rgba(255,255,255,.04)", borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", opacity: .5, marginBottom: 8 }}>{pos}s</div>
                  {players.map((p, i) => {
                    const pct = Math.min(((p.open_market_high || 0) / 2_000_000) * 100, 100);
                    const g = grade(p.open_market_high);
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ background: g.color, color: "#0e1521", fontWeight: 700, fontSize: 10, padding: "1px 6px", borderRadius: 8, minWidth: 26, textAlign: "center" }}>{g.label}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName(p.name)}</span>
                            <span style={{ fontSize: 11, opacity: .45, whiteSpace: "nowrap" }}>{p.year || "—"}</span>
                          </div>
                          <div style={{ height: 3, background: "rgba(255,255,255,.08)", borderRadius: 2, marginTop: 3 }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: g.color, borderRadius: 2, opacity: .7 }} />
                          </div>
                        </div>
                        <span style={{ fontSize: 11, opacity: .4, whiteSpace: "nowrap" }}>{money(p.open_market_high)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Full player table */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ opacity: .45 }}>
                {["Player", "Pos", "Yr", "Market High", "PPG", "RPG", "APG"].map(h => (
                  <th key={h} style={{ padding: "4px 10px", textAlign: "left", fontWeight: 600, fontSize: 11, borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.map(p => (
                <tr key={p.id}
                  onClick={() => onOpenModal && onOpenModal(p)}
                  style={{ borderBottom: "1px solid rgba(255,255,255,.04)", cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.04)"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}
                >
                  <td style={{ padding: "6px 10px", fontWeight: 500 }}>{displayName(p.name)}</td>
                  <td style={{ padding: "6px 10px", opacity: .6 }}>{p.primary_position || "—"}</td>
                  <td style={{ padding: "6px 10px", opacity: .6 }}>{p.year || "—"}</td>
                  <td style={{ padding: "6px 10px" }}>{money(p.open_market_high)}</td>
                  <td style={{ padding: "6px 10px", opacity: .7 }}>{p.ppg != null ? Number(p.ppg).toFixed(1) : "—"}</td>
                  <td style={{ padding: "6px 10px", opacity: .7 }}>{p.rpg != null ? Number(p.rpg).toFixed(1) : "—"}</td>
                  <td style={{ padding: "6px 10px", opacity: .7 }}>{p.apg != null ? Number(p.apg).toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}

export function PortalRankingsPage() {
  const teamLogos = useTeamLogos();
  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [posFilter, setPosFilter] = useState("all");
  const [expanded,  setExpanded]  = useState(null);
  const [modal,     setModal]     = useState(null);

  useEffect(() => {
    async function load() {
      const { data: transfers, error: tErr } = await supabase
        .from("portal_transfers")
        .select("to_team, player_id")
        .eq("season_year", 2026)
        .eq("status", "committed")
        .not("player_id", "is", null)
        .not("to_team", "is", null);

      if (tErr) { console.error(tErr); setLoading(false); return; }
      if (!transfers?.length) { setLoading(false); return; }

      const ids = [...new Set(transfers.map(r => r.player_id))];
      const { data: players, error: pErr } = await supabase
        .from("vw_players")
        .select("id, name, primary_position, open_market_high, open_market_low, sei, ath, ris, dds, cdi, nil_valuation, year, ppg, rpg, apg, espn_id, current_team, conference, height, hometown")
        .in("id", ids);

      if (pErr) { console.error(pErr); setLoading(false); return; }

      const playerById = Object.fromEntries((players || []).map(p => [p.id, p]));

      const teamMap = {};
      transfers.forEach(r => {
        const p = playerById[r.player_id];
        if (!p) return;
        if (!teamMap[r.to_team]) teamMap[r.to_team] = [];
        teamMap[r.to_team].push(p);
      });

      const scored = Object.entries(teamMap).filter(([, players]) => players.length >= 3).map(([team, players]) => ({
        team,
        players,
        raw: scoreTeam(players),
        commits: players.length,
        byPos: players.reduce((acc, p) => {
          const pos = p.primary_position || "Wing";
          if (!acc[pos]) acc[pos] = [];
          acc[pos].push(p);
          return acc;
        }, {}),
        topCommit: [...players].sort((a, b) => (b.open_market_high || 0) - (a.open_market_high || 0))[0],
        marketTotal: players.reduce((s, p) => s + (p.open_market_high || 0), 0),
      }));

      scored.sort((a, b) => b.raw - a.raw);
      const n = scored.length;
      const ranked = scored.map((t, i) => ({
        ...t,
        rank: i + 1,
        percentile: Math.round(100 - (i / (n - 1 || 1)) * 100),
      }));

      setRows(ranked);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !r.team.toLowerCase().includes(q)) return false;
      if (posFilter !== "all" && !r.byPos[posFilter]?.length) return false;
      return true;
    });
  }, [rows, search, posFilter]);

  const COL_COUNT = 10;

  return (
    <>
      <SiteHeader />
      {modal && <PlayerModal player={modal} onClose={() => setModal(null)} />}
      <div className="app-shell">
        <div className="app-top">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div>
              <h1 style={{ margin: 0 }}>Portal Rankings</h1>
              <p className="muted" style={{ marginTop: 4 }}>
                Teams ranked by portal class strength. Click a team to see roster construction.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" placeholder="Search team…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
              <select className="input" value={posFilter} onChange={e => setPosFilter(e.target.value)}>
                <option value="all">All positions</option>
                <option value="Guard">Guards</option>
                <option value="Wing">Wings</option>
                <option value="Big">Bigs</option>
              </select>
            </div>
          </div>
        </div>

        {loading
          ? <div className="empty">Loading portal data…</div>
          : filtered.length === 0
          ? <div className="empty">No results.</div>
          : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["", "Rank", "Team", "Grade", "Avg Value / Player", "Commits", "Guard", "Wing", "Big", "Proj. Transfer Value", "Top Commit"].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const g = grade(r.raw);
                    const isOpen = expanded === r.team;
                    const posScore = pos => {
                      const players = (r.byPos[pos] || []).sort((a, b) => playerScore(b) - playerScore(a));
                      if (!players.length) return <span style={{ opacity: .25 }}>—</span>;
                      return (
                        <div>
                          <span style={{ fontWeight: 600 }}>{displayName(players[0].name).split(" ").pop()}</span>
                          {players.length > 1 && <span style={{ opacity: .4, fontSize: 11 }}> +{players.length - 1}</span>}
                        </div>
                      );
                    };
                    return (
                      <>
                        <tr
                          key={r.team}
                          onClick={() => setExpanded(isOpen ? null : r.team)}
                          style={{ borderBottom: isOpen ? "none" : "1px solid var(--border)", cursor: "pointer", background: isOpen ? "rgba(91,156,246,.07)" : undefined, transition: "background .15s" }}
                          onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = "rgba(255,255,255,.03)"; }}
                          onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = ""; }}
                        >
                          <td style={{ ...tdStyle, width: 28, opacity: .4, fontSize: 11 }}>
                            {isOpen ? "▾" : "▸"}
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 700, opacity: .5, width: 48 }}>#{r.rank}</td>
                          <td style={tdStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              {teamLogos[r.team]
                                ? <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,.07)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                                    <img src={teamLogos[r.team]} alt={r.team} style={{ width: "72%", height: "72%", objectFit: "contain" }} />
                                  </div>
                                : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,.07)", flexShrink: 0 }} />
                              }
                              <span style={{ fontWeight: 500 }}>{r.team}</span>
                            </div>
                          </td>
                          <td style={tdStyle}>
                            <span style={{ background: g.color, color: "#0e1521", fontWeight: 700, fontSize: 13, padding: "2px 10px", borderRadius: 10 }}>
                              {g.label}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{money(r.raw)}</td>
                          <td style={tdStyle}>{r.commits}</td>
                          <td style={tdStyle}>{posScore("Guard")}</td>
                          <td style={tdStyle}>{posScore("Wing")}</td>
                          <td style={tdStyle}>{posScore("Big")}</td>
                          <td style={tdStyle}>{money(r.marketTotal)}</td>
                          <td style={tdStyle}>
                            {r.topCommit
                              ? <div>
                                  <div style={{ fontWeight: 500 }}>{displayName(r.topCommit.name)}</div>
                                  <div style={{ fontSize: 11, opacity: .45 }}>{r.topCommit.primary_position} · {money(r.topCommit.open_market_high)}</div>
                                </div>
                              : "—"
                            }
                          </td>
                        </tr>
                        {isOpen && <TeamExpandRow key={`${r.team}-expand`} r={r} colCount={COL_COUNT + 1} onOpenModal={p => setModal(toModalPlayer(p))} />}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </>
  );
}

const thStyle = { padding: "10px 12px", textAlign: "left", background: "rgba(0,0,0,.6)", backdropFilter: "blur(6px)", position: "sticky", top: 0, whiteSpace: "nowrap", borderBottom: "1px solid var(--border)", fontWeight: 500, fontSize: 12 };
const tdStyle = { padding: "10px 12px", verticalAlign: "middle", whiteSpace: "nowrap" };
