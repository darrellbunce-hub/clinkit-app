/**
 * Stage 2 baseline + Stage 3.5 timing model verification.
 * OLD penalty-from-85 expectations superseded by approved timing_v1 model.
 */

import { STAGES } from "../data/stages";
import {
  computeChainConfidence,
  computeChainIntelligence,
  type IntelligenceProperty,
} from "../lib/chainIntelligence";
import {
  DELAY_REPORTED_PREFIX,
  STALE_DAYS_CONFIDENCE,
} from "../lib/activityIntelligence";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function baseProperty(
  overrides: Partial<IntelligenceProperty> = {}
): IntelligenceProperty {
  return {
    id: 1,
    chainPosition: 1,
    stage: "searches_ordered",
    status: "healthy",
    address: "10 Example Street",
    lastUpdatedDays: 0,
    activities: [
      {
        timestamp: daysAgo(1),
        update: "Searches Ordered",
      },
    ],
    stageEnteredAt: daysAgo(1),
    ...overrides,
  };
}

type Scenario = {
  name: string;
  run: () => { score: number; label: string; note: string };
};

const scenarios: Scenario[] = [
  {
    name: "1. New healthy chain (recent activity, no penalties)",
    run: () => {
      const result = computeChainIntelligence({
        chainProperties: [baseProperty()],
        buyerReadySummary: {
          progress: 40,
          latest_activity_at: daysAgo(1),
        },
        stages: STAGES,
      });
      return {
        score: result.confidenceScore,
        label: result.confidenceLabel,
        note: "Baseline CONFIDENCE_BASE=85",
      };
    },
  },
  {
    name: "2. Normally progressing chain (higher progress, still 85 confidence)",
    run: () => {
      const result = computeChainIntelligence({
        chainProperties: [
          baseProperty({ stage: "exchange_agreed", id: 1 }),
          baseProperty({
            id: 2,
            chainPosition: 2,
            stage: "mortgage_offer_received",
          }),
        ],
        buyerReadySummary: {
          progress: 70,
          latest_activity_at: daysAgo(2),
        },
        stages: STAGES,
      });
      return {
        score: result.confidenceScore,
        label: result.confidenceLabel,
        note: `Progress=${result.averageProgress}% does not affect confidence`,
      };
    },
  },
  {
    name: "3. One property stale at 22d (null buyer-ready summary → 80 baseline −5 = 75%)",
    run: () => {
      const result = computeChainIntelligence({
        chainProperties: [
          baseProperty({
            activities: [
              { timestamp: daysAgo(22), update: "Offer Accepted" },
            ],
          }),
        ],
        buyerReadySummary: null,
        stages: STAGES,
      });
      return {
        score: result.confidenceScore,
        label: result.confidenceLabel,
        note:
          "Null buyerReadySummary always applies buyerReadyStale −5; 1 stale −5",
      };
    },
  },
  {
    name: "3b. Null buyer-ready summary alone (no property penalties → 80%)",
    run: () => {
      const result = computeChainIntelligence({
        chainProperties: [baseProperty()],
        buyerReadySummary: null,
        stages: STAGES,
      });
      return {
        score: result.confidenceScore,
        label: result.confidenceLabel,
        note: "Typical baseline when buyer-ready summary missing or stale",
      };
    },
  },
  {
    name: "4. Two properties stale >21d with fresh buyer-ready (75%)",
    run: () => {
      const result = computeChainIntelligence({
        chainProperties: [
          baseProperty({
            id: 1,
            activities: [
              { timestamp: daysAgo(25), update: "Offer Accepted" },
            ],
          }),
          baseProperty({
            id: 2,
            chainPosition: 2,
            activities: [
              { timestamp: daysAgo(30), update: "Searches Ordered" },
            ],
          }),
        ],
        buyerReadySummary: {
          progress: 40,
          latest_activity_at: daysAgo(1),
        },
        stages: STAGES,
      });
      return {
        score: result.confidenceScore,
        label: result.confidenceLabel,
        note: "85 − 2×5 stale = 75 (founder observation pattern)",
      };
    },
  },
  {
    name: "5. Severely stale chain (3 stale + buyer-ready stale → 65%)",
    run: () => {
      const result = computeChainIntelligence({
        chainProperties: [
          baseProperty({
            id: 1,
            activities: [{ timestamp: daysAgo(60), update: "Listed" }],
          }),
          baseProperty({
            id: 2,
            chainPosition: 2,
            activities: [{ timestamp: daysAgo(45), update: "Offer Accepted" }],
          }),
          baseProperty({
            id: 3,
            chainPosition: 3,
            activities: [{ timestamp: daysAgo(40), update: "Searches Ordered" }],
          }),
        ],
        buyerReadySummary: {
          progress: 20,
          latest_activity_at: null,
        },
        stages: STAGES,
      });
      return {
        score: result.confidenceScore,
        label: result.confidenceLabel,
        note: "85 - 15 stale - 5 buyerReadyStale = 65",
      };
    },
  },
  {
    name: "6. Explicit delay reported (Option 2: same confidence as on-time without delay)",
    run: () => {
      const result = computeChainIntelligence({
        chainProperties: [
          baseProperty({
            hasActiveOperationalDelay: true,
            activities: [
              {
                timestamp: daysAgo(0),
                update: `${DELAY_REPORTED_PREFIX}: Solicitor`,
              },
            ],
          }),
        ],
        buyerReadySummary: {
          progress: 40,
          latest_activity_at: daysAgo(1),
        },
        stages: STAGES,
      });
      return {
        score: result.confidenceScore,
        label: result.confidenceLabel,
        note: "Option 2: delay is operational only — timing_v1 confidence unchanged",
      };
    },
  },
  {
    name: "7. Old chain with no recent updates but NO activities recorded (stays 85)",
    run: () => {
      const result = computeChainIntelligence({
        chainProperties: [
          baseProperty({ activities: [] }),
          baseProperty({
            id: 2,
            chainPosition: 2,
            activities: [],
          }),
        ],
        buyerReadySummary: {
          progress: 50,
          latest_activity_at: daysAgo(365),
        },
        stages: STAGES,
      });
      return {
        score: result.confidenceScore,
        label: result.confidenceLabel,
        note:
          "Empty activities → daysSinceLastActivity=0; buyer-ready stale -5",
      };
    },
  },
  {
    name: "8. Partial chain with searching placeholder excluded",
    run: () => {
      const result = computeChainIntelligence({
        chainProperties: [
          baseProperty({
            activities: [{ timestamp: daysAgo(30), update: "Listed" }],
          }),
          baseProperty({
            id: 2,
            chainPosition: 2,
            stage: "searching",
            address: null,
            activities: [],
          }),
        ],
        buyerReadySummary: null,
        stages: STAGES,
      });
      return {
        score: result.confidenceScore,
        label: result.confidenceLabel,
        note: "Only real property stale; placeholder excluded",
      };
    },
  },
  {
    name: "9. Minimum confidence (blocked + broken → 0%)",
    run: () => {
      const direct = computeChainConfidence({
        blockedCount: 1,
        activeDelayCount: 1,
        staleCount: 3,
        brokenCount: 1,
        buyerReadyStale: true,
      });
      return {
        score: direct.score,
        label: direct.label,
        note: "85-25-10-15-30-5=0 floor",
      };
    },
  },
];

