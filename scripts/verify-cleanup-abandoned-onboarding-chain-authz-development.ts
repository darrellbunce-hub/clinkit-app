/**
 * Development-only authz regression for cleanup_abandoned_onboarding_chain.
 *
 * CASE 1: Owner can clean up their abandoned empty chain
 * CASE 2: Different authenticated user is denied
 * CASE 3: Legitimate non-empty cleanup by owner still works
 * CASE 4: Invalid / foreign IDs cannot delete another chain
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-cleanup-abandoned-onboarding-chain-authz-development.ts
 *   npx tsx scripts/verify-cleanup-abandoned-onboarding-chain-authz-development.ts --execute
 *
 * Requires migration 20260905140000 applied on Development before --execute.
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "CleanupAuthzDev123!";
const TEST_EMAIL_PREFIX = "cleanup-authz";
const TEST_DOMAIN_SUFFIX = ".cleanup-authz.test";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION =
  "supabase/migrations/20260905140000_fix_cleanup_abandoned_onboarding_chain_empty_ownership.sql";

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
  console.log("\n--- Static migration checks ---\n");

  const migration = readProjectFile(MIGRATION);
  const joinCaller = readProjectFile("app/join-chain/page.tsx");

  record(
    "Migration gates empty path with created_by_user_id = auth.uid()",
    migration.includes("c.created_by_user_id = v_user_id") &&
      migration.includes("empty") &&
      migration.includes("not_authorized")
  );

  record(
    "Migration keeps SECURITY DEFINER + search_path = public",
    migration.includes("security definer") &&
      migration.includes("set search_path = public")
  );

  record(
    "Migration does not broaden EXECUTE (revoke public, grant authenticated)",
    migration.includes(
      "revoke all on function public.cleanup_abandoned_onboarding_chain(bigint) from public"
    ) &&
      migration.includes(
        "grant execute on function public.cleanup_abandoned_onboarding_chain(bigint) to authenticated"
      )
  );

  record(
    "Migration does not introduce a new underscore client helper",
    !migration.includes("create or replace function public._")
  );

  record(
    "join-chain remains the product caller",
    joinCaller.includes("cleanup_abandoned_onboarding_chain") &&
      joinCaller.includes("sourceChainId")
  );
}

async function ensureHomeownerProfile(
  client: SupabaseClient,
  userId: string,
  label: string
) {
  const { error } = await client.from("profiles").upsert(
    {
      id: userId,
      role: "homeowner",
      account_type: "homeowner",
      contact_name: `Cleanup ${label}`,
      onboarding_completed_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) {
    throw new Error(`profile ${label}: ${error.message}`);
  }
}

async function createEmptyOnboardingChain(
  client: SupabaseClient,
  stamp: string,
  label: string
): Promise<number> {
  const { data, error } = await client.rpc("create_chain_for_onboarding", {
    p_name: `Cleanup Empty ${label} ${stamp}`,
    p_access_code: `KN-CL${label.slice(0, 1).toUpperCase()}-${stamp.slice(-4).toUpperCase()}`,
  });
  if (error || !data?.ok || data.chain_id == null) {
    throw new Error(
      `create_chain_for_onboarding ${label}: ${error?.message ?? data?.error}`
    );
  }
  return data.chain_id as number;
}

async function cleanupFixtures(
  admin: SupabaseClient,
  userIds: string[],
  chainIds: number[]
) {
  for (const chainId of chainIds) {
    const { data: props } = await admin
      .from("properties")
      .select("id")
      .eq("chain_id", chainId);
    const propertyIds = (props ?? []).map((p) => p.id as number);
    if (propertyIds.length > 0) {
      await admin.from("property_members").delete().in("property_id", propertyIds);
      await admin.from("activities").delete().in("property_id", propertyIds);
      await admin.from("properties").delete().in("id", propertyIds);
    }
    await admin.from("chain_nodes").delete().eq("chain_id", chainId);
    await admin.from("chains").delete().eq("id", chainId);
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

  const ownerEmail = `${TEST_EMAIL_PREFIX}-owner-${stamp}@${stamp}${TEST_DOMAIN_SUFFIX}`;
  const strangerEmail = `${TEST_EMAIL_PREFIX}-stranger-${stamp}@${stamp}${TEST_DOMAIN_SUFFIX}`;

  const userIds: string[] = [];
  const chainIds: number[] = [];

  try {
    const ownerId = await ensureAuthUser(admin, ownerEmail);
    const strangerId = await ensureAuthUser(admin, strangerEmail);
    userIds.push(ownerId, strangerId);

    const owner = await signIn(ownerEmail);
    const stranger = await signIn(strangerEmail);
    await ensureHomeownerProfile(owner, ownerId, "owner");
    await ensureHomeownerProfile(stranger, strangerId, "stranger");

    // CASE 1 — owner cleans empty chain
    const emptyOwnedId = await createEmptyOnboardingChain(owner, stamp, "a");
    chainIds.push(emptyOwnedId);

    const { data: case1, error: case1Error } = await owner.rpc(
      "cleanup_abandoned_onboarding_chain",
      { p_chain_id: emptyOwnedId }
    );

    record(
      "CASE1 owner cleans abandoned empty chain",
      !case1Error && case1?.ok === true && case1?.empty_chain === true,
      case1Error?.message ?? JSON.stringify(case1)
    );

    const { data: gone } = await admin
      .from("chains")
      .select("id")
      .eq("id", emptyOwnedId)
      .maybeSingle();
    record("CASE1 empty chain row removed", !gone, JSON.stringify(gone));

    // CASE 2 — stranger denied on owner's empty chain
    const emptyVictimId = await createEmptyOnboardingChain(owner, stamp, "b");
    chainIds.push(emptyVictimId);

    const { data: case2, error: case2Error } = await stranger.rpc(
      "cleanup_abandoned_onboarding_chain",
      { p_chain_id: emptyVictimId }
    );

    record(
      "CASE2 stranger denied on foreign empty chain",
      !case2Error &&
        case2?.ok === false &&
        case2?.error === "not_authorized",
      case2Error?.message ?? JSON.stringify(case2)
    );

    const { data: stillThere } = await admin
      .from("chains")
      .select("id")
      .eq("id", emptyVictimId)
      .maybeSingle();
    record(
      "CASE2 foreign empty chain still exists",
      !!stillThere,
      JSON.stringify(stillThere)
    );

    // CASE 3 — non-empty owner cleanup still works
    const nonEmptyId = await createEmptyOnboardingChain(owner, stamp, "c");
    chainIds.push(nonEmptyId);

    const { data: prop, error: propError } = await owner
      .from("properties")
      .insert({
        chain_id: nonEmptyId,
        chain_position: 1,
        address: `Cleanup Sale ${stamp}`,
        postcode: "PO16 7AA",
        stage: "property_listed",
        status: "pending_connection",
        relationship_type: "sale",
        created_by_user_id: ownerId,
        buyer_connected: false,
        seller_connected: true,
        is_searching: false,
      })
      .select("id")
      .single();

    if (propError || !prop?.id) {
      throw new Error(`property insert: ${propError?.message}`);
    }

    const { data: case3, error: case3Error } = await owner.rpc(
      "cleanup_abandoned_onboarding_chain",
      { p_chain_id: nonEmptyId }
    );

    record(
      "CASE3 owner non-empty cleanup succeeds",
      !case3Error && case3?.ok === true && case3?.empty_chain !== true,
      case3Error?.message ?? JSON.stringify(case3)
    );

    // Stranger cannot clean non-empty foreign chain
    const nonEmptyForeign = await createEmptyOnboardingChain(owner, stamp, "d");
    chainIds.push(nonEmptyForeign);
    const { error: prop2Error } = await owner.from("properties").insert({
      chain_id: nonEmptyForeign,
      chain_position: 1,
      address: `Cleanup Foreign ${stamp}`,
      postcode: "PO16 7AB",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: ownerId,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    });
    if (prop2Error) {
      throw new Error(`foreign property insert: ${prop2Error.message}`);
    }

    const { data: case3b, error: case3bError } = await stranger.rpc(
      "cleanup_abandoned_onboarding_chain",
      { p_chain_id: nonEmptyForeign }
    );

    record(
      "CASE3 stranger denied on non-empty foreign chain",
      !case3bError &&
        case3b?.ok === false &&
        case3b?.error === "not_authorized",
      case3bError?.message ?? JSON.stringify(case3b)
    );

    // CASE 4 — invalid / non-existent ID
    const bogusId = 9_000_000_000_000 + Date.now();
    const { data: case4, error: case4Error } = await stranger.rpc(
      "cleanup_abandoned_onboarding_chain",
      { p_chain_id: bogusId }
    );

    record(
      "CASE4 bogus chain id denied",
      !case4Error &&
        case4?.ok === false &&
        case4?.error === "not_authorized",
      case4Error?.message ?? JSON.stringify(case4)
    );

    // Victim chain from CASE2 must still exist after CASE4
    const { data: victimStill } = await admin
      .from("chains")
      .select("id")
      .eq("id", emptyVictimId)
      .maybeSingle();
    record(
      "CASE4 did not delete unrelated victim chain",
      !!victimStill,
      JSON.stringify(victimStill)
    );

    // Catalog: function still SECURITY DEFINER; no new underscore helper required
    // (checked statically). Confirm victim chain can still be cleaned by owner.
    const { data: ownerCleanupVictim, error: ownerCleanupError } =
      await owner.rpc("cleanup_abandoned_onboarding_chain", {
        p_chain_id: emptyVictimId,
      });
    record(
      "Owner can still clean victim empty chain after stranger denial",
      !ownerCleanupError &&
        ownerCleanupVictim?.ok === true &&
        ownerCleanupVictim?.empty_chain === true,
      ownerCleanupError?.message ?? JSON.stringify(ownerCleanupVictim)
    );
  } finally {
    await cleanupFixtures(admin, userIds, chainIds);
  }
}

async function main() {
  const execute = process.argv.includes("--execute");
  runStaticChecks();

  if (!execute) {
    console.log(
      "\nStatic checks only. Re-run with --execute against Development after applying 20260905140000."
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
