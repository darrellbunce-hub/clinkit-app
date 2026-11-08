/**
 * Development verifier — Checkout idempotency / legitimate retry (P1).
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-checkout-idempotency-development.ts --execute
 *
 * Attempt model: stripe_checkout_session_id holds `attempt:{uuid}` while Stripe
 * create is in-flight; Stripe Idempotency-Key embeds that uuid and the Checkout
 * offer. Real `cs_…` id replaces the marker after success. Expired/abandoned
 * sessions rotate attempts; a completed session returns checkout_processing.
 *
 * --execute writes Development fixtures (user, company, branch, subscription rows,
 * audit events) and Stripe test-mode objects (Customer, Checkout Sessions, three
 * short trial Subscriptions for the Stripe-evidence and duplicate-guard checks).
 * All are cleaned up or left cancelled. Refuses non-test Stripe keys.
 * DUP1 needs migration 20261108160000 (billing_reconcile_required) applied.
 */
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import Module from "module";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED } from "../lib/billing/eaBranchEntitlement";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "CheckoutIdempotencyDev123!";

const moduleWithLoad = Module as typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load.bind(Module);
moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function assertDevelopment(url: string): void {
  const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (ref !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error("Refusing: not Development project");
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing: VERCEL_ENV=production");
  }
}

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureUser(admin: SupabaseClient, email: string) {
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.data.user?.id) return created.data.user.id;
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = listed.data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!existing?.id) throw new Error(`user create failed: ${email}`);
  return existing.id;
}

async function signIn(email: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw error;
  return client;
}

