// auth.js — Supabase auth wrapper
// Import this in login.html and app.js.
//
// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// Replace the two values below with your Supabase project's URL and anon key.
// These are safe to expose client-side — Supabase's anon key is designed to be
// public. Row-level security on the `coaches` table controls what each user
// can actually read/write.
//
// Find them at: Supabase dashboard → Settings → API
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL      = "https://eovdervlwpkrooxdxbnd.supabase.co";   // ← replace
const SUPABASE_ANON_KEY = "sb_publishable_tll4oo3oPsPCmRWyXXJagw_Xhp3NWS2";                  // ← replace

// ── Load Supabase JS client from CDN ─────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Sign in with email + password ─────────────────────────────────────────────
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// ── Sign out ──────────────────────────────────────────────────────────────────
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ── Get current session ───────────────────────────────────────────────────────
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// ── Get logged-in user ────────────────────────────────────────────────────────
export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

// ── Fetch the coach's profile row (team + display name) ───────────────────────
// This hits the `coaches` table you created in Supabase.
export async function getCoachProfile(userId) {
  const { data, error } = await supabase
    .from("coaches")
    .select("team, display_name, role")
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  return data; // { team: "Rutgers", display_name: "Coach Smith", role: "coach" }
}

// ── Password reset request ────────────────────────────────────────────────────
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password.html`,
  });
  if (error) throw error;
}

// ── Require auth: redirect to login if no session ────────────────────────────
// Call this at the top of any protected page (app.html, board.html, etc.)
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.replace("./login.html");
    return null;
  }
  return session;
}
