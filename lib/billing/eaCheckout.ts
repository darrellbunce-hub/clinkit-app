import "server-only";

import { randomUUID } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthorisedBranchContext } from "@/lib/billing/eaBillingAuth";
import {
  amountGbpMinorForTier,
  type EaPricingTier,
} from "@/lib/billing/eaBranchPricing";
import { resolveEffectiveEntitlementStatus } from "@/lib/billing/eaBranchSubscription";
import { EA_FOUNDING_RESERVATION_SECONDS } from "@/lib/billing/eaFoundingAvailabilityShared";
import { getStripeClient } from "@/lib/billing/stripeClient";
import {
  getStripePriceIdForTier,
  getStripeServerConfig,
} from "@/lib/billing/stripeServerConfig";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

/** In-flight Checkout create marker stored in stripe_checkout_session_id until Stripe returns. */
const ATTEMPT_MARKER_PREFIX = "attempt:" as const;

export type CheckoutCreateResult =
  | {
      ok: true;
      url: string;
      pricingTier: EaPricingTier;
      reservationExpiresAt?: string | null;
    }
  | {
      ok: false;
      error: string;
      status: number;
      message?: string;
    };

type PricingSelection =
  | {
      ok: true;
      tier: EaPricingTier;
      foundingSlot: number | null;
      reservationExpiresAt: string | null;
    }
  | { ok: false; error: string; status: number; message?: string };

type OpenSubscriptionRow = {
  id: string;
  stripe_status: string | null;
  entitlement_status: string | null;
  stripe_checkout_session_id: string | null;
  pricing_tier: string | null;
  grace_ends_at: string | null;
  ended_at: string | null;
  stripe_price_id: string | null;
};

function isAttemptMarker(sessionId: string | null | undefined): boolean {
  return !!sessionId && sessionId.startsWith(ATTEMPT_MARKER_PREFIX);
}

type AttemptMarker = {
  attemptId: string;
  /** Fixed expires_at for founding Checkout — must not change on idempotent retry. */
  expiresAtUnix: number | null;
};

function formatAttemptMarker(marker: AttemptMarker): string {
  if (marker.expiresAtUnix != null) {
    return `${ATTEMPT_MARKER_PREFIX}${marker.attemptId}:${marker.expiresAtUnix}`;
  }
  return `${ATTEMPT_MARKER_PREFIX}${marker.attemptId}`;
}

function parseAttemptMarker(sessionId: string): AttemptMarker {
  const raw = sessionId.slice(ATTEMPT_MARKER_PREFIX.length);
  const colon = raw.lastIndexOf(":");
  if (colon > 0) {
    const maybeExpires = Number(raw.slice(colon + 1));
    if (Number.isFinite(maybeExpires) && maybeExpires > 1_000_000_000) {
      return {
        attemptId: raw.slice(0, colon),
        expiresAtUnix: maybeExpires,
      };
    }
  }
  return { attemptId: raw, expiresAtUnix: null };
}

function buildCheckoutAttemptKey(input: {
  branchId: string;
  subscriptionId: string;
  tier: EaPricingTier;
  attemptId: string;
}): string {
  // Stripe retains idempotency keys ≥24h. Attempt id scopes one logical create;
  // rotated only for a legitimate new attempt (not on every HTTP retry).
  return `ea-checkout-${input.branchId}-${input.subscriptionId}-${input.tier}-${input.attemptId}`;
}

