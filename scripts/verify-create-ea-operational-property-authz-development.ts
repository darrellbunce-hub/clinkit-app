/**
 * Development-only authz regression for create_ea_operational_property.
 *
 * Proves:
 * 1. New EA origination (empty self-created chain) succeeds
 * 2. Second property on already-associated chain succeeds
 * 3. Unrelated chain injection is denied
 * 4. Wrong-branch injection is denied
 * 5. Non-EA / homeowner attempt fails
 * 6. Access-code join still succeeds (calls internal core)
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-create-ea-operational-property-authz-development.ts
 *   npx tsx scripts/verify-create-ea-operational-property-authz-development.ts --execute
 *
 * Requires migration 20260905120000 applied on Development before --execute.
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "EaPropAuthzDev123!";
const TEST_EMAIL_PREFIX = "ea-prop-authz";
const TEST_DOMAIN_SUFFIX = ".ea-prop-authz.test";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION =
  "supabase/migrations/20260905120000_fix_create_ea_operational_property_chain_authz.sql";

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

function readProjectFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function buildTestEmail(stamp: string, label: string): string {
  return `${TEST_EMAIL_PREFIX}-${label}-${stamp}@${stamp}${TEST_DOMAIN_SUFFIX}`;
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

function anonClient(): SupabaseClient {
  return createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function serviceClient(): SupabaseClient {
  return createClient(url!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) {
    throw new Error(`Sign in failed for ${email}: ${error.message}`);
  }
  return client;
}

async function ensureAuthUser(
  admin: SupabaseClient,
  email: string
): Promise<string> {
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
  if (!createError && created.user?.id) {
    return created.user.id;
  }
  if (
    createError &&
    !createError.message.toLowerCase().includes("already")
  ) {
    throw new Error(`createUser ${email}: ${createError.message}`);
  }

  const { data: listed, error: listError } =
    await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) throw listError;
  const existing = listed.users?.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase()
  );
  if (!existing?.id) {
    throw new Error(`Could not resolve auth user for ${email}`);
  }
  return existing.id;
}

async function deleteAuthUser(admin: SupabaseClient, userId: string) {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.warn(`cleanup auth user ${userId}: ${error.message}`);
  }
}

function runStaticChecks(): void {
  console.log("\n--- Static migration / authz checks ---\n");

  const migration = readProjectFile(MIGRATION);
  const targets = readProjectFile(
    "scripts/secdef-service-role-only-targets.json"
  );

  record(
    "Migration defines _create_ea_operational_property_core",
    migration.includes("_create_ea_operational_property_core")
  );

  record(
    "Migration revokes core EXECUTE from anon/authenticated",
    migration.includes(
      "revoke all on function public._create_ea_operational_property_core"
    ) && migration.includes("from public, anon, authenticated")
  );

  record(
    "Public create_ea_operational_property checks not_authorised_for_chain",
    migration.includes("not_authorised_for_chain") &&
      migration.includes("v_branch_authorised") &&
      migration.includes("v_empty_self_originated")
  );

  record(
    "Branch authz uses property_ea_assignments + p_branch_id",
    migration.includes("pea.branch_id = p_branch_id") &&
      migration.includes("pea.status = 'active'")
  );

  record(
    "Empty-chain exception requires created_by_user_id = auth.uid()",
    migration.includes("c.created_by_user_id = auth.uid()") &&
      migration.includes("not exists")
  );

  record(
    "join_ea_operational_chain calls core (not gated public RPC only)",
    migration.includes("join_ea_operational_chain") &&
      migration.includes(
        "return public._create_ea_operational_property_core("
      )
  );

  record(
    "No client-controlled bypass flags in migration",
    !/\bis_test\b|\bis_admin\b|\bbypass\b|\btrusted\b/i.test(migration)
  );

  record(
    "Core listed in service-role-only targets",
    targets.includes("_create_ea_operational_property_core")
  );
}

async function setupEaOwner(
  admin: SupabaseClient,
  stamp: string,
  label: string,
  companySuffix: string
): Promise<{
  userId: string;
  email: string;
  client: SupabaseClient;
  branchId: string;
  companyId: string;
}> {
  // Unique domain per owner — company email_domain must be exclusive.
  const domain = `${label}-${stamp}${TEST_DOMAIN_SUFFIX}`.replace(/^\./, "");
  const email = `${TEST_EMAIL_PREFIX}-${label}-${stamp}@${domain}`;
  const userId = await ensureAuthUser(admin, email);
  const client = await signIn(email);

  const profileResult = await createEstateAgentProfile(client, {
    userId,
    contactName: `EA Authz ${label}`,
    email,
  });
  if (profileResult.error) {
    throw new Error(profileResult.error);
  }

  const onboard = await completeEstateAgentOnboarding(client, {
    userId,
    companyName: `EA Prop Authz Co ${stamp}${companySuffix}`,
    branchName: `Branch ${label} ${stamp}`,
    townOrCity: "Fareham",
    postcode: "PO16 7AA",
    isHeadOffice: true,
    emailDomain: domain,
  });
  if (!onboard.success) {
    throw new Error(onboard.error);
  }

  const { data: membership, error: membershipError } = await client
    .from("ea_branch_members")
    .select("branch_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError || !membership?.branch_id) {
    throw new Error(
      `membership missing: ${membershipError?.message ?? "none"}`
    );
  }

  const { data: branch } = await admin
    .from("ea_branches")
    .select("id, company_id")
    .eq("id", membership.branch_id)
    .single();

  if (!branch?.company_id) {
    throw new Error("branch company missing");
  }

  return {
    userId,
    email,
    client,
    branchId: membership.branch_id as string,
    companyId: branch.company_id as string,
  };
}

async function setupHomeowner(
  admin: SupabaseClient,
  stamp: string
): Promise<{ userId: string; email: string; client: SupabaseClient }> {
  const email = buildTestEmail(stamp, "homeowner");
  const userId = await ensureAuthUser(admin, email);
  const client = await signIn(email);

  const { error } = await client.from("profiles").upsert(
    {
      id: userId,
      role: "homeowner",
      account_type: "homeowner",
      contact_name: "HO Authz",
      onboarding_completed_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) {
    throw new Error(`homeowner profile: ${error.message}`);
  }

  return { userId, email, client };
}

async function cleanupFixtures(
  admin: SupabaseClient,
  userIds: string[],
  chainIds: number[],
  branchIds: string[],
  companyIds: string[]
) {
  for (const chainId of chainIds) {
    const { data: props } = await admin
      .from("properties")
      .select("id")
      .eq("chain_id", chainId);
    const propertyIds = (props ?? []).map((p) => p.id as number);
    if (propertyIds.length > 0) {
      await admin
        .from("property_ea_assignments")
        .delete()
        .in("property_id", propertyIds);
      await admin
        .from("property_claim_metadata")
        .delete()
        .in("property_id", propertyIds);
      await admin.from("properties").delete().in("id", propertyIds);
    }
    await admin.from("chain_nodes").delete().eq("chain_id", chainId);
    await admin.from("chains").delete().eq("id", chainId);
  }

  for (const branchId of branchIds) {
    await admin.from("ea_branch_members").delete().eq("branch_id", branchId);
    await admin.from("ea_branches").delete().eq("id", branchId);
  }

  for (const companyId of companyIds) {
    await admin.from("ea_companies").delete().eq("id", companyId);
  }

  for (const userId of userIds) {
    await admin.from("profiles").delete().eq("id", userId);
    await deleteAuthUser(admin, userId);
  }
}

async function runExecuteChecks(): Promise<void> {
  console.log("\n--- Live Development authz scenarios ---\n");

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required for --execute"
    );
  }

  const projectRef = assertDevelopmentEnvironment(url);
  console.log(`Development project: ${projectRef}`);

  const admin = serviceClient();
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;

  const userIds: string[] = [];
  const chainIds: number[] = [];
  const branchIds: string[] = [];
  const companyIds: string[] = [];

  try {
    const eaA = await setupEaOwner(admin, stamp, "owner-a", "-A");
    const eaB = await setupEaOwner(admin, stamp, "owner-b", "-B");
    const homeowner = await setupHomeowner(admin, stamp);
    userIds.push(eaA.userId, eaB.userId, homeowner.userId);
    branchIds.push(eaA.branchId, eaB.branchId);
    companyIds.push(eaA.companyId, eaB.companyId);

    // CASE 1 — new EA origination
    const accessCodeA = `KN-AZA-${stamp.slice(-4).toUpperCase()}`;
    const { data: chainARpc, error: chainAError } = await eaA.client.rpc(
      "create_ea_operational_chain",
      {
        p_name: `Authz Chain A ${stamp}`,
        p_access_code: accessCodeA,
      }
    );
    if (chainAError || !chainARpc?.ok || chainARpc.chain_id == null) {
      throw new Error(
        `create_ea_operational_chain A failed: ${chainAError?.message ?? chainARpc?.error}`
      );
    }
    const chainAId = chainARpc.chain_id as number;
    chainIds.push(chainAId);

    const { data: saleA, error: saleAError } = await eaA.client.rpc(
      "create_ea_operational_property",
      {
        p_chain_id: chainAId,
        p_relationship_type: "sale",
        p_address: `1 Authz Sale ${stamp}`,
        p_postcode: "PO16 7AA",
        p_branch_id: eaA.branchId,
        p_homeowner_only_updates: false,
        p_awaiting_buyer: false,
      }
    );

    record(
      "CASE1 new EA origination succeeds",
      !saleAError && saleA?.ok === true && typeof saleA.property_id === "number",
      saleAError?.message ?? saleA?.error ?? JSON.stringify(saleA)
    );

    // CASE 2 — already associated: second property on same chain
    const { data: purchaseA, error: purchaseAError } = await eaA.client.rpc(
      "create_ea_operational_property",
      {
        p_chain_id: chainAId,
        p_relationship_type: "purchase",
        p_address: `2 Authz Purchase ${stamp}`,
        p_postcode: "PO16 7AB",
        p_branch_id: eaA.branchId,
        p_homeowner_only_updates: false,
        p_awaiting_buyer: false,
      }
    );

    record(
      "CASE2 EA-associated chain property creation succeeds",
      !purchaseAError &&
        purchaseA?.ok === true &&
        typeof purchaseA.property_id === "number",
      purchaseAError?.message ?? purchaseA?.error ?? JSON.stringify(purchaseA)
    );

    // Victim chain owned/operated by EA B
    const accessCodeB = `KN-AZB-${stamp.slice(-4).toUpperCase()}`;
    const { data: chainBRpc, error: chainBError } = await eaB.client.rpc(
      "create_ea_operational_chain",
      {
        p_name: `Authz Chain B ${stamp}`,
        p_access_code: accessCodeB,
      }
    );
    if (chainBError || !chainBRpc?.ok || chainBRpc.chain_id == null) {
      throw new Error(
        `create_ea_operational_chain B failed: ${chainBError?.message ?? chainBRpc?.error}`
      );
    }
    const chainBId = chainBRpc.chain_id as number;
    chainIds.push(chainBId);

    const { data: saleB, error: saleBError } = await eaB.client.rpc(
      "create_ea_operational_property",
      {
        p_chain_id: chainBId,
        p_relationship_type: "sale",
        p_address: `9 Victim Sale ${stamp}`,
        p_postcode: "PO16 7ZZ",
        p_branch_id: eaB.branchId,
        p_homeowner_only_updates: false,
        p_awaiting_buyer: false,
      }
    );
    if (saleBError || !saleB?.ok) {
      throw new Error(
        `victim property setup failed: ${saleBError?.message ?? saleB?.error}`
      );
    }

    // CASE 3 — unrelated chain injection (critical)
    const { data: inject, error: injectError } = await eaA.client.rpc(
      "create_ea_operational_property",
      {
        p_chain_id: chainBId,
        p_relationship_type: "sale",
        p_address: `Injected ${stamp}`,
        p_postcode: "PO16 7IN",
        p_branch_id: eaA.branchId,
        p_homeowner_only_updates: false,
        p_awaiting_buyer: false,
      }
    );

    record(
      "CASE3 unrelated chain injection DENIED",
      !injectError && inject?.ok === false && inject?.error === "not_authorised_for_chain",
      injectError?.message ?? JSON.stringify(inject)
    );

    // CASE 4 — wrong branch: EA A tries with EA B's branch id (not a member)
    const { data: wrongBranch, error: wrongBranchError } = await eaA.client.rpc(
      "create_ea_operational_property",
      {
        p_chain_id: chainBId,
        p_relationship_type: "sale",
        p_address: `Wrong Branch ${stamp}`,
        p_postcode: "PO16 7WB",
        p_branch_id: eaB.branchId,
        p_homeowner_only_updates: false,
        p_awaiting_buyer: false,
      }
    );

    record(
      "CASE4 wrong-branch injection DENIED",
      (!wrongBranchError &&
        wrongBranch?.ok === false &&
        (wrongBranch?.error === "not_ea_branch_member" ||
          wrongBranch?.error === "not_authorised_for_chain")) ||
        (wrongBranchError?.message?.toLowerCase().includes("permission") ??
          false),
      wrongBranchError?.message ?? JSON.stringify(wrongBranch)
    );

    // CASE 5 — homeowner / non-EA
    const { data: hoAttempt, error: hoError } = await homeowner.client.rpc(
      "create_ea_operational_property",
      {
        p_chain_id: chainAId,
        p_relationship_type: "sale",
        p_address: `HO Inject ${stamp}`,
        p_postcode: "PO16 7HO",
        p_branch_id: eaA.branchId,
        p_homeowner_only_updates: false,
        p_awaiting_buyer: false,
      }
    );

    record(
      "CASE5 non-EA attempt DENIED",
      !hoError &&
        hoAttempt?.ok === false &&
        hoAttempt?.error === "not_ea_branch_member",
      hoError?.message ?? JSON.stringify(hoAttempt)
    );

    // Access-code join still works for EA A onto chain B
    const { data: joinRpc, error: joinError } = await eaA.client.rpc(
      "join_ea_operational_chain",
      {
        p_access_code: accessCodeB,
        p_relationship_type: "purchase",
        p_address: `Joined Purchase ${stamp}`,
        p_postcode: "PO16 7JN",
        p_branch_id: eaA.branchId,
        p_homeowner_only_updates: false,
        p_awaiting_buyer: false,
      }
    );

    record(
      "Access-code join still succeeds",
      !joinError && joinRpc?.ok === true && typeof joinRpc.property_id === "number",
      joinError?.message ?? joinRpc?.error ?? JSON.stringify(joinRpc)
    );

    // Core must not be callable by authenticated clients
    const { data: coreData, error: coreError } = await eaA.client.rpc(
      "_create_ea_operational_property_core" as never,
      {
        p_chain_id: chainBId,
        p_relationship_type: "sale",
        p_address: `Core Direct ${stamp}`,
        p_postcode: "PO16 7CR",
        p_branch_id: eaA.branchId,
        p_homeowner_only_updates: false,
        p_awaiting_buyer: false,
      } as never
    );

    const coreDenied =
      !!coreError ||
      (coreData as { ok?: boolean } | null)?.ok === false ||
      coreError?.code === "PGRST202" ||
      (coreError?.message?.toLowerCase().includes("permission") ?? false) ||
      (coreError?.message?.toLowerCase().includes("could not find") ?? false);

    record(
      "Internal core not executable by authenticated client",
      coreDenied,
      coreError?.message ?? JSON.stringify(coreData)
    );
  } finally {
    await cleanupFixtures(admin, userIds, chainIds, branchIds, companyIds);
  }
}

async function main() {
  const execute = process.argv.includes("--execute");

  runStaticChecks();

  if (!execute) {
    console.log(
      "\nStatic checks only. Re-run with --execute against Development after applying 20260905120000."
    );
  } else {
    await runExecuteChecks();
  }

  const failed = results.filter((r) => !r.pass).length;
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${passed + failed} checks passed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
