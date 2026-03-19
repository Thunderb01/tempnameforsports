import { Player } from "./player.js";
import { parseCSV, normalizeNumber, firstVal } from "./csv.js";

const STORAGE_KEY = "bp_roster_builder_v1";
const CSV_URL = "./data/BeyondThePortal_GM_Tool - Import_Board.csv";

// ✅ Edit to control which columns show in the data table view
const VISIBLE_COLUMNS = [
  "Name", 
  "Team", 
  "Primary Position", 
  "Year",
  // "USG%", 
  "PPG", 
  "REB/G",
  "AST/G", 
  // "3PA/G", 
  // "AST/TOV",
  // "STL/40", 
  // "BLK/40", 
  // "FG%", 
  // "FT%", 
  // "3P%",
  "Open Market Low", 
  "Open Market High",
  "Playmaker Tags", 
  "Shooting/Scoring Tags",
];

const els = {
  search:     document.getElementById("search"),
  reloadBtn:  document.getElementById("reloadBtn"),
  meta:       document.getElementById("meta"),
  tableWrap:  document.getElementById("tableWrap"),
  posFilter:  document.getElementById("posFilter"),
  yearFilter: document.getElementById("yearFilter"),
  tagGroup:   document.getElementById("tagGroup"),
  tagFilter:  document.getElementById("tagFilter"),
  viewToggle: document.getElementById("viewToggle"),
  // modal
  modalBackdrop:  document.getElementById("playerModalBackdrop"),
  modal:          document.getElementById("playerModal"),
  modalClose:     document.getElementById("playerModalCloseBtn"),
  modalKicker:    document.getElementById("playerModalKicker"),
  modalTitle:     document.getElementById("playerModalTitle"),
  modalSub:       document.getElementById("playerModalSub"),
  modalStats:     document.getElementById("playerModalStats"),
  modalMarket:    document.getElementById("playerModalMarket"),
  modalStatus:    document.getElementById("playerModalStatus"),
  modalId:        document.getElementById("playerModalId"),
};

// ── State ────────────────────────────────────────────────────────────────────
let allPlayers = [];   // parsed + normalised Player objects
let rawRows    = [];   // raw CSV rows (for table view)
let columns    = [];   // visible columns for table view
let sortKey    = null;
let sortDir    = "asc";
let viewMode   = "cards"; // "cards" | "table"

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return (str ?? "").toString()
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function parseTags(v) {
  if (!v) return [];
  return String(v).split(/[,|]/).map(t => t.trim()).filter(Boolean);
}

