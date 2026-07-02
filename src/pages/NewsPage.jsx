import { useState, useEffect, useCallback } from "react";
import { SiteHeader }  from "@/components/SiteHeader";
import { PlayerModal } from "@/components/PlayerModal";
import { supabase }    from "@/lib/supabase";
import { renderArticleBody } from "@/lib/renderArticle";

// vw_players row → the shape PlayerModal expects (mirrors PortalRankingsPage.toModalPlayer).
function toModalPlayer(p) {
  return {
    id:           p.id,
    name:         p.name,
    espn_id:      p.espn_id          ?? null,
    team:         p.current_team     ?? null,
    conf:         p.conference       ?? null,
    pos:          p.primary_position ?? null,
    year:         p.year             ?? null,
    height:       p.height           ?? null,
    hometown:     p.hometown         ?? null,
    marketLow:    p.open_market_low  ?? 0,
    marketHigh:   p.open_market_high ?? 0,
    nilValuation: p.nil_valuation    ?? 0,
  };
}

function fmtEventDate(d) {
  if (!d) return null;
  // d is a YYYY-MM-DD string; parse as local without TZ drift.
  const [y, m, day] = d.split("-").map(Number);
  if (!y) return null;
  return new Date(y, (m || 1) - 1, day || 1).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function NewsPage() {
  const [posts,   setPosts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);

  useEffect(() => {
    supabase.from("news_posts")
      .select("id, title, body, event_date, pinned, author_name, published_at, created_at")
      .eq("status", "published")
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error("news fetch:", error);
        setPosts(data || []);
        setLoading(false);
      });
  }, []);

  const openPlayer = useCallback(async (id) => {
    const { data, error } = await supabase
      .from("vw_players")
      .select("id, name, espn_id, current_team, conference, primary_position, year, height, hometown, open_market_low, open_market_high, nil_valuation")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) { alert("Player not found."); return; }
    setModal(toModalPlayer(data));
  }, []);

  return (
    <>
      <SiteHeader />
      <div className="app-shell">
        <div className="app-top">
          <h1 style={{ margin: 0 }}>News & Updates</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Portal news, roadmap, and upcoming events.</p>
        </div>

        <div style={{ maxWidth: 760, margin: "24px auto 0", display: "flex", flexDirection: "column", gap: 16 }}>
          {loading ? (
            <div style={{ opacity: .4, fontSize: 13 }}>Loading…</div>
          ) : posts.length === 0 ? (
            <div className="empty">No news yet — check back soon.</div>
          ) : posts.map(post => {
            const evt = fmtEventDate(post.event_date);
            return (
              <article key={post.id} style={{ background: "var(--panel)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                  {post.pinned && (
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em",
                      color: "#f5a623", background: "rgba(245,166,35,.15)", border: "1px solid rgba(245,166,35,.4)",
                      borderRadius: 20, padding: "2px 8px" }}>📌 Pinned</span>
                  )}
                  {evt && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#5b9cf6",
                      background: "rgba(91,156,246,.15)", border: "1px solid rgba(91,156,246,.4)",
                      borderRadius: 20, padding: "2px 10px" }}>📅 {evt}</span>
                  )}
                </div>
                <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>{post.title}</h2>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,.82)" }}>
                  {renderArticleBody(post.body, { onPlayer: openPlayer })}
                </div>
                {post.author_name && (
                  <div style={{ fontSize: 11, opacity: .4, marginTop: 8 }}>— {post.author_name}</div>
                )}
              </article>
            );
          })}
        </div>

        <div style={{ height: 40 }} />
      </div>

      {modal && <PlayerModal player={modal} onClose={() => setModal(null)} />}
    </>
  );
}
