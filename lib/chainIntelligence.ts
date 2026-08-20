import { isSearchingPlaceholder } from "@/lib/buildChainTopology";
import {
  countActiveDelayReports,
  daysSinceLastActivity,
  DELAY_REPORTED_PREFIX,
  hasActiveDelayReport,
  type OperationalActivity,
  STALE_DAYS_CONFIDENCE,
} from "@/lib/activityIntelligence";
import {
  isBuyerReadySummaryStale,
  type ChainNodesChainSummary,
} from "@/lib/chainNodesSummary";
import {
  COMPLETION_SCHEDULED_CHAIN_HEALTH_MESSAGE,
} from "@/lib/completionLifecycle";
import {
  CHAIN_CONFIDENCE_UNAVAILABLE_MESSAGE,
} from "@/lib/chainIntelligence/presentation";
import {
  computeTimingChainIntelligence,
} from "@/lib/chainIntelligence/timingEngine";

export type {
  IntelligenceProperty,
  StageDefinition,
  ChainHealthStatus,
} from "@/lib/chainIntelligence/types";

import type {
  ChainHealthStatus,
  IntelligenceProperty,
  StageDefinition,
} from "@/lib/chainIntelligence/types";

export type ChainIntelligenceResult<
  T extends IntelligenceProperty = IntelligenceProperty
> = {
  inScopeProperties: T[];
  staleProperties: T[];
  delayedProperties: T[];
  brokenConnectionProperties: T[];
  requiresReplacementBuyer: boolean;
  blockedCount: number;
  delayedCount: number;
  buyerReadyHasActiveDelay: boolean;
  buyerReadyStale: boolean;
  chainHealth: ChainHealthStatus;
  chainHealthMessage: string;
  averageProgress: number;
  internalConfidenceScore: number | null;
  confidenceScore: number | null;
  confidenceLabel: string;
  confidenceColour: string;
  confidenceBg: string;
  confidenceBand: string;
  confidenceBandHomeowner: string;
  confidenceBandEstateAgent: string;
  confidenceUnavailable: boolean;
  confidenceUnavailableMessage: string;
  dataCoverage: "full" | "limited" | "insufficient";
  coverageLabel: string;
  estimatedChainCompletion: string;
  bottleneckProperty: T | null;
  isScheduledCompletionMode: boolean;
  confidenceAlgorithmVersion: string;
  etaAlgorithmVersion: string;
  nextRecalculationAt: string | null;
};

const STALE_DAYS_BOTTLENECK = 14;

export { DELAY_REPORTED_PREFIX };

export function isConfidenceScopeProperty(
  property: Pick<IntelligenceProperty, "stage" | "address">
): boolean {
  return !isSearchingPlaceholder(property);
}

export function getConfidenceScopeProperties<
  T extends IntelligenceProperty
>(properties: T[]): T[] {
  return properties.filter(isConfidenceScopeProperty);
}

export function getStaleProperties<
  T extends IntelligenceProperty
>(
  properties: T[],
  staleAfterDays = STALE_DAYS_CONFIDENCE
): T[] {
  return getConfidenceScopeProperties(properties).filter(
    (property) =>
      daysSinceLastActivity(property.activities) >
      staleAfterDays
  );
}

export function getDelayReportedProperties<
  T extends IntelligenceProperty
>(properties: T[]): T[] {
  return getConfidenceScopeProperties(properties).filter(
    (property) =>
      hasActiveDelayReport(property.activities, {
        authoritativeActiveDelay:
          property.hasActiveOperationalDelay,
      })
  );
}

export function isBuyerReadyOperationallyStale(params: {
  buyerReadySummary:
    | ChainNodesChainSummary
    | null
    | undefined;
  buyerReadyActivities?: OperationalActivity[] | null;
  staleAfterDays?: number;
}): boolean {
  const staleAfterDays =
    params.staleAfterDays ?? STALE_DAYS_CONFIDENCE;

  if (params.buyerReadyActivities?.length) {
    return (
      daysSinceLastActivity(
        params.buyerReadyActivities
      ) > staleAfterDays
    );
  }

  return isBuyerReadySummaryStale(
    params.buyerReadySummary,
    staleAfterDays
  );
}

