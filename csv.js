// csv.js (ES module)
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"'; // escaped quote
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else if (c === "\r") {
        // ignore
      } else {
        field += c;
      }
    }
  }

  // last field
  row.push(field);
  rows.push(row);

  // Remove empty trailing row if present
  while (rows.length && rows[rows.length - 1].every(v => String(v).trim() === "")) rows.pop();

  if (!rows.length) return [];

  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = cols[idx] ?? ""));
    return obj;
  });
}

export function normalizeNumber(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim().replaceAll(",", "").replaceAll("$", "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function firstVal(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}