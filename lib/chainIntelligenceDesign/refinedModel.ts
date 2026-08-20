/**
 * Stage 3.5 refined Chain Intelligence model (DESIGN ONLY).
 *
 * Implements founder-refined rules:
 * - Timing-based confidence with hybrid grace + progressive degradation
 * - Buyer Ready as critical chain dependency
 * - Critical-dependency caps (blocked, lost buyer)
 * - Explicit delay is operational only (Option 2 — no direct confidence penalty)
 * - Bottleneck-weighted aggregation with caps
 * - Critical-path Estimated Completion window
 *
 * NOT imported by application runtime.
 */
import {
  computeHybridGraceDays,
  computeTimingHealthScore,
  confidenceBand,
  elapsedWholeDays,
  parseExpectedTimeframe,
  roundDisplayScore,
  type DataCoverageStatus,
  type StageTimingDefinition,
  type TimingClockQuality,
} from "@/lib/chainIntelligenceDesign/proposedModel";

export const REFINED_CONFIDENCE_ALGORITHM_VERSION = "timing_v1_refined";
export const REFINED_ETA_ALGORITHM_VERSION = "critical_path_v1";

export type DependencyOperationalState =
  | "normal"
  | "explicit_delay"
  | "blocked"
  | "lost"
  | "broken_connection"
  | "pending_connection";

export type ChainDependencyKind = "property" | "buyer_ready";

export type ChainDependencyInput = {
  id: string;
  kind: ChainDependencyKind;
  label: string;
  stage: string;
  status: string;
  stageEnteredAt: string | null;
  clockQuality: TimingClockQuality;
  operationalState: DependencyOperationalState;
  isCritical: boolean;
};

export type DependencyScoreResult = {
  dependencyId: string;
  kind: ChainDependencyKind;
  label: string;
  timingHealthScore: number;
  operationalAdjustment: number;
  dependencyScore: number;
  zone: string;
  elapsedDays: number | null;
  expectedMaxDays: number | null;
  clockQuality: TimingClockQuality;
  operationalState: DependencyOperationalState;
  scored: boolean;
};

export type BlockedCapOption = 40 | 50 | 60;

export type RefinedChainConfidenceResult = {
  algorithmVersion: typeof REFINED_CONFIDENCE_ALGORITHM_VERSION;
  score: number | null;
  band: string;
  bandHomeowner: string;
  bandEstateAgent: string;
  dataCoverage: DataCoverageStatus;
  coverageLabel: string;
  dependencyResults: DependencyScoreResult[];
  aggregationNote: string;
  capsApplied: string[];
  estimatedCompletionWindow: string | null;
  etaAlgorithmVersion: typeof REFINED_ETA_ALGORITHM_VERSION;
};

/** Founder-approved hybrid grace. */
export function computeGraceDays(expectedMaxDays: number): number {
  return computeHybridGraceDays(expectedMaxDays);
}

function getStageDefinition(
  stage: string,
  saleTiming: Map<string, StageTimingDefinition>,
  buyerReadyTiming: Map<string, StageTimingDefinition>
): StageTimingDefinition | undefined {
  return saleTiming.get(stage) ?? buyerReadyTiming.get(stage);
}

function computeOperationalAdjustment(
  state: DependencyOperationalState,
  timingZone: string,
  hasTimingScore: boolean
): number {
  switch (state) {
    case "explicit_delay":
      // Option 2: operational signal only — no direct confidence adjustment.
      void timingZone;
      void hasTimingScore;
      return 0;
    case "blocked":
      return -35;
    case "lost":
      return -60;
    case "broken_connection":
      return -20;
    case "pending_connection":
      return -6;
    default:
      return 0;
  }
}