export function computeAverageProgress(
  inScopeProperties: IntelligenceProperty[],
  buyerReadyProgress: number,
  hasBuyerReady: boolean,
  stages: StageDefinition[]
): number {
  const totalProgress = inScopeProperties.reduce(
    (total, property) => {
      const stage = stages.find(
        (candidate) => candidate.value === property.stage
      );

      if (!stage) {
        return total;
      }

      return total + (stage.progress || 0);
    },
    0
  );

  const totalNodeCount =
    inScopeProperties.length + (hasBuyerReady ? 1 : 0);

  if (totalNodeCount === 0) {
    return 0;
  }

  return Math.round(
    (totalProgress + buyerReadyProgress) / totalNodeCount
  );
}

/** @deprecated Use timing-based result from computeChainIntelligence */
export function computeChainConfidence(params: {
  blockedCount: number;
  activeDelayCount: number;
  staleCount: number;
  brokenCount: number;
  buyerReadyStale: boolean;
}): {
  score: number;
  label: string;
  colour: string;
  bg: string;
} {
  const intelligence = computeTimingChainIntelligence({
    properties: [
      {
        id: 1,
        chainPosition: 1,
        stage: "offer_accepted",
        status:
          params.blockedCount > 0
            ? "blocked"
            : params.brokenCount > 0
              ? "broken_connection"
              : "healthy",
        address: "Synthetic",
        lastUpdatedDays: params.staleCount > 0 ? 30 : 1,
        activities: [
          {
            timestamp: new Date().toISOString(),
            update: "Offer Accepted",
          },
        ],
        stageEnteredAt: new Date().toISOString(),
      },
    ],
    buyerReadyNode: params.buyerReadyStale
      ? {
          id: 1,
          stage: "mortgage_application",
          status: "healthy",
          stageEnteredAt: new Date(
            Date.now() - 60 * 86400000
          ).toISOString(),
          activities: [],
        }
      : null,
  });

  return {
    score: intelligence.displayScore ?? 0,
    label: intelligence.confidenceLabel,
    colour: intelligence.confidenceColour,
    bg: intelligence.confidenceBg,
  };
}

export function computeEstimatedChainCompletion(params: {
  averageProgress: number;
  requiresReplacementBuyer: boolean;
  blockedCount: number;
  activeDelayCount: number;
  staleCount: number;
  buyerReadyStale: boolean;
}): string {
  if (params.requiresReplacementBuyer) {
    return "Unable to estimate — chain connection broken";
  }

  const intelligence = computeTimingChainIntelligence({
    properties: [
      {
        id: 1,
        chainPosition: 1,
        stage: progressToRepresentativeStage(
          params.averageProgress
        ),
        status:
          params.blockedCount > 0 ? "blocked" : "healthy",
        address: "Synthetic",
        lastUpdatedDays: 1,
        activities: [
          {
            timestamp: new Date().toISOString(),
            update: "Synthetic",
          },
        ],
        stageEnteredAt: new Date().toISOString(),
      },
    ],
  });

  return intelligence.estimatedCompletionWindow;
}

function progressToRepresentativeStage(
  averageProgress: number
): string {
  if (averageProgress >= 95) {
    return "ready_to_exchange";
  }

  if (averageProgress >= 70) {
    return "mortgage_offer_received";
  }

  if (averageProgress >= 40) {
    return "searches_ordered";
  }

  if (averageProgress >= 20) {
    return "solicitors_instructed";
  }

  return "offer_accepted";
}

