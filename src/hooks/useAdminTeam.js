import { useState, useEffect } from "react";
import teams from "@/data/allTeams.json";

const ADMIN_TEAM_KEY = "bp_admin_selected_team";

export function useAdminTeam(profile) {
  const isAdmin = profile?.role === "admin";

  const [selectedTeam, _setSelectedTeam] = useState("");

  // Sync once profile is available (auth finishes loading)
  useEffect(() => {
    if (!profile) return;
    if (profile.role === "admin") {
      _setSelectedTeam(localStorage.getItem(ADMIN_TEAM_KEY) || profile.team || "");
    } else {
      _setSelectedTeam(profile.team || "");
    }
  }, [profile?.role, profile?.team]);

  function setSelectedTeam(team) {
    localStorage.setItem(ADMIN_TEAM_KEY, team);
    _setSelectedTeam(team);
  }

  const activeTeam = isAdmin ? selectedTeam : (profile?.team || "");

  return { isAdmin, activeTeam, selectedTeam, setSelectedTeam, allTeams: teams };
}
