function setYear() {
  const el = document.getElementById("year");
  if (el) el.textContent = new Date().getFullYear();
}

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get("q")?.trim() || "",
    sport: params.get("sport") || "all",
  };
}

// Demo data generator: replace this with a real API call later.
function mockLookup(q, sport) {
  const base = [
    {
      type: "Player",
      name: q || "Unknown Player",
      sport: sport === "all" ? "multi" : sport,
      stats: { games: 82, points: 1940, assists: 512, rebounds: 611 },
    },
    {
      type: "Team",
      name: q ? `${q} (Team)` : "Unknown Team",
      sport: sport === "all" ? "multi" : sport,
      stats: { wins: 52, losses: 30, rank: 4, streak: "W3" },
    },
  ];

  // If query is short, pretend we found fewer results.
  if ((q || "").length < 4) return base.slice(0, 1);
  return base;
}

function sportLabel(s) {
  const map = { nba: "NBA", nfl: "NFL", mlb: "MLB", nhl: "NHL", soccer: "Soccer", all: "All sports", multi: "Multi" };
  return map[s] || s.toUpperCase();
}

function renderResults(results) {
  const list = document.getElementById("resultsList");
  if (!list) return;
  list.innerHTML = "";

  if (!results.length) {
    list.innerHTML = `<article class="card"><h3>No results</h3><p>Try a different search.</p></article>`;
    return;
  }

  for (const r of results) {
    const statsRows = Object.entries(r.stats)
      .map(([k, v]) => `<div class="mock-stat"><div class="label">${k}</div><div class="value">${v}</div></div>`)
      .join("");

    const el = document.createElement("article");
    el.className = "card";
    el.innerHTML = `
      <h3>${r.type}: ${escapeHtml(r.name)}</h3>
      <p style="color: rgba(255,255,255,0.7); margin-top: -6px;">
        Sport: <strong>${sportLabel(r.sport)}</strong>
      </p>
      <div class="mock-grid" style="margin-top: 12px;">
        ${statsRows}
      </div>
      <p style="color: rgba(255,255,255,0.6); margin-top: 12px;">
        Shareable link: <code>${escapeHtml(window.location.href)}</code>
      </p>
    `;
    list.appendChild(el);
  }
}

function escapeHtml(str) {
  return (str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wireResultsSearchForm() {
  const form = document.getElementById("resultsSearchForm");
  if (!form) return;

  // Pre-fill form from URL params
  const { q, sport } = getParams();
  const qInput = document.getElementById("resultsQuery");
  const sSelect = document.getElementById("resultsSport");
  if (qInput) qInput.value = q;
  if (sSelect) sSelect.value = sport;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q2 = qInput.value.trim();
    const s2 = sSelect.value;

    const params = new URLSearchParams();
    params.set("q", q2);
    if (s2 !== "all") params.set("sport", s2);

    window.location.search = params.toString();
  });
}

function main() {
  setYear();
  wireResultsSearchForm();

  const { q, sport } = getParams();
  const meta = document.getElementById("resultsMeta");
  if (meta) {
    meta.textContent = q
      ? `Showing demo results for “${q}” in ${sportLabel(sport)}`
      : `Type a search to see demo results.`;
  }

  const results = q ? mockLookup(q, sport) : [];
  renderResults(results);
}

main();