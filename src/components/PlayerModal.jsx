import { useEffect } from "react";

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

const STAT_LABELS = {
  ppg: "PPG", rpg: "RPG", apg: "APG", spg: "SPG", bpg: "BPG",
  mpg: "MPG", ts: "True Shooting",
  PPG: "PPG", "REB/G": "REB/G", "AST/G": "AST/G",
  "USG%": "USG%", "FG%": "FG%", "3P%": "3P%", "FT%": "FT%",
  "3PA/G": "3PA/G", "AST/TOV": "AST/TOV",
  "STL/40": "STL/40", "BLK/40": "BLK/40",
};

// Stats columns to skip in the modal (metadata, not useful to display)
const SKIP_STATS = new Set(["id","name","team","primary_position","year",
  "market_low","market_high","playmaker_tags","shooting_tags",
  "open_market_low","open_market_high","created_at","updated_at"]);

export function PlayerModal({ player, status, onStatus, onClose }) {
  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!player) return null;

  const stats = Object.entries(player.stats || {})
    .filter(([k]) => !SKIP_STATS.has(k))
    .filter(([, v]) => v !== "" && v !== null && v !== undefined);

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
              <div className="modal-id">ID: {player.id}</div>
            </div>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>

          {stats.length > 0 && (
            <div className="modal-grid">
              {stats.map(([k, v]) => (
                <div key={k} className="statbox">
                  <div className="label">{STAT_LABELS[k] || k.toUpperCase()}</div>
                  <div className="value">{String(v)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="modal-section">
            <h4>Market Band</h4>
            <div className="modal-sub">
              {money(player.marketLow)} – {money(player.marketHigh)}
            </div>
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