export function computeDependencyScore(params: {
  dependency: ChainDependencyInput;
  saleTiming: Map<string, StageTimingDefinition>;
  buyerReadyTiming: Map<string, StageTimingDefinition>;
  referenceDate?: Date;
}): DependencyScoreResult {
  const { dependency } = params;
  const referenceDate = params.referenceDate ?? new Date();
  const stageDef = getStageDefinition(
    dependency.stage,
    params.saleTiming,
    params.buyerReadyTiming
  );
  const expectedMaxDays =
    stageDef?.expectedTimeframe.maxDays ?? null;

  if (
    dependency.operationalState === "lost" ||
    !stageDef ||
    stageDef.expectedTimeframe.unit === "variable" ||
    expectedMaxDays == null ||
    dependency.clockQuality === "unavailable" ||
    !dependency.stageEnteredAt
  ) {
    const adjustment = computeOperationalAdjustment(
      dependency.operationalState,
      "not_applicable",
      false
    );

    return {
      dependencyId: dependency.id,
      kind: dependency.kind,
      label: dependency.label,
      timingHealthScore: 0,
      operationalAdjustment: adjustment,
      dependencyScore: Math.max(0, adjustment),
      zone: "not_applicable",
      elapsedDays: null,
      expectedMaxDays,
      clockQuality: dependency.clockQuality,
      operationalState: dependency.operationalState,
      scored: false,
    };
  }

  const elapsedDays = elapsedWholeDays(
    dependency.stageEnteredAt,
    referenceDate
  );

  const { score: timingHealthScore, zone } = computeTimingHealthScore({
    elapsedDays,
    expectedMaxDays,
    graceDays: computeGraceDays(expectedMaxDays),
  });

  const operationalAdjustment = computeOperationalAdjustment(
    dependency.operationalState,
    zone,
    true
  );

  let dependencyScore = Math.max(
    0,
    Math.min(100, timingHealthScore + operationalAdjustment)
  );

  if (dependency.clockQuality === "approximate") {
    dependencyScore = Math.min(dependencyScore, 85);
  }

  if (dependency.operationalState === "blocked") {
    dependencyScore = Math.min(dependencyScore, 45);
  }

  return {
    dependencyId: dependency.id,
    kind: dependency.kind,
    label: dependency.label,
    timingHealthScore,
    operationalAdjustment,
    dependencyScore,
    zone,
    elapsedDays,
    expectedMaxDays,
    clockQuality: dependency.clockQuality,
    operationalState: dependency.operationalState,
    scored: true,
  };
}

export function aggregateDependencyScores(params: {
  results: DependencyScoreResult[];
  blockedCap?: BlockedCapOption;
}): {
  score: number | null;
  note: string;
  capsApplied: string[];
} {
  const capsApplied: string[] = [];
  const scored = params.results.filter((result) => result.scored);

  if (scored.length === 0) {
    return {
      score: null,
      note: "No dependencies with reliable timing clocks",
      capsApplied: ["confidence_unavailable"],
    };
  }

  const scores = scored.map((result) => result.dependencyScore);
  const minScore = Math.min(...scores);
  const avgScore =
    scores.reduce((total, value) => total + value, 0) / scores.length;

  const minResult = scored.find(
    (result) => result.dependencyScore === minScore
  );

  const buyerReadyOverdue = params.results.find(
    (result) =>
      result.kind === "buyer_ready" &&
      result.scored &&
      (result.zone === "overdue" || result.zone === "severely_overdue")
  );

  const useBuyerReadyBottleneck =
    buyerReadyOverdue != null &&
    (minResult?.kind === "buyer_ready" ||
      buyerReadyOverdue.dependencyScore <= minScore + 5);

  const bottleneckWeight = useBuyerReadyBottleneck ? 0.75 : 0.6;
  const averageWeight = useBuyerReadyBottleneck ? 0.25 : 0.4;

  let chainScore = Math.round(
    minScore * bottleneckWeight + avgScore * averageWeight
  );
  let note = useBuyerReadyBottleneck
    ? `Buyer Ready bottleneck ${Math.round(bottleneckWeight * 100)}/${Math.round(averageWeight * 100)}: min ${minScore}, avg ${Math.round(avgScore)}`
    : `Baseline 60/40: min ${minScore}, avg ${Math.round(avgScore)}`;

  const blockedCap = params.blockedCap ?? 50;

  const hasBlockedCritical = params.results.some(
    (result) =>
      result.operationalState === "blocked" && result.scored
  );

  const hasLostCritical = params.results.some(
    (result) => result.operationalState === "lost"
  );

  if (hasLostCritical) {
    chainScore = Math.min(chainScore, 35);
    capsApplied.push("lost_critical_dependency_cap_35");
  }

  if (hasBlockedCritical) {
    chainScore = Math.min(chainScore, blockedCap);
    capsApplied.push(`blocked_critical_dependency_cap_${blockedCap}`);
  }

  // Option 2: no explicit_delay confidence cap.

  if (buyerReadyOverdue?.zone === "severely_overdue") {
    chainScore = Math.min(chainScore, 45);
    capsApplied.push("buyer_ready_severely_overdue_cap_45");
  } else if (buyerReadyOverdue?.zone === "overdue") {
    chainScore = Math.min(chainScore, 65);
    capsApplied.push("buyer_ready_overdue_cap_65");
  }

  return { score: chainScore, note, capsApplied };
}

