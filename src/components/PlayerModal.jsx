import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";


function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

function fmt(val, key) {
  if (val === null || val === undefined || val === "") return "—";
  const pct = ["fg_pct","ft_pct","3p_pct","atr_pct"];
  if (pct.includes(key)) return `${Number(val).toFixed(1)}%`;
  return Number(val) % 1 === 0 ? Number(val).toFixed(0) : Number(val).toFixed(1);
}

const STAT_ROWS = [
  { key: "ppg",    label: "PPG" },
  { key: "rpg",    label: "RPG" },
  { key: "apg",    label: "APG" },
  { key: "3pg",    label: "3PG" },
  { key: "usg",    label: "USG%" },
  { key: "ast_tov",label: "AST/TOV" },
  { key: "fg_pct", label: "FG%" },
  { key: "ft_pct", label: "FT%" },
  { key: "3p_pct", label: "3P%" },
  { key: "atr_pct",label: "ATR%" },
  { key: "stl_40", label: "STL/40" },
  { key: "blk_40", label: "BLK/40" },
  { key: "drb_40", label: "DRB/40" },
  { key: "orb_40", label: "ORB/40" },
  { key: "trb_40", label: "TRB/40" },
];

const ADV_ROWS = [
  { key: "cdi", label: "CDI" },
  { key: "dds", label: "DDS" },
  { key: "sei", label: "SEI" },
  { key: "smi", label: "SMI" },
  { key: "ris", label: "RIS" },
];

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
            <div>
              <div className="modal-kicker">Player Card</div>
              <h3 className="modal-title" id="modal-title">{player.name}</h3>
              <div className="modal-sub">
                {[player.team, player.pos, player.year, player.height, player.hometown]
                  .filter(Boolean).join(" · ")}
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

              <div style={{ marginTop: 16 }}>
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
              </div>
              </>
            )}
          </div>


        </div>
      </div>
    </>
  );
}
