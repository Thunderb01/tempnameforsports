import { Player } from "./player.js";

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
};

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
      program: "Rutgers",
      scholarships: 15,
      nilTotal: 4500000,
      maxPct: 0.3,
    },
    // store IDs in pipeline lists
    shortlistIds: [],
    roster: [
      // roster entries: { id, nilOffer }
      // example: { id: "p1", nilOffer: 900000 }
    ],
    board: window.DEMO_BOARD || [],
    statusById: {},
  };
}

let state = loadState() ?? defaultState();

// migration / hardening
state.shortlistIds = Array.isArray(state.shortlistIds) ? state.shortlistIds : [];
state.roster = Array.isArray(state.roster) ? state.roster : [];
state.settings = state.settings || defaultState().settings;
state.statusById = state.statusById || {};

// ✅ critical: repopulate board if missing/invalid/empty
if (!Array.isArray(state.board) || state.board.length === 0) {
  state.board = window.DEMO_BOARD || [];
}
state.board = state.board.map(Player.from);

saveState(state); // optional but helps normalize stored data


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

function renderBoard() {
  const q = (els.boardSearch.value || "").trim().toLowerCase();
  const pos = els.posFilter.value;

  const filtered = state.board.filter(p => {
    const matchesQ =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.team || "").toLowerCase().includes(q);

    const matchesPos = pos === "all" ? true : p.pos === pos;
    return matchesQ && matchesPos;
  });

  els.boardList.innerHTML = filtered.map(p => {
    const disabled = inRoster(p.id) ? "disabled" : "";
    const alreadyShort = inShortlist(p.id) ? "disabled" : "";
    return `
      <div class="row row-click" data-player-id="${p.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(p.name)}</div>
          <div class="row-sub">${escapeHtml(p.team)} • ${escapeHtml(p.pos)} • ${escapeHtml(p.year)}</div>
          <div class="row-sub">Market: ${money(p.marketLow)} – ${money(p.marketHigh)}</div>
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