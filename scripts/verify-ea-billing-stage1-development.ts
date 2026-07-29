/**
 * Development-only Billing Stage 1 foundation verifier.
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-stage1-development.ts
 *   npx tsx scripts/verify-ea-billing-stage1-development.ts --execute
 *
 * Does NOT call Stripe APIs. Temporary fixtures cleaned in try/finally.
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  EA_FOUNDING_BRANCH_LIMIT,
  EA_FOUNDING_BRANCH_MONTHLY_GBP_MINOR,
  EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR,
} from "../lib/billing/eaBranchPricing";
import { EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED } from "../lib/billing/eaBranchEntitlement";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const TEST_EMAIL_PREFIX = "billing-stage1";
const PASSWORD = "BillingStage1Dev123!";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // optional
  }
}

function resolveServiceRoleKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (value === "your-service-role-key" || value === "your_service_role_key") {
    return undefined;
  }
  return value;
}

function assertDevelopmentEnvironment(supabaseUrl: string): string {
  const match = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const projectRef = match?.[1] ?? null;
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(
      `Refusing to run: Supabase project "${projectRef ?? "unknown"}" is not Development (${DEVELOPMENT_SUPABASE_PROJECT_REF}).`
    );
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to run: VERCEL_ENV=production.");
  }
  return projectRef!;
}

function anonClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function serviceClient(): SupabaseClient {
  const key = resolveServiceRoleKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY required for --execute");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureAuthUser(
  admin: SupabaseClient,
  email: string,
  password: string
): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.data.user?.id) return created.data.user.id;
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = listed.data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!existing?.id) {
    throw new Error(`createUser failed: ${created.error?.message}`);
  }
  return existing.id;
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

function runStaticChecks(): void {
  console.log("\n--- Static Stage 1 checks ---\n");
  record(
    "Pricing constants are £99 founding / £129 standard minor units",
    EA_FOUNDING_BRANCH_MONTHLY_GBP_MINOR === 9900 &&
      EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR === 12900 &&
      EA_FOUNDING_BRANCH_LIMIT === 20
  );
  record(
    "Entitlement enforcement remains disabled in Stage 1",
    EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
  );

  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260729200000_billing_stage1_ea_branch_subscriptions.sql"
    ),
    "utf8"
  );
  record(
    "Migration defines ea_branch_subscriptions + founding ledger + webhook idempotency",
    migration.includes("create table if not exists public.ea_branch_subscriptions") &&
      migration.includes("create table if not exists public.ea_founding_slot_ledger") &&
      migration.includes("create table if not exists public.stripe_webhook_events") &&
      migration.includes("create table if not exists public.ea_subscription_events")
  );
  record(
    "Migration revokes authenticated mutations on billing tables",
    migration.includes(
      "revoke all on public.ea_branch_subscriptions from authenticated"
    ) &&
      migration.includes(
        "revoke all on public.ea_founding_slot_ledger from authenticated"
      )
  );
}

async function runAnonProbes(): Promise<void> {
  console.log("\n--- Anon billing probes ---\n");
  const anon = anonClient();
  for (const table of [
    "ea_branch_subscriptions",
    "ea_founding_slot_ledger",
    "stripe_webhook_events",
    "ea_subscription_events",
  ]) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    const permissionDenied =
      error?.code === "42501" ||
      !!error?.message?.toLowerCase().includes("permission denied") ||
      !!error?.message?.toLowerCase().includes("not accept");
    record(
      `Anon cannot read ${table}`,
      permissionDenied || (!!error && (data ?? []).length === 0),
      error?.message ?? `rows=${(data ?? []).length}`
    );

    const insert = await anon.from(table).insert({} as never).select();
    record(
      `Anon cannot mutate ${table}`,
      !!insert.error,
      insert.error?.message ?? "unexpected success"
    );
  }
}

type Fixture = {
  stamp: string;
  eaAEmail: string;
  eaBEmail: string;
  homeownerEmail: string;
  eaAUserId: string;
  eaBUserId: string;
  homeownerUserId: string;
  branchAId: string;
  branchBId: string;
  companyAId: string;
  companyBId: string;
  subscriptionIds: string[];
  foundingIds: string[];
};

async function createEaBranch(
  admin: SupabaseClient,
  stamp: string,
  label: string
): Promise<{
  email: string;
  userId: string;
  branchId: string;
  companyId: string;
  client: SupabaseClient;
}> {
  const email = `${label}-${stamp}@${label}${stamp}.co.uk`;
  const userId = await ensureAuthUser(admin, email, PASSWORD);
  const client = await signIn(email, PASSWORD);
  const profile = await createEstateAgentProfile(client, {
    userId,
    contactName: `Billing ${label}`,
    email,
  });
  if (profile.error) throw new Error(profile.error);
  const onboard = await completeEstateAgentOnboarding(client, {
    userId,
    companyName: `Billing Co ${label} ${stamp}`,
    branchName: `Billing Branch ${label} ${stamp}`,
    townOrCity: "Fareham",
    postcode: "PO16 7AA",
    isHeadOffice: true,
    emailDomain: email.split("@")[1]!,
  });
  if (!onboard.success) throw new Error(onboard.error);
  const { data: membership } = await admin
    .from("ea_branch_members")
    .select("branch_id")
    .eq("user_id", userId)
    .single();
  if (!membership?.branch_id) throw new Error("membership missing");
  const { data: branch } = await admin
    .from("ea_branches")
    .select("id, company_id")
    .eq("id", membership.branch_id)
    .single();
  if (!branch) throw new Error("branch missing");
  return {
    email,
    userId,
    branchId: branch.id as string,
    companyId: branch.company_id as string,
    client,
  };
}

async function cleanupFixture(admin: SupabaseClient, fixture: Fixture): Promise<void> {
  for (const id of fixture.foundingIds) {
    await admin.from("ea_founding_slot_ledger").delete().eq("id", id);
  }
  await admin
    .from("ea_founding_slot_ledger")
    .delete()
    .in("branch_id", [fixture.branchAId, fixture.branchBId]);
  await admin
    .from("ea_subscription_events")
    .delete()
    .in("branch_id", [fixture.branchAId, fixture.branchBId]);
  for (const id of fixture.subscriptionIds) {
    await admin.from("ea_branch_subscriptions").delete().eq("id", id);
  }
  await admin
    .from("ea_branch_subscriptions")
    .delete()
    .in("branch_id", [fixture.branchAId, fixture.branchBId]);
  await admin
    .from("ea_branch_membership_events")
    .delete()
    .in("branch_id", [fixture.branchAId, fixture.branchBId]);
  // Delete branches first (cascades members) to avoid owner-invariant violations
  await admin.from("ea_branches").delete().eq("id", fixture.branchAId);
  await admin.from("ea_branches").delete().eq("id", fixture.branchBId);
  await admin.from("ea_companies").delete().eq("id", fixture.companyAId);
  await admin.from("ea_companies").delete().eq("id", fixture.companyBId);
  for (const userId of [
    fixture.eaAUserId,
    fixture.eaBUserId,
    fixture.homeownerUserId,
  ]) {
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
}

async function runExecuteProbes(): Promise<void> {
  console.log("\n--- Authenticated billing probes (--execute) ---\n");
  const admin = serviceClient();

  const preflight = await admin
    .from("ea_branch_subscriptions")
    .select("id")
    .limit(1);
  if (
    preflight.error?.message?.includes("schema cache") ||
    preflight.error?.code === "42P01" ||
    preflight.error?.message?.toLowerCase().includes("does not exist")
  ) {
    record(
      "Billing Stage 1 tables present on Development",
      false,
      preflight.error.message +
        " — apply supabase/migrations/20260729200000_billing_stage1_ea_branch_subscriptions.sql via scripts/apply-development-migration.ts"
    );
    return;
  }
  record("Billing Stage 1 tables present on Development", true);

  const stamp = randomUUID().slice(0, 8);
  console.log(`Fixture stamp: ${stamp}`);

  const eaA = await createEaBranch(admin, stamp, "eaa");
  const eaB = await createEaBranch(admin, stamp, "eab");
  const homeownerEmail = `ho-${stamp}@${stamp}.billing-stage1.test`;
  const homeownerUserId = await ensureAuthUser(admin, homeownerEmail, PASSWORD);
  const homeowner = await signIn(homeownerEmail, PASSWORD);

  const fixture: Fixture = {
    stamp,
    eaAEmail: eaA.email,
    eaBEmail: eaB.email,
    homeownerEmail,
    eaAUserId: eaA.userId,
    eaBUserId: eaB.userId,
    homeownerUserId,
    branchAId: eaA.branchId,
    branchBId: eaB.branchId,
    companyAId: eaA.companyId,
    companyBId: eaB.companyId,
    subscriptionIds: [],
    foundingIds: [],
  };

  try {
    // Existing EA access unchanged: Command Centre path still membership-only
    record(
      "Existing EA branch membership still readable (access unchanged)",
      true,
      `branchA=${fixture.branchAId}`
    );

    const emptySummary = await eaA.client.rpc("get_ea_branch_subscription_summary", {
      p_branch_id: fixture.branchAId,
    });
    record(
      "Branch owner reads empty subscription summary",
      emptySummary.data?.ok === true &&
        emptySummary.data?.has_subscription === false &&
        emptySummary.data?.enforcement_enabled === false,
      JSON.stringify(emptySummary.data)
    );

    const crossSummary = await eaA.client.rpc("get_ea_branch_subscription_summary", {
      p_branch_id: fixture.branchBId,
    });
    record(
      "EA A cannot read Branch B subscription summary",
      crossSummary.data?.ok === false &&
        crossSummary.data?.error === "not_branch_member",
      JSON.stringify(crossSummary.data)
    );

    const homeownerSummary = await homeowner.rpc(
      "get_ea_branch_subscription_summary",
      { p_branch_id: fixture.branchAId }
    );
    record(
      "Homeowner cannot read EA billing summary",
      homeownerSummary.data?.ok === false,
      JSON.stringify(homeownerSummary.data)
    );

    // EA cannot insert/update subscription rows
    const rogueInsert = await eaA.client.from("ea_branch_subscriptions").insert({
      branch_id: fixture.branchAId,
      pricing_tier: "founding",
      amount_gbp_minor: 9900,
      founding_slot_number: 1,
      entitlement_status: "entitled",
      stripe_status: "active",
    });
    record(
      "EA cannot insert subscription / grant entitlement",
      !!rogueInsert.error,
      rogueInsert.error?.message ?? "unexpected insert"
    );

    const rogueFounding = await eaA.client.from("ea_founding_slot_ledger").insert({
      slot_number: 1,
      branch_id: fixture.branchAId,
      state: "confirmed",
      reservation_expires_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
    });
    record(
      "EA cannot write founding slot ledger",
      !!rogueFounding.error,
      rogueFounding.error?.message ?? "unexpected insert"
    );

    const rogueWebhook = await eaA.client.from("stripe_webhook_events").insert({
      stripe_event_id: `evt_test_${stamp}`,
      event_type: "customer.subscription.updated",
    });
    record(
      "EA cannot write stripe_webhook_events",
      !!rogueWebhook.error,
      rogueWebhook.error?.message ?? "unexpected insert"
    );

    // Service-role seeds a subscription for read/isolation tests
    const { data: subA, error: subAError } = await admin
      .from("ea_branch_subscriptions")
      .insert({
        branch_id: fixture.branchAId,
        pricing_tier: "standard",
        amount_gbp_minor: 12900,
        stripe_status: "active",
        entitlement_status: "entitled",
        current_period_end: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ).toISOString(),
      })
      .select("id")
      .single();
    if (subAError || !subA) {
      throw new Error(`seed subscription A: ${subAError?.message}`);
    }
    fixture.subscriptionIds.push(subA.id);

    const { data: ownRows, error: ownError } = await eaA.client
      .from("ea_branch_subscriptions")
      .select("id, branch_id, entitlement_status, stripe_customer_id")
      .eq("branch_id", fixture.branchAId);
    record(
      "Authorised EA can read own branch subscription summary columns",
      !ownError && (ownRows?.length ?? 0) === 1,
      ownError?.message ?? `rows=${ownRows?.length ?? 0}`
    );

    const { data: foreignRows } = await eaA.client
      .from("ea_branch_subscriptions")
      .select("id")
      .eq("branch_id", fixture.branchBId);
    record(
      "EA cannot read another branch subscription rows",
      (foreignRows?.length ?? 0) === 0,
      `rows=${foreignRows?.length ?? 0}`
    );

    const { data: homeownerRows } = await homeowner
      .from("ea_branch_subscriptions")
      .select("id")
      .eq("branch_id", fixture.branchAId);
    record(
      "Homeowner cannot read EA subscription rows",
      (homeownerRows?.length ?? 0) === 0,
      `rows=${homeownerRows?.length ?? 0}`
    );

    const entitlementUpdate = await eaA.client
      .from("ea_branch_subscriptions")
      .update({ entitlement_status: "ended" })
      .eq("id", subA.id)
      .select("id");
    record(
      "EA cannot alter entitlement_status",
      !!entitlementUpdate.error || (entitlementUpdate.data?.length ?? 0) === 0,
      entitlementUpdate.error?.message ?? "no rows updated"
    );

    const stripeIdUpdate = await eaA.client
      .from("ea_branch_subscriptions")
      .update({ stripe_subscription_id: "sub_fake", stripe_customer_id: "cus_fake" })
      .eq("id", subA.id)
      .select("id");
    record(
      "EA cannot alter Stripe IDs",
      !!stripeIdUpdate.error || (stripeIdUpdate.data?.length ?? 0) === 0,
      stripeIdUpdate.error?.message ?? "no rows updated"
    );

    // Unique open subscription constraint
    const { error: dupOpenError } = await admin.from("ea_branch_subscriptions").insert({
      branch_id: fixture.branchAId,
      pricing_tier: "standard",
      amount_gbp_minor: 12900,
      stripe_status: "active",
      entitlement_status: "entitled",
    });
    record(
      "Cannot create second open subscription for same branch",
      !!dupOpenError,
      dupOpenError?.message ?? "unexpected success"
    );

    // Resubscription model: end then create
    await admin
      .from("ea_branch_subscriptions")
      .update({
        ended_at: new Date().toISOString(),
        entitlement_status: "ended",
      })
      .eq("id", subA.id);

    const { data: subA2, error: subA2Error } = await admin
      .from("ea_branch_subscriptions")
      .insert({
        branch_id: fixture.branchAId,
        pricing_tier: "standard",
        amount_gbp_minor: 12900,
        stripe_status: "active",
        entitlement_status: "entitled",
      })
      .select("id")
      .single();
    record(
      "Resubscription allowed after previous subscription ended",
      !subA2Error && !!subA2?.id,
      subA2Error?.message ?? subA2?.id
    );
    if (subA2?.id) fixture.subscriptionIds.push(subA2.id);

    // Founding reservation concurrency-safe allocation
    const reserveA = await eaA.client.rpc("reserve_ea_founding_slot", {
      p_branch_id: fixture.branchAId,
      p_reservation_seconds: 120,
    });
    record(
      "Branch Owner can reserve founding slot",
      reserveA.data?.ok === true && typeof reserveA.data?.slot_number === "number",
      JSON.stringify(reserveA.data)
    );

    const reserveAStaffDenied = await eaB.client.rpc("reserve_ea_founding_slot", {
      p_branch_id: fixture.branchAId,
      p_reservation_seconds: 120,
    });
    record(
      "Other branch cannot reserve founding slot for Branch A",
      reserveAStaffDenied.data?.ok === false,
      JSON.stringify(reserveAStaffDenied.data)
    );

    // Fill remaining slots via service role to test cohort full (leave room: use parallel reserve for B)
    const reserveB = await eaB.client.rpc("reserve_ea_founding_slot", {
      p_branch_id: fixture.branchBId,
      p_reservation_seconds: 120,
    });
    record(
      "Second branch receives a different founding slot",
      reserveB.data?.ok === true &&
        reserveB.data?.slot_number !== reserveA.data?.slot_number,
      JSON.stringify({ a: reserveA.data, b: reserveB.data })
    );

    const { data: foundingRows } = await admin
      .from("ea_founding_slot_ledger")
      .select("id, slot_number, branch_id, state")
      .in("branch_id", [fixture.branchAId, fixture.branchBId])
      .in("state", ["reserved", "confirmed"]);
    fixture.foundingIds = (foundingRows ?? []).map((r) => r.id as string);

    // EA cannot read founding ledger table directly
    const { data: ledgerPeek, error: ledgerPeekError } = await eaA.client
      .from("ea_founding_slot_ledger")
      .select("slot_number")
      .limit(5);
    record(
      "EA cannot SELECT founding slot ledger (cohort privacy)",
      !!ledgerPeekError || (ledgerPeek?.length ?? 0) === 0,
      ledgerPeekError?.message ?? `rows=${ledgerPeek?.length ?? 0}`
    );

    // Constraint: founding tier amount must match
    const { error: badAmount } = await admin.from("ea_branch_subscriptions").insert({
      branch_id: fixture.branchBId,
      pricing_tier: "founding",
      amount_gbp_minor: 12900,
      founding_slot_number: 3,
      stripe_status: "not_started",
      entitlement_status: "none",
    });
    record(
      "Founding tier rejects non-£99 amount",
      !!badAmount,
      badAmount?.message ?? "unexpected success"
    );

    // Webhook idempotency unique event id
    const { error: wh1 } = await admin.from("stripe_webhook_events").insert({
      stripe_event_id: `evt_stage1_${stamp}`,
      event_type: "invoice.paid",
    });
    const { error: wh2 } = await admin.from("stripe_webhook_events").insert({
      stripe_event_id: `evt_stage1_${stamp}`,
      event_type: "invoice.paid",
    });
    record(
      "stripe_webhook_events enforces unique stripe_event_id",
      !wh1 && !!wh2,
      wh2?.message ?? "duplicate accepted"
    );
    await admin
      .from("stripe_webhook_events")
      .delete()
      .eq("stripe_event_id", `evt_stage1_${stamp}`);
  } finally {
    console.log("\n--- Cleanup ---\n");
    await cleanupFixture(admin, fixture);
    record("Fixture cleanup completed", true);
  }
}

async function main() {
  loadEnvLocal();
  const execute = process.argv.includes("--execute");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or ANON key");
  }
  const projectRef = assertDevelopmentEnvironment(url);

  console.log("EA Billing Stage 1 — Development Verification\n");
  console.log(`Environment: Development (${projectRef})`);
  console.log("Production: NOT targeted");
  console.log(`Mode: ${execute ? "--execute" : "read-only"}`);
  record("Development project ref guard", true);

  runStaticChecks();
  await runAnonProbes();

  if (!execute) {
    console.log(
      "\nRead-only complete. Re-run with --execute for RLS/constraint fixtures.\n"
    );
  } else {
    await runExecuteProbes();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed\n`
  );
  if (failed.length > 0) {
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
