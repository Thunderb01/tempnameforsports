const STORAGE_KEY = "bp_roster_builder_v1";
const XLSX_PATH = "./data/BeyondThePortal_GM_Tool.xlsx";

const els = {
  search: document.getElementById("search"),
  sheetName: document.getElementById("sheetName"),
  reloadBtn: document.getElementById("reloadBtn"),
  meta: document.getElementById("meta"),
  tableWrap: document.getElementById("tableWrap"),
};

let rows = [];         // array of objects (each is a row)
let columns = [];      // ordered column names
let sortKey = null;
let sortDir = "asc";   // "asc" | "desc"

function formatTwoDecimals(n) {
  return Number(n).toFixed(2);
}

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
  // Keep this aligned with your app.js defaultState shape
  const existing = loadState();
  if (existing && existing.settings && Array.isArray(existing.roster)) {
    existing.statusById = existing.statusById || {};
    existing.shortlistIds = Array.isArray(existing.shortlistIds) ? existing.shortlistIds : [];
    existing.board = Array.isArray(existing.board) ? existing.board : [];
    return existing;
  }

  // minimal safe fallback
  return {
    settings: { program: "Program", scholarships: 15, nilTotal: 0, maxPct: 0.3 },
    shortlistIds: [],
    roster: [],
    board: [],
    statusById: {},
  };
}