function uniq(arr) {
  const seen = new Set();
  return (arr || []).filter(x => {
    const k = String(x || "").trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function money(n) {
  const x = Number(n || 0);
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatStatValue(k, v) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function makeStableId(r) {
  const name = firstVal(r.Name, r["Player Name"], r.Player, r.name, "unknown");
  const team = firstVal(r.Team, r.School, r["Current Team"], r.team, "unknown");
  return `imp_${String(name).trim().toLowerCase().replace(/\s+/g, "_")}__${String(team).trim().toLowerCase().replace(/\s+/g, "_")}`;
}

function compareValues(a, b) {
  const an = normalizeNumber(a), bn = normalizeNumber(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return (a ?? "").toString().toLowerCase() < (b ?? "").toString().toLowerCase() ? -1 : 1;
}

// ── Roster state helpers ──────────────────────────────────────────────────────
function loadRosterState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
}
function saveRosterState(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
function ensureRosterState() {
  const s = loadRosterState();
  if (s?.settings && Array.isArray(s.roster)) {
    s.shortlistIds = Array.isArray(s.shortlistIds) ? s.shortlistIds : [];
    s.board = Array.isArray(s.board) ? s.board : [];
    s.statusById = s.statusById || {};
    return s;
  }
  return { settings: { program: "Program", scholarships: 15, nilTotal: 0, maxPct: 0.3 }, shortlistIds: [], roster: [], board: [], statusById: {} };
}

function addToRoster(player) {
  const s = ensureRosterState();
  const pj = { id: player.id, name: player.name, team: player.team, pos: player.pos, year: player.year,
    marketLow: player.marketLow, marketHigh: player.marketHigh,
    tags: player.tags, playmakerTags: player.playmakerTags, shootingTags: player.shootingTags, stats: player.stats };
  if (!s.board.some(p => p.id === player.id)) s.board.unshift(pj);
  if (!s.roster.some(r => r.id === player.id)) {
    const nilOffer = player.marketLow && player.marketHigh ? Math.round((player.marketLow + player.marketHigh) / 2) : 0;
    s.roster.unshift({ id: player.id, nilOffer });
  }
  s.shortlistIds = (s.shortlistIds || []).filter(x => x !== player.id);
  saveRosterState(s);
  els.meta.textContent = `Added ${player.name} to roster.`;
}

function addToShortlist(player) {
  const s = ensureRosterState();
  const pj = { id: player.id, name: player.name, team: player.team, pos: player.pos, year: player.year,
    marketLow: player.marketLow, marketHigh: player.marketHigh,
    tags: player.tags, playmakerTags: player.playmakerTags, shootingTags: player.shootingTags, stats: player.stats };
  if (!s.board.some(p => p.id === player.id)) s.board.unshift(pj);
  if (!s.shortlistIds.includes(player.id) && !s.roster.some(r => r.id === player.id))
    s.shortlistIds.push(player.id);
  saveRosterState(s);
  els.meta.textContent = `Added ${player.name} to shortlist.`;
}

// ── Filtering helpers ─────────────────────────────────────────────────────────
function tagsForGroup(p, group) {
  if (group === "playmaker") return p.playmakerTags || [];
  if (group === "shooting")  return p.shootingTags  || [];
  return p.tags || [];
}

function getUniqueTags(players, group) {
  const map = new Map();
  players.forEach(p => tagsForGroup(p, group).forEach(t => {
    const k = t.trim().toLowerCase();
    if (k && !map.has(k)) map.set(k, t.trim());
  }));
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
}

function getUniqueYears(players) {
  return uniq(players.map(p => p.year).filter(Boolean)).sort();
}

function rebuildTagOptions() {
  if (!els.tagFilter) return;
  const prev = els.tagFilter.value;
  const group = els.tagGroup?.value || "all";
  const tags = getUniqueTags(allPlayers, group);
  els.tagFilter.innerHTML = [`<option value="all">All tags</option>`]
    .concat(tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)).join("");
  if (prev !== "all" && tags.includes(prev)) els.tagFilter.value = prev;
}

function rebuildYearOptions() {
  if (!els.yearFilter) return;
  const years = getUniqueYears(allPlayers);
  els.yearFilter.innerHTML = [`<option value="all">All years</option>`]
    .concat(years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`)).join("");
}

function getFiltered() {
  const q   = (els.search?.value || "").trim().toLowerCase();
  const pos  = els.posFilter?.value  || "all";
  const yr   = els.yearFilter?.value || "all";
  const group = els.tagGroup?.value  || "all";
  const tag  = els.tagFilter?.value  || "all";

  return allPlayers.filter(p => {
    if (pos !== "all" && p.pos !== pos) return false;
    if (yr  !== "all" && p.year !== yr)  return false;
    if (tag !== "all" && !tagsForGroup(p, group).includes(tag)) return false;
    if (q) {
      const searchable = [p.name, p.team, p.pos, p.year, ...p.tags].join(" ").toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });
}

// ── Player Modal ──────────────────────────────────────────────────────────────
function openModal(player) {
  if (!els.modal) return;
  els.modalKicker.textContent = "Player Card";
  els.modalTitle.textContent  = player.name;
  els.modalSub.textContent    = `${player.team} • ${player.pos} • ${player.year}`;
  if (els.modalId) els.modalId.textContent = `ID: ${player.id}`;

  // Stats from raw row (all fields)
  const stats = player.stats || {};
  const skipKeys = new Set(["Name", "Team", "Primary Position", "Year",
    "Open Market Low", "Open Market High", "Playmaker Tags", "Shooting/Scoring Tags"]);
  const entries = Object.entries(stats).filter(([k]) => !skipKeys.has(k) && stats[k] !== "" && stats[k] !== undefined);

  els.modalStats.innerHTML = entries.length
    ? entries.map(([k, v]) => `
        <div class="statbox">
          <div class="label">${escapeHtml(k)}</div>
          <div class="value">${escapeHtml(formatStatValue(k, v))}</div>
        </div>`).join("")
    : `<div class="empty">No stats available.</div>`;

  if (els.modalMarket) els.modalMarket.textContent = `${money(player.marketLow)} – ${money(player.marketHigh)}`;

  // Tags
  const pm = (player.playmakerTags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("") || `<span class="muted">—</span>`;
  const ss = (player.shootingTags  || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("") || `<span class="muted">—</span>`;
  if (els.modalStatus) els.modalStatus.innerHTML = `
    <div style="margin-bottom:8px;"><span class="muted" style="margin-right:6px;">Play Maker:</span>${pm}</div>
    <div><span class="muted" style="margin-right:6px;">Shooting &amp; Scoring:</span>${ss}</div>
  `;

  els.modalBackdrop.hidden = false;
  els.modal.hidden = false;
  document.body.classList.add("no-scroll");
}

function closeModal() {
  if (!els.modal) return;
  els.modalBackdrop.hidden = true;
  els.modal.hidden = true;
  document.body.classList.remove("no-scroll");
}

els.modalClose?.addEventListener("click", closeModal);
els.modalBackdrop?.addEventListener("click", closeModal);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// ── Card view render ──────────────────────────────────────────────────────────
function renderCards(players) {
  if (!players.length) {
    els.tableWrap.innerHTML = `<div class="empty" style="padding:24px;">No players match your filters.</div>`;
    return;
  }

  const s = ensureRosterState();
  els.tableWrap.innerHTML = players.map(p => {
    const inRoster    = s.roster.some(r => r.id === p.id);
    const inShortlist = s.shortlistIds.includes(p.id);
    const pm = (p.playmakerTags || []).slice(0, 5).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("");
    const ss = (p.shootingTags  || []).slice(0, 5).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("");

    return `
      <div class="row row-click" data-player-id="${escapeHtml(p.id)}" style="cursor:pointer;">
        <div class="row-main">
          <div class="row-title">${escapeHtml(p.name)}</div>
          <div class="row-sub">${escapeHtml(p.team)} • ${escapeHtml(p.pos)} • ${escapeHtml(p.year)}</div>
          <div class="row-sub">Market: ${money(p.marketLow)} – ${money(p.marketHigh)}</div>
          <div class="row-sub tag-row"><span class="muted" style="margin-right:6px;">Play Maker:</span>${pm || `<span class="muted">—</span>`}</div>
          <div class="row-sub tag-row"><span class="muted" style="margin-right:6px;">Shooting &amp; Scoring:</span>${ss || `<span class="muted">—</span>`}</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost"   data-act="shortlist" data-id="${escapeHtml(p.id)}" ${inShortlist || inRoster ? "disabled" : ""}>Shortlist</button>
          <button class="btn btn-primary" data-act="roster"    data-id="${escapeHtml(p.id)}" ${inRoster ? "disabled" : ""}>Roster</button>
        </div>
      </div>`;
  }).join("");

  // Click row → open modal (but not when clicking buttons)
  els.tableWrap.querySelectorAll(".row-click").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      const id = row.getAttribute("data-player-id");
      const p  = allPlayers.find(x => x.id === id);
      if (p) openModal(p);
    });
  });

  els.tableWrap.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const p  = allPlayers.find(x => x.id === id);
      if (!p) return;
      if (btn.dataset.act === "roster")    addToRoster(p);
      if (btn.dataset.act === "shortlist") addToShortlist(p);
      render(); // re-render to update disabled states
    });
  });
}

// ── Table view render ─────────────────────────────────────────────────────────
function renderTable(players) {
  if (!players.length) {
    els.tableWrap.innerHTML = `<div class="empty" style="padding:24px;">No players match your filters.</div>`;
    return;
  }

  // Map player ids back to raw rows for table display
  const playerIds = new Set(players.map(p => p.id));
  let view = rawRows.filter(r => playerIds.has(makeStableId(r)));

  if (sortKey) {
    view = [...view].sort((a, b) => {
      const cmp = compareValues(a[sortKey], b[sortKey]);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const thead = columns.map(c => {
    const active = c === sortKey;
    const arrow  = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th data-sort="${escapeHtml(c)}" style="position:sticky;top:0;background:rgba(0,0,0,.85);backdrop-filter:blur(6px);cursor:pointer;white-space:nowrap;padding:10px 12px;">${escapeHtml(c)}${arrow}</th>`;
  }).join("");

  const tbody = view.map(r => {
    const id = makeStableId(r);
    const p  = allPlayers.find(x => x.id === id);
    const cells = columns.map(c => `<td style="white-space:nowrap;padding:8px 12px;">${escapeHtml(r[c])}</td>`).join("");
    return `<tr class="row-click" data-player-id="${escapeHtml(id)}" style="cursor:pointer;">
      <td style="white-space:nowrap;padding:8px 12px;">
        <button class="btn btn-primary" data-act="roster" data-id="${escapeHtml(id)}" type="button" ${p && ensureRosterState().roster.some(x => x.id === id) ? "disabled" : ""}>Add</button>
        <button class="btn btn-ghost"   data-act="shortlist" data-id="${escapeHtml(p.id)}" type="button" ${p && ensureRosterState().roster.some(x => x.id === id) ? "disabled" : ""}>Shortlist</button>
      ${cells}
    </tr>`;
  }).join("");

  els.tableWrap.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th style="position:sticky;top:0;background:rgba(0,0,0,.85);backdrop-filter:blur(6px);padding:10px 12px;">Action</th>
        ${thead}
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;

  els.tableWrap.querySelectorAll("th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      sortDir = sortKey === key && sortDir === "asc" ? "desc" : "asc";
      sortKey = key;
      render();
    });
  });

  els.tableWrap.querySelectorAll(".row-click").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      const id = row.getAttribute("data-player-id");
      const p  = allPlayers.find(x => x.id === id);
      if (p) openModal(p);
    });
  });

  els.tableWrap.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const p  = allPlayers.find(x => x.id === id);
      if (!p) return;
      if (btn.dataset.act === "roster")    addToRoster(p);
      if (btn.dataset.act === "shortlist") addToShortlist(p);
      render(); // re-render to update disabled states
    });
  });

}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  const filtered = getFiltered();
  if (viewMode === "cards") renderCards(filtered);
  else renderTable(filtered);
  const hiddenCount = allPlayers.length - filtered.length;
  els.meta.textContent = `${filtered.length.toLocaleString()} of ${allPlayers.length.toLocaleString()} players${hiddenCount ? ` (${hiddenCount} filtered out)` : ""}${viewMode === "table" ? " · click header to sort" : ""}`;
}

