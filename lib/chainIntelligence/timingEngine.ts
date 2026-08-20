import {
  hasActiveDelayReport,
  type OperationalActivity,
} from "@/lib/activityIntelligence";
import { isSearchingPlaceholder } from "@/lib/buildChainTopology";
import type { ChainNodesChainSummary } from "@/lib/chainNodesSummary";
import {
  BUYER_READY_STAGE_TIMING,
  SALE_STAGE_TIMING,
} from "@/lib/chainIntelligence/catalog";
import {
  aggregateDependencyScores,
  applyChainLevelPendingConnectionModifier,
  classifyDependencyCoverage,
} from "@/lib/chainIntelligence/aggregate";
import { CHAIN_INTELLIGENCE_CONFIG } from "@/lib/chainIntelligence/config";
import {
  scoreAllDependencies,
  type ChainDependencyInput,
  type DependencyOperationalState,
} from "@/lib/chainIntelligence/dependencyScoring";
import { computeEstimatedCompletionWindow, appendEtaLimitedCoverageQualifier } from "@/lib/chainIntelligence/estimatedCompletion";
import {
  capCustomerDisplayScore,
  confidenceBand,
  confidencePresentation,
  mapBandLabels,
  roundDisplayScore,
} from "@/lib/chainIntelligence/presentation";
import {
  computeNextRecalculationAt,
} from "@/lib/chainIntelligence/timingHealth";
import {
  resolveBuyerReadyStageClock,
  resolvePropertyStageClock,
} from "@/lib/chainIntelligence/stageClock";
import type { IntelligenceProperty } from "@/lib/chainIntelligence/types";

export type TimingChainIntelligenceResult = {
  score: number | null;
  displayScore: number | null;
  band: ReturnType<typeof confidenceBand>;
  bandHomeowner: string;
  bandEstateAgent: string;
  confidenceLabel: string;
  confidenceColour: string;
  confidenceBg: string;
  confidenceUnavailable: boolean;
  dataCoverage: ReturnType<
    typeof classifyDependencyCoverage
  >["status"];
  coverageLabel: string;
  estimatedCompletionWindow: string;
  capsApplied: string[];
  aggregationNote: string;
  dependencyResults: ReturnType<typeof scoreAllDependencies>;
  confidenceAlgorithmVersion: string;
  etaAlgorithmVersion: string;
  nextRecalculationAt: string | null;
};

function mapPropertyOperationalState(
  property: IntelligenceProperty
): DependencyOperationalState {
  if (property.status === "blocked") {
    return "blocked";
  }

  if (property.status === "broken_connection") {
    return "broken_connection";
  }

  if (property.status === "pending_connection") {
    return "pending_connection";
  }

  if (
    hasActiveDelayReport(property.activities, {
      authoritativeActiveDelay:
        property.hasActiveOperationalDelay,
    })
  ) {
    return "explicit_delay";
  }

  return "normal";
}

function mapBuyerReadyOperationalState(params: {
  status: string;
  activities: OperationalActivity[];
  authoritativeLost?: boolean;
  hasActiveOperationalDelay?: boolean | null;
}): DependencyOperationalState {
  if (params.authoritativeLost) {
    return "lost";
  }

  if (params.status === "blocked") {
    return "blocked";
  }

  if (params.status === "broken_connection") {
    return "broken_connection";
  }

  if (
    hasActiveDelayReport(params.activities, {
      authoritativeActiveDelay:
        params.hasActiveOperationalDelay,
    })
  ) {
    return "explicit_delay";
  }

  return "normal";
}

export function buildChainDependencies(params: {
  properties: IntelligenceProperty[];
  buyerReadyNode?: {
    id: number;
    stage: string | null;
    status: string;
    stageEnteredAt?: string | null;
    activities: OperationalActivity[];
    authoritativeLost?: boolean;
    hasActiveOperationalDelay?: boolean | null;
  } | null;
}): ChainDependencyInput[] {
  const dependencies: ChainDependencyInput[] = [];

  for (const property of params.properties) {
    if (!isSearchingPlaceholder(property)) {
      const clock = resolvePropertyStageClock({
        stage: property.stage,
        persistedStageEnteredAt:
          property.stageEnteredAt ?? null,
        activities: property.activities,
      });

      dependencies.push({
        id: `property-${property.id}`,
        kind: "property",
        label: `Property ${property.chainPosition}`,
        stage: property.stage,
        status: property.status,
        stageEnteredAt: clock.stageEnteredAt,
        clockQuality: clock.clockQuality,
        operationalState:
          mapPropertyOperationalState(property),
        isCritical: true,
      });
    }
  }

  if (params.buyerReadyNode?.stage) {
    const clock = resolveBuyerReadyStageClock({
      stage: params.buyerReadyNode.stage,
      persistedStageEnteredAt:
        params.buyerReadyNode.stageEnteredAt ?? null,
      activities: params.buyerReadyNode.activities,
    });

    dependencies.push({
      id: `buyer-ready-${params.buyerReadyNode.id}`,
      kind: "buyer_ready",
      label: "Buyer Ready",
      stage: params.buyerReadyNode.stage,
      status: params.buyerReadyNode.status,
      stageEnteredAt: clock.stageEnteredAt,
      clockQuality: clock.clockQuality,
      operationalState: mapBuyerReadyOperationalState({
        status: params.buyerReadyNode.status,
        activities: params.buyerReadyNode.activities,
        authoritativeLost:
          params.buyerReadyNode.authoritativeLost,
        hasActiveOperationalDelay:
          params.buyerReadyNode.hasActiveOperationalDelay,
      }),
      isCritical: true,
    });
  }

  return dependencies;
}

