const STATUSES = [
  { key: "none",       label: "No status" },
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

export function PlayerCard({ player, inRoster, inShortlist, status, onRoster, onShortlist, onStatus, onClick }) {
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
        <div className="row-sub" style={{ marginTop: 8 }}>
          <label className="status-control">
            <span>Status</span>
            <select
              value={status || "none"}
              onChange={e => onStatus?.(player.id, e.target.value)}
              onClick={e => e.stopPropagation()}
            >
              {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
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
