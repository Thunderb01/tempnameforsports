import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

// Single shared source for app-wide feature toggles a superadmin controls
// from /admin, rather than per-user/per-team local state (see
// supabase/app_settings.sql). Currently just transfer_season_active --
// gates whether the Roster Builder's retention-status label ("Returning")
// is shown; outside the actual transfer window every on_board player
// defaults to "returning" anyway, so the label is pure noise.
export function useAppSettings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from("app_settings").select("key, value");
    if (!error) {
      setSettings(Object.fromEntries((data || []).map(r => [r.key, r.value])));
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const setSetting = useCallback(async (key, value) => {
    setSettings(s => ({ ...s, [key]: value })); // optimistic -- RLS rejects non-superadmins anyway
    const { error } = await supabase.from("app_settings").upsert({ key, value });
    if (error) {
      console.error("app_settings update:", error);
      refresh(); // revert the optimistic flip on failure
    }
  }, [refresh]);

  return {
    loading,
    transferSeasonActive: settings.transfer_season_active ?? false,
    setTransferSeasonActive: v => setSetting("transfer_season_active", v),
  };
}
