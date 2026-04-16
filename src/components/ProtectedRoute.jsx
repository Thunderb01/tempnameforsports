import { useEffect, useRef } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAdminTeam } from "@/hooks/useAdminTeam";
import { supabase } from "@/lib/supabase";

function useSessionTracking(userId) {
  const sessionIdRef = useRef(null);

  useEffect(() => {
    if (!userId) return;

    let ended = false;

    // Start session
    supabase
      .from("user_sessions")
      .insert({ user_id: userId })
      .select("id")
      .single()
      .then(({ data }) => {
        if (data) sessionIdRef.current = data.id;
      });

    // Heartbeat every 30s to keep last_seen fresh
    const heartbeat = setInterval(() => {
      if (sessionIdRef.current) {
        supabase
          .from("user_sessions")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", sessionIdRef.current);
      }
    }, 30_000);

    function endSession() {
      if (ended || !sessionIdRef.current) return;
      ended = true;
      const now = new Date().toISOString();
      navigator.sendBeacon
        ? supabase.from("user_sessions").update({ ended_at: now }).eq("id", sessionIdRef.current)
        : supabase.from("user_sessions").update({ ended_at: now }).eq("id", sessionIdRef.current);
    }

    window.addEventListener("beforeunload", endSession);
    return () => {
      clearInterval(heartbeat);
      endSession();
      window.removeEventListener("beforeunload", endSession);
    };
  }, [userId]);
}

/**
 * Wraps protected routes. Redirects to /login if not authenticated.
 * Shows a loading state while the session is being checked.
 */
export function ProtectedRoute() {
  const { session, loading } = useAuth();
  useSessionTracking(session?.user?.id ?? null);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", opacity: .4 }}>
        Loading…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

/**
 * Wraps routes that require superadmin role.
 * Redirects to /app if authenticated but not superadmin.
 */
export function SuperAdminRoute() {
  const { session, profile, loading } = useAuth();
  const { isSuperAdmin } = useAdminTeam(profile);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", opacity: .4 }}>
        Loading…
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (!isSuperAdmin) return <Navigate to="/app" replace />;

  return <Outlet />;
}
