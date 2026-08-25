/**
 * Centralised Chain Intelligence calibration (timing_v1 / critical_path_v1).
 * Adjust values here without restructuring calculation architecture.
 */
export const CHAIN_INTELLIGENCE_CONFIG = {
  confidenceAlgorithmVersion: "timing_v1",
  etaAlgorithmVersion: "critical_path_v1",

  grace: {
    ratioOfExpectedMax: 0.5,
    minDays: 3,
    maxDays: 14,
  },

  degradation: {
    graceMaxPenalty: 15,
    overdueStartScore: 85,
    overdueMaxPenalty: 35,
    severeStartScore: 50,
    severeWeeklyPenalty: 8,
    floorScore: 5,
  },

  operationalModifiers: {
    /**
     * Product Option 2: active delay is an operational signal only.
     * Confidence uses timing_v1 elapsed-time zones; delay must not add a
     * direct score adjustment (avoids double-counting once overdue).
     */
    explicitDelayWithinGrace: 0,
    explicitDelayOverdue: 0,
    blocked: -35,
    blockedDependencyMaxScore: 45,
    brokenConnection: -20,
    pendingConnection: -6,
    lostCritical: -60,
  },

  aggregation: {
    baselineMinWeight: 0.6,
    baselineAvgWeight: 0.4,
    buyerReadyBottleneckMinWeight: 0.75,
    buyerReadyBottleneckAvgWeight: 0.25,
    buyerReadyBottleneckProximity: 5,
  },

  caps: {
    blockedCritical: 50,
    lostCritical: 35,
    /**
     * Unused for confidence (Option 2). Kept for reference / design docs;
     * aggregation no longer applies an explicit-delay score cap.
     */
    explicitDelayMaxScore: 100,
    buyerReadyOverdue: 65,
    buyerReadySeverelyOverdue: 45,
    approximateClockMaxScore: 85,
  },

  bands: {
    strongMin: 85,
    goodMin: 70,
    monitorMin: 50,
  },

  /** Customer-facing Chain Confidence must not imply certainty. */
  customerDisplayMaxScore: 95,

  eta: {
    parallelOverlapCreditRatio: 0.35,
    overdueBottleneckSlackDays: 7,
    severelyOverdueBottleneckSlackDays: 14,
  },

  recalculation: {
    dailyDueListLimit: 200,
  },
} as const;

export type ChainIntelligenceConfig = typeof CHAIN_INTELLIGENCE_CONFIG;
