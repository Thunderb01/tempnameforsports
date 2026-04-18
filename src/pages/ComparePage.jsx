import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { SiteHeader }       from "@/components/SiteHeader";
import { PlayerComparison } from "@/components/PlayerComparison";
import { supabase }         from "@/lib/supabase";
import { getBoardCache, setBoardCache, VW_PLAYERS_COLS } from "@/hooks/useRosterBoard";

export function ComparePage() {
  const [searchParams] = useSearchParams();
  const [allPlayers, setAllPlayers] = useState([]);
  const [loading,    setLoading]    = useState(true);

  // Pre-fill up to 4 slots from URL: ?p0=<id>&p1=<id>&p2=<id>&p3=<id>
  const initialIds = [0, 1, 2, 3].map(i => searchParams.get(`p${i}`) ?? "");

  useEffect(() => {
    async function load() {
      // Use shared cache if the board was already loaded this session
      const cached = getBoardCache();
      if (cached.length > 0) {
        setAllPlayers(cached);
        setLoading(false);
        return;
      }

      const all = [];
      const PAGE = 1000;
      let page = 0;
      while (true) {
        const { data, error } = await supabase
          .from("vw_players")
          .select(VW_PLAYERS_COLS)
          .order("name")
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (error) { console.error("compare fetch:", error); break; }
        all.push(...(data || []));
        if ((data || []).length < PAGE) break;
        page++;
      }
      const players = all.map(p => ({
        ...p,
        team:         p.current_team,
        pos:          p.primary_position,
        marketLow:    p.open_market_low  ?? 0,
        marketHigh:   p.open_market_high ?? 0,
        nilValuation: p.nil_valuation    ?? 0,
        stats: {
          ppg:          p.ppg,
          rpg:          p.rpg,
          apg:          p.apg,
          usg:          p.usg,
          ast_tov:      p.ast_tov,
          fg_pct:       p.fg_pct,
          "3p_pct":     p["3p_pct"],
          ft_pct:       p.ft_pct,
          sei:          p.sei,
          ath:          p.ath,
          ris:          p.ris,
          dds:          p.dds,
          cdi:          p.cdi,
          calendar_year: p.calendar_year,
        },
      }));
      setBoardCache(players);
      setAllPlayers(players);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <>
      <SiteHeader />
      <div className="app-shell">
        <div className="app-top">
          <h1 style={{ margin: 0 }}>Player Comparison</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Compare up to 4 players side by side</p>
        </div>

        <div style={{ marginTop: 24 }}>
          {loading ? (
            <div style={{ opacity: .4, fontSize: 13 }}>Loading players…</div>
          ) : (
            <PlayerComparison initialIds={initialIds} allPlayers={allPlayers} />
          )}
        </div>
      </div>
    </>
  );
}
