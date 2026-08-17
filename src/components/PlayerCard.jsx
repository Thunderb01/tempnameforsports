import { memo } from "react";
import { nilRange, overallFor, overallColor } from "@/lib/display";
import { positionLabel } from "@/lib/positions";
import { useNilVisible } from "@/hooks/useNilVisible";

export const PlayerCard = memo(function PlayerCard({ player, inRoster, inShortlist, onRoster, onShortlist, onClick, archetypeColor = "#f5a623" }) {
  const [nilVisible] = useNilVisible();
  const overall = overallFor(player);
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
        <div className="row-sub">{player.team} · {positionLabel(player)} · {player.year}</div>
        <div className="row-sub">
          <span style={{ fontWeight: 700, color: overallColor(overall) }}>
            {overall != null ? `${overall} OVR` : "Unrated"}
          </span>
          {nilVisible && (player.marketLow > 0 || player.marketHigh > 0) && (
            <span style={{ opacity: .6 }}>{"  ·  "}{nilRange(player.marketLow, player.marketHigh)}</span>
          )}
        </div>
        {statLine && <div className="row-sub" style={{ opacity: .75 }}>{statLine}</div>}
        {player.archetype && (
          <div style={{ marginTop: 6, display: "inline-block", padding: "2px 8px", borderRadius: 20,
            fontSize: 11, fontWeight: 600, background: `${archetypeColor}22`, color: archetypeColor,
            border: `1px solid ${archetypeColor}55` }}>
            {player.archetype}
          </div>
        )}
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
