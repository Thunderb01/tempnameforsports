#!/usr/bin/env node
// ── scripts/check-lookups.mjs ─────────────────────────────────────────────────
// Guard against direct lookup-table imports that bypass our normalizers.
// Run via `npm run check:lookups` (or wire into a pre-commit hook).
//
// Each rule below is { pattern, allow, message }:
//   pattern — regex matched against each source line
//   allow   — files where the pattern is allowed (the helper module itself)
//   message — what to print on a violation
//
// Add a new rule any time you build a normalizer/helper around a static lookup
// table or DB column. That way every alias-prone field gets the same treatment.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC  = join(ROOT, "src");

const RULES = [
  {
    name: "teamConferences",
    // Catch any direct import of the CSV / old JSON, or raw indexing of the
    // parsed map. Source of truth is data/team_conferences.csv; consumers
    // must go through getTeamConference / getCanonicalTeamName.
    pattern: /from\s+['"]@data\/team_conferences|from\s+['"]@\/data\/teamConferences|teamConferences\s*\[/,
    allow:  new Set(["src/lib/teamLookup.js"]),
    message: 'Use `getTeamConference(team)` or `getCanonicalTeamName(team)` from "@/lib/teamLookup" — going through the CSV directly misses name variants like "Murray State" vs "Murray St." and aliases like "UConn" / "Connecticut".',
  },
  // Add more rules here as you build more lookup helpers.
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

let violations = 0;
for (const file of walk(SRC)) {
  const rel   = relative(ROOT, file).split(sep).join("/");
  const lines = readFileSync(file, "utf8").split("\n");
  for (const rule of RULES) {
    if (rule.allow.has(rel)) continue;
    lines.forEach((line, i) => {
      if (rule.pattern.test(line)) {
        if (violations === 0) console.error("");
        console.error(`✗ ${rel}:${i + 1}  [${rule.name}]`);
        console.error(`    ${line.trim()}`);
        console.error(`    → ${rule.message}\n`);
        violations++;
      }
    });
  }
}

if (violations) {
  console.error(`Found ${violations} violation${violations === 1 ? "" : "s"}.`);
  process.exit(1);
} else {
  console.log("OK — no direct lookup-table access detected.");
}
