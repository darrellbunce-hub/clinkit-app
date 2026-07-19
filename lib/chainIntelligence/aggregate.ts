import { CHAIN_INTELLIGENCE_CONFIG } from "@/lib/chainIntelligence/config";
import type {
  ChainDependencyInput,
  ChainDependencyKind,
  DependencyScoreResult,
} from "@/lib/chainIntelligence/dependencyScoring";

export type DataCoverageStatus = "full" | "limited" | "insufficient";

export function formatCoverageLabel(params: {
  visibleCount: number;
  scoredCount: number;
}): string {
  const stepWord =
    params.visibleCount === 1 ? "step" : "steps";

  return `Confidence based on timing data available for ${params.scoredCount} of ${params.visibleCount} visible chain ${stepWord}.`;
}

/** Once per chain when pending_connection cannot be timing-scored. */
export function applyChainLevelPendingConnectionModifier(params: {
  chainScore: number;
  dependencies: ChainDependencyInput[];
  results: DependencyScoreResult[];
  capsApplied: string[];
}): { chainScore: number; capsApplied: string[] } {
  const hasScoredPending = params.results.some(
    (result) =>
      result.scored &&
      result.operationalState === "pending_connection"
  );

  if (hasScoredPending) {
    return {
      chainScore: params.chainScore,
      capsApplied: params.capsApplied,
    };
  }

  const hasUnscoredPending = params.dependencies.some(
    (dependency) => {
      if (dependency.operationalState !== "pending_connection") {
        return false;
      }

      const result = params.results.find(
        (entry) => entry.dependencyId === dependency.id
      );

      return result != null && !result.scored;
    }
  );

  if (!hasUnscoredPending) {
    return {
      chainScore: params.chainScore,
      capsApplied: params.capsApplied,
    };
  }

  const modifier =
    CHAIN_INTELLIGENCE_CONFIG.operationalModifiers.pendingConnection;

  return {
    chainScore: Math.max(0, params.chainScore + modifier),
    capsApplied: [
      ...params.capsApplied,
      "unscored_pending_connection_chain_modifier",
    ],
  };
}

export function aggregateDependencyScores(params: {
  results: DependencyScoreResult[];
  blockedCap?: number;
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
      (result.zone === "overdue" ||
        result.zone === "severely_overdue")
  );

  const agg = CHAIN_INTELLIGENCE_CONFIG.aggregation;
  const useBuyerReadyBottleneck =
    buyerReadyOverdue != null &&
    (minResult?.kind === "buyer_ready" ||
      buyerReadyOverdue.dependencyScore <=
        minScore + agg.buyerReadyBottleneckProximity);

  const bottleneckWeight = useBuyerReadyBottleneck
    ? agg.buyerReadyBottleneckMinWeight
    : agg.baselineMinWeight;
  const averageWeight = useBuyerReadyBottleneck
    ? agg.buyerReadyBottleneckAvgWeight
    : agg.baselineAvgWeight;

  let chainScore = Math.round(
    minScore * bottleneckWeight + avgScore * averageWeight
  );
  const note = useBuyerReadyBottleneck
    ? `Buyer Ready bottleneck ${Math.round(bottleneckWeight * 100)}/${Math.round(averageWeight * 100)}: min ${minScore}, avg ${Math.round(avgScore)}`
    : `Baseline 60/40: min ${minScore}, avg ${Math.round(avgScore)}`;

  const caps = CHAIN_INTELLIGENCE_CONFIG.caps;
  const blockedCap = params.blockedCap ?? caps.blockedCritical;

  const hasBlockedCritical = params.results.some(
    (result) =>
      result.operationalState === "blocked" && result.scored
  );

  const hasLostCritical = params.results.some(
    (result) => result.operationalState === "lost"
  );

  const hasExplicitDelay = params.results.some(
    (result) => result.operationalState === "explicit_delay"
  );

  if (hasLostCritical) {
    chainScore = Math.min(chainScore, caps.lostCritical);
    capsApplied.push(`lost_critical_dependency_cap_${caps.lostCritical}`);
  }

  if (hasBlockedCritical) {
    chainScore = Math.min(chainScore, blockedCap);
    capsApplied.push(`blocked_critical_dependency_cap_${blockedCap}`);
  }

  if (
    hasExplicitDelay &&
    !hasBlockedCritical &&
    !hasLostCritical
  ) {
    chainScore = Math.min(
      chainScore,
      caps.explicitDelayMaxScore
    );
    capsApplied.push(
      `explicit_delay_prevents_strong_cap_${caps.explicitDelayMaxScore}`
    );
  }

  if (buyerReadyOverdue?.zone === "severely_overdue") {
    chainScore = Math.min(
      chainScore,
      caps.buyerReadySeverelyOverdue
    );
    capsApplied.push(
      `buyer_ready_severely_overdue_cap_${caps.buyerReadySeverelyOverdue}`
    );
  } else if (buyerReadyOverdue?.zone === "overdue") {
    chainScore = Math.min(
      chainScore,
      caps.buyerReadyOverdue
    );
    capsApplied.push(
      `buyer_ready_overdue_cap_${caps.buyerReadyOverdue}`
    );
  }

  return { score: chainScore, note, capsApplied };
}

export function classifyDependencyCoverage(
  dependencies: Array<{ kind: ChainDependencyKind }>,
  results: DependencyScoreResult[]
): { status: DataCoverageStatus; label: string } {
  const visibleCount = dependencies.length;
  const scoredCount = results.filter(
    (result) => result.scored
  ).length;

  if (scoredCount === 0) {
    return {
      status: "insufficient",
      label:
        "Chain Confidence unavailable — timing data is not yet reliable enough",
    };
  }

  const status: DataCoverageStatus =
    scoredCount < visibleCount ? "limited" : "full";

  return {
    status,
    label: formatCoverageLabel({ visibleCount, scoredCount }),
  };
}
