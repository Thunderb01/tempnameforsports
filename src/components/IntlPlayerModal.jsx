import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth }  from "@/hooks/useAuth";
import { tierColor } from "@/lib/display";

// ── Stat column definitions (re-exported for InternationalPage's main table) ──
export const AVERAGES_COLS = [
  { key: "gp",  label: "GP"  }, { key: "min", label: "MIN" }, { key: "pts", label: "PTS" },
  { key: "reb", label: "REB" }, { key: "ast", label: "AST" }, { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" }, { key: "to",  label: "TO"  }, { key: "fg%", label: "FG%" },
  { key: "3p%", label: "3P%" }, { key: "ft%", label: "FT%" },
];
export const ADVANCED_COLS = [
  { key: "gp",   label: "GP"   }, { key: "min",  label: "MIN"  }, { key: "ortg", label: "ORtg" },
  { key: "drtg", label: "DRtg" }, { key: "per",  label: "PER"  }, { key: "ts%",  label: "TS%"  },
  { key: "efg%", label: "eFG%" }, { key: "usg%", label: "USG%" }, { key: "ast%", label: "AST%" },
  { key: "to%",  label: "TO%"  }, { key: "orb%", label: "ORB%" }, { key: "drb%", label: "DRB%" },
];
export const TOTALS_COLS = [
  { key: "gp",  label: "GP"  }, { key: "min", label: "MIN" }, { key: "pts", label: "PTS" },
  { key: "reb", label: "REB" }, { key: "ast", label: "AST" }, { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" }, { key: "to",  label: "TO"  }, { key: "fgm", label: "FGM" },
  { key: "fga", label: "FGA" }, { key: "3pm", label: "3PM" }, { key: "3pa", label: "3PA" },
];
export const STAT_TYPE_COLS   = { Averages: AVERAGES_COLS, Totals: TOTALS_COLS, Per_36: AVERAGES_COLS, Advanced_Stats: ADVANCED_COLS };
export const STAT_TYPES       = ["Averages", "Totals", "Per_36", "Advanced_Stats"];
export const STAT_TYPE_LABELS = { Averages: "Averages", Totals: "Totals", Per_36: "Per 36", Advanced_Stats: "Advanced" };
export const PCT_KEYS         = new Set(["fg%","3p%","ft%","ts%","efg%","usg%","ast%","to%","orb%","drb%"]);

export const TIER_LABELS_FALLBACK = { 1: "EuroLeague / Elite", 2: "Top Domestic", 3: "Mid Domestic", 4: "Developmental" };
export const TIER_COLORS = { 1: "#f59e0b", 2: "#5b9cf6", 3: "#4ade80", 4: "#9ca3af" };
export const TIER_BG     = { 1: "rgba(245,158,11,.15)", 2: "rgba(91,156,246,.15)", 3: "rgba(74,222,128,.15)", 4: "rgba(156,163,175,.12)" };

export const INTL_METRICS = [
  { key: "offensive_footprint", label: "Offensive Footprint", desc: "Scoring volume × efficiency × creation" },
  { key: "defensive_score",     label: "Defensive Score",     desc: "Rim protection + perimeter D + disruption rate" },
  { key: "winning_impact",      label: "Winning Impact",      desc: "Performance uplift in wins vs losses" },
  { key: "sos_performance",     label: "SOS Performance",     desc: "Output scaled for strength of schedule" },
  { key: "translation_grade",   label: "Translation Grade",   desc: "Projected fit & translation to D1 college level" },
];

// Stat-key aliases. RealGM's Averages tab uses per-game abbreviations (PPG/RPG/...)
// while every other tab uses raw totals (PTS/REB/...). Resolved here so the DB
// can stay "raw RealGM" without a re-scrape.
export const STAT_ALIASES = {
  pts: ["pts", "ppg"],
  reb: ["reb", "rpg", "trb"],
  ast: ["ast", "apg"],
  stl: ["stl", "spg"],
  blk: ["blk", "bpg"],
  to:  ["to",  "topg", "tpg", "tov"],
  min: ["min", "mpg"],
  gp:  ["gp",  "g"],
};
export function getStat(stats, key) {
  if (!stats) return undefined;
  const keys = STAT_ALIASES[key] || [key];
  for (const k of keys) {
    const v = stats[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export function fmtStatByKey(val, key) {
  if (val === null || val === undefined || val === "") return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  if (PCT_KEYS.has(key)) {
    const display = n < 1.5 ? (n * 100).toFixed(1) : n.toFixed(1);
    return `${display}%`;
  }
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function metricColor(val) {
  if (val == null) return "rgba(255,255,255,.15)";
  if (val >= 70) return "#4ade80";
  if (val >= 50) return "#fcd34d";
  return "#f87171";
}

function getYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|[?&]v=)([^&\s]{11})/);
  return m?.[1] ?? null;
}

function MetricBar({ label, desc, value }) {
  const color = metricColor(value);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, opacity: .85 }}>{label}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
          {value != null ? Math.round(value) : "—"}
        </span>
      </div>
      <div style={{ height: 5, background: "rgba(255,255,255,.08)", borderRadius: 3 }}>
        <div style={{ width: `${Math.min(value ?? 0, 100)}%`, height: "100%", background: color, borderRadius: 3, transition: "width .4s ease" }} />
      </div>
      <div style={{ fontSize: 10, opacity: .32, marginTop: 3 }}>{desc}</div>
    </div>
  );
}

