import "server-only";

import { randomUUID } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthorisedBranchContext } from "@/lib/billing/eaBillingAuth";
import {
  amountGbpMinorForTier,
  EA_TRIAL_PERIOD_DAYS,
  type EaPricingTier,
} from "@/lib/billing/eaBranchPricing";
import { resolveEffectiveEntitlementStatus } from "@/lib/billing/eaBranchSubscription";
import {
  expireBranchCheckoutSession,
  expireOutstandingCheckoutSessions,
  type OutstandingSessionReport,
} from "@/lib/billing/eaCheckoutSessionExpiry";
import {
  blockedCheckoutResponse,
  decideCheckoutFromSubscriptionHistory,
  type StripeSubscriptionSummary,
} from "@/lib/billing/eaCheckoutSubscriptionGuard";
import { getStripeClient } from "@/lib/billing/stripeClient";
import { getStripeServerConfig } from "@/lib/billing/stripeServerConfig";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

/** In-flight Checkout create marker stored in stripe_checkout_session_id until Stripe returns. */
const ATTEMPT_MARKER_PREFIX = "attempt:" as const;

/** New subscriptions are always standard; founding is historical only. */
const NEW_SUBSCRIPTION_TIER: EaPricingTier = "standard";

/**
 * Checkout offer stamped into session metadata. An open session is only reused
 * when its offer matches, so sessions created under older pricing are never resumed.
 */
type CheckoutOffer = "standard_trial_30d" | "standard_no_trial";

export type CheckoutCreateResult =
  | {
      ok: true;
      url: string;
      pricingTier: EaPricingTier;
      trialPeriodDays: number | null;
    }
  | {
      ok: false;
      error: string;
      status: number;
      message?: string;
    };

type OpenSubscriptionRow = {
  id: string;
  stripe_status: string | null;
  entitlement_status: string | null;
  stripe_checkout_session_id: string | null;
  pricing_tier: string | null;
  grace_ends_at: string | null;
  ended_at: string | null;
  stripe_price_id: string | null;
  stripe_subscription_id: string | null;
};

function isAttemptMarker(sessionId: string | null | undefined): boolean {
  return !!sessionId && sessionId.startsWith(ATTEMPT_MARKER_PREFIX);
}

type AttemptMarker = {
  attemptId: string;
  /** Legacy founding Checkout expiry; still parsed from markers written before the trial offer. */
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
  offer: CheckoutOffer;
  attemptId: string;
}): string {
  // Stripe retains idempotency keys ≥24h. Attempt id scopes one logical create;
  // rotated only for a legitimate new attempt (not on every HTTP retry).
  // The offer is part of the key so an attempt started under older Checkout
  // parameters can never collide with a trial-configured create.
  return `ea-checkout-${input.branchId}-${input.subscriptionId}-${input.tier}-${input.offer}-${input.attemptId}`;
}

function checkoutSessionMatchesOffer(
  session: { metadata?: Record<string, string> | null },
  offer: CheckoutOffer
): boolean {
  return session.metadata?.keynetic_checkout_offer === offer;
}

const CHECKOUT_PROCESSING_MESSAGE =
  "Your Checkout is complete and we're confirming your subscription with Stripe. This usually takes a few seconds — please refresh shortly.";

const SUBSCRIPTION_CHECK_UNAVAILABLE_MESSAGE =
  "We couldn't confirm your subscription history with Stripe. Please try again in a moment.";

const CHECKOUT_SESSION_EXPIRY_FAILED_MESSAGE =
  "We couldn't close an earlier Checkout for this branch with Stripe, so a new one can't be started. Please try again shortly or contact support.";

const STRIPE_SUBSCRIPTION_EXISTS_MESSAGE =
  "This branch already has a subscription with Stripe, so a new one can't be started. Please use Manage billing or contact support and we'll sort it out.";

function checkoutProcessingResult(): CheckoutCreateResult {
  return {
    ok: false,
    error: "checkout_processing",
    status: 409,
    message: CHECKOUT_PROCESSING_MESSAGE,
  };
}

function isStripeResourceMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "resource_missing"
  );
}

/**
 * Lists every subscription (all statuses, all pages) on the branch's own
 * server-managed Stripe Customer. Throws on any Stripe error so callers fail
 * closed: no Checkout is created when history cannot be established.
 */
