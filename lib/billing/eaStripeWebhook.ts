import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  amountGbpMinorForTier,
  type EaPricingTier,
} from "@/lib/billing/eaBranchPricing";
import {
  computeGraceEndsAt,
  mapStripeSubscriptionToKeynetic,
} from "@/lib/billing/mapStripeStatus";
import { getStripeClient } from "@/lib/billing/stripeClient";
import { getStripeServerConfig } from "@/lib/billing/stripeServerConfig";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

function unixToIso(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
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
    (subscription as Stripe.Subscription & { current_period_start?: number })
      .current_period_start
  );
  const periodEnd = unixToIso(
    (subscription as Stripe.Subscription & { current_period_end?: number })
      .current_period_end
  );
  const periodEndDate = periodEnd ? new Date(periodEnd) : null;
  const mapped = mapStripeSubscriptionToKeynetic({
    stripeStatus: subscription.status,
    cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
    currentPeriodEnd: periodEndDate,
  });

  const chronologyAt = options.eventChronologyAt;
  const chronologyIso = chronologyAt.toISOString();

  // Load existing row for out-of-order guard (by row id when known, including ended).
  let existingQuery = admin
    .from("ea_branch_subscriptions")
    .select(
      "id, stripe_object_updated_at, entitlement_status, grace_ends_at, pricing_tier, founding_slot_number, ended_at"
    )
    .eq("branch_id", branchId)
    .is("ended_at", null);

  if (rowId) {
    existingQuery = admin
      .from("ea_branch_subscriptions")
      .select(
        "id, stripe_object_updated_at, entitlement_status, grace_ends_at, pricing_tier, founding_slot_number, ended_at"
      )
      .eq("id", rowId);
  }

  const { data: existing } = await existingQuery.maybeSingle();
  if (!existing) {
    return { applied: false, reason: "subscription_row_missing" };
  }

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

  const looksFoundingAttempt =
    priceId === config.foundingPriceId ||
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
    } else if (priceId === config.foundingPriceId) {
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
  } else if (priceId === config.foundingPriceId && !options.confirmFounding) {
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
    cancelled_at: mapped.cancelAtPeriodEnd
      ? new Date().toISOString()
      : null,
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

  let write = admin
    .from("ea_branch_subscriptions")
    .update(patch)
    .eq("id", existing.id);

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
    return { applied: false, reason: "stale_or_concurrent_lost" };
  }

  if (customerId && branchId) {
    await admin
      .from("ea_branches")
      .update({ stripe_customer_id: customerId })
      .eq("id", branchId)
      .is("stripe_customer_id", null);
  }

  const eventType =
    mapped.ended
      ? "subscription_expired"
      : mapped.enterGrace
        ? "payment_failed"
        : mapped.cancelAtPeriodEnd
          ? "cancellation_scheduled"
          : "payment_succeeded";

  await admin.from("ea_subscription_events").insert({
    branch_id: branchId,
    subscription_id: existing.id,
    event_type: eventType,
    actor_source: "webhook",
    metadata: {
      stripe_subscription_id: subscription.id,
      stripe_status: subscription.status,
      pricing_tier: pricingTier,
      event_chronology_at: chronologyIso,
    },
  });

  return { applied: true };
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
        const subscription = await loadSubscription(subId);
        // Attach metadata from session if subscription missing keys
        if (!subscription.metadata?.keynetic_branch_id && session.metadata) {
          const stripe = getStripeClient();
          await stripe.subscriptions.update(subId, {
            metadata: {
              ...subscription.metadata,
              ...session.metadata,
            },
          });
          const refreshed = await loadSubscription(subId);
          await reconcileStripeSubscription(admin, refreshed, {
            confirmFounding: refreshed.status === "active",
            eventChronologyAt: chronologyAt,
          });
        } else {
          await reconcileStripeSubscription(admin, subscription, {
            confirmFounding: subscription.status === "active",
            eventChronologyAt: chronologyAt,
          });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await reconcileStripeSubscription(admin, subscription, {
          confirmFounding: subscription.status === "active",
          fromPaymentFailure: subscription.status === "past_due",
          eventChronologyAt: stripeEventChronologyAt(event),
        });
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