async function ensureBranchStripeCustomer(
  admin: SupabaseClient,
  context: AuthorisedBranchContext
): Promise<string> {
  if (context.branchStripeCustomerId) {
    return context.branchStripeCustomerId;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create(
    {
      name: `${context.companyName} — branch`,
      email: context.user.email ?? undefined,
      metadata: {
        keynetic_branch_id: context.branchId,
        keynetic_company_id: context.companyId,
        keynetic_env: getStripeServerConfig().apiMode,
      },
    },
    {
      idempotencyKey: `ea-branch-customer-${context.branchId}`,
    }
  );

  const { data: updated, error } = await admin
    .from("ea_branches")
    .update({ stripe_customer_id: customer.id })
    .eq("id", context.branchId)
    .is("stripe_customer_id", null)
    .select("stripe_customer_id")
    .maybeSingle();

  if (!error && updated?.stripe_customer_id) {
    return updated.stripe_customer_id as string;
  }

  const { data: branch } = await admin
    .from("ea_branches")
    .select("stripe_customer_id")
    .eq("id", context.branchId)
    .single();

  if (branch?.stripe_customer_id) {
    return branch.stripe_customer_id as string;
  }

  await admin
    .from("ea_branches")
    .update({ stripe_customer_id: customer.id })
    .eq("id", context.branchId);

  return customer.id;
}

async function branchHasActiveFoundingReservation(
  admin: SupabaseClient,
  branchId: string
): Promise<{ active: boolean; expiresAt: string | null; slot: number | null }> {
  const { data } = await admin
    .from("ea_founding_slot_ledger")
    .select("slot_number, reservation_expires_at, state")
    .eq("branch_id", branchId)
    .eq("state", "reserved")
    .gt("reservation_expires_at", new Date().toISOString())
    .maybeSingle();

  if (!data) {
    return { active: false, expiresAt: null, slot: null };
  }

  return {
    active: true,
    expiresAt: (data.reservation_expires_at as string) ?? null,
    slot: typeof data.slot_number === "number" ? data.slot_number : null,
  };
}

async function expireOpenCheckoutSession(
  stripe: ReturnType<typeof getStripeClient>,
  sessionId: string | null | undefined
): Promise<void> {
  if (!sessionId || isAttemptMarker(sessionId)) return;
  try {
    const existing = await stripe.checkout.sessions.retrieve(sessionId);
    if (existing.status === "open") {
      await stripe.checkout.sessions.expire(sessionId);
    }
  } catch {
    /* ignore — session may already be expired/complete */
  }
}

async function selectPricingTier(input: {
  userClient: SupabaseClient;
  branchId: string;
  acceptStandardPricing: boolean;
}): Promise<PricingSelection> {
  const { userClient, branchId, acceptStandardPricing } = input;

  const reserve = await userClient.rpc("reserve_ea_founding_slot", {
    p_branch_id: branchId,
    p_reservation_seconds: EA_FOUNDING_RESERVATION_SECONDS,
  });

  if (
    reserve.data?.ok === true &&
    reserve.data.state === "confirmed" &&
    typeof reserve.data.slot_number === "number"
  ) {
    return {
      ok: true,
      tier: "founding",
      foundingSlot: reserve.data.slot_number as number,
      reservationExpiresAt: null,
    };
  }

  if (
    reserve.data?.ok === true &&
    typeof reserve.data.slot_number === "number"
  ) {
    return {
      ok: true,
      tier: "founding",
      foundingSlot: reserve.data.slot_number as number,
      reservationExpiresAt:
        typeof reserve.data.reservation_expires_at === "string"
          ? reserve.data.reservation_expires_at
          : null,
    };
  }

  if (reserve.data?.error === "founding_cohort_full") {
    if (!acceptStandardPricing) {
      return {
        ok: false,
        error: "founding_just_secured",
        status: 409,
        message:
          "The final founding place has just been secured. Keynetic is now £129/month. Confirm to continue at the standard price.",
      };
    }
    return {
      ok: true,
      tier: "standard",
      foundingSlot: null,
      reservationExpiresAt: null,
    };
  }

  if (reserve.error) {
    return { ok: false, error: "founding_reservation_failed", status: 500 };
  }

  if (!acceptStandardPricing) {
    return {
      ok: false,
      error: "founding_unavailable",
      status: 409,
      message:
        "Founding pricing is not available for this branch right now. Confirm to continue at £129/month.",
    };
  }

  return {
    ok: true,
    tier: "standard",
    foundingSlot: null,
    reservationExpiresAt: null,
  };
}

/**
 * Claim or reuse an in-flight Checkout attempt id on the open subscription row.
 * Stored as stripe_checkout_session_id = "attempt:{uuid}[:expiresAt]" until Stripe returns.
 */
async function claimCheckoutAttemptMarker(input: {
  admin: SupabaseClient;
  subscriptionId: string;
  existingSessionId: string | null;
  forceNewAttempt: boolean;
  expiresAtUnix: number | null;
}): Promise<AttemptMarker> {
  const { admin, subscriptionId, forceNewAttempt, expiresAtUnix } = input;
  const existing = input.existingSessionId;

  if (!forceNewAttempt && isAttemptMarker(existing)) {
    return parseAttemptMarker(existing!);
  }

  const attemptId = randomUUID();
  const marker = formatAttemptMarker({ attemptId, expiresAtUnix });

  let claim = admin
    .from("ea_branch_subscriptions")
    .update({
      stripe_checkout_session_id: marker,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId);

  if (!existing) {
    claim = claim.is("stripe_checkout_session_id", null);
  } else {
    claim = claim.eq("stripe_checkout_session_id", existing);
  }

  const { data: claimed } = await claim
    .select("stripe_checkout_session_id")
    .maybeSingle();

  if (isAttemptMarker(claimed?.stripe_checkout_session_id as string | null)) {
    return parseAttemptMarker(claimed!.stripe_checkout_session_id as string);
  }

  const { data: raced } = await admin
    .from("ea_branch_subscriptions")
    .select("stripe_checkout_session_id")
    .eq("id", subscriptionId)
    .single();

  const racedId = raced?.stripe_checkout_session_id as string | null;
  if (isAttemptMarker(racedId)) {
    return parseAttemptMarker(racedId!);
  }

  return { attemptId, expiresAtUnix };
}

export async function createEaBranchCheckoutSession(input: {
  userClient: SupabaseClient;
  context: AuthorisedBranchContext;
  /** Customer consciously accepts £129 after founding is unavailable. */
  acceptStandardPricing?: boolean;
}): Promise<CheckoutCreateResult> {
  const { userClient, context } = input;
  const acceptStandardPricing = input.acceptStandardPricing === true;
  const admin = createServiceRoleSupabaseClient();
  const config = getStripeServerConfig();
  const stripe = getStripeClient();

  // Defence in depth: smoke-test fixture branches must never enter Checkout / founding.
  const { data: isSmokeBranch } = await admin.rpc("is_smoke_test_ea_branch", {
    p_branch_id: context.branchId,
  });
  if (isSmokeBranch === true) {
    return {
      ok: false,
      error: "smoke_test_fixture_checkout_forbidden",
      status: 403,
      message:
        "This branch is a Production smoke-test fixture and cannot start Checkout.",
    };
  }

  const { data: openSub } = await admin
    .from("ea_branch_subscriptions")
    .select(
      "id, stripe_status, entitlement_status, stripe_checkout_session_id, pricing_tier, grace_ends_at, ended_at, stripe_price_id"
    )
    .eq("branch_id", context.branchId)
    .is("ended_at", null)
    .maybeSingle();

  let activeOpen = openSub as OpenSubscriptionRow | null;

  if (
    activeOpen &&
    activeOpen.entitlement_status === "grace" &&
    activeOpen.grace_ends_at &&
    new Date(activeOpen.grace_ends_at as string).getTime() <= Date.now()
  ) {
    const applied = await admin.rpc("apply_ea_branch_grace_expiry_if_due", {
      p_subscription_id: activeOpen.id,
    });
    if (applied.error) {
      await admin
        .from("ea_branch_subscriptions")
        .update({
          entitlement_status: "ended",
          ended_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", activeOpen.id as string)
        .eq("entitlement_status", "grace")
        .is("ended_at", null)
        .lte("grace_ends_at", new Date().toISOString());
    }
    const { data: refreshed } = await admin
      .from("ea_branch_subscriptions")
      .select(
        "id, stripe_status, entitlement_status, stripe_checkout_session_id, pricing_tier, grace_ends_at, ended_at, stripe_price_id"
      )
      .eq("id", activeOpen.id as string)
      .maybeSingle();

    if (!refreshed || refreshed.ended_at) {
      activeOpen = null;
    } else {
      activeOpen = refreshed as OpenSubscriptionRow;
    }
  }

  if (activeOpen) {
    const effective = resolveEffectiveEntitlementStatus({
      entitlementStatus: activeOpen.entitlement_status as
        | "none"
        | "entitled"
        | "grace"
        | "ended",
      graceEndsAt: (activeOpen.grace_ends_at as string | null) ?? null,
    });

    if (effective === "entitled" || effective === "grace") {
      return { ok: false, error: "already_subscribed", status: 409 };
    }

    if (
      effective !== "ended" &&
      (activeOpen.stripe_status === "active" ||
        activeOpen.stripe_status === "past_due" ||
        activeOpen.stripe_status === "trialing")
    ) {
      return { ok: false, error: "already_subscribed", status: 409 };
    }
  }

  let forceNewAttempt = false;

  // Reuse open Checkout only while still valid for the reserved founding hold.
  if (
    activeOpen?.stripe_status === "checkout_pending" &&
    activeOpen.stripe_checkout_session_id &&
    !isAttemptMarker(activeOpen.stripe_checkout_session_id)
  ) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(
        activeOpen.stripe_checkout_session_id as string
      );
      const tier =
        (activeOpen.pricing_tier as EaPricingTier) ?? "standard";
      const sessionOpen = existing.status === "open" && !!existing.url;
      const sessionNotExpired =
        !existing.expires_at || existing.expires_at * 1000 > Date.now();

      if (sessionOpen && sessionNotExpired) {
        if (tier === "founding") {
          const hold = await branchHasActiveFoundingReservation(
            admin,
            context.branchId
          );
          if (hold.active && existing.url) {
            return {
              ok: true,
              url: existing.url,
              pricingTier: "founding",
              reservationExpiresAt: hold.expiresAt,
            };
          }
          await expireOpenCheckoutSession(
            stripe,
            activeOpen.stripe_checkout_session_id as string
          );
          await admin
            .from("ea_branch_subscriptions")
            .update({
              stripe_checkout_session_id: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", activeOpen.id as string);
          activeOpen = {
            ...activeOpen,
            stripe_checkout_session_id: null,
          };
          forceNewAttempt = true;
        } else if (existing.url) {
          return {
            ok: true,
            url: existing.url,
            pricingTier: "standard",
          };
        }
      } else {
        if (existing.status === "open") {
          await expireOpenCheckoutSession(
            stripe,
            activeOpen.stripe_checkout_session_id as string
          );
        }
        await admin
          .from("ea_branch_subscriptions")
          .update({
            stripe_checkout_session_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", activeOpen.id as string);
        activeOpen = {
          ...activeOpen,
          stripe_checkout_session_id: null,
        };
        forceNewAttempt = true;
      }
    } catch {
      await admin
        .from("ea_branch_subscriptions")
        .update({
          stripe_checkout_session_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", activeOpen.id as string);
      activeOpen = {
        ...activeOpen,
        stripe_checkout_session_id: null,
      };
      forceNewAttempt = true;
    }
  }

  const pricing = await selectPricingTier({
    userClient,
    branchId: context.branchId,
    acceptStandardPricing,
  });
  if (!pricing.ok) {
    return {
      ok: false,
      error: pricing.error,
      status: pricing.status,
      message: pricing.message,
    };
  }

  const customerId = await ensureBranchStripeCustomer(admin, context);
  const priceId = getStripePriceIdForTier(pricing.tier);
  const amount = amountGbpMinorForTier(pricing.tier);

  let subscriptionId = activeOpen?.id as string | undefined;

  if (!subscriptionId) {
    const { data: inserted, error: insertError } = await admin
      .from("ea_branch_subscriptions")
      .insert({
        branch_id: context.branchId,
        stripe_customer_id: customerId,
        pricing_tier: pricing.tier,
        amount_gbp_minor: amount,
        founding_slot_number: pricing.foundingSlot,
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        currency: "gbp",
      })
      .select("id, stripe_checkout_session_id")
      .single();

    if (insertError || !inserted) {
      const { data: raced } = await admin
        .from("ea_branch_subscriptions")
        .select("id, stripe_checkout_session_id")
        .eq("branch_id", context.branchId)
        .is("ended_at", null)
        .maybeSingle();
      if (!raced) {
        return { ok: false, error: "subscription_create_failed", status: 500 };
      }
      subscriptionId = raced.id as string;
      activeOpen = {
        ...(activeOpen ?? {
          stripe_status: "checkout_pending",
          entitlement_status: "none",
          pricing_tier: pricing.tier,
          grace_ends_at: null,
          ended_at: null,
          stripe_price_id: null,
        }),
        id: raced.id as string,
        stripe_checkout_session_id:
          (raced.stripe_checkout_session_id as string | null) ?? null,
      };
      await admin
        .from("ea_branch_subscriptions")
        .update({
          stripe_customer_id: customerId,
          pricing_tier: pricing.tier,
          amount_gbp_minor: amount,
          founding_slot_number: pricing.foundingSlot,
          stripe_status: "checkout_pending",
          entitlement_status: "none",
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscriptionId);
    } else {
      subscriptionId = inserted.id as string;
      activeOpen = {
        id: inserted.id as string,
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        stripe_checkout_session_id:
          (inserted.stripe_checkout_session_id as string | null) ?? null,
        pricing_tier: pricing.tier,
        grace_ends_at: null,
        ended_at: null,
        stripe_price_id: null,
      };
    }
  } else {
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_customer_id: customerId,
        pricing_tier: pricing.tier,
        amount_gbp_minor: amount,
        founding_slot_number: pricing.foundingSlot,
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscriptionId);
  }

  // Reload before create — another request may have finished Checkout.
  const { data: beforeCreate } = await admin
    .from("ea_branch_subscriptions")
    .select("stripe_checkout_session_id, pricing_tier")
    .eq("id", subscriptionId!)
    .single();

  const beforeSessionId =
    (beforeCreate?.stripe_checkout_session_id as string | null) ?? null;

  if (beforeSessionId && !isAttemptMarker(beforeSessionId)) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(beforeSessionId);
      if (
        existing.status === "open" &&
        existing.url &&
        (!existing.expires_at || existing.expires_at * 1000 > Date.now())
      ) {
        const tier =
          (beforeCreate?.pricing_tier as EaPricingTier) ?? pricing.tier;
        if (tier === "founding") {
          const hold = await branchHasActiveFoundingReservation(
            admin,
            context.branchId
          );
          if (hold.active) {
            return {
              ok: true,
              url: existing.url,
              pricingTier: "founding",
              reservationExpiresAt: hold.expiresAt,
            };
          }
        } else {
          return {
            ok: true,
            url: existing.url,
            pricingTier: "standard",
          };
        }
      }
    } catch {
      /* fall through */
    }
  }

  // Tier change vs in-flight marker requires a new attempt.
  if (
    isAttemptMarker(beforeSessionId) &&
    activeOpen?.pricing_tier &&
    activeOpen.pricing_tier !== pricing.tier
  ) {
    forceNewAttempt = true;
  }

  const plannedExpiresAtUnix =
    pricing.tier === "founding"
      ? Math.floor(Date.now() / 1000) + EA_FOUNDING_RESERVATION_SECONDS
      : null;

  const attemptMarker = await claimCheckoutAttemptMarker({
    admin,
    subscriptionId: subscriptionId!,
    existingSessionId: beforeSessionId,
    forceNewAttempt,
    expiresAtUnix: plannedExpiresAtUnix,
  });

  const attemptKey = buildCheckoutAttemptKey({
    branchId: context.branchId,
    subscriptionId: subscriptionId!,
    tier: pricing.tier,
    attemptId: attemptMarker.attemptId,
  });

  const successUrl = `${config.appUrl}/account?billing=success&branch=${context.branchId}#subscription`;
  const cancelUrl = `${config.appUrl}/account?billing=cancelled&branch=${context.branchId}#subscription`;

  // Must match the first create for this attempt (Stripe idempotency param equality).
  const expiresAtUnix =
    attemptMarker.expiresAtUnix ?? plannedExpiresAtUnix;

  const sessionCreateParams: Parameters<
    typeof stripe.checkout.sessions.create
  >[0] = {
    mode: "subscription",
    customer: customerId,
    client_reference_id: context.branchId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      keynetic_company_id: context.companyId,
      keynetic_branch_id: context.branchId,
      keynetic_subscription_id: subscriptionId!,
      keynetic_pricing_tier: pricing.tier,
      keynetic_env: config.apiMode,
    },
    subscription_data: {
      metadata: {
        keynetic_company_id: context.companyId,
        keynetic_branch_id: context.branchId,
        keynetic_subscription_id: subscriptionId!,
        keynetic_pricing_tier: pricing.tier,
        keynetic_env: config.apiMode,
      },
    },
  };

  if (pricing.tier === "founding" && expiresAtUnix != null) {
    sessionCreateParams.expires_at = expiresAtUnix;
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create(sessionCreateParams, {
      idempotencyKey: attemptKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const keepMarkerForRetry =
      (error instanceof Error && error.name === "StripeConnectionError") ||
      /timeout|ECONNRESET|ETIMEDOUT|network/i.test(message);

    if (!keepMarkerForRetry) {
      await admin
        .from("ea_branch_subscriptions")
        .update({
          stripe_checkout_session_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscriptionId!)
        .eq(
          "stripe_checkout_session_id",
          formatAttemptMarker(attemptMarker)
        );
    }

    return {
      ok: false,
      error: "checkout_unavailable",
      status: 503,
      message: "Checkout could not be started. Please try again.",
    };
  }

  if (!session.url) {
    return { ok: false, error: "checkout_session_url_missing", status: 500 };
  }

  await admin
    .from("ea_branch_subscriptions")
    .update({
      stripe_checkout_session_id: session.id,
      stripe_price_id: priceId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId!);

  await admin.from("ea_subscription_events").insert({
    branch_id: context.branchId,
    subscription_id: subscriptionId!,
    event_type: "subscription_started",
    actor_source: "user",
    metadata: {
      checkout_session_id: session.id,
      pricing_tier: pricing.tier,
      reservation_expires_at: pricing.reservationExpiresAt,
      checkout_expires_at:
        pricing.tier === "founding" && expiresAtUnix != null
          ? new Date(expiresAtUnix * 1000).toISOString()
          : null,
      checkout_attempt_id: attemptMarker.attemptId,
      checkout_expires_at_unix: expiresAtUnix,
    },
  });

  return {
    ok: true,
    url: session.url,
    pricingTier: pricing.tier,
    reservationExpiresAt: pricing.reservationExpiresAt,
  };
}