function normalizeNumber(v) {
  // turn "$1,234" -> 1234, "12.3" -> 12.3, keep non-numeric as NaN
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replaceAll(",", "").replaceAll("$", "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function compareValues(a, b) {
  // numeric if possible; else string compare
  const an = normalizeNumber(a);
  const bn = normalizeNumber(b);
  const bothNumeric = Number.isFinite(an) && Number.isFinite(bn);

  if (bothNumeric) return an - bn;

  const as = (a ?? "").toString().toLowerCase();
  const bs = (b ?? "").toString().toLowerCase();
  if (as < bs) return -1;
  if (as > bs) return 1;
  return 0;
}

function getPlayerId(rowObj) {
  // Prefer an existing ID column if the sheet has one
  const explicit =
    rowObj.id || rowObj.ID || rowObj.player_id || rowObj["Player ID"] || rowObj["player_id"];
  if (explicit) return String(explicit);

  // Otherwise create a stable-ish ID from name+team
  const name = rowObj.name || rowObj.Name || rowObj.Player || rowObj["Player Name"] || "";
  const team = rowObj.team || rowObj.Team || rowObj.School || rowObj["Current Team"] || "";
  return `imp_${String(name).trim().toLowerCase().replace(/\s+/g, "_")}__${String(team)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")}`;
}

function guessNilOffer(rowObj) {
  // If your sheet has Market Low/High, use midpoint; else 0
  const low = rowObj.marketLow ?? rowObj["Market Low"] ?? rowObj["MarketLow"] ?? rowObj["Low"];
  const high = rowObj.marketHigh ?? rowObj["Market High"] ?? rowObj["MarketHigh"] ?? rowObj["High"];

  const ln = normalizeNumber(low);
  const hn = normalizeNumber(high);
  if (Number.isFinite(ln) && Number.isFinite(hn)) return Math.round((ln + hn) / 2);
  return 0;
}

function addToRoster(rowObj) {
  const state = ensureState();
  const id = getPlayerId(rowObj);

  // Make sure the board in the builder knows about this player.
  // We store a simplified player object compatible with your app.js `byId()`.
  const player = {
    id,
    name: rowObj.name || rowObj.Name || rowObj.Player || rowObj["Player Name"] || "Unknown",
    team: rowObj.team || rowObj.Team || rowObj.School || rowObj["Current Team"] || "",
    pos: rowObj.pos || rowObj.Pos || rowObj.Position || "",
    year: rowObj.year || rowObj.Year || rowObj.Class || "",
    marketLow: normalizeNumber(rowObj.marketLow ?? rowObj["Market Low"]) || 0,
    marketHigh: normalizeNumber(rowObj.marketHigh ?? rowObj["Market High"]) || 0,
    stats: rowObj, // keep whole row accessible as stats
  };

  if (!Array.isArray(state.board)) state.board = [];
  if (!state.board.some(p => p.id === id)) state.board.unshift(player);

  // Add roster entry if not already
  if (!Array.isArray(state.roster)) state.roster = [];
  if (!state.roster.some(r => r.id === id)) {
    state.roster.unshift({ id, nilOffer: guessNilOffer(rowObj) });
  }

  // If it was shortlisted, remove it
  if (Array.isArray(state.shortlistIds)) {
    state.shortlistIds = state.shortlistIds.filter(x => x !== id);
  }

  saveState(state);

  els.meta.textContent = `Added ${player.name} to roster. Go back to the builder to see it.`;
}

function renderTable() {
  const q = (els.search.value || "").trim().toLowerCase();

  let view = rows;

  if (q) {
    view = view.filter(r =>
      columns.some(c => String(r[c] ?? "").toLowerCase().includes(q))
    );
  }

  if (sortKey) {
    view = [...view].sort((ra, rb) => {
      const cmp = compareValues(ra[sortKey], rb[sortKey]);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const headerHtml = columns
    .map(c => {
      const active = c === sortKey;
      const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
      return `<th data-sort="${escapeHtml(c)}" style="position:sticky;top:0;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);cursor:pointer;white-space:nowrap;">
        ${escapeHtml(c)}${arrow}
      </th>`;
    })
    .join("");

  const bodyHtml = view
    .map(r => {
      const id = getPlayerId(r);
      const cells = columns
        .map(c => `<td style="white-space:nowrap;">${escapeHtml(r[c])}</td>`)
        .join("");

      return `
        <tr>
          <td style="white-space:nowrap;">
            <button class="btn btn-primary" data-add="${escapeHtml(id)}" type="button">Add</button>
          </td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  els.tableWrap.innerHTML = `
    <table style="width:100%;border-collapse:separate;border-spacing:0 8px;">
      <thead>
        <tr>
          <th style="position:sticky;top:0;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);">Roster</th>
          ${headerHtml}
        </tr>
      </thead>
      <tbody>
        ${bodyHtml || `<tr><td colspan="${columns.length + 1}" class="muted" style="padding:12px;">No rows found.</td></tr>`}
      </tbody>
    </table>
  `;

  // Sort header clicks
  els.tableWrap.querySelectorAll("th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortKey = key; sortDir = "asc"; }
      renderTable();
    });
  });

  // Add button clicks
  els.tableWrap.querySelectorAll("button[data-add]").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-add");
      const rowObj = rows.find(r => getPlayerId(r) === targetId);
      if (rowObj) addToRoster(rowObj);
    });
  });

  els.meta.textContent = `${view.length.toLocaleString()} rows shown. Click any header to sort.`;
}

async function loadSheet() {
  const sheet = (els.sheetName.value || "Import Board").trim();

  els.meta.textContent = "Loading workbook…";

  const res = await fetch(XLSX_PATH, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not fetch workbook at ${XLSX_PATH} (${res.status})`);

  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const ws = wb.Sheets[sheet];
  if (!ws) {
    const available = wb.SheetNames.join(", ");
    throw new Error(`Sheet "${sheet}" not found. Available: ${available}`);
  }

  const json = XLSX.utils.sheet_to_json(ws, { defval: "" }); // array of objects
  rows = json;

  // Determine columns from the union of keys, keeping first row order preference
  const colSet = new Set();
  for (const r of rows) Object.keys(r).forEach(k => colSet.add(k));
  columns = Array.from(colSet);

  // reset sort
  sortKey = null;
  sortDir = "asc";

  renderTable();
}

els.search.addEventListener("input", renderTable);
els.reloadBtn.addEventListener("click", () => loadSheet().catch(err => (els.meta.textContent = err.message)));

loadSheet().catch(err => {
  els.meta.textContent = err.message;
});