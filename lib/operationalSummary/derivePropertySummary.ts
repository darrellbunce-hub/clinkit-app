import {
  deriveNeedsAttention,
  deriveNextRecommendedAction,
  toStoredAlerts,
} from "@/lib/operationalAlerts/deriveAlertMetrics";
import { evaluateOperationalAlerts } from "@/lib/operationalAlerts/registry";
import { OPERATIONAL_SUMMARY_VERSION } from "@/lib/operationalSummary/constants";
import {
  daysSinceLastActivity,
  hasActiveDelayReport,
  STALE_DAYS_PAGE_ALERT,
} from "@/lib/activityIntelligence";
import { isBuyerReadyOperationallyStale } from "@/lib/chainIntelligence";
import {
  COMPLETION_LIFECYCLE_STATUS,
  isChainInScheduledCompletionMode,
} from "@/lib/completionLifecycle";
import {
  deriveChainSummary,
  findBuyerReadyNodeForProperty,
  getLatestActivityTimestamp,
} from "@/lib/operationalSummary/deriveChainSummary";
import type {
  ChainOperationalSummaryRecord,
  OperationalRefreshDataset,
  PropertyOperationalSummaryRecord,
} from "@/lib/operationalSummary/types";

export function derivePropertySummary(params: {
  property: OperationalRefreshDataset["properties"][number];
  dataset: OperationalRefreshDataset;
  chainSummary: ChainOperationalSummaryRecord;
}): PropertyOperationalSummaryRecord {
  const { property, dataset, chainSummary } =
    params;

  const scheduledCompletionMode =
    isChainInScheduledCompletionMode({
      completionLifecycleStatus:
        dataset.chain.completionLifecycleStatus,
      completionScheduledDate:
        dataset.chain.completionScheduledDate,
    });

  const daysSinceLastUpdate =
    daysSinceLastActivity(property.activities);

  const staleUpdate =
    !scheduledCompletionMode &&
    daysSinceLastUpdate > STALE_DAYS_PAGE_ALERT;

  const buyerReadyNode =
    findBuyerReadyNodeForProperty(
      dataset.chainNodes,
      property.id
    );

  const buyerReadyDelayed = buyerReadyNode
    ? hasActiveDelayReport(
        buyerReadyNode.activities
      )
    : false;

  const buyerReadyStale = buyerReadyNode
    ? isBuyerReadyOperationallyStale({
        buyerReadySummary: {
          id: buyerReadyNode.id,
          chain_id: dataset.chain.id,
          node_type: buyerReadyNode.node_type,
          position: 0,
          linked_property_id:
            buyerReadyNode.linked_property_id,
          status: buyerReadyNode.status,
          progress: buyerReadyNode.progress,
          public_stage_label: "",
          latest_activity_at:
            buyerReadyNode.activities[0]
              ?.timestamp ?? null,
        },
        buyerReadyActivities:
          buyerReadyNode.activities,
      })
    : false;

  const completionStatus =
    dataset.chain.completionLifecycleStatus;

  const operationalAlerts =
    evaluateOperationalAlerts({
      propertyStatus: property.status,
      daysSinceLastUpdate,
      staleUpdate,
      hasActivePropertyDelay: hasActiveDelayReport(
        property.activities
      ),
      buyerReadyDelayed,
      buyerReadyStale,
      completionAwaitingConfirmation:
        completionStatus ===
        COMPLETION_LIFECYCLE_STATUS.awaitingConfirmation,
      chainConfidenceScore:
        chainSummary.confidence_score,
      requiresReplacementBuyer:
        chainSummary.requires_replacement_buyer,
      scheduledCompletionMode,
    });

  const lastUpdateAt = getLatestActivityTimestamp([
    property.activities,
    buyerReadyNode?.activities ?? [],
  ]);

  const buyerReadyLastUpdate =
    buyerReadyNode &&
    buyerReadyNode.activities.length > 0
      ? getLatestActivityTimestamp([
          buyerReadyNode.activities,
        ])
      : null;

  return {
    property_id: property.id,
    chain_id: dataset.chain.id,
    current_stage: property.stage,
    property_status: property.status,
    last_update_at: getLatestActivityTimestamp([
      property.activities,
    ]),
    days_since_last_update: daysSinceLastUpdate,
    stale_update: staleUpdate,
    buyer_ready_stage: buyerReadyNode?.stage ?? null,
    buyer_ready_status:
      buyerReadyNode?.status ?? null,
    buyer_ready_last_update: buyerReadyLastUpdate,
    buyer_ready_delayed: buyerReadyDelayed,
    buyer_ready_stale: buyerReadyStale,
    completion_status: completionStatus,
    completion_scheduled:
      completionStatus ===
      COMPLETION_LIFECYCLE_STATUS.scheduled,
    completion_confirmed:
      !!dataset.chain.completionConfirmedAt ||
      completionStatus ===
        COMPLETION_LIFECYCLE_STATUS.completed,
    operational_alerts:
      toStoredAlerts(operationalAlerts),
    needs_attention:
      deriveNeedsAttention(operationalAlerts),
    next_recommended_action:
      deriveNextRecommendedAction(
        operationalAlerts
      ),
    computed_at: new Date().toISOString(),
    summary_version: OPERATIONAL_SUMMARY_VERSION,
    derived_from_activity_at: lastUpdateAt,
  };
}

export function derivePropertySummariesForChain(params: {
  dataset: OperationalRefreshDataset;
  chainSummary: ChainOperationalSummaryRecord;
}): PropertyOperationalSummaryRecord[] {
  return params.dataset.properties.map(
    (property) =>
      derivePropertySummary({
        property,
        dataset: params.dataset,
        chainSummary: params.chainSummary,
      })
  );
}