async function loadStripeSubscriptionHistory(
  stripe: ReturnType<typeof getStripeClient>,
  branchStripeCustomerId: string
): Promise<StripeSubscriptionSummary[]> {
  const subscriptions: StripeSubscriptionSummary[] = [];
  for await (const subscription of stripe.subscriptions.list({
    customer: branchStripeCustomerId,
    status: "all",
    limit: 100,
  })) {
    subscriptions.push({
      id: subscription.id,
      status: subscription.status,
      metadataSubscriptionRowId:
        subscription.metadata?.keynetic_subscription_id || null,
      metadataBranchId: subscription.metadata?.keynetic_branch_id || null,
    });
  }
  return subscriptions;
}

/**
 * Database evidence for one-trial-per-branch: any row (open or ended, any tier)
 * that was ever linked to a Stripe subscription. Rows are never deleted.
 */
async function branchHasDatabaseSubscriptionHistory(
  admin: SupabaseClient,
  branchId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("ea_branch_subscriptions")
    .select("id")
    .eq("branch_id", branchId)
    .not("stripe_subscription_id", "is", null)
    .limit(1);
  if (error) {
    throw new Error("subscription_history_unavailable");
  }
  return (data ?? []).length > 0;
}

/**
 * Stripe holds a billable subscription the database does not reflect. Checkout is
 * refused; this records what ops need to reconcile (never cancels anything).
 * Deduped per Stripe subscription per day so repeated clicks do not flood alerts.
 */
