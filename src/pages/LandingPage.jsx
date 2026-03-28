import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import logo from "/logo.jpg";

// Content is driven by about.json in /public so you can edit it without touching code
const ABOUT_URL = "/about.json";

const AVATAR_CLASSES = ["av-0", "av-1", "av-2", "av-3", "av-4"];

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
                <div key={i} className="team-card" style={{ animationDelay: `${i * 0.08}s` }}>
                  <div className={`team-avatar ${AVATAR_CLASSES[i % AVATAR_CLASSES.length]}`}>
                    {p.initials}
                  </div>
                  <div className="team-name">{p.name}</div>
                  <div className="team-role">{p.role}</div>
                  <p className="team-bio">{p.bio}</p>
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