export function mapBandLabels(band: string): {
  homeowner: string;
  estateAgent: string;
} {
  switch (band) {
    case "Strong":
      return { homeowner: "Strong", estateAgent: "Strong" };
    case "Good":
      return { homeowner: "Good", estateAgent: "Good" };
    case "Monitor":
      return {
        homeowner: "Keep an eye on",
        estateAgent: "Monitor",
      };
    case "Needs attention":
      return {
        homeowner: "Needs attention",
        estateAgent: "Needs attention",
      };
    default:
      return {
        homeowner: "Unavailable",
        estateAgent: "Unavailable",
      };
  }
}

export function classifyDependencyCoverage(
  dependencies: ChainDependencyInput[],
  results: DependencyScoreResult[]
): { status: DataCoverageStatus; label: string } {
  const saleCount = dependencies.filter(
    (dep) => dep.kind === "property"
  ).length;

  const buyerReadyCount = dependencies.filter(
    (dep) => dep.kind === "buyer_ready"
  ).length;

  const scoredCount = results.filter((result) => result.scored).length;

  if (scoredCount === 0) {
    return {
      status: "insufficient",
      label:
        "Chain Confidence unavailable — timing data is not yet reliable enough",
    };
  }

  const parts: string[] = [];

  if (saleCount > 0) {
    parts.push(
      `${results.filter((r) => r.kind === "property" && r.scored).length} of ${saleCount} connected propert${saleCount === 1 ? "y" : "ies"}`
    );
  }

  if (buyerReadyCount > 0) {
    parts.push(
      `${results.filter((r) => r.kind === "buyer_ready" && r.scored).length} of ${buyerReadyCount} Buyer Ready ${buyerReadyCount === 1 ? "step" : "steps"}`
    );
  }

  const status: DataCoverageStatus =
    scoredCount < dependencies.length ? "limited" : "full";

  return {
    status,
    label: `Based on ${parts.join(" and ")} visible on Keynetic`,
  };
}

/** Stages that commonly overlap between purchase conveyancing tracks (design assumption). */
const PARALLEL_STAGE_VALUES = new Set([
  "searches_ordered",
  "survey_booked",
  "survey_completed",
  "searches_returned",
  "enquiries_raised",
  "enquiries_fully_answered",
  "enquiries_reviewed",
  "mortgage_offer_received",
  "mortgage_offer",
  "solicitor_instructed",
]);

function sumRemainingMaxDays(
  currentStage: string,
  timingMap: Map<string, StageTimingDefinition>,
  stageOrder: string[]
): number | null {
  const currentIndex = stageOrder.indexOf(currentStage);

  if (currentIndex < 0) {
    return null;
  }

  let total = 0;

  for (let index = currentIndex; index < stageOrder.length; index += 1) {
    const stage = timingMap.get(stageOrder[index]);

    if (!stage?.expectedTimeframe.maxDays) {
      continue;
    }

    total += stage.expectedTimeframe.maxDays;
  }

  return total;
}

