// roster-ui.js
// Wires the "Import returning roster" UI into the existing app state.
// Runs as a separate module so it doesn't require changes to app.js internals.

import { fetchTeamRoster, getTeamNames } from "./roster.js";
import { parseCSV, normalizeNumber, firstVal } from "./csv.js";

const STORAGE_KEY     = "bp_roster_builder_v1";
const RETURNING_KEY   = "bp_returning_roster_v1"; // separate key — doesn't pollute main state

// ── DOM refs ─────────────────────────────────────────────────────────────────
const teamSelect       = document.getElementById("rosterTeamSelect");
const importBtn        = document.getElementById("rosterImportBtn");
const statusEl         = document.getElementById("rosterImportStatus");
const returningSection = document.getElementById("returningSection");
const returningList    = document.getElementById("returningList");
const rosterDivider    = document.getElementById("rosterDivider");
const csvInput         = document.getElementById("rosterCsvInput");

// ── Populate team dropdown ────────────────────────────────────────────────────
getTeamNames().forEach(name => {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  teamSelect.appendChild(opt);
});

// Pre-select the program set in the builder settings
function preselectTeam() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    const program = state?.settings?.program?.trim();
    if (program && teamSelect.querySelector(`option[value="${program}"]`)) {
      teamSelect.value = program;
    }
  } catch { /* ignore */ }
}
preselectTeam();

// ── Returning roster state (persisted separately) ─────────────────────────────
function loadReturning() {
  try {
    const raw = localStorage.getItem(RETURNING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveReturning(players) {
  localStorage.setItem(RETURNING_KEY, JSON.stringify(players));
}

let returningPlayers = loadReturning();

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return (str || "").toString()
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError
    ? "var(--color-text-danger, #e55)"
    : "var(--color-text-secondary, inherit)";
}

// ── Render returning roster ───────────────────────────────────────────────────
function renderReturning() {
  if (!returningPlayers.length) {
    returningSection.hidden = true;
    rosterDivider.hidden = true;
    return;
  }

  returningSection.hidden = false;

  // Check if there are any portal adds to decide whether to show divider
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const state = JSON.parse(raw || "{}");
    rosterDivider.hidden = !(state.roster && state.roster.length > 0);
  } catch {
    rosterDivider.hidden = true;
  }

  // Group by position for a cleaner display
  const byPos = { Guard: [], Wing: [], Big: [], Other: [] };
  returningPlayers.forEach(p => {
    const bucket = byPos[p.pos] ? p.pos : "Other";
    byPos[bucket].push(p);
  });

  const posOrder = ["Guard", "Wing", "Big", "Other"];

  returningList.innerHTML = posOrder.flatMap(pos => {
    const group = byPos[pos];
    if (!group.length) return [];

    const rows = group.map(p => `
      <div class="row" style="opacity:.85;">
        <div class="row-main">
          <div class="row-title" style="font-size:13px;">${escapeHtml(p.name)}</div>
          <div class="row-sub" style="font-size:11px;">${escapeHtml(p.pos)} • ${escapeHtml(p.year)}</div>
        </div>
        <div class="row-actions">
          <span style="font-size:11px;opacity:.5;padding:4px 8px;">Returning</span>
          <button class="btn btn-ghost" style="font-size:11px;padding:4px 10px;"
            data-ret-remove="${escapeHtml(p.id)}">✕</button>
        </div>
      </div>
    `);

    return [
      `<div style="padding:6px 12px 2px;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;opacity:.4;">${pos}s (${group.length})</div>`,
      ...rows,
    ];
  }).join("");

  // Wire remove buttons
  returningList.querySelectorAll("[data-ret-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-ret-remove");
      returningPlayers = returningPlayers.filter(p => p.id !== id);
      saveReturning(returningPlayers);
      renderReturning();
      updateScholarshipCount();
    });
  });
}

