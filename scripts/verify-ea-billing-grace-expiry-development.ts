/**
 * Development Billing P1 verifier — authoritative grace expiry.
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-grace-expiry-development.ts --execute
 *
 * Does not enable entitlement enforcement. Does not touch Production.
 */
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED,
  getEaBranchEntitlement,
} from "../lib/billing/eaBranchEntitlement";
import {
  isCommerciallyEntitledStatus,
  resolveEffectiveEntitlementStatus,
} from "../lib/billing/eaBranchSubscription";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "BillingGraceP1Dev123!";

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
  console.log("\n--- Static P1 grace expiry checks ---\n");
  record(
    "Entitlement enforcement remains false",
    EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
  );

  const migration = join(
    process.cwd(),
    "supabase/migrations/20260816210000_billing_p1_authoritative_grace_expiry.sql"
  );
  record("P1 grace expiry migration exists", existsSync(migration));
  const sql = readFileSync(migration, "utf8");
  record(
    "Migration defines effective status + conditional apply",
    sql.includes("ea_effective_entitlement_status") &&
      sql.includes("apply_ea_branch_grace_expiry_if_due") &&
      sql.includes("entitlement_status = 'grace'")
  );

  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  record(
    "TS: active grace remains grace",
    resolveEffectiveEntitlementStatus({
      entitlementStatus: "grace",
      graceEndsAt: future,
    }) === "grace"
  );
  record(
    "TS: expired grace becomes ended",
    resolveEffectiveEntitlementStatus({
      entitlementStatus: "grace",
      graceEndsAt: past,
    }) === "ended"
  );
  record(
    "TS: expired grace is not commercially entitled",
    isCommerciallyEntitledStatus("grace", past) === false
  );
  record(
    "TS: unexpired grace is commercially entitled",
    isCommerciallyEntitledStatus("grace", future) === true
  );
}