function formatWeekWindow(days: number): string {
  if (days <= 0) {
    return "Unable to estimate";
  }

  const minWeeks = Math.max(1, Math.floor(days / 7));
  const maxWeeks = Math.max(minWeeks, Math.ceil((days + 7) / 7));

  if (minWeeks === maxWeeks) {
    return `${minWeeks} week${minWeeks === 1 ? "" : "s"}`;
  }

  return `${minWeeks}–${maxWeeks} weeks`;
}

/**
 * Hybrid critical-path ETA (Model D):
 * - Compute remaining days for each property track and buyer-ready track
 * - Apply overlap factor for parallel conveyancing blocks
 * - Use max(track paths) as critical path baseline
 */
export function computeEstimatedCompletionWindow(params: {
  dependencies: ChainDependencyInput[];
  results: DependencyScoreResult[];
  saleTiming: Map<string, StageTimingDefinition>;
  buyerReadyTiming: Map<string, StageTimingDefinition>;
  saleStageOrder: string[];
  buyerReadyStageOrder: string[];
}): string {
  const hasLost = params.results.some(
    (result) => result.operationalState === "lost"
  );

  const hasBlocked = params.results.some(
    (result) => result.operationalState === "blocked"
  );

  if (hasLost) {
    return "Unable to estimate — critical buyer dependency lost";
  }

  if (hasBlocked) {
    return "Unable to estimate — blocked dependency";
  }

  const propertyTracks = params.dependencies.filter(
    (dep) => dep.kind === "property" && dep.clockQuality !== "unavailable"
  );

  const buyerReady = params.dependencies.find(
    (dep) => dep.kind === "buyer_ready"
  );

  let maxPropertyRemaining = 0;

  for (const property of propertyTracks) {
    const remaining = sumRemainingMaxDays(
      property.stage,
      params.saleTiming,
      params.saleStageOrder
    );

    if (remaining != null) {
      maxPropertyRemaining = Math.max(maxPropertyRemaining, remaining);
    }
  }

  let buyerReadyRemaining = 0;

  if (buyerReady && buyerReady.clockQuality !== "unavailable") {
    buyerReadyRemaining =
      sumRemainingMaxDays(
        buyerReady.stage,
        params.buyerReadyTiming,
        params.buyerReadyStageOrder
      ) ?? 0;
  }

  const parallelOverlap =
    PARALLEL_STAGE_VALUES.has(buyerReady?.stage ?? "") ||
    propertyTracks.some((property) =>
      PARALLEL_STAGE_VALUES.has(property.stage)
    );

  let criticalPathDays = Math.max(
    maxPropertyRemaining,
    buyerReadyRemaining
  );

  if (parallelOverlap && maxPropertyRemaining > 0 && buyerReadyRemaining > 0) {
    const overlapReduction = Math.round(
      Math.min(maxPropertyRemaining, buyerReadyRemaining) * 0.35
    );
    criticalPathDays = Math.max(
      maxPropertyRemaining,
      buyerReadyRemaining,
      maxPropertyRemaining + buyerReadyRemaining - overlapReduction
    );
  }

  const bottleneck = params.results
    .filter((result) => result.scored)
    .sort((left, right) => left.dependencyScore - right.dependencyScore)[0];

  if (bottleneck && bottleneck.zone === "severely_overdue") {
    criticalPathDays += 14;
  } else if (bottleneck && bottleneck.zone === "overdue") {
    criticalPathDays += 7;
  }

  const hasExplicitDelay = params.results.some(
    (result) => result.operationalState === "explicit_delay"
  );

  const window = formatWeekWindow(criticalPathDays);

  if (hasExplicitDelay) {
    return `${window} (reported delays may extend this)`;
  }

  return window;
}

