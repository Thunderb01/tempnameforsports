import { getPlayerTags, tagInputsFromRepo, TAG_RULES, UNIMPLEMENTED_TAGS, TAG_CATEGORIES } from "../src/lib/playerTags.js";
import { idx, makeIdx, isIdxTableComplete, IDX_TABLE, IdxConfigError } from "../src/lib/playerTagsConfig.js";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got ${a}\n        want ${e}`}`);
}
function throwsIdx(fn) {
  try { fn(); return "no throw"; } catch (e) { return e instanceof IdxConfigError ? "IdxConfigError" : `other: ${e}`; }
}

// TEST-ONLY idx table. Arbitrary but strictly increasing so every threshold
// is distinct; these are NOT proposed production values.
const T = { 90: 10, 95: 15, 100: 20, 110: 30, 120: 40, 125: 45, 130: 60, 140: 70, 150: 80 };
const tagsT = p => getPlayerTags(p, { table: T });
const names = (p, table = T) => getPlayerTags(p, { table }).map(t => t.name);
const has = (p, tag) => names(p).includes(tag);

// A player that earns no tags under T.
const BASE = {
  position: "Big", usg: 15, creation: 50, ast_to: 1.2, to_pg: 1, rim_impact: 20,
  three_pa_pg: 1.5, three_pt_pct: 0.30, scoring_efficiency: 25, rim_ast_pct: 0.5,
  rim_fg_pct: 0.5, orb_per40: 2, blk_per40: 1, defensive_disruption: 30,
  stl_per40: 1, drb_per40: 5, min_pct: 0.3, pf_per40: 2,
};
const P = over => ({ ...BASE, ...over });

// Boundary triple on one input: [just below, exactly at, just above].
function bounds(tag, over, key, at, want, eps = 0.01) {
  const got = [at - eps, at, at + eps].map(v => has(P({ ...over, [key]: v }), tag));
  check(`${tag}: ${key} below/at/above ${at}`, got, want);
}

console.log("── idx() ──");
check("real table is incomplete today", isIdxTableComplete(), false);
check("real idx(150) throws while any entry is unfilled", throwsIdx(() => idx(150)), "IdxConfigError");
check("real idx(130) (unfilled) throws", throwsIdx(() => idx(130)), "IdxConfigError");
check("idx(150) entry is 50", IDX_TABLE[150], 50);
const full = makeIdx(T);
check("filled table: idx(130)", full(130), 60);
check("filled table: unknown value throws", throwsIdx(() => full(115)), "IdxConfigError");
check("filled table: string key not interpolated", throwsIdx(() => full(151)), "IdxConfigError");
check("one null entry → every call throws", throwsIdx(() => makeIdx({ ...T, 95: null })(150)), "IdxConfigError");
check("NaN entry counts as unfilled", throwsIdx(() => makeIdx({ ...T, 95: NaN })(150)), "IdxConfigError");

console.log("\n── incomplete table: metric tags skipped, raw-stat tags still produced ──");
const loaded = { ...BASE, usg: 30, creation: 99, stl_per40: 2.5, scoring_efficiency: 99 };
check("only raw-stat tags", names(loaded, IDX_TABLE), ["Ball Dominant", "Stocks Monster", "Steals Playmaker"]);
check("same player, filled table, also gets metric tags",
  ["Primary Playmaker", "Efficient Scorer"].every(t => names(loaded).includes(t)), true);

console.log("\n── base / shape ──");
check("BASE earns nothing", names(BASE), []);
check("tag carries category", tagsT(P({ usg: 25 })), [{ name: "Ball Dominant", category: "Playmaking" }]);
check("every rule category is a known category",
  TAG_RULES.every(r => Object.values(TAG_CATEGORIES).includes(r.category)), true);
check("shotmaking tags listed as unimplemented",
  UNIMPLEMENTED_TAGS.map(t => t.name), ["Shot Maker", "Elite Shot Maker", "Tough-Shot Specialist", "Limited Self-Creation"]);
check("no implemented rule is in Shotmaking", TAG_RULES.some(r => r.category === "Shotmaking"), false);
check("null input → []", getPlayerTags(null, { table: T }), []);