export function computeTimingChainIntelligence(params: {
  properties: IntelligenceProperty[];
  buyerReadyNode?: {
    id: number;
    stage: string | null;
    status: string;
    stageEnteredAt?: string | null;
    activities: OperationalActivity[];
    authoritativeLost?: boolean;
    hasActiveOperationalDelay?: boolean | null;
  } | null;
  buyerReadySummary?: ChainNodesChainSummary | null;
  referenceDate?: Date;
}): TimingChainIntelligenceResult {
  const referenceDate = params.referenceDate ?? new Date();

  const dependencies = buildChainDependencies({
    properties: params.properties,
    buyerReadyNode: params.buyerReadyNode ?? null,
  });

  const dependencyResults = scoreAllDependencies({
    dependencies,
    saleTiming: SALE_STAGE_TIMING,
    buyerReadyTiming: BUYER_READY_STAGE_TIMING,
    referenceDate,
  });

  const aggregated = aggregateDependencyScores({
    results: dependencyResults,
  });

  let score = aggregated.score;
  const note = aggregated.note;
  let capsApplied = aggregated.capsApplied;

  if (score != null) {
    const pendingAdjusted =
      applyChainLevelPendingConnectionModifier({
        chainScore: score,
        dependencies,
        results: dependencyResults,
        capsApplied,
      });
    score = pendingAdjusted.chainScore;
    capsApplied = pendingAdjusted.capsApplied;
  }

  const coverage = classifyDependencyCoverage(
    dependencies,
    dependencyResults
  );

  let displayScore = roundDisplayScore(score);
  // Option 2: active delay must not force the displayed confidence band down.
  displayScore = capCustomerDisplayScore(displayScore);

  const band = confidenceBand(displayScore);
  const labels = mapBandLabels(band);
  const presentation = confidencePresentation({
    score: displayScore,
    band,
  });

  const confidenceUnavailable = displayScore == null;

  const estimatedCompletionWindow = confidenceUnavailable
    ? "Unable to estimate"
    : appendEtaLimitedCoverageQualifier(
        computeEstimatedCompletionWindow({
          dependencies,
          results: dependencyResults,
          saleTiming: SALE_STAGE_TIMING,
          buyerReadyTiming: BUYER_READY_STAGE_TIMING,
        }),
        coverage.status
      );

  let nextRecalculationAt: string | null = null;

  for (const result of dependencyResults) {
    if (
      !result.scored ||
      result.expectedMaxDays == null
    ) {
      continue;
    }

    const dependency = dependencies.find(
      (entry) => entry.id === result.dependencyId
    );

    if (!dependency?.stageEnteredAt) {
      continue;
    }

    const candidate = computeNextRecalculationAt({
      stageEnteredAt: dependency.stageEnteredAt,
      expectedMaxDays: result.expectedMaxDays,
      referenceDate,
    });

    if (
      !nextRecalculationAt ||
      new Date(candidate).getTime() <
        new Date(nextRecalculationAt).getTime()
    ) {
      nextRecalculationAt = candidate;
    }
  }

  return {
    score,
    displayScore,
    band,
    bandHomeowner: labels.homeowner,
    bandEstateAgent: labels.estateAgent,
    confidenceLabel: presentation.label,
    confidenceColour: presentation.colour,
    confidenceBg: presentation.bg,
    confidenceUnavailable,
    dataCoverage: coverage.status,
    coverageLabel: coverage.label,
    estimatedCompletionWindow,
    capsApplied,
    aggregationNote: note,
    dependencyResults,
    confidenceAlgorithmVersion:
      CHAIN_INTELLIGENCE_CONFIG.confidenceAlgorithmVersion,
    etaAlgorithmVersion:
      CHAIN_INTELLIGENCE_CONFIG.etaAlgorithmVersion,
    nextRecalculationAt,
  };
}
