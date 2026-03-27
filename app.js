import { Player } from "./player.js";
import { parseCSV, normalizeNumber, firstVal } from "./csv.js";
import { requireAuth, getCoachProfile, signOut } from "./auth.js";

// ── Auth guard ────────────────────────────────────────────────────────────────
// requireAuth() checks for a valid Supabase session and redirects to
// login.html if none exists. It returns the session so we can get the user id.
const _session = await requireAuth();
if (!_session) throw new Error("Not authenticated"); // unreachable but satisfies linters

// Fetch the coach's profile row from the `coaches` table to get their team
let SESSION_TEAM   = "";
let SESSION_SEASON = "";
let SESSION_NAME   = "";

try {
  const profile  = await getCoachProfile(_session.user.id);
  SESSION_TEAM   = profile.team   || "";
  SESSION_NAME   = profile.display_name || "";
  // Season label: derive from current date
  const now = new Date();
  const yr  = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  SESSION_SEASON = `${yr}-${String(yr + 1).slice(-2)}`;
} catch (err) {
  console.warn("Could not load coach profile:", err.message);
}

// Local CSV in /data (recommended). If you later publish a Google Sheet as CSV,
// replace this with that published CSV URL.
const CSV_URL         = "./data/BeyondThePortal_GM_Tool - Import_Board.csv";
const ALL_ROSTERS_URL = "./data/all_rosters.csv";

const STORAGE_KEY = "bp_roster_builder_v1";

const els = {
  year: document.getElementById("year"),
  program: document.getElementById("program"),
  scholarships: document.getElementById("scholarships"),
  nilTotal: document.getElementById("nilTotal"),
  maxPct: document.getElementById("maxPct"),
  summary: document.getElementById("summary"),
  warnings: document.getElementById("warnings"),
  boardSearch: document.getElementById("boardSearch"),
  posFilter: document.getElementById("posFilter"),
  tagGroup: document.getElementById("tagGroup"),
  tagFilter: document.getElementById("tagFilter"),
  boardList: document.getElementById("boardList"),
  shortlist: document.getElementById("shortlist"),
  roster: document.getElementById("roster"),
  exportBtn: document.getElementById("exportBtn"),
  importInput: document.getElementById("importInput"),
  resetBtn: document.getElementById("resetBtn"),
  playerModalBackdrop: document.getElementById("playerModalBackdrop"),
  playerModal: document.getElementById("playerModal"),
  playerModalCloseBtn : document.getElementById("playerModalCloseBtn"),
  playerModalTitle : document.getElementById("playerModalTitle"),
  playerModalKicker : document.getElementById("playerModalKicker"),
  playerModalSub : document.getElementById("playerModalSub"),
  playerModalStats : document.getElementById("playerModalStats"),
  playerModalMarket : document.getElementById("playerModalMarket"),
  playerModalStatus : document.getElementById("playerModalStatus"),
  playerModalId: document.getElementById("playerModalId"),
  importCsvBtn: document.getElementById("importCsvBtn"),
};

