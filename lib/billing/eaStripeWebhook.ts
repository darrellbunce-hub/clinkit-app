import "server-only";

import { createHash } from "crypto";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  amountGbpMinorForTier,
  type EaPricingTier,
} from "@/lib/billing/eaBranchPricing";
import { dispatchBillingCustomerEmailsForTransition } from "@/lib/billing/eaBillingCustomerEmails";
import {
  cancelledAtForRow,
  computeGraceEndsAt,
  mapStripeSubscriptionToKeynetic,
  stripeCancellationReversal,
  stripeCancellationSchedule,
  webhookAuditEventFor,
  type StripeCancellationPreviousAttributes,
  type StripeCancellationReversal,
} from "@/lib/billing/mapStripeStatus";
import {
  expireOutstandingCheckoutSessions,
  type CheckoutSessionsClient,
  type OutstandingSessionReport,
} from "@/lib/billing/eaCheckoutSessionExpiry";
import {
  CHECKOUT_BLOCKING_STRIPE_STATUSES,
  postLinkSessionReconcileReason,
} from "@/lib/billing/eaCheckoutSubscriptionGuard";
import {
  decideSubscriptionAssociation,
  TERMINAL_STRIPE_SUBSCRIPTION_STATUSES,
} from "@/lib/billing/eaSubscriptionAssociation";
import { getStripeClient } from "@/lib/billing/stripeClient";
import {
  getStripeServerConfig,
  isFoundingStripePriceId,
} from "@/lib/billing/stripeServerConfig";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

function unixToIso(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

/** Database timestamps ("…+00:00") in the toISOString form used in keys and ids. */
function normaliseIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * Newer Stripe API versions expose billing periods only on subscription items;
 * older webhook payloads still carry them on the subscription itself.
 */
function subscriptionPeriodUnix(
  subscription: Stripe.Subscription,
  field: "current_period_start" | "current_period_end"
): number | null {
  const legacy = (
    subscription as Stripe.Subscription & {
      current_period_start?: number;
      current_period_end?: number;
    }
  )[field];
  if (typeof legacy === "number") return legacy;
  const item = subscription.items?.data?.[0] as
    | (Stripe.SubscriptionItem & {
        current_period_start?: number;
        current_period_end?: number;
      })
    | undefined;
  const fromItem = item?.[field];
  return typeof fromItem === "number" ? fromItem : null;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (
    invoice as Stripe.Invoice & {
      subscription?: string | { id: string } | null;
    }
  ).subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) return legacy.id;

  const parent = (
    invoice as Stripe.Invoice & {
      parent?: {
        subscription_details?: {
          subscription?: string | { id: string } | null;
        } | null;
      } | null;
    }
  ).parent;
  const details = parent?.subscription_details?.subscription;
  if (typeof details === "string") return details;
  if (details && typeof details === "object" && "id" in details) {
    return details.id;
  }
  return null;
}

/**
 * Stripe webhook chronology authority for Keynetic reconciliation.
 * Uses Stripe event.created — NOT current_period_end, NOT local receipt time,
 * and NOT event.id (IDs are not chronologically sortable).
 */
export function stripeEventChronologyAt(event: {
  created: number;
}): Date {
  return new Date(event.created * 1000);
}

export type WebhookClaimAction =
  | "process"
  | "already_succeeded"
  | "in_progress"
  | "claim_failed";

export type ProcessStripeWebhookOptions = {
  /**
   * Development verifier hook only.
   * When EA_BILLING_WEBHOOK_TEST_HOOKS=1, fail after claim and before reconcile
   * so Stripe-retry reclaim behaviour can be proven.
   */
  simulateFailureAfterClaim?: boolean;
};

type ClaimResult = {
  action: WebhookClaimAction;
  status?: string;
};

const CLAIM_STALE_AFTER_MS = 300_000;

function mapRpcClaimAction(payload: {
  ok?: boolean;
  action?: string;
  status?: string;
}): ClaimResult | null {
  if (payload.ok !== true || !payload.action) return null;
  if (payload.action === "process") {
    return { action: "process", status: payload.status };
  }
  if (payload.action === "already_succeeded") {
    return { action: "already_succeeded", status: payload.status };
  }
  if (payload.action === "in_progress") {
    return { action: "in_progress", status: payload.status };
  }
  return null;
}

/**
 * Fallback claim when claim_stripe_webhook_event RPC is not yet applied.
 * Preserves the P0 invariant using existing stripe_webhook_events rows:
 * processed/ignored → already_succeeded; failed/stale processing → reclaim.
 */
async function claimWebhookEventFallback(
  admin: SupabaseClient,
  event: Stripe.Event
): Promise<ClaimResult> {
  const { error: insertError } = await admin.from("stripe_webhook_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    processing_status: "processing",
  });

  if (!insertError) {
    return { action: "process", status: "processing" };
  }
  if (insertError.code !== "23505") {
    return { action: "claim_failed" };
  }

  const { data: existing } = await admin
    .from("stripe_webhook_events")
    .select("processing_status, received_at, processed_at")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (!existing) {
    return { action: "claim_failed" };
  }

  if (
    existing.processing_status === "processed" ||
    existing.processing_status === "ignored"
  ) {
    return {
      action: "already_succeeded",
      status: existing.processing_status as string,
    };
  }

  if (existing.processing_status === "processing") {
    const started = existing.received_at
      ? new Date(existing.received_at as string).getTime()
      : 0;
    if (started && Date.now() - started < CLAIM_STALE_AFTER_MS) {
      return { action: "in_progress", status: "processing" };
    }
  }

  // failed OR stale processing → conditional reclaim (one winner under concurrency).
  // Bump received_at as lease start when processing_started_at RPC path is unavailable.
  const { data: reclaimed, error: reclaimError } = await admin
    .from("stripe_webhook_events")
    .update({
      processing_status: "processing",
      error_message: null,
      processed_at: null,
      event_type: event.type,
      received_at: new Date().toISOString(),
    })
    .eq("stripe_event_id", event.id)
    .in("processing_status", ["failed", "processing"])
    .select("id, processing_status")
    .maybeSingle();

  if (!reclaimError && reclaimed) {
    return { action: "process", status: "processing" };
  }

  const { data: again } = await admin
    .from("stripe_webhook_events")
    .select("processing_status")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (
    again?.processing_status === "processed" ||
    again?.processing_status === "ignored"
  ) {
    return {
      action: "already_succeeded",
      status: again.processing_status as string,
    };
  }

  return { action: "in_progress", status: again?.processing_status as string };
}

