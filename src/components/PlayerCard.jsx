import { memo } from "react";
import { money } from "@/lib/display";

export const PlayerCard = memo(function PlayerCard({ player, inRoster, inShortlist, onRoster, onShortlist, onClick }) {
  const s = player.stats || {};
  const stat = (val, label) => val != null && val !== "" && String(val) !== "NaN"
    ? `${label} ${Number(val).toFixed(1)}`
    : null;
  const statLine = [
    stat(s.usg,  "USG"),
    stat(s.ppg,  "PPG"),
    stat(s.rpg,  "RPG"),
    stat(s.apg,  "APG"),
  ].filter(Boolean).join("  ·  ");

  return (
    <div className="row row-click" onClick={e => { if (!e.target.closest("button,select")) onClick?.(player); }}>
      <div className="row-main">
        <div className="row-title">{player.name}</div>
        <div className="row-sub">{player.team} · {player.pos} · {player.year}</div>
        <div className="row-sub">Market: {money(player.marketLow)} – {money(player.marketHigh)}</div>
        {statLine && <div className="row-sub" style={{ opacity: .75 }}>{statLine}</div>}
      </div>

      <div className="row-actions">
        <button
          className="btn btn-ghost"
          disabled={inShortlist || inRoster}
          onClick={e => { e.stopPropagation(); onShortlist?.(player.id); }}
        >
          Shortlist
        </button>
        <button
          className="btn btn-primary"
          disabled={inRoster}
          onClick={e => { e.stopPropagation(); onRoster?.(player.id); }}
        >
          Roster
        </button>
      </div>
    </div>
  );
});
