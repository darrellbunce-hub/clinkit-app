import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthorisedBranchContext } from "@/lib/billing/eaBillingAuth";
import {
  amountGbpMinorForTier,
  type EaPricingTier,
} from "@/lib/billing/eaBranchPricing";
import { getStripeClient } from "@/lib/billing/stripeClient";
import {
  getStripePriceIdForTier,
  getStripeServerConfig,
} from "@/lib/billing/stripeServerConfig";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export type CheckoutCreateResult =
  | { ok: true; url: string; pricingTier: EaPricingTier }
  | { ok: false; error: string; status: number };

async function ensureCompanyStripeCustomer(
  admin: SupabaseClient,
  context: AuthorisedBranchContext
): Promise<string> {
  if (context.companyStripeCustomerId) {
    return context.companyStripeCustomerId;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create(
    {
      name: context.companyName,
      email: context.user.email ?? undefined,
      metadata: {
        keynetic_company_id: context.companyId,
        keynetic_env: getStripeServerConfig().apiMode,
      },
    },
    {
      idempotencyKey: `ea-company-customer-${context.companyId}`,
    }
  );

  const { data: updated, error } = await admin
    .from("ea_companies")
    .update({ stripe_customer_id: customer.id })
    .eq("id", context.companyId)
    .is("stripe_customer_id", null)
    .select("stripe_customer_id")
    .maybeSingle();

  if (!error && updated?.stripe_customer_id) {
    return updated.stripe_customer_id as string;
  }

  // Concurrent create won — reload.
  const { data: company } = await admin
    .from("ea_companies")
    .select("stripe_customer_id")
    .eq("id", context.companyId)
    .single();

  if (company?.stripe_customer_id) {
    return company.stripe_customer_id as string;
  }

  // Persist our customer if still null
  await admin
    .from("ea_companies")
    .update({ stripe_customer_id: customer.id })
    .eq("id", context.companyId);

  return customer.id;
}

async function selectPricingTier(
  userClient: SupabaseClient,
  branchId: string
): Promise<
  | { ok: true; tier: EaPricingTier; foundingSlot: number | null }
  | { ok: false; error: string }
> {
  const reserve = await userClient.rpc("reserve_ea_founding_slot", {
    p_branch_id: branchId,
    p_reservation_seconds: 1800,
  });

  if (reserve.data?.ok === true && typeof reserve.data.slot_number === "number") {
    return {
      ok: true,
      tier: "founding",
      foundingSlot: reserve.data.slot_number as number,
    };
  }

  if (reserve.data?.error === "founding_cohort_full") {
    return { ok: true, tier: "standard", foundingSlot: null };
  }

  // Already confirmed founding for this branch
  if (reserve.data?.ok === true && reserve.data.state === "confirmed") {
    return {
      ok: true,
      tier: "founding",
      foundingSlot: (reserve.data.slot_number as number) ?? null,
    };
  }

  // Non-admin shouldn't reach here; treat other errors as standard-safe fallback only for cohort conflicts
  if (reserve.error) {
    return { ok: false, error: "founding_reservation_failed" };
  }

  return { ok: true, tier: "standard", foundingSlot: null };
}

export async function createEaBranchCheckoutSession(input: {
  userClient: SupabaseClient;
  context: AuthorisedBranchContext;
}): Promise<CheckoutCreateResult> {
  const { userClient, context } = input;
  const admin = createServiceRoleSupabaseClient();
  const config = getStripeServerConfig();
  const stripe = getStripeClient();

  const { data: openSub } = await admin
    .from("ea_branch_subscriptions")
    .select(
      "id, stripe_status, entitlement_status, stripe_checkout_session_id, pricing_tier"
    )
    .eq("branch_id", context.branchId)
    .is("ended_at", null)
    .maybeSingle();

  if (
    openSub &&
    (openSub.entitlement_status === "entitled" ||
      openSub.entitlement_status === "grace" ||
      openSub.stripe_status === "active" ||
      openSub.stripe_status === "past_due" ||
      openSub.stripe_status === "trialing")
  ) {
    return { ok: false, error: "already_subscribed", status: 409 };
  }

  // Reuse open Checkout session when still valid
  if (
    openSub?.stripe_status === "checkout_pending" &&
    openSub.stripe_checkout_session_id
  ) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(
        openSub.stripe_checkout_session_id
      );
      if (existing.status === "open" && existing.url) {
        return {
          ok: true,
          url: existing.url,
          pricingTier: (openSub.pricing_tier as EaPricingTier) ?? "standard",
        };
      }
    } catch {
      // fall through to create a new session
    }
  }

  const pricing = await selectPricingTier(userClient, context.branchId);
  if (!pricing.ok) {
    return { ok: false, error: pricing.error, status: 500 };
  }

  const customerId = await ensureCompanyStripeCustomer(admin, context);
  const priceId = getStripePriceIdForTier(pricing.tier);
  const amount = amountGbpMinorForTier(pricing.tier);

  let subscriptionId = openSub?.id as string | undefined;

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
      .select("id")
      .single();

    if (insertError || !inserted) {
      // Race: another open row appeared
      const { data: raced } = await admin
        .from("ea_branch_subscriptions")
        .select("id")
        .eq("branch_id", context.branchId)
        .is("ended_at", null)
        .maybeSingle();
      if (!raced) {
        return { ok: false, error: "subscription_create_failed", status: 500 };
      }
      subscriptionId = raced.id as string;
    } else {
      subscriptionId = inserted.id as string;
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

  const successUrl = `${config.appUrl}/account?billing=success&branch=${context.branchId}#subscription`;
  const cancelUrl = `${config.appUrl}/account?billing=cancelled&branch=${context.branchId}#subscription`;

  const session = await stripe.checkout.sessions.create(
    {
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
    },
    {
      idempotencyKey: `ea-checkout-${context.branchId}-${subscriptionId}`,
    }
  );

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
    },
  });

  return { ok: true, url: session.url, pricingTier: pricing.tier };
}
