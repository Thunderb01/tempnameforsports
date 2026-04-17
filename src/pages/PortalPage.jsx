import { useState, useEffect, useMemo } from "react";
import { SiteHeader }  from "@/components/SiteHeader";
import { PlayerModal } from "@/components/PlayerModal";
import { useAuth }     from "@/hooks/useAuth";
import { getBoardCache } from "@/hooks/useRosterBoard";
import { supabase }    from "@/lib/supabase";
import { money, projectedTier, tierColor } from "@/lib/display";

const STATUS_CONFIG = {
  uncommitted: { label: "Available", color: "#4ade80", bg: "rgba(74,222,128,.12)"  },
  committed:   { label: "Committed", color: "#f5a623", bg: "rgba(245,166,35,.12)"  },
  withdrawn:   { label: "Withdrawn", color: "#94a3b8", bg: "rgba(148,163,184,.10)" },
};

const SORT_COLS = [
  { key: "player_name", label: "Player"    },
  { key: "pos",         label: "Pos"       },
  { key: "year",        label: "Yr"        },
  { key: "from_team",   label: "From"      },
  { key: null,          label: "→"         },
  { key: "to_team",     label: "To"        },
  { key: "ppg",         label: "PPG"       },
  { key: "rpg",         label: "RPG"       },
  { key: "apg",         label: "APG"       },
  { key: "nilHigh",     label: "NIL Range" },
  { key: null,          label: "Status"    },
];

