import { useState, useEffect } from "react";
import teams from "@/data/allTeams.json";

const ADMIN_TEAM_KEY = "bp_admin_selected_team";

export function useAdminTeam(profile) {
  const isSuperAdmin   = profile?.role === "superadmin";
  const isAdmin        = profile?.role === "admin" || isSuperAdmin;
  const isNonAffiliate = profile?.role === "nonaffiliate";
  const canSelectTeam  = isAdmin || isNonAffiliate;

  // Pre-populate from localStorage immediately so the dropdown isn't blank on first render
  const [selectedTeam, _setSelectedTeam] = useState(
    () => localStorage.getItem(ADMIN_TEAM_KEY) || ""
  );

  // Once profile resolves, fall back to profile.team if nothing was saved
  useEffect(() => {
    if (!profile) return;
    if (canSelectTeam) {
      if (!selectedTeam) _setSelectedTeam(profile.team || "");
    } else {
      _setSelectedTeam(profile.team || "");
    }
  }, [profile?.role, profile?.team]);

  function setSelectedTeam(team) {
    localStorage.setItem(ADMIN_TEAM_KEY, team);
    _setSelectedTeam(team);
  }

  const activeTeam = canSelectTeam ? selectedTeam : (profile?.team || "");

  return { isSuperAdmin, isAdmin, isNonAffiliate, activeTeam, selectedTeam, setSelectedTeam, allTeams: teams };
}
