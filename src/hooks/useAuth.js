import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Returns { session, user, profile, loading }
 * - session:  raw Supabase session (null if not signed in)
 * - user:     Supabase auth user
 * - profile:  row from the `coaches` table { team, display_name, role }
 * - loading:  true while we're waiting for the initial auth check
 */
export function useAuth() {
  const [session, setSession]   = useState(undefined); // undefined = not yet checked
  const [profile, setProfile]   = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });

    // Listen for sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Fetch coach profile whenever session changes
  useEffect(() => {
    if (!session) {
      setProfile(null);
      setLoading(false);
      return;
    }

    supabase
      .from("coaches")
      .select("team, display_name, role")
      .eq("user_id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error) console.warn("Could not load coach profile:", error.message);
        setProfile(data ?? null);
        setLoading(false);
      });
  }, [session]);

  return {
    session,
    user:    session?.user ?? null,
    profile,
    loading: session === undefined || loading,
  };
}