export function PortalPage() {
  const { profile } = useAuth();

  const [transfers,  setTransfers]  = useState([]);
  const [playerMap,  setPlayerMap]  = useState({});
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState(null);

  const [searchInput,   setSearchInput]   = useState("");
  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [posFilter,     setPosFilter]     = useState("all");
  const [sortKey,       setSortKey]       = useState("player_name");
  const [sortDir,       setSortDir]       = useState("asc");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Load portal transfers + player data
  useEffect(() => {
    async function load() {
      setLoading(true);

      const { data: txData, error } = await supabase
        .from("portal_transfers")
        .select("*")
        .order("player_name");

      if (error) { console.error("portal_transfers fetch:", error); setLoading(false); return; }
      setTransfers(txData || []);

      // Use board cache if warm, otherwise targeted vw_players fetch
      const cache = getBoardCache();
      if (cache.length > 0) {
        const map = {};
        cache.forEach(p => { map[p.id] = p; });
        setPlayerMap(map);
      } else {
        const ids = (txData || []).map(t => t.player_id).filter(Boolean);
        if (ids.length > 0) {
          const { data: pData } = await supabase
            .from("vw_players")
            .select("*")
            .in("id", ids);
          const map = {};
          (pData || []).forEach(row => {
            map[row.id] = {
              id:           row.id,
              name:         row.name,
              team:         row.current_team,
              pos:          row.primary_position,
              year:         row.year,
              height:       row.height   ?? null,
              hometown:     row.hometown ?? null,
              espn_id:      row.espn_id  ?? null,
              marketLow:    row.open_market_low  ?? 0,
              marketHigh:   row.open_market_high ?? 0,
              nilValuation: row.nil_valuation    ?? 0,
              playmakerTags:  row.playmaker_tags  ? row.playmaker_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
              specialistTags: row.specialist_tags ? row.specialist_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
              shootingTags:   row.shooting_tags   ? row.shooting_tags.split(",").map(t => t.trim()).filter(Boolean)   : [],
              shotmakingTags: row.shotmaking_tags ? row.shotmaking_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
              interiorTags:   row.interior_tags   ? row.interior_tags.split(",").map(t => t.trim()).filter(Boolean)   : [],
              defensiveTags:  row.defensive_tags  ? row.defensive_tags.split(",").map(t => t.trim()).filter(Boolean)  : [],
              tags: [],
              stats: {
                ppg: row.ppg, rpg: row.rpg, apg: row.apg, usg: row.usg,
                ast_tov: row.ast_tov, fg_pct: row.fg_pct, "3p_pct": row["3p_pct"],
                ft_pct: row.ft_pct, sei: row.sei, ath: row.ath,
                ris: row.ris, dds: row.dds, cdi: row.cdi,
                calendar_year: row.calendar_year,
              },
            };
          });
          setPlayerMap(map);
        }
      }

      setLoading(false);
    }
    load();
  }, []);

  // Enrich transfers with matched player data
  const enriched = useMemo(() =>
    transfers.map(t => ({ ...t, player: t.player_id ? playerMap[t.player_id] ?? null : null })),
  [transfers, playerMap]);

  // Status counts for tabs
  const counts = useMemo(() => ({
    all:         enriched.length,
    uncommitted: enriched.filter(t => t.status === "uncommitted").length,
    committed:   enriched.filter(t => t.status === "committed").length,
    withdrawn:   enriched.filter(t => t.status === "withdrawn").length,
  }), [enriched]);

  // Unique positions for filter
  const positions = useMemo(() => {
    const s = new Set(enriched.map(t => t.player?.pos).filter(Boolean));
    return Array.from(s).sort();
  }, [enriched]);

  const filtered = useMemo(() => enriched.filter(t => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (posFilter !== "all" && t.player?.pos !== posFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !t.player_name.toLowerCase().includes(q) &&
        !(t.from_team || "").toLowerCase().includes(q) &&
        !(t.to_team   || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  }), [enriched, statusFilter, posFilter, search]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case "player_name": av = a.player_name;             bv = b.player_name;             break;
      case "from_team":   av = a.from_team || "";          bv = b.from_team || "";          break;
      case "to_team":     av = a.to_team   || "";          bv = b.to_team   || "";          break;
      case "pos":         av = a.player?.pos  || "";       bv = b.player?.pos  || "";       break;
      case "year":        av = a.player?.year || "";       bv = b.player?.year || "";       break;
      case "ppg":         av = a.player?.stats?.ppg  ?? -1; bv = b.player?.stats?.ppg  ?? -1; break;
      case "rpg":         av = a.player?.stats?.rpg  ?? -1; bv = b.player?.stats?.rpg  ?? -1; break;
      case "apg":         av = a.player?.stats?.apg  ?? -1; bv = b.player?.stats?.apg  ?? -1; break;
      case "nilHigh":     av = a.player?.marketHigh  ?? -1; bv = b.player?.marketHigh  ?? -1; break;
      default:            av = a.player_name;             bv = b.player_name;
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ?  1 : -1;
    return 0;
  }), [filtered, sortKey, sortDir]);

  function toggleSort(key) {
    if (!key) return;
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#e2e8f0" }}>
      <SiteHeader />
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 16px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 20px" }}>Transfer Portal Tracker</h1>

        {/* Status tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            ["all",         "All",       null],
            ["uncommitted", "Available", STATUS_CONFIG.uncommitted],
            ["committed",   "Committed", STATUS_CONFIG.committed],
            ["withdrawn",   "Withdrawn", STATUS_CONFIG.withdrawn],
          ].map(([key, label, cfg]) => {
            const active = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                style={{
                  padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 600,
                  background: active ? (cfg?.bg || "rgba(255,255,255,.15)") : "rgba(255,255,255,.07)",
                  color:      active ? (cfg?.color || "#e2e8f0")             : "#94a3b8",
                  outline:    active ? `1.5px solid ${cfg?.color || "#e2e8f0"}` : "none",
                }}
              >
                {label} <span style={{ opacity: .55, fontSize: 11 }}>{counts[key]}</span>
              </button>
            );
          })}
        </div>

        {/* Filter row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Search player, school..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{
              background: "#1e2535", border: "1px solid #2d3748", borderRadius: 6,
              color: "#e2e8f0", padding: "6px 12px", fontSize: 13, width: 220,
            }}
          />
          <select
            value={posFilter}
            onChange={e => setPosFilter(e.target.value)}
            style={{
              background: "#1e2535", border: "1px solid #2d3748", borderRadius: 6,
              color: "#e2e8f0", padding: "6px 10px", fontSize: 13,
            }}
          >
            <option value="all">All Positions</option>
            {positions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <span style={{ marginLeft: "auto", fontSize: 13, opacity: .45 }}>
            {sorted.length.toLocaleString()} players
          </span>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 80, opacity: .45, fontSize: 14 }}>
            Loading portal data...
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #2d3748" }}>
                  {SORT_COLS.map(({ key, label }, i) => (
                    <th
                      key={i}
                      onClick={() => toggleSort(key)}
                      style={{
                        textAlign: "left", padding: "8px 10px",
                        color: sortKey === key ? "#e2e8f0" : "#64748b",
                        fontWeight: 600, fontSize: 11,
                        textTransform: "uppercase", letterSpacing: .5,
                        cursor: key ? "pointer" : "default",
                        userSelect: "none", whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                      {key && sortKey === key && (
                        <span style={{ marginLeft: 3 }}>{sortDir === "asc" ? "↑" : "↓"}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((t, i) => {
                  const p   = t.player;
                  const cfg = STATUS_CONFIG[t.status] || { label: t.status, color: "#64748b", bg: "transparent" };
                  const tier = p ? projectedTier(p.marketHigh) : null;
                  return (
                    <tr
                      key={t.api_id ?? t.id ?? i}
                      onClick={() => p && setModal(p)}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,.04)",
                        cursor: p ? "pointer" : "default",
                        background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)",
                      }}
                      onMouseEnter={e => { if (p) e.currentTarget.style.background = "rgba(255,255,255,.06)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)"; }}
                    >
                      <td style={{ padding: "9px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {t.player_name}
                        {!p && <span style={{ fontSize: 10, opacity: .35, marginLeft: 5 }}>unmatched</span>}
                      </td>
                      <td style={{ padding: "9px 10px", color: "#94a3b8" }}>{p?.pos || "—"}</td>
                      <td style={{ padding: "9px 10px", color: "#94a3b8" }}>{p?.year || "—"}</td>
                      <td style={{ padding: "9px 10px" }}>{t.from_team || "—"}</td>
                      <td style={{ padding: "9px 10px", color: "#334155" }}>→</td>
                      <td style={{ padding: "9px 10px", color: t.to_team ? "#e2e8f0" : "#334155" }}>
                        {t.to_team || "—"}
                      </td>
                      <td style={{ padding: "9px 10px" }}>{p?.stats?.ppg ?? "—"}</td>
                      <td style={{ padding: "9px 10px" }}>{p?.stats?.rpg ?? "—"}</td>
                      <td style={{ padding: "9px 10px" }}>{p?.stats?.apg ?? "—"}</td>
                      <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                        {p ? (
                          <span style={{ color: tierColor(tier), fontSize: 12 }}>
                            {money(p.marketLow)} – {money(p.marketHigh)}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 4,
                          fontSize: 11, fontWeight: 600,
                          background: cfg.bg, color: cfg.color,
                          border: `1px solid ${cfg.color}55`,
                        }}>
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={SORT_COLS.length} style={{ textAlign: "center", padding: 48, opacity: .4, fontSize: 14 }}>
                      No players match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {modal && <PlayerModal player={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
