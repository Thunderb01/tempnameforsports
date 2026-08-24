// Reflective look-back at players tagged player_status === "drafted" — not a
// live draft feed. Shared by both the men's and women's Big Board so the two
// don't drift the way the fork model otherwise tends to.
export function DraftSpotlight({ players, onSelect, onViewAll, viewAllActive }) {
  if (!players.length) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", opacity: .65 }}>
          Draft Spotlight
        </span>
        <span style={{ fontSize: 12, opacity: .4 }}>{players.length} drafted</span>
        {!viewAllActive && onViewAll && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "1px 8px", marginLeft: "auto" }}
            onClick={onViewAll}>
            View all
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}>
        {players.map(p => (
          <div key={p.id} className="row-click"
            onClick={() => onSelect?.(p)}
            style={{
              minWidth: 190, flexShrink: 0, cursor: "pointer",
              background: "var(--panel)", border: "1px solid rgba(251,191,36,.35)",
              borderRadius: 10, padding: "10px 12px",
            }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
            <div style={{ fontSize: 11, opacity: .55, marginTop: 2 }}>
              {[p.team, p.pos, p.year].filter(Boolean).join(" · ")}
            </div>
            <span style={{
              display: "inline-block", marginTop: 6, fontSize: 10, fontWeight: 700,
              color: "#0e1521", background: "#fbbf24", padding: "1px 8px", borderRadius: 8,
            }}>
              Drafted
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