console.log("\n── Playmaking ──");
check("Primary Playmaker qualifies", has(P({ usg: 25, creation: 90 }), "Primary Playmaker"), true);
check("Primary Playmaker fails", has(P({ usg: 25, creation: 70 }), "Primary Playmaker"), false);
bounds("Primary Playmaker", { creation: 90 }, "usg", 20, [false, false, true]);
bounds("Primary Playmaker", { usg: 25 }, "creation", 80, [false, false, true]);

check("Secondary Playmaker qualifies", has(P({ usg: 19, creation: 70 }), "Secondary Playmaker"), true);
check("Secondary Playmaker fails", has(P({ usg: 17, creation: 70 }), "Secondary Playmaker"), false);
bounds("Secondary Playmaker", { creation: 70 }, "usg", 18, [false, false, true]);
bounds("Secondary Playmaker", { usg: 19 }, "creation", 60, [false, false, true]);
bounds("Secondary Playmaker", { usg: 19 }, "creation", 80, [true, true, false]);
check("quirk: usg 19 & creation > idx(150) → neither playmaker tag",
  names(P({ usg: 19, creation: 90 })).filter(n => /Playmaker/.test(n)), []);

check("Ball Dominant qualifies", has(P({ usg: 30 }), "Ball Dominant"), true);
check("Ball Dominant fails", has(P({ usg: 20 }), "Ball Dominant"), false);
bounds("Ball Dominant", {}, "usg", 24, [false, false, true]);

check("High-IQ Passer qualifies", has(P({ ast_to: 2.5, creation: 70 }), "High-IQ Passer"), true);
check("High-IQ Passer fails", has(P({ ast_to: 1.5, creation: 70 }), "High-IQ Passer"), false);
bounds("High-IQ Passer", { creation: 70 }, "ast_to", 2, [false, false, true]);
bounds("High-IQ Passer", { ast_to: 2.5 }, "creation", 60, [false, false, true]);

check("Non-Passer qualifies", has(P({ creation: 5 }), "Non-Passer"), true);
check("Non-Passer fails", has(P({ creation: 50 }), "Non-Passer"), false);
bounds("Non-Passer", {}, "creation", 10, [true, false, false]);

check("Turnover-Prone qualifies", has(P({ ast_to: 0.8, to_pg: 3.5 }), "Turnover-Prone"), true);
check("Turnover-Prone fails", has(P({ ast_to: 1.2, to_pg: 3.5 }), "Turnover-Prone"), false);
bounds("Turnover-Prone", { to_pg: 3.5 }, "ast_to", 1, [true, false, false]);
bounds("Turnover-Prone", { ast_to: 0.8 }, "to_pg", 3, [false, false, true]);

const LMH = { position: "Guard", usg: 24, to_pg: 2, ast_to: 2 };
check("Low-Mistake Handler qualifies", has(P(LMH), "Low-Mistake Handler"), true);
check("Low-Mistake Handler fails (non-guard)", has(P({ ...LMH, position: "Wing" }), "Low-Mistake Handler"), false);
check("Low-Mistake Handler fails (Forward ≠ Guard)", has(P({ ...LMH, position: "Forward" }), "Low-Mistake Handler"), false);
bounds("Low-Mistake Handler", LMH, "to_pg", 2.4, [true, true, false]);       // usg/10 = 2.4
bounds("Low-Mistake Handler", LMH, "ast_to", 1.5, [false, true, true]);

const PTC = { position: "Guard", rim_impact: 35, usg: 20, to_pg: 3, ast_to: 1.2 }; // LMH fails (to_pg > usg/10)
check("Paint Touch Creator qualifies", has(P(PTC), "Paint Touch Creator"), true);
check("Paint Touch Creator fails (non-guard)", has(P({ ...PTC, position: "Wing" }), "Paint Touch Creator"), false);
bounds("Paint Touch Creator", PTC, "rim_impact", 30, [false, true, true]);
const both = P({ ...PTC, to_pg: 1, ast_to: 2 });                             // now LMH qualifies
check("exclusion: LMH awarded → no Paint Touch Creator",
  [has(both, "Low-Mistake Handler"), has(both, "Paint Touch Creator")], [true, false]);
check("exclusion: LMH inputs missing → Paint Touch Creator skipped, not assumed",
  has(P({ ...PTC, ast_to: null }), "Paint Touch Creator"), false);

console.log("\n── Shooting and scoring ──");
check("Non-Shooter qualifies", has(P({ three_pa_pg: 0.5 }), "Non-Shooter"), true);
check("Non-Shooter fails", has(P({ three_pa_pg: 3 }), "Non-Shooter"), false);
bounds("Non-Shooter", {}, "three_pa_pg", 1, [true, false, false]);

const SH = { three_pt_pct: 0.37, three_pa_pg: 3 };
check("Shooter qualifies", has(P(SH), "Shooter"), true);
check("Shooter fails", has(P({ ...SH, three_pt_pct: 0.30 }), "Shooter"), false);
bounds("Shooter", SH, "three_pt_pct", 0.35, [false, true, true], 0.001);
bounds("Shooter", SH, "three_pt_pct", 0.40, [true, false, false], 0.001);
bounds("Shooter", SH, "three_pa_pg", 2, [false, true, true]);

const ES = { three_pt_pct: 0.42, three_pa_pg: 3 };
check("Elite Shooter qualifies", has(P(ES), "Elite Shooter"), true);
check("Elite Shooter fails", has(P({ ...ES, three_pa_pg: 1 }), "Elite Shooter"), false);
bounds("Elite Shooter", ES, "three_pt_pct", 0.40, [false, true, true], 0.001);
bounds("Elite Shooter", ES, "three_pa_pg", 2, [false, true, true]);
check("Shooter and Elite Shooter don't stack", names(P(ES)).filter(n => /Shooter$/.test(n)), ["Elite Shooter"]);

check("Volume Scorer qualifies", has(P({ usg: 26, scoring_efficiency: 50 }), "Volume Scorer"), true);
check("Volume Scorer fails", has(P({ usg: 22, scoring_efficiency: 50 }), "Volume Scorer"), false);
bounds("Volume Scorer", { scoring_efficiency: 50 }, "usg", 24, [false, false, true]);
bounds("Volume Scorer", { usg: 26 }, "scoring_efficiency", 40, [false, false, true]);

check("Efficient Scorer qualifies", has(P({ scoring_efficiency: 70 }), "Efficient Scorer"), true);
check("Efficient Scorer fails", has(P({ scoring_efficiency: 50 }), "Efficient Scorer"), false);
bounds("Efficient Scorer", {}, "scoring_efficiency", 60, [false, true, true]);

check("Low-Efficiency Scorer qualifies", has(P({ scoring_efficiency: 10, usg: 25 }), "Low-Efficiency Scorer"), true);
check("Low-Efficiency Scorer fails", has(P({ scoring_efficiency: 10, usg: 20 }), "Low-Efficiency Scorer"), false);
bounds("Low-Efficiency Scorer", { usg: 25 }, "scoring_efficiency", 20, [true, false, false]);
bounds("Low-Efficiency Scorer", { scoring_efficiency: 10 }, "usg", 22, [false, false, true]);

check("Low-USG Finisher qualifies", has(P({ scoring_efficiency: 35, usg: 15 }), "Low-USG Finisher"), true);
check("Low-USG Finisher fails", has(P({ scoring_efficiency: 35, usg: 21 }), "Low-USG Finisher"), false);
bounds("Low-USG Finisher", { usg: 15 }, "scoring_efficiency", 30, [false, false, true]);
bounds("Low-USG Finisher", { scoring_efficiency: 35 }, "usg", 20, [true, false, false]);

console.log("\n── Rim and interior ──");
check("Slasher qualifies (Guard)", has(P({ position: "Guard", rim_impact: 50 }), "Slasher"), true);
check("Slasher qualifies (Wing)", has(P({ position: "Wing", rim_impact: 50 }), "Slasher"), true);
check("Slasher fails (Big)", has(P({ position: "Big", rim_impact: 50 }), "Slasher"), false);
check("Slasher skipped (Forward — open question)", has(P({ position: "Forward", rim_impact: 50 }), "Slasher"), false);
bounds("Slasher", { position: "Wing" }, "rim_impact", 40, [false, true, true]);

