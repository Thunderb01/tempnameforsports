import { Player } from "./player.js";
import { parseCSV, normalizeNumber, firstVal } from "./csv.js";

const STORAGE_KEY = "bp_roster_builder_v1";

// ✅ Put your CSV URL here:
const CSV_URL =
  "./data/BeyondThePortal_GM_Tool - Import_Board.csv";

const els = {
  search: document.getElementById("search"),
  reloadBtn: document.getElementById("reloadBtn"),
  meta: document.getElementById("meta"),
  tableWrap: document.getElementById("tableWrap"),
};

let rows = [];
let columns = [];
let sortKey = null;
let sortDir = "asc";

function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}
function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function ensureState() {
  const s = loadState();
  if (s && s.settings && Array.isArray(s.roster)) {
    s.statusById = s.statusById || {};
    s.shortlistIds = Array.isArray(s.shortlistIds) ? s.shortlistIds : [];
    s.board = Array.isArray(s.board) ? s.board : [];
    return s;
  }
  return { settings: { program: "Program", scholarships: 15, nilTotal: 0, maxPct: 0.3 }, shortlistIds: [], roster: [], board: [], statusById: {} };
}

function makeStableId(rowObj) {
  const name = firstVal(rowObj.Name, rowObj["Player Name"], rowObj.Player, rowObj.name);
  const team = firstVal(rowObj.Team, rowObj.School, rowObj["Current Team"], rowObj.team);
  return `imp_${String(name).trim().toLowerCase().replace(/\s+/g, "_")}__${String(team)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")}`;
}

function compareValues(a, b) {
  const an = normalizeNumber(a);
  const bn = normalizeNumber(b);
  const bothNum = Number.isFinite(an) && Number.isFinite(bn) && (String(a).trim() !== "" || String(b).trim() !== "");
  if (bothNum) return an - bn;

  const as = (a ?? "").toString().toLowerCase();
  const bs = (b ?? "").toString().toLowerCase();
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function rowToPlayer(rowObj) {
  // Adjust these mappings to your CSV headers:
  const raw = {
    id: makeStableId(rowObj),
    name: firstVal(rowObj.Name, rowObj["Player Name"], rowObj.Player, rowObj.name, "Unknown"),
    team: firstVal(rowObj.Team, rowObj.School, rowObj["Current Team"], rowObj.team, ""),
    pos: firstVal(rowObj["Primary Position"], rowObj.Position, rowObj.Pos, rowObj.pos, ""),
    year: firstVal(rowObj.Class, rowObj.Year, rowObj.year, ""),
    marketLow: normalizeNumber(firstVal(rowObj["Open Market Low"], rowObj["Market Low"], rowObj.marketLow, 0)),
    marketHigh: normalizeNumber(firstVal(rowObj["Open Market High"], rowObj["Market High"], rowObj.marketHigh, 0)),
    stats: rowObj, // keep entire row
  };

  const p = Player.from(raw);
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    pos: p.pos,
    year: p.year,
    marketLow: p.marketLow,
    marketHigh: p.marketHigh,
    stats: p.stats,
  };
}

function guessNilOffer(rowObj) {
  const low = normalizeNumber(firstVal(rowObj["Open Market Low"], rowObj["Market Low"], 0));
  const high = normalizeNumber(firstVal(rowObj["Open Market High"], rowObj["Market High"], 0));
  if (low && high) return Math.round((low + high) / 2);
  return 0;
}

function addToRoster(rowObj) {
  const state = ensureState();
  const playerJson = rowToPlayer(rowObj);

  if (!state.board.some(p => String(p.id) === String(playerJson.id))) state.board.unshift(playerJson);

  if (!state.roster.some(r => String(r.id) === String(playerJson.id))) {
    state.roster.unshift({ id: playerJson.id, nilOffer: guessNilOffer(rowObj) });
  }

  state.shortlistIds = (state.shortlistIds || []).filter(x => String(x) !== String(playerJson.id));
  saveState(state);

  els.meta.textContent = `Added ${playerJson.name} to roster.`;
}

function renderTable() {
  const q = (els.search?.value || "").trim().toLowerCase();
  let view = rows;

  if (q) {
    view = view.filter(r => columns.some(c => String(r[c] ?? "").toLowerCase().includes(q)));
  }

  if (sortKey) {
    view = [...view].sort((ra, rb) => {
      const cmp = compareValues(ra[sortKey], rb[sortKey]);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const thead = columns
    .map(c => {
      const active = c === sortKey;
      const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
      return `<th data-sort="${escapeHtml(c)}" style="position:sticky;top:0;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);cursor:pointer;white-space:nowrap;">
        ${escapeHtml(c)}${arrow}
      </th>`;
    })
    .join("");

  const tbody = view
    .map(r => {
      const id = makeStableId(r);
      const cells = columns.map(c => `<td style="white-space:nowrap;">${escapeHtml(r[c])}</td>`).join("");
      return `<tr>
        <td style="white-space:nowrap;">
          <button class="btn btn-primary" data-add="${escapeHtml(id)}" type="button">Add</button>
        </td>
        ${cells}
      </tr>`;
    })
    .join("");

  els.tableWrap.innerHTML = `
    <table style="width:100%;border-collapse:separate;border-spacing:0 8px;">
      <thead><tr><th style="position:sticky;top:0;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);">Roster</th>${thead}</tr></thead>
      <tbody>${tbody || `<tr><td colspan="${columns.length + 1}" class="muted" style="padding:12px;">No rows found.</td></tr>`}</tbody>
    </table>
  `;

  els.tableWrap.querySelectorAll("th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortKey = key; sortDir = "asc"; }
      renderTable();
    });
  });

  els.tableWrap.querySelectorAll("button[data-add]").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-add");
      const rowObj = rows.find(r => makeStableId(r) === targetId);
      if (rowObj) addToRoster(rowObj);
    });
  });

  els.meta.textContent = `${view.length.toLocaleString()} rows shown. Click a header to sort.`;
}

async function loadCSV() {
  els.meta.textContent = "Loading CSV…";

  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not fetch CSV (${res.status}). Check publish settings/link.`);

  const text = await res.text();
  rows = parseCSV(text);

  // Columns from headers
  columns = rows.length ? Object.keys(rows[0]) : [];
  sortKey = null;
  sortDir = "asc";

  renderTable();
}

els.search?.addEventListener("input", renderTable);
els.reloadBtn?.addEventListener("click", () => loadCSV().catch(err => (els.meta.textContent = err.message)));

loadCSV().catch(err => {
  els.meta.textContent = err.message;
});