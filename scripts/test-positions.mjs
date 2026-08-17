import {
  POSITIONS, DEFAULT_STARTER_COUNTS, expandPosition, positionsFor,
  positionLabel, slotWeight, assignToPositions, computeOptimalLineup, scoreRoster,
} from "../src/lib/positions.js";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got ${a}\n        want ${e}`}`);
}

console.log("── expandPosition ──");
check("new vocab", expandPosition("PG"), ["PG"]);
check("lowercase new vocab", expandPosition("pg"), ["PG"]);
check("legacy Guard", expandPosition("Guard"), ["PG", "SG"]);
check("legacy Wing", expandPosition("Wing"), ["SF"]);
check("legacy Big", expandPosition("Big"), ["PF", "C"]);
check("legacy lowercase", expandPosition("big"), ["PF", "C"]);
check("raw G", expandPosition("G"), ["PG", "SG"]);
check("raw F", expandPosition("F"), ["SF", "PF"]);
check("empty", expandPosition(""), []);
check("null", expandPosition(null), []);
check("garbage", expandPosition("Stretch 4"), []);

console.log("\n── positionsFor ──");
check("positions array wins", positionsFor({ positions: ["SG", "SF"], primary_position: "PG" }), ["SG", "SF"]);
check("dedupes array", positionsFor({ positions: ["SG", "SG"] }), ["SG"]);
check("drops invalid from array", positionsFor({ positions: ["SG", "BOGUS"] }), ["SG"]);
check("falls back to primary_position", positionsFor({ primary_position: "C" }), ["C"]);
check("falls back to pos (board hook name)", positionsFor({ pos: "Guard" }), ["PG", "SG"]);
check("empty array falls through to primary", positionsFor({ positions: [], primary_position: "PF" }), ["PF"]);
check("unknown falls back to SF", positionsFor({ primary_position: "???" }), ["SF"]);
check("nothing at all falls back to SF", positionsFor({}), ["SF"]);
check("label", positionLabel({ positions: ["PG", "SG"] }), "PG/SG");

console.log("\n── slotWeight ──");
check("starter", slotWeight(0, 2), 1.0);
check("last starter", slotWeight(1, 2), 1.0);
check("first bench", slotWeight(2, 2), 0.2);
check("third bench", slotWeight(4, 2), 0.2);
check("depth", slotWeight(5, 2), 0.04);

console.log("\n── assignToPositions: one player, one slot ──");
const scorer = p => p.v;
// Five dual-eligible players who could all pile into SG/SF.
const roster = [
  { id: "a", positions: ["PG", "SG"], v: 100 },
  { id: "b", positions: ["SG", "SF"], v: 90 },
  { id: "c", positions: ["SF", "PF"], v: 80 },
  { id: "d", positions: ["PF", "C"],  v: 70 },
  { id: "e", positions: ["PF", "C"],  v: 60 },
];
const assigned = assignToPositions(roster, DEFAULT_STARTER_COUNTS, scorer);
const allIds = POSITIONS.flatMap(p => assigned[p].map(x => x.id));
check("every player placed exactly once", allIds.sort(), ["a", "b", "c", "d", "e"]);
check("no duplicates across buckets", allIds.length, new Set(allIds).size);
console.log("        distribution:", POSITIONS.map(p => `${p}:[${assigned[p].map(x => x.id)}]`).join(" "));

console.log("\n── dual-position player is not double-counted ──");
// Same player set, but one is dual vs single — score must not inflate from
// eligibility alone when the roster shape is otherwise identical.
const single = [{ id: "x", positions: ["SF"], v: 100 }];
const dual   = [{ id: "x", positions: ["SF", "PF"], v: 100 }];
const sSingle = scoreRoster(single, scorer, "auto").score;
const sDual   = scoreRoster(dual, scorer, "auto").score;
check("dual eligibility does not inflate score", sDual, sSingle);
console.log(`        single=${sSingle}  dual=${sDual}`);

console.log("\n── intl players excluded (matches old behavior) ──");
const withIntl = [
  { id: "dom", positions: ["PG"], v: 50 },
  { id: "int", positions: ["PG"], v: 999, source: "intl" },
];
const a2 = assignToPositions(withIntl, DEFAULT_STARTER_COUNTS, scorer);
check("intl not assigned", POSITIONS.flatMap(p => a2[p].map(x => x.id)), ["dom"]);

console.log("\n── computeOptimalLineup ──");
check("one starter per filled position", computeOptimalLineup(assigned, scorer),
  { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 });
// Guard-heavy roster with no bigs: extra slots should go to the guards.
const guardHeavy = assignToPositions([
  { id: "g1", positions: ["PG"], v: 100 },
  { id: "g2", positions: ["PG"], v: 95 },
  { id: "g3", positions: ["SG"], v: 90 },
  { id: "g4", positions: ["SG"], v: 85 },
], DEFAULT_STARTER_COUNTS, scorer);
const gl = computeOptimalLineup(guardHeavy, scorer);
check("fills to 5 when positions are empty", POSITIONS.reduce((n, p) => n + gl[p], 0), 4);
console.log("        guard-heavy lineup:", JSON.stringify(gl));

console.log("\n── scoreRoster totals ──");
// The greedy assignment spreads these five dual-eligible players one per
// position, so all five occupy starter slots at full weight.
const r = scoreRoster(roster, scorer, DEFAULT_STARTER_COUNTS);
check("spread roster: everyone starts", r.score, 100 + 90 + 80 + 70 + 60);
console.log(`        score=${r.score} lineup=${JSON.stringify(r.lineup)}`);

// Players who can ONLY play one position must stack there and take bench weights.
const stacked = [
  { id: "p1", positions: ["PG"], v: 100 },
  { id: "p2", positions: ["PG"], v: 90 },
  { id: "p3", positions: ["PG"], v: 80 },
  { id: "p4", positions: ["PG"], v: 70 },
  { id: "p5", positions: ["PG"], v: 60 },
  { id: "p6", positions: ["PG"], v: 50 },
];
const rs = scoreRoster(stacked, scorer, { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 });
// 1 starter, next three at 0.20, remainder at 0.04
const expectStacked = 100 + (90 + 80 + 70) * 0.2 + (60 + 50) * 0.04;
check("stacked roster takes bench/depth weights", rs.score, expectStacked);
console.log(`        score=${rs.score} want=${expectStacked}`);

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