// ── Scholarship counter patch ─────────────────────────────────────────────────
// Patches the summary to include returning players in the roster count.
// Runs after each render cycle by observing the summary element.
function updateScholarshipCount() {
  // Dispatch a custom event so app.js can optionally listen — 
  // but since app.js reads state.roster directly, we also patch the DOM summary.
  const summaryEl = document.getElementById("summary");
  if (!summaryEl) return;

  const retCount = returningPlayers.length;
  if (!retCount) return;

  // Find the "Roster" stat box and append returning count note
  const boxes = summaryEl.querySelectorAll(".sum");
  boxes.forEach(box => {
    const label = box.querySelector(".label");
    const value = box.querySelector(".value");
    if (label?.textContent === "Roster" && value) {
      // Parse out the portal-adds count from existing text (e.g. "3 / 15")
      const match = value.textContent.match(/^(\d+)/);
      if (match) {
        const portalAdds = parseInt(match[1], 10);
        const total = portalAdds + retCount;
        const cap = value.textContent.replace(/^\d+/, total.toString());

        // Only update if not already patched to avoid recursion
        if (!value.textContent.includes("(")) {
          value.textContent = cap;
          // Add small returning annotation
          const note = document.createElement("span");
          note.style.cssText = "font-size:10px;opacity:.5;margin-left:6px;";
          note.textContent = `(${retCount} ret.)`;
          value.appendChild(note);
        }
      }
    }
  });
}

// Watch for app.js re-renders by observing the summary element
const summaryEl = document.getElementById("summary");
if (summaryEl) {
  new MutationObserver(() => updateScholarshipCount())
    .observe(summaryEl, { childList: true, subtree: true });
}

// ── SR import handler ─────────────────────────────────────────────────────────
importBtn.addEventListener("click", async () => {
  const team = teamSelect.value;
  if (!team) {
    setStatus("Please select a team first.", true);
    return;
  }

  importBtn.disabled = true;
  setStatus(`Fetching ${team} roster…`);

  try {
    const players = await fetchTeamRoster(team);
    returningPlayers = players;
    saveReturning(returningPlayers);
    renderReturning();
    setStatus(`✓ Imported ${players.length} returning players from Sports Reference.`);
  } catch (err) {
    setStatus(`Failed: ${err.message}`, true);
    console.error("Roster import error:", err);
  } finally {
    importBtn.disabled = false;
  }
});

// ── CSV fallback handler ──────────────────────────────────────────────────────
// Expected columns: Name, Position (or Pos), Year (or Class)
// All other columns are stored in stats for reference.
csvInput.addEventListener("change", async () => {
  const file = csvInput.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const rows = parseCSV(text);

    if (!rows.length) throw new Error("CSV appears to be empty.");

    const team = teamSelect.value || "Unknown";

    returningPlayers = rows.map((r, i) => {
      const name = firstVal(r.Name, r["Player Name"], r.Player, r.name, "").trim();
      if (!name) return null;

      const pos  = normalizePos(firstVal(r.Position, r.Pos, r["Primary Position"], r.pos, ""));
      const year = normalizeYear(firstVal(r.Year, r.Class, r.year, r.class, ""));
      const id   = `ret_csv_${String(name).toLowerCase().replace(/\s+/g, "_")}_${i}`;

      return {
        id,
        name,
        team,
        pos,
        year,
        marketLow:     0,
        marketHigh:    0,
        tags:          [],
        playmakerTags: [],
        shootingTags:  [],
        stats:         r,
        source:        "returning",
      };
    }).filter(Boolean);

    saveReturning(returningPlayers);
    renderReturning();
    setStatus(`✓ Imported ${returningPlayers.length} players from CSV.`);
  } catch (err) {
    setStatus(`CSV import failed: ${err.message}`, true);
  } finally {
    csvInput.value = "";
  }
});

// ── Helpers also used in CSV import ──────────────────────────────────────────
function normalizePos(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (s.startsWith("G")) return "Guard";
  if (s.startsWith("F")) return "Wing";
  if (s.startsWith("C")) return "Big";
  return raw || "";
}

function normalizeYear(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "fr" || s.includes("fresh")) return "Freshman";
  if (s === "so" || s.includes("soph"))  return "Sophomore";
  if (s === "jr" || s.includes("jun"))   return "Junior";
  if (s === "sr" || s.includes("sen"))   return "Senior";
  if (s === "gr" || s.includes("grad"))  return "Graduate";
  return raw || "";
}

// ── Clear returning roster when main state is reset ───────────────────────────
document.getElementById("resetBtn")?.addEventListener("click", () => {
  returningPlayers = [];
  saveReturning([]);
  renderReturning();
  setStatus("");
});

// ── Initial render ────────────────────────────────────────────────────────────
renderReturning();
