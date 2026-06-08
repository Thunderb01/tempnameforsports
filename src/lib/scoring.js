// ── scoring.js ───────────────────────────────────────────────────────────────
// Sport-specific BTP scoring configs. The MEN'S app currently inlines its
// scoring math inside AppPage.jsx and useRosterBoard.js — those callsites are
// intentionally left untouched here. This file is the canonical home for new
// per-sport scoring constants going forward, and is what the women's fork
// pulls from. When/if you decide to refactor the men's side to read from
// here too, the constants are already laid out side-by-side for diffing.
//
// Scope: this is about the BTP roster-strength formula (the weighted sum of
// SEI / Athleticism / Risk / Defense / Offense / Market). It does NOT control
// the upstream NIL valuation pipeline (that's `torvik_metrics.py` for men /
// the equivalent women's ETL script for women — separate, server-side).

// Each config has the SAME shape so the women's variant can later be
// re-tuned independently without touching the men's path:
//
//   {
//     coefficients: { sei, ath, ris, dds, cdi, market },  // raw metric → $ score
//     weights:      { sei, ath, ris, dds, cdi, market },  // weight on each component
//     slotWeights:  { starter, bench, depth },            // lineup-slot weights
//     benchSize:    number,                               // how many "bench" slots get the bench weight
//   }

export const MEN_SCORING_CONFIG = {
  coefficients: {
    sei:    15000,
    ath:     5000,
    ris:     5000,
    dds:     5000,
    cdi:     5000,
    market:  1,        // market value is already in dollars
  },
  weights: {
    sei:    0.50,
    ath:    0.13,
    ris:    0.10,
    dds:    0.07,
    cdi:    0.05,
    market: 0.15,
  },
  slotWeights: { starter: 1.00, bench: 0.20, depth: 0.04 },
  benchSize: 3,
};

// Starting point for women's — same shape, identical numbers for now so the
// fork compiles. ADJUST THESE as you tune the women's model. Likely changes:
//   - higher weight on SEI relative to market (smaller NIL spreads)
//   - re-weight defensive vs offensive metrics based on what predicts
//     women's transfer-portal performance
//   - bump market coefficient down (market values run smaller)
export const WOMENS_SCORING_CONFIG = {
  coefficients: {
    sei:    15000,
    ath:     5000,
    ris:     5000,
    dds:     5000,
    cdi:     5000,
    market:  1,
  },
  weights: {
    sei:    0.50,
    ath:    0.13,
    ris:    0.10,
    dds:    0.07,
    cdi:    0.05,
    market: 0.15,
  },
  slotWeights: { starter: 1.00, bench: 0.20, depth: 0.04 },
  benchSize: 3,
};

// Compute the per-player BTP score using whichever config is passed in. The
// shape mirrors the inlined `btpPlayerScoreDisplay` in AppPage.jsx — keep the
// two in sync, OR migrate men's to read from here when you're ready.
export function btpPlayerScore(p, config) {
  const s = p?.stats || {};
  const C = config.coefficients;
  const W = config.weights;
  const sei    = (s.sei || 0) * C.sei;
  const ath    = (s.ath || 0) * C.ath;
  const ris    = (s.ris || 0) * C.ris;
  const dds    = (s.dds || 0) * C.dds;
  const cdi    = (s.cdi || 0) * C.cdi;
  const market = (p?.marketValue || p?.marketMid || 0) * C.market;
  return sei * W.sei + market * W.market + ath * W.ath + ris * W.ris + dds * W.dds + cdi * W.cdi;
}

// Slot weight by index given how many starter slots the lineup has.
export function slotWeightFor(slotIndex, startersN, config) {
  if (slotIndex < startersN)                    return config.slotWeights.starter;
  if (slotIndex < startersN + config.benchSize) return config.slotWeights.bench;
  return config.slotWeights.depth;
}
