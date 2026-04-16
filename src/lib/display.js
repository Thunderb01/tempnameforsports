// ── display.js ───────────────────────────────────────────────────────────────
// Shared display/formatting utilities used across pages and components.
// Import what you need: import { money, projectedTier, ... } from "@/lib/display";

// ── Currency ──────────────────────────────────────────────────────────────────
export function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

// ── Height ────────────────────────────────────────────────────────────────────
export function heightToInches(h) {
  if (!h || h === "—") return -1;
  const m = String(h).match(/^(\d+)-(\d+)$/);
  return m ? parseInt(m[1]) * 12 + parseInt(m[2]) : -1;
}

// ── NIL tiers ─────────────────────────────────────────────────────────────────
export const TIER_COLORS = {
  "HM All-American / Pre-Draft":        "#4ade80",
  "HM All-Conference":                  "#5b9cf6",
  "HM Starter / MM All-Conference":     "#f5c542",
  "HM Rotation / MM Starter":           "#fb923c",
  "MM Role Player / LM All-Conference": "#e05c5c",
  "LM Rotation":                        "#94a3b8",
};

export function tierColor(label) {
  return TIER_COLORS[label] || "#64748b";
}

export function projectedTier(v) {
  v = Number(v) || 0;
  if (v >= 2_200_000) return "HM All-American / Pre-Draft";
  if (v >= 1_500_000) return "HM All-Conference";
  if (v >=   750_000) return "HM Starter / MM All-Conference";
  if (v >=   400_000) return "HM Rotation / MM Starter";
  if (v >=   100_000) return "MM Role Player / LM All-Conference";
  return "LM Rotation";
}

// ── Metric grades ─────────────────────────────────────────────────────────────
export function letterGrade(val) {
  if (val == null) return "—";
  if (val >= 95) return "A+"; if (val >= 90) return "A";
  if (val >= 85) return "A-"; if (val >= 80) return "B+";
  if (val >= 75) return "B";  if (val >= 70) return "B-";
  if (val >= 60) return "C+"; if (val >= 50) return "C";
  if (val >= 40) return "C-"; if (val >= 30) return "D+";
  if (val >= 20) return "D";  return "F";
}

/** Color for a letter grade string (e.g. "A+", "B-", "F", "—"). */
export function gradeColor(grade) {
  if (!grade || grade === "—") return "rgba(255,255,255,.4)";
  if (grade.startsWith("A")) return "#4ade80";
  if (grade.startsWith("B")) return "#5b9cf6";
  if (grade.startsWith("C")) return "#f5a623";
  if (grade.startsWith("D")) return "#fb923c";
  return "#e05c5c"; // F
}

/** Color for a raw 0–100 numeric metric value. */
export function gradeColorFromVal(val) {
  if (val == null) return "rgba(255,255,255,.25)";
  if (val >= 85) return "#4ade80";
  if (val >= 70) return "#5b9cf6";
  if (val >= 50) return "#f5a623";
  if (val >= 30) return "#fb923c";
  return "#e05c5c";
}
