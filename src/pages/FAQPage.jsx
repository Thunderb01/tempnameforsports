import { useState } from "react";
import { Link } from "react-router-dom";
import logo from "/logo.jpg";

const FAQS = [
  {
    q: "What is Beyond the Portal?",
    a: "Beyond the Portal is a data platform built for Division I basketball programs. It gives coaching staffs NIL valuations for transfer portal players, a full recruiting board, portal class rankings, and access to international prospect matching — all in one place.",
  },
  {
    q: "How does the NIL valuation model work?",
    a: "Our model combines advanced player metrics (scoring efficiency, athleticism, rim impact, defending, playmaking) with statistical production and market comparables to generate a defensible dollar range for each player. Values reflect what a player is realistically worth to a program competing in today's NIL landscape.",
  },
  {
    q: "How often is the data updated?",
    a: "Player statistics and portal status are updated regularly throughout the season. NIL valuations are recalculated whenever new performance data is available. You can always see the most current numbers by refreshing the board.",
  },
  {
    q: "What does 'Market Production Value Range' mean?",
    a: "It's our estimate of the low-to-high NIL range a player would command in the open market based on their production and role. It's not a specific offer figure — it's a negotiation anchor to help your staff make offers that are competitive without overpaying.",
  },
  {
    q: "Who is this built for?",
    a: "Division I head coaches, assistant coaches, and recruiting coordinators who are actively building rosters through the transfer portal and want data to back their decisions.",
  },
  {
    q: "How do I get access?",
    a: "Click 'Request Access' on the sign-in page and fill out a short form with your name, school, and role. We'll review it and reach out — typically within 48 hours.",
  },
  {
    q: "Is my data and activity private?",
    a: "Yes. Your roster builds, shortlists, and search activity are private to your account. We don't share program-specific data or activity with other users.",
  },
  {
    q: "What is the International Player Matching service?",
    a: "Coaches submit a needs profile — position, statistical benchmarks, culture fit, NIL target — and our global agent network identifies prospects who fit. You receive a curated shortlist with film, a scouting report, agent context, and direct contact info.",
  },
  {
    q: "How accurate are the valuations?",
    a: "Valuations are model-driven estimates grounded in real market data — not guarantees. They're most useful as a relative ranking tool and negotiation starting point. We continually refine the model as more real deal data becomes available.",
  },
  {
    q: "Can I try it before committing?",
    a: "Yes. We offer a free evaluation — one NIL valuation or one international shortlist — before you make any commitment. No credit card, no pressure.",
  },
];

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        padding: "0",
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", textAlign: "left", background: "none", border: "none",
          padding: "20px 0", cursor: "pointer", color: "var(--text)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "1rem", lineHeight: 1.4 }}>{q}</span>
        <span style={{ fontSize: 18, opacity: .45, flexShrink: 0, transition: "transform .2s", transform: open ? "rotate(45deg)" : "none" }}>+</span>
      </button>
      {open && (
        <p style={{ margin: "0 0 20px", fontSize: ".95rem", lineHeight: 1.75, color: "var(--muted)", maxWidth: "72ch" }}>
          {a}
        </p>
      )}
    </div>
  );
}

export function FAQPage() {
  return (
    <>
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

      <main className="about-shell">
        <div className="about-hero" style={{ paddingBottom: 32 }}>
          <div className="eyebrow">Support</div>
          <h1 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: "clamp(2rem, 4vw, 3rem)", margin: "0 0 16px" }}>
            Frequently Asked Questions
          </h1>
          <p style={{ fontSize: "1.05rem", lineHeight: 1.75, color: "var(--muted)", margin: 0, maxWidth: "56ch" }}>
            Everything you need to know about Beyond the Portal. Can't find your answer?{" "}
            <Link to="/login" style={{ color: "rgba(85,130,255,.9)", textDecoration: "underline" }}>
              Request access
            </Link>{" "}
            and reach out directly.
          </p>
        </div>

        <div style={{ marginBottom: 64 }}>
          {FAQS.map((item, i) => <FAQItem key={i} {...item} />)}
        </div>

        <div className="cta-banner">
          <div className="cta-text">
            <h2>Ready to get started?</h2>
            <p>Request access and we'll get you set up within 48 hours.</p>
          </div>
          <div className="cta-action">
            <Link to="/login" className="btn-cta">Request Access →</Link>
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>© {new Date().getFullYear()} Beyond the Portal. All rights reserved. · <Link to="/" style={{ opacity: .6 }}>Home</Link></p>
      </footer>
    </>
  );
}
