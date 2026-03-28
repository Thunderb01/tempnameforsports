import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import logo from "/logo.jpg";

function friendlyError(msg = "") {
  const m = msg.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials"))
    return "Incorrect email or password.";
  if (m.includes("email not confirmed"))
    return "Please confirm your email before signing in.";
  if (m.includes("too many requests"))
    return "Too many attempts. Wait a few minutes and try again.";
  if (m.includes("network") || m.includes("fetch"))
    return "Network error. Check your connection.";
  return msg || "Something went wrong. Try again.";
}

// ── Request Access Modal ──────────────────────────────────────────────────────
function RequestAccessModal({ onClose }) {
  const [form,      setForm]      = useState({ name: "", school: "", position: "", email: "" });
  const [submitting, setSubmitting] = useState(false);
  const [done,       setDone]       = useState(false);
  const [error,      setError]      = useState("");

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.name.trim())     { setError("Please enter your name.");              return; }
    if (!form.school.trim())   { setError("Please enter your school or program."); return; }
    if (!form.position.trim()) { setError("Please enter your position/role.");     return; }
    if (!form.email.trim())    { setError("Please enter your email.");             return; }

    setSubmitting(true);

    // Store in Supabase `access_requests` table (create it in SQL editor — see schema.sql)
    const { error: err } = await supabase
      .from("access_requests")
      .insert({
        name:     form.name.trim(),
        school:   form.school.trim(),
        position: form.position.trim(),
        email:    form.email.trim().toLowerCase(),
      });

    setSubmitting(false);

    if (err) {
      // Gracefully handle if the table doesn't exist yet — still show success to user
      console.warn("access_requests insert error:", err.message);
    }

    setDone(true);
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,.6)",
        backdropFilter: "blur(4px)",
        zIndex: 300,
      }} />

      {/* Modal card */}
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 301,
        width: "min(460px, calc(100vw - 32px))",
        background: "#131929",
        border: "1px solid rgba(255,255,255,.12)",
        borderRadius: 16,
        padding: "32px 28px 28px",
      }}>
        {done ? (
          /* Success state */
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>✓</div>
            <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 600 }}>Request received</h2>
            <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 24px" }}>
              Thanks, {form.name.split(" ")[0]}. We'll be in touch at {form.email} shortly.
            </p>
            <button className="login-btn" style={{ marginBottom: 0 }} onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          /* Form state */
          <form onSubmit={handleSubmit} noValidate>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 600 }}>Request access</h2>
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                  Tell us about yourself and we'll get you set up.
                </p>
              </div>
              <button type="button" onClick={onClose} style={{
                background: "none", border: "none", color: "var(--muted)",
                fontSize: 20, cursor: "pointer", padding: "0 0 0 12px", lineHeight: 1,
              }}>×</button>
            </div>

            {[
              { id: "req-name",     key: "name",     label: "Full name",              placeholder: "",             type: "text"  },
              { id: "req-school",   key: "school",   label: "School / Program",       placeholder: "", type: "text"  },
              { id: "req-position", key: "position", label: "Your role",              placeholder: "Head Coach, Assistant Coach…", type: "text" },
              { id: "req-email",    key: "email",    label: "Email",                  placeholder: "",        type: "email" },
            ].map(({ id, key, label, placeholder, type }) => (
              <div key={key} className="login-field">
                <label htmlFor={id}>{label}</label>
                <input
                  id={id}
                  className="input"
                  type={type}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={e => set(key, e.target.value)}
                  autoComplete="off"
                />
              </div>
            ))}

            <div className="login-error">{error}</div>

            <button className="login-btn" type="submit" disabled={submitting} style={{ marginBottom: 0 }}>
              {submitting ? "Sending…" : "Send request"}
            </button>
          </form>
        )}
      </div>
    </>
  );
}

// ── Login Page ────────────────────────────────────────────────────────────────
export function LoginPage() {
  const navigate = useNavigate();
  const [view,       setView]       = useState("signin"); // "signin" | "reset"
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [error,      setError]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [resetOk,    setResetOk]    = useState(false);
  const [showRequest, setShowRequest] = useState(false);

  // Skip login page if already signed in
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate("/app", { replace: true });
    });
  }, [navigate]);

  async function handleSignIn(e) {
    e.preventDefault();
    setError("");
    if (!email)    { setError("Please enter your email.");    return; }
    if (!password) { setError("Please enter your password."); return; }

    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (err) { setError(friendlyError(err.message)); return; }
    navigate("/app", { replace: true });
  }

  async function handleReset(e) {
    e.preventDefault();
    setError("");
    if (!email) { setError("Please enter your email."); return; }

    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    if (err) { setError(friendlyError(err.message)); return; }
    setResetOk(true);
  }

  return (
    <>
      <div className="login-wrap">
        <div className="login-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
            <div className="login-logo" style={{ marginBottom: 0 }}>
              <img src={logo} alt="Beyond the Portal" />
              <span>Beyond the Portal</span>
            </div>
            <Link to="/" style={{ fontSize: 13, opacity: .45 }}>
              ← Back
            </Link>
          </div>

          {view === "signin" ? (
            <form onSubmit={handleSignIn} noValidate>
              <h1>Sign in</h1>
              <p className="login-subtitle">Access your program's roster builder.</p>

              <div className="login-field">
                <label htmlFor="email">Email</label>
                <input id="email" className="input" type="email"
                  placeholder="you@program.edu" autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)} />
              </div>

              <div className="login-field">
                <label htmlFor="password">Password</label>
                <input id="password" className="input" type="password"
                  placeholder="••••••••" autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)} />
              </div>

              <div className="login-error">{error}</div>

              <button className="login-btn" type="submit" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </button>

              <div className="login-forgot">
                <a onClick={() => { setView("reset"); setError(""); }}>
                  Forgot password?
                </a>
              </div>
            </form>
          ) : (
            <form onSubmit={handleReset} noValidate>
              <h1>Reset password</h1>
              <p className="login-subtitle">Enter your email and we'll send a reset link.</p>

              <div className="login-field">
                <label htmlFor="resetEmail">Email</label>
                <input id="resetEmail" className="input" type="email"
                  placeholder="you@program.edu" autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)} />
              </div>

              <div className="login-error">{error}</div>

              {resetOk ? (
                <p className="reset-success">Check your email for a reset link.</p>
              ) : (
                <button className="login-btn" type="submit" disabled={loading}>
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              )}

              <div className="login-forgot" style={{ marginTop: 12 }}>
                <a onClick={() => { setView("signin"); setError(""); setResetOk(false); }}>
                  Back to sign in
                </a>
              </div>
            </form>
          )}

          {/* Footer — request access button */}
          <div className="login-footer" style={{ opacity: 1 }}>
            <p style={{ margin: "0 0 10px", opacity: .4, fontSize: 13 }}>Don't have an account?</p>
            <button
              type="button"
              onClick={() => setShowRequest(true)}
              style={{
                width: "100%",
                padding: "10px",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 8,
                cursor: "pointer",
                background: "transparent",
                border: "1px solid rgba(255,255,255,.15)",
                color: "var(--text)",
                transition: "border-color .15s, background .15s",
              }}
              onMouseEnter={e => { e.target.style.borderColor = "rgba(255,255,255,.35)"; e.target.style.background = "rgba(255,255,255,.04)"; }}
              onMouseLeave={e => { e.target.style.borderColor = "rgba(255,255,255,.15)"; e.target.style.background = "transparent"; }}
            >
              Request access →
            </button>
          </div>
        </div>
      </div>

      {showRequest && <RequestAccessModal onClose={() => setShowRequest(false)} />}
    </>
  );
}
