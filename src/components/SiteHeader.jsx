import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useAdminTeam } from "@/hooks/useAdminTeam";
import { useTeamLogos } from "@/hooks/useTeamLogos";
import logo from "/logo.jpg";

export function SiteHeader() {
  const { profile } = useAuth();
  const { isSuperAdmin } = useAdminTeam(profile);
  const teamLogos = useTeamLogos();
  const navigate  = useNavigate();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <div className="site-header-wrap">
      {!bannerDismissed && (
        <div style={{ background: "#1e3a5f", borderBottom: "1px solid rgba(91,156,246,.25)", padding: "6px 40px 6px 16px", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,.75)", letterSpacing: ".01em", position: "relative" }}>
          Remember to regularly refresh the site by hitting Ctrl+Shift+R or Command+Shift+R. We are constantly making changes to improve the user experience.
          <button onClick={() => setBannerDismissed(true)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "rgba(255,255,255,.5)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>✕</button>
        </div>
      )}
      <header className="site-header">
        <NavLink to="/app" className="brand">
          <img className="brand-logo" src={logo} alt="Beyond the Portal" />
          <span>Beyond the Portal</span>
        </NavLink>

        <nav className="nav">
          <NavLink to="/app"   className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Roster Builder
          </NavLink>
          <NavLink to="/board" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Full Board
          </NavLink>
<NavLink to="/compare" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Compare Players
          </NavLink>
          {/* <NavLink to="/portal" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Portal Tracker
          </NavLink> */}
          {isSuperAdmin && (
            <NavLink to="/admin" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              style={{ color: "#f5a623" }}>
              Admin
            </NavLink>
          )}

          {profile && (
            teamLogos[profile.team]
              ? <div title={profile.team} style={{ height: 42, width: 42, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 5 }}>
                  <img src={teamLogos[profile.team]} alt={profile.team} style={{ height: "100%", width: "100%", objectFit: "contain" }} />
                </div>
              : <span style={{ fontSize: 13, opacity: .45, padding: "0 6px" }}>{profile.team}</span>
          )}

          <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: 13 }}>
            Sign out
          </button>
        </nav>
      </header>
    </div>
  );
}
