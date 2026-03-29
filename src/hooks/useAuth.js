import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

export function useAuth() {
  const [session, setSession] = useState(undefined); // undefined = not yet checked
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchingFor = useRef(null); // tracks which user_id we last fetched for

  useEffect(() => {
    let mounted = true;
    console.log("useAuth: checking session on mount...");

    async function init() {
      // 1. Get the current session first
      const { data } = await supabase.auth.getSession();
      const initialSession = data.session ?? null;

      if (!mounted) return;
      setSession(initialSession);

      // 2. If there's a session, fetch the profile before marking loading=false
      if (initialSession) {
      
        await fetchProfile(initialSession.user.id, mounted);
      } else {
        setLoading(false);
      }
    }

    init();
    

    // 3. Listen for future auth changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mounted) return;
        setSession(newSession ?? null);

        if (newSession) {
          await fetchProfile(newSession.user.id, mounted);
        } else {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      fetchingFor.current = null;
      subscription.unsubscribe();
    };
  }, []);

  async function fetchProfile(userId, mounted = true) {
  console.log("fetchProfile start", { userId, fetchingFor: fetchingFor.current });

  if (fetchingFor.current === userId) {
    console.log("skipping duplicate fetch for", userId);
    return;
  }

  fetchingFor.current = userId;

  try {
    //debug to see if coaches table exists
    
     
    console.log("about to query coaches for", userId);

    // temp: test if supabase client can reach the DB at all
    const { data: testData, error: testError } = await supabase.from("coaches").select("count").limit(1);
    console.log("test query result", { testData, testError });

    let { data: coaches, error } = await supabase
      .from("coaches")
      .select("team, display_name, role")
      .eq("user_id", userId)
      .maybeSingle();

    console.log("query finished", { coaches, error });

    if (!mounted) {
      console.log("component unmounted before profile set");
      return;
    }

    if (error) {
      console.warn("Could not load coach profile:", error.message);
    }

    setProfile(coaches ?? null);
    setLoading(false);
    console.log("setProfile/setLoading done");
  } catch (err) {
    console.error("fetchProfile crashed", err);
    setLoading(false);
  }
}
  //debug log to help track down loading issues
  console.log("useAuth return", {
    session,
    profile,
    loadingState: loading,
    finalLoading: session === undefined || loading,
  });



  return {
    session,
    user:    session?.user ?? null,
    profile,
    loading: session === undefined || loading,
  };
}