check("Elite Rim Pressure qualifies", has(P({ rim_impact: 50, rim_ast_pct: 0.2 }), "Elite Rim Pressure"), true);
check("Elite Rim Pressure fails", has(P({ rim_impact: 50, rim_ast_pct: 0.5 }), "Elite Rim Pressure"), false);
bounds("Elite Rim Pressure", { rim_ast_pct: 0.2 }, "rim_impact", 40, [false, true, true]);
bounds("Elite Rim Pressure", { rim_impact: 50 }, "rim_ast_pct", 0.30, [true, false, false], 0.001);

check("Elite Rim Finisher qualifies", has(P({ rim_fg_pct: 0.70 }), "Elite Rim Finisher"), true);
check("Elite Rim Finisher fails", has(P({ rim_fg_pct: 0.60 }), "Elite Rim Finisher"), false);
bounds("Elite Rim Finisher", {}, "rim_fg_pct", 0.65, [false, true, true], 0.001);

check("Offensive Glass Threat qualifies", has(P({ orb_per40: 5 }), "Offensive Glass Threat"), true);
check("Offensive Glass Threat fails", has(P({ orb_per40: 3 }), "Offensive Glass Threat"), false);
bounds("Offensive Glass Threat", {}, "orb_per40", 4, [false, false, true]);

check("Rim Protector qualifies", has(P({ blk_per40: 2 }), "Rim Protector"), true);
check("Rim Protector fails", has(P({ blk_per40: 1 }), "Rim Protector"), false);
bounds("Rim Protector", {}, "blk_per40", 1.5, [false, false, true]);

check("Interior Force qualifies", has(P({ rim_impact: 80 }), "Interior Force"), true);
check("Interior Force fails", has(P({ rim_impact: 50 }), "Interior Force"), false);
bounds("Interior Force", {}, "rim_impact", 70, [false, true, true]);

console.log("\n── Defense ──");
check("Disruptive Defender qualifies", has(P({ defensive_disruption: 65 }), "Disruptive Defender"), true);
check("Disruptive Defender fails", has(P({ defensive_disruption: 50 }), "Disruptive Defender"), false);
bounds("Disruptive Defender", {}, "defensive_disruption", 60, [false, true, true]);

check("Elite Disruptor qualifies", has(P({ defensive_disruption: 85 }), "Elite Disruptor"), true);
check("Elite Disruptor fails", has(P({ defensive_disruption: 70 }), "Elite Disruptor"), false);
bounds("Elite Disruptor", {}, "defensive_disruption", 80, [false, true, true]);
check("quirk: Elite Disruptor stacks with Disruptive Defender",
  names(P({ defensive_disruption: 85 })), ["Disruptive Defender", "Elite Disruptor"]);

check("Stocks Monster qualifies", has(P({ stl_per40: 1.5, blk_per40: 2 }), "Stocks Monster"), true);
check("Stocks Monster fails", has(P({ stl_per40: 1, blk_per40: 1 }), "Stocks Monster"), false);
bounds("Stocks Monster", { blk_per40: 1 }, "stl_per40", 2, [false, true, true]);

check("Steals Playmaker qualifies", has(P({ stl_per40: 2.5 }), "Steals Playmaker"), true);
check("Steals Playmaker fails", has(P({ stl_per40: 1.5 }), "Steals Playmaker"), false);
bounds("Steals Playmaker", {}, "stl_per40", 2, [false, true, true]);

check("Defensive Glass Cleaner qualifies", has(P({ drb_per40: 8, min_pct: 0.6 }), "Defensive Glass Cleaner"), true);
check("Defensive Glass Cleaner fails", has(P({ drb_per40: 8, min_pct: 0.3 }), "Defensive Glass Cleaner"), false);
bounds("Defensive Glass Cleaner", { min_pct: 0.6 }, "drb_per40", 7, [false, false, true]);
bounds("Defensive Glass Cleaner", { drb_per40: 8 }, "min_pct", 0.40, [false, false, true], 0.001);

check("Foul-Prone Defender qualifies", has(P({ pf_per40: 5 }), "Foul-Prone Defender"), true);
check("Foul-Prone Defender fails", has(P({ pf_per40: 3 }), "Foul-Prone Defender"), false);
bounds("Foul-Prone Defender", {}, "pf_per40", 4.5, [false, true, true]);

