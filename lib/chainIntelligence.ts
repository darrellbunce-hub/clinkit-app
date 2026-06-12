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

export type IntelligenceProperty = {
  id: number;
  chainPosition: number;
  stage: string;
  status: string;
  address: string | null;
  lastUpdatedDays: number;
  activities: OperationalActivity[];
};

export type StageDefinition = {
  value: string;
  progress: number;
};

export type ChainHealthStatus =
  | "Stable"
  | "Active"
  | "At Risk"
  | "Replacement Buyer Required";

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
  confidenceScore: number;
  confidenceLabel: string;
  confidenceColour: string;
  confidenceBg: string;
  estimatedChainCompletion: string;
  bottleneckProperty: T | null;
  isScheduledCompletionMode: boolean;
};

const CONFIDENCE_BASE = 85;
const PENALTY_BLOCKED = 25;
const PENALTY_DELAYED = 10;
const PENALTY_STALE = 5;
const PENALTY_BROKEN = 30;
const PENALTY_BUYER_READY_STALE = 5;
const STALE_DAYS_BOTTLENECK = 14;

export { DELAY_REPORTED_PREFIX };

export function isConfidenceScopeProperty(
  property: Pick<
    IntelligenceProperty,
    "stage" | "address"
  >
): boolean {
  return !isSearchingPlaceholder(property);
}

export function getConfidenceScopeProperties<
  T extends IntelligenceProperty
>(properties: T[]): T[] {
  return properties.filter(
    isConfidenceScopeProperty
  );
}

export function getStaleProperties<
  T extends IntelligenceProperty
>(
  properties: T[],
  staleAfterDays = STALE_DAYS_CONFIDENCE
): T[] {
  return getConfidenceScopeProperties(
    properties
  ).filter(
    (property) =>
      daysSinceLastActivity(
        property.activities
      ) > staleAfterDays
  );
}

export function getDelayReportedProperties<
  T extends IntelligenceProperty
>(properties: T[]): T[] {
  return getConfidenceScopeProperties(
    properties
  ).filter((property) =>
    hasActiveDelayReport(
      property.activities
    )
  );
}

export function isBuyerReadyOperationallyStale(
  params: {
    buyerReadySummary:
      | ChainNodesChainSummary
      | null
      | undefined;
    buyerReadyActivities?:
      | OperationalActivity[]
      | null;
    staleAfterDays?: number;
  }
): boolean {
  const staleAfterDays =
    params.staleAfterDays ??
    STALE_DAYS_CONFIDENCE;

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
  const totalProgress =
    inScopeProperties.reduce(
      (total, property) => {
        const stage = stages.find(
          (candidate) =>
            candidate.value ===
            property.stage
        );

        if (!stage) {
          return total;
        }

        return total + (stage.progress || 0);
      },
      0
    );

  const totalNodeCount =
    inScopeProperties.length +
    (hasBuyerReady ? 1 : 0);

  if (totalNodeCount === 0) {
    return 0;
  }

  return Math.round(
    (totalProgress + buyerReadyProgress) /
      totalNodeCount
  );
}

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
  let score = CONFIDENCE_BASE;

  score -= params.blockedCount * PENALTY_BLOCKED;
  score -= params.activeDelayCount * PENALTY_DELAYED;
  score -= params.staleCount * PENALTY_STALE;
  score -= params.brokenCount * PENALTY_BROKEN;

  if (params.buyerReadyStale) {
    score -= PENALTY_BUYER_READY_STALE;
  }

  if (score < 0) {
    score = 0;
  }

  let label = "Needs Attention";
  let colour = "text-amber-700";
  let bg = "bg-amber-100";

  if (score >= 70) {
    label = "Healthy";
    colour = "text-green-700";
    bg = "bg-green-100";
  } else if (score >= 40) {
    label = "Progress Slowing";
    colour = "text-amber-700";
    bg = "bg-amber-100";
  }

  return {
    score,
    label,
    colour,
    bg,
  };
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

export function computeEstimatedChainCompletion(params: {
  averageProgress: number;
  requiresReplacementBuyer: boolean;
  blockedCount: number;
  activeDelayCount: number;
  staleCount: number;
  buyerReadyStale: boolean;
}): string {
  if (params.requiresReplacementBuyer) {
    return "Awaiting chain recovery";
  }

  let estimatedChainCompletion =
    "16–20 weeks";

  if (params.averageProgress >= 20) {
    estimatedChainCompletion = "12–16 weeks";
  }

  if (params.averageProgress >= 40) {
    estimatedChainCompletion = "8–12 weeks";
  }

  if (params.averageProgress >= 60) {
    estimatedChainCompletion = "4–8 weeks";
  }

  if (params.averageProgress >= 80) {
    estimatedChainCompletion = "1–3 weeks";
  }

  if (params.blockedCount > 0) {
    return `${estimatedChainCompletion} (blocked property detected)`;
  }

  if (params.activeDelayCount > 0) {
    return `${estimatedChainCompletion} (delays reported)`;
  }

  if (
    params.staleCount > 0 ||
    params.buyerReadyStale
  ) {
    return `${estimatedChainCompletion} (awaiting updates)`;
  }

  return estimatedChainCompletion;
}