/**
 * Claim / reclaim a Stripe webhook event.
 *
 * already_succeeded (processed|ignored) → idempotent skip
 * failed | stale processing → reclaim and process again
 * fresh processing lease → in_progress (caller must not return success)
 */
async function claimWebhookEvent(
  admin: SupabaseClient,
  event: Stripe.Event
): Promise<ClaimResult> {
  const { data, error } = await admin.rpc("claim_stripe_webhook_event", {
    p_stripe_event_id: event.id,
    p_event_type: event.type,
    p_stale_after_seconds: 300,
  });

  if (!error && data && typeof data === "object") {
    const mapped = mapRpcClaimAction(
      data as { ok?: boolean; action?: string; status?: string }
    );
    if (mapped) return mapped;
  }

  return claimWebhookEventFallback(admin, event);
}

async function finishWebhookEvent(
  admin: SupabaseClient,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  errorMessage?: string
) {
  const { error: rpcError } = await admin.rpc("finish_stripe_webhook_event", {
    p_stripe_event_id: eventId,
    p_status: status,
    p_error_message: errorMessage ?? null,
  });

  if (!rpcError) return;

  // Direct update when finish RPC is not yet applied (or RPC failed).
  await admin
    .from("stripe_webhook_events")
    .update({
      processing_status: status,
      processed_at: status === "failed" ? null : new Date().toISOString(),
      error_message:
        status === "failed"
          ? (errorMessage ?? "processing_failed").slice(0, 500)
          : null,
    })
    .eq("stripe_event_id", eventId);
}

function assertTestHooksAllowed(options?: ProcessStripeWebhookOptions) {
  if (!options?.simulateFailureAfterClaim) return;
  if (process.env.EA_BILLING_WEBHOOK_TEST_HOOKS !== "1") {
    throw new Error("webhook_test_hooks_disabled");
  }
}

function resolveBranchIds(subscription: Stripe.Subscription): {
  branchId: string | null;
  companyId: string | null;
  subscriptionRowId: string | null;
  pricingTier: EaPricingTier | null;
} {
  const meta = subscription.metadata || {};
  const tier =
    meta.keynetic_pricing_tier === "founding" ||
    meta.keynetic_pricing_tier === "standard"
      ? meta.keynetic_pricing_tier
      : null;
  return {
    branchId: meta.keynetic_branch_id || null,
    companyId: meta.keynetic_company_id || null,
    subscriptionRowId: meta.keynetic_subscription_id || null,
    pricingTier: tier,
  };
}

