import { useState, useEffect, useMemo, useRef, memo, useCallback } from "react";
import { createPortal } from "react-dom";
import { SiteHeader }       from "@/components/SiteHeader";
import { PlayerCard }       from "@/components/PlayerCard";
import { PlayerModal }      from "@/components/PlayerModal";
import { IntlPlayerModal }  from "@/components/IntlPlayerModal";
import { PlayerFinder }     from "@/components/PlayerFinder";
import { useAuth }          from "@/hooks/useAuth";
import { useWomensRosterBoard as useRosterBoard }   from "@/hooks/useWomensRosterBoard";
import { useAdminTeam }     from "@/hooks/useAdminTeam";
import { TeamAutocomplete } from "@/components/TeamAutocomplete";
import { supabase }         from "@/lib/supabase";
import { exportRosterPDF }  from "@/lib/exportRoster";
import { track }            from "@/lib/track";
import { money, letterGrade, gradeColor, bucketPosition } from "@/lib/display";
import { MultiSelectFilter, RangeFilter, FilterChips, parseHeight, formatHeight, playerHeightInches } from "@/components/Filters";
import { getTeamConference } from "@/lib/teamLookup";

// Absolute thresholds calibrated against portal rankings score distribution
function rosterGrade(score) {
  if (score >= 7000000) return { label: "A+", color: "#4ade80" };
  if (score >= 5500000) return { label: "A",  color: "#4ade80" };
  if (score >= 4500000) return { label: "A-", color: "#86efac" };
  if (score >= 3800000) return { label: "B+", color: "#a3e635" };
  if (score >= 3200000) return { label: "B",  color: "#bef264" };
  if (score >= 2600000) return { label: "B-", color: "#d9f99d" };
  if (score >= 2100000) return { label: "C+", color: "#fde68a" };
  if (score >= 1600000) return { label: "C",  color: "#fcd34d" };
  if (score >= 1100000) return { label: "C-", color: "#fbbf24" };
  if (score >= 600000)  return { label: "D",  color: "#fb923c" };
  return { label: "F", color: "#f87171" };
}

// ── Retention badge ───────────────────────────────────────────────────────────
const RETENTION = {
  returning:       { label: "Returning",       color: "#4ade80" },
  undecided:       { label: "Undecided",       color: "#f5a623" },
  graduating:      { label: "Graduating",      color: "#9ca3af" },
  entering_portal: { label: "Entering Portal", color: "#e05c5c" },
  entering_draft:  { label: "Entering Draft",  color: "#a78bfa" },
  transferred:     { label: "Transferred",     color: "#94a3b8" },
};