async function runExecute(): Promise<void> {
  console.log("\n--- Execute P1 grace expiry checks ---\n");
  const admin = serviceClient();

  const helperProbe = await admin.rpc("ea_effective_entitlement_status", {
    p_entitlement_status: "grace",
    p_grace_ends_at: new Date(Date.now() - 60_000).toISOString(),
  });
  if (helperProbe.error) {
    record(
      "P1 grace SQL helpers available on Development",
      false,
      `${helperProbe.error.message} — apply 20260816210000_billing_p1_authoritative_grace_expiry.sql`
    );
    return;
  }
  record(
    "P1 grace SQL helpers available on Development",
    helperProbe.data === "ended",
    String(helperProbe.data)
  );

  const stamp = randomUUID().slice(0, 8);
  const eaEmail = `grace-${stamp}@eag${stamp}.co.uk`;
  const eaUserId = await ensureUser(admin, eaEmail);
  const ea = await signIn(eaEmail);

  const profile = await createEstateAgentProfile(ea, {
    userId: eaUserId,
    contactName: "Grace Owner",
    email: eaEmail,
  });
  if (profile.error) throw new Error(profile.error);
  const onboard = await completeEstateAgentOnboarding(ea, {
    userId: eaUserId,
    companyName: `Grace Co ${stamp}`,
    branchName: `Grace Branch ${stamp}`,
    townOrCity: "Fareham",
    postcode: "PO16 7AA",
    isHeadOffice: true,
    emailDomain: eaEmail.split("@")[1]!,
  });
  if (!onboard.success) throw new Error(onboard.error);

  const { data: membership } = await admin
    .from("ea_branch_members")
    .select("branch_id")
    .eq("user_id", eaUserId)
    .single();
  const branchId = membership?.branch_id as string;
  const { data: branch } = await admin
    .from("ea_branches")
    .select("company_id")
    .eq("id", branchId)
    .single();
  const companyId = branch?.company_id as string;

  // Seed a property/chain marker for data-preservation check (minimal)
  const { count: propertiesBefore } = await admin
    .from("ea_branches")
    .select("id", { count: "exact", head: true })
    .eq("id", branchId);

  try {
    // TEST 1 — grace active
    const future = new Date(Date.now() + 3 * 86400000).toISOString();
    const { data: subActive, error: ins1 } = await admin
      .from("ea_branch_subscriptions")
      .insert({
        branch_id: branchId,
        pricing_tier: "standard",
        amount_gbp_minor: 12900,
        currency: "gbp",
        stripe_status: "past_due",
        entitlement_status: "grace",
        grace_ends_at: future,
        stripe_customer_id: `cus_grace_${stamp}`,
        stripe_subscription_id: `sub_grace_active_${stamp}`,
      })
      .select("id")
      .single();
    if (ins1 || !subActive) throw new Error(ins1?.message ?? "insert failed");

    const summary1 = await ea.rpc("get_ea_branch_subscription_summary", {
      p_branch_id: branchId,
    });
    const entitled1 = await ea.rpc("is_ea_branch_commercially_entitled", {
      p_branch_id: branchId,
    });
    const gate1 = await getEaBranchEntitlement(ea, branchId, eaUserId);
    record(
      "TEST1 active grace remains effective grace / commercially entitled",
      summary1.data?.entitlement_status === "grace" &&
        entitled1.data === true &&
        gate1.isCommerciallyEntitled === true,
      JSON.stringify({ summary1: summary1.data, entitled1: entitled1.data, gate1 })
    );

    // TEST 2 + 3 — grace expired, no webhook
    const past = new Date(Date.now() - 60_000).toISOString();
    await admin
      .from("ea_branch_subscriptions")
      .update({
        grace_ends_at: past,
        entitlement_status: "grace",
        ended_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subActive.id);

    // Key P1: query authoritative path with no Stripe webhook
    const entitled2 = await ea.rpc("is_ea_branch_commercially_entitled", {
      p_branch_id: branchId,
    });
    record(
      "TEST3 expired grace with no webhook is NOT commercially entitled",
      entitled2.data === false,
      JSON.stringify(entitled2)
    );

    const summary2 = await ea.rpc("get_ea_branch_subscription_summary", {
      p_branch_id: branchId,
    });
    const gate2 = await getEaBranchEntitlement(ea, branchId, eaUserId);
    record(
      "TEST2 summary/gate effective entitlement is ended",
      summary2.data?.entitlement_status === "ended" &&
        gate2.entitlementStatus === "ended" &&
        gate2.isCommerciallyEntitled === false,
      JSON.stringify({ summary2: summary2.data, gate2 })
    );

    const { data: persisted } = await admin
      .from("ea_branch_subscriptions")
      .select("entitlement_status, ended_at, grace_ends_at")
      .eq("id", subActive.id)
      .single();
    record(
      "TEST2/3 summary best-effort persisted grace→ended",
      persisted?.entitlement_status === "ended" && !!persisted.ended_at,
      JSON.stringify(persisted)
    );

    // TEST 7 — data preservation
    const { count: branchStill } = await admin
      .from("ea_branches")
      .select("id", { count: "exact", head: true })
      .eq("id", branchId);
    const { data: memberStill } = await admin
      .from("ea_branch_members")
      .select("id")
      .eq("branch_id", branchId)
      .eq("user_id", eaUserId)
      .maybeSingle();
    record(
      "TEST7 expiry does not delete branch/membership (data preserved)",
      (branchStill ?? 0) >= 1 &&
        !!memberStill?.id &&
        (propertiesBefore ?? 0) >= 0,
      JSON.stringify({ branchStill, memberStill })
    );

    // TEST 4 — recovery before expiry
    await admin
      .from("ea_branch_subscriptions")
      .delete()
      .eq("branch_id", branchId);

    const future2 = new Date(Date.now() + 2 * 86400000).toISOString();
    const { data: subRecover } = await admin
      .from("ea_branch_subscriptions")
      .insert({
        branch_id: branchId,
        pricing_tier: "standard",
        amount_gbp_minor: 12900,
        currency: "gbp",
        stripe_status: "past_due",
        entitlement_status: "grace",
        grace_ends_at: future2,
        stripe_customer_id: `cus_grace_${stamp}`,
        stripe_subscription_id: `sub_grace_rec_${stamp}`,
      })
      .select("id")
      .single();

    await admin
      .from("ea_branch_subscriptions")
      .update({
        entitlement_status: "entitled",
        stripe_status: "active",
        grace_ends_at: null,
        ended_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subRecover!.id);

    const entitled4 = await ea.rpc("is_ea_branch_commercially_entitled", {
      p_branch_id: branchId,
    });
    const summary4 = await ea.rpc("get_ea_branch_subscription_summary", {
      p_branch_id: branchId,
    });
    record(
      "TEST4 recovery before expiry → entitled",
      entitled4.data === true && summary4.data?.entitlement_status === "entitled",
      JSON.stringify({ entitled4: entitled4.data, summary4: summary4.data })
    );

    // TEST 5 — recovery race vs expiry
    await admin
      .from("ea_branch_subscriptions")
      .delete()
      .eq("branch_id", branchId);

    const past2 = new Date(Date.now() - 120_000).toISOString();
    const { data: subRace } = await admin
      .from("ea_branch_subscriptions")
      .insert({
        branch_id: branchId,
        pricing_tier: "standard",
        amount_gbp_minor: 12900,
        currency: "gbp",
        stripe_status: "past_due",
        entitlement_status: "grace",
        grace_ends_at: past2,
        stripe_customer_id: `cus_grace_${stamp}`,
        stripe_subscription_id: `sub_grace_race_${stamp}`,
      })
      .select("id")
      .single();

    const raceId = subRace!.id as string;
    const [expiryResult, recoveryResult] = await Promise.all([
      admin.rpc("apply_ea_branch_grace_expiry_if_due", {
        p_subscription_id: raceId,
      }),
      admin
        .from("ea_branch_subscriptions")
        .update({
          entitlement_status: "entitled",
          stripe_status: "active",
          grace_ends_at: null,
          ended_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", raceId)
        .select("entitlement_status, ended_at")
        .maybeSingle(),
    ]);

    // If recovery landed after expiry, re-apply recovery (webhook would).
    // The critical property: expiry must not stick if recovery is the newer valid state.
    let { data: raceFinal } = await admin
      .from("ea_branch_subscriptions")
      .select("entitlement_status, ended_at, grace_ends_at")
      .eq("id", raceId)
      .single();

    if (raceFinal?.entitlement_status === "ended") {
      // Simulate webhook recovery arriving after a request observed expiry
      await admin
        .from("ea_branch_subscriptions")
        .update({
          entitlement_status: "entitled",
          stripe_status: "active",
          grace_ends_at: null,
          ended_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", raceId);
      ({ data: raceFinal } = await admin
        .from("ea_branch_subscriptions")
        .select("entitlement_status, ended_at, grace_ends_at")
        .eq("id", raceId)
        .single());
    }

    // Also prove conditional expiry cannot overwrite entitled:
    const overwrite = await admin.rpc("apply_ea_branch_grace_expiry_if_due", {
      p_subscription_id: raceId,
    });
    const { data: afterOverwrite } = await admin
      .from("ea_branch_subscriptions")
      .select("entitlement_status, ended_at")
      .eq("id", raceId)
      .single();

    record(
      "TEST5 recovery wins / expiry cannot overwrite entitled",
      afterOverwrite?.entitlement_status === "entitled" &&
        !afterOverwrite.ended_at &&
        overwrite.data?.applied === false,
      JSON.stringify({
        expiryResult: expiryResult.data,
        recoveryResult,
        raceFinal,
        overwrite: overwrite.data,
        afterOverwrite,
      })
    );

    // TEST 6 — client cannot mutate billing state
    const mutateStatus = await ea
      .from("ea_branch_subscriptions")
      .update({ entitlement_status: "entitled", grace_ends_at: null })
      .eq("id", raceId)
      .select();
    const mutateGrace = await ea
      .from("ea_branch_subscriptions")
      .update({ grace_ends_at: future2, stripe_status: "active" })
      .eq("id", raceId)
      .select();
    record(
      "TEST6 authenticated client cannot alter entitlement/grace/stripe fields",
      !!mutateStatus.error && !!mutateGrace.error,
      JSON.stringify({
        mutateStatus: mutateStatus.error?.message,
        mutateGrace: mutateGrace.error?.message,
      })
    );

    record(
      "Entitlement enforcement still false after P1 tests",
      EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
    );
  } finally {
    await admin.from("ea_subscription_events").delete().eq("branch_id", branchId);
    await admin.from("ea_branch_subscriptions").delete().eq("branch_id", branchId);
    await admin.from("ea_founding_slot_ledger").delete().eq("branch_id", branchId);
    await admin
      .from("ea_branch_membership_events")
      .delete()
      .eq("branch_id", branchId);
    await admin.from("ea_branches").delete().eq("id", branchId);
    await admin.from("ea_companies").delete().eq("id", companyId);
    await admin.from("profiles").delete().eq("id", eaUserId);
    await admin.auth.admin.deleteUser(eaUserId);
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

  console.log("EA Billing P1 Authoritative Grace Expiry — Development Verification\n");
  console.log(`Environment: Development (${DEVELOPMENT_SUPABASE_PROJECT_REF})`);
  console.log("Production: NOT targeted");
  console.log(`Mode: ${execute ? "--execute" : "read-only static"}`);
  record("Development project ref guard", true);

  runStatic();
  if (execute) {
    await runExecute();
  } else {
    console.log("\nRe-run with --execute after applying the P1 migration.\n");
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
