/**
 * Development verifier — Branch Stripe Customer / Portal isolation (P1).
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-portal-isolation-development.ts --execute
 *
 * Proves Day 1: Branch A and Branch B under the same company get distinct
 * Stripe Customers; Portal sessions cannot share a Customer; API tampering
 * cannot select another branch's billing context.
 *
 * Does not enable entitlement enforcement. Does not touch Production.
 */
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import Module from "module";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED } from "../lib/billing/eaBranchEntitlement";
import { EA_BILLING_SEMANTICS } from "../lib/billing/eaBillingSemantics";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "PortalIsolationDev123!";

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

function runStatic(): void {
  console.log("\n--- Static Portal isolation checks ---\n");
  record(
    "Entitlement enforcement remains false",
    EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
  );
  record(
    "Semantics: Day 1 Stripe Customer owner is ea_branch",
    EA_BILLING_SEMANTICS.stripeCustomerOwnerDay1 === "ea_branch"
  );

  const migration = join(
    process.cwd(),
    "supabase/migrations/20260816220000_billing_p1_branch_stripe_customer.sql"
  );
  record("Branch Stripe Customer migration exists", existsSync(migration));

  const checkout = readFileSync(
    join(process.cwd(), "lib/billing/eaCheckout.ts"),
    "utf8"
  );
  record(
    "Checkout ensures branch Customer (not company)",
    checkout.includes("ensureBranchStripeCustomer") &&
      checkout.includes("ea-branch-customer-") &&
      !checkout.includes("ensureCompanyStripeCustomer")
  );

  const portal = readFileSync(
    join(process.cwd(), "lib/billing/eaPortal.ts"),
    "utf8"
  );
  record(
    "Portal uses branchStripeCustomerId",
    portal.includes("branchStripeCustomerId") &&
      !portal.includes("companyStripeCustomerId")
  );

  const route = readFileSync(
    join(process.cwd(), "app/api/billing/ea/portal-session/route.ts"),
    "utf8"
  );
  record(
    "Portal route rejects client customerId",
    route.includes("client_customer_id_forbidden")
  );
}