function parseTags(v) {
  if (v === null || v === undefined) return [];
  const s = String(v).trim();
  if (!s) return [];
  // Supports: "Shooter, Stretch Big" or "Shooter|Stretch Big" (and variants)
  return s
    .split(/[,|]/)
    .map(t => t.trim())
    .filter(Boolean);
}

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const x of (arr || [])) {
    const s = String(x || "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function normalizeStoredPlayer(obj) {
  const o = obj || {};
  const p = Player.from({
    id: o.id,
    name: o.name,
    team: o.team,
    pos: o.pos,
    year: o.year,
    marketLow: o.marketLow,
    marketHigh: o.marketHigh,
    tags: Array.isArray(o.tags) ? o.tags : [],
    stats: o.stats || {},
  });

  const playmakerTags = Array.isArray(o.playmakerTags) ? o.playmakerTags : parseTags(o.playmakerTags);
  const shootingTags = Array.isArray(o.shootingTags) ? o.shootingTags : parseTags(o.shootingTags);
  const combined = uniq([...(p.tags || []), ...playmakerTags, ...shootingTags]);

  return {
    id: p.id,
    name: p.name,
    team: p.team,
    pos: p.pos,
    year: p.year,
    marketLow: p.marketLow,
    marketHigh: p.marketHigh,
    // combined convenience list (kept for backward compatibility)
    tags: combined,
    // category-specific tags
    playmakerTags: uniq(playmakerTags),
    shootingTags: uniq(shootingTags),
    stats: p.stats,
  };
}

const STATUSES = [
  { key: "none", label: "No status" },
  { key: "interested", label: "Interested" },
  { key: "contacted", label: "Contacted" },
  { key: "visit", label: "Visit" },
  { key: "signed", label: "Signed" },
  { key: "passed", label: "Passed" },
];

function statusLabel(key) {
  return STATUSES.find(s => s.key === key)?.label ?? "No status";
}

if (els.year) els.year.textContent = new Date().getFullYear();

function money(n) {
  const x = Number(n || 0);
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatStatValue(k, v) {
  if (v === null || v === undefined || v === "") return "—";
  if (k === "ts") return `${Math.round(Number(v) * 100)}%`;
  return String(v);
}

function prettyStatKey(k) {
  const map = {
    ppg: "PPG",
    rpg: "RPG",
    apg: "APG",
    spg: "SPG",
    bpg: "BPG",
    mpg: "MPG",
    ts: "True Shooting",
  };
  return map[k] || k.toUpperCase();
}

function openPlayerModal(playerId) {
  const p = byId(playerId);
  if (!p) return;

  const statusKey = state.statusById?.[p.id] || "none";

  els.playerModalKicker.textContent = "Player Card";
  els.playerModalTitle.textContent = p.name;
  els.playerModalSub.textContent = `${p.team} • ${p.pos} • ${p.year}`;
  els.playerModalId.textContent = `Player ID: ${p.id}`;

  // Stats grid
  const stats = p.stats || {};
  const entries = Object.entries(stats);

  els.playerModalStats.innerHTML = entries.length
    ? entries
        .map(
          ([k, v]) => `
          <div class="statbox">
            <div class="label">${escapeHtml(prettyStatKey(k))}</div>
            <div class="value">${escapeHtml(formatStatValue(k, v))}</div>
          </div>
        `
        )
        .join("")
    : `<div class="empty">No stats available for this player yet.</div>`;

  els.playerModalMarket.textContent = `${money(p.marketLow)} – ${money(p.marketHigh)}`;

  // Show status pill + select (reusing your status renderer if you added it)
  if (typeof renderStatusPill === "function" && typeof renderStatusSelect === "function") {
    els.playerModalStatus.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        ${renderStatusPill(p.id)}
        ${renderStatusSelect(p.id)}
      </div>
    `;
  } else {
    els.playerModalStatus.innerHTML = `<span class="status-pill status-${statusKey}">${escapeHtml(statusLabel?.(statusKey) || statusKey)}</span>`;
  }

  // Show modal
  els.playerModalBackdrop.hidden = false;
  els.playerModal.hidden = false;
  document.body.classList.add("no-scroll");
}

function closePlayerModal() {
  els.playerModalBackdrop.hidden = true;
  els.playerModal.hidden = true;
  document.body.classList.remove("no-scroll");
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function defaultState() {
  return {
    settings: {
      program: SESSION_TEAM || "Rutgers",
      scholarships: 15,
      nilTotal: 4500000,
      maxPct: 0.3,
    },
    board: [],
    shortlistIds: [],
    roster: [],
    statusById: {},
    returningLoaded: false,
  };
}

let state = loadState() ?? defaultState();

// migration / hardening
state.shortlistIds = Array.isArray(state.shortlistIds) ? state.shortlistIds : [];
state.roster = Array.isArray(state.roster) ? state.roster : [];
state.settings = state.settings || defaultState().settings;
state.statusById = state.statusById || {};

// Board hardening + fallback
state.board = Array.isArray(state.board) ? state.board : [];
if (!state.board.length && Array.isArray(window.DEMO_BOARD) && window.DEMO_BOARD.length) {
  state.board = window.DEMO_BOARD;
}

// Normalize board rows into a stable plain-object shape (safe for localStorage)
state.board = state.board.map(normalizeStoredPlayer);

saveState(state); // optional but helps normalize stored data

// (legacy XLSX import paths kept for reference)
// const XLSX_PATH = "./data/BeyondThePortal_GM_Tool.xlsx";
// const IMPORT_SHEET_NAME = "Import_Board";

function makeStableIdFromRow(r) {
  const name = firstVal(r.Name, r["Player Name"], r.Player, r.name);
  const team = firstVal(r.Team, r.School, r["Current Team"], r.team);
  const safeName = String(name || "unknown").trim().toLowerCase().replace(/\s+/g, "_");
  const safeTeam = String(team || "unknown").trim().toLowerCase().replace(/\s+/g, "_");
  return `imp_${safeName}__${safeTeam}`;
}

function rowToPlayer(r) {
  const playmakerTags = parseTags(firstVal(
    r["Play Maker Tags"],
    r["Playmaker Tags"],
    r["Playmaker Tag"],
    r.PlaymakerTags,
    r.playmakerTags,
    ""
  ));

  const shootingTags = parseTags(firstVal(
    r["Shooting and Scoring Tags"],
    r["Shooting & Scoring Tags"],
    r["Shooting/Scoring Tags"],
    r["Shooting Scoring Tags"],
    r.ShootingScoringTags,
    r.shootingTags,
    ""
  ));

  // Back-compat / generic tag column (if you have one)
  const genericTags = parseTags(firstVal(r.Tags, r.Tag, r["Player Tags"], r["Player Tag"], r.tags, ""));

  const combinedTags = uniq([...genericTags, ...playmakerTags, ...shootingTags]);

  const raw = {
    id: makeStableIdFromRow(r),
    name: firstVal(r.Name, r["Player Name"], r.Player, r.name, "Unknown"),
    team: firstVal(r.Team, r.School, r["Current Team"], r.team, ""),
    pos: firstVal(r["Primary Position"], r.Position, r.Pos, r.pos, ""),
    year: firstVal(r.Class, r.Year, r.year, ""),
    marketLow: normalizeNumber(firstVal(r["Open Market Low"], r["Market Low"], r.marketLow, 0)),
    marketHigh: normalizeNumber(firstVal(r["Open Market High"], r["Market High"], r.marketHigh, 0)),
    tags: combinedTags,
    stats: r, // keep full row for modal/stats page
  };

  const p = Player.from(raw);

  // store as plain object in state (safe for localStorage)
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    pos: p.pos,
    year: p.year,
    marketLow: p.marketLow,
    marketHigh: p.marketHigh,
    // combined convenience list
    tags: Array.isArray(p.tags) ? p.tags : [],
    // category-specific tags (what you're referring to)
    playmakerTags: uniq(playmakerTags),
    shootingTags: uniq(shootingTags),
    stats: p.stats,
  };
}

async function importBoardIntoBuilder({ replace = false } = {}) {
  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not fetch CSV (${res.status}). Is the sheet published/public?`);

  const text = await res.text();
  const parsed = parseCSV(text);

  // Basic sanity: if it fetched HTML (permissions/login page), bail
  if (!parsed.length || Object.keys(parsed[0] || {}).length === 0) {
    throw new Error("CSV parse returned no rows. Check the CSV URL and sharing/publish settings.");
  }

  const imported = parsed.map(rowToPlayer);

  if (!Array.isArray(state.board)) state.board = [];

  if (replace) {
    state.board = imported;
  } else {
    const existing = new Set(state.board.map(p => String(p.id)));
    for (const p of imported) {
      if (!existing.has(String(p.id))) state.board.push(p);
    }
  }

  saveState(state);
  render();

  return imported.length;
}

// After state is loaded + migrations, before first render()
// If CSV is missing or fails to parse, we keep the existing board (e.g., DEMO_BOARD).
importBoardIntoBuilder({ replace: true }).catch((err) => {
  console.warn("CSV import failed; using existing board.", err);
});

function getSettings() {
  return {
    program: els.program.value.trim() || "Program",
    scholarships: Number(els.scholarships.value || 0),
    nilTotal: Number(els.nilTotal.value || 0),
    maxPct: Number(els.maxPct.value || 0),
  };
}

function commitSettings() {
  state.settings = getSettings();
  saveState(state);
  render();
}

function byId(id) {
  return state.board.find(p => p.id === id) || null;
}

function inShortlist(id) {
  return state.shortlistIds.includes(id);
}

function inRoster(id) {
  return state.roster.some(r => r.id === id);
}

function addToShortlist(id) {
  if (!byId(id)) return;
  if (inShortlist(id)) return;
  state.shortlistIds.unshift(id);
  saveState(state);
  render();
}

function removeFromShortlist(id) {
  state.shortlistIds = state.shortlistIds.filter(x => x !== id);
  saveState(state);
  render();
}

function addToRoster(id) {
  const p = byId(id);
  if (!p || inRoster(id)) return;

  // default NIL offer = midpoint of market band
  const offer = Math.round((Number(p.marketLow || 0) + Number(p.marketHigh || 0)) / 2);

  // remove from shortlist if present
  state.shortlistIds = state.shortlistIds.filter(x => x !== id);

  state.roster.unshift({ id, nilOffer: offer });
  saveState(state);
  render();
}

function removeFromRoster(id) {
  state.roster = state.roster.filter(x => x.id !== id);
  saveState(state);
  render();
}

function updateRosterOffer(id, nilOffer) {
  const entry = state.roster.find(r => r.id === id);
  if (!entry) return;
  entry.nilOffer = Math.max(0, Number(nilOffer || 0));
  saveState(state);
  render();
}

function setStatus(id, statusKey) {
  if (!byId(id)) return;

  state.statusById[id] = statusKey;

  // Optional automation rules:
  if (statusKey === "signed") {
    // if signed, ensure in roster
    if (!inRoster(id)) addToRoster(id);
  }

  if (statusKey === "passed") {
    // if passed, remove from pipeline lists
    if (inShortlist(id)) removeFromShortlist(id);
    if (inRoster(id)) removeFromRoster(id);
  }

  saveState(state);
  render();
}

function renderStatusPill(id) {
  const key = state.statusById[id] || "none";
  return `<span class="status-pill status-${key}">${escapeHtml(statusLabel(key))}</span>`;
}

function renderStatusSelect(id) {
  const current = state.statusById[id] || "none";
  return `
    <label class="status-control">
      <span class="status-label">Status</span>
      <select data-act="set-status" data-id="${id}">
        ${STATUSES.map(s => `
          <option value="${s.key}" ${s.key === current ? "selected" : ""}>${s.label}</option>
        `).join("")}
      </select>
    </label>
  `;
}



function calc() {
  const s = state.settings;

  const rosterCount = state.roster.length;
  const scholarshipsRemaining = s.scholarships - rosterCount;

  const nilCommitted = state.roster.reduce((sum, r) => sum + Number(r.nilOffer || 0), 0);
  const nilRemaining = s.nilTotal - nilCommitted;

  const maxPerPlayer = s.nilTotal * s.maxPct;

  const warnings = [];
  if (scholarshipsRemaining < 0) warnings.push(`Over scholarships by ${Math.abs(scholarshipsRemaining)}.`);
  if (nilRemaining < 0) warnings.push(`Over NIL budget by ${money(Math.abs(nilRemaining))}.`);

  for (const r of state.roster) {
    if (r.nilOffer > maxPerPlayer) {
      const p = byId(r.id);
      warnings.push(`${p?.name ?? r.id} exceeds max/player (${money(maxPerPlayer)}).`);
    }
  }

  return { rosterCount, scholarshipsRemaining, nilCommitted, nilRemaining, maxPerPlayer, warnings };
}

function renderSummary() {
  const s = state.settings;
  const c = calc();

  els.summary.innerHTML = `
    <div class="summary-grid">
      <div class="sum">
        <div class="label">Program</div>
        <div class="value">${escapeHtml(s.program)}</div>
      </div>
      <div class="sum">
        <div class="label">Roster</div>
        <div class="value">${c.rosterCount} / ${s.scholarships}</div>
      </div>
      <div class="sum">
        <div class="label">Scholarships Remaining</div>
        <div class="value">${c.scholarshipsRemaining}</div>
      </div>
      <div class="sum">
        <div class="label">NIL Committed</div>
        <div class="value">${money(c.nilCommitted)}</div>
      </div>
      <div class="sum">
        <div class="label">NIL Remaining</div>
        <div class="value">${money(c.nilRemaining)}</div>
      </div>
      <div class="sum">
        <div class="label">Max / Player</div>
        <div class="value">${money(c.maxPerPlayer)}</div>
      </div>
    </div>
  `;

  if (c.warnings.length) {
    els.warnings.innerHTML = `
      <div class="warn-box">
        <div class="warn-title">Warnings</div>
        <ul class="warn-list">
          ${c.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}
        </ul>
      </div>
    `;
  } else {
    els.warnings.innerHTML = `<div class="ok-box">No constraint violations.</div>`;
  }
}

function tagsForGroup(player, group) {
  if (group === "playmaker") return Array.isArray(player.playmakerTags) ? player.playmakerTags : [];
  if (group === "shooting") return Array.isArray(player.shootingTags) ? player.shootingTags : [];
  // "all": union of both + generic
  return Array.isArray(player.tags) ? player.tags : [];
}

function getUniqueTags(board, group = "all") {
  const set = new Map();
  (board || []).forEach(p => {
    (tagsForGroup(p, group) || []).forEach(t => {
      const key = String(t || "").trim();
      if (!key) return;
      // de-dupe case-insensitively, keep first seen display text
      const low = key.toLowerCase();
      if (!set.has(low)) set.set(low, key);
    });
  });
  return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
}

function rebuildTagFilterOptions() {
  if (!els.tagFilter) return;
  const prev = els.tagFilter.value || "all";
  const group = els.tagGroup?.value || "all";
  const tags = getUniqueTags(state.board, group);
  const opts = [`<option value="all">All tags</option>`]
    .concat(tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`));
  els.tagFilter.innerHTML = opts.join("");
  // restore selection if possible
  const canRestore = prev !== "all" && tags.includes(prev);
  els.tagFilter.value = canRestore ? prev : "all";
}

function renderBoard() {
  const q = (els.boardSearch.value || "").trim().toLowerCase();
  const pos = els.posFilter.value;
  const group = els.tagGroup?.value || "all";
  const tag = els.tagFilter?.value || "all";

  const filtered = state.board.filter(p => {
    const matchesQ =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.team || "").toLowerCase().includes(q) ||
      (uniq([
        ...(Array.isArray(p.tags) ? p.tags : []),
        ...(Array.isArray(p.playmakerTags) ? p.playmakerTags : []),
        ...(Array.isArray(p.shootingTags) ? p.shootingTags : []),
      ]).join(" ")).toLowerCase().includes(q);

    const matchesPos = pos === "all" ? true : p.pos === pos;
    const pool = tagsForGroup(p, group);
    const matchesTag = tag === "all" ? true : (Array.isArray(pool) && pool.includes(tag));
    return matchesQ && matchesPos && matchesTag;
  });

  els.boardList.innerHTML = filtered.map(p => {
    const disabled = inRoster(p.id) ? "disabled" : "";
    const alreadyShort = inShortlist(p.id) ? "disabled" : "";

    const pm = (Array.isArray(p.playmakerTags) ? p.playmakerTags : []).slice(0, 6)
      .map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("");
    const ss = (Array.isArray(p.shootingTags) ? p.shootingTags : []).slice(0, 6)
      .map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("");

    return `
      <div class="row row-click" data-player-id="${p.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(p.name)}</div>
          <div class="row-sub">${escapeHtml(p.team)} • ${escapeHtml(p.pos)} • ${escapeHtml(p.year)}</div>
          <div class="row-sub">Market: ${money(p.marketLow)} – ${money(p.marketHigh)}</div>
          <div class="row-sub tag-row"><span class="muted" style="margin-right:6px;">Play Maker:</span> ${pm || `<span class="muted">—</span>`}</div>
          <div class="row-sub tag-row"><span class="muted" style="margin-right:6px;">Shooting &amp; Scoring:</span> ${ss || `<span class="muted">—</span>`}</div>
          <div class="row-sub" style="margin-top:10px;"> ${renderStatusSelect(p.id)}</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost" data-act="shortlist" data-id="${p.id}" ${alreadyShort}>Shortlist</button>
          <button class="btn btn-primary" data-act="roster" data-id="${p.id}" ${disabled}>Roster</button>
        </div>
      </div>
    `;
  }).join("");

  // action wiring via event delegation handled below
}

function renderShortlist() {
  const items = state.shortlistIds.map(id => byId(id)).filter(Boolean);

  if (!items.length) {
    els.shortlist.innerHTML = `<div class="empty">No shortlisted players yet.</div>`;
    return;
  }

  els.shortlist.innerHTML = items.map(p => `
    <div class="row row-click" data-player-id="${p.id}">
      <div class="row-main">
        <div class="row-title">${escapeHtml(p.name)}</div>
        <div class="row-sub">${escapeHtml(p.team)} • ${escapeHtml(p.pos)} • ${escapeHtml(p.year)}</div>
        <div class="row-sub" style="margin-top:10px;">${renderStatusSelect(p.id)}</div>      
      </div>
      <div class="row-actions">
        <button class="btn btn-ghost" data-act="shortlist-remove" data-id="${p.id}">Remove</button>
        <button class="btn btn-primary" data-act="shortlist-to-roster" data-id="${p.id}">Add to Roster</button>
      </div>
    </div>
  `).join("");
}

function renderRoster() {
  if (!state.roster.length) {
    els.roster.innerHTML = `<div class="empty">No roster players yet.</div>`;
    return;
  }

  els.roster.innerHTML = state.roster.map(entry => {
    const p = byId(entry.id);
    if (!p) return "";
    return `
      <div class="row row-click" data-player-id="${p.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(p.name)}</div>
          <div class="row-sub">${escapeHtml(p.team)} • ${escapeHtml(p.pos)} • ${escapeHtml(p.year)}</div>
          <div class="row-sub" style="margin-top:10px;">${renderStatusSelect(p.id)}</div>
          
          <div class="offer">
            <label>NIL Offer</label>
            <input type="number" min="0" step="1000" value="${Number(entry.nilOffer || 0)}"
              data-act="offer" data-id="${p.id}" />
            <span class="muted">${money(entry.nilOffer)}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost" data-act="roster-remove" data-id="${p.id}">Remove</button>
        </div>
      </div>
    `;
  }).join("");
}

function render() {
  // sync settings inputs from state
  els.program.value = state.settings.program;
  els.scholarships.value = state.settings.scholarships;
  els.nilTotal.value = state.settings.nilTotal;
  els.maxPct.value = state.settings.maxPct;

  renderSummary();
  rebuildTagFilterOptions();
  renderBoard();
  renderShortlist();
  renderRoster();
}

function escapeHtml(str) {
  return (str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("click", (e) => {
  // If the click started inside any interactive/control element, do nothing.
  // This includes your status dropdown/select and anything inside it.
  if (e.target.closest("button, input, select, option, a, label, textarea")) return;

  const row = e.target.closest("[data-player-id]");
  if (!row) return;

  openPlayerModal(row.getAttribute("data-player-id"));
});

els.playerModalCloseBtn?.addEventListener("click", closePlayerModal);
els.playerModalBackdrop?.addEventListener("click", closePlayerModal);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.playerModal.hidden) closePlayerModal();
});

/** Event wiring */
["program", "scholarships", "nilTotal", "maxPct"].forEach(id => {
  const el = document.getElementById(id);
  el?.addEventListener("input", commitSettings);
});

els.boardSearch?.addEventListener("input", renderBoard);
els.posFilter?.addEventListener("change", renderBoard);
els.tagGroup?.addEventListener("change", () => {
  rebuildTagFilterOptions();
  renderBoard();
});
els.tagFilter?.addEventListener("change", renderBoard);

// Board click actions
els.boardList?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.getAttribute("data-id");
  const act = btn.getAttribute("data-act");

  if (act === "shortlist") addToShortlist(id);
  if (act === "roster") addToRoster(id);
});

els.shortlist?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.getAttribute("data-id");
  const act = btn.getAttribute("data-act");

  if (act === "shortlist-remove") removeFromShortlist(id);
  if (act === "shortlist-to-roster") addToRoster(id);
});

// Roster remove + offer update
els.roster?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.getAttribute("data-id");
  if (btn.getAttribute("data-act") === "roster-remove") removeFromRoster(id);
});

els.roster?.addEventListener("input", (e) => {
  const input = e.target.closest("input[data-act='offer']");
  if (!input) return;
  updateRosterOffer(input.getAttribute("data-id"), input.value);
});

els.exportBtn?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "roster-build.json";
  a.click();
  URL.revokeObjectURL(url);
});

els.importInput?.addEventListener("change", async () => {
  const file = els.importInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const imported = JSON.parse(text);
    // basic sanity
    if (!imported.settings || !imported.board) throw new Error("Invalid build file.");
    state = imported;
    saveState(state);
    render();
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  } finally {
    els.importInput.value = "";
  }
});

function handleStatusChange(e) {
  const sel = e.target.closest("select[data-act='set-status']");
  if (!sel) return;
  const id = sel.getAttribute("data-id");
  setStatus(id, sel.value);
}

// Works for selects inside any list/panel
document.addEventListener("change", handleStatusChange);

els.resetBtn?.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  saveState(state);
  render();
});

// ✅ Force modal closed on initial load
closePlayerModal();

// ✅ Also force close when browser restores page from cache (back button)
window.addEventListener("pageshow", () => {
  closePlayerModal();
});

render();
// ── Team identity banner ──────────────────────────────────────────────────────
// Show which program is logged in at the top of the page.
(function injectTeamBanner() {
  if (!SESSION_TEAM) return;
  const appTop = document.querySelector(".app-top h1");
  if (!appTop) return;
  const banner = document.createElement("div");
  banner.style.cssText = "font-size:13px;opacity:.45;margin-bottom:4px;font-weight:400;";
  banner.textContent   = `${SESSION_TEAM}  ·  ${SESSION_SEASON}  ·  `;
  const signOut = document.createElement("a");
  signOut.textContent = "Sign out";
  signOut.href = "#";
  signOut.style.cssText = "opacity:.7;text-decoration:underline;cursor:pointer;";
  signOut.addEventListener("click", async e => {
    e.preventDefault();
    try { await signOut(); } catch (_) {}
    window.location.href = "./login.html";
  });
  banner.appendChild(signOut);
  appTop.insertAdjacentElement("beforebegin", banner);
})();

// ── Returning roster: load team players from all_rosters.csv ─────────────────

const RETURNING_KEY = "bp_returning_v1";

function loadReturningState() {
  try {
    const raw = localStorage.getItem(RETURNING_KEY);
    return raw ? JSON.parse(raw) : { team: "", players: [] };
  } catch { return { team: "", players: [] }; }
}

function saveReturningState(obj) {
  localStorage.setItem(RETURNING_KEY, JSON.stringify(obj));
}

let returningState = loadReturningState();

// If the session team changed (different coach logging in on same browser), clear old cache
if (returningState.team !== SESSION_TEAM) {
  returningState = { team: SESSION_TEAM, players: [] };
  saveReturningState(returningState);
}

async function loadTeamRoster() {
  if (!SESSION_TEAM) return;

  // Use cached version if we already have it for this team
  if (returningState.players.length > 0) {
    renderReturningRoster();
    return;
  }

  const statusEl = document.getElementById("returningStatus");
  if (statusEl) statusEl.textContent = `Loading ${SESSION_TEAM} roster…`;

  try {
    const res = await fetch(ALL_ROSTERS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not fetch all_rosters.csv (${res.status})`);
    const text = await res.text();
    const rows  = parseCSV(text);

    // Filter to this team only
    const teamRows = rows.filter(r => {
      const t = (r.Team || r.team || "").trim();
      return t.toLowerCase() === SESSION_TEAM.toLowerCase();
    });

    if (!teamRows.length) {
      if (statusEl) statusEl.textContent = `No roster data found for ${SESSION_TEAM} yet.`;
      return;
    }

    // Shape into the same plain-object format the app uses
    returningState.players = teamRows.map((r, i) => {
      const name = firstVal(r.Name, r["Player Name"], r.name, "Unknown").trim();
      const pos  = firstVal(r["Primary Position"], r.Position, r.Pos, r.pos, "");
      const yr   = firstVal(r.Year, r.Class, r.year, "");
      return {
        id:            `ret_${name.toLowerCase().replace(/\s+/g, "_")}_${i}`,
        name,
        team:          SESSION_TEAM,
        pos,
        year:          yr,
        marketLow:     0,
        marketHigh:    0,
        tags:          [],
        playmakerTags: [],
        shootingTags:  [],
        stats:         r,
        source:        "returning",
      };
    });

    saveReturningState(returningState);
    if (statusEl) statusEl.textContent = "";
    renderReturningRoster();
    updateRosterDivider();

  } catch (err) {
    console.warn("Could not load team roster:", err.message);
    if (statusEl) statusEl.textContent = `Could not load roster: ${err.message}`;
  }
}

function renderReturningRoster() {
  const listEl = document.getElementById("returningList");
  const sectionEl = document.getElementById("returningSection");
  if (!listEl || !sectionEl) return;

  const players = returningState.players;
  if (!players.length) {
    sectionEl.hidden = true;
    return;
  }

  sectionEl.hidden = false;

  // Group by position
  const groups = { Guard: [], Wing: [], Big: [], "": [] };
  players.forEach(p => {
    const bucket = groups[p.pos] !== undefined ? p.pos : "";
    groups[bucket].push(p);
  });

  listEl.innerHTML = Object.entries(groups).flatMap(([pos, group]) => {
    if (!group.length) return [];
    const label = pos || "Other";
    return [
      `<div style="padding:6px 12px 2px;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;opacity:.35;">${escapeHtml(label)}s (${group.length})</div>`,
      ...group.map(p => `
        <div class="row" style="opacity:.8;">
          <div class="row-main">
            <div class="row-title" style="font-size:13px;">${escapeHtml(p.name)}</div>
            <div class="row-sub" style="font-size:11px;">${escapeHtml(p.pos)} · ${escapeHtml(p.year)}</div>
          </div>
          <div class="row-actions">
            <span style="font-size:11px;opacity:.4;padding:4px 6px;">Returning</span>
          </div>
        </div>
      `),
    ];
  }).join("");

  updateRosterDivider();
}

function updateRosterDivider() {
  const divider = document.getElementById("rosterDivider");
  if (!divider) return;
  const hasReturning = returningState.players.length > 0;
  const hasPortal    = state.roster.length > 0;
  divider.hidden = !(hasReturning && hasPortal);
}

// Patch the existing renderRoster to also update the divider
const _origRenderRoster = renderRoster;
// eslint-disable-next-line no-global-assign
window._renderRosterPatched = function() {
  _origRenderRoster();
  updateRosterDivider();
};

// ── Inject returning roster UI into the Roster panel ─────────────────────────
(function injectReturningUI() {
  const rosterPanel = document.querySelector("#roster")?.closest(".panel");
  if (!rosterPanel) return;

  const head = rosterPanel.querySelector(".panel-head");
  if (!head) return;

  // Status line
  const statusEl = document.createElement("div");
  statusEl.id = "returningStatus";
  statusEl.style.cssText = "font-size:12px;opacity:.45;margin-top:6px;min-height:14px;";
  head.appendChild(statusEl);

  // Returning section (inserted before the portal roster list)
  const rosterList = document.getElementById("roster");
  if (rosterList) {
    const section = document.createElement("div");
    section.id = "returningSection";
    section.hidden = true;

    const sectionLabel = document.createElement("div");
    sectionLabel.style.cssText = "padding:8px 12px 4px;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;opacity:.4;";
    sectionLabel.textContent = "Returning";

    const list = document.createElement("div");
    list.id = "returningList";
    list.className = "list";

    section.appendChild(sectionLabel);
    section.appendChild(list);
    rosterList.insertAdjacentElement("beforebegin", section);

    // Divider
    const divider = document.createElement("div");
    divider.id = "rosterDivider";
    divider.hidden = true;
    divider.style.cssText = "padding:8px 12px 4px;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;opacity:.4;border-top:1px solid rgba(255,255,255,0.07);margin-top:4px;";
    divider.textContent = "Portal Adds";
    rosterList.insertAdjacentElement("beforebegin", divider);
  }
})();

// Kick off the auto-load
loadTeamRoster();