// ── View toggle ───────────────────────────────────────────────────────────────
els.viewToggle?.addEventListener("click", () => {
  viewMode = viewMode === "cards" ? "table" : "cards";
  els.viewToggle.textContent = viewMode === "cards" ? "Table View" : "Card View";
  render();
});

// ── Filter wiring ─────────────────────────────────────────────────────────────
els.search?.addEventListener("input", render);
els.posFilter?.addEventListener("change", render);
els.yearFilter?.addEventListener("change", render);
els.tagGroup?.addEventListener("change", () => { rebuildTagOptions(); render(); });
els.tagFilter?.addEventListener("change", render);
els.reloadBtn?.addEventListener("click", () => loadData().catch(err => (els.meta.textContent = err.message)));

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadData() {
  els.meta.textContent = "Loading…";

  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not fetch CSV (${res.status}).`);
  const text = await res.text();
  rawRows = parseCSV(text);

  // Build visible columns list
  const allCols = rawRows.length ? Object.keys(rawRows[0]) : [];
  columns = VISIBLE_COLUMNS.filter(c => allCols.includes(c));

  // Parse into player objects
  allPlayers = rawRows.map(r => {
    const playmakerTags = parseTags(firstVal(r["Playmaker Tags"], r["Play Maker Tags"], r["Playmaker Tag"], ""));
    const shootingTags  = parseTags(firstVal(r["Shooting/Scoring Tags"], r["Shooting & Scoring Tags"], r["Shooting and Scoring Tags"], ""));
    const tags = uniq([...playmakerTags, ...shootingTags]);

    const raw = {
      id:          makeStableId(r),
      name:        firstVal(r.Name, r["Player Name"], r.Player, "Unknown"),
      team:        firstVal(r.Team, r.School, r["Current Team"], ""),
      pos:         firstVal(r["Primary Position"], r.Position, r.Pos, ""),
      year:        firstVal(r.Class, r.Year, r.year, ""),
      marketLow:   normalizeNumber(firstVal(r["Open Market Low"],  r["Market Low"],  0)),
      marketHigh:  normalizeNumber(firstVal(r["Open Market High"], r["Market High"], 0)),
      tags, stats: r,
    };
    const p = Player.from(raw);
    return { ...p, playmakerTags, shootingTags, stats: r };
  });

  sortKey = null;
  sortDir = "asc";
  rebuildYearOptions();
  rebuildTagOptions();
  render();
}

loadData().catch(err => { els.meta.textContent = err.message; });