function runStatic() {
  console.log("\n--- Static Checkout idempotency checks ---\n");
  record(
    "Entitlement enforcement remains false",
    EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
  );

  const checkoutSrc = readFileSync(
    join(process.cwd(), "lib/billing/eaCheckout.ts"),
    "utf8"
  );
  const routeSrc = readFileSync(
    join(process.cwd(), "app/api/billing/ea/checkout-session/route.ts"),
    "utf8"
  );

  record(
    "Checkout uses attempt: marker for in-flight idempotency",
    checkoutSrc.includes('ATTEMPT_MARKER_PREFIX = "attempt:"') &&
      checkoutSrc.includes("claimCheckoutAttemptMarker") &&
      checkoutSrc.includes("buildCheckoutAttemptKey") &&
      checkoutSrc.includes("formatAttemptMarker")
  );
  record(
    "Checkout does not use permanent branch-only Stripe idempotency key",
    !checkoutSrc.includes("`ea-checkout-${context.branchId}`") &&
      checkoutSrc.includes("attemptId")
  );
  record(
    "TEST10/11/12 route rejects client idempotency/price/customer fields",
    routeSrc.includes("idempotencyKey") &&
      routeSrc.includes("client_price_authority_forbidden") &&
      routeSrc.includes("customerId")
  );
  record(
    "Stripe idempotency retention (≥24h) acknowledged in comments",
    checkoutSrc.includes("24h")
  );
  record(
    "API failure path leaves retryable state",
    checkoutSrc.includes("keepMarkerForRetry") &&
      checkoutSrc.includes("checkout_unavailable")
  );
  record(
    "Checkout uses standard price only (no founding reservation)",
    checkoutSrc.includes("config.standardPriceId") &&
      !checkoutSrc.includes("foundingPriceId") &&
      !checkoutSrc.includes("reserve_ea_founding_slot") &&
      !routeSrc.includes("acceptStandardPricing")
  );
  record(
    "Checkout trial: card required, 30 days, cancel without payment method",
    checkoutSrc.includes('payment_method_collection: "always"') &&
      checkoutSrc.includes("trial_period_days: trialPeriodDays") &&
      checkoutSrc.includes("EA_TRIAL_PERIOD_DAYS") &&
      checkoutSrc.includes('missing_payment_method: "cancel"')
  );
  record(
    "One trial per branch: database and Stripe subscription evidence",
    checkoutSrc.includes('.not("stripe_subscription_id", "is", null)') &&
      checkoutSrc.includes("stripe.subscriptions.list") &&
      checkoutSrc.includes('status: "all"') &&
      checkoutSrc.includes("decideCheckoutFromSubscriptionHistory") &&
      checkoutSrc.includes("subscription_check_unavailable")
  );
  record(
    "Duplicate guard: billable Stripe subscription blocks any new Checkout (409)",
    checkoutSrc.includes('error: "stripe_subscription_exists"') &&
      checkoutSrc.search(/stripeSubscriptions = await loadStripeSubscriptionHistory\(/) <
        checkoutSrc.indexOf("checkoutSessionMatchesOffer(existingSession, offer)") &&
      !checkoutSrc.includes("stripe.subscriptions.cancel")
  );
  record(
    "Completed Checkout returns checkout_processing in both reuse paths",
    (checkoutSrc.match(/status === "complete"/g) ?? []).length >= 2 &&
      checkoutSrc.includes('error: "checkout_processing"') &&
      checkoutSrc.includes("status: 409")
  );
  record(
    "Session id write is conditional on the in-flight marker",
    checkoutSrc.includes('.eq("stripe_status", "checkout_pending")') &&
      checkoutSrc.includes("stripe_checkout_session_id.eq.")
  );
  record(
    "Offer is part of the Stripe idempotency key",
    checkoutSrc.includes("-${input.offer}-")
  );
  record(
    "TEST10/11/12 route rejects client trial fields",
    routeSrc.includes('"trialPeriodDays"') &&
      routeSrc.includes('"trial_period_days"')
  );
  record(
    "No new Checkout-attempt table required",
    !existsSync(
      join(
        process.cwd(),
        "supabase/migrations/20260816250000_billing_p1_checkout_attempt_idempotency.sql"
      )
    )
  );
}

async function runExecute() {
  console.log("\n--- Execute Checkout idempotency checks ---\n");

  const { createEaBranchCheckoutSession } = await import(
    "../lib/billing/eaCheckout"
  );
  const { requireEaBranchBillingOwner } = await import(
    "../lib/billing/eaBillingAuth"
  );
  const { getStripeClient } = await import("../lib/billing/stripeClient");

  if (
    process.env.STRIPE_API_MODE !== "test" ||
    !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")
  ) {
    throw new Error("Refusing: Stripe test mode (sk_test_) required");
  }
  const standardPriceId = process.env.STRIPE_EA_STANDARD_PRICE_ID?.trim();
  if (!standardPriceId) throw new Error("STRIPE_EA_STANDARD_PRICE_ID required");

  const admin = serviceClient();
  const stripe = getStripeClient();
  const createdStripeSubscriptionIds: string[] = [];

  const stamp = Date.now().toString(36);
  const domain = `cidem-${stamp}.billing-checkout.test`;
  const email = `owner-${stamp}@${domain}`;

  let userId = "";
  let companyId = "";
  let branchId = "";
  const createdSessionIds: string[] = [];

  const cleanup = async () => {
    for (const id of createdStripeSubscriptionIds) {
      try {
        await stripe.subscriptions.cancel(id);
      } catch {
        /* already cancelled */
      }
    }
    for (const id of createdSessionIds) {
      try {
        if (!id.startsWith("attempt:")) {
          await stripe.checkout.sessions.expire(id);
        }
      } catch {
        /* ignore */
      }
    }
    if (branchId) {
      await admin.from("ea_subscription_events").delete().eq("branch_id", branchId);
      await admin.from("ea_branch_subscriptions").delete().eq("branch_id", branchId);
      await admin.from("ea_founding_slot_ledger").delete().eq("branch_id", branchId);
      await admin.from("ea_branch_membership_events").delete().eq("branch_id", branchId);
      await admin.from("ea_branch_members").delete().eq("branch_id", branchId);
      await admin.from("ea_branches").delete().eq("id", branchId);
    }
    if (companyId) await admin.from("ea_companies").delete().eq("id", companyId);
    if (userId) {
      await admin.from("profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  };

  try {
    userId = await ensureUser(admin, email);
    const client = await signIn(email);
    const profile = await createEstateAgentProfile(client, {
      userId,
      contactName: "Checkout Idem Owner",
      email,
    });
    if (profile.error) throw new Error(profile.error);
    const onboard = await completeEstateAgentOnboarding(client, {
      userId,
      companyName: `Checkout Idem Co ${stamp}`,
      branchName: `Checkout Idem Branch ${stamp}`,
      townOrCity: "London",
      postcode: "E1 6AN",
      isHeadOffice: true,
      emailDomain: domain,
    });
    if (!onboard.success) throw new Error(onboard.error);

    const { data: mem } = await admin
      .from("ea_branch_members")
      .select("branch_id")
      .eq("user_id", userId)
      .single();
    branchId = mem!.branch_id as string;
    const { data: branch } = await admin
      .from("ea_branches")
      .select("company_id")
      .eq("id", branchId)
      .single();
    companyId = branch!.company_id as string;

    const user = (await client.auth.getUser()).data.user!;
    const authz = await requireEaBranchBillingOwner(client, user, branchId);
    if (!authz.ok) throw new Error(authz.error);

    const first = await createEaBranchCheckoutSession({
      context: authz.context,
    });
    record(
      "TEST1 first Checkout create succeeds",
      first.ok === true && !!first.url,
      JSON.stringify(first)
    );
    if (!first.ok) throw new Error(first.error);
    record(
      "TRIAL1 new branch receives standard tier with 30-day trial",
      first.pricingTier === "standard" && first.trialPeriodDays === 30,
      JSON.stringify(first)
    );

    const { data: afterFirst } = await admin
      .from("ea_branch_subscriptions")
      .select("id, stripe_checkout_session_id, pricing_tier")
      .eq("branch_id", branchId)
      .is("ended_at", null)
      .single();
    const session1 = afterFirst?.stripe_checkout_session_id as string;
    if (session1) createdSessionIds.push(session1);

    if (session1) {
      const stripeSession = await stripe.checkout.sessions.retrieve(session1, {
        expand: ["line_items"],
      });
      record(
        "TRIAL2 Stripe session: standard price only, card required, trial offer",
        stripeSession.mode === "subscription" &&
          stripeSession.payment_method_collection === "always" &&
          stripeSession.metadata?.keynetic_checkout_offer ===
            "standard_trial_30d" &&
          stripeSession.metadata?.keynetic_pricing_tier === "standard" &&
          stripeSession.line_items?.data.length === 1 &&
          stripeSession.line_items.data[0]?.price?.id === standardPriceId,
        JSON.stringify({
          mode: stripeSession.mode,
          pmc: stripeSession.payment_method_collection,
          metadata: stripeSession.metadata,
          prices: stripeSession.line_items?.data.map((l) => l.price?.id),
        })
      );
    }

    const { data: startEvent } = await admin
      .from("ea_subscription_events")
      .select("metadata")
      .eq("branch_id", branchId)
      .eq("event_type", "subscription_started")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const attemptId1 = (startEvent?.metadata as { checkout_attempt_id?: string })
      ?.checkout_attempt_id;

    const second = await createEaBranchCheckoutSession({
      context: authz.context,
    });
    record(
      "TEST1 repeated Subscribe is idempotent (same URL)",
      second.ok === true && second.ok && second.url === first.url,
      JSON.stringify({ first: first.url, second })
    );
    record(
      "TEST13 open Checkout reused when safe",
      second.ok === true && second.ok && second.url === first.url,
      JSON.stringify(second)
    );

    const [c1, c2] = await Promise.all([
      createEaBranchCheckoutSession({
        context: authz.context,
      }),
      createEaBranchCheckoutSession({
        context: authz.context,
      }),
    ]);
    record(
      "TEST2 concurrent Subscribe returns same Checkout URL",
      c1.ok === true &&
        c2.ok === true &&
        c1.ok &&
        c2.ok &&
        c1.url === c2.url,
      JSON.stringify({ c1, c2 })
    );
    const { data: ledger } = await admin
      .from("ea_founding_slot_ledger")
      .select("id, state")
      .eq("branch_id", branchId)
      .in("state", ["reserved", "confirmed"]);
    record(
      "TEST2 new Checkout never reserves a founding slot",
      (ledger?.length ?? 0) === 0,
      JSON.stringify(ledger)
    );
    const { data: openRows } = await admin
      .from("ea_branch_subscriptions")
      .select("id")
      .eq("branch_id", branchId)
      .is("ended_at", null);
    record(
      "TEST2 repeated/concurrent Subscribe keeps one open subscription row",
      (openRows?.length ?? 0) === 1,
      JSON.stringify(openRows)
    );

    // TEST 3 — simulate lost response: restore attempt marker, clear real session id
    if (!attemptId1) {
      record("TEST3 lost-response retry recovers same logical attempt", false, "missing attempt id");
    } else {
      const marker = `attempt:${attemptId1}`;
      await admin
        .from("ea_branch_subscriptions")
        .update({
          stripe_checkout_session_id: marker,
          updated_at: new Date().toISOString(),
        })
        .eq("branch_id", branchId)
        .is("ended_at", null);

      const recovered = await createEaBranchCheckoutSession({
        context: authz.context,
      });
      const { data: afterLoss } = await admin
        .from("ea_branch_subscriptions")
        .select("stripe_checkout_session_id")
        .eq("branch_id", branchId)
        .is("ended_at", null)
        .single();

      record(
        "TEST3 lost-response retry recovers same logical attempt (same session)",
        recovered.ok === true &&
          recovered.ok &&
          recovered.url === first.url &&
          afterLoss?.stripe_checkout_session_id === session1,
        JSON.stringify({ recovered, afterLoss, session1, marker })
      );
    }

    // TEST 4/5/9 — expire then new attempt
    if (session1) {
      try {
        await stripe.checkout.sessions.expire(session1);
      } catch {
        /* ignore */
      }
    }
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_checkout_session_id: session1,
        updated_at: new Date().toISOString(),
      })
      .eq("branch_id", branchId)
      .is("ended_at", null);

    const afterExpire = await createEaBranchCheckoutSession({
      context: authz.context,
    });
    const { data: afterExpireRow } = await admin
      .from("ea_branch_subscriptions")
      .select("stripe_checkout_session_id")
      .eq("branch_id", branchId)
      .is("ended_at", null)
      .single();
    const session2 = afterExpireRow?.stripe_checkout_session_id as string | null;
    if (session2) createdSessionIds.push(session2);

    const { data: startEvent2 } = await admin
      .from("ea_subscription_events")
      .select("metadata")
      .eq("branch_id", branchId)
      .eq("event_type", "subscription_started")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const attemptId2 = (startEvent2?.metadata as { checkout_attempt_id?: string })
      ?.checkout_attempt_id;

    record(
      "TEST4 abandoned/expired Checkout does not permanently block branch",
      afterExpire.ok === true,
      JSON.stringify(afterExpire)
    );
    record(
      "TEST5/9 new logical attempt after expiry (new session + rotated attempt)",
      afterExpire.ok === true &&
        session2 !== session1 &&
        !!attemptId2 &&
        attemptId2 !== attemptId1,
      JSON.stringify({ session1, session2, attemptId1, attemptId2 })
    );
    record(
      "TEST6/7 new attempt stays standard with trial (no subscription yet)",
      afterExpire.ok === true &&
        afterExpire.pricingTier === "standard" &&
        afterExpire.trialPeriodDays === 30,
      JSON.stringify(afterExpire)
    );

    // TEST 14 — expired or unknown session is not reused (completed sessions
    // return checkout_processing; see static check — Checkout cannot be
    // completed headlessly)
    const { data: openRow } = await admin
      .from("ea_branch_subscriptions")
      .select("stripe_checkout_session_id")
      .eq("branch_id", branchId)
      .is("ended_at", null)
      .maybeSingle();
    const prior = openRow?.stripe_checkout_session_id as string | null;
    if (prior && !prior.startsWith("attempt:")) {
      try {
        await stripe.checkout.sessions.expire(prior);
      } catch {
        /* ignore */
      }
    }
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_checkout_session_id: prior ?? `cs_test_completed_${stamp}`,
        updated_at: new Date().toISOString(),
      })
      .eq("branch_id", branchId)
      .is("ended_at", null);

    const afterCompleted = await createEaBranchCheckoutSession({
      context: authz.context,
    });
    const { data: afterCompletedRow } = await admin
      .from("ea_branch_subscriptions")
      .select("stripe_checkout_session_id")
      .eq("branch_id", branchId)
      .is("ended_at", null)
      .single();
    if (afterCompletedRow?.stripe_checkout_session_id) {
      createdSessionIds.push(
        afterCompletedRow.stripe_checkout_session_id as string
      );
    }
    record(
      "TEST14 expired/unknown Checkout is not reused as active attempt",
      afterCompleted.ok === true &&
        afterCompletedRow?.stripe_checkout_session_id !== prior,
      JSON.stringify({ afterCompleted, afterCompletedRow, prior })
    );

    // TEST 15 — cleared state is retryable
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_checkout_session_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("branch_id", branchId)
      .is("ended_at", null);
    const retryable = await createEaBranchCheckoutSession({
      context: authz.context,
    });
    record(
      "TEST15 after cleared attempt state, Subscribe is retryable",
      retryable.ok === true,
      JSON.stringify(retryable)
    );
    if (retryable.ok) {
      const { data: r } = await admin
        .from("ea_branch_subscriptions")
        .select("stripe_checkout_session_id")
        .eq("branch_id", branchId)
        .is("ended_at", null)
        .single();
      if (r?.stripe_checkout_session_id) {
        createdSessionIds.push(r.stripe_checkout_session_id as string);
      }
    }

    const latestSessionId = async (): Promise<string | null> => {
      const { data } = await admin
        .from("ea_branch_subscriptions")
        .select("stripe_checkout_session_id")
        .eq("branch_id", branchId)
        .is("ended_at", null)
        .single();
      const id = (data?.stripe_checkout_session_id as string | null) ?? null;
      if (id && !id.startsWith("attempt:")) createdSessionIds.push(id);
      return id;
    };
    const { data: branchRow } = await admin
      .from("ea_branches")
      .select("stripe_customer_id")
      .eq("id", branchId)
      .single();
    const branchCustomerId = branchRow?.stripe_customer_id as string | null;

    // TRIAL3 — database evidence: an ended subscription with a linked Stripe id
    // means no second trial (even with no Stripe history on this Customer).
    const fixtureStripeSubId = `sub_fixture_ended_${stamp}`;
    const { data: endedFixture, error: endedFixtureError } = await admin
      .from("ea_branch_subscriptions")
      .insert({
        branch_id: branchId,
        stripe_customer_id: branchCustomerId,
        stripe_subscription_id: fixtureStripeSubId,
        pricing_tier: "standard",
        amount_gbp_minor: 12900,
        currency: "gbp",
        stripe_status: "canceled",
        entitlement_status: "ended",
        ended_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (endedFixtureError || !endedFixture) {
      record(
        "TRIAL3 ended subscription (database evidence) prevents a second trial",
        false,
        endedFixtureError?.message ?? "fixture insert failed"
      );
    } else {
      const sessionBeforeDbCheck = await latestSessionId();
      const afterEnded = await createEaBranchCheckoutSession({
        context: authz.context,
      });
      const sessionAfterDbCheck = await latestSessionId();
      record(
        "TRIAL3 ended subscription (database evidence) prevents a second trial",
        afterEnded.ok === true &&
          afterEnded.pricingTier === "standard" &&
          afterEnded.trialPeriodDays === null,
        JSON.stringify(afterEnded)
      );
      record(
        "TRIAL4 open trial Checkout is replaced when the offer changes",
        !!sessionAfterDbCheck &&
          sessionAfterDbCheck !== sessionBeforeDbCheck,
        JSON.stringify({ sessionBeforeDbCheck, sessionAfterDbCheck })
      );
      await admin
        .from("ea_branch_subscriptions")
        .delete()
        .eq("id", endedFixture.id as string);
    }

    // TRIAL5 — Stripe evidence: a subscription that exists only in Stripe
    // (webhook never linked it) still prevents a second trial.
    if (!branchCustomerId) {
      record(
        "TRIAL5 Stripe-only subscription history prevents a second trial",
        false,
        "branch has no Stripe Customer"
      );
    } else {
      const restored = await createEaBranchCheckoutSession({
        context: authz.context,
      });
      record(
        "TRIAL5 precondition: trial offered again once database fixture is removed",
        restored.ok === true && restored.trialPeriodDays === 30,
        JSON.stringify(restored)
      );
      await latestSessionId();

      const stripeOnly = await stripe.subscriptions.create({
        customer: branchCustomerId,
        items: [{ price: standardPriceId }],
        trial_period_days: 1,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: {
          keynetic_env: "test",
          verifier: "checkout-idempotency-stripe-evidence",
        },
      });
      createdStripeSubscriptionIds.push(stripeOnly.id);
      await stripe.subscriptions.cancel(stripeOnly.id);

      const afterStripeOnly = await createEaBranchCheckoutSession({
        context: authz.context,
      });
      await latestSessionId();
      record(
        "TRIAL5 Stripe-only (cancelled) subscription history prevents a second trial",
        afterStripeOnly.ok === true &&
          afterStripeOnly.pricingTier === "standard" &&
          afterStripeOnly.trialPeriodDays === null,
        JSON.stringify(afterStripeOnly)
      );

      // DUP1 — a live (trialing) Stripe subscription the database does not know
      // about blocks any new Checkout, is reported for reconciliation, and is
      // never cancelled by Checkout. No keynetic_branch_id metadata, so the
      // Development webhook ignores it (branch_unresolved).
      const sessionBeforeDup = await latestSessionId();
      const liveUnlinked = await stripe.subscriptions.create({
        customer: branchCustomerId,
        items: [{ price: standardPriceId }],
        trial_period_days: 1,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: {
          keynetic_env: "test",
          verifier: "checkout-idempotency-duplicate-guard",
        },
      });
      createdStripeSubscriptionIds.push(liveUnlinked.id);

      const blocked = await createEaBranchCheckoutSession({
        context: authz.context,
      });
      const sessionAfterDup = await latestSessionId();
      record(
        "DUP1 live Stripe subscription unknown to the database blocks Checkout (409 stripe_subscription_exists)",
        blocked.ok === false &&
          blocked.error === "stripe_subscription_exists" &&
          blocked.status === 409,
        JSON.stringify(blocked)
      );
      record(
        "DUP1 no new Checkout session is created while blocked",
        sessionAfterDup === sessionBeforeDup,
        JSON.stringify({ sessionBeforeDup, sessionAfterDup })
      );
      if (sessionBeforeDup && !sessionBeforeDup.startsWith("attempt:")) {
        const outstanding = await stripe.checkout.sessions.retrieve(
          sessionBeforeDup
        );
        record(
          "DUP1 the branch's outstanding open Checkout session is expired",
          outstanding.status === "expired",
          outstanding.status ?? "unknown"
        );
      }
      const { data: reconcileEvents } = await admin
        .from("ea_subscription_events")
        .select("metadata")
        .eq("branch_id", branchId)
        .eq("event_type", "billing_reconcile_required");
      record(
        "DUP1 discrepancy recorded as billing_reconcile_required (requires migration 20261108160000)",
        (reconcileEvents ?? []).some(
          (e) =>
            (e.metadata as { primary_stripe_subscription_id?: string })
              ?.primary_stripe_subscription_id === liveUnlinked.id
        ),
        JSON.stringify(reconcileEvents?.length ?? 0)
      );
      const stillLive = await stripe.subscriptions.retrieve(liveUnlinked.id);
      record(
        "DUP1 Checkout did not cancel or modify the existing Stripe subscription",
        stillLive.status === "trialing" && !stillLive.cancel_at_period_end,
        stillLive.status
      );

      await createEaBranchCheckoutSession({ context: authz.context });
      const { data: reconcileAfterRepeat } = await admin
        .from("ea_subscription_events")
        .select("id")
        .eq("branch_id", branchId)
        .eq("event_type", "billing_reconcile_required");
      record(
        "DUP1 repeated blocked attempts are deduped (one reconcile event per day)",
        (reconcileAfterRepeat?.length ?? 0) <= 1,
        String(reconcileAfterRepeat?.length ?? 0)
      );

      await stripe.subscriptions.cancel(liveUnlinked.id);
      const afterCancelled = await createEaBranchCheckoutSession({
        context: authz.context,
      });
      await latestSessionId();
      record(
        "DUP2 once the Stripe subscription is cancelled, paid Checkout is allowed without a trial",
        afterCancelled.ok === true && afterCancelled.trialPeriodDays === null,
        JSON.stringify(afterCancelled)
      );

      // DUP3 — delayed webhook: Stripe already has the subscription created by
      // this row's own Checkout, the row is still checkout_pending.
      const { data: pendingRow } = await admin
        .from("ea_branch_subscriptions")
        .select("id, stripe_status")
        .eq("branch_id", branchId)
        .is("ended_at", null)
        .single();
      const ownPending = await stripe.subscriptions.create({
        customer: branchCustomerId,
        items: [{ price: standardPriceId }],
        trial_period_days: 1,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: {
          keynetic_env: "test",
          keynetic_subscription_id: pendingRow!.id as string,
          verifier: "checkout-idempotency-delayed-webhook",
        },
      });
      createdStripeSubscriptionIds.push(ownPending.id);
      const sessionBeforeDelayed = await latestSessionId();
      const delayed = await createEaBranchCheckoutSession({
        context: authz.context,
      });
      const sessionAfterDelayed = await latestSessionId();
      record(
        "DUP3 delayed webhook for this row's own subscription returns checkout_processing",
        pendingRow?.stripe_status === "checkout_pending" &&
          delayed.ok === false &&
          delayed.error === "checkout_processing",
        JSON.stringify({ pendingStatus: pendingRow?.stripe_status, delayed })
      );
      record(
        "DUP3 no replacement Checkout session while the subscription is being confirmed",
        sessionAfterDelayed === sessionBeforeDelayed,
        JSON.stringify({ sessionBeforeDelayed, sessionAfterDelayed })
      );
      await stripe.subscriptions.cancel(ownPending.id);
    }

    const rogue = await client
      .from("ea_branch_subscriptions")
      .update({ stripe_checkout_session_id: `attempt:${randomUUID()}` })
      .eq("branch_id", branchId)
      .select("id");
    record(
      "Client cannot plant Checkout attempt markers",
      !!rogue.error || (rogue.data?.length ?? 0) === 0,
      rogue.error?.message ?? JSON.stringify(rogue.data)
    );

    record(
      "Entitlement enforcement still false",
      EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
    );
  } catch (error) {
    record(
      "Execute completed without setup crash",
      false,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await cleanup();
    record("Fixture cleanup completed", true);
  }
}

async function main() {
  loadEnvLocal();
  const execute = process.argv.includes("--execute");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Missing Supabase public env");
  }
  assertDevelopment(url);

  console.log("EA Billing Checkout Idempotency — Development Verification\n");
  console.log(`Environment: Development (${DEVELOPMENT_SUPABASE_PROJECT_REF})`);
  console.log("Production: NOT targeted");
  console.log(`Mode: ${execute ? "--execute" : "read-only static"}`);
  record("Development project ref guard", true);

  runStatic();
  if (execute) {
    await runExecute();
  } else {
    console.log("\nRe-run with --execute to prove Checkout idempotency.\n");
  }

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed\n`
  );
  if (failed.length) {
    for (const f of failed) {
      console.log(` - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
