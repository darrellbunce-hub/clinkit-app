/**
 * Stage 3.5 founder refinements — production regression checks.
 * Run: npx tsx scripts/verify-chain-intelligence-stage35-refinements.ts
 */
import {
  formatCoverageLabel,
  applyChainLevelPendingConnectionModifier,
} from "../lib/chainIntelligence/aggregate";
import { resolveBuyerReadyStageLabel } from "../lib/chainIntelligence/buyerReadyLabels";
import {
  appendEtaLimitedCoverageQualifier,
} from "../lib/chainIntelligence/estimatedCompletion";
import {
  parseEstimatedCompletionPresentation,
} from "../lib/chainIntelligence/presentation";
import {
  capCustomerDisplayScore,
  roundDisplayScore,
  toCustomerFacingConfidenceScore,
} from "../lib/chainIntelligence/presentation";
import { computeTimingChainIntelligence } from "../lib/chainIntelligence/timingEngine";

function check(name: string, pass: boolean, detail?: string) {
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
  if (!pass) {
    throw new Error(name);
  }
}

const ref = new Date("2026-06-19T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(ref.getTime() - days * 86400000).toISOString();
}

// Example C pattern
{
  const result = computeTimingChainIntelligence({
    referenceDate: ref,
    properties: [
      {
        id: 1,
        chainPosition: 1,
        stage: "searches_ordered",
        status: "healthy",
        address: "10 High St",
        lastUpdatedDays: 8,
        activities: [
          { timestamp: daysAgo(8), update: "Searches Ordered" },
        ],
        stageEnteredAt: daysAgo(8),
      },
      {
        id: 2,
        chainPosition: 2,
        stage: "offer_accepted",
        status: "pending_connection",
        address: "Purchase",
        lastUpdatedDays: 11,
        activities: [],
        stageEnteredAt: null,
      },
    ],
    buyerReadyNode: {
      id: 99,
      stage: "mortgage_in_principle",
      status: "healthy",
      stageEnteredAt: null,
      activities: [],
    },
  });

  check(
    "Example C internal score applies unscored pending modifier",
    result.score === 94,
    `score=${result.score}`
  );
  check(
    "Example C displayed confidence capped at 95 Strong",
    result.displayScore === 95 && result.band === "Strong",
    `display=${result.displayScore} band=${result.band}`
  );
  check(
    "Example C coverage wording",
    result.coverageLabel ===
      "Confidence based on timing data available for 1 of 3 visible chain steps.",
    result.coverageLabel
  );
  check(
    "Example C ETA limited-coverage qualifier",
    result.estimatedCompletionWindow ===
      "28–29 weeks. Based on timing information currently available in Keynetic.",
    result.estimatedCompletionWindow
  );
}

// Full coverage on-time → display 95
{
  const result = computeTimingChainIntelligence({
    referenceDate: ref,
    properties: [
      {
        id: 1,
        chainPosition: 1,
        stage: "searches_ordered",
        status: "healthy",
        address: "10 High St",
        lastUpdatedDays: 2,
        activities: [
          { timestamp: daysAgo(2), update: "Searches Ordered" },
        ],
        stageEnteredAt: daysAgo(2),
      },
    ],
    buyerReadyNode: {
      id: 99,
      stage: "mortgage_in_principle",
      status: "healthy",
      stageEnteredAt: daysAgo(2),
      activities: [
        { timestamp: daysAgo(2), update: "Mortgage In Principle" },
      ],
    },
  });

  check(
    "Full coverage on-time internal may be 100",
    result.score === 100,
    `score=${result.score}`
  );
  check(
    "Full coverage on-time display capped at 95",
    result.displayScore === 95,
    `display=${result.displayScore}`
  );
  check(
    "Full coverage label",
    result.coverageLabel ===
      "Confidence based on timing data available for 2 of 2 visible chain steps.",
    result.coverageLabel
  );
  check(
    "Full coverage ETA has no limited qualifier",
    !result.estimatedCompletionWindow.includes(
      "Based on timing information currently available"
    ),
    result.estimatedCompletionWindow
  );
}

