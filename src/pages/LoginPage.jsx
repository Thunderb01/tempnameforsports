import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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

export function LoginPage() {
  const navigate = useNavigate();
  const [view,     setView]     = useState("signin"); // "signin" | "reset"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [resetOk,  setResetOk]  = useState(false);

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
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <img src={logo} alt="Beyond the Portal" />
          <span>Beyond the Portal</span>
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

        <div className="login-footer">
          Don't have an account? Contact Beyond the Portal to get set up.
        </div>
      </div>
    </div>
  );
}