export function TierBadge({ tier, tierLabels }) {
  if (!tier) return null;
  const label = (tierLabels && tierLabels[tier]) || TIER_LABELS_FALLBACK[tier];
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
      background: TIER_BG[tier], color: TIER_COLORS[tier],
      border: `1px solid ${TIER_COLORS[tier]}55`,
    }}>
      Tier {tier} · {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact form popup — captures a message about an intl player and writes a
// row to `contact_messages`. Rendered on top of the IntlPlayerModal so its
// backdrop click doesn't dismiss the parent modal.
// ─────────────────────────────────────────────────────────────────────────────
function ContactForm({ profile, onClose }) {
  const { user } = useAuth();
  const [name,    setName]    = useState("");
  const [email,   setEmail]   = useState("");
  const [team,    setTeam]    = useState("");
  const [message, setMessage] = useState("");
  const [busy,    setBusy]    = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState("");

  // Prefill from auth user when available
  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
    if (user?.user_metadata?.full_name && !name) setName(user.user_metadata.full_name);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setError("");
    if (!email.trim()) { setError("Email is required."); return; }
    if (!message.trim()) { setError("Please add a short message."); return; }
    setBusy(true);
    const payload = {
      player_id:   profile?.id ?? null,
      player_name: profile?.name ?? null,
      league:      profile?.league ?? null,
      agent_name:  profile?.agent_name ?? null,
      user_id:     user?.id ?? null,
      user_name:   name.trim() || null,
      user_email:  email.trim(),
      team:        team.trim() || null,
      message:     message.trim(),
    };
    const { error: err } = await supabase.from("contact_messages").insert(payload);
    setBusy(false);
    if (err) {
      console.error("contact_messages insert:", err);
      setError("Couldn't send — " + err.message);
      return;
    }
    setSent(true);
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 1100, overflowY: "auto", padding: "32px 16px" }}
      onClick={onClose}
    >
      <div style={{ maxWidth: 480, margin: "0 auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ background: "var(--bg, #0e1521)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Connect with {profile?.agent_name || "agent"}</h3>
            <button onClick={onClose} style={{
              background: "none", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8,
              color: "rgba(255,255,255,.5)", cursor: "pointer", fontSize: 14, padding: "2px 8px",
            }}>✕</button>
          </div>

          <div style={{ fontSize: 12, opacity: .55, marginBottom: 16 }}>
            Inquiry about <strong>{profile?.name}</strong>{profile?.league ? ` · ${profile.league}` : ""}.
            We'll forward your details and connect you with the agent.
          </div>

          {sent ? (
            <div style={{
              padding: 16, borderRadius: 10, textAlign: "center",
              background: "rgba(74,222,128,.10)", border: "1px solid rgba(74,222,128,.35)",
              color: "#4ade80",
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>✓ Message sent</div>
              <div style={{ fontSize: 12, opacity: .8 }}>We'll be in touch soon at {email}.</div>
              <button onClick={onClose} style={{
                marginTop: 14, fontSize: 12, padding: "5px 14px", borderRadius: 6, cursor: "pointer",
                background: "transparent", color: "#4ade80", border: "1px solid rgba(74,222,128,.4)",
              }}>Close</button>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 10, opacity: .5, textTransform: "uppercase", letterSpacing: ".05em" }}>Your name</span>
                  <input className="input" style={{ width: "100%", marginTop: 4 }}
                    value={name} onChange={e => setName(e.target.value)} placeholder="—" />
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 10, opacity: .5, textTransform: "uppercase", letterSpacing: ".05em" }}>Email *</span>
                  <input className="input" style={{ width: "100%", marginTop: 4 }} type="email"
                    value={email} onChange={e => setEmail(e.target.value)} placeholder="you@school.edu" />
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 10, opacity: .5, textTransform: "uppercase", letterSpacing: ".05em" }}>Program / Team</span>
                  <input className="input" style={{ width: "100%", marginTop: 4 }}
                    value={team} onChange={e => setTeam(e.target.value)} placeholder="e.g. Kentucky" />
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 10, opacity: .5, textTransform: "uppercase", letterSpacing: ".05em" }}>Message *</span>
                  <textarea className="input" rows={4} style={{ width: "100%", marginTop: 4, resize: "vertical", fontFamily: "inherit" }}
                    value={message} onChange={e => setMessage(e.target.value)}
                    placeholder="What's your interest in this player? Timeline, fit, NIL range, etc." />
                </label>
              </div>

              {error && (
                <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 6, fontSize: 12,
                              background: "rgba(224,92,92,.10)", border: "1px solid rgba(224,92,92,.35)",
                              color: "#f87171" }}>{error}</div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button onClick={onClose} disabled={busy} style={{
                  fontSize: 12, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                  background: "transparent", color: "rgba(255,255,255,.55)",
                  border: "1px solid rgba(255,255,255,.12)",
                }}>Cancel</button>
                <button onClick={submit} disabled={busy} style={{
                  fontSize: 12, fontWeight: 600, padding: "6px 16px", borderRadius: 8,
                  cursor: busy ? "wait" : "pointer",
                  background: "rgba(91,156,246,.18)", color: "#5b9cf6",
                  border: "1px solid rgba(91,156,246,.5)",
                }}>{busy ? "Sending…" : "Send message"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Rich modal for an international player.
 *
 * Required prop:
 *   profile — an international_players row (or a mapped roster entry that retains
 *             the original profile fields).
 *
 * Optional props:
 *   allRows     — pre-fetched stat rows; if omitted, the component fetches them.
 *   tierLabels  — pre-fetched tier labels; if omitted, they're fetched here too.
 *   onClose, onAddToRoster, alreadyOnRoster, canAddToRoster — same as the
 *                                                              version in InternationalPage.
 */
export function IntlPlayerModal({
  profile,
  allRows         = null,
  tierLabels: tierLabelsProp = null,
  onClose,
  onAddToRoster,
  alreadyOnRoster,
  canAddToRoster,
}) {
  const [statType,         setStatType]         = useState("Averages");
  const [contactOpen,      setContactOpen]      = useState(false);
  const [fetchedRows,      setFetchedRows]      = useState(null);
  const [fetchedTierLabels, setFetchedTierLabels] = useState(null);

  // Lazy-fetch stat rows if the caller didn't pre-load them.
  useEffect(() => {
    if (allRows !== null || !profile?.name) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("international_players_stats")
        .select("player_name, league, season, season_type, stat_type, team, stats")
        .eq("player_name", profile.name)
        .eq("league", profile.league);
      if (!alive) return;
      if (error) { console.error("intl stats fetch:", error); setFetchedRows([]); return; }
      setFetchedRows(data || []);
    })();
    return () => { alive = false; };
  }, [allRows, profile?.name, profile?.league]);

  // Lazy-fetch tier labels.
  useEffect(() => {
    if (tierLabelsProp !== null) return;
    let alive = true;
    supabase.from("international_tier_labels").select("tier, label").then(({ data }) => {
      if (!alive || !data?.length) return;
      const m = { ...TIER_LABELS_FALLBACK };
      data.forEach(r => { m[r.tier] = r.label; });
      setFetchedTierLabels(m);
    });
    return () => { alive = false; };
  }, [tierLabelsProp]);

  const effectiveRows       = allRows !== null ? allRows : (fetchedRows || []);
  const effectiveTierLabels = tierLabelsProp !== null ? tierLabelsProp : (fetchedTierLabels || TIER_LABELS_FALLBACK);

  const metrics    = profile?.metrics || {};
  const tier       = profile?.competition_tier;
  const ytId       = getYouTubeId(profile?.film_url);
  const playerName = profile?.name ?? "";

  const playerRows = useMemo(() =>
    effectiveRows
      .filter(r => r.player_name === playerName && r.stat_type === statType)
      .sort((a, b) => (b.season || 0) - (a.season || 0)),
    [effectiveRows, playerName, statType]
  );

  const statCols = STAT_TYPE_COLS[statType] ?? AVERAGES_COLS;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 1000, overflowY: "auto", padding: "32px 16px" }}
      onClick={onClose}
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ background: "var(--bg, #0e1521)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: 28 }}>

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
            <div>
              <h2 style={{ margin: "0 0 8px", fontSize: 24 }}>{playerName}</h2>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {profile?.height            && <span style={{ fontSize: 13, opacity: .55 }}>{profile.height}</span>}
                {profile?.primary_position  && <span style={{ fontSize: 13, opacity: .55 }}>· {profile.primary_position}</span>}
                {profile?.age               && <span style={{ fontSize: 13, opacity: .55 }}>· age {profile.age}</span>}
                {profile?.country_of_origin && <span style={{ fontSize: 13, opacity: .55 }}>· {profile.country_of_origin}</span>}
                {profile?.recruiting_class  && <span style={{ fontSize: 13, opacity: .55 }}>· class of {profile.recruiting_class}</span>}
                {profile?.league            && <span style={{ fontSize: 13, opacity: .55 }}>· {profile.league}</span>}
                {tier && <TierBadge tier={tier} tierLabels={effectiveTierLabels} />}
                {profile?.projected_tier && (() => {
                  const c = tierColor(profile.projected_tier);
                  return (
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                      background: `${c}1f`, color: c, border: `1px solid ${c}55`,
                    }}>
                      Projection · {profile.projected_tier}
                    </span>
                  );
                })()}
              </div>
              {profile?.profile_url && (
                <a href={profile.profile_url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11, color: "#5b9cf6", opacity: .7, marginTop: 6, display: "inline-block" }}>
                  RealGM Profile ↗
                </a>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {onAddToRoster && profile && (
                alreadyOnRoster ? (
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8,
                    background: "rgba(74,222,128,.12)", color: "#4ade80",
                    border: "1px solid rgba(74,222,128,.35)",
                  }}>✓ On roster</span>
                ) : (
                  <button onClick={() => onAddToRoster(profile)}
                    disabled={!canAddToRoster}
                    title={!canAddToRoster ? "Sign in and select a team to add players" : ""}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 8,
                      cursor: canAddToRoster ? "pointer" : "not-allowed",
                      background: canAddToRoster ? "rgba(91,156,246,.18)" : "rgba(255,255,255,.04)",
                      color: canAddToRoster ? "#5b9cf6" : "rgba(255,255,255,.3)",
                      border: `1px solid ${canAddToRoster ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.1)"}`,
                    }}>
                    + Add to Roster
                  </button>
                )
              )}
              <button onClick={onClose} style={{
                background: "none", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8,
                color: "rgba(255,255,255,.5)", cursor: "pointer", fontSize: 16, padding: "4px 10px",
              }}>✕</button>
            </div>
          </div>

          {/* Metrics */}
          <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, padding: "16px 20px", marginBottom: 20 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em", opacity: .35, fontWeight: 600, marginBottom: 14 }}>
              BTP International Metrics
            </div>
            {INTL_METRICS.some(m => metrics[m.key] != null) ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px 32px" }}>
                {INTL_METRICS.map(m => <MetricBar key={m.key} label={m.label} desc={m.desc} value={metrics[m.key]} />)}
              </div>
            ) : (
              <div style={{ fontSize: 12, opacity: .3, textAlign: "center", padding: "12px 0" }}>
                Metrics not yet evaluated for this player.
              </div>
            )}
          </div>

          {/* Scouting notes */}
          {profile?.scouting_notes && (
            <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, padding: "16px 20px", marginBottom: 20 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em", opacity: .35, fontWeight: 600, marginBottom: 10 }}>
                Scouting Notes
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55, opacity: .85, whiteSpace: "pre-wrap" }}>
                {profile.scouting_notes}
              </div>
            </div>
          )}

          {/* Film + Agent */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, padding: "16px 20px" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em", opacity: .35, fontWeight: 600, marginBottom: 12 }}>Film</div>
              {ytId ? (
                <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, borderRadius: 8, overflow: "hidden" }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${ytId}`}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Player film"
                  />
                </div>
              ) : profile?.film_url ? (
                <a href={profile.film_url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 13, color: "#5b9cf6", display: "flex", alignItems: "center", gap: 6 }}>
                  ▶ View Film ↗
                </a>
              ) : (
                <div style={{ fontSize: 12, opacity: .3 }}>No film linked yet.</div>
              )}
            </div>

            <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, padding: "16px 20px" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em", opacity: .35, fontWeight: 600, marginBottom: 12 }}>Agent</div>
              {profile?.agent_name ? (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{profile.agent_name}</div>
                  <div style={{ position: "relative", marginBottom: 12 }}>
                    <div style={{ fontSize: 12, opacity: .6, filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}>
                      {profile.agent_contact || "contact@agency.com"}
                    </div>
                    <div style={{
                      position: "absolute", inset: 0, display: "flex", alignItems: "center",
                      fontSize: 10, fontWeight: 600, opacity: .45, letterSpacing: ".05em",
                    }}>
                      CONTACT INFO PROTECTED
                    </div>
                  </div>
                  <button onClick={() => setContactOpen(true)} style={{
                    fontSize: 12, fontWeight: 600, padding: "6px 16px", borderRadius: 8, cursor: "pointer",
                    background: "rgba(91,156,246,.15)", color: "#5b9cf6", border: "1px solid rgba(91,156,246,.4)",
                  }}>
                    Contact Us to Connect
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: .3 }}>No agent info on file.</div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.07)", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em", opacity: .35, fontWeight: 600, marginRight: 8 }}>Stats</span>
              {STAT_TYPES.map(t => (
                <button key={t} onClick={() => setStatType(t)} style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 16, cursor: "pointer", border: "1px solid",
                  background:  statType === t ? "rgba(91,156,246,.18)" : "transparent",
                  color:       statType === t ? "#5b9cf6" : "rgba(255,255,255,.4)",
                  borderColor: statType === t ? "rgba(91,156,246,.5)" : "rgba(255,255,255,.1)",
                }}>
                  {STAT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "8px 12px", textAlign: "left", opacity: .4, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,.07)" }}>Season</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", opacity: .4, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,.07)" }}>Team</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", opacity: .4, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,.07)" }}>Type</th>
                    {statCols.map(c => (
                      <th key={c.key} style={{ padding: "8px 10px", textAlign: "center", opacity: .4, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {playerRows.length === 0 ? (
                    <tr><td colSpan={3 + statCols.length} style={{ padding: 24, textAlign: "center", opacity: .3 }}>No stats available.</td></tr>
                  ) : playerRows.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)" }}>
                      <td style={{ padding: "7px 12px", opacity: .7, whiteSpace: "nowrap" }}>{r.season}</td>
                      <td style={{ padding: "7px 12px", opacity: .6, whiteSpace: "nowrap" }}>{r.team}</td>
                      <td style={{ padding: "7px 12px", opacity: .45, fontSize: 11, whiteSpace: "nowrap" }}>{r.season_type?.replace(/_/g, " ")}</td>
                      {statCols.map(c => (
                        <td key={c.key} style={{ padding: "7px 10px", textAlign: "center", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                          {fmtStatByKey(getStat(r.stats, c.key), c.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>

      {contactOpen && (
        <ContactForm profile={profile} onClose={() => setContactOpen(false)} />
      )}
    </div>
  );
}