console.log("\n── Missing data: skipped, never coerced to 0 ──");
// If null were treated as 0, each of these would fire.
check("null creation → no Non-Passer", has(P({ creation: null }), "Non-Passer"), false);
check("undefined three_pa_pg → no Non-Shooter", has(P({ three_pa_pg: undefined }), "Non-Shooter"), false);
check("NaN scoring_efficiency → no Low-Efficiency Scorer", has(P({ scoring_efficiency: NaN, usg: 25 }), "Low-Efficiency Scorer"), false);
check("null ast_to → no Turnover-Prone", has(P({ ast_to: null, to_pg: 4 }), "Turnover-Prone"), false);
check("null rim_ast_pct → no Elite Rim Pressure", has(P({ rim_impact: 50, rim_ast_pct: null }), "Elite Rim Pressure"), false);
check("null blk_per40 → no Stocks Monster", has(P({ stl_per40: 3, blk_per40: null }), "Stocks Monster"), false);
check("null usg → no Low-USG Finisher", has(P({ scoring_efficiency: 35, usg: null }), "Low-USG Finisher"), false);
check("missing position → no Low-Mistake Handler", has(P({ ...LMH, position: null }), "Low-Mistake Handler"), false);
check("unknown position string → treated as missing", has(P({ position: "Center", rim_impact: 50 }), "Slasher"), false);
check("string number is not accepted by core fn", has(P({ usg: "30" }), "Ball Dominant"), false);
check("one missing input doesn't block unrelated tags", names(P({ creation: null, usg: 30 })), ["Ball Dominant"]);

console.log("\n── tagInputsFromRepo ──");
const row = {
  cdi: 70, dds: 55, sei: 60, ris: 45, usg: 22.5, ast_tov: 1.8,
  torvik_min_pct: 62.5, tot_pf: 60, tot_mp: 800, tot_tov: 45, tot_g: 30,
  assisted_pct_rim: 0.25, torvik_rim_pct: 0.66, torvik_3p_pct: 0.381, "3pg": 4.2,
  stl_40: 1.6, blk_40: 0.4, drb_40: 5.1, orb_40: 1.2,
};
const mapped = tagInputsFromRepo({ positions: ["PG", "SG"] }, row);
check("maps all fields", mapped, {
  position: "Guard", creation: 70, defensive_disruption: 55, scoring_efficiency: 60, rim_impact: 45,
  min_pct: 0.625, usg: 22.5, pf_per40: 3, to_pg: 1.5, rim_ast_pct: 0.25, rim_fg_pct: 0.66,
  three_pt_pct: 0.381, three_pa_pg: 4.2, ast_to: 1.8, stl_per40: 1.6, blk_per40: 0.4,
  drb_per40: 5.1, orb_per40: 1.2,
});
check("SF+PF → Forward", tagInputsFromRepo({ positions: ["SF", "PF"] }, row).position, "Forward");
check("C → Big", tagInputsFromRepo({ primary_position: "C" }, row).position, "Big");
check("no position data → null (not legacyBucketFor's Wing fallback)", tagInputsFromRepo({}, row).position, null);
check("garbage position → null", tagInputsFromRepo({ primary_position: "???" }, row).position, null);
check("empty stats row → every stat null",
  Object.values(tagInputsFromRepo({ positions: ["C"] }, {})).filter(v => v !== null), ["Big"]);
check("tot_g = 0 → to_pg null, not Infinity", tagInputsFromRepo(null, { tot_tov: 5, tot_g: 0 }).to_pg, null);
check("tot_mp missing → pf_per40 null", tagInputsFromRepo(null, { tot_pf: 50 }).pf_per40, null);
check("blank string → null", tagInputsFromRepo(null, { usg: "" }).usg, null);
check("numeric string from DB → number", tagInputsFromRepo(null, { usg: "24.5" }).usg, 24.5);
check("end-to-end with filled table", names(tagInputsFromRepo({ positions: ["PG"] }, row)),
  ["Secondary Playmaker", "Low-Mistake Handler", "Shooter", "Efficient Scorer",
   "Slasher", "Elite Rim Pressure", "Elite Rim Finisher"]);

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