export function computeChainHealth(params: {
  staleCount: number;
  delayReportedCount: number;
  requiresReplacementBuyer: boolean;
  scheduledCompletionMode?: boolean;
}): {
  status: ChainHealthStatus;
  message: string;
} {
  if (params.requiresReplacementBuyer) {
    return {
      status: "Replacement Buyer Required",
      message:
        "A chain connection has been broken. A replacement buyer may be required before the chain can progress.",
    };
  }

  if (params.scheduledCompletionMode) {
    if (params.delayReportedCount >= 2) {
      return {
        status: "At Risk",
        message:
          "Multiple delays have been reported while awaiting the agreed completion date.",
      };
    }

    if (params.delayReportedCount >= 1) {
      return {
        status: "Active",
        message:
          "A delay has been reported while awaiting the agreed completion date.",
      };
    }

    return {
      status: "Stable",
      message: COMPLETION_SCHEDULED_CHAIN_HEALTH_MESSAGE,
    };
  }

  if (
    params.staleCount >= 2 ||
    params.delayReportedCount >= 2
  ) {
    return {
      status: "At Risk",
      message:
        "Multiple delays or stale properties may impact chain progression.",
    };
  }

  if (
    params.staleCount >= 1 ||
    params.delayReportedCount >= 1
  ) {
    return {
      status: "Active",
      message:
        "Some delays or stale updates detected within the chain.",
    };
  }

  return {
    status: "Stable",
    message:
      "Most properties updated recently with no major delays reported.",
  };
}

export function selectBottleneckProperty<
  T extends IntelligenceProperty
>(inScopeProperties: T[]): T | null {
  const blockedProperty = inScopeProperties.find(
    (property) => property.status === "blocked"
  );

  if (blockedProperty) {
    return blockedProperty;
  }

  const delayedProperty = inScopeProperties.find(
    (property) =>
      hasActiveDelayReport(property.activities, {
        authoritativeActiveDelay:
          property.hasActiveOperationalDelay,
      })
  );

  if (delayedProperty) {
    return delayedProperty;
  }

  const staleProperty = inScopeProperties.find(
    (property) =>
      daysSinceLastActivity(property.activities) >
      STALE_DAYS_BOTTLENECK
  );

  return staleProperty ?? null;
}

export type BuyerReadyIntelligenceNode = {
  id: number;
  stage: string | null;
  status: string;
  stageEnteredAt?: string | null;
  activities?: OperationalActivity[];
  /** Only when product provides an authoritative lost-buyer signal. */
  authoritativeLost?: boolean;
  hasActiveOperationalDelay?: boolean | null;
};

export function computeChainIntelligence<
  T extends IntelligenceProperty