// Scored pending — no double penalty
{
  const result = computeTimingChainIntelligence({
    referenceDate: ref,
    properties: [
      {
        id: 1,
        chainPosition: 1,
        stage: "offer_accepted",
        status: "pending_connection",
        address: "Purchase",
        lastUpdatedDays: 2,
        activities: [
          { timestamp: daysAgo(2), update: "Offer Accepted" },
        ],
        stageEnteredAt: daysAgo(2),
      },
    ],
  });

  check(
    "Scored pending applies modifier once at dependency level",
    result.score === 94,
    `score=${result.score}`
  );
  check(
    "Scored pending not double-penalised at chain level",
    !result.capsApplied.includes(
      "unscored_pending_connection_chain_modifier"
    ),
    result.capsApplied.join(",")
  );
}

// Multiple unscored pending — once per chain
{
  const adjusted = applyChainLevelPendingConnectionModifier({
    chainScore: 100,
    dependencies: [
      {
        id: "p1",
        kind: "property",
        label: "P1",
        stage: "offer_accepted",
        status: "pending_connection",
        stageEnteredAt: null,
        clockQuality: "unavailable",
        operationalState: "pending_connection",
        isCritical: true,
      },
      {
        id: "p2",
        kind: "property",
        label: "P2",
        stage: "offer_accepted",
        status: "pending_connection",
        stageEnteredAt: null,
        clockQuality: "unavailable",
        operationalState: "pending_connection",
        isCritical: true,
      },
    ],
    results: [
      {
        dependencyId: "p1",
        kind: "property",
        label: "P1",
        timingHealthScore: 0,
        operationalAdjustment: -6,
        dependencyScore: 0,
        zone: "not_applicable",
        elapsedDays: null,
        expectedMaxDays: 7,
        clockQuality: "unavailable",
        operationalState: "pending_connection",
        scored: false,
      },
      {
        dependencyId: "p2",
        kind: "property",
        label: "P2",
        timingHealthScore: 0,
        operationalAdjustment: -6,
        dependencyScore: 0,
        zone: "not_applicable",
        elapsedDays: null,
        expectedMaxDays: 7,
        clockQuality: "unavailable",
        operationalState: "pending_connection",
        scored: false,
      },
    ],
    capsApplied: [],
  });

  check(
    "Multiple unscored pending applies modifier once",
    adjusted.chainScore === 94,
    `score=${adjusted.chainScore}`
  );
}

// Buyer Ready unavailable excluded; with clock participates
{
  const unavailable = computeTimingChainIntelligence({
    referenceDate: ref,
    properties: [
      {
        id: 1,
        chainPosition: 1,
        stage: "searches_ordered",
        status: "healthy",
        address: "10 High St",
        lastUpdatedDays: 2,
        activities: [
          { timestamp: daysAgo(2), update: "Searches Ordered" },
        ],
        stageEnteredAt: daysAgo(2),
      },
    ],
    buyerReadyNode: {
      id: 99,
      stage: "mortgage_in_principle",
      status: "healthy",
      stageEnteredAt: null,
      activities: [],
    },
  });

  check(
    "Unavailable Buyer Ready excluded from scored count",
    unavailable.coverageLabel ===
      "Confidence based on timing data available for 1 of 2 visible chain steps.",
    unavailable.coverageLabel
  );

  const available = computeTimingChainIntelligence({
    referenceDate: ref,
    properties: [
      {
        id: 1,
        chainPosition: 1,
        stage: "searches_ordered",
        status: "healthy",
        address: "10 High St",
        lastUpdatedDays: 2,
        activities: [
          { timestamp: daysAgo(2), update: "Searches Ordered" },
        ],
        stageEnteredAt: daysAgo(2),
      },
    ],
    buyerReadyNode: {
      id: 99,
      stage: "mortgage_in_principle",
      status: "healthy",
      stageEnteredAt: daysAgo(2),
      activities: [
        { timestamp: daysAgo(2), update: "Mortgage In Principle" },
      ],
    },
  });

  check(
    "Buyer Ready with valid clock participates",
    available.dependencyResults.some(
      (entry) => entry.kind === "buyer_ready" && entry.scored
    ),
    "buyer_ready not scored"
  );
}