async function reportStripeSubscriptionConflict(
  admin: SupabaseClient,
  input: {
    branchId: string;
    openRow: OpenSubscriptionRow | null;
    blocking: StripeSubscriptionSummary[];
    reason:
      | "stripe_subscription_exists_without_matching_db_row"
      | "outstanding_checkout_session_expiry_failed";
    outstandingSessions: OutstandingSessionReport;
  }
): Promise<void> {
  const primary = input.blocking[0]!;
  const details = {
    reason: input.reason,
    outstanding_checkout_sessions: input.outstandingSessions,
    stripe_subscriptions: input.blocking.map((s) => ({
      stripe_subscription_id: s.id,
      stripe_status: s.status,
      metadata_subscription_row_id: s.metadataSubscriptionRowId,
      metadata_branch_matches:
        s.metadataBranchId === null ? null : s.metadataBranchId === input.branchId,
    })),
    db_open_row_id: input.openRow?.id ?? null,
    db_open_row_stripe_status: input.openRow?.stripe_status ?? null,
    db_open_row_entitlement_status: input.openRow?.entitlement_status ?? null,
    db_open_row_stripe_subscription_id:
      input.openRow?.stripe_subscription_id ?? null,
  };

  console.error("[billing-reconcile] Checkout blocked: Stripe subscription exists", {
    branch_id: input.branchId,
    ...details,
  });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await admin
    .from("ea_subscription_events")
    .select("id")
    .eq("branch_id", input.branchId)
    .eq("event_type", "billing_reconcile_required")
    .contains("metadata", { primary_stripe_subscription_id: primary.id })
    .gte("created_at", since)
    .limit(1);
  if (!recentError && (recent ?? []).length > 0) return;

  const { error } = await admin.from("ea_subscription_events").insert({
    branch_id: input.branchId,
    subscription_id: input.openRow?.id ?? null,
    event_type: "billing_reconcile_required",
    actor_source: "system",
    metadata: { primary_stripe_subscription_id: primary.id, ...details },
  });
  if (error) {
    console.error("[billing-audit] ea_subscription_events insert failed", {
      event_type: "billing_reconcile_required",
      branch_id: input.branchId,
      stripe_subscription_id: primary.id,
      code: error.code ?? null,
      message: error.message,
    });
  }
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
  context: AuthorisedBranchContext;
}): Promise<CheckoutCreateResult> {
  const { context } = input;
  const admin = createServiceRoleSupabaseClient();
  const config = getStripeServerConfig();
  const stripe = getStripeClient();

  // Defence in depth: smoke-test fixture branches must never enter Checkout.
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
      "id, stripe_status, entitlement_status, stripe_checkout_session_id, pricing_tier, grace_ends_at, ended_at, stripe_price_id, stripe_subscription_id"
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
        "id, stripe_status, entitlement_status, stripe_checkout_session_id, pricing_tier, grace_ends_at, ended_at, stripe_price_id, stripe_subscription_id"
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

  // A completed Checkout whose webhook has not landed yet must not start another
  // subscription: keep its session id and report that confirmation is in progress.
  let existingSession: Awaited<
    ReturnType<typeof stripe.checkout.sessions.retrieve>
  > | null = null;
  const pendingSessionId =
    activeOpen?.stripe_status === "checkout_pending" &&
    activeOpen.stripe_checkout_session_id &&
    !isAttemptMarker(activeOpen.stripe_checkout_session_id)
      ? (activeOpen.stripe_checkout_session_id as string)
      : null;

  if (pendingSessionId) {
    try {
      existingSession = await stripe.checkout.sessions.retrieve(
        pendingSessionId
      );
    } catch (error) {
      if (!isStripeResourceMissing(error)) {
        return {
          ok: false,
          error: "checkout_unavailable",
          status: 503,
          message: "Checkout could not be started. Please try again.",
        };
      }
    }
    if (existingSession?.status === "complete") {
      return checkoutProcessingResult();
    }
  }

  const customerId = await ensureBranchStripeCustomer(admin, context);

  // Stripe is checked before any Checkout is created or reused, so a database row
  // that wrongly shows ended (or no row at all) can never lead to a second
  // subscription. Any Stripe or database error fails closed.
  let stripeSubscriptions: StripeSubscriptionSummary[];
  let databaseHistory: boolean;
  try {
    stripeSubscriptions = await loadStripeSubscriptionHistory(
      stripe,
      customerId
    );
    databaseHistory = await branchHasDatabaseSubscriptionHistory(
      admin,
      context.branchId
    );
  } catch {
    return {
      ok: false,
      error: "subscription_check_unavailable",
      status: 503,
      message: SUBSCRIPTION_CHECK_UNAVAILABLE_MESSAGE,
    };
  }

  const decision = decideCheckoutFromSubscriptionHistory({
    stripeSubscriptions,
    databaseHistory,
    openRow: activeOpen,
  });
  if (decision.kind === "checkout_processing") {
    return checkoutProcessingResult();
  }
  if (decision.kind === "blocked") {
    const outstanding = await expireOutstandingCheckoutSessions(
      stripe,
      { branchId: context.branchId, customerId },
      { storedSession: existingSession }
    );
    const response = blockedCheckoutResponse({
      outcomes: outstanding.sessions.map((s) => s.outcome),
      listingFailed: outstanding.listing_failed,
    });
    const expiryFailed = response === "checkout_session_expiry_failed";

    if (decision.reportConflict || expiryFailed) {
      await reportStripeSubscriptionConflict(admin, {
        branchId: context.branchId,
        openRow: activeOpen,
        blocking: decision.blocking,
        reason: expiryFailed
          ? "outstanding_checkout_session_expiry_failed"
          : "stripe_subscription_exists_without_matching_db_row",
        outstandingSessions: outstanding,
      });
    }
    if (expiryFailed) {
      return {
        ok: false,
        error: "checkout_session_expiry_failed",
        status: 503,
        message: CHECKOUT_SESSION_EXPIRY_FAILED_MESSAGE,
      };
    }
    if (response === "checkout_processing") {
      return checkoutProcessingResult();
    }
    return {
      ok: false,
      error: "stripe_subscription_exists",
      status: 409,
      message: STRIPE_SUBSCRIPTION_EXISTS_MESSAGE,
    };
  }

  const trialEligible = decision.trialEligible;
  const offer: CheckoutOffer = trialEligible
    ? "standard_trial_30d"
    : "standard_no_trial";
  const trialPeriodDays = trialEligible ? EA_TRIAL_PERIOD_DAYS : null;
  const tier = NEW_SUBSCRIPTION_TIER;

  let forceNewAttempt = false;

  // Reuse an open Checkout only when it was created for the current offer;
  // sessions from older pricing (including founding) are expired and replaced.
  if (activeOpen && pendingSessionId) {
    const sessionOpen =
      existingSession?.status === "open" && !!existingSession.url;
    const sessionNotExpired =
      !existingSession?.expires_at ||
      existingSession.expires_at * 1000 > Date.now();

    if (
      existingSession &&
      sessionOpen &&
      sessionNotExpired &&
      activeOpen.pricing_tier === tier &&
      checkoutSessionMatchesOffer(existingSession, offer) &&
      existingSession.url
    ) {
      return {
        ok: true,
        url: existingSession.url,
        pricingTier: tier,
        trialPeriodDays,
      };
    }

    // A replaced session must be confirmed expired before a new one exists,
    // otherwise both could be paid and create two subscriptions.
    if (existingSession) {
      const outcome = await expireBranchCheckoutSession(
        stripe,
        existingSession,
        { branchId: context.branchId, customerId }
      );
      if (outcome === "completed") {
        return checkoutProcessingResult();
      }
      if (outcome === "failed" || outcome === "foreign") {
        if (outcome === "foreign") {
          console.error(
            "[billing-checkout] stored Checkout session does not belong to this branch",
            {
              branch_id: context.branchId,
              checkout_session_id: existingSession.id,
            }
          );
        }
        return {
          ok: false,
          error: "checkout_session_expiry_failed",
          status: 503,
          message: CHECKOUT_SESSION_EXPIRY_FAILED_MESSAGE,
        };
      }
    }
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_checkout_session_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeOpen.id as string)
      .eq("stripe_checkout_session_id", pendingSessionId);
    activeOpen = {
      ...activeOpen,
      stripe_checkout_session_id: null,
    };
    forceNewAttempt = true;
  }

  const priceId = config.standardPriceId;
  const amount = amountGbpMinorForTier(tier);

  let subscriptionId = activeOpen?.id as string | undefined;

  if (!subscriptionId) {
    const { data: inserted, error: insertError } = await admin
      .from("ea_branch_subscriptions")
      .insert({
        branch_id: context.branchId,
        stripe_customer_id: customerId,
        pricing_tier: tier,
        amount_gbp_minor: amount,
        founding_slot_number: null,
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
          pricing_tier: tier,
          grace_ends_at: null,
          ended_at: null,
          stripe_price_id: null,
          stripe_subscription_id: null,
        }),
        id: raced.id as string,
        stripe_checkout_session_id:
          (raced.stripe_checkout_session_id as string | null) ?? null,
      };
      await admin
        .from("ea_branch_subscriptions")
        .update({
          stripe_customer_id: customerId,
          pricing_tier: tier,
          amount_gbp_minor: amount,
          founding_slot_number: null,
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
        pricing_tier: tier,
        grace_ends_at: null,
        ended_at: null,
        stripe_price_id: null,
        stripe_subscription_id: null,
      };
    }
  } else {
    // Conditional on the status read above so a webhook that has just linked
    // the Stripe subscription (e.g. trialing) is never overwritten.
    let resetQuery = admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_customer_id: customerId,
        pricing_tier: tier,
        amount_gbp_minor: amount,
        founding_slot_number: null,
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscriptionId)
      .is("ended_at", null);
    resetQuery = activeOpen?.stripe_status
      ? resetQuery.eq("stripe_status", activeOpen.stripe_status)
      : resetQuery.is("stripe_status", null);
    const { data: reset, error: resetError } = await resetQuery
      .select("id")
      .maybeSingle();
    if (resetError) {
      return { ok: false, error: "subscription_update_failed", status: 500 };
    }
    if (!reset) {
      return checkoutProcessingResult();
    }
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
    let existing: Awaited<
      ReturnType<typeof stripe.checkout.sessions.retrieve>
    > | null = null;
    try {
      existing = await stripe.checkout.sessions.retrieve(beforeSessionId);
    } catch (error) {
      if (!isStripeResourceMissing(error)) {
        return {
          ok: false,
          error: "checkout_unavailable",
          status: 503,
          message: "Checkout could not be started. Please try again.",
        };
      }
    }
    if (existing?.status === "complete") {
      return checkoutProcessingResult();
    }
    if (
      existing &&
      existing.status === "open" &&
      existing.url &&
      (!existing.expires_at || existing.expires_at * 1000 > Date.now()) &&
      ((beforeCreate?.pricing_tier as EaPricingTier | null) ?? tier) === tier &&
      checkoutSessionMatchesOffer(existing, offer)
    ) {
      return {
        ok: true,
        url: existing.url,
        pricingTier: tier,
        trialPeriodDays,
      };
    }
  }

  // Tier change vs in-flight marker requires a new attempt.
  if (
    isAttemptMarker(beforeSessionId) &&
    activeOpen?.pricing_tier &&
    activeOpen.pricing_tier !== tier
  ) {
    forceNewAttempt = true;
  }

  const attemptMarker = await claimCheckoutAttemptMarker({
    admin,
    subscriptionId: subscriptionId!,
    existingSessionId: beforeSessionId,
    forceNewAttempt,
    expiresAtUnix: null,
  });

  const attemptKey = buildCheckoutAttemptKey({
    branchId: context.branchId,
    subscriptionId: subscriptionId!,
    tier,
    offer,
    attemptId: attemptMarker.attemptId,
  });

  const successUrl = `${config.appUrl}/account?billing=success&branch=${context.branchId}#subscription`;
  const cancelUrl = `${config.appUrl}/account?billing=cancelled&branch=${context.branchId}#subscription`;

  const sessionCreateParams: Parameters<
    typeof stripe.checkout.sessions.create
  >[0] = {
    mode: "subscription",
    customer: customerId,
    client_reference_id: context.branchId,
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_collection: "always",
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      keynetic_company_id: context.companyId,
      keynetic_branch_id: context.branchId,
      keynetic_subscription_id: subscriptionId!,
      keynetic_pricing_tier: tier,
      keynetic_checkout_offer: offer,
      keynetic_env: config.apiMode,
    },
    subscription_data: {
      metadata: {
        keynetic_company_id: context.companyId,
        keynetic_branch_id: context.branchId,
        keynetic_subscription_id: subscriptionId!,
        keynetic_pricing_tier: tier,
        keynetic_checkout_offer: offer,
        keynetic_env: config.apiMode,
      },
      ...(trialPeriodDays != null
        ? {
            trial_period_days: trialPeriodDays,
            trial_settings: {
              end_behavior: { missing_payment_method: "cancel" as const },
            },
          }
        : {}),
    },
  };

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

  // Only replace our own in-flight marker (or the same session from a concurrent
  // duplicate request). If a webhook linked a subscription meanwhile, or another
  // attempt superseded ours, the new session must not stay usable.
  const { data: stored, error: storeError } = await admin
    .from("ea_branch_subscriptions")
    .update({
      stripe_checkout_session_id: session.id,
      stripe_price_id: priceId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId!)
    .is("ended_at", null)
    .eq("stripe_status", "checkout_pending")
    .or(
      `stripe_checkout_session_id.eq."${formatAttemptMarker(attemptMarker)}",stripe_checkout_session_id.eq."${session.id}"`
    )
    .select("id")
    .maybeSingle();

  if (storeError) {
    return {
      ok: false,
      error: "checkout_unavailable",
      status: 503,
      message: "Checkout could not be started. Please try again.",
    };
  }
  if (!stored) {
    await expireBranchCheckoutSession(stripe, session, {
      branchId: context.branchId,
      customerId,
    });
    const { data: current } = await admin
      .from("ea_branch_subscriptions")
      .select("stripe_status")
      .eq("id", subscriptionId!)
      .maybeSingle();
    if (current?.stripe_status && current.stripe_status !== "checkout_pending") {
      return checkoutProcessingResult();
    }
    return {
      ok: false,
      error: "checkout_unavailable",
      status: 503,
      message: "Checkout could not be started. Please try again.",
    };
  }

  const { error: startedEventError } = await admin
    .from("ea_subscription_events")
    .insert({
      branch_id: context.branchId,
      subscription_id: subscriptionId!,
      event_type: "subscription_started",
      actor_source: "user",
      metadata: {
        checkout_session_id: session.id,
        pricing_tier: tier,
        checkout_offer: offer,
        trial_period_days: trialPeriodDays,
        checkout_attempt_id: attemptMarker.attemptId,
      },
    });
  if (startedEventError) {
    // The Checkout session is already live; the audit gap is logged, not fatal.
    console.error("[billing-audit] ea_subscription_events insert failed", {
      event_type: "subscription_started",
      branch_id: context.branchId,
      subscription_row_id: subscriptionId!,
      code: startedEventError.code ?? null,
      message: startedEventError.message,
    });
  }

  return {
    ok: true,
    url: session.url,
    pricingTier: tier,
    trialPeriodDays,
  };
}