>(params: {
  chainProperties: T[];
  buyerReadySummary: ChainNodesChainSummary | null;
  buyerReadyActivities?: OperationalActivity[] | null;
  buyerReadyNode?: BuyerReadyIntelligenceNode | null;
  stages: StageDefinition[];
  scheduledCompletionMode?: boolean;
  referenceDate?: Date;
}): ChainIntelligenceResult<T> {
  const scheduledCompletionMode =
    params.scheduledCompletionMode ?? false;

  const inScopeProperties = getConfidenceScopeProperties(
    params.chainProperties
  );

  const stalePropertiesRaw = getStaleProperties(
    params.chainProperties
  );

  const staleProperties = scheduledCompletionMode
    ? []
    : stalePropertiesRaw;

  const delayedProperties = getDelayReportedProperties(
    params.chainProperties
  );

  const buyerReadyHasActiveDelay = hasActiveDelayReport(
    params.buyerReadyActivities,
    {
      authoritativeActiveDelay:
        params.buyerReadyNode?.hasActiveOperationalDelay,
    }
  );

  const activeDelayCount = countActiveDelayReports({
    propertyActivitiesList: inScopeProperties.map(
      (property) => property.activities
    ),
    buyerReadyActivities: params.buyerReadyActivities,
    propertyAuthoritativeActiveDelays:
      inScopeProperties.map(
        (property) => property.hasActiveOperationalDelay
      ),
    buyerReadyAuthoritativeActiveDelay:
      params.buyerReadyNode?.hasActiveOperationalDelay,
  });

  const brokenConnectionProperties = inScopeProperties.filter(
    (property) => property.status === "broken_connection"
  );

  const requiresReplacementBuyer =
    brokenConnectionProperties.length > 0;

  const blockedCount = inScopeProperties.filter(
    (property) => property.status === "blocked"
  ).length;

  const buyerReadyStaleRaw = isBuyerReadyOperationallyStale({
    buyerReadySummary: params.buyerReadySummary,
    buyerReadyActivities: params.buyerReadyActivities,
  });

  const buyerReadyStale = scheduledCompletionMode
    ? false
    : buyerReadyStaleRaw;

  const buyerReadyProgress =
    params.buyerReadySummary?.progress ?? 0;

  const hasBuyerReady = !!params.buyerReadySummary;

  const averageProgress = computeAverageProgress(
    inScopeProperties,
    buyerReadyProgress,
    hasBuyerReady,
    params.stages
  );

  const resolvedBuyerReadyNode = (():
    | BuyerReadyIntelligenceNode
    | null => {
    if (params.buyerReadyNode?.stage) {
      return params.buyerReadyNode;
    }

    return null;
  })();

  const timing = computeTimingChainIntelligence({
    properties: inScopeProperties,
    buyerReadyNode: resolvedBuyerReadyNode
      ? {
          id: resolvedBuyerReadyNode.id,
          stage: resolvedBuyerReadyNode.stage,
          status: resolvedBuyerReadyNode.status,
          stageEnteredAt:
            resolvedBuyerReadyNode.stageEnteredAt,
          activities:
            resolvedBuyerReadyNode.activities ?? [],
          authoritativeLost:
            resolvedBuyerReadyNode.authoritativeLost,
          hasActiveOperationalDelay:
            resolvedBuyerReadyNode.hasActiveOperationalDelay,
        }
      : null,
    buyerReadySummary: params.buyerReadySummary,
    referenceDate: params.referenceDate,
  });

  const chainHealth = computeChainHealth({
    staleCount: scheduledCompletionMode
      ? 0
      : stalePropertiesRaw.length,
    delayReportedCount: activeDelayCount,
    requiresReplacementBuyer,
    scheduledCompletionMode,
  });

  const estimatedChainCompletion = scheduledCompletionMode
    ? ""
    : timing.estimatedCompletionWindow;

  const bottleneckProperty = scheduledCompletionMode
    ? null
    : selectBottleneckProperty(inScopeProperties);

  return {
    inScopeProperties,
    staleProperties,
    delayedProperties,
    brokenConnectionProperties,
    requiresReplacementBuyer,
    blockedCount,
    delayedCount: activeDelayCount,
    buyerReadyHasActiveDelay,
    buyerReadyStale,
    chainHealth: chainHealth.status,
    chainHealthMessage: chainHealth.message,
    averageProgress,
    internalConfidenceScore: timing.score,
    confidenceScore: timing.displayScore,
    confidenceLabel: timing.confidenceLabel,
    confidenceColour: timing.confidenceColour,
    confidenceBg: timing.confidenceBg,
    confidenceBand: timing.band,
    confidenceBandHomeowner: timing.bandHomeowner,
    confidenceBandEstateAgent: timing.bandEstateAgent,
    confidenceUnavailable: timing.confidenceUnavailable,
    confidenceUnavailableMessage:
      CHAIN_CONFIDENCE_UNAVAILABLE_MESSAGE,
    dataCoverage: timing.dataCoverage,
    coverageLabel: timing.coverageLabel,
    estimatedChainCompletion,
    bottleneckProperty,
    isScheduledCompletionMode: scheduledCompletionMode,
    confidenceAlgorithmVersion:
      timing.confidenceAlgorithmVersion,
    etaAlgorithmVersion: timing.etaAlgorithmVersion,
    nextRecalculationAt: timing.nextRecalculationAt,
  };
}
