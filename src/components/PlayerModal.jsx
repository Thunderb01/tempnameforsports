import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const STATUSES = [
  { key: "none", label: "No status" },
  { key: "interested", label: "Interested" },
  { key: "contacted",  label: "Contacted" },
  { key: "visit",      label: "Visit" },
  { key: "signed",     label: "Signed" },
  { key: "passed",     label: "Passed" },
];

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
  { key: "cdi",    label: "CDI" },
  { key: "dds",    label: "DDS" },
  { key: "sei",    label: "SEI" },
  { key: "smi",    label: "SMI" },
  { key: "ris",    label: "RIS" },
];

export function PlayerModal({ player, status, onStatus, onClose }) {
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
              <div className="modal-sub">{player.team} · {player.pos} · {player.year}</div>
            </div>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>

          <div className="modal-section">
            <h4>Market Band</h4>
            <div className="modal-sub">{money(player.marketLow)} – {money(player.marketHigh)}</div>
          </div>

          <div className="modal-section">
            <h4>Stats</h4>
            {loadingStats ? (
              <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
            ) : !stats ? (
              <div style={{ opacity: .4, fontSize: 13 }}>No stats on file.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {STAT_ROWS.map(({ key, label }) => (
                    <tr key={key} style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                      <td style={{ padding: "5px 8px", opacity: .5, width: "50%" }}>{label}</td>
                      <td style={{ padding: "5px 8px", fontVariantNumeric: "tabular-nums" }}>
                        {fmt(stats[key], key)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="modal-section">
            <h4>Status</h4>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`status-pill status-${status || "none"}`}>
                {STATUSES.find(s => s.key === (status || "none"))?.label}
              </span>
              <label className="status-control">
                <select
                  value={status || "none"}
                  onChange={e => onStatus?.(player.id, e.target.value)}
                >
                  {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
