import { randomUUID } from "crypto";

import { daysBetween } from "@/lib/lifecycle/config";
import type {
  PropertyAnalyticsSnapshotPayload,
  PropertyLifecycleContext,
  PropertyOperationalState,
} from "@/lib/lifecycle/types";

const SNAPSHOT_VERSION = 1;

/** Extracts UK postcode district (outward code) without exposing full address. */
export function extractPostcodeDistrict(postcode: string | null): string | null {
  if (!postcode) {
    return null;
  }

  const normalised = postcode.trim().toUpperCase();

  if (!normalised) {
    return null;
  }

  const parts = normalised.split(/\s+/);

  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1].charAt(0)}`.trim();
  }

  const match = normalised.match(/^([A-Z]{1,2}\d[A-Z\d]?)/);

  return match?.[1] ?? null;
}

/**
 * Builds an anonymised analytics snapshot from operational context.
 *
 * Deliberately excludes emails, names, full addresses, and live user IDs.
 * Phase 3 ingests these records into the analytics platform.
 */
export function buildAnonymisedAnalyticsSnapshot(params: {
  context: PropertyLifecycleContext;
  postcode: string | null;
  regionCode?: string | null;
  activityCount?: number;
  finalOperationalState?: PropertyOperationalState;
  propertyRef?: string;
  chainRef?: string | null;
}): PropertyAnalyticsSnapshotPayload {
  const {
    context,
    postcode,
    regionCode = null,
    activityCount = 0,
    finalOperationalState = context.operationalState,
    propertyRef = randomUUID(),
    chainRef = context.chainId ? randomUUID() : null,
  } = params;

  const operationalDurationDays = daysBetween(context.enteredStateAt);

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    propertyRef,
    chainRef,
    regionCode,
    postcodeDistrict: extractPostcodeDistrict(postcode),
    relationshipType: context.relationshipType,
    originType: context.originType,
    finalOperationalState,
    chainCompletedAt: context.chainCompletedAt,
    operationalDurationDays,
    activityCount,
    memberCountAtSnapshot: context.memberCount,
    hadConnectedCounterparty: context.hasConnectedCounterparty,
    metrics: {
      days_since_last_operational_activity:
        context.daysSinceLastOperationalActivity,
      days_since_chain_operational_activity:
        context.daysSinceChainOperationalActivity,
      days_since_chain_completed: context.daysSinceChainCompleted,
      buyer_connected: context.buyerConnected,
      seller_connected: context.sellerConnected,
      had_accepted_claim: context.hasAcceptedClaim,
      had_valid_active_invitation: context.hasValidActiveInvitation,
      is_chain_connected: context.isChainConnected,
    },
  };
}
