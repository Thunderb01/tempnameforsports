import { NavLink, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import logo from "/logo.jpg";

export function SiteHeader() {
  const { profile } = useAuth();
  const navigate    = useNavigate();

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <div className="site-header-wrap">
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
          <NavLink to="/sandbox" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Roster Sandbox
          </NavLink>

          {profile && (
            <span style={{ fontSize: 13, opacity: .45, padding: "0 6px" }}>
              {profile.team}
            </span>
          )}

          <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: 13 }}>
            Sign out
          </button>
        </nav>
      </header>
    </div>
  );
}