async function reconcileStripeSubscription(
  admin: SupabaseClient,
  subscription: Stripe.Subscription,
  options: {
    confirmFounding?: boolean;
    fromPaymentFailure?: boolean;
    /** Stripe event.created chronology — required for stale-event protection. */
    eventChronologyAt: Date;
    /** Optional invoice id for payment-failed email idempotency. */
    invoiceId?: string | null;
    /** event.data.previous_attributes of customer.subscription.updated (reversal detection). */
    previousAttributes?: StripeCancellationPreviousAttributes | null;
  }
): Promise<{ applied: boolean; reason?: string }> {
  const config = getStripeServerConfig();
  const envMeta = subscription.metadata?.keynetic_env;
  if (envMeta && envMeta !== config.apiMode) {
    return { applied: false, reason: "env_mismatch" };
  }

  const ids = resolveBranchIds(subscription);
  let branchId = ids.branchId;
  let rowId = ids.subscriptionRowId;

  if (!branchId || !rowId) {
    const { data: byStripeSub } = await admin
      .from("ea_branch_subscriptions")
      .select("id, branch_id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle();
    if (byStripeSub) {
      rowId = byStripeSub.id as string;
      branchId = byStripeSub.branch_id as string;
    }
  }

  if (!branchId) {
    return { applied: false, reason: "branch_unresolved" };
  }

  const periodStart = unixToIso(
    subscriptionPeriodUnix(subscription, "current_period_start")
  );
  const periodEnd = unixToIso(
    subscriptionPeriodUnix(subscription, "current_period_end")
  );
  const periodEndDate = periodEnd ? new Date(periodEnd) : null;
  const chronologyAt = options.eventChronologyAt;
  const chronologyIso = chronologyAt.toISOString();
  const cancellation = stripeCancellationSchedule({
    stripeStatus: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAtUnix: subscription.cancel_at,
    currentPeriodEnd: periodEndDate,
    at: chronologyAt,
  });
  const mapped = mapStripeSubscriptionToKeynetic({
    stripeStatus: subscription.status,
    cancelAtPeriodEnd: cancellation.scheduled,
    currentPeriodEnd: periodEndDate,
  });

  // Load existing row for out-of-order guard (by row id when known, including ended).
  const rowColumns =
    "id, stripe_subscription_id, stripe_object_updated_at, entitlement_status, grace_ends_at, pricing_tier, founding_slot_number, ended_at, cancel_at_period_end, cancelled_at";
  let existingQuery = admin
    .from("ea_branch_subscriptions")
    .select(rowColumns)
    .eq("branch_id", branchId)
    .is("ended_at", null);

  if (rowId) {
    existingQuery = admin
      .from("ea_branch_subscriptions")
      .select(rowColumns)
      .eq("id", rowId)
      .eq("branch_id", branchId);
  }

  const { data: existing } = await existingQuery.maybeSingle();
  if (!existing) {
    return { applied: false, reason: "subscription_row_missing" };
  }

  // Never silently re-point a row (or the branch) at a different subscription.
  const rowLinkedId = (existing.stripe_subscription_id as string | null) ?? null;
  let otherOpenRow: { id: string } | null = null;
  if (
    existing.ended_at &&
    !TERMINAL_STRIPE_SUBSCRIPTION_STATUSES.has(subscription.status)
  ) {
    const { data: openRow, error: openRowError } = await admin
      .from("ea_branch_subscriptions")
      .select("id")
      .eq("branch_id", branchId)
      .is("ended_at", null)
      .neq("id", existing.id as string)
      .maybeSingle();
    if (openRowError) throw openRowError;
    otherOpenRow = openRow ? { id: openRow.id as string } : null;
  }

  const associationInput = {
    rowStripeSubscriptionId: rowLinkedId,
    incomingStripeSubscriptionId: subscription.id,
    incomingStatus: subscription.status,
    rowIsConfirmedFounding:
      existing.pricing_tier === "founding" && existing.founding_slot_number != null,
    otherOpenRow,
  };
  let association = decideSubscriptionAssociation(associationInput);
  let previousLinkedStatus: string | null | undefined;
  if (association.kind === "lookup_previous") {
    previousLinkedStatus = await retrieveStripeSubscriptionStatus(rowLinkedId!);
    association = decideSubscriptionAssociation({
      ...associationInput,
      previousLinkedStatus,
    });
  }
  if (association.kind === "ignore_superseded") {
    return { applied: false, reason: "superseded_subscription" };
  }
  if (association.kind === "conflict") {
    await recordWebhookAssociationConflict(admin, {
      branchId,
      subscriptionRowId: existing.id as string,
      reason: association.reason,
      existingStripeSubscriptionId: rowLinkedId,
      existingStripeStatus: previousLinkedStatus ?? null,
      incomingStripeSubscriptionId: subscription.id,
      incomingStripeStatus: subscription.status,
      otherOpenRowId: otherOpenRow?.id ?? null,
      chronologyIso,
    });
    return { applied: false, reason: "association_conflict" };
  }
  const replacedStripeSubscriptionId =
    association.kind === "replace_terminal" ? rowLinkedId : null;

  if (existing.stripe_object_updated_at) {
    const known = new Date(existing.stripe_object_updated_at as string).getTime();
    // Legacy Stage 2 stored current_period_end here (often weeks ahead).
    // Treat future watermarks as unset so event.created chronology can take over.
    const legacyPeriodEndWatermark = known > Date.now() + 60 * 60 * 1000;
    if (!legacyPeriodEndWatermark && chronologyAt.getTime() < known) {
      return { applied: false, reason: "stale_event" };
    }
  }

  const priceId =
    typeof subscription.items.data[0]?.price?.id === "string"
      ? subscription.items.data[0].price.id
      : null;

  // Stripe Price ID proves what was charged — not Keynetic founding entitlement.
  // Never manufacture founding solely from the £99 Price ID.
  let pricingTier: EaPricingTier =
    (existing.pricing_tier as EaPricingTier | null) ||
    ids.pricingTier ||
    "standard";
  let foundingSlotNumber: number | null =
    pricingTier === "founding"
      ? ((existing.founding_slot_number as number | null) ?? null)
      : null;

  if (priceId === config.standardPriceId) {
    pricingTier = "standard";
    foundingSlotNumber = null;
  }

  const isFoundingPrice = isFoundingStripePriceId(config, priceId);
  const looksFoundingAttempt =
    isFoundingPrice ||
    ids.pricingTier === "founding" ||
    existing.pricing_tier === "founding";

  if (
    options.confirmFounding &&
    mapped.entitlementStatus === "entitled" &&
    looksFoundingAttempt
  ) {
    const { data: confirmData } = await admin.rpc("confirm_ea_founding_slot", {
      p_branch_id: branchId,
      p_subscription_id: existing.id,
    });

    if (confirmData?.ok === true) {
      pricingTier = "founding";
      foundingSlotNumber =
        typeof confirmData.slot_number === "number"
          ? confirmData.slot_number
          : foundingSlotNumber;
    } else if (isFoundingPrice) {
      await handleFoundingConfirmException(admin, {
        branchId,
        subscriptionRowId: existing.id as string,
        stripeSubscription: subscription,
        confirmError:
          typeof confirmData?.error === "string"
            ? confirmData.error
            : "confirm_failed",
      });
      return { applied: true, reason: "founding_exception" };
    } else {
      pricingTier = "standard";
      foundingSlotNumber = null;
    }
  } else if (isFoundingPrice && !options.confirmFounding) {
    if (pricingTier !== "founding" || !foundingSlotNumber) {
      pricingTier =
        (existing.pricing_tier as EaPricingTier | null) === "founding" &&
        existing.founding_slot_number
          ? "founding"
          : "standard";
      foundingSlotNumber =
        pricingTier === "founding"
          ? ((existing.founding_slot_number as number | null) ?? null)
          : null;
    }
  }

  const previousEntitlement = existing.entitlement_status as string | null;

  let graceEndsAt: string | null = (existing.grace_ends_at as string) ?? null;
  if (options.fromPaymentFailure || mapped.enterGrace) {
    if (!graceEndsAt) {
      graceEndsAt = computeGraceEndsAt().toISOString();
    }
    if (graceEndsAt && new Date(graceEndsAt).getTime() < Date.now()) {
      mapped.entitlementStatus = "ended";
      mapped.ended = true;
    }
  }
  if (mapped.entitlementStatus === "entitled") {
    graceEndsAt = null;
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  const patch: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId ?? null,
    stripe_price_id: priceId,
    stripe_status: mapped.stripeStatus,
    entitlement_status: mapped.entitlementStatus,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancel_at_period_end: mapped.cancelAtPeriodEnd,
    cancelled_at: cancelledAtForRow({
      scheduled: mapped.cancelAtPeriodEnd && !mapped.ended,
      ended: mapped.ended,
      stripeCanceledAtUnix: subscription.canceled_at,
      existingCancelledAt: (existing.cancelled_at as string | null) ?? null,
    }),
    grace_ends_at: graceEndsAt,
    stripe_checkout_session_id: null,
    stripe_status_updated_at: new Date().toISOString(),
    stripe_object_updated_at: chronologyIso,
    pricing_tier: pricingTier,
    amount_gbp_minor: amountGbpMinorForTier(pricingTier),
    founding_slot_number: foundingSlotNumber,
    updated_at: new Date().toISOString(),
  };

  if (mapped.ended) {
    patch.ended_at = new Date().toISOString();
    patch.entitlement_status = "ended";
  } else {
    patch.ended_at = null;
  }

  // Conditional write: concurrent older events cannot overwrite a newer watermark.
  // Legacy future watermarks (period_end) are overwritten via unconditional id match
  // after the read-side legacy bypass above; thereafter event.created rules apply.
  const knownMs = existing.stripe_object_updated_at
    ? new Date(existing.stripe_object_updated_at as string).getTime()
    : null;
  const legacyPeriodEndWatermark =
    knownMs !== null && knownMs > Date.now() + 60 * 60 * 1000;

  // Compare-and-swap on the association read above: a concurrent webhook that
  // linked a different subscription makes this write match no row.
  let write = admin
    .from("ea_branch_subscriptions")
    .update(patch)
    .eq("id", existing.id);
  write = rowLinkedId
    ? write.eq("stripe_subscription_id", rowLinkedId)
    : write.is("stripe_subscription_id", null);

  if (!legacyPeriodEndWatermark) {
    write = write.or(
      `stripe_object_updated_at.is.null,stripe_object_updated_at.lte."${chronologyIso}"`
    );
  }

  const { data: updated, error: updateError } = await write
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }
  if (!updated) {
    const { data: current, error: currentError } = await admin
      .from("ea_branch_subscriptions")
      .select("stripe_subscription_id")
      .eq("id", existing.id)
      .maybeSingle();
    if (currentError) throw currentError;
    const currentLinked =
      (current?.stripe_subscription_id as string | null | undefined) ?? null;
    if (currentLinked !== rowLinkedId) {
      // Retry re-evaluates the association against the new link.
      throw new Error("subscription_association_changed");
    }
    return { applied: false, reason: "stale_or_concurrent_lost" };
  }

  if (customerId && branchId) {
    await admin
      .from("ea_branches")
      .update({ stripe_customer_id: customerId })
      .eq("id", branchId)
      .is("stripe_customer_id", null);
  }

  const becameEntitled =
    previousEntitlement !== "entitled" &&
    mapped.entitlementStatus === "entitled" &&
    !mapped.ended;
  const enteredGrace =
    previousEntitlement !== "grace" &&
    mapped.entitlementStatus === "grace" &&
    Boolean(graceEndsAt);
  // Sent whenever a cancellation is pending, not only on the false → true flip,
  // so a retry after a failed send still delivers it; the dispatch key
  // (subscription + effective end + Stripe canceled_at) keeps it to one email
  // per cancellation request.
  const cancellationEndsAt =
    mapped.cancelAtPeriodEnd && !mapped.ended && cancellation.endsAt
      ? cancellation.endsAt.toISOString()
      : null;
  const cancellationScheduled = cancellationEndsAt !== null;
  // Identifies the request: Stripe canceled_at, else the one already recorded
  // on the row (an update for the same pending request without canceled_at).
  const cancellationRequestedAt =
    mapped.cancelAtPeriodEnd && !mapped.ended
      ? (unixToIso(subscription.canceled_at) ??
        normaliseIso(existing.cancelled_at as string | null))
      : null;
  // Detected from this event's previous_attributes (not the stored row), so a
  // retry of the same event re-detects it after the row was already updated.
  const reversal = stripeCancellationReversal({
    stripeStatus: subscription.status,
    ended: mapped.ended,
    nowScheduled: cancellation.scheduled,
    previous: options.previousAttributes,
    currentCanceledAtUnix: subscription.canceled_at,
  });
  const reversalRequestId = reversal ? cancellationReversalRequestId(reversal) : null;

  if (becameEntitled || enteredGrace || cancellationScheduled || reversalRequestId) {
    await dispatchBillingCustomerEmailsForTransition(admin, {
      branchId,
      subscriptionRowId: existing.id as string,
      stripeSubscriptionId: subscription.id,
      pricingTier,
      amountGbpMinor: amountGbpMinorForTier(pricingTier),
      currentPeriodEnd: periodEnd,
      isTrialing: mapped.stripeStatus === "trialing",
      trialEndsAt: unixToIso(subscription.trial_end) ?? periodEnd,
      graceEndsAt,
      becameEntitled,
      enteredGrace,
      cancellationScheduled,
      cancellationEndsAt,
      cancellationRequestedAt,
      cancellationReversal: reversalRequestId
        ? { requestId: reversalRequestId }
        : null,
      invoiceId: options.invoiceId ?? null,
    });
  }

  // Audit rows come last: a failed insert throws, failing the webhook event
  // (billing-health alert + Stripe retry). The retry sees the row already
  // updated, so emails keyed on the transition must have been sent before this.
  const auditMetadata = {
    stripe_subscription_id: subscription.id,
    stripe_status: subscription.status,
    pricing_tier: pricingTier,
    event_chronology_at: chronologyIso,
    ...(replacedStripeSubscriptionId
      ? { replaced_stripe_subscription_id: replacedStripeSubscriptionId }
      : {}),
  };

  const isTrialing = mapped.stripeStatus === "trialing" && !mapped.ended;
  if (isTrialing) {
    await recordTrialStartedOnce(admin, {
      branchId,
      subscriptionRowId: existing.id as string,
      metadata: {
        ...auditMetadata,
        trial_end: unixToIso(subscription.trial_end),
      },
    });
  }

  if (replacedStripeSubscriptionId) {
    await insertSubscriptionAuditEvent(admin, {
      branch_id: branchId,
      subscription_id: existing.id,
      event_type: "resubscribed",
      actor_source: "webhook",
      metadata: auditMetadata,
    });
  }

  const eventType = webhookAuditEventFor(mapped);
  if (eventType === "cancellation_scheduled") {
    await recordCancellationScheduledOnce(admin, {
      branchId,
      subscriptionRowId: existing.id as string,
      cancellationEndsAt,
      cancellationRequestedAt,
      metadata: {
        ...auditMetadata,
        cancel_at: unixToIso(subscription.cancel_at),
        cancel_at_period_end: !!subscription.cancel_at_period_end,
        canceled_at: unixToIso(subscription.canceled_at),
      },
    });
  } else if (eventType) {
    await insertSubscriptionAuditEvent(admin, {
      branch_id: branchId,
      subscription_id: existing.id,
      event_type: eventType,
      actor_source: "webhook",
      metadata: auditMetadata,
    });
  }

  if (reversal && reversalRequestId) {
    await insertSubscriptionAuditEvent(
      admin,
      {
        id: cancellationReversedAuditEventId(subscription.id, reversalRequestId),
        branch_id: branchId,
        subscription_id: existing.id,
        event_type: "cancellation_reversed",
        actor_source: "webhook",
        metadata: {
          ...auditMetadata,
          reversed_request_id: reversalRequestId,
          reversed_canceled_at: unixToIso(reversal.canceledAtUnix),
          reversed_cancel_at: unixToIso(reversal.cancelAtUnix),
        },
      },
      { uniqueViolationMeansRecorded: true }
    );
  }

  return { applied: true };
}

