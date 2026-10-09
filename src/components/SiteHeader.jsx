import { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useAdminTeam } from "@/hooks/useAdminTeam";
import { useTeamLogos } from "@/hooks/useTeamLogos";
import { useNilVisible } from "@/hooks/useNilVisible";
import logo from "/logo.jpg";

// Map a men's path → its women's equivalent and vice versa. Add entries as
// you fork more pages. Anything not in the map falls back to the sport home.
const W_HOME = "/w/app";
const M_HOME = "/app";
const M_TO_W = {
  "/app":           "/w/app",
  "/board":         "/w/board",
  "/rankings":      "/w/rankings",
  "/compare":       "/w/compare",
  "/international": "/w/international",
};
const W_TO_M = Object.fromEntries(Object.entries(M_TO_W).map(([m, w]) => [w, m]));

// Prepend `/w` (or strip it) so a NavLink rendered in the active sport stays
// in that sport. Used by every nav link below.
function pathForSport(menPath, sport) {
  if (sport === "women") return M_TO_W[menPath] || menPath;
  return menPath;
}

// `stickyExtra` lets a page add its own row inside the header's sticky
// wrapper — e.g. a compact search/filter-count bar that only needs to show
// once the page's own full filter panel has scrolled out of view. Rendering
// it here (rather than as a separately-positioned sticky element on the
// page) means it stacks naturally below the banner/nav with no pixel-offset
// math, since it shares the same sticky box.
export function SiteHeader({ stickyExtra = null }) {
  const { profile } = useAuth();
  const { isSuperAdmin, isAdmin } = useAdminTeam(profile);
  const teamLogos = useTeamLogos();
  const navigate  = useNavigate();
  const { pathname } = useLocation();
  const [nilVisible, toggleNil] = useNilVisible();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const canToggleSport = isAdmin || isSuperAdmin;
  const sport = pathname.startsWith("/w/") ? "women" : "men";

  // Collapse the mobile menu on route change (NavLink clicks) and on any other
  // interaction inside it (NIL toggle, sign out, etc.) — nothing should leave
  // the dropdown hanging open over the page it just navigated away from.
  function closeMenu() { setMenuOpen(false); }
  function switchSport(next) {
    if (next === sport) return;
    const target = next === "women"
      ? (M_TO_W[pathname] || W_HOME)
      : (W_TO_M[pathname] || M_HOME);
    navigate(target);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  // The nav dropdown lives inline under the header (not an overlay), so
  // opening it from deep in a scrolled page would land out of view — scroll
  // to top first so the person actually sees it.
  function openMenuFromBottomBar() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setMenuOpen(true);
  }

  return (
    <>
    <div className="site-header-wrap">
      {!bannerDismissed && (
        <div style={{ background: "#1e3a5f", borderBottom: "1px solid rgba(91,156,246,.25)", padding: "6px 40px 6px 16px", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,.75)", letterSpacing: ".01em", position: "relative" }}>
          Remember to regularly refresh the site by hitting Ctrl+Shift+R or Command+Shift+R. We are constantly making changes to improve the user experience.
          <button onClick={() => setBannerDismissed(true)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "rgba(255,255,255,.5)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>✕</button>
        </div>
      )}
      <header className="site-header">
        <NavLink to={pathForSport("/app", sport)} className="brand">
          <img className="brand-logo" src={logo} alt="Beyond the Portal" />
          <span>Beyond the Portal{sport === "women" ? " · W" : ""}</span>
        </NavLink>

        <button
          type="button"
          className={"nav-toggle" + (menuOpen ? " open" : "")}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(o => !o)}
        >
          <span /><span /><span />
        </button>

        <nav className={"nav" + (menuOpen ? " nav-open" : "")} onClick={closeMenu}>
          <NavLink to={pathForSport("/app", sport)}   className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Roster Builder
          </NavLink>
          <NavLink to={pathForSport("/board", sport)} className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Full Board
          </NavLink>
          <NavLink to={pathForSport("/rankings", sport)} className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Portal Rankings (beta)
          </NavLink>
          <NavLink to={pathForSport("/compare", sport)} className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Compare Players
          </NavLink>
          <NavLink to={pathForSport("/international", sport)} className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            International (coming soon)
          </NavLink>
          <NavLink to="/news" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            News
          </NavLink>
          <NavLink to="/historical" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Time Machine
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

          <button onClick={toggleNil}
            title={nilVisible ? "Hide NIL dollar valuations (show Overall only)" : "Show NIL dollar valuations"}
            className="btn btn-ghost" style={{ fontSize: 12, padding: "3px 10px" }}>
            {nilVisible ? "🙈 Hide NIL $" : "👁 Show NIL $"}
          </button>

          {canToggleSport && (
            <div title="Switch between men's and women's data sources"
              style={{
                display: "inline-flex", border: "1px solid rgba(255,255,255,.15)",
                borderRadius: 999, overflow: "hidden", marginRight: 4,
              }}>
              {[["men", "M"], ["women", "W"]].map(([val, lbl]) => (
                <button key={val} onClick={() => switchSport(val)} style={{
                  fontSize: 12, fontWeight: 700, padding: "3px 11px",
                  background:   sport === val ? (val === "women" ? "rgba(244,114,182,.20)" : "rgba(91,156,246,.20)") : "transparent",
                  color:        sport === val ? (val === "women" ? "#f472b6"             : "#5b9cf6")            : "rgba(255,255,255,.50)",
                  border: "none", cursor: "pointer", outline: "none",
                }}>{lbl}</button>
              ))}
            </div>
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
      {stickyExtra}
    </div>

    {/* Mobile-only bottom tab bar — quick access to the two pages people
        actually live in (Roster Builder, Board) without opening the
        hamburger menu every time. "Menu" opens the same dropdown above. */}
    <nav className="bottom-tab-bar">
      <NavLink to={pathForSport("/app", sport)} className={({ isActive }) => "bottom-tab" + (isActive ? " active" : "")}>
        Roster
      </NavLink>
      <NavLink to={pathForSport("/board", sport)} className={({ isActive }) => "bottom-tab" + (isActive ? " active" : "")}>
        Board
      </NavLink>
      <button type="button" className="bottom-tab" onClick={openMenuFromBottomBar}>
        Menu
      </button>
    </nav>
    </>
  );
}
