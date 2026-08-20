import { STAGES } from "@/data/stages";
import {
  daysSinceLastActivity,
  type OperationalActivity,
} from "@/lib/activityIntelligence";
import {
  computeChainIntelligence,
  getStaleProperties,
  type IntelligenceProperty,
} from "@/lib/chainIntelligence";
import type { ChainNodesChainSummary } from "@/lib/chainNodesSummary";
import { isChainInScheduledCompletionMode } from "@/lib/completionLifecycle";
import { OPERATIONAL_SUMMARY_VERSION } from "@/lib/operationalSummary/constants";
import { mapChainHealthStatusToSlug } from "@/lib/operationalSummary/mapHealthStatus";
import type {
  ChainOperationalSummaryRecord,
  OperationalRefreshChainNode,
  OperationalRefreshDataset,
} from "@/lib/operationalSummary/types";

function findPrimaryBuyerReadyNode(
  chainNodes: OperationalRefreshChainNode[]
): OperationalRefreshChainNode | null {
  return (
    chainNodes.find(
      (node) => node.node_type === "buyer_ready"
    ) ?? null
  );
}

function toBuyerReadySummary(
  node: OperationalRefreshChainNode,
  chainId: number
): ChainNodesChainSummary {
  const latestActivityAt =
    node.activities
      .slice()
      .sort(
        (left, right) =>
          new Date(right.timestamp).getTime() -
          new Date(left.timestamp).getTime()
      )[0]?.timestamp ?? null;

  return {
    id: node.id,
    chain_id: chainId,
    node_type: node.node_type,
    position: 0,
    linked_property_id: node.linked_property_id,
    status: node.status,
    progress: node.progress,
    public_stage_label: "",
    latest_activity_at: latestActivityAt,
  };
}

function toIntelligenceProperty(
  property: OperationalRefreshDataset["properties"][number]
): IntelligenceProperty {
  return {
    id: property.id,
    chainPosition: property.chainPosition,
    stage: property.stage,
    status: property.status,
    address: property.address,
    lastUpdatedDays: daysSinceLastActivity(
      property.activities
    ),
    activities: property.activities,
    stageEnteredAt: property.stageEnteredAt,
    hasActiveOperationalDelay:
      property.hasActiveOperationalDelay,
  };
}

export function deriveChainSummary(
  dataset: OperationalRefreshDataset
): ChainOperationalSummaryRecord {
  const scheduledCompletionMode =
    isChainInScheduledCompletionMode({
      completionLifecycleStatus:
        dataset.chain.completionLifecycleStatus,
      completionScheduledDate:
        dataset.chain.completionScheduledDate,
    });

  const buyerReadyNode =
    findPrimaryBuyerReadyNode(dataset.chainNodes);

  const buyerReadySummary = buyerReadyNode
    ? toBuyerReadySummary(
        buyerReadyNode,
        dataset.chain.id
      )
    : null;

  const intelligenceProperties =
    dataset.properties.map(toIntelligenceProperty);

  const intelligence = computeChainIntelligence({
    chainProperties: intelligenceProperties,
    buyerReadySummary,
    buyerReadyActivities:
      buyerReadyNode?.activities ?? null,
    buyerReadyNode: buyerReadyNode
      ? {
          id: buyerReadyNode.id,
          stage: buyerReadyNode.stage,
          status: buyerReadyNode.status,
          stageEnteredAt: buyerReadyNode.stageEnteredAt,
          activities: buyerReadyNode.activities,
          hasActiveOperationalDelay:
            buyerReadyNode.hasActiveOperationalDelay,
        }
      : null,
    stages: STAGES,
    scheduledCompletionMode,
  });

  const staleCount = scheduledCompletionMode
    ? 0
    : getStaleProperties(
        intelligenceProperties
      ).length;

  return {
    chain_id: dataset.chain.id,
    confidence_score: intelligence.internalConfidenceScore,
    confidence_band: intelligence.confidenceBand,
    confidence_unavailable: intelligence.confidenceUnavailable,
    data_coverage_status: intelligence.dataCoverage,
    coverage_label: intelligence.coverageLabel,
    estimated_completion_window:
      intelligence.estimatedChainCompletion || null,
    next_recalculation_at: intelligence.nextRecalculationAt,
    confidence_algorithm_version:
      intelligence.confidenceAlgorithmVersion,
    eta_algorithm_version: intelligence.etaAlgorithmVersion,
    health_status: mapChainHealthStatusToSlug(
      intelligence.chainHealth
    ),
    blocked_count: intelligence.blockedCount,
    delay_count: intelligence.delayedCount,
    stale_count: staleCount,
    buyer_ready_stale:
      intelligence.buyerReadyStale,
    requires_replacement_buyer:
      intelligence.requiresReplacementBuyer,
    computed_at: new Date().toISOString(),
    summary_version: OPERATIONAL_SUMMARY_VERSION,
  };
}

export function findBuyerReadyNodeForProperty(
  chainNodes: OperationalRefreshChainNode[],
  propertyId: number
): OperationalRefreshChainNode | null {
  return (
    chainNodes.find(
      (node) =>
        node.node_type === "buyer_ready" &&
        node.linked_property_id === propertyId
    ) ?? null
  );
}

export function getLatestActivityTimestamp(
  activityGroups: OperationalActivity[][]
): string | null {
  let latestTimestamp: string | null = null;

  for (const activities of activityGroups) {
    const latest = activities
      .slice()
      .sort(
        (left, right) =>
          new Date(right.timestamp).getTime() -
          new Date(left.timestamp).getTime()
      )[0];

    if (!latest?.timestamp) {
      continue;
    }

    if (
      !latestTimestamp ||
      new Date(latest.timestamp).getTime() >
        new Date(latestTimestamp).getTime()
    ) {
      latestTimestamp = latest.timestamp;
    }
  }

  return latestTimestamp;
}