/**
 * Identifies the cancellation request a reversal withdrew: Stripe canceled_at
 * when known (same value the cancellation's audit id and email key use).
 */
function cancellationReversalRequestId(reversal: StripeCancellationReversal): string {
  const canceledAt = unixToIso(reversal.canceledAtUnix);
  if (canceledAt) return canceledAt;
  const cancelAt = unixToIso(reversal.cancelAtUnix);
  return cancelAt ? `cancel_at:${cancelAt}` : "unknown";
}

/** Stripe status of a subscription; null when Stripe reports it missing. Other errors throw (retry). */
async function retrieveStripeSubscriptionStatus(
  stripeSubscriptionId: string
): Promise<string | null> {
  try {
    const subscription = await getStripeClient().subscriptions.retrieve(
      stripeSubscriptionId
    );
    return subscription.status;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "resource_missing"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * The incoming subscription cannot be linked without overwriting another
 * association. Nothing is written to the subscription row and no Stripe
 * subscription is touched; ops reconcile from this event (billing health alerts
 * on billing_reconcile_required). Deduped per incoming subscription and reason
 * per day; an insert failure throws so the webhook fails and is retried.
 */
async function recordWebhookAssociationConflict(
  admin: SupabaseClient,
  input: {
    branchId: string;
    subscriptionRowId: string;
    reason: string;
    existingStripeSubscriptionId: string | null;
    existingStripeStatus: string | null;
    incomingStripeSubscriptionId: string;
    incomingStripeStatus: string;
    otherOpenRowId: string | null;
    chronologyIso: string;
  }
): Promise<void> {
  const metadata = {
    reason: "webhook_subscription_association_conflict",
    conflict: input.reason,
    stripe_subscription_id: input.incomingStripeSubscriptionId,
    incoming_stripe_subscription_id: input.incomingStripeSubscriptionId,
    incoming_stripe_status: input.incomingStripeStatus,
    existing_stripe_subscription_id: input.existingStripeSubscriptionId,
    existing_stripe_status: input.existingStripeStatus,
    subscription_row_id: input.subscriptionRowId,
    other_open_row_id: input.otherOpenRowId,
    event_chronology_at: input.chronologyIso,
  };
  console.error("[billing-reconcile] webhook subscription association conflict", {
    branch_id: input.branchId,
    ...metadata,
  });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await admin
    .from("ea_subscription_events")
    .select("id")
    .eq("branch_id", input.branchId)
    .eq("event_type", "billing_reconcile_required")
    .contains("metadata", {
      incoming_stripe_subscription_id: input.incomingStripeSubscriptionId,
      conflict: input.reason,
    })
    .gte("created_at", since)
    .limit(1);
  if (!recentError && (recent ?? []).length > 0) return;

  await insertSubscriptionAuditEvent(admin, {
    branch_id: input.branchId,
    subscription_id: input.subscriptionRowId,
    event_type: "billing_reconcile_required",
    actor_source: "webhook",
    metadata,
  });
}

/**
 * Two Checkout requests can both pass the Stripe subscription check before
 * either subscription exists. Once a live subscription is linked to an open
 * branch row, every other open Checkout session on the same Customer and
 * branch is expired so it can no longer be paid. The session behind the linked
 * subscription is never touched, nor is any subscription.
 *
 * Driven by database state rather than the reconcile outcome, so retries and
 * later events repeat it; expired sessions are no longer listed, which makes it
 * idempotent. Subscriptions not linked to a row (association conflicts) are
 * skipped. Stripe failures do not fail the event: they record
 * billing_reconcile_required (deduped per subscription and reason per day); a
 * failed insert throws so the event is retried.
 */
export async function expireOtherCheckoutSessionsAfterLink(
  admin: SupabaseClient,
  stripe: CheckoutSessionsClient,
  subscription: Stripe.Subscription,
  options: { completedCheckoutSessionId?: string | null; eventChronologyAt: Date }
): Promise<OutstandingSessionReport | null> {
  if (!CHECKOUT_BLOCKING_STRIPE_STATUSES.has(subscription.status)) return null;
  const envMeta = subscription.metadata?.keynetic_env;
  if (envMeta && envMeta !== getStripeServerConfig().apiMode) return null;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;
  if (!customerId) return null;

  const { data: linkedRow, error: linkedError } = await admin
    .from("ea_branch_subscriptions")
    .select("id, branch_id")
    .eq("stripe_subscription_id", subscription.id)
    .is("ended_at", null)
    .maybeSingle();
  if (linkedError) throw linkedError;
  if (!linkedRow) return null;
  const branchId = linkedRow.branch_id as string;

  const report = await expireOutstandingCheckoutSessions(
    stripe,
    { branchId, customerId },
    {
      linked: {
        stripeSubscriptionId: subscription.id,
        checkoutSessionId: options.completedCheckoutSessionId ?? null,
      },
      logPrefix: "[billing-webhook]",
    }
  );
  const reason = postLinkSessionReconcileReason({
    outcomes: report.sessions.map((s) => s.outcome),
    listingFailed: report.listing_failed,
  });
  if (!reason) return report;

  const metadata = {
    reason,
    stripe_subscription_id: subscription.id,
    subscription_row_id: linkedRow.id as string,
    completed_checkout_session_id: options.completedCheckoutSessionId ?? null,
    outstanding_checkout_sessions: report,
    event_chronology_at: options.eventChronologyAt.toISOString(),
  };
  console.error("[billing-reconcile] other Checkout sessions not closed after link", {
    branch_id: branchId,
    ...metadata,
  });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await admin
    .from("ea_subscription_events")
    .select("id")
    .eq("branch_id", branchId)
    .eq("event_type", "billing_reconcile_required")
    .contains("metadata", { reason, stripe_subscription_id: subscription.id })
    .gte("created_at", since)
    .limit(1);
  if (!recentError && (recent ?? []).length > 0) return report;

  await insertSubscriptionAuditEvent(admin, {
    branch_id: branchId,
    subscription_id: linkedRow.id as string,
    event_type: "billing_reconcile_required",
    actor_source: "webhook",
    metadata,
  });
  return report;
}

/**
 * payment_succeeded comes only from a paid invoice with a non-zero amount (the
 * trial's £0 invoice is excluded), independent of subscription status or
 * chronology. Deduped by Stripe invoice id: lookup first, and the partial
 * unique index ea_subscription_events_payment_invoice_once_idx (migration
 * 20261108170000) as the guarantee.
 */
export async function recordInvoicePaymentSucceeded(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription
): Promise<void> {
  if (!invoice.id || !(invoice.amount_paid > 0)) return;
  const envMeta = subscription.metadata?.keynetic_env;
  if (envMeta && envMeta !== getStripeServerConfig().apiMode) return;

  const { data: linkedRow, error: linkedError } = await admin
    .from("ea_branch_subscriptions")
    .select("id, branch_id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  if (linkedError) throw linkedError;

  const branchId =
    (linkedRow?.branch_id as string | undefined) ??
    resolveBranchIds(subscription).branchId;
  if (!branchId) return;

  const { data: recorded, error: lookupError } = await admin
    .from("ea_subscription_events")
    .select("id")
    .eq("event_type", "payment_succeeded")
    .contains("metadata", { stripe_invoice_id: invoice.id })
    .limit(1);
  if (!lookupError && (recorded ?? []).length > 0) return;

  await insertSubscriptionAuditEvent(
    admin,
    {
      branch_id: branchId,
      subscription_id: (linkedRow?.id as string | undefined) ?? null,
      event_type: "payment_succeeded",
      actor_source: "webhook",
      metadata: {
        stripe_invoice_id: invoice.id,
        stripe_subscription_id: subscription.id,
        amount_paid: invoice.amount_paid,
        currency: invoice.currency,
        billing_reason: invoice.billing_reason ?? null,
        linked_to_subscription_row: !!linkedRow,
      },
    },
    { uniqueViolationMeansRecorded: true }
  );
}

type SubscriptionAuditEventRow = {
  id?: string;
  branch_id: string;
  subscription_id: string | null;
  event_type: string;
  actor_source: "webhook";
  metadata: Record<string, unknown>;
};

async function insertSubscriptionAuditEvent(
  admin: SupabaseClient,
  row: SubscriptionAuditEventRow,
  options?: { uniqueViolationMeansRecorded?: boolean }
): Promise<void> {
  const { error } = await admin.from("ea_subscription_events").insert(row);
  if (!error) return;
  if (options?.uniqueViolationMeansRecorded && error.code === "23505") return;
  console.error("[billing-audit] ea_subscription_events insert failed", {
    event_type: row.event_type,
    branch_id: row.branch_id,
    subscription_row_id: row.subscription_id,
    stripe_subscription_id: row.metadata.stripe_subscription_id ?? null,
    code: error.code ?? null,
    message: error.message,
  });
  throw new Error(
    `audit_event_insert_failed:${row.event_type}:${error.code ?? "unknown"}`
  );
}

/** Stable UUID (version 8, name-based) for an idempotent audit row. */
export function deterministicAuditEventId(name: string): string {
  const bytes = createHash("sha256").update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Without canceled_at this is the original (subscription + date) id, which
 * rows recorded before request-scoped ids also use.
 */
export function cancellationScheduledAuditEventId(
  stripeSubscriptionId: string,
  cancellationEndsAt: string | null,
  canceledAt: string | null
): string {
  const base = `cancellation_scheduled:${stripeSubscriptionId}:${cancellationEndsAt ?? "period_end_unknown"}`;
  return deterministicAuditEventId(
    canceledAt ? `${base}:requested:${canceledAt}` : base
  );
}

export function cancellationReversedAuditEventId(
  stripeSubscriptionId: string,
  reversedRequestId: string
): string {
  return deterministicAuditEventId(
    `cancellation_reversed:${stripeSubscriptionId}:${reversedRequestId}`
  );
}

/**
 * True when a cancellation_scheduled row recorded before request-scoped ids
 * already covers this request: same canceled_at in its metadata, or (with no
 * canceled_at recorded) created at or after this request's canceled_at.
 */
async function legacyCancellationAuditCoversRequest(
  admin: SupabaseClient,
  stripeSubscriptionId: string,
  canceledAt: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("ea_subscription_events")
    .select("id, created_at, metadata")
    .eq("event_type", "cancellation_scheduled")
    .contains("metadata", { stripe_subscription_id: stripeSubscriptionId });
  if (error) {
    throw new Error(
      `audit_event_lookup_failed:cancellation_scheduled:${error.code ?? "unknown"}`
    );
  }
  const requested = Date.parse(canceledAt);
  return ((data ?? []) as {
    created_at?: string | null;
    metadata?: Record<string, unknown> | null;
  }[]).some((row) => {
    const recorded = row.metadata?.canceled_at;
    if (typeof recorded === "string" && recorded) {
      return Date.parse(recorded) === requested;
    }
    const createdAt = row.created_at ? Date.parse(row.created_at) : NaN;
    return Number.isFinite(createdAt) && createdAt >= requested;
  });
}

/**
 * Exactly once per cancellation request (Stripe subscription, effective date
 * and canceled_at), on every delivery that sees the cancellation pending (not
 * only the first), so a retry after a failed insert still records it. The
 * primary key is derived from the request: repeats and concurrent deliveries
 * hit the primary key and count as recorded, without a migration. A new
 * request after a reversal has a new canceled_at, so it gets its own row.
 */
async function recordCancellationScheduledOnce(
  admin: SupabaseClient,
  input: {
    branchId: string;
    subscriptionRowId: string;
    cancellationEndsAt: string | null;
    cancellationRequestedAt: string | null;
    metadata: Record<string, unknown> & { stripe_subscription_id: string };
  }
): Promise<void> {
  if (
    input.cancellationRequestedAt &&
    (await legacyCancellationAuditCoversRequest(
      admin,
      input.metadata.stripe_subscription_id,
      input.cancellationRequestedAt
    ))
  ) {
    return;
  }
  await insertSubscriptionAuditEvent(
    admin,
    {
      id: cancellationScheduledAuditEventId(
        input.metadata.stripe_subscription_id,
        input.cancellationEndsAt,
        input.cancellationRequestedAt
      ),
      branch_id: input.branchId,
      subscription_id: input.subscriptionRowId,
      event_type: "cancellation_scheduled",
      actor_source: "webhook",
      metadata: {
        ...input.metadata,
        cancellation_effective_at: input.cancellationEndsAt,
      },
    },
    { uniqueViolationMeansRecorded: true }
  );
}

/**
 * Exactly once per Stripe subscription, whichever trialing webhook arrives first
 * (checkout.session.completed, customer.subscription.created/updated, the £0
 * invoice.paid). The unique index ea_subscription_events_trial_started_once_idx
 * is the guarantee; the lookup only avoids a failing insert on every update.
 */
async function recordTrialStartedOnce(
  admin: SupabaseClient,
  input: {
    branchId: string;
    subscriptionRowId: string;
    metadata: Record<string, unknown> & { stripe_subscription_id: string };
  }
): Promise<void> {
  const { data: recorded, error: lookupError } = await admin
    .from("ea_subscription_events")
    .select("id")
    .eq("event_type", "trial_started")
    .contains("metadata", {
      stripe_subscription_id: input.metadata.stripe_subscription_id,
    })
    .limit(1);
  if (!lookupError && (recorded ?? []).length > 0) return;

  await insertSubscriptionAuditEvent(
    admin,
    {
      branch_id: input.branchId,
      subscription_id: input.subscriptionRowId,
      event_type: "trial_started",
      actor_source: "webhook",
      metadata: input.metadata,
    },
    { uniqueViolationMeansRecorded: true }
  );
}

/**
 * Exceptional path only: £99 charged in Stripe but founding cannot be confirmed.
 * Cancels the Stripe subscription (stops ongoing founding billing without entitlement).
 * Does NOT auto-refund and does NOT create a £129 subscription.
 */
async function handleFoundingConfirmException(
  admin: SupabaseClient,
  input: {
    branchId: string;
    subscriptionRowId: string;
    stripeSubscription: Stripe.Subscription;
    confirmError: string;
  }
): Promise<void> {
  const stripe = getStripeClient();
  const { branchId, subscriptionRowId, stripeSubscription, confirmError } =
    input;

  try {
    if (
      stripeSubscription.status !== "canceled" &&
      stripeSubscription.status !== "incomplete_expired"
    ) {
      await stripe.subscriptions.cancel(stripeSubscription.id);
    }
  } catch {
    // Best-effort cancel; audit event still recorded for ops review.
  }

  await admin
    .from("ea_branch_subscriptions")
    .update({
      stripe_subscription_id: stripeSubscription.id,
      stripe_price_id:
        typeof stripeSubscription.items.data[0]?.price?.id === "string"
          ? stripeSubscription.items.data[0].price.id
          : null,
      stripe_status: "canceled",
      entitlement_status: "ended",
      ended_at: new Date().toISOString(),
      pricing_tier: "standard",
      amount_gbp_minor: amountGbpMinorForTier("standard"),
      founding_slot_number: null,
      stripe_checkout_session_id: null,
      cancel_at_period_end: false,
      cancelled_at: new Date().toISOString(),
      stripe_status_updated_at: new Date().toISOString(),
      stripe_object_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionRowId);

  const { error: exceptionEventError } = await admin
    .from("ea_subscription_events")
    .insert({
      branch_id: branchId,
      subscription_id: subscriptionRowId,
      event_type: "founding_reconcile_exception",
      actor_source: "webhook",
      metadata: {
        stripe_subscription_id: stripeSubscription.id,
        confirm_error: confirmError,
        action:
          "canceled_stripe_subscription_no_auto_refund_no_standard_rebill",
        note: "Manual ops review may issue an exceptional refund if appropriate.",
      },
    });

  if (exceptionEventError) {
    // Forward-safe if migration adding founding_reconcile_exception is not applied yet.
    await admin.from("ea_subscription_events").insert({
      branch_id: branchId,
      subscription_id: subscriptionRowId,
      event_type: "entitlement_changed",
      actor_source: "webhook",
      metadata: {
        stripe_subscription_id: stripeSubscription.id,
        confirm_error: confirmError,
        founding_reconcile_exception: true,
        action:
          "canceled_stripe_subscription_no_auto_refund_no_standard_rebill",
        note: "Manual ops review may issue an exceptional refund if appropriate.",
      },
    });
  }
}

async function loadSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.retrieve(subscriptionId);
}

export async function processStripeWebhookEvent(
  event: Stripe.Event,
  options?: ProcessStripeWebhookOptions
): Promise<{
  ok: boolean;
  duplicate?: boolean;
  error?: string;
  claimAction?: WebhookClaimAction;
}> {
  const admin = createServiceRoleSupabaseClient();
  const claim = await claimWebhookEvent(admin, event);

  if (claim.action === "already_succeeded") {
    // Terminal success only — failed events must NOT land here.
    return { ok: true, duplicate: true, claimAction: claim.action };
  }
  if (claim.action === "in_progress") {
    // Another worker holds a fresh lease — return non-success so Stripe retries.
    return { ok: false, error: "event_in_progress", claimAction: claim.action };
  }
  if (claim.action === "claim_failed") {
    return { ok: false, error: "event_claim_failed", claimAction: claim.action };
  }

  try {
    assertTestHooksAllowed(options);
    if (options?.simulateFailureAfterClaim) {
      throw new Error("simulated_failure_after_claim");
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!subId) break;
        const chronologyAt = stripeEventChronologyAt(event);
        let subscription = await loadSubscription(subId);
        // Attach metadata from session if subscription missing keys
        if (!subscription.metadata?.keynetic_branch_id && session.metadata) {
          const stripe = getStripeClient();
          await stripe.subscriptions.update(subId, {
            metadata: {
              ...subscription.metadata,
              ...session.metadata,
            },
          });
          subscription = await loadSubscription(subId);
        }
        await reconcileStripeSubscription(admin, subscription, {
          confirmFounding: subscription.status === "active",
          eventChronologyAt: chronologyAt,
        });
        await expireOtherCheckoutSessionsAfterLink(
          admin,
          getStripeClient(),
          subscription,
          { completedCheckoutSessionId: session.id, eventChronologyAt: chronologyAt }
        );
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const chronologyAt = stripeEventChronologyAt(event);
        await reconcileStripeSubscription(admin, subscription, {
          confirmFounding: subscription.status === "active",
          fromPaymentFailure: subscription.status === "past_due",
          eventChronologyAt: chronologyAt,
          previousAttributes: (event.data.previous_attributes ??
            null) as StripeCancellationPreviousAttributes | null,
        });
        await expireOtherCheckoutSessionsAfterLink(
          admin,
          getStripeClient(),
          subscription,
          { eventChronologyAt: chronologyAt }
        );
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await reconcileStripeSubscription(
          admin,
          {
            ...subscription,
            status: "canceled",
            cancel_at_period_end: false,
          } as Stripe.Subscription,
          {
            eventChronologyAt: stripeEventChronologyAt(event),
          }
        );
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = getInvoiceSubscriptionId(invoice);
        if (!subId) break;
        const subscription = await loadSubscription(subId);
        await reconcileStripeSubscription(admin, subscription, {
          confirmFounding: true,
          eventChronologyAt: stripeEventChronologyAt(event),
        });
        await recordInvoicePaymentSucceeded(admin, invoice, subscription);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = getInvoiceSubscriptionId(invoice);
        if (!subId) break;
        const subscription = await loadSubscription(subId);
        await reconcileStripeSubscription(admin, subscription, {
          fromPaymentFailure: true,
          eventChronologyAt: stripeEventChronologyAt(event),
          invoiceId: invoice.id,
        });
        break;
      }
      default:
        await finishWebhookEvent(admin, event.id, "ignored");
        return { ok: true, claimAction: "process" };
    }

    await finishWebhookEvent(admin, event.id, "processed");
    return { ok: true, claimAction: "process" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "webhook_processing_failed";
    await finishWebhookEvent(admin, event.id, "failed", message.slice(0, 500));
    return {
      ok: false,
      error: "processing_failed",
      claimAction: "process",
    };
  }
}
