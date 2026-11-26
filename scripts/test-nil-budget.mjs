// Tests for src/lib/nilBudget.js -- run via `npm run test:nil-budget` (part of `npm run build`).
import {
  MAX_PLAYER_SHARE, NIL_TIERS, nilTierForConference, teamBudgetForConference,
  playerCeilingForConference, HM_PLAYER_CEILING, LEGACY_PLAYER_CEILING,
  valueCeilingFor, scaleLegacyDollars, valueForTeamBudget,
} from "../src/lib/nilBudget.js";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got ${a}\n        want ${e}`}`);
}

console.log("── tiers ──");
check("max share", MAX_PLAYER_SHARE, 0.30);
check("HM budget",  NIL_TIERS.HM.team_budget,  20_000_000);
check("HMM budget", NIL_TIERS.HMM.team_budget, 12_000_000);
check("MM budget",  NIL_TIERS.MM.team_budget,   8_000_000);
check("LM budget",  NIL_TIERS.LM.team_budget,   4_500_000);
check("SEC -> HM", nilTierForConference("SEC"), "HM");
check("WCC -> HMM", nilTierForConference("WCC"), "HMM");
check("Amer -> HMM", nilTierForConference("Amer"), "HMM");
check("P12 -> HMM", nilTierForConference("P12"), "HMM");
check("MVC -> MM", nilTierForConference("MVC"), "MM");
check("SWAC -> LM", nilTierForConference("SWAC"), "LM");
check("unknown -> LM", nilTierForConference("???"), "LM");
check("null -> LM", nilTierForConference(null), "LM");
check("trims", nilTierForConference(" B10 "), "HM");
check("budget B12", teamBudgetForConference("B12"), 20_000_000);
check("HM player ceiling", playerCeilingForConference("ACC"), 6_000_000);
check("LM player ceiling", playerCeilingForConference("NEC"), 1_350_000);

console.log("── display scale ──");
check("HM_PLAYER_CEILING", HM_PLAYER_CEILING, 6_000_000);
check("men current", valueCeilingFor({ sport: "men" }), HM_PLAYER_CEILING);
check("default", valueCeilingFor(), HM_PLAYER_CEILING);
check("women", valueCeilingFor({ sport: "women" }), LEGACY_PLAYER_CEILING);
check("womens", valueCeilingFor({ sport: "womens" }), LEGACY_PLAYER_CEILING);
check("men 2026 archive", valueCeilingFor({ sport: "men", season: 2026 }), LEGACY_PLAYER_CEILING);
check("men 2027 archive", valueCeilingFor({ sport: "men", season: 2027 }), HM_PLAYER_CEILING);
check("scale 2M to men", scaleLegacyDollars(2_000_000), 4_000_000);
check("scale 2M legacy", scaleLegacyDollars(2_000_000, LEGACY_PLAYER_CEILING), 2_000_000);

console.log("── valueForTeamBudget ──");
check("share x budget", valueForTeamBudget({ nilCapShare: 0.1 }, 20_000_000), 2_000_000);
check("same player, LM budget", valueForTeamBudget({ nilCapShare: 0.1 }, 4_500_000), 450_000);
check("capped at max share", valueForTeamBudget({ nilCapShare: 0.5 }, 10_000_000), 3_000_000);
check("custom max share", valueForTeamBudget({ nilCapShare: 0.25 }, 10_000_000, 0.2), 2_000_000);
check("no share -> null", valueForTeamBudget({}, 20_000_000), null);
check("null share -> null", valueForTeamBudget({ nilCapShare: null }, 20_000_000), null);
check("zero share -> null", valueForTeamBudget({ nilCapShare: 0 }, 20_000_000), null);
check("no budget -> null", valueForTeamBudget({ nilCapShare: 0.1 }, 0), null);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall nilBudget tests passed");
