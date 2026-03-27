import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import logo from "/logo.jpg";

export function ResetPasswordPage() {
  const navigate  = useNavigate();
  const [pw1,     setPw1]     = useState("");
  const [pw2,     setPw2]     = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [ready,   setReady]   = useState(false);

  // Supabase puts the recovery token in the URL hash and fires PASSWORD_RECOVERY
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (pw1.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (pw1 !== pw2)    { setError("Passwords don't match."); return; }

    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw1 });
    setLoading(false);

    if (err) { setError(err.message); return; }
    setDone(true);
    setTimeout(() => navigate("/login", { replace: true }), 2500);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <img src={logo} alt="Beyond the Portal" />
          <span>Beyond the Portal</span>
        </div>

        {done ? (
          <>
            <h1>Password updated</h1>
            <p className="reset-success" style={{ textAlign: "left", marginTop: 12 }}>
              Your password has been set. Redirecting to sign in…
            </p>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <h1>Set new password</h1>
            <p className="login-subtitle">Choose a new password for your account.</p>

            <div className="login-field">
              <label htmlFor="pw1">New password</label>
              <input id="pw1" className="input" type="password"
                placeholder="At least 8 characters" autoComplete="new-password"
                value={pw1} onChange={e => setPw1(e.target.value)} />
            </div>
            <div className="login-field">
              <label htmlFor="pw2">Confirm password</label>
              <input id="pw2" className="input" type="password"
                placeholder="••••••••" autoComplete="new-password"
                value={pw2} onChange={e => setPw2(e.target.value)} />
            </div>

            <div className="login-error">{error}</div>

            <button className="login-btn" type="submit" disabled={loading || !ready}>
              {loading ? "Saving…" : "Set password"}
            </button>

            {!ready && (
              <p style={{ fontSize: 13, opacity: .5, textAlign: "center" }}>
                Waiting for reset token… (open this page from the email link)
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
