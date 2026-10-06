import {
  deriveNeedsAttention,
  deriveNextRecommendedAction,
  toStoredAlerts,
} from "@/lib/operationalAlerts/deriveAlertMetrics";
import { evaluateOperationalAlerts } from "@/lib/operationalAlerts/registry";
import { OPERATIONAL_SUMMARY_VERSION } from "@/lib/operationalSummary/constants";
import {
  daysSinceOperationalClock,
  hasActiveDelayReport,
  type OperationalActivity,
  STALE_DAYS_PAGE_ALERT,
} from "@/lib/activityIntelligence";
import {
  isBuyerReadyOperationallyStale,
  isConfidenceScopeProperty,
} from "@/lib/chainIntelligence";
import {
  COMPLETION_LIFECYCLE_STATUS,
  isChainInScheduledCompletionMode,
} from "@/lib/completionLifecycle";
import {
  findBuyerReadyNodeForProperty,
  getLatestActivityTimestamp,
} from "@/lib/operationalSummary/deriveChainSummary";
import type {
  ChainOperationalSummaryRecord,
  OperationalRefreshDataset,
  PropertyOperationalSummaryRecord,
} from "@/lib/operationalSummary/types";

function genuineOrLatestActivityAt(target: {
  genuineLastActivityAt?: string | null;
  activities: OperationalActivity[];
}): string | null {
  if (target.genuineLastActivityAt !== undefined) {
    return target.genuineLastActivityAt;
  }

  return getLatestActivityTimestamp([target.activities]);
}

function latestTimestamp(
  timestamps: Array<string | null>
): string | null {
  let latest: string | null = null;

  for (const timestamp of timestamps) {
    if (
      timestamp &&
      (!latest ||
        new Date(timestamp).getTime() >
          new Date(latest).getTime())
    ) {
      latest = timestamp;
    }
  }

  return latest;
}

export function derivePropertySummary(params: {
  property: OperationalRefreshDataset["properties"][number];
  dataset: OperationalRefreshDataset;
  chainSummary: ChainOperationalSummaryRecord;
  referenceDate?: Date;
}): PropertyOperationalSummaryRecord {
  const { property, dataset, chainSummary } =
    params;
  const referenceDate = params.referenceDate ?? new Date();

  const scheduledCompletionMode =
    isChainInScheduledCompletionMode({
      completionLifecycleStatus:
        dataset.chain.completionLifecycleStatus,
      completionScheduledDate:
        dataset.chain.completionScheduledDate,
    });

  const daysSinceLastUpdate = daysSinceOperationalClock(
    property,
    referenceDate
  );

  const staleUpdate =
    !scheduledCompletionMode &&
    isConfidenceScopeProperty(property) &&
    daysSinceLastUpdate > STALE_DAYS_PAGE_ALERT;

  const buyerReadyNode =
    findBuyerReadyNodeForProperty(
      dataset.chainNodes,
      property.id
    );

  const buyerReadyDelayed = buyerReadyNode
    ? hasActiveDelayReport(
        buyerReadyNode.activities,
        {
          authoritativeActiveDelay:
            buyerReadyNode.hasActiveOperationalDelay,
        }
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
        buyerReadyActivityClockAt:
          buyerReadyNode.activityClockAt,
        referenceDate,
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
        property.activities,
        {
          authoritativeActiveDelay:
            property.hasActiveOperationalDelay,
        }
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

  // Property-level "last updated" never includes Buyer Ready or other
  // properties' activity; Buyer Ready feeds chain health separately.
  const propertyLastUpdateAt =
    genuineOrLatestActivityAt(property);

  const buyerReadyLastUpdate = buyerReadyNode
    ? genuineOrLatestActivityAt(buyerReadyNode)
    : null;

  return {
    property_id: property.id,
    chain_id: dataset.chain.id,
    current_stage: property.stage,
    property_status: property.status,
    last_update_at: propertyLastUpdateAt,
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
    computed_at: referenceDate.toISOString(),
    summary_version: OPERATIONAL_SUMMARY_VERSION,
    derived_from_activity_at: latestTimestamp([
      propertyLastUpdateAt,
      buyerReadyLastUpdate,
    ]),
    activity_clock_at:
      property.activityClockAt !== undefined
        ? property.activityClockAt
        : propertyLastUpdateAt,
    activity_clock_source:
      property.activityClockAt !== undefined
        ? (property.activityClockSource ?? null)
        : propertyLastUpdateAt
          ? "latest_activity"
          : null,
  };
}

export function derivePropertySummariesForChain(params: {
  dataset: OperationalRefreshDataset;
  chainSummary: ChainOperationalSummaryRecord;
  referenceDate?: Date;
}): PropertyOperationalSummaryRecord[] {
  return params.dataset.properties.map(
    (property) =>
      derivePropertySummary({
        property,
        dataset: params.dataset,
        chainSummary: params.chainSummary,
        referenceDate: params.referenceDate,
      })
  );
}
