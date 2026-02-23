function setYear() {
  const el = document.getElementById("year");
  if (el) el.textContent = new Date().getFullYear();
}

function buildResultsUrl(query, sport) {
  const params = new URLSearchParams();
  params.set("q", query.trim());
  if (sport && sport !== "all") params.set("sport", sport);
  return `./results.html?${params.toString()}`;
}

function wireSearchForm() {
  const form = document.getElementById("searchForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = form.querySelector("#query").value;
    const sport = form.querySelector("#sport").value;
    window.location.href = buildResultsUrl(q, sport);
  });
}

function wireDemoChips() {
  document.querySelectorAll("[data-demo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const query = btn.getAttribute("data-demo");
      const input = document.getElementById("query");
      if (input) input.value = query;
      input?.focus();
    });
  });
}

setYear();
wireSearchForm();
wireDemoChips();