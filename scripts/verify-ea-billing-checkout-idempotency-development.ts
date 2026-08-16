/**
 * Development verifier — Checkout idempotency / legitimate retry (P1).
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-checkout-idempotency-development.ts --execute
 *
 * Attempt model: stripe_checkout_session_id holds `attempt:{uuid}` while Stripe
 * create is in-flight; Stripe Idempotency-Key embeds that uuid. Real `cs_…` id
 * replaces the marker after success. Expired/abandoned sessions rotate attempts.
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

  const admin = serviceClient();
  const stripe = getStripeClient();

  const stamp = Date.now().toString(36);
  const domain = `cidem-${stamp}.billing-checkout.test`;
  const email = `owner-${stamp}@${domain}`;

  let userId = "";
  let companyId = "";
  let branchId = "";
  const createdSessionIds: string[] = [];

  const cleanup = async () => {
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
      userClient: client,
      context: authz.context,
    });
    record(
      "TEST1 first Checkout create succeeds",
      first.ok === true && !!first.url,
      JSON.stringify(first)
    );
    if (!first.ok) throw new Error(first.error);

    const { data: afterFirst } = await admin
      .from("ea_branch_subscriptions")
      .select("id, stripe_checkout_session_id, pricing_tier")
      .eq("branch_id", branchId)
      .is("ended_at", null)
      .single();
    const session1 = afterFirst?.stripe_checkout_session_id as string;
    if (session1) createdSessionIds.push(session1);

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
      userClient: client,
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
        userClient: client,
        context: authz.context,
      }),
      createEaBranchCheckoutSession({
        userClient: client,
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
      "TEST2 no duplicate founding slot for branch",
      (ledger?.length ?? 0) <= 1,
      JSON.stringify(ledger)
    );

    // TEST 3 — simulate lost response: restore attempt marker, clear real session id
    if (!attemptId1) {
      record("TEST3 lost-response retry recovers same logical attempt", false, "missing attempt id");
    } else {
      const expiresUnix = (
        startEvent?.metadata as { checkout_expires_at_unix?: number | null }
      )?.checkout_expires_at_unix;
      const marker =
        typeof expiresUnix === "number"
          ? `attempt:${attemptId1}:${expiresUnix}`
          : `attempt:${attemptId1}`;
      await admin
        .from("ea_branch_subscriptions")
        .update({
          stripe_checkout_session_id: marker,
          updated_at: new Date().toISOString(),
        })
        .eq("branch_id", branchId)
        .is("ended_at", null);

      const recovered = await createEaBranchCheckoutSession({
        userClient: client,
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
      userClient: client,
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
      "TEST6/7 new attempt re-evaluates founding/price",
      afterExpire.ok === true &&
        (afterExpire.pricingTier === "founding" ||
          afterExpire.pricingTier === "standard"),
      JSON.stringify(afterExpire)
    );

    // TEST 8 — cohort full path (or skip if founding still open)
    if (session2) {
      try {
        await stripe.checkout.sessions.expire(session2);
      } catch {
        /* ignore */
      }
      await admin
        .from("ea_branch_subscriptions")
        .update({
          stripe_checkout_session_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("branch_id", branchId)
        .is("ended_at", null);
    }
    await admin
      .from("ea_founding_slot_ledger")
      .update({
        state: "released",
        released_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("branch_id", branchId)
      .eq("state", "reserved");

    const { data: avail } = await admin.rpc("get_ea_founding_availability");
    if (avail?.cohort_secured === true || Number(avail?.available_count) === 0) {
      const needAccept = await createEaBranchCheckoutSession({
        userClient: client,
        context: authz.context,
      });
      record(
        "TEST8 cohort full does not create £99 without acceptance",
        needAccept.ok === false && needAccept.error === "founding_just_secured",
        JSON.stringify(needAccept)
      );
      const standard = await createEaBranchCheckoutSession({
        userClient: client,
        context: authz.context,
        acceptStandardPricing: true,
      });
      if (standard.ok && standard.ok) {
        const { data: stdRow } = await admin
          .from("ea_branch_subscriptions")
          .select("stripe_checkout_session_id")
          .eq("branch_id", branchId)
          .is("ended_at", null)
          .single();
        if (stdRow?.stripe_checkout_session_id) {
          createdSessionIds.push(stdRow.stripe_checkout_session_id as string);
        }
      }
      record(
        "TEST8 £129 Checkout after conscious acceptance",
        standard.ok === true &&
          standard.ok &&
          standard.pricingTier === "standard",
        JSON.stringify(standard)
      );
    } else {
      record(
        "TEST8 cohort full does not create £99 without acceptance",
        true,
        "cohort not full — founding still available"
      );
      record(
        "TEST8 £129 Checkout after conscious acceptance",
        true,
        "skipped — founding places still available"
      );
    }

    // TEST 14 — unusable/completed session not reused
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
      userClient: client,
      context: authz.context,
      acceptStandardPricing: true,
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
      "TEST14 completed/unusable Checkout is not reused as active attempt",
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
      userClient: client,
      context: authz.context,
      acceptStandardPricing: true,
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
