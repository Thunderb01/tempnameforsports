import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import logo from "/logo.jpg";

// Content is driven by about.json in /public so you can edit it without touching code
const ABOUT_URL = "/about.json";

const AVATAR_CLASSES = ["av-0", "av-1", "av-2", "av-3", "av-4"];

function BrowserFrame({ src, alt, label }) {
  return (
    <div style={{
      borderRadius: 10, overflow: "hidden",
      border: "1px solid rgba(255,255,255,.1)",
      background: "#0e1521",
      boxShadow: "0 8px 32px rgba(0,0,0,.5)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Chrome bar */}
      <div style={{
        background: "#1a2236", padding: "8px 14px",
        display: "flex", alignItems: "center", gap: 8,
        borderBottom: "1px solid rgba(255,255,255,.07)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 5 }}>
          {["#ff5f57","#febc2e","#28c840"].map(c => (
            <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: .8 }} />
          ))}
        </div>
        {label && (
          <span style={{ fontSize: 11, opacity: .35, marginLeft: 6, fontWeight: 500 }}>{label}</span>
        )}
      </div>
      {/* Screenshot — fixed height, top-aligned so the most useful content shows */}
      <div style={{ background: "#0f1117", height: 300, overflow: "hidden", flexShrink: 0 }}>
        <img
          src={src} alt={alt}
          style={{ width: "100%", display: "block", objectFit: "cover", objectPosition: "top" }}
          onError={e => { e.target.style.display = "none"; }}
        />
      </div>
    </div>
  );
}

export function LandingPage() {
  const navigate  = useNavigate();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  // If already signed in, skip the landing page
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/app", { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    fetch(ABOUT_URL)
      .then(r => { if (!r.ok) throw new Error(`about.json not found (${r.status})`); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, []);

  return (
    <>
      {/* ── Header ── */}
      <div className="site-header-wrap">
        <header className="site-header">
          <Link to="/" className="brand">
            <img className="brand-logo" src={logo} alt="Beyond the Portal" />
            <span style={{ fontWeight: 800, fontSize: 15 }}>Beyond the Portal</span>
          </Link>
          <nav className="nav">
            <Link to="/login" className="btn btn-primary" style={{ fontSize: 14 }}>
              Sign in →
            </Link>
          </nav>
        </header>
      </div>

      {/* ── Body ── */}
      <main className="about-shell">

        {/* Hero */}
        <div className="about-hero">
          <div className="eyebrow">{data?.hero?.eyebrow ?? "Beyond the Portal"}</div>
          {loading
            ? <div className="sk" style={{ width: "75%", height: "2.4rem", marginBottom: 14 }} />
            : <h1 dangerouslySetInnerHTML={{ __html: data?.hero?.headline ?? "" }} />
          }
          <p className="intro">{data?.hero?.intro ?? ""}</p>
        </div>

        {/* Services */}
        <div className="services-grid">
          {loading
            ? [0, 1].map(i => (
                <div key={i} className="service-card">
                  <div className="sk" style={{ height: "1.4em", width: "80%", marginBottom: 12 }} />
                  <div className="sk" /><div className="sk" style={{ width: "90%" }} />
                </div>
              ))
            : (data?.services ?? []).map((s, i) => (
                <div key={i} className="service-card" style={{ animationDelay: `${i * 0.1}s` }}>
                  <div className="service-tag">{s.tag}</div>
                  <h3 className="service-title">{s.title}</h3>
                  <p className="service-body">{s.body}</p>
                  {s.bullets?.length > 0 && (
                    <ul className="service-bullets">
                      {s.bullets.map((b, j) => <li key={j}>{b}</li>)}
                    </ul>
                  )}
                </div>
              ))
          }
        </div>

        <div className="about-divider" />

        {/* Screenshots */}
        <div style={{ padding: "48px 0 12px", animation: "fadeUp .5s ease .1s both" }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>See it in action</div>
          <h2 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: "clamp(1.5rem, 3vw, 2.2rem)", margin: "0 0 36px" }}>
            Every tool your staff needs, in one place
          </h2>

          {/* 2×2 grid — all equal size */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            <BrowserFrame src="/screenshots/board.png"        alt="Full Board table view"                            label="Full Board"        />
            <BrowserFrame src="/screenshots/rankings.png"     alt="Portal Rankings – rank programs by transfer class" label="Portal Rankings"  />
            <BrowserFrame src="/screenshots/board-cards.png"  alt="Full Board card view"                             label="Player Cards"      />
            <BrowserFrame src="/screenshots/player-modal.png" alt="Player Card – NIL valuation and skill profile"    label="Player Card"       />
          </div>
        </div>

        <div className="about-divider" />

        {/* CTA */}
        <div className="cta-banner">
          <div className="cta-text">
            <h2>{data?.cta?.title ?? ""}</h2>
            <p>{data?.cta?.body ?? ""}</p>
          </div>
          <div className="cta-action">
            <Link to="/login" className="btn-cta">Get Started →</Link>
          </div>
        </div>

        <div className="about-divider" />

        {/* Closing */}
        <div className="closing-block">
          <h2>{data?.closing?.title ?? ""}</h2>
          <p>{data?.closing?.body ?? ""}</p>
        </div>

        <div className="about-divider" />

        {/* Team */}
        {(data?.team?.length > 0) && (
          <>
            <div className="team-header">
              <h2>Meet the Team</h2>
              <span>{data.team.length} member{data.team.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="team-grid">
              {data.team.map((p, i) => (
                <div key={i} className="team-card" style={{ animationDelay: `${i * 0.08}s`, position: "relative" }}>
                  {p.image
                    ? <img src={p.image} alt={p.name}
                        style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", objectPosition: "top", marginBottom: 12, display: "block" }}
                        onError={e => { e.target.style.display = "none"; }}
                      />
                    : <div className={`team-avatar ${AVATAR_CLASSES[i % AVATAR_CLASSES.length]}`}>{p.initials}</div>
                  }
                  <div className="team-name">{p.name}</div>
                  <div className="team-role">{p.role}</div>
                  <p className="team-bio" style={{ marginBottom: p.linkedin ? 40 : 0 }}>{p.bio}</p>
                  {p.linkedin && (
                    <a href={p.linkedin} target="_blank" rel="noopener noreferrer"
                      style={{
                        position: "absolute", bottom: 16, right: 16,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 32, height: 32, borderRadius: 8,
                        background: "#0a66c2", textDecoration: "none",
                        opacity: .85, transition: "opacity .15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                      onMouseLeave={e => e.currentTarget.style.opacity = .85}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                      </svg>
                    </a>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

      </main>

      <footer className="footer">
        <p>© {new Date().getFullYear()} Beyond the Portal. All rights reserved.</p>
      </footer>
    </>
  );
}
