
function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

const TAG_GROUPS = [
  { key: "playmakerTags",  label: "Play Maker" },
  { key: "shootingTags",   label: "Shooting & Scoring" },
  { key: "shotmakingTags", label: "Shotmaking" },
  { key: "interiorTags",   label: "Interior" },
  { key: "defensiveTags",  label: "Defense" },
];

export function PlayerCard({ player, inRoster, inShortlist, onRoster, onShortlist, onClick }) {
  return (
    <div className="row row-click" onClick={e => { if (!e.target.closest("button,select")) onClick?.(player); }}>
      <div className="row-main">
        <div className="row-title">{player.name}</div>
        <div className="row-sub">{player.team} · {player.pos} · {player.year}</div>
        <div className="row-sub">Market: {money(player.marketLow)} – {money(player.marketHigh)}</div>
        {TAG_GROUPS.map(({ key, label }) => {
          const tags = (player[key] || []).slice(0, 5);
          if (!tags.length) return null;
          return (
            <div key={key} className="row-sub tag-row">
              <span className="muted" style={{ marginRight: 4 }}>{label}:</span>
              {tags.map(t => <span key={t} className="tag-chip">{t}</span>)}
            </div>
          );
        })}
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
}
