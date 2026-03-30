
function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

export function PlayerCard({ player, inRoster, inShortlist, onRoster, onShortlist, onClick }) {
  const pm = (player.playmakerTags || []).slice(0, 5);
  const ss = (player.shootingTags  || []).slice(0, 5);

  return (
    <div className="row row-click" onClick={e => { if (!e.target.closest("button,select")) onClick?.(player); }}>
      <div className="row-main">
        <div className="row-title">{player.name}</div>
        <div className="row-sub">{player.team} · {player.pos} · {player.year}</div>
        <div className="row-sub">Market: {money(player.marketLow)} – {money(player.marketHigh)}</div>
        {pm.length > 0 && (
          <div className="row-sub tag-row">
            <span className="muted" style={{ marginRight: 4 }}>Play Maker:</span>
            {pm.map(t => <span key={t} className="tag-chip">{t}</span>)}
          </div>
        )}
        {ss.length > 0 && (
          <div className="row-sub tag-row">
            <span className="muted" style={{ marginRight: 4 }}>Shooting &amp; Scoring:</span>
            {ss.map(t => <span key={t} className="tag-chip">{t}</span>)}
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
}