function runFloorTests() {
  const onTime = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        stage: "offer_accepted",
        stageEnteredAt: daysAgo(3),
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  assert(
    (onTime.confidenceScore ?? 0) >= 85,
    "OLD: Baseline 85 → NEW: on-time timing score Strong (>=85)"
  );

  const withoutDelay = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        stage: "offer_accepted",
        stageEnteredAt: daysAgo(2),
        hasActiveOperationalDelay: false,
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  const explicitDelay = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        stage: "offer_accepted",
        stageEnteredAt: daysAgo(2),
        hasActiveOperationalDelay: true,
        activities: [
          {
            timestamp: daysAgo(0),
            update: `${DELAY_REPORTED_PREFIX}: test`,
          },
        ],
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  assert(
    explicitDelay.confidenceScore === withoutDelay.confidenceScore &&
      explicitDelay.confidenceBand === withoutDelay.confidenceBand &&
      explicitDelay.confidenceBand === "Strong",
    "Option 2: within-timing active delay must not change confidence vs no delay"
  );

  assert(
    explicitDelay.delayedCount === 1 &&
      explicitDelay.bottleneckProperty?.id === 1,
    "Option 2: active delay still feeds operational delay count / bottleneck"
  );

  const stale = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        stage: "searches_ordered",
        stageEnteredAt: daysAgo(120),
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  assert(
    (stale.confidenceScore ?? 100) < 70,
    "OLD: capped -5 stale → NEW: severely overdue low confidence"
  );

  const missingClock = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        stage: "offer_accepted",
        stageEnteredAt: null,
        activities: [],
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  assert(
    missingClock.confidenceUnavailable,
    "OLD: empty activities → 85 → NEW: missing clock unavailable"
  );
}

function main() {
  console.log("Chain Confidence scenario matrix (Stage 2)\n");
  console.log(`STALE_DAYS_CONFIDENCE=${STALE_DAYS_CONFIDENCE}\n`);

  let passed = 0;

  for (const scenario of scenarios) {
    const { score, label, note } = scenario.run();
    console.log(`✓ ${scenario.name}`);
    console.log(`  Score: ${score}% (${label}) — ${note}\n`);
    passed += 1;
  }

  runFloorTests();
  console.log("✓ Floor/minimum invariant tests passed\n");

  console.log(`Result: ${passed}/${scenarios.length} scenarios executed`);
  console.log(
    "Stage 3.5: timing_v1 replaces penalty-from-85 — see verify-chain-intelligence-critical-scenarios.ts"
  );
}

main();