// Coverage grammar
check(
  "Coverage grammar singular",
  formatCoverageLabel({ visibleCount: 1, scoredCount: 1 }) ===
    "Confidence based on timing data available for 1 of 1 visible chain step.",
  formatCoverageLabel({ visibleCount: 1, scoredCount: 1 })
);
check(
  "Coverage grammar plural",
  formatCoverageLabel({ visibleCount: 3, scoredCount: 1 }) ===
    "Confidence based on timing data available for 1 of 3 visible chain steps.",
  formatCoverageLabel({ visibleCount: 3, scoredCount: 1 })
);
check(
  "Coverage grammar zero scored of multiple",
  formatCoverageLabel({ visibleCount: 2, scoredCount: 0 }) ===
    "Confidence based on timing data available for 0 of 2 visible chain steps.",
  formatCoverageLabel({ visibleCount: 2, scoredCount: 0 })
);

// Display score helpers
check(
  "Internal 100 → customer display 95",
  toCustomerFacingConfidenceScore(100) === 95,
  String(toCustomerFacingConfidenceScore(100))
);
check(
  "capCustomerDisplayScore respects max",
  capCustomerDisplayScore(roundDisplayScore(100)) === 95,
  String(capCustomerDisplayScore(roundDisplayScore(100)))
);

// Buyer Ready label
check(
  "Buyer Ready stage label from catalogue",
  resolveBuyerReadyStageLabel({
    stage: "mortgage_in_principle",
  }) === "Mortgage In Principle",
  resolveBuyerReadyStageLabel({ stage: "mortgage_in_principle" })
);
check(
  "Buyer Ready prefers public stage label",
  resolveBuyerReadyStageLabel({
    stage: "mortgage_in_principle",
    publicStageLabel: "Mortgage preparation",
  }) === "Mortgage preparation",
  resolveBuyerReadyStageLabel({
    stage: "mortgage_in_principle",
    publicStageLabel: "Mortgage preparation",
  })
);

// ETA qualifier
check(
  "ETA limited qualifier appended",
  appendEtaLimitedCoverageQualifier("28–29 weeks", "limited") ===
    "28–29 weeks. Based on timing information currently available in Keynetic.",
  appendEtaLimitedCoverageQualifier("28–29 weeks", "limited")
);
check(
  "ETA full coverage unchanged",
  appendEtaLimitedCoverageQualifier("28–29 weeks", "full") ===
    "28–29 weeks",
  appendEtaLimitedCoverageQualifier("28–29 weeks", "full")
);

const limitedEtaPresentation = parseEstimatedCompletionPresentation(
  appendEtaLimitedCoverageQualifier("28–29 weeks", "limited")
);
check(
  "ETA presentation primary value only",
  limitedEtaPresentation.primaryValue === "28–29 weeks",
  limitedEtaPresentation.primaryValue
);
check(
  "ETA presentation limited qualifier separate",
  limitedEtaPresentation.limitedCoverageQualifier ===
    "Based on timing information currently available in Keynetic.",
  limitedEtaPresentation.limitedCoverageQualifier
);
check(
  "ETA presentation disclaimer avoids duplicate limited wording",
  !limitedEtaPresentation.disclaimer.includes(
    "timing information currently available"
  ),
  limitedEtaPresentation.disclaimer
);

console.log("\nAll Stage 3.5 refinement checks passed.");