export function selectBottleneckProperty<
  T extends IntelligenceProperty
>(inScopeProperties: T[]): T | null {
  const blockedProperty =
    inScopeProperties.find(
      (property) =>
        property.status === "blocked"
    );

  if (blockedProperty) {
    return blockedProperty;
  }

  const delayedProperty =
    inScopeProperties.find((property) =>
      hasActiveDelayReport(
        property.activities
      )
    );

  if (delayedProperty) {
    return delayedProperty;
  }

  const staleProperty =
    inScopeProperties.find(
      (property) =>
        daysSinceLastActivity(
          property.activities
        ) > STALE_DAYS_BOTTLENECK
    );

  return staleProperty ?? null;
}

export function computeChainIntelligence<
  T extends IntelligenceProperty
>(params: {
  chainProperties: T[];
  buyerReadySummary:
    | ChainNodesChainSummary
    | null;
  buyerReadyActivities?:
    | OperationalActivity[]
    | null;
  stages: StageDefinition[];
  scheduledCompletionMode?: boolean;
}): ChainIntelligenceResult<T> {
  const scheduledCompletionMode =
    params.scheduledCompletionMode ?? false;

  const inScopeProperties =
    getConfidenceScopeProperties(
      params.chainProperties
    );

  const stalePropertiesRaw =
    getStaleProperties(
      params.chainProperties
    );

  const staleProperties =
    scheduledCompletionMode
      ? []
      : stalePropertiesRaw;

  const delayedProperties =
    getDelayReportedProperties(
      params.chainProperties
    );

  const buyerReadyHasActiveDelay =
    hasActiveDelayReport(
      params.buyerReadyActivities
    );

  const activeDelayCount =
    countActiveDelayReports({
      propertyActivitiesList:
        inScopeProperties.map(
          (property) => property.activities
        ),
      buyerReadyActivities:
        params.buyerReadyActivities,
    });

  const brokenConnectionProperties =
    inScopeProperties.filter(
      (property) =>
        property.status ===
        "broken_connection"
    );

  const requiresReplacementBuyer =
    brokenConnectionProperties.length > 0;

  const blockedCount =
    inScopeProperties.filter(
      (property) =>
        property.status === "blocked"
    ).length;

  const buyerReadyStaleRaw =
    isBuyerReadyOperationallyStale({
      buyerReadySummary:
        params.buyerReadySummary,
      buyerReadyActivities:
        params.buyerReadyActivities,
    });

  const buyerReadyStale =
    scheduledCompletionMode
      ? false
      : buyerReadyStaleRaw;

  const buyerReadyProgress =
    params.buyerReadySummary?.progress ??
    0;

  const hasBuyerReady =
    !!params.buyerReadySummary;

  const averageProgress =
    computeAverageProgress(
      inScopeProperties,
      buyerReadyProgress,
      hasBuyerReady,
      params.stages
    );

  const confidence =
    computeChainConfidence({
      blockedCount,
      activeDelayCount,
      staleCount: scheduledCompletionMode
        ? 0
        : stalePropertiesRaw.length,
      brokenCount:
        brokenConnectionProperties.length,
      buyerReadyStale: scheduledCompletionMode
        ? false
        : buyerReadyStaleRaw,
    });

  const chainHealth =
    computeChainHealth({
      staleCount: scheduledCompletionMode
        ? 0
        : stalePropertiesRaw.length,
      delayReportedCount: activeDelayCount,
      requiresReplacementBuyer,
      scheduledCompletionMode,
    });

  const estimatedChainCompletion =
    scheduledCompletionMode
      ? ""
      : computeEstimatedChainCompletion({
          averageProgress,
          requiresReplacementBuyer,
          blockedCount,
          activeDelayCount,
          staleCount: stalePropertiesRaw.length,
          buyerReadyStale: buyerReadyStaleRaw,
        });

  const bottleneckProperty =
    scheduledCompletionMode
      ? null
      : selectBottleneckProperty(
          inScopeProperties
        );

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
    confidenceScore: confidence.score,
    confidenceLabel: confidence.label,
    confidenceColour: confidence.colour,
    confidenceBg: confidence.bg,
    estimatedChainCompletion,
    bottleneckProperty,
    isScheduledCompletionMode:
      scheduledCompletionMode,
  };
}