export function computeRefinedChainIntelligence(params: {
  dependencies: ChainDependencyInput[];
  saleTiming: Map<string, StageTimingDefinition>;
  buyerReadyTiming: Map<string, StageTimingDefinition>;
  saleStageOrder: string[];
  buyerReadyStageOrder: string[];
  referenceDate?: Date;
  blockedCap?: BlockedCapOption;
}): RefinedChainConfidenceResult {
  const referenceDate = params.referenceDate ?? new Date();

  const dependencyResults = params.dependencies.map((dependency) =>
    computeDependencyScore({
      dependency,
      saleTiming: params.saleTiming,
      buyerReadyTiming: params.buyerReadyTiming,
      referenceDate,
    })
  );

  const { score, note, capsApplied } = aggregateDependencyScores({
    results: dependencyResults,
    blockedCap: params.blockedCap,
  });

  const coverage = classifyDependencyCoverage(
    params.dependencies,
    dependencyResults
  );

  const displayScore = roundDisplayScore(score);
  const band = confidenceBand(displayScore);
  const labels = mapBandLabels(band);

  const estimatedCompletionWindow =
    score == null
      ? "Unable to estimate"
      : computeEstimatedCompletionWindow({
          dependencies: params.dependencies,
          results: dependencyResults,
          saleTiming: params.saleTiming,
          buyerReadyTiming: params.buyerReadyTiming,
          saleStageOrder: params.saleStageOrder,
          buyerReadyStageOrder: params.buyerReadyStageOrder,
        });

  return {
    algorithmVersion: REFINED_CONFIDENCE_ALGORITHM_VERSION,
    score: displayScore,
    band,
    bandHomeowner: labels.homeowner,
    bandEstateAgent: labels.estateAgent,
    dataCoverage: coverage.status,
    coverageLabel: coverage.label,
    dependencyResults,
    aggregationNote: note,
    capsApplied,
    estimatedCompletionWindow,
    etaAlgorithmVersion: REFINED_ETA_ALGORITHM_VERSION,
  };
}

/** Compare blocked cap options for founder review. */
export function simulateBlockedCapComparison(
  dependencies: ChainDependencyInput[],
  caps: BlockedCapOption[],
  context: Omit<
    Parameters<typeof computeRefinedChainIntelligence>[0],
    "dependencies" | "blockedCap"
  >
): Array<{
  cap: BlockedCapOption;
  score: number | null;
  band: string;
}> {
  return caps.map((cap) => {
    const result = computeRefinedChainIntelligence({
      ...context,
      dependencies,
      blockedCap: cap,
    });

    return {
      cap,
      score: result.score,
      band: result.band,
    };
  });
}

export const CONVEYANCING_OVERLAP_FINDINGS = {
  sequentialEarlyStages: [
    "offer_accepted",
    "solicitors_instructed",
    "mortgage_in_principle",
    "mortgage_application",
  ],
  parallelMidStages: [
    "searches_ordered",
    "survey_booked",
    "survey_completed",
    "enquiries_raised",
    "mortgage_offer_received",
  ],
  recommendation:
    "Use hybrid critical-path ETA (max + partial overlap credit), not naive sum of all remaining durations.",
} as const;

export const STAGE_ENTERED_AT_PROPOSAL = {
  columns: [
    "properties.stage_entered_at timestamptz",
    "chain_nodes.stage_entered_at timestamptz",
  ],
  setOn: [
    "property stage mutation",
    "buyer ready stage mutation",
    "replacement buyer stage reset",
  ],
  backfill:
    "Match newest activity text to stage label; if ambiguous leave null; never use updated_at alone",
  doNotGuess: true,
} as const;

export const RECALCULATION_ARCHITECTURE_PROPOSAL = {
  onWrite: [
    "stage change (property)",
    "buyer ready stage change",
    "delay add/remove",
    "blocked/unblocked",
    "connection state change",
    "buyer withdrawal / replacement",
  ],
  scheduled: "daily batch for time-only deterioration",
  preferred: "Hybrid D — mutation refresh + daily due-list of chains past next zone boundary",
  dashboardReads: "chain_operational_summary cached fields only",
  nextRecalculationAt:
    "Optional efficiency field — set to earliest dependency zone boundary",
} as const;
