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

function stripeObjectUpdatedAt(subscription: Stripe.Subscription): Date {
  return new Date((subscription.created || 0) * 1000 > 0
    ? // Prefer latest invoice/period signal; Stripe updated field may exist on expand
      ((subscription as Stripe.Subscription & { current_period_end?: number })
        .current_period_end ||
        subscription.created) * 1000
    : Date.now());
}

async function claimWebhookEvent(
  admin: SupabaseClient,
  event: Stripe.Event
): Promise<"process" | "duplicate" | "claim_failed"> {
  const { error } = await admin.from("stripe_webhook_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    processing_status: "processing",
  });

  if (error) {
    if (error.code === "23505") {
      return "duplicate";
    }
    return "claim_failed";
  }
  return "process";
}

async function finishWebhookEvent(
  admin: SupabaseClient,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  errorMessage?: string
) {
  await admin
    .from("stripe_webhook_events")
    .update({
      processing_status: status,
      processed_at: new Date().toISOString(),
      error_message: errorMessage ?? null,
    })
    .eq("stripe_event_id", eventId);
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
  options?: { confirmFounding?: boolean; fromPaymentFailure?: boolean }
): Promise<void> {
  const config = getStripeServerConfig();
  const envMeta = subscription.metadata?.keynetic_env;
  if (envMeta && envMeta !== config.apiMode) {
    return;
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
    return;
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

  const objectUpdatedAt = stripeObjectUpdatedAt(subscription);

  // Load existing row for out-of-order guard
  let existingQuery = admin
    .from("ea_branch_subscriptions")
    .select(
      "id, stripe_object_updated_at, entitlement_status, grace_ends_at, pricing_tier, founding_slot_number"
    )
    .eq("branch_id", branchId)
    .is("ended_at", null);

  if (rowId) {
    existingQuery = admin
      .from("ea_branch_subscriptions")
      .select(
        "id, stripe_object_updated_at, entitlement_status, grace_ends_at, pricing_tier, founding_slot_number"
      )
      .eq("id", rowId);
  }

  const { data: existing } = await existingQuery.maybeSingle();
  if (!existing) {
    return;
  }

  if (existing.stripe_object_updated_at) {
    const known = new Date(existing.stripe_object_updated_at as string).getTime();
    if (objectUpdatedAt.getTime() + 1000 < known) {
      // Stale event — ignore
      return;
    }
  }

  const priceId =
    typeof subscription.items.data[0]?.price?.id === "string"
      ? subscription.items.data[0].price.id
      : null;

  let pricingTier =
    ids.pricingTier ||
    (existing.pricing_tier as EaPricingTier | null) ||
    "standard";
  if (priceId === config.foundingPriceId) pricingTier = "founding";
  if (priceId === config.standardPriceId) pricingTier = "standard";

  let graceEndsAt: string | null = (existing.grace_ends_at as string) ?? null;
  if (options?.fromPaymentFailure || mapped.enterGrace) {
    if (!graceEndsAt) {
      graceEndsAt = computeGraceEndsAt().toISOString();
    }
    // If grace already expired while still past_due, end entitlement for Stage 2 state
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
    stripe_object_updated_at: objectUpdatedAt.toISOString(),
    pricing_tier: pricingTier,
    amount_gbp_minor: amountGbpMinorForTier(pricingTier),
    founding_slot_number:
      pricingTier === "founding"
        ? existing.founding_slot_number
        : null,
    updated_at: new Date().toISOString(),
  };

  if (mapped.ended) {
    patch.ended_at = new Date().toISOString();
    patch.entitlement_status = "ended";
  } else {
    patch.ended_at = null;
  }

  await admin
    .from("ea_branch_subscriptions")
    .update(patch)
    .eq("id", existing.id);

  if (
    options?.confirmFounding &&
    pricingTier === "founding" &&
    mapped.entitlementStatus === "entitled"
  ) {
    await admin.rpc("confirm_ea_founding_slot", {
      p_branch_id: branchId,
      p_subscription_id: existing.id,
    });
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
    },
  });
}

async function loadSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.retrieve(subscriptionId);
}

export async function processStripeWebhookEvent(
  event: Stripe.Event
): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const admin = createServiceRoleSupabaseClient();
  const claim = await claimWebhookEvent(admin, event);
  if (claim === "duplicate") {
    return { ok: true, duplicate: true };
  }
  if (claim === "claim_failed") {
    return { ok: false, error: "event_claim_failed" };
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!subId) break;
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
          });
        } else {
          await reconcileStripeSubscription(admin, subscription, {
            confirmFounding: subscription.status === "active",
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
        });
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await reconcileStripeSubscription(admin, {
          ...subscription,
          status: "canceled",
          cancel_at_period_end: false,
        } as Stripe.Subscription);
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = getInvoiceSubscriptionId(invoice);
        if (!subId) break;
        const subscription = await loadSubscription(subId);
        await reconcileStripeSubscription(admin, subscription, {
          confirmFounding: true,
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
        });
        break;
      }
      default:
        await finishWebhookEvent(admin, event.id, "ignored");
        return { ok: true };
    }

    await finishWebhookEvent(admin, event.id, "processed");
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "webhook_processing_failed";
    await finishWebhookEvent(admin, event.id, "failed", message.slice(0, 500));
    return { ok: false, error: "processing_failed" };
  }
}