function RetentionBadge({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const [hovered, setHovered] = useState(null);
  const btnRef = useRef();
  const dropRef = useRef();
  const { label, color } = RETENTION[value] || RETENTION.returning;

  useEffect(() => {
    if (!open) return;
    const clickHandler = e => {
      const inBadge = btnRef.current?.closest("[data-retention-badge]")?.contains(e.target);
      const inDrop  = dropRef.current?.contains(e.target);
      if (!inBadge && !inDrop) setOpen(false);
    };
    const scrollHandler = () => setOpen(false);
    document.addEventListener("mousedown", clickHandler);
    window.addEventListener("scroll", scrollHandler, true);
    return () => {
      document.removeEventListener("mousedown", clickHandler);
      window.removeEventListener("scroll", scrollHandler, true);
    };
  }, [open]);

  function handleOpen() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen(v => !v);
  }

  return (
    <div data-retention-badge="" style={{ position: "relative", display: "inline-block" }} onClick={e => e.stopPropagation()}>
      <button ref={btnRef} onClick={handleOpen} style={{
        display: "flex", alignItems: "center", gap: 5,
        background: color, border: `1px solid ${color}`,
        borderRadius: 12, padding: "2px 8px 2px 6px", fontSize: 11,
        fontWeight: 600, color: "#0e1521", cursor: "pointer", whiteSpace: "nowrap",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0e152180", flexShrink: 0 }} />
        {label}
      </button>
      {open && createPortal(
        <div ref={dropRef} style={{
          position: "fixed", top: pos.top, right: pos.right, zIndex: 9999,
          background: "#111827", border: "1px solid #374151",
          borderRadius: 8, overflow: "hidden", minWidth: 160,
          boxShadow: "0 8px 24px rgba(0,0,0,.95)",
        }}>
          {Object.entries(RETENTION).map(([key, { label: lbl, color: c }]) => (
            <button key={key}
              onClick={() => { onChange(key); setOpen(false); }}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "7px 12px", fontSize: 12,
                background: hovered === key ? "#2d3748" : value === key ? "#1f2937" : "#111827",
                color: c, cursor: "pointer", border: "none", textAlign: "left",
              }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />
              {lbl}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── NIL input — local state, commits on blur only ────────────────────────────
const NilInput = memo(function NilInput({ value, onCommit }) {
  const [local, setLocal] = useState(value ?? 0);
  useEffect(() => { setLocal(value ?? 0); }, [value]);
  return (
    <div className="offer" onClick={e => e.stopPropagation()}>
      <label>NIL</label>
      <input className="input" type="number" min="0" step="1000"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={e => onCommit(e.target.value)} />
      <span className="muted">{money(Number(local) || 0)}</span>
    </div>
  );
});

// ── Custom players (freshmen / redshirts) ────────────────────────────────────
const CustomPlayersSection = memo(function CustomPlayersSection({ customPlayers, onAdd, onRemove, onNilChange, onNilBlur, activeTeam, userId }) {
  const nameRef = useRef(); const posRef = useRef(); const yearRef = useRef(); const nilRef = useRef();
  return (
    <>
      <div className="section-divider">Freshmen / Redshirts</div>
      {customPlayers.map(p => (
        <div key={p.id} className="row" style={{ opacity: .8 }}>
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
            <div className="row-sub" style={{ fontSize: 11 }}>{p.pos || "—"} · {p.year_label}</div>
            <div className="offer">
              <label>NIL</label>
              <input className="input" type="number" min="0" step="1000"
                value={p.nil_offer || 0}
                onChange={e => onNilChange(p.id, e.target.value)}
                onBlur={e => onNilBlur(p.id, e.target.value)} />
              <span className="muted">{money(p.nil_offer || 0)}</span>
            </div>
          </div>
          <div className="row-actions">
            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => onRemove(p.id)}>Remove</button>
          </div>
        </div>
      ))}
      <div style={{ padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", borderTop: "1px solid var(--border)" }}>
        <input className="input" placeholder="Name" style={{ flex: "1 1 130px", fontSize: 12, padding: "5px 8px" }} ref={nameRef} defaultValue="" />
        <input className="input" placeholder="Pos" style={{ width: 54, fontSize: 12, padding: "5px 8px" }} ref={posRef} defaultValue="" />
        <select className="input" style={{ fontSize: 12, padding: "5px 8px", width: 72 }} ref={yearRef} defaultValue="FR">
          <option value="FR">FR</option><option value="RS FR">RS FR</option>
          <option value="SO">SO</option><option value="RS SO">RS SO</option>
          <option value="JR">JR</option>
        </select>
        <input className="input" placeholder="NIL" type="number" min="0" step="1000" style={{ width: 90, fontSize: 12, padding: "5px 8px" }} ref={nilRef} defaultValue="" />
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={async () => {
          const name = nameRef.current?.value?.trim();
          if (!name) return;
          await onAdd({ name, nil_offer: nilRef.current?.value || 0, pos: posRef.current?.value || "", year_label: yearRef.current?.value || "FR" }, activeTeam, userId);
          nameRef.current.value = ""; nilRef.current.value = ""; posRef.current.value = ""; yearRef.current.value = "FR";
        }}>+ Add</button>
      </div>
    </>
  );
});

// ── View mode table columns ───────────────────────────────────────────────────
const VIEW_COLS = [
  { label: "Name",  get: p => p.name },
  { label: "Type",  get: p => p._type },
  { label: "Pos",   get: p => p.pos || p.primary_position || "—" },
  { label: "Yr",    get: p => p.year || "—" },
  { label: "Ht",    get: p => p.height || "—" },
  { label: "PPG",   get: p => p.stats?.ppg ?? "—" },
  { label: "RPG",   get: p => p.stats?.rpg ?? "—" },
  { label: "APG",   get: p => p.stats?.apg ?? "—" },
  { label: "NIL",   get: p => p.nilOffer ?? 0, isNil: true },
];

const TYPE_COLOR = {
  "Returning":     "rgba(255,255,255,.35)",
  "Undecided":     "#f5a623",
  "Transfer In":   "#5b9cf6",
  "Incoming":      "#34d399",
  "International": "#a78bfa",
  "FR/RS":       "rgba(255,255,255,.25)",
};

// ── Roster Strength breakdown panel ──────────────────────────────────────────
// One algorithm, used identically for static team scores AND the user's live
// score. Within each position group (Guard / Wing / Big):
//   slots [0 .. startersN)               → weight 1.00   (the starters)
//   slots [startersN .. startersN + 3)   → weight 0.20   (next 3 off the bench)
//   everyone deeper                       → weight 0.04   (depth — almost nothing)
//
// International players are excluded from both pools so the comparison is
// strictly between domestic D1 rosters.
//
//   Static lineup = 2 Guards + 2 Wings + 1 Big (always) → every team is
//                   scored on the same yardstick.
//   Live lineup   = whatever you set in the sidebar (starterCounts).
const STATIC_LINEUP = { Guard: 2, Wing: 2, Big: 1 };
const CMP_LEAVING_STATUSES  = new Set(["declared", "transferring", "graduating"]);

function slotWeightFor(slotIndex, startersN) {
  if (slotIndex < startersN)         return 1.00;   // starter
  if (slotIndex < startersN + 3)     return 0.20;   // first 3 off the bench
  return 0.04;                                       // depth
}

// Pick the optimal 5-starter lineup for a team given each position's sorted
// score array. Guarantees ≥1 starter from each position (Guard/Wing/Big) when
// players exist there, then greedily fills the remaining slots with the
// highest unused score from any position. Matches the user-facing
// Auto-optimize button so static team baselines and the user's optimal live
// build use identical lineup logic.
function computeOptimalLineup(scoresByPos) {
  const counts = { Guard: 0, Wing: 0, Big: 0 };
  // 1. Floor: one starter per position when available
  for (const pos of ["Guard", "Wing", "Big"]) {
    if (scoresByPos[pos].length > 0) counts[pos] = 1;
  }
  // 2. Greedy fill up to 5 starters total
  const used = { ...counts };
  let total = counts.Guard + counts.Wing + counts.Big;
  while (total < 5) {
    let bestPos = null;
    let bestScore = -Infinity;
    for (const pos of ["Guard", "Wing", "Big"]) {
      const next = scoresByPos[pos][used[pos]];
      if (next == null) continue;
      if (next > bestScore) { bestScore = next; bestPos = pos; }
    }
    if (!bestPos) break;  // no more players in any bucket
    counts[bestPos]++;
    used[bestPos]++;
    total++;
  }
  return counts;
}

// Position-bucketed, weighted-slot scoring. Same function powers static team
// scores and the user's live score.
//
// `lineup` can be:
//   • { Guard, Wing, Big } object → fixed starter counts per position
//   • "auto" → per-team optimal lineup (used for static team baselines, so
//     every team is scored at its best possible 2-3-5 configuration with
//     ≥1 per position, not jammed into a one-size-fits-all 2-2-1).
function scoreTeamPlayers(players, scorer, lineup) {
  const byPos = { Guard: [], Wing: [], Big: [] };
  for (const p of players) {
    if (!p || p.source === "intl") continue;
    byPos[bucketPosition(p.pos)].push(p);
  }
  const scoresByPos = {
    Guard: byPos.Guard.map(scorer).sort((a, b) => b - a),
    Wing:  byPos.Wing.map(scorer).sort((a, b) => b - a),
    Big:   byPos.Big.map(scorer).sort((a, b) => b - a),
  };
  const resolved = lineup === "auto"
    ? computeOptimalLineup(scoresByPos)
    : lineup;
  const posScores = {};
  let total = 0;
  for (const pos of ["Guard", "Wing", "Big"]) {
    const n = resolved[pos] ?? 0;
    const sorted = scoresByPos[pos];
    let posTotal = 0;
    sorted.forEach((s, i) => { posTotal += s * slotWeightFor(i, n); });
    posScores[pos] = posTotal;
    total += posTotal;
  }
  return { score: total, posScores };
}
const BTP_METRICS = [
  { key: "sei", label: "SEI", desc: "Scoring Efficiency" },
  { key: "ath", label: "ATH", desc: "Athleticism" },
  { key: "ris", label: "RIS", desc: "Rim Impact" },
  { key: "dds", label: "DDS", desc: "Defending" },
  { key: "cdi", label: "CDI", desc: "Playmaking" },
];

// Players with prior-year-only stats (didn't play enough this year but had meaningful
// minutes the year before) get an 80% market discount to reflect the uncertainty.
const CURRENT_STATS_YEAR = 2025;
const MIN_PPG_MEANINGFUL  = 5;
function isPriorYearEval(p) {
  const s = p.stats || {};
  const cy = s.calendar_year || 0;
  return cy > 0 && cy < CURRENT_STATS_YEAR && (s.ppg ?? 0) >= MIN_PPG_MEANINGFUL;
}
function btpPlayerScoreDisplay(p) {
  const s = p.stats || {};
  const sei    = (s.sei || 0) * 15000;
  const ath    = (s.ath || 0) * 5000;
  const ris    = (s.ris || 0) * 4000;
  const dds    = (s.dds || 0) * 4000;
  const cdi    = (s.cdi || 0) * 4000;
  // NB: parens around the boolean OR — without them the `??` binds the wrong side
  // and `_priorYearEval === false` short-circuits to `false`, zeroing market entirely.
  const market = (p.marketHigh || 0) * ((p._priorYearEval || isPriorYearEval(p)) ? 0.8 : 1.0);
  return sei * 0.50 + market * 0.15 + ath * 0.13 + ris * 0.08 + dds * 0.08 + cdi * 0.06;
}

function RosterStrengthPanel({ calc, onOpenModal, allPlayers = [], userTeam = "", customOrder, setCustomOrder, starterCounts, setStarterCounts }) {
  const { scoringPool = [] } = calc;
  // Single toggle drives both the team-comparison list AND all grades on this page.
  const [cmpScope, setCmpScope] = useState("conference");
  const POS_ORDER = ["Guard", "Wing", "Big"];

  // Convert a 1-indexed rank within a pool of N to a percentile (0-100).
  // Rank 1 → 100, rank N → 0. Smooth across the pool.
  function percentileFromRank(rank, total) {
    if (!total || total < 2 || !rank) return 50;
    return ((total - rank) / (total - 1)) * 100;
  }
  function gradeFromPercentile(pct) {
    const label = letterGrade(pct);
    return { label, color: gradeColor(label) };
  }

  // ── Score every team in a pool, including per-position breakdown ─────────────
  // Wraps `scoreTeamPlayers` — groups the global pool by team and applies the
  // same scoring rule to each. Static team scoring passes `"auto"` so every
  // team is scored at its own best 5; the user's live build uses the sidebar
  // counts so they can experiment with non-optimal lineups intentionally.
  function scorePool(pool, scorer, lineup = "auto") {
    const byTeam = {};
    pool.forEach(p => {
      if (!p.team || p.source === "intl") return;
      if (!byTeam[p.team]) byTeam[p.team] = [];
      byTeam[p.team].push(p);
    });
    return Object.entries(byTeam).map(([team, players]) => {
      const conf = getTeamConference(team) ?? players[0]?.conf ?? null;
      const { score, posScores } = scoreTeamPlayers(players, scorer, lineup);
      return { team, conf, score, posScores, playerCount: players.length };
    });
  }

  // Add overall + per-position ranks to a list of teams. Mutates and returns.
  function addRanks(teams) {
    const sortedTotal = [...teams].sort((a, b) => b.score - a.score);
    const totalRank = {};
    sortedTotal.forEach((t, i) => { totalRank[t.team] = i + 1; });
    const posRank = {};
    POS_ORDER.forEach(pos => {
      const sorted = [...teams].sort((a, b) => (b.posScores[pos] || 0) - (a.posScores[pos] || 0));
      posRank[pos] = {};
      sorted.forEach((t, i) => { posRank[pos][t.team] = i + 1; });
    });
    return teams
      .map(t => ({
        ...t,
        rank: totalRank[t.team],
        posRank: Object.fromEntries(POS_ORDER.map(pos => [pos, posRank[pos][t.team]])),
      }))
      .sort((a, b) => a.rank - b.rank);
  }

  // ── National team scores (absolute metrics) ──────────────────────────────────
  // A player counts toward their COMMITTED destination if they've committed;
  // otherwise toward their current_team unless they're explicitly leaving.
  // Committed transfers override the leaving-status filter (they're "leaving"
  // their old school but going somewhere we should credit).
  const teamScores = useMemo(() => {
    if (!allPlayers.length) return [];
    const pool = allPlayers.filter(p => {
      if (!p.team) return false;
      if (p._committed_to) return true;
      return !CMP_LEAVING_STATUSES.has(p.player_status);
    });
    return addRanks(scorePool(pool, btpPlayerScoreDisplay));
  }, [allPlayers]);

  const userConf = useMemo(() => getTeamConference(userTeam) ?? teamScores.find(t => t.team === userTeam)?.conf ?? null, [teamScores, userTeam]);

  // ── Conference team scores ────────────────────────────────────────────────
  // Same scorer as national, just filtered to the conference pool. Committed
  // players are evaluated against their NEW team's conference (so a commit
  // crossing conferences moves to the new conference here too).
  const confTeamScores = useMemo(() => {
    if (!allPlayers.length || !userConf) return [];
    const confPool = allPlayers.filter(p => {
      if (!p.team) return false;
      const playerConf = getTeamConference(p.team) ?? p.conf;
      if (playerConf !== userConf) return false;
      if (p._committed_to) return true;
      return !CMP_LEAVING_STATUSES.has(p.player_status);
    });
    if (confPool.length < 2) return [];
    return addRanks(scorePool(confPool, btpPlayerScoreDisplay));
  }, [allPlayers, userConf]);
  // Depth chart state — owned by AppPage, passed in as props so it survives view switches

  // Plain variables (no memoization) — scoringPool is ≤20 players, compute is trivial,
  // and avoiding useMemo ensures these always reflect the latest scoringPool on every render.
  // International players are excluded from the strength chart since they're
  // also excluded from scoring. They still appear in the Roster tab.
  const defaultChart = (() => {
    const groups = { Guard: [], Wing: [], Big: [] };
    scoringPool.forEach(p => {
      if (p?.source === "intl") return;
      const pos = bucketPosition(p.pos);
      groups[pos].push(p);
    });
    POS_ORDER.forEach(pos => groups[pos].sort((a, b) => btpPlayerScoreDisplay(b) - btpPlayerScoreDisplay(a)));
    return groups;
  })();

  const chart = (() => {
    if (!customOrder) return defaultChart;
    const result = {};
    POS_ORDER.forEach(pos => {
      const poolMap = Object.fromEntries(defaultChart[pos].map(p => [p.id, p]));
      const ordered = (customOrder[pos] || []).map(id => poolMap[id]).filter(Boolean);
      const remaining = defaultChart[pos].filter(p => !(customOrder[pos] || []).includes(p.id));
      result[pos] = [...ordered, ...remaining];
    });
    return result;
  })();

  // ── Live chart: per-position score + total ─────────────────────────────────
  // Identical algorithm to static. Uses chart order so a manual drag promotes
  // a player into the starting lineup (slot weight 1.0), demotes another to
  // bench (0.20 if top-3, else 0.04). Intl excluded.
  function computeLive(scorer) {
    const posScores = {};
    let total = 0;
    POS_ORDER.forEach(pos => {
      const n = starterCounts[pos] ?? 0;
      const players = (chart[pos] || []).filter(p => p?.source !== "intl");
      let s = 0;
      players.forEach((p, i) => { s += scorer(p) * slotWeightFor(i, n); });
      posScores[pos] = s;
      total += s;
    });
    return { score: total, posScores };
  }

  const liveNational = computeLive(btpPlayerScoreDisplay);
  // Conference scoring now uses the same raw formula, so the user's live score
  // is identical between scopes — only the pool / rank differs.
  const liveConf = liveNational;

  // Replace user's static entry with their live-built score, then re-rank both total & each position.
  function injectAndRank(list, live, team, conf, count) {
    if (!list.length || !team) return list;
    const existing = list.find(t => t.team === team);
    const entry = {
      ...(existing ?? { team, conf, playerCount: count }),
      score:     live.score,
      posScores: { ...(existing?.posScores ?? {}), ...live.posScores },
    };
    const others = list.filter(t => t.team !== team);
    const all    = [...others, entry];

    const totalRank = {};
    [...all].sort((a, b) => b.score - a.score).forEach((t, i) => { totalRank[t.team] = i + 1; });
    const posRank = {};
    POS_ORDER.forEach(pos => {
      posRank[pos] = {};
      [...all].sort((a, b) => (b.posScores?.[pos] || 0) - (a.posScores?.[pos] || 0))
              .forEach((t, i) => { posRank[pos][t.team] = i + 1; });
    });

    return all
      .map(t => ({
        ...t,
        rank: totalRank[t.team],
        posRank: Object.fromEntries(POS_ORDER.map(pos => [pos, posRank[pos][t.team]])),
      }))
      .sort((a, b) => a.rank - b.rank);
  }

  const liveTeamScores     = injectAndRank(teamScores,     liveNational, userTeam, userConf, scoringPool.length);
  const liveConfTeamScores = injectAndRank(confTeamScores, liveConf,     userTeam, userConf, scoringPool.length);

  // Backwards-compat shim — the comparison-list code below still reads `chartScore`.
  const chartScore = liveNational.score;

  if (!scoringPool.length) {
    return <div className="empty" style={{ marginTop: 24 }}>Add players to your roster to see the strength breakdown.</div>;
  }

  function slotBadge(pos, i) {
    const sc = starterCounts[pos] ?? 0;
    if (i < sc) return { label: "S", bg: "rgba(251,191,36,.2)", border: "rgba(251,191,36,.45)", color: "#fbbf24" };
    return { label: String(i - sc + 1), bg: "rgba(255,255,255,.05)", border: "rgba(255,255,255,.08)", color: "rgba(255,255,255,.35)" };
  }

  function slotLabel(pos, i) {
    const sc = starterCounts[pos] ?? 0;
    if (i < sc) return "Starter";
    const bench = i - sc;
    return bench === 0 ? "1st off bench" : bench === 1 ? "2nd off bench" : `#${bench + 1}`;
  }

  function movePlayer(pos, fromIdx, dir) {
    const toIdx = fromIdx + dir;
    if (toIdx < 0 || toIdx >= chart[pos].length) return;
    setCustomOrder(prev => {
      const base = prev ?? Object.fromEntries(POS_ORDER.map(p => [p, chart[p].map(pl => pl.id)]));
      const ids = [...(base[pos] || chart[pos].map(pl => pl.id))];
      [ids[fromIdx], ids[toIdx]] = [ids[toIdx], ids[fromIdx]];
      return { ...base, [pos]: ids };
    });
  }

  // ── Active scope drives every grade on this panel ───────────────────────────
  const activeList   = cmpScope === "conference" ? liveConfTeamScores : liveTeamScores;
  const userEntry    = activeList.find(t => t.team === userTeam);
  const activeTotal  = activeList.length;
  const userTotalPct = userEntry ? percentileFromRank(userEntry.rank, activeTotal) : 50;
  const chartGrade   = gradeFromPercentile(userTotalPct);

  // For each position, percentile within active scope (if the user has scores there)
  const chartPosScores = liveNational.posScores; // raw scores for the depth-chart bar fill (national basis)
  const posPercentiles = Object.fromEntries(POS_ORDER.map(pos => {
    const userPosRank = userEntry?.posRank?.[pos];
    return [pos, userPosRank ? percentileFromRank(userPosRank, activeTotal) : 50];
  }));
  const posGrades = Object.fromEntries(POS_ORDER.map(pos => [pos, gradeFromPercentile(posPercentiles[pos])]));

  const maxPosScore    = Math.max(...Object.values(chartPosScores), 1);
  const maxPlayerScore = Math.max(...scoringPool.map(btpPlayerScoreDisplay), 1);
  const posCount       = POS_ORDER.filter(pos => (chart[pos] || []).length > 0).length;

  return (
    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Overall header */}
      <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 20px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4 }}>Overall Roster Strength</span>
            <div style={{ display: "flex", gap: 4 }}>
              {[["conference", "Conference"], ["all", "Country"]].map(([val, lbl]) => (
                <button key={val} onClick={() => setCmpScope(val)} style={{
                  fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 12, cursor: "pointer",
                  border: "1px solid",
                  background:  cmpScope === val ? "rgba(91,156,246,.18)" : "transparent",
                  color:       cmpScope === val ? "#5b9cf6" : "rgba(255,255,255,.4)",
                  borderColor: cmpScope === val ? "rgba(91,156,246,.5)"  : "rgba(255,255,255,.12)",
                }}>{lbl}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ background: chartGrade.color, color: "#0e1521", fontWeight: 800, fontSize: 28, padding: "4px 18px", borderRadius: 12 }}>{chartGrade.label}</span>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {Math.round(userTotalPct)}<span style={{ fontSize: 12, opacity: .45, fontWeight: 400 }}> percentile · vs {cmpScope === "conference" ? (userConf || "conference") : "country"}</span>
              </div>
              <div style={{ fontSize: 12, opacity: .4 }}>
                {userEntry ? `#${userEntry.rank} of ${activeTotal}` : `${activeTotal} teams in pool`} · {(chartScore / 1000000).toFixed(2)}M raw
              </div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 240, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {POS_ORDER.filter(pos => (chart[pos] || []).length > 0).map(pos => {
            const fillPct = (chartPosScores[pos] / maxPosScore) * 100;
            const pg      = posGrades[pos];
            const posPct  = posPercentiles[pos];
            return (
              <div key={pos} style={{ flex: "1 1 100px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, opacity: .55 }}>{pos}s</span>
                  <span style={{ background: pg.color, color: "#0e1521", fontWeight: 700, fontSize: 10, padding: "1px 7px", borderRadius: 8 }}>{pg.label}</span>
                </div>
                <div style={{ height: 6, background: "rgba(255,255,255,.08)", borderRadius: 3 }}>
                  <div style={{ width: `${fillPct}%`, height: "100%", background: pg.color, borderRadius: 3, opacity: .8 }} />
                </div>
                <div style={{ fontSize: 11, opacity: .35, marginTop: 3 }}>
                  {Math.round(posPct)} pct · {(chart[pos] || []).length} players
                </div>
              </div>
            );
          })}
        </div>
        {customOrder && (
          <button onClick={() => setCustomOrder(null)} style={{ fontSize: 11, opacity: .5, background: "none", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", color: "inherit", whiteSpace: "nowrap" }}>
            Reset to auto
          </button>
        )}
      </div>

      {/* 3-column depth chart + settings sidebar */}
      <div style={{ display: "flex", gap: 12, alignItems: "start" }}>

        {/* Depth chart columns */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, alignItems: "start" }}>
          {POS_ORDER.map(pos => {
            const players = chart[pos] || [];
            const pg      = posGrades[pos];
            const posPct  = posPercentiles[pos];
            return (
              <div key={pos} style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                {/* Column header */}
                <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{pos}s</span>
                  <span style={{ fontSize: 11, opacity: .35 }}>{players.length}</span>
                  <span style={{ marginLeft: "auto", background: pg.color, color: "#0e1521", fontWeight: 700, fontSize: 10, padding: "1px 7px", borderRadius: 8 }}>{pg.label}</span>
                  <span style={{ fontSize: 12, opacity: .45 }} title={`${(chartPosScores[pos] / 1000000).toFixed(2)}M raw`}>{Math.round(posPct)}p</span>
                </div>

                {players.length === 0 ? (
                  <div style={{ padding: "20px 14px", fontSize: 12, opacity: .3, textAlign: "center" }}>No players</div>
                ) : players.map((p, i) => {
                  const score        = btpPlayerScoreDisplay(p);
                  const weight       = slotWeightFor(i, starterCounts[pos] ?? 0);
                  const contribution = score * weight;
                  const barPct       = (score / maxPlayerScore) * 100;
                  const s            = p.stats || {};
                  const isStarter    = i < (starterCounts[pos] ?? 0);
                  const badge        = slotBadge(pos, i);

                  return (
                    <div key={p.id} style={{
                      display: "flex", alignItems: "center", gap: 7,
                      padding: "8px 10px",
                      borderBottom: i < players.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none",
                      background: isStarter ? "rgba(251,191,36,.03)" : "transparent",
                    }}>
                      {/* Up / down arrows */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
                        <button onClick={() => movePlayer(pos, i, -1)} disabled={i === 0}
                          style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer", padding: "1px 4px", lineHeight: 1, fontSize: 9, color: i === 0 ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.45)" }}>▲</button>
                        <button onClick={() => movePlayer(pos, i, 1)} disabled={i === players.length - 1}
                          style={{ background: "none", border: "none", cursor: i === players.length - 1 ? "default" : "pointer", padding: "1px 4px", lineHeight: 1, fontSize: 9, color: i === players.length - 1 ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.45)" }}>▼</button>
                      </div>

                      {/* Slot badge */}
                      <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color }}>
                        {badge.label}
                      </div>

                      {/* Player info */}
                      <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onOpenModal && onOpenModal(p)}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                          {p._priorYearEval && <span title="Prior year stats" style={{ fontSize: 9, fontWeight: 700, color: "#f5a623", background: "rgba(245,166,35,.12)", border: "1px solid rgba(245,166,35,.35)", borderRadius: 4, padding: "0 3px", flexShrink: 0 }}>PY</span>}
                        </div>
                        <div style={{ fontSize: 10, opacity: .38, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {p.year} · {slotLabel(pos, i)}
                        </div>
                        {/* Metric colour dots */}
                        <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                          {BTP_METRICS.map(({ key, label }) => {
                            const val = s[key];
                            const color = val == null ? "rgba(255,255,255,.12)" : val >= 70 ? "#4ade80" : val >= 50 ? "#fcd34d" : "#f87171";
                            return <div key={key} title={`${label}: ${val != null ? Math.round(val) : "—"}`} style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />;
                          })}
                        </div>
                      </div>

                      {/* Contribution + score bar */}
                      <div style={{ flexShrink: 0, textAlign: "right", minWidth: 36 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, opacity: .7 }}>{(contribution / 1000).toFixed(0)}k</div>
                        <div style={{ fontSize: 9, opacity: .28 }}>×{weight.toFixed(2)}</div>
                        <div style={{ width: 36, height: 3, background: "rgba(255,255,255,.07)", borderRadius: 2, marginTop: 3 }}>
                          <div style={{ width: `${barPct}%`, height: "100%", background: isStarter ? "#fbbf24" : "#6b7280", borderRadius: 2 }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Settings sidebar */}
        <div style={{ width: 156, flexShrink: 0, background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", opacity: .4, marginBottom: 14 }}>Starter Slots</div>
          {POS_ORDER.map(pos => {
            const count   = starterCounts[pos] ?? 0;
            const maxSlot = (chart[pos] || []).length;
            return (
              <div key={pos} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, opacity: .55, marginBottom: 6 }}>{pos}s</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={() => setStarterCounts(prev => ({ ...prev, [pos]: Math.max(0, count - 1) }))}
                    disabled={count === 0}
                    style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,.12)", background: "none", cursor: count === 0 ? "default" : "pointer", color: count === 0 ? "rgba(255,255,255,.2)" : "inherit", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                  <span style={{ fontSize: 18, fontWeight: 700, minWidth: 22, textAlign: "center", color: count > 0 ? "#fbbf24" : "rgba(255,255,255,.25)" }}>{count}</span>
                  <button
                    onClick={() => setStarterCounts(prev => ({ ...prev, [pos]: Math.min(maxSlot, count + 1) }))}
                    disabled={count >= maxSlot}
                    style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,.12)", background: "none", cursor: count >= maxSlot ? "default" : "pointer", color: count >= maxSlot ? "rgba(255,255,255,.2)" : "inherit", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                </div>
              </div>
            );
          })}
          <div style={{ borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: 10 }}>
            {(() => {
              const total = POS_ORDER.reduce((s, pos) => s + (starterCounts[pos] ?? 0), 0);
              return (
                <>
                  <div style={{ fontSize: 12, opacity: .4 }}>{total} starter{total !== 1 ? "s" : ""}</div>
                  {total !== 5 && (
                    <div style={{ fontSize: 10, color: "#fbbf24", marginTop: 4, opacity: .8 }}>standard is 5</div>
                  )}
                  <button
                    title="Picks the top 5 players by score with at least one Guard, Wing, and Big."
                    onClick={() => {
                      // Auto-optimize the starting 5:
                      //   1) guarantee one starter from each position (highest-scoring there)
                      //   2) fill the remaining 2 slots with the next-highest scorers
                      //      across any position
                      const topByPos = {};
                      POS_ORDER.forEach(pos => {
                        topByPos[pos] = (chart[pos] || [])
                          .filter(p => p?.source !== "intl")
                          .slice()
                          .sort((a, b) => btpPlayerScoreDisplay(b) - btpPlayerScoreDisplay(a));
                      });
                      const next = { Guard: 0, Wing: 0, Big: 0 };
                      // Step 1: one starter per position (if available).
                      POS_ORDER.forEach(pos => {
                        if (topByPos[pos].length > 0) next[pos] = 1;
                      });
                      // Step 2: greedy fill the remaining slots up to 5.
                      const used = { Guard: next.Guard, Wing: next.Wing, Big: next.Big };
                      while (next.Guard + next.Wing + next.Big < 5) {
                        // Candidate from each position = the player at `used[pos]` index.
                        let bestPos = null, bestScore = -Infinity;
                        POS_ORDER.forEach(pos => {
                          const idx = used[pos];
                          const p   = topByPos[pos][idx];
                          if (!p) return;
                          const s = btpPlayerScoreDisplay(p);
                          if (s > bestScore) { bestScore = s; bestPos = pos; }
                        });
                        if (!bestPos) break;  // no more players in any position
                        next[bestPos] += 1;
                        used[bestPos] += 1;
                      }
                      setStarterCounts(next);
                    }}
                    style={{
                      marginTop: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", width: "100%",
                      padding: "6px 8px", borderRadius: 6,
                      background: "rgba(91,156,246,.12)", color: "#5b9cf6",
                      border: "1px solid rgba(91,156,246,.4)",
                    }}>
                    ⚡ Auto-optimize
                  </button>
                  {total !== 5 && (
                    <button onClick={() => setStarterCounts({ Guard: 2, Wing: 2, Big: 1 })}
                      style={{ marginTop: 6, fontSize: 10, opacity: .45, background: "none", border: "1px solid rgba(255,255,255,.1)", borderRadius: 6, padding: "3px 8px", cursor: "pointer", color: "inherit" }}>Reset to 2-2-1</button>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── Conference / League comparison ─────────────────────────────────── */}
      {teamScores.length > 0 && (() => {
        // List shows STATIC scores for every team (with commits already reassigned
        // to their destination in loadPortalBoard). The user's own custom build
        // gets a separate "Your build" row above the list so their live score
        // can be seen alongside, without making the same team's score look
        // different depending on which team is currently selected.
        const baseList = cmpScope === "conference" ? confTeamScores : teamScores;
        const displayList = cmpScope === "conference" ? baseList : (() => {
          const userIdx = baseList.findIndex(t => t.team === userTeam);
          if (userIdx === -1 || userIdx <= 24) return baseList.slice(0, 25);
          return [...baseList.slice(0, 5), null, ...baseList.slice(userIdx - 2, userIdx + 3)];
        })();
        const maxScore = Math.max(
          liveNational.score,
          ...displayList.filter(Boolean).map(t => t.score),
          1,
        );

        // Where the user's LIVE build would slot in (uses the live-injected list).
        const userLiveRankAll  = liveTeamScores.findIndex(t => t.team === userTeam) + 1;
        const userLiveRankConf = liveConfTeamScores.findIndex(t => t.team === userTeam) + 1;

        return (
          <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Team Comparison</span>
              {userConf && (
                <span style={{ fontSize: 12, opacity: .4 }}>{userConf}</span>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                {[["conference", "Conference"], ["all", "Country"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setCmpScope(val)} style={{
                    fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 14, cursor: "pointer",
                    border: "1px solid",
                    background:   cmpScope === val ? "rgba(91,156,246,.18)" : "transparent",
                    color:        cmpScope === val ? "#5b9cf6" : "rgba(255,255,255,.4)",
                    borderColor:  cmpScope === val ? "rgba(91,156,246,.5)"  : "rgba(255,255,255,.12)",
                  }}>{lbl}</button>
                ))}
              </div>
              <div style={{ width: "100%", fontSize: 11, opacity: .35 }}>
                {cmpScope === "conference"
                  ? `${confTeamScores.length} teams · static scores (transfer commits credited to destination)`
                  : `${teamScores.length} teams · static scores (transfer commits credited to destination)`}
              </div>
            </div>

            {/* Ranked list */}
            <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
              {/* "Your build" row — uses the user's LIVE score so they can see
                  where their custom roster would slot in vs the static league. */}
              {userTeam && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 8px", borderRadius: 6,
                  background: "rgba(245,158,11,.10)",
                  border: "1px solid rgba(245,158,11,.30)",
                }}>
                  <span style={{ width: 22, fontSize: 11, opacity: .55, textAlign: "right", flexShrink: 0, color: "#f59e0b" }}>
                    ▶
                  </span>
                  <span style={{ minWidth: 0, flex: "0 0 auto", maxWidth: 200, fontSize: 13, fontWeight: 700, color: "#f59e0b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Your {userTeam} build
                  </span>
                  <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,.07)", borderRadius: 3, minWidth: 40 }}>
                    <div style={{ width: `${(liveNational.score / maxScore) * 100}%`, height: "100%", background: "#f59e0b", borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, opacity: .85, flexShrink: 0, fontVariantNumeric: "tabular-nums", color: "#f59e0b" }}>
                    {(liveNational.score / 1000000).toFixed(2)}M
                  </span>
                  <span style={{ background: chartGrade.color, color: "#0e1521", fontWeight: 700, fontSize: 10, padding: "1px 6px", borderRadius: 6, flexShrink: 0 }}>
                    {chartGrade.label}
                  </span>
                </div>
              )}
              {userTeam && (
                <div style={{ fontSize: 10, opacity: .4, marginBottom: 6, marginLeft: 32 }}>
                  Would rank #{userLiveRankAll} nationally{userConf ? ` · #${userLiveRankConf} in ${userConf}` : ""}
                </div>
              )}
              {displayList.map((t, idx) => {
                if (!t) return (
                  <div key={`sep-${idx}`} style={{ textAlign: "center", fontSize: 11, opacity: .25, padding: "2px 0" }}>· · ·</div>
                );
                const isUser = t.team === userTeam;
                const barPct = (t.score / maxScore) * 100;
                const tPct   = percentileFromRank(t.rank, activeTotal);
                const tg     = gradeFromPercentile(tPct);
                return (
                  <div key={t.team} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "6px 8px", borderRadius: 6,
                    background: isUser ? "rgba(91,156,246,.08)" : "transparent",
                    border: isUser ? "1px solid rgba(91,156,246,.2)" : "1px solid transparent",
                  }}>
                    <span style={{ width: 22, fontSize: 11, opacity: .4, textAlign: "right", flexShrink: 0 }}>
                      {t.rank}
                    </span>
                    <span style={{ minWidth: 0, flex: "0 0 auto", maxWidth: 180, fontSize: 13, fontWeight: isUser ? 700 : 400, color: isUser ? "#5b9cf6" : "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {isUser ? `▶ ${t.team}` : t.team}
                    </span>
                    <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,.07)", borderRadius: 3, minWidth: 40 }}>
                      <div style={{ width: `${barPct}%`, height: "100%", background: isUser ? "#5b9cf6" : tg.color, borderRadius: 3, opacity: isUser ? 1 : .65 }} />
                    </div>
                    <span style={{ fontSize: 11, opacity: .55, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                      {(t.score / 1000000).toFixed(2)}M
                    </span>
                    <span style={{ background: tg.color, color: "#0e1521", fontWeight: 700, fontSize: 10, padding: "1px 6px", borderRadius: 6, flexShrink: 0 }}>
                      {tg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function WomensAppPage() {
  const { profile, user } = useAuth();
  const userId = user?.id || "";
  const { isAdmin, isNonAffiliate, activeTeam, selectedTeam, setSelectedTeam, allTeams } = useAdminTeam(profile);
  const board = useRosterBoard(activeTeam, userId);

  const [viewMode,      setViewMode]      = useState("build");
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [search,        setSearch]        = useState("");
  const [posFilter,     setPosFilter]     = useState([]);
  const [yearFilter,    setYearFilter]    = useState([]);
  const [heightMin,     setHeightMin]     = useState(null);
  const [heightMax,     setHeightMax]     = useState(null);
  const [portalOnly,    setPortalOnly]    = useState(true);
  const [availableIds,  setAvailableIds]  = useState(new Set());
  const [boardMode,     setBoardMode]     = useState("domestic"); // "domestic" | "international"
  const [intlBoard,     setIntlBoard]     = useState(null);       // null until loaded
  const [modal,           setModal]           = useState(null);
  const [settings,        setSettings]        = useState(null);
  const [finderOpen,      setFinderOpen]      = useState(false);
  const [replacingPlayer, setReplacingPlayer] = useState(null);
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [myRosters,     setMyRosters]     = useState([]);
  const [teamRosters,   setTeamRosters]   = useState([]);
  const [coaches,       setCoaches]       = useState({});
  const [loadingDrawer, setLoadingDrawer] = useState(false);
  const [saveName,      setSaveName]      = useState("");
  const [saving,        setSaving]        = useState(false);
  const [sortKey,       setSortKey]       = useState(null);
  const [sortDir,       setSortDir]       = useState("asc");

  // Depth chart state — lifted here so it survives view switches
  const [depthChartOrder,  setDepthChartOrder]  = useState(null);
  const [depthStarterCounts, setDepthStarterCounts] = useState({ Guard: 2, Wing: 2, Big: 1 });

  const handleCustomNilChange = useCallback((id, val) => board.updateCustomPlayerNil(id, val), [board.updateCustomPlayerNil]);
  const handleCustomNilBlur   = useCallback((id, val) => board.persistCustomPlayerNil(id, val), [board.persistCustomPlayerNil]);
  const handleCustomRemove    = useCallback((id) => board.removeCustomPlayer(id), [board.removeCustomPlayer]);

  useEffect(() => {
    if (!sessionStorage.getItem("btp_pv_app")) {
      sessionStorage.setItem("btp_pv_app", "1");
      track("page_view", { page: "app" });
    }
  }, []);

  useEffect(() => {
    const fetches = [board.loadPortalBoard()];
    if (activeTeam) fetches.push(board.loadReturningRoster(activeTeam));
    if (activeTeam && userId) fetches.push(board.loadCustomPlayers(activeTeam, userId));
    Promise.all(fetches);
  }, [activeTeam, userId]);

  useEffect(() => {
    supabase.from("w_portal_transfers").select("player_id, status")
      .eq("season_year", 2026).neq("status", "withdrawn").not("player_id", "is", null)
      .then(({ data }) => {
        const uncommitted = new Set();
        (data || []).forEach(r => { if (r.status === "uncommitted") uncommitted.add(r.player_id); });
        setAvailableIds(uncommitted);
      });
  }, []);

  useEffect(() => { setSettings(board.state.settings); }, [board.state.settings]);

  function handleOpenModal(p) {
    track("player_modal_opened", { player_id: p.id, player_name: p.name, team: p.team, pos: p.pos });
    setModal(p);
  }

  // Lazy-load the international board the first time the user switches to it.
  useEffect(() => {
    if (boardMode !== "international" || intlBoard !== null) return;
    let alive = true;
    (async () => {
      const all = [];
      let page = 0;
      while (true) {
        const { data, error } = await supabase
          .from("w_international_players")
          .select("*")
          .range(page * 1000, (page + 1) * 1000 - 1);
        if (error) { console.error("intl board fetch:", error); break; }
        all.push(...(data || []));
        if ((data || []).length < 1000) break;
        page++;
      }
      if (!alive) return;
      setIntlBoard(all);
    })();
    return () => { alive = false; };
  }, [boardMode, intlBoard]);

  // Filtered international list — applies the same search/pos/year/height filters.
  const filteredIntl = useMemo(() => {
    if (!intlBoard) return [];
    const q = search.trim().toLowerCase();
    return intlBoard.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.league || "").toLowerCase().includes(q)) return false;
      if (posFilter.length) {
        const raw = String(p.primary_position || "").toUpperCase();
        const bucket = raw.includes("G") ? "Guard" : raw === "C" || raw === "PF" ? "Big" : "Wing";
        if (!posFilter.includes(bucket)) return false;
      }
      if (heightMin != null || heightMax != null) {
        const inches = playerHeightInches(p.height);
        if (inches == null) return false;
        if (heightMin != null && inches < heightMin) return false;
        if (heightMax != null && inches > heightMax) return false;
      }
      // yearFilter doesn't apply cleanly to intl players (they're "Intl" / classes)
      return true;
    }).sort((a, b) => (b.metrics?.translation_grade ?? 0) - (a.metrics?.translation_grade ?? 0));
  }, [intlBoard, search, posFilter, heightMin, heightMax]);

  // ── Board filter ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return board.state.board
      .filter(p => {
        if (portalOnly && !availableIds.has(p.id)) return false;
        if (q && !p.name.toLowerCase().includes(q) && !(p.team || "").toLowerCase().includes(q)) return false;
        if (posFilter.length  && !posFilter.includes(p.pos))   return false;
        if (yearFilter.length && !yearFilter.includes(p.year)) return false;
        if (heightMin != null || heightMax != null) {
          const inches = playerHeightInches(p.height);
          if (inches == null) return false;
          if (heightMin != null && inches < heightMin) return false;
          if (heightMax != null && inches > heightMax) return false;
        }
        return true;
      })
      .sort((a, b) => (b.marketHigh || 0) - (a.marketHigh || 0));
  }, [board.state.board, search, posFilter, yearFilter, heightMin, heightMax, portalOnly, availableIds]);

  // ── View mode: combined roster table ─────────────────────────────────────
  const rosterPlayers = useMemo(() => {
    const retentionById = board.state.retentionById || {};
    const nilById       = board.state.nilById       || {};
    const rosteredIds   = new Set(board.state.roster.map(e => e.id));
    const LEAVING       = new Set(["entering_portal", "entering_draft", "transferred", "graduating"]);

    // Incoming transfers are auto-added to state.roster on load (see useRosterBoard).
    // We still tag those entries as "Incoming" in the table so the user sees the distinction.
    const incomingIdSet = new Set(board.incomingTransfers.map(p => p.id));

    const transfers = board.state.roster
      .map(entry => {
        const p = board.byId(entry.id); if (!p) return null;
        const isIncoming = incomingIdSet.has(entry.id);
        const isIntl     = entry.source === "intl" || p.source === "intl";
        return {
          ...p,
          _type:    isIntl ? "International" : isIncoming ? "Incoming" : "Transfer In",
          _typeKey: isIntl ? "intl"          : isIncoming ? "incoming" : "transfer",
          nilOffer: entry.nilOffer,
        };
      })
      .filter(Boolean);

    const returning = board.returningPlayers
      .filter(p => (retentionById[p.id] || "returning") === "returning")
      .map(p => ({ ...p, _type: "Returning", _typeKey: "returning", nilOffer: nilById[p.id] || 0 }));

    const undecided = board.returningPlayers
      .filter(p => retentionById[p.id] === "undecided")
      .map(p => ({ ...p, _type: "Undecided", _typeKey: "undecided", nilOffer: nilById[p.id] || 0 }));

    const leaving = board.returningPlayers
      .filter(p => LEAVING.has(retentionById[p.id]))
      .map(p => ({ ...p, _type: RETENTION[retentionById[p.id]]?.label || retentionById[p.id], _typeKey: retentionById[p.id], nilOffer: nilById[p.id] || 0 }));

    const custom = board.customPlayers.map(p => ({
      id: p.id, name: p.name, pos: p.pos || "—", year: p.year_label,
      nilOffer: p.nil_offer || 0, _type: "FR/RS", _typeKey: "custom", stats: {},
    }));

    return [...transfers, ...returning, ...undecided, ...leaving, ...custom];
  }, [board.returningPlayers, board.incomingTransfers, board.state.board, board.state.roster, board.state.retentionById, board.state.nilById, board.customPlayers]);

  const sortedView = useMemo(() => {
    if (!sortKey) return rosterPlayers;
    const col = VIEW_COLS.find(c => c.label === sortKey);
    if (!col) return rosterPlayers;
    return [...rosterPlayers].sort((a, b) => {
      const av = col.get(a), bv = col.get(b);
      const an = parseFloat(String(av).replace(/[$,—]/g, ""));
      const bn = parseFloat(String(bv).replace(/[$,—]/g, ""));
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn
        : String(av === "—" ? "zzz" : av).localeCompare(String(bv === "—" ? "zzz" : bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rosterPlayers, sortKey, sortDir]);

  function handleSort(label) {
    setSortDir(prev => sortKey === label && prev === "asc" ? "desc" : "asc");
    setSortKey(label);
  }

  const calc = board.calc;

  const NIL_BY_LEVEL = { "High Major": 10_000_000, "Mid Major": 3_000_000, "Low Major": 1_500_000 };

  async function handleSettingChange(key, value) {
    let next = { ...board.state.settings, [key]: key === "program" ? value : Number(value) };
    if (key === "program" && value) {
      const { data } = await supabase.from("teams").select("level").eq("name", value).maybeSingle();
      if (data?.level && NIL_BY_LEVEL[data.level]) next = { ...next, nilTotal: NIL_BY_LEVEL[data.level] };
    }
    board.commitSettings(next);
    setSettings(next);
  }

  // ── Saved rosters ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!drawerOpen || !activeTeam) return;
    setLoadingDrawer(true);
    Promise.all([
      supabase.from("w_saved_rosters").select("id, name, created_at, user_id, nil_budget, roster_size, nil_max_pct").eq("team", activeTeam).order("created_at", { ascending: false }),
      supabase.from("coaches").select("user_id, display_name").eq("team", activeTeam),
    ]).then(([{ data: rosters }, { data: coachRows }]) => {
      const coachMap = {};
      (coachRows || []).forEach(c => { coachMap[c.user_id] = c.display_name || "Coach"; });
      setCoaches(coachMap);
      const all = rosters || [];
      setMyRosters(all.filter(r => r.user_id === userId));
      setTeamRosters(all.filter(r => r.user_id !== userId));
      setLoadingDrawer(false);
    });
  }, [drawerOpen, activeTeam, userId]);

  async function handleSaveRoster() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const { data: row, error: rErr } = await supabase
        .from("w_saved_rosters")
        .insert({ name: saveName.trim(), team: activeTeam, user_id: userId, nil_budget: board.state.settings.nilTotal, roster_size: board.state.settings.scholarships, nil_max_pct: board.state.settings.maxPct })
        .select("id").single();
      if (rErr) throw rErr;

      const { retentionById = {}, nilById = {}, statusById = {}, shortlistIds = [] } = board.state;
      const returning = board.returningPlayers.map(p => ({ roster_id: row.id, player_id: p.id, player_type: retentionById[p.id] || "returning", nil_offer: nilById[p.id] || 0, status: statusById[p.id] || null, shortlisted: shortlistIds.includes(p.id) }));
      const transfers = board.state.roster.map(e => ({ roster_id: row.id, player_id: e.id, player_type: "transfer", nil_offer: e.nilOffer || 0, status: statusById[e.id] || null, shortlisted: shortlistIds.includes(e.id) }));
      const rosteredIds = new Set(board.state.roster.map(e => e.id));
      const shortlistedOnly = shortlistIds.filter(id => !rosteredIds.has(id)).map(id => ({ roster_id: row.id, player_id: id, player_type: "shortlisted", nil_offer: 0, status: statusById[id] || null, shortlisted: true }));

      const { error: pErr } = await supabase.from("saved_roster_players").insert([...returning, ...transfers, ...shortlistedOnly]);
      if (pErr) throw pErr;

      setMyRosters(prev => [{ id: row.id, name: saveName.trim(), created_at: new Date().toISOString(), user_id: userId }, ...prev]);
      setSaveName("");
    } catch (e) { alert("Save failed: " + e.message); }
    setSaving(false);
  }

  async function handleDeleteRoster(rosterId) {
    if (!confirm("Delete this saved roster?")) return;
    await supabase.from("w_saved_rosters").delete().eq("id", rosterId);
    setMyRosters(prev => prev.filter(r => r.id !== rosterId));
  }

  async function handleLoadRoster(rosterId) {
    const rosterMeta = [...myRosters, ...teamRosters].find(r => r.id === rosterId);
    const { data, error } = await supabase.from("saved_roster_players")
      .select("player_type, nil_offer, status, shortlisted, players(*, player_stats(*))").eq("roster_id", rosterId);
    if (error) { alert("Load failed: " + error.message); return; }

    if (rosterMeta?.nil_budget || rosterMeta?.roster_size) {
      board.commitSettings({ ...board.state.settings, ...(rosterMeta.nil_budget ? { nilTotal: rosterMeta.nil_budget } : {}), ...(rosterMeta.roster_size ? { scholarships: rosterMeta.roster_size } : {}), ...(rosterMeta.nil_max_pct ? { maxPct: rosterMeta.nil_max_pct } : {}) });
    }

    const players = (data || []).map(row => ({
      ...row.players, pos: row.players.primary_position, year: row.players.year,
      height: row.players.height ?? null, hometown: row.players.hometown ?? null,
      marketLow: row.players.open_market_low ?? 0, marketHigh: row.players.open_market_high ?? 0,
      stats: { ...(row.players.player_stats?.[0] || {}) },
      _typeKey: row.player_type, nilOffer: row.nil_offer, _status: row.status, _shortlisted: row.shortlisted,
    }));

    board.loadFromSaved(players);
    if (activeTeam) board.loadReturningRoster(activeTeam);
    setDrawerOpen(false);
  }

  if (!settings) return (
    <><SiteHeader /><div className="app-shell"><div className="empty">Loading…</div></div></>
  );

  const shortlistCount = board.state.shortlistIds.length;

  return (
    <>
      <SiteHeader />
      <div className="app-shell">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="app-top">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0 }}>Roster Builder</h1>
              {isAdmin && (
                <TeamAutocomplete value={selectedTeam}
                  onChange={t => { setSelectedTeam(t); handleSettingChange("program", t); }}
                  teams={allTeams} placeholder="Select team…" />
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!isNonAffiliate && (
                <>
                  <input className="input" placeholder="Name this roster…" style={{ width: 180 }}
                    value={saveName} onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSaveRoster()} />
                  <button className="btn btn-primary" disabled={!saveName.trim() || saving} onClick={handleSaveRoster}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                </>
              )}
              <button className="btn btn-ghost" onClick={() => {
                const ret = board.state.retentionById || {}, nil = board.state.nilById || {};
                const returning = board.returningPlayers.filter(p => (ret[p.id] || "returning") === "returning").map(p => ({ ...p, _type: "Returning", nilOffer: nil[p.id] || 0 }));
                const transfers = board.state.roster.map(r => { const p = board.byId(r.id); return p ? { ...p, _type: "Transfer In", nilOffer: r.nilOffer } : null; }).filter(Boolean);
                exportRosterPDF({ team: activeTeam, settings: board.state.settings, players: [...returning, ...transfers], projectedLow: calc.projectedLow, projectedHigh: calc.projectedHigh });
              }}>Export as PDF</button>
              <button className="btn btn-ghost" onClick={() => { setFinderOpen(true); track("finder_opened", {}); }}>Find Players</button>
              <button className="btn btn-ghost" onClick={() => setDrawerOpen(true)}>Saved Rosters</button>
              <button className="btn btn-ghost" style={{ color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
                onClick={() => { if (confirm("Reset all roster data?")) board.reset(activeTeam); }}>Reset</button>
            </div>
          </div>

          {/* Summary strip */}
          <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", padding: "10px 16px" }}>
              <div>
                <div style={labelStyle}>Roster</div>
                <div style={valueStyle}>{calc.totalRoster} / {settings.scholarships}</div>
              </div>
              <div>
                <div style={labelStyle}>NIL Budget</div>
                <div style={valueStyle}>{money(settings.nilTotal)}</div>
              </div>
              <div>
                <div style={labelStyle}>NIL Committed</div>
                <div style={valueStyle}>{money(calc.nilCommitted)}</div>
              </div>
              <div>
                <div style={labelStyle}>NIL Remaining</div>
                <div style={{ ...valueStyle, color: calc.nilRemaining < 0 ? "#e05c5c" : "inherit" }}>{money(calc.nilRemaining)}</div>
              </div>
              <div>
                <div style={labelStyle}>Max NIL / Player</div>
                <div style={valueStyle}>{money(calc.maxPerPlayer)}</div>
              </div>
              <div>
                <div style={labelStyle}>Projected Roster Value</div>
                <div style={valueStyle}>{money(calc.projectedLow)} – {money(calc.projectedHigh)}</div>
              </div>
              {calc.rosterScore > 0 && (() => {
                const g = rosterGrade(calc.rosterScore);
                return (
                  <div>
                    <div style={labelStyle}>Roster Strength</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ background: g.color, color: "#0e1521", fontWeight: 700, fontSize: 13, padding: "2px 10px", borderRadius: 10 }}>
                        {g.label}
                      </span>
                      <span style={{ ...valueStyle, opacity: .45, fontSize: 12 }}>{(calc.rosterScore / 1000000).toFixed(2)}M BTP</span>
                    </div>
                  </div>
                );
              })()}
              {calc.warnings.length > 0 && (
                <div style={{ fontSize: 12, color: "#f87171" }}>
                  ⚠ {calc.warnings[0]}{calc.warnings.length > 1 ? ` +${calc.warnings.length - 1} more` : ""}
                </div>
              )}
              <button className="btn btn-ghost" style={{ marginLeft: "auto", fontSize: 12 }} onClick={() => setSettingsOpen(v => !v)}>
                {settingsOpen ? "Hide Settings ▲" : "Settings ▼"}
              </button>
            </div>

            {settingsOpen && (
              <div style={{ borderTop: "1px solid var(--border)", padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 12 }}>
                {[
                  { id: "program",      label: "Program",        type: "text",   step: undefined },
                  { id: "scholarships", label: "Scholarships",   type: "number", step: 1 },
                  { id: "nilTotal",     label: "NIL Budget",     type: "number", step: 100000 },
                  { id: "maxPct",       label: "Max NIL / Player (%)", type: "number", step: 0.01 },
                ].map(({ id, label, type, step }) => (
                  <div key={id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, opacity: .5 }}>{label}</label>
                    <input className="input" type={type} step={step} value={settings[id] ?? ""}
                      onChange={e => handleSettingChange(id, e.target.value)} style={{ width: 140 }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Build / View / Strength toggle */}
          <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
            {[
              { key: "build",    label: "Build" },
              { key: "view",     label: "View Roster" },
              { key: "strength", label: "Roster Strength (beta)" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setViewMode(key)} style={{
                padding: "6px 18px", borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer",
                background: viewMode === key ? "rgba(255,255,255,.1)" : "transparent",
                border: viewMode === key ? "1px solid rgba(255,255,255,.2)" : "1px solid transparent",
                color: viewMode === key ? "#fff" : "rgba(255,255,255,.4)",
              }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Build mode ──────────────────────────────────────────────────── */}
        {viewMode === "build" && (
          <div className="app-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>

            {/* Board panel */}
            <div className="panel">
              <div className="panel-head">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h2>Board</h2>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShortlistOpen(true)}>
                    Shortlist{shortlistCount > 0 && (
                      <span style={{ marginLeft: 6, background: "var(--accent,#5b9cf6)", color: "#fff", borderRadius: 10, fontSize: 10, padding: "1px 6px", fontWeight: 600 }}>
                        {shortlistCount}
                      </span>
                    )}
                  </button>
                </div>
                <p className="muted">
                  {boardMode === "domestic" ? "Portal targets. Status subject to change." : "International prospects (RealGM-scraped)."}
                </p>
                <div style={{ display: "flex", gap: 4, marginTop: 6, marginBottom: 4 }}>
                  {[["domestic", "Domestic"], ["international", "International"]].map(([val, lbl]) => (
                    <button key={val} onClick={() => setBoardMode(val)} style={{
                      fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 12, cursor: "pointer",
                      border: "1px solid",
                      background:  boardMode === val ? "rgba(91,156,246,.18)" : "transparent",
                      color:       boardMode === val ? "#5b9cf6" : "rgba(255,255,255,.45)",
                      borderColor: boardMode === val ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.12)",
                    }}>{lbl}</button>
                  ))}
                </div>
                <div className="panel-tools" style={{ flexWrap: "wrap" }}>
                  <input className="input" type="search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
                  <MultiSelectFilter label="positions" options={["Guard", "Wing", "Big"]}
                    value={posFilter} onChange={setPosFilter} width={130} />
                  {boardMode === "domestic" && (
                    <MultiSelectFilter label="years"
                      options={["Fr", "RS Fr", "So", "RS So", "Jr", "RS Jr", "Sr", "RS Sr", "Grad", "5th Year"]}
                      value={yearFilter} onChange={setYearFilter} width={110} />
                  )}
                  <RangeFilter label="Ht"
                    min={heightMin} max={heightMax}
                    onChange={(lo, hi) => { setHeightMin(lo); setHeightMax(hi); }}
                    parse={parseHeight} format={formatHeight}
                    placeholder={["min", "max"]} width={55} />
                  {boardMode === "domestic" && (
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, opacity: .7, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                      <input type="checkbox" checked={portalOnly} onChange={e => setPortalOnly(e.target.checked)} />
                      Portal only
                    </label>
                  )}
                </div>
                <FilterChips
                  items={[
                    ...posFilter.map(p => ({ label: `Pos: ${p}`, onClear: () => setPosFilter(posFilter.filter(x => x !== p)) })),
                    ...yearFilter.map(y => ({ label: `Yr: ${y}`, onClear: () => setYearFilter(yearFilter.filter(x => x !== y)) })),
                    ...(heightMin != null ? [{ label: `Ht ≥ ${formatHeight(heightMin)}`, onClear: () => setHeightMin(null) }] : []),
                    ...(heightMax != null ? [{ label: `Ht ≤ ${formatHeight(heightMax)}`, onClear: () => setHeightMax(null) }] : []),
                  ]}
                  onClearAll={() => { setPosFilter([]); setYearFilter([]); setHeightMin(null); setHeightMax(null); }}
                />
              </div>
              <div className="list">
                {boardMode === "domestic" ? (
                  filtered.length === 0
                    ? <div className="empty">No players match your filters.</div>
                    : filtered.map(p => (
                      <PlayerCard key={p.id} player={p}
                        inRoster={board.inRoster(p.id)} inShortlist={board.inShort(p.id)}
                        onRoster={id => { track("roster_add", { player_id: id }); board.addToRoster(id); }}
                        onShortlist={id => { track("shortlist_add", { player_id: id }); board.addToShortlist(id); }}
                        onClick={handleOpenModal}
                      />
                    ))
                ) : (
                  intlBoard === null
                    ? <div className="empty">Loading international board…</div>
                    : filteredIntl.length === 0
                      ? <div className="empty">No international players match your filters.</div>
                      : filteredIntl.map(p => {
                          const onRoster = board.inRoster(p.id);
                          const tg = p.metrics?.translation_grade;
                          return (
                            <div key={p.id} className="row row-click"
                              onClick={e => { if (!e.target.closest("button")) handleOpenModal(p); }}>
                              <div className="row-main">
                                <div className="row-title">{p.name}</div>
                                <div className="row-sub" style={{ fontSize: 11 }}>
                                  {[p.league, p.primary_position, p.height, p.country_of_origin].filter(Boolean).join(" · ")}
                                  {tg != null && ` · TG ${Math.round(tg)}`}
                                </div>
                              </div>
                              <div className="row-actions">
                                <button className="btn btn-primary" style={{ fontSize: 11 }}
                                  disabled={onRoster}
                                  onClick={e => { e.stopPropagation(); board.addIntlToRoster(p); }}>
                                  {onRoster ? "Added" : "+ Roster"}
                                </button>
                              </div>
                            </div>
                          );
                        })
                )}
              </div>
            </div>

            {/* Roster panel */}
            <div className="panel">
              <div className="panel-head">
                <h2>Roster</h2>
                <p className="muted">Returning players + incoming transfers + portal adds.</p>
              </div>
              <div className="list">
                {(() => {
                  const retById = board.state.retentionById || {};
                  const nilById = board.state.nilById || {};
                  const LEAVING = new Set(["entering_portal", "entering_draft", "transferred", "graduating"]);

                  const returningGroup = board.returningPlayers.filter(p => { const s = retById[p.id] || "returning"; return s === "returning"; });
                  const undecidedGroup = board.returningPlayers.filter(p => retById[p.id] === "undecided");
                  const leavingGroup   = board.returningPlayers.filter(p => LEAVING.has(retById[p.id]));

                  const makeReturningRow = (p, dimmed = false) => {
                    const status = retById[p.id] || "returning";
                    const leaving = LEAVING.has(status);
                    return (
                      <div key={p.id} className="row row-click" style={{ opacity: dimmed ? .45 : .9 }}
                        onClick={e => { if (!e.target.closest("button,input")) handleOpenModal({ ...p, _typeKey: status }); }}>
                        <div className="row-main">
                          <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                          <div className="row-sub" style={{ fontSize: 11 }}>{p.primary_position || p.pos} · {p.year}</div>
                          {!leaving && (
                            <NilInput value={nilById[p.id] || 0} onCommit={val => board.updateReturningNil(p.id, val)} />
                          )}
                        </div>
                        <RetentionBadge value={status} onChange={val => board.setRetention(p.id, val)} />
                      </div>
                    );
                  };

                  const hasAnything = board.state.roster.length || board.returningPlayers.length || board.customPlayers.length;

                  // Split rostered entries: committed-incoming vs international vs manual portal adds.
                  const incomingIdSet   = new Set(board.incomingTransfers.map(p => p.id));
                  const incomingEntries = board.state.roster.filter(e => incomingIdSet.has(e.id) && e.source !== "intl");
                  const intlEntries     = board.state.roster.filter(e => e.source === "intl");
                  const portalEntries   = board.state.roster.filter(e => !incomingIdSet.has(e.id) && e.source !== "intl");

                  const renderRosterRow = (entry) => {
                    const p = board.byId(entry.id);
                    if (!p) return null;
                    const typeKey = entry.source === "intl" || p.source === "intl" ? "intl" : "transfer";
                    return (
                      <div key={entry.id} className="row row-click"
                        onClick={e => { if (!e.target.closest("button,input")) handleOpenModal({ ...p, _typeKey: typeKey, nilOffer: entry.nilOffer }); }}>
                        <div className="row-main">
                          <div className="row-title">{p.name}</div>
                          <div className="row-sub">{p.team} · {p.pos} · {p.year}</div>
                          <NilInput value={entry.nilOffer || 0} onCommit={val => board.updateOffer(entry.id, val)} />
                        </div>
                        <div className="row-actions">
                          <button className="btn btn-ghost"
                            onClick={e => { e.stopPropagation(); board.removeFromRoster(entry.id); }}>Remove</button>
                        </div>
                      </div>
                    );
                  };

                  return (
                    <>
                      {/* 1. Incoming transfers (auto-added from portal_transfers) */}
                      {incomingEntries.length > 0 && (
                        <>
                          <div className="sub-label" style={{ color: "#34d399" }}>Incoming Transfers ({incomingEntries.length})</div>
                          {incomingEntries.map(renderRosterRow)}
                        </>
                      )}

                      {/* 2. Manual portal adds */}
                      {portalEntries.length > 0 && (
                        <>
                          <div className="sub-label" style={{ color: "#5b9cf6" }}>Portal Adds ({portalEntries.length})</div>
                          {portalEntries.map(renderRosterRow)}
                        </>
                      )}

                      {/* 2b. International signings */}
                      {intlEntries.length > 0 && (
                        <>
                          <div className="sub-label" style={{ color: "#a78bfa" }}>International ({intlEntries.length})</div>
                          {intlEntries.map(renderRosterRow)}
                        </>
                      )}

                      {/* 3. Returning */}
                      {returningGroup.length > 0 && (
                        <>
                          <div className="sub-label" style={{ color: "#4ade80" }}>Returning ({returningGroup.length})</div>
                          {returningGroup.map(p => makeReturningRow(p))}
                        </>
                      )}

                      {/* 4. Undecided */}
                      {undecidedGroup.length > 0 && (
                        <>
                          <div className="sub-label" style={{ color: "#f5a623" }}>Undecided ({undecidedGroup.length})</div>
                          {undecidedGroup.map(p => makeReturningRow(p))}
                        </>
                      )}

                      {/* 5. Shortlist */}
                      {board.state.shortlistIds.length > 0 && (
                        <>
                          <div className="sub-label">Shortlist ({board.state.shortlistIds.length})</div>
                          {board.state.shortlistIds.map(id => {
                            const p = board.byId(id);
                            if (!p) return null;
                            return (
                              <div key={id} className="row row-click"
                                onClick={e => { if (!e.target.closest("button")) handleOpenModal(p); }}>
                                <div className="row-main">
                                  <div className="row-title" style={{ fontSize: 13 }}>{p.name}</div>
                                  <div className="row-sub" style={{ fontSize: 11 }}>{p.team} · {p.pos} · {p.year}</div>
                                </div>
                                <div className="row-actions">
                                  <button className="btn btn-ghost" style={{ fontSize: 11 }}
                                    onClick={e => { e.stopPropagation(); board.removeFromShortlist(id); }}>✕</button>
                                  <button className="btn btn-primary" style={{ fontSize: 11 }}
                                    onClick={e => { e.stopPropagation(); board.addToRoster(id); }}>+ Roster</button>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}

                      {/* 6. Leaving */}
                      {leavingGroup.length > 0 && (
                        <>
                          <div className="sub-label" style={{ opacity: .5 }}>Leaving ({leavingGroup.length})</div>
                          {leavingGroup.map(p => makeReturningRow(p, true))}
                        </>
                      )}

                      {/* 7. Freshmen / Redshirts */}
                      <CustomPlayersSection
                        customPlayers={board.customPlayers}
                        onAdd={board.addCustomPlayer}
                        onRemove={handleCustomRemove}
                        onNilChange={handleCustomNilChange}
                        onNilBlur={handleCustomNilBlur}
                        activeTeam={activeTeam}
                        userId={userId}
                      />

                      {!hasAnything && <div className="empty">No roster players yet.</div>}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── View mode ───────────────────────────────────────────────────── */}
        {viewMode === "view" && (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            {sortedView.length === 0
              ? <div className="empty">No players yet. Add your returning roster and portal targets in Build mode.</div>
              : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {VIEW_COLS.map(col => (
                        <th key={col.label} style={{ ...thStyle, cursor: "pointer", userSelect: "none" }} onClick={() => handleSort(col.label)}>
                          {col.label}{sortKey === col.label ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </th>
                      ))}
                      <th style={thStyle} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedView.map((p, i) => (
                      <tr key={p.id ?? i} className="row-click"
                        style={{ borderBottom: "1px solid var(--border)" }}
                        onClick={e => { if (!e.target.closest("input,button")) handleOpenModal(p); }}>
                        {VIEW_COLS.map(col => (
                          <td key={col.label} style={{
                            ...tdStyle,
                            color: col.label === "Type" ? (TYPE_COLOR[p._type] || "inherit") : "inherit",
                            fontWeight: col.label === "Type" ? 500 : "inherit",
                          }}>
                            {col.label === "Type" && p._typeKey !== "transfer" && p._typeKey !== "incoming" && p._typeKey !== "custom" && p._typeKey !== "intl" ? (
                              <div onClick={e => e.stopPropagation()}>
                                <RetentionBadge value={p._typeKey} onChange={val => board.setRetention(p.id, val)} />
                              </div>
                            ) : col.isNil ? (
                              <NilInput value={p.nilOffer || 0} onCommit={val => {
                                if (p._typeKey === "transfer" || p._typeKey === "incoming" || p._typeKey === "intl") board.updateOffer(p.id, val);
                                else if (p._typeKey !== "custom") board.updateReturningNil(p.id, val);
                              }} />
                            ) : col.get(p)}
                          </td>
                        ))}
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {(p._typeKey === "transfer" || p._typeKey === "incoming" || p._typeKey === "intl") && (
                            <button className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "2px 8px", color: "#f77", borderColor: "rgba(220,70,70,.3)" }}
                              onClick={e => { e.stopPropagation(); board.removeFromRoster(p.id); }}>Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        )}

        {/* ── Roster Strength breakdown ───────────────────────────────────── */}
        {viewMode === "strength" && <RosterStrengthPanel calc={calc} onOpenModal={handleOpenModal} allPlayers={board.state.board} userTeam={activeTeam} customOrder={depthChartOrder} setCustomOrder={setDepthChartOrder} starterCounts={depthStarterCounts} setStarterCounts={setDepthStarterCounts} />}

      </div>

      {/* ── Shortlist drawer ────────────────────────────────────────────── */}
      {shortlistOpen && (
        <>
          <div className="modal-backdrop" onClick={() => setShortlistOpen(false)} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 201, width: "min(360px, 100vw)", background: "#0e1521", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Shortlist</h3>
              <button className="btn btn-ghost" onClick={() => setShortlistOpen(false)}>Close</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {board.state.shortlistIds.length === 0
                ? <div className="empty" style={{ padding: 20 }}>No shortlisted players yet.</div>
                : board.state.shortlistIds.map(id => {
                    const p = board.byId(id);
                    if (!p) return null;
                    return (
                      <div key={id} className="row row-click" style={{ padding: "10px 16px" }}
                        onClick={e => { if (!e.target.closest("button")) handleOpenModal(p); }}>
                        <div className="row-main">
                          <div className="row-title">{p.name}</div>
                          <div className="row-sub">{p.team} · {p.pos} · {p.year}</div>
                        </div>
                        <div className="row-actions">
                          <button className="btn btn-ghost" style={{ fontSize: 11 }}
                            onClick={e => { e.stopPropagation(); board.removeFromShortlist(id); }}>✕</button>
                          <button className="btn btn-primary" style={{ fontSize: 11 }}
                            onClick={e => { e.stopPropagation(); board.addToRoster(id); setShortlistOpen(false); }}>Roster</button>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>
        </>
      )}

      {/* ── Saved Rosters drawer ─────────────────────────────────────────── */}
      {drawerOpen && (
        <>
          <div className="modal-backdrop" onClick={() => setDrawerOpen(false)} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 201, width: "min(400px, 100vw)", background: "#0e1521", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Saved Rosters</h3>
              <button className="btn btn-ghost" onClick={() => setDrawerOpen(false)}>Close</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 24 }}>
              {loadingDrawer ? <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div> : (
                <>
                  <div>
                    <div style={drawerHeadStyle}>My Rosters ({myRosters.length})</div>
                    {myRosters.length === 0
                      ? <div style={{ fontSize: 13, opacity: .35 }}>No saved rosters yet.</div>
                      : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {myRosters.map(r => (
                            <div key={r.id} style={rosterCardStyle}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                                <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                              </div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => handleLoadRoster(r.id)}>Load</button>
                                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px", color: "#f77", borderColor: "rgba(220,70,70,.3)" }} onClick={() => handleDeleteRoster(r.id)}>Delete</button>
                              </div>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                  {teamRosters.length > 0 && (
                    <div>
                      <div style={drawerHeadStyle}>Staff Rosters ({teamRosters.length})</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {teamRosters.map(r => (
                          <div key={r.id}>
                            <div style={{ fontSize: 10, opacity: .35, marginBottom: 4, paddingLeft: 2 }}>{coaches[r.user_id] || "Coach"}</div>
                            <div style={rosterCardStyle}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                                <div style={{ fontSize: 11, opacity: .4, marginTop: 2 }}>{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                              </div>
                              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => handleLoadRoster(r.id)}>Load</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {modal && (
        modal.source === "intl" || modal._typeKey === "intl" ? (
          <IntlPlayerModal
            profile={modal}
            onClose={() => setModal(null)}
            onAddToRoster={(p) => { board.addIntlToRoster(p); setModal(null); }}
            alreadyOnRoster={board.inRoster(modal.id)}
            canAddToRoster={!!activeTeam}
            onSelectPlayer={(client) => setModal(client)}
          />
        ) : (
          <PlayerModal
            player={modal}
            sport="womens"
            onClose={() => setModal(null)}
            onReplace={["returning", "undecided", "transfer"].includes(modal._typeKey)
              ? () => {
                  setReplacingPlayer(modal);
                  setModal(null);
                  setFinderOpen(true);
                }
              : undefined}
          />
        )
      )}

      {finderOpen && (
        <PlayerFinder
          board={board}
          returningPlayers={board.returningPlayers}
          retentionById={board.state.retentionById}
          onClose={() => { setFinderOpen(false); setReplacingPlayer(null); }}
          initialMode={replacingPlayer ? "replace" : "need"}
          initialReplaceId={replacingPlayer?.id ?? ""}
          onRosterAdd={replacingPlayer ? () => {
            if (replacingPlayer._typeKey === "transfer") {
              board.removeFromRoster(replacingPlayer.id);
            } else {
              board.setRetention(replacingPlayer.id, "entering_portal");
            }
            setReplacingPlayer(null);
            setFinderOpen(false);
          } : undefined}
        />
      )}
    </>
  );
}

const labelStyle = { fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, fontWeight: 500 };
const valueStyle = { fontSize: 15, fontWeight: 600, marginTop: 2 };
const drawerHeadStyle = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", opacity: .4, marginBottom: 10, fontWeight: 500 };
const rosterCardStyle = { background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
const thStyle = { padding: "10px 12px", textAlign: "left", background: "rgba(0,0,0,.6)", backdropFilter: "blur(6px)", position: "sticky", top: 0, whiteSpace: "nowrap", borderBottom: "1px solid var(--border)", fontWeight: 500, fontSize: 12 };
const tdStyle = { padding: "8px 12px", whiteSpace: "nowrap", verticalAlign: "middle" };