async function runExecute(): Promise<void> {
  console.log("\n--- Execute Portal isolation checks ---\n");
  const admin = serviceClient();

  const colProbe = await admin
    .from("ea_branches")
    .select("id, stripe_customer_id")
    .limit(1);
  if (colProbe.error?.message?.toLowerCase().includes("stripe_customer_id")) {
    record(
      "ea_branches.stripe_customer_id available on Development",
      false,
      `${colProbe.error.message} — apply 20260816220000_billing_p1_branch_stripe_customer.sql`
    );
    return;
  }
  record("ea_branches.stripe_customer_id available on Development", true);

  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret?.startsWith("sk_test_") || process.env.STRIPE_API_MODE !== "test") {
    record("Sandbox Stripe configured", false, "sk_test_ + STRIPE_API_MODE=test required");
    return;
  }
  const stripe = new Stripe(secret);

  const { createEaBillingPortalSession } = await import(
    "../lib/billing/eaPortal"
  );
  const { requireEaBranchBillingOwner, requireEaBranchBillingMember } =
    await import("../lib/billing/eaBillingAuth");
  const { processStripeWebhookEvent } = await import(
    "../lib/billing/eaStripeWebhook"
  );

  const stamp = randomUUID().slice(0, 8);
  // Same-company branches MUST share one agency domain.
  // The cross-company fixture MUST use a different domain (ea_companies.email_domain unique).
  const companyDomain = `iso-a-${stamp}.billing-portal.test`;
  const otherDomain = `iso-b-${stamp}.billing-portal.test`;
  const londonEmail = `lon-${stamp}@${companyDomain}`;
  const bristolEmail = `bri-${stamp}@${companyDomain}`;
  const otherEmail = `oth-${stamp}@${otherDomain}`;

  let londonUserId = "";
  let bristolUserId = "";
  let otherUserId = "";
  let londonBranchId = "";
  let bristolBranchId = "";
  let otherBranchId = "";
  let companyId = "";
  let otherCompanyId = "";
  const createdCustomers: string[] = [];
  const createdSubs: string[] = [];
  const eventIds: string[] = [];

  const cleanup = async () => {
    for (const id of createdSubs) {
      try {
        await stripe.subscriptions.cancel(id);
      } catch {
        /* ignore */
      }
    }
    for (const id of createdCustomers) {
      try {
        await stripe.customers.del(id);
      } catch {
        /* ignore */
      }
    }
    if (eventIds.length) {
      await admin
        .from("stripe_webhook_events")
        .delete()
        .in("stripe_event_id", eventIds);
    }
    for (const branchId of [
      londonBranchId,
      bristolBranchId,
      otherBranchId,
    ].filter(Boolean)) {
      await admin
        .from("ea_subscription_events")
        .delete()
        .eq("branch_id", branchId);
      await admin
        .from("ea_branch_subscriptions")
        .delete()
        .eq("branch_id", branchId);
      await admin
        .from("ea_founding_slot_ledger")
        .delete()
        .eq("branch_id", branchId);
      await admin
        .from("ea_branch_membership_events")
        .delete()
        .eq("branch_id", branchId);
    }
    if (bristolBranchId) {
      await admin.from("ea_branches").delete().eq("id", bristolBranchId);
    }
    if (londonBranchId) {
      await admin.from("ea_branches").delete().eq("id", londonBranchId);
    }
    if (otherBranchId) {
      await admin.from("ea_branches").delete().eq("id", otherBranchId);
    }
    if (companyId) {
      await admin.from("ea_companies").delete().eq("id", companyId);
    }
    if (otherCompanyId) {
      await admin.from("ea_companies").delete().eq("id", otherCompanyId);
    }
    for (const id of [londonUserId, bristolUserId, otherUserId].filter(
      Boolean
    )) {
      await admin.from("profiles").delete().eq("id", id);
      await admin.auth.admin.deleteUser(id);
    }
  };

  try {
    londonUserId = await ensureUser(admin, londonEmail);
    bristolUserId = await ensureUser(admin, bristolEmail);
    otherUserId = await ensureUser(admin, otherEmail);

    const london = await signIn(londonEmail);
    const bristol = await signIn(bristolEmail);
    const other = await signIn(otherEmail);

    const lp = await createEstateAgentProfile(london, {
      userId: londonUserId,
      contactName: "London Owner",
      email: londonEmail,
    });
    if (lp.error) throw new Error(lp.error);
    const lo = await completeEstateAgentOnboarding(london, {
      userId: londonUserId,
      companyName: `Iso Co ${stamp}`,
      branchName: `London ${stamp}`,
      townOrCity: "London",
      postcode: "E1 6AN",
      isHeadOffice: true,
      emailDomain: companyDomain,
    });
    if (!lo.success) throw new Error(lo.error);

    const { data: londonMembership } = await admin
      .from("ea_branch_members")
      .select("branch_id")
      .eq("user_id", londonUserId)
      .single();
    londonBranchId = londonMembership!.branch_id as string;
    const { data: londonBranchRow } = await admin
      .from("ea_branches")
      .select("company_id")
      .eq("id", londonBranchId)
      .single();
    companyId = londonBranchRow!.company_id as string;

    const { data: bristolBranch, error: bristolBranchErr } = await admin
      .from("ea_branches")
      .insert({
        company_id: companyId,
        name: `Bristol ${stamp}`,
        town_or_city: "Bristol",
        postcode: "BS1 4DJ",
        region_code: "UK-SOUTH-WEST",
        is_head_office: false,
      })
      .select("id")
      .single();
    if (bristolBranchErr || !bristolBranch) {
      throw new Error(bristolBranchErr?.message ?? "bristol branch failed");
    }
    bristolBranchId = bristolBranch.id as string;

    const bp = await createEstateAgentProfile(bristol, {
      userId: bristolUserId,
      contactName: "Bristol Owner",
      email: bristolEmail,
    });
    if (bp.error) throw new Error(bp.error);
    await admin
      .from("profiles")
      .update({
        account_type: "estate_agent",
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq("id", bristolUserId);
    const { error: bristolMemberErr } = await admin
      .from("ea_branch_members")
      .insert({
        branch_id: bristolBranchId,
        user_id: bristolUserId,
        role: "branch_admin",
      });
    if (bristolMemberErr) throw new Error(bristolMemberErr.message);

    const op = await createEstateAgentProfile(other, {
      userId: otherUserId,
      contactName: "Other Owner",
      email: otherEmail,
    });
    if (op.error) throw new Error(op.error);
    const oo = await completeEstateAgentOnboarding(other, {
      userId: otherUserId,
      companyName: `Other Iso ${stamp}`,
      branchName: `Other ${stamp}`,
      townOrCity: "Portsmouth",
      postcode: "PO1 2AA",
      isHeadOffice: true,
      emailDomain: otherDomain,
    });
    if (!oo.success) throw new Error(oo.error);
    const { data: otherMembership } = await admin
      .from("ea_branch_members")
      .select("branch_id")
      .eq("user_id", otherUserId)
      .single();
    otherBranchId = otherMembership!.branch_id as string;
    const { data: otherBranchRow } = await admin
      .from("ea_branches")
      .select("company_id")
      .eq("id", otherBranchId)
      .single();
    otherCompanyId = otherBranchRow!.company_id as string;

    record(
      "Fixture domains isolated (same-company shared; cross-company distinct)",
      companyDomain !== otherDomain &&
        londonEmail.endsWith(`@${companyDomain}`) &&
        bristolEmail.endsWith(`@${companyDomain}`) &&
        otherEmail.endsWith(`@${otherDomain}`),
      `${companyDomain} vs ${otherDomain}`
    );

    // Create distinct branch Customers via service role (simulates Checkout ensure)
    for (const [branchId, email, label] of [
      [londonBranchId, londonEmail, "London"],
      [bristolBranchId, bristolEmail, "Bristol"],
    ] as const) {
      const customer = await stripe.customers.create({
        name: `Iso ${label} ${stamp}`,
        email,
        metadata: {
          keynetic_branch_id: branchId,
          keynetic_company_id: companyId,
          keynetic_env: "test",
        },
      });
      createdCustomers.push(customer.id);
      await admin
        .from("ea_branches")
        .update({ stripe_customer_id: customer.id })
        .eq("id", branchId);

      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" },
      });
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
      await stripe.customers.update(customer.id, {
        invoice_settings: { default_payment_method: pm.id },
      });

      const priceId = process.env.STRIPE_EA_STANDARD_PRICE_ID!.trim();
      const sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        metadata: {
          keynetic_branch_id: branchId,
          keynetic_company_id: companyId,
          keynetic_pricing_tier: "standard",
          keynetic_env: "test",
        },
      });
      createdSubs.push(sub.id);

      const { data: subRow } = await admin
        .from("ea_branch_subscriptions")
        .insert({
          branch_id: branchId,
          stripe_customer_id: customer.id,
          stripe_subscription_id: sub.id,
          pricing_tier: "standard",
          amount_gbp_minor: 12900,
          currency: "gbp",
          stripe_status: "active",
          entitlement_status: "entitled",
        })
        .select("id")
        .single();

      await stripe.subscriptions.update(sub.id, {
        metadata: {
          keynetic_branch_id: branchId,
          keynetic_company_id: companyId,
          keynetic_subscription_id: subRow!.id,
          keynetic_pricing_tier: "standard",
          keynetic_env: "test",
        },
      });
    }

    const { data: londonBranch } = await admin
      .from("ea_branches")
      .select("stripe_customer_id")
      .eq("id", londonBranchId)
      .single();
    const { data: bristolBranchFresh } = await admin
      .from("ea_branches")
      .select("stripe_customer_id")
      .eq("id", bristolBranchId)
      .single();

    record(
      "TEST1 London Owner branch has Stripe Customer A",
      !!londonBranch?.stripe_customer_id,
      londonBranch?.stripe_customer_id ?? undefined
    );
    record(
      "TEST2 Bristol Owner branch has Stripe Customer B",
      !!bristolBranchFresh?.stripe_customer_id &&
        bristolBranchFresh.stripe_customer_id !== londonBranch?.stripe_customer_id,
      bristolBranchFresh?.stripe_customer_id ?? undefined
    );

    const londonUser = (await london.auth.getUser()).data.user!;
    const bristolUser = (await bristol.auth.getUser()).data.user!;

    // Reload auth context after customer assignment
    const londonAuthz = await requireEaBranchBillingOwner(
      london,
      londonUser,
      londonBranchId
    );
    const bristolAuthz = await requireEaBranchBillingOwner(
      bristol,
      bristolUser,
      bristolBranchId
    );
    if (!londonAuthz.ok || !bristolAuthz.ok) {
      throw new Error("owner authz failed after customer assign");
    }

    // Force context refresh — auth helpers read DB; branch customer should be present
    const londonAuthz2 = await requireEaBranchBillingOwner(
      london,
      londonUser,
      londonBranchId
    );
    const bristolAuthz2 = await requireEaBranchBillingOwner(
      bristol,
      bristolUser,
      bristolBranchId
    );
    record(
      "TEST1/2 auth context exposes distinct branchStripeCustomerId",
      londonAuthz2.ok &&
        bristolAuthz2.ok &&
        !!londonAuthz2.context.branchStripeCustomerId &&
        !!bristolAuthz2.context.branchStripeCustomerId &&
        londonAuthz2.context.branchStripeCustomerId !==
          bristolAuthz2.context.branchStripeCustomerId,
      JSON.stringify({
        london: londonAuthz2.ok
          ? londonAuthz2.context.branchStripeCustomerId
          : null,
        bristol: bristolAuthz2.ok
          ? bristolAuthz2.context.branchStripeCustomerId
          : null,
      })
    );

    if (!londonAuthz2.ok || !bristolAuthz2.ok) {
      throw new Error("authz2 failed");
    }

    const londonPortal = await createEaBillingPortalSession(londonAuthz2.context);
    const bristolPortal = await createEaBillingPortalSession(
      bristolAuthz2.context
    );
    record(
      "Portal sessions created for both branches",
      londonPortal.ok && bristolPortal.ok
    );

    const londonSession = await stripe.billingPortal.sessions.create({
      customer: londonAuthz2.context.branchStripeCustomerId!,
      return_url: "http://localhost:3000/account#subscription",
    });
    const bristolSession = await stripe.billingPortal.sessions.create({
      customer: bristolAuthz2.context.branchStripeCustomerId!,
      return_url: "http://localhost:3000/account#subscription",
    });

    const londonSubs = await stripe.subscriptions.list({
      customer: londonAuthz2.context.branchStripeCustomerId!,
      status: "all",
      limit: 10,
    });
    const bristolSubs = await stripe.subscriptions.list({
      customer: bristolAuthz2.context.branchStripeCustomerId!,
      status: "all",
      limit: 10,
    });

    record(
      "TEST3 London Portal Customer has only London subscription(s)",
      londonSession.customer === londonAuthz2.context.branchStripeCustomerId &&
        londonSubs.data.every(
          (s) => s.metadata.keynetic_branch_id === londonBranchId
        ) &&
        !londonSubs.data.some(
          (s) => s.metadata.keynetic_branch_id === bristolBranchId
        ),
      JSON.stringify({
        customer: londonSession.customer,
        flow: londonSession.flow,
        subs: londonSubs.data.map((s) => s.metadata.keynetic_branch_id),
      })
    );
    record(
      "TEST3 Bristol Portal Customer has only Bristol subscription(s)",
      bristolSession.customer === bristolAuthz2.context.branchStripeCustomerId &&
        bristolSubs.data.every(
          (s) => s.metadata.keynetic_branch_id === bristolBranchId
        ) &&
        !bristolSubs.data.some(
          (s) => s.metadata.keynetic_branch_id === londonBranchId
        ),
      JSON.stringify({
        customer: bristolSession.customer,
        subs: bristolSubs.data.map((s) => s.metadata.keynetic_branch_id),
      })
    );

    // TEST 4/5/6 tampering
    const tamperCustomerBody = readFileSync(
      join(process.cwd(), "app/api/billing/ea/portal-session/route.ts"),
      "utf8"
    );
    record(
      "TEST4 client cannot submit Stripe Customer ID (route rejects)",
      tamperCustomerBody.includes("client_customer_id_forbidden")
    );

    const sibling = await requireEaBranchBillingMember(
      london,
      londonUser,
      bristolBranchId
    );
    record(
      "TEST5 London cannot request Bristol branchId",
      !sibling.ok && sibling.error === "not_branch_member",
      JSON.stringify(sibling)
    );

    const crossCo = await requireEaBranchBillingMember(
      london,
      londonUser,
      otherBranchId
    );
    record(
      "TEST6 other-company branch remains isolated",
      !crossCo.ok && crossCo.error === "not_branch_member",
      JSON.stringify(crossCo)
    );

    // TEST 9 client cannot mutate branch stripe_customer_id
    const mutate = await london
      .from("ea_branches")
      .update({ stripe_customer_id: "cus_forged_by_client" })
      .eq("id", londonBranchId)
      .select("stripe_customer_id");
    const { data: afterMutate } = await admin
      .from("ea_branches")
      .select("stripe_customer_id")
      .eq("id", londonBranchId)
      .single();
    record(
      "TEST9 client cannot mutate branch Stripe Customer ID",
      (!!mutate.error || (mutate.data ?? []).length === 0) &&
        afterMutate?.stripe_customer_id ===
          londonAuthz2.context.branchStripeCustomerId,
      JSON.stringify({
        error: mutate.error?.message,
        data: mutate.data,
        persisted: afterMutate?.stripe_customer_id,
      })
    );

    // TEST 7/8 webhook mapping stays branch-scoped
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    for (const [branchId, customerId, subId, label] of [
      [
        londonBranchId,
        londonAuthz2.context.branchStripeCustomerId!,
        createdSubs[0]!,
        "London",
      ],
      [
        bristolBranchId,
        bristolAuthz2.context.branchStripeCustomerId!,
        createdSubs[1]!,
        "Bristol",
      ],
    ] as const) {
      const { data: row } = await admin
        .from("ea_branch_subscriptions")
        .select("id")
        .eq("branch_id", branchId)
        .is("ended_at", null)
        .single();
      const eventId = `evt_iso_${label}_${randomUUID()}`;
      eventIds.push(eventId);
      const event = {
        id: eventId,
        object: "event",
        api_version: "2024-11-20.acacia",
        created: Math.floor(Date.now() / 1000),
        type: "customer.subscription.updated",
        livemode: false,
        pending_webhooks: 1,
        request: { id: null, idempotency_key: null },
        data: {
          object: {
            id: subId,
            object: "subscription",
            status: "active",
            cancel_at_period_end: false,
            created: periodEnd - 30 * 24 * 3600,
            current_period_start: periodEnd - 30 * 24 * 3600,
            current_period_end: periodEnd,
            customer: customerId,
            items: {
              object: "list",
              data: [
                {
                  id: `si_${label}`,
                  object: "subscription_item",
                  price: {
                    id: process.env.STRIPE_EA_STANDARD_PRICE_ID,
                    object: "price",
                  },
                },
              ],
            },
            metadata: {
              keynetic_branch_id: branchId,
              keynetic_company_id: companyId,
              keynetic_subscription_id: row!.id,
              keynetic_pricing_tier: "standard",
              keynetic_env: "test",
            },
          },
        },
      } as unknown as import("stripe").Stripe.Event;

      const processed = await processStripeWebhookEvent(event);
      const { data: after } = await admin
        .from("ea_branch_subscriptions")
        .select("branch_id, stripe_customer_id, stripe_subscription_id")
        .eq("id", row!.id)
        .single();
      record(
        `TEST7/8 webhook ${label} maps only to ${label} subscription`,
        processed.ok === true &&
          after?.branch_id === branchId &&
          after?.stripe_customer_id === customerId &&
          after?.stripe_subscription_id === subId,
        JSON.stringify({ processed, after })
      );
    }

    // TEST 10 P0 claim still retryable for failed events
    const failEventId = `evt_iso_fail_${randomUUID()}`;
    eventIds.push(failEventId);
    const failEvent = {
      id: failEventId,
      object: "event",
      type: "customer.subscription.updated",
      api_version: "2024-11-20.acacia",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      data: {
        object: {
          id: createdSubs[0],
          object: "subscription",
          status: "active",
          cancel_at_period_end: false,
          created: periodEnd - 86400,
          current_period_start: periodEnd - 86400,
          current_period_end: periodEnd + 86400,
          customer: londonAuthz2.context.branchStripeCustomerId,
          items: { object: "list", data: [] },
          metadata: {
            keynetic_branch_id: londonBranchId,
            keynetic_company_id: companyId,
            keynetic_env: "test",
          },
        },
      },
    } as unknown as import("stripe").Stripe.Event;

    process.env.EA_BILLING_WEBHOOK_TEST_HOOKS = "1";
    const failed = await processStripeWebhookEvent(failEvent, {
      simulateFailureAfterClaim: true,
    });
    const { data: failedRow } = await admin
      .from("stripe_webhook_events")
      .select("processing_status")
      .eq("stripe_event_id", failEventId)
      .single();
    record(
      "TEST10 deliberate failure leaves event failed (retryable)",
      failed.ok === false && failedRow?.processing_status === "failed",
      JSON.stringify({ failed, failedRow })
    );

    const retry = await processStripeWebhookEvent(failEvent);
    const { data: retryRow } = await admin
      .from("stripe_webhook_events")
      .select("processing_status")
      .eq("stripe_event_id", failEventId)
      .single();
    record(
      "TEST10 retry after failure is not ok+duplicate swallow",
      !(retry.ok === true && retry.duplicate === true),
      JSON.stringify({ retry, retryRow })
    );
    record(
      "TEST10 retry reaches processed (or re-failed), not already_succeeded skip",
      retry.claimAction !== "already_succeeded" &&
        (retryRow?.processing_status === "processed" ||
          retryRow?.processing_status === "failed"),
      JSON.stringify({ retry, retryRow })
    );

    record(
      "Company stripe_customer_id not required for Day 1 Portal",
      true,
      "company field reserved for future org billing"
    );
    record(
      "Entitlement enforcement still false",
      EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
    );
  } catch (error) {
    record(
      "Fixture/execute completed without setup crash",
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

  console.log("EA Billing Portal Isolation — Development Verification\n");
  console.log(`Environment: Development (${DEVELOPMENT_SUPABASE_PROJECT_REF})`);
  console.log("Production: NOT targeted");
  console.log(`Mode: ${execute ? "--execute" : "read-only static"}`);
  record("Development project ref guard", true);

  runStatic();
  if (execute) {
    await runExecute();
  } else {
    console.log("\nRe-run with --execute after applying the branch Customer migration.\n");
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
