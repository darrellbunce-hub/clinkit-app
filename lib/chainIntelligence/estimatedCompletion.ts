import { CHAIN_INTELLIGENCE_CONFIG } from "@/lib/chainIntelligence/config";
import type { DataCoverageStatus } from "@/lib/chainIntelligence/aggregate";
import {
  BUYER_READY_STAGE_ORDER,
  PARALLEL_ELIGIBLE_STAGES,
  SALE_STAGE_ORDER,
} from "@/lib/chainIntelligence/catalog";
import type {
  ChainDependencyInput,
  DependencyScoreResult,
} from "@/lib/chainIntelligence/dependencyScoring";
import type { StageTimingDefinition } from "@/lib/chainIntelligence/parseTimeframe";

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
  const maxWeeks = Math.max(
    minWeeks,
    Math.ceil((days + 7) / 7)
  );

  if (minWeeks === maxWeeks) {
    return `${minWeeks} week${minWeeks === 1 ? "" : "s"}`;
  }

  return `${minWeeks}–${maxWeeks} weeks`;
}

export function computeEstimatedCompletionWindow(params: {
  dependencies: ChainDependencyInput[];
  results: DependencyScoreResult[];
  saleTiming: Map<string, StageTimingDefinition>;
  buyerReadyTiming: Map<string, StageTimingDefinition>;
  confidenceUnavailable?: boolean;
}): string {
  if (params.confidenceUnavailable) {
    return "Unable to estimate";
  }

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
    (dep) =>
      dep.kind === "property" &&
      dep.clockQuality !== "unavailable"
  );

  const buyerReady = params.dependencies.find(
    (dep) => dep.kind === "buyer_ready"
  );

  let maxPropertyRemaining = 0;

  for (const property of propertyTracks) {
    const remaining = sumRemainingMaxDays(
      property.stage,
      params.saleTiming,
      SALE_STAGE_ORDER
    );

    if (remaining != null) {
      maxPropertyRemaining = Math.max(
        maxPropertyRemaining,
        remaining
      );
    }
  }

  let buyerReadyRemaining = 0;

  if (
    buyerReady &&
    buyerReady.clockQuality !== "unavailable"
  ) {
    buyerReadyRemaining =
      sumRemainingMaxDays(
        buyerReady.stage,
        params.buyerReadyTiming,
        BUYER_READY_STAGE_ORDER
      ) ?? 0;
  }

  const parallelOverlap =
    PARALLEL_ELIGIBLE_STAGES.has(buyerReady?.stage ?? "") ||
    propertyTracks.some((property) =>
      PARALLEL_ELIGIBLE_STAGES.has(property.stage)
    );

  const overlapRatio =
    CHAIN_INTELLIGENCE_CONFIG.eta.parallelOverlapCreditRatio;

  let criticalPathDays = Math.max(
    maxPropertyRemaining,
    buyerReadyRemaining
  );

  if (
    parallelOverlap &&
    maxPropertyRemaining > 0 &&
    buyerReadyRemaining > 0
  ) {
    const overlapReduction = Math.round(
      Math.min(maxPropertyRemaining, buyerReadyRemaining) *
        overlapRatio
    );
    criticalPathDays = Math.max(
      maxPropertyRemaining,
      buyerReadyRemaining,
      maxPropertyRemaining +
        buyerReadyRemaining -
        overlapReduction
    );
  }

  const bottleneck = params.results
    .filter((result) => result.scored)
    .sort(
      (left, right) =>
        left.dependencyScore - right.dependencyScore
    )[0];

  const etaCfg = CHAIN_INTELLIGENCE_CONFIG.eta;

  if (bottleneck?.zone === "severely_overdue") {
    criticalPathDays += etaCfg.severelyOverdueBottleneckSlackDays;
  } else if (bottleneck?.zone === "overdue") {
    criticalPathDays += etaCfg.overdueBottleneckSlackDays;
  }

  const hasExplicitDelay = params.results.some(
    (result) => result.operationalState === "explicit_delay"
  );

  const window = formatWeekWindow(criticalPathDays);

  if (window === "Unable to estimate") {
    return window;
  }

  if (hasExplicitDelay) {
    return `${window} (reported delays may extend this)`;
  }

  return window;
}

export function appendEtaLimitedCoverageQualifier(
  window: string,
  dataCoverage: DataCoverageStatus
): string {
  if (
    dataCoverage === "full" ||
    window === "Unable to estimate" ||
    window.startsWith("Unable to estimate")
  ) {
    return window;
  }

  if (
    window.includes(
      "Based on timing information currently available in Keynetic"
    )
  ) {
    return window;
  }

  return `${window}. Based on timing information currently available in Keynetic.`;
}

export function computePropertyEstimatedCompletionWindow(params: {
  propertyStage: string;
  propertyClockQuality: ChainDependencyInput["clockQuality"];
  buyerReady?: {
    stage: string;
    clockQuality: ChainDependencyInput["clockQuality"];
  } | null;
  saleTiming: Map<string, StageTimingDefinition>;
  buyerReadyTiming: Map<string, StageTimingDefinition>;
  propertyOperationalState?: ChainDependencyInput["operationalState"];
  buyerReadyOperationalState?: ChainDependencyInput["operationalState"];
}): string {
  const dependencies: ChainDependencyInput[] = [
    {
      id: "property",
      kind: "property",
      label: "Property",
      stage: params.propertyStage,
      status: "healthy",
      stageEnteredAt:
        params.propertyClockQuality === "unavailable"
          ? null
          : new Date().toISOString(),
      clockQuality: params.propertyClockQuality,
      operationalState:
        params.propertyOperationalState ?? "normal",
      isCritical: true,
    },
  ];

  if (params.buyerReady) {
    dependencies.push({
      id: "buyer-ready",
      kind: "buyer_ready",
      label: "Buyer Ready",
      stage: params.buyerReady.stage,
      status: "healthy",
      stageEnteredAt:
        params.buyerReady.clockQuality === "unavailable"
          ? null
          : new Date().toISOString(),
      clockQuality: params.buyerReady.clockQuality,
      operationalState:
        params.buyerReadyOperationalState ?? "normal",
      isCritical: true,
    });
  }

  const results = dependencies.map((dependency) => ({
    dependencyId: dependency.id,
    kind: dependency.kind,
    label: dependency.label,
    timingHealthScore: 100,
    operationalAdjustment: 0,
    dependencyScore: 100,
    zone: "within" as const,
    elapsedDays: 0,
    expectedMaxDays: null,
    clockQuality: dependency.clockQuality,
    operationalState: dependency.operationalState,
    scored: dependency.clockQuality !== "unavailable",
  }));

  return computeEstimatedCompletionWindow({
    dependencies,
    results,
    saleTiming: params.saleTiming,
    buyerReadyTiming: params.buyerReadyTiming,
  });
}
