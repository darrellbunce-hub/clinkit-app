/**
 * Development-only SEC-104 RPC rate-limiting verification.
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-sec104-rate-limiting-development.ts
 *   npx tsx scripts/verify-sec104-rate-limiting-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const TEST_EMAIL_PREFIX = "sec104-rl";
const TEST_DOMAIN_SUFFIX = ".sec104-rl.test";
const PASSWORD = "Sec104RateLimitDev123!";
const MIGRATION_PATH =
  "supabase/migrations/20260729120000_sec104_rpc_rate_limiting.sql";

const ROOT = join(import.meta.dirname, "..");

type TestResult = { name: string; pass: boolean; detail?: string };

const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function readProjectFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
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

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Sign in failed for ${email}: ${error.message}`);
  }
  return client;
}

async function ensureAuthUser(
  admin: SupabaseClient,
  email: string,
  password: string
): Promise<string> {
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
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
  console.log("\n--- Static SEC-104 rate-limit checks ---\n");

  const migration = readProjectFile(MIGRATION_PATH);

  record(
    "Migration defines rpc_rate_limit_buckets table",
    migration.includes("create table if not exists public.rpc_rate_limit_buckets"),
    MIGRATION_PATH
  );

  record(
    "Bucket table revokes anon/authenticated direct access",
    migration.includes(
      "revoke all on table public.rpc_rate_limit_buckets from authenticated"
    ) &&
      migration.includes(
        "revoke all on table public.rpc_rate_limit_buckets from anon"
      ),
    MIGRATION_PATH
  );

  record(
    "Atomic record_attempt uses ON CONFLICT DO UPDATE",
    migration.includes("on conflict (scope, subject_key, window_started_at)") &&
      migration.includes("attempt_count = b.attempt_count + 1"),
    MIGRATION_PATH
  );

  record(
    "Internal helpers revoke client EXECUTE",
    migration.includes(
      "revoke all on function public._rate_limit_record_attempt"
    ) &&
      migration.includes(
        "revoke all on function public._rate_limit_is_blocked"
      ),
    MIGRATION_PATH
  );

  const helperRevoke = readProjectFile(
    "supabase/migrations/20260729130000_sec104_revoke_internal_rate_limit_helpers.sql"
  );

  record(
    "Follow-up migration revokes helpers from PUBLIC, anon, and authenticated",
    helperRevoke.includes("from public") &&
      helperRevoke.includes("from anon") &&
      helperRevoke.includes("from authenticated") &&
      helperRevoke.includes("_rate_limit_window_start(integer)") &&
      helperRevoke.includes("_rate_limit_cleanup_subject(text, text, integer)") &&
      helperRevoke.includes("_rate_limit_is_blocked(text, text, integer, integer)") &&
      helperRevoke.includes("_rate_limit_record_attempt(text, text, integer)") &&
      helperRevoke.includes("_rate_limit_try_consume(text, text, integer, integer)"),
    "20260729130000_sec104_revoke_internal_rate_limit_helpers.sql"
  );

  record(
    "join_chain_property checks throttle before match",
    migration.includes("_rate_limit_is_blocked(c_scope, v_subject, c_limit, c_window)") &&
      migration.includes("c_scope constant text := 'join_chain_failed'"),
    MIGRATION_PATH
  );

  record(
    "join rate-limit public error remains join_details_not_matched",
    /_rate_limit_is_blocked[\s\S]*?join_details_not_matched/.test(migration),
    MIGRATION_PATH
  );

  record(
    "Successful join does not record failed attempt (comment + structure)",
    migration.includes(
      "Successful joins do not consume failed-attempt allowance"
    ),
    MIGRATION_PATH
  );

  record(
    "claim_operational_property throttles failed attempts",
    migration.includes("c_scope constant text := 'claim_property_failed'") &&
      migration.includes("c_limit constant integer := 15"),
    MIGRATION_PATH
  );

  record(
    "Homeowner create_chain limit distinct from EA",
    migration.includes("create_chain_homeowner") &&
      migration.includes("create_chain_ea") &&
      migration.includes("c_limit constant integer := 10") &&
      migration.includes("c_limit constant integer := 40"),
    MIGRATION_PATH
  );

  record(
    "upsert_operational_summaries retains authenticated grant + throttle",
    migration.includes("upsert_operational_summaries") &&
      migration.includes(
        "grant execute on function public.upsert_operational_summaries"
      ) &&
      migration.includes("c_limit constant integer := 60"),
    MIGRATION_PATH
  );

  record(
    "Address validation deferred P3 (not over-engineered)",
    migration.includes("DEFERRED P3"),
    MIGRATION_PATH
  );

  record(
    "Invitation send security file unchanged by this migration",
    readProjectFile("lib/communications/invitationSendSecurity.ts").includes(
      "RATE_LIMIT_MAX_SENDS = 3"
    ),
    "invitationSendSecurity.ts"
  );
}

async function assertHelperNotExecutable(
  client: SupabaseClient,
  label: string,
  fnName: string,
  args: Record<string, unknown>
): Promise<void> {
  const { data, error } = await client.rpc(fnName, args);
  const blocked =
    !!error &&
    (error.code === "42501" ||
      error.message.toLowerCase().includes("permission denied") ||
      error.message.toLowerCase().includes("could not find the function"));

  record(
    `${label} cannot EXECUTE ${fnName}`,
    blocked,
    error?.message ?? `callable data=${JSON.stringify(data)}`
  );
}

async function runAnonProbes(): Promise<void> {
  console.log("\n--- Anon / authenticated ledger access probes ---\n");

  const anon = anonClient();

  const { data: anonSelect, error: anonSelectError } = await anon
    .from("rpc_rate_limit_buckets")
    .select("*")
    .limit(1);

  record(
    "Anon cannot SELECT rpc_rate_limit_buckets",
    !!anonSelectError || (anonSelect?.length ?? 0) === 0,
    anonSelectError?.message ?? `rows=${anonSelect?.length ?? 0}`
  );

  const { error: anonInsertError } = await anon
    .from("rpc_rate_limit_buckets")
    .insert({
      scope: "join_chain_failed",
      subject_key: "probe",
      window_started_at: new Date().toISOString(),
      attempt_count: 1,
    });

  record(
    "Anon cannot INSERT rpc_rate_limit_buckets",
    !!anonInsertError,
    anonInsertError?.message ?? "insert allowed"
  );

  await assertHelperNotExecutable(anon, "Anon", "_rate_limit_window_start", {
    p_window_seconds: 900,
  });
  await assertHelperNotExecutable(anon, "Anon", "_rate_limit_is_blocked", {
    p_scope: "join_chain_failed",
    p_subject_key: "probe",
    p_limit: 10,
    p_window_seconds: 900,
  });
  await assertHelperNotExecutable(anon, "Anon", "_rate_limit_record_attempt", {
    p_scope: "join_chain_failed",
    p_subject_key: "probe",
    p_window_seconds: 900,
  });
  await assertHelperNotExecutable(anon, "Anon", "_rate_limit_try_consume", {
    p_scope: "join_chain_failed",
    p_subject_key: "probe",
    p_limit: 10,
    p_window_seconds: 900,
  });
  await assertHelperNotExecutable(anon, "Anon", "_rate_limit_cleanup_subject", {
    p_scope: "join_chain_failed",
    p_subject_key: "probe",
    p_retain_seconds: 3600,
  });
}

type FixtureContext = {
  stamp: string;
  hostEmail: string;
  strangerEmail: string;
  hostUserId: string;
  strangerUserId: string;
  chainId: number;
  accessCode: string;
  salePropertyId: number;
  saleAddress: string;
  salePostcode: string;
};

async function createFixture(
  admin: SupabaseClient,
  stamp: string
): Promise<FixtureContext> {
  const hostEmail = buildTestEmail(stamp, "host");
  const strangerEmail = buildTestEmail(stamp, "stranger");

  const hostUserId = await ensureAuthUser(admin, hostEmail, PASSWORD);
  const strangerUserId = await ensureAuthUser(admin, strangerEmail, PASSWORD);

  const host = await signIn(hostEmail, PASSWORD);

  const alnum = stamp.replace(/[^A-Z0-9]/gi, "").toUpperCase().padEnd(7, "X");
  const accessCode = `KN-${alnum.slice(0, 3)}-${alnum.slice(3, 7)}`;

  const { data: chain, error: chainError } = await host.rpc(
    "create_chain_for_onboarding",
    {
      p_name: `SEC104-${stamp}`,
      p_access_code: accessCode,
    }
  );

  if (chainError || !chain?.ok) {
    throw new Error(
      `create_chain_for_onboarding failed: ${chainError?.message ?? chain?.error}`
    );
  }

  const saleAddress = `10 Sec104 Lane ${stamp}`;
  const salePostcode = "RL1 1AA";

  const { data: saleProperty, error: saleError } = await host
    .from("properties")
    .insert({
      chain_id: chain.chain_id,
      chain_position: 1,
      address: saleAddress,
      postcode: salePostcode,
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: hostUserId,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();

  if (saleError || !saleProperty) {
    throw new Error(`sale property insert failed: ${saleError?.message}`);
  }

  const { data: establishData, error: establishError } = await host.rpc(
    "establish_operational_homeowner_for_created_property",
    { p_property_id: saleProperty.id }
  );

  if (establishError || !establishData?.ok) {
    throw new Error(
      `establish failed: ${establishError?.message ?? establishData?.error}`
    );
  }

  return {
    stamp,
    hostEmail,
    strangerEmail,
    hostUserId,
    strangerUserId,
    chainId: chain.chain_id as number,
    accessCode,
    salePropertyId: saleProperty.id as number,
    saleAddress,
    salePostcode,
  };
}

async function cleanupFixture(
  admin: SupabaseClient,
  fixture: FixtureContext
): Promise<void> {
  const deleteEq = async (
    table: string,
    column: string,
    value: string | number
  ) => {
    const { error } = await admin.from(table).delete().eq(column, value);
    if (error) {
      console.warn(`cleanup ${table}.${column}=${value}: ${error.message}`);
    }
  };

  await admin
    .from("rpc_rate_limit_buckets")
    .delete()
    .in("subject_key", [
      fixture.hostUserId,
      fixture.strangerUserId,
      `${fixture.hostUserId}:${fixture.chainId}`,
      `${fixture.strangerUserId}:${fixture.chainId}`,
    ]);

  const { data: properties } = await admin
    .from("properties")
    .select("id")
    .eq("chain_id", fixture.chainId);

  for (const property of properties ?? []) {
    await deleteEq("activities", "property_id", property.id);
    await deleteEq(
      "property_counterparty_participants",
      "property_id",
      property.id
    );
    await deleteEq(
      "property_operational_identities",
      "property_id",
      property.id
    );
    await deleteEq("property_members", "property_id", property.id);
    await deleteEq("property_operational_summary", "property_id", property.id);
    await deleteEq("properties", "id", property.id);
  }

  await deleteEq("chain_operational_summary", "chain_id", fixture.chainId);
  await deleteEq("chains", "id", fixture.chainId);

  for (const userId of [fixture.hostUserId, fixture.strangerUserId]) {
    await deleteEq("profiles", "id", userId);
    await deleteAuthUser(admin, userId);
  }
}

async function countMembership(
  admin: SupabaseClient,
  propertyId: number,
  userId: string
): Promise<number> {
  const { count } = await admin
    .from("property_members")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId)
    .eq("user_id", userId);
  return count ?? 0;
}

async function readPropertySnapshot(
  admin: SupabaseClient,
  propertyId: number
) {
  const { data } = await admin
    .from("properties")
    .select("status, buyer_connected, seller_connected")
    .eq("id", propertyId)
    .maybeSingle();
  return data;
}

async function runExecuteProbes(fixture: FixtureContext): Promise<void> {
  console.log("\n--- Adversarial SEC-104 probes (--execute) ---\n");

  const admin = serviceClient();
  const stranger = await signIn(fixture.strangerEmail, PASSWORD);
  const host = await signIn(fixture.hostEmail, PASSWORD);

  const { data: authSelect, error: authSelectError } = await stranger
    .from("rpc_rate_limit_buckets")
    .select("*")
    .limit(1);

  record(
    "Authenticated client cannot SELECT rate-limit ledger",
    !!authSelectError || (authSelect?.length ?? 0) === 0,
    authSelectError?.message ?? `rows=${authSelect?.length ?? 0}`
  );

  const { error: authDeleteError } = await stranger
    .from("rpc_rate_limit_buckets")
    .delete()
    .eq("subject_key", fixture.strangerUserId);

  record(
    "Authenticated client cannot DELETE own rate-limit rows",
    !!authDeleteError,
    authDeleteError?.message ?? "delete allowed"
  );

  await assertHelperNotExecutable(
    stranger,
    "Authenticated client",
    "_rate_limit_window_start",
    { p_window_seconds: 900 }
  );
  await assertHelperNotExecutable(
    stranger,
    "Authenticated client",
    "_rate_limit_is_blocked",
    {
      p_scope: "join_chain_failed",
      p_subject_key: fixture.strangerUserId,
      p_limit: 10,
      p_window_seconds: 900,
    }
  );
  await assertHelperNotExecutable(
    stranger,
    "Authenticated client",
    "_rate_limit_record_attempt",
    {
      p_scope: "join_chain_failed",
      p_subject_key: fixture.strangerUserId,
      p_window_seconds: 900,
    }
  );
  await assertHelperNotExecutable(
    stranger,
    "Authenticated client",
    "_rate_limit_try_consume",
    {
      p_scope: "join_chain_failed",
      p_subject_key: fixture.strangerUserId,
      p_limit: 10,
      p_window_seconds: 900,
    }
  );
  await assertHelperNotExecutable(
    stranger,
    "Authenticated client",
    "_rate_limit_cleanup_subject",
    {
      p_scope: "join_chain_failed",
      p_subject_key: fixture.strangerUserId,
      p_retain_seconds: 3600,
    }
  );

  const beforeProperty = await readPropertySnapshot(
    admin,
    fixture.salePropertyId
  );
  const beforeMembership = await countMembership(
    admin,
    fixture.salePropertyId,
    fixture.strangerUserId
  );

  const invalidResponses: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const { data } = await stranger.rpc("join_chain_property", {
      p_access_code: "KN-WRG-CODEX",
      p_address: fixture.saleAddress,
      p_postcode: fixture.salePostcode,
    });
    invalidResponses.push(String(data?.error ?? "null"));
  }

  record(
    "Invalid join attempts remain generic join_details_not_matched",
    invalidResponses.every((error) => error === "join_details_not_matched"),
    invalidResponses.join(",")
  );

  const afterFailedProperty = await readPropertySnapshot(
    admin,
    fixture.salePropertyId
  );

  record(
    "Failed join attempts mutate no property state",
    afterFailedProperty?.status === beforeProperty?.status &&
      afterFailedProperty?.buyer_connected === beforeProperty?.buyer_connected,
    JSON.stringify({ before: beforeProperty, after: afterFailedProperty })
  );

  record(
    "Failed join attempts create no membership",
    (await countMembership(
      admin,
      fixture.salePropertyId,
      fixture.strangerUserId
    )) === beforeMembership,
    `membership=${beforeMembership}`
  );

  const { data: throttledInvalid } = await stranger.rpc("join_chain_property", {
    p_access_code: "KN-WRG-CODEX",
    p_address: fixture.saleAddress,
    p_postcode: fixture.salePostcode,
  });

  const { data: throttledValid } = await stranger.rpc("join_chain_property", {
    p_access_code: fixture.accessCode,
    p_address: fixture.saleAddress,
    p_postcode: fixture.salePostcode,
  });

  record(
    "Threshold enforced; throttled valid/invalid remain indistinguishable",
    throttledInvalid?.ok === false &&
      throttledValid?.ok === false &&
      throttledInvalid?.error === "join_details_not_matched" &&
      throttledValid?.error === "join_details_not_matched",
    `invalid=${throttledInvalid?.error} valid=${throttledValid?.error}`
  );

  record(
    "Throttled attempts still create no membership",
    (await countMembership(
      admin,
      fixture.salePropertyId,
      fixture.strangerUserId
    )) === 0,
    "membership still zero"
  );

  // Reset stranger join bucket via service role so legitimate join can be proven.
  await admin
    .from("rpc_rate_limit_buckets")
    .delete()
    .eq("scope", "join_chain_failed")
    .eq("subject_key", fixture.strangerUserId);

  const { data: legitimateJoin } = await stranger.rpc("join_chain_property", {
    p_access_code: fixture.accessCode,
    p_address: fixture.saleAddress,
    p_postcode: fixture.salePostcode,
  });

  record(
    "Legitimate join still succeeds after throttle reset",
    legitimateJoin?.ok === true && legitimateJoin?.joining_role === "buyer",
    JSON.stringify(legitimateJoin)
  );

  record(
    "Successful join creates membership",
    (await countMembership(
      admin,
      fixture.salePropertyId,
      fixture.strangerUserId
    )) === 1,
    "expected membership=1"
  );

  // Claim throttle: stranger (not claimable) should hit too_many_attempts after 15.
  const claimErrors: string[] = [];
  for (let i = 0; i < 15; i += 1) {
    const { data } = await stranger.rpc("claim_operational_property", {
      p_property_id: fixture.salePropertyId,
      p_invitation_token: null,
    });
    claimErrors.push(String(data?.error ?? "null"));
  }

  const { data: claimThrottled } = await stranger.rpc(
    "claim_operational_property",
    {
      p_property_id: fixture.salePropertyId,
      p_invitation_token: "not-a-real-token",
    }
  );

  record(
    "Repeated invalid claim attempts eventually throttle",
    claimThrottled?.ok === false &&
      claimThrottled?.error === "too_many_attempts",
    `prior=${claimErrors.slice(-1)[0]} throttled=${claimThrottled?.error}`
  );

  // Homeowner chain create throttle (record-on-success). Create until limit.
  let createBlocked = false;
  let successfulCreates = 0;
  for (let i = 0; i < 15; i += 1) {
    const part = `${fixture.stamp}${i}`.replace(/[^a-z0-9]/gi, "").toUpperCase();
    const code = `KN-${part.slice(0, 3).padEnd(3, "X")}-${part.slice(3, 7).padEnd(4, "Y")}`;
    const { data } = await host.rpc("create_chain_for_onboarding", {
      p_name: `SEC104-CREATE-${fixture.stamp}-${i}`,
      p_access_code: code,
    });
    if (data?.ok && data.chain_id) {
      successfulCreates += 1;
      await admin.from("chains").delete().eq("id", data.chain_id);
    }
    if (data?.error === "too_many_attempts") {
      createBlocked = true;
      break;
    }
  }

  record(
    "Homeowner chain creation abuse threshold enforced",
    createBlocked && successfulCreates >= 1,
    `blocked=${createBlocked} extraSuccesses=${successfulCreates}`
  );

  const { data: summaryOk, error: summaryError } = await host.rpc(
    "upsert_operational_summaries",
    {
      p_chain_summary: {
        chain_id: fixture.chainId,
        health_status: "healthy",
        blocked_count: 0,
        delay_count: 0,
        stale_count: 0,
        buyer_ready_stale: false,
        requires_replacement_buyer: false,
        computed_at: new Date().toISOString(),
        summary_version: 2,
      },
      p_property_summaries: [
        {
          property_id: fixture.salePropertyId,
          current_stage: "property_listed",
          property_status: "healthy",
          days_since_last_update: 0,
          stale_update: false,
          buyer_ready_delayed: false,
          buyer_ready_stale: false,
          completion_scheduled: false,
          completion_confirmed: false,
          operational_alerts: [],
          needs_attention: false,
          next_recommended_action: null,
          computed_at: new Date().toISOString(),
          summary_version: 2,
        },
      ],
    }
  );

  record(
    "Normal operational summary upsert succeeds for viewer",
    !summaryError,
    summaryError?.message ?? String(summaryOk)
  );

  const { data: strangerBuckets } = await admin
    .from("rpc_rate_limit_buckets")
    .select("subject_key, scope, attempt_count")
    .eq("subject_key", fixture.strangerUserId);

  const { data: hostPeekAsStranger, error: peekError } = await stranger
    .from("rpc_rate_limit_buckets")
    .select("*")
    .eq("subject_key", fixture.hostUserId);

  record(
    "Stranger cannot inspect another user's rate-limit state",
    !!peekError || (hostPeekAsStranger?.length ?? 0) === 0,
    peekError?.message ?? `rows=${hostPeekAsStranger?.length ?? 0}`
  );

  record(
    "Service role can observe fixture rate-limit rows (intentional)",
    (strangerBuckets?.length ?? 0) > 0,
    `rows=${strangerBuckets?.length ?? 0}`
  );
}

function printSummary(): void {
  const failed = results.filter((result) => !result.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`
  );
  if (failed.length > 0) {
    console.log("\nFailed checks:");
    for (const failure of failed) {
      console.log(
        `  - ${failure.name}${failure.detail ? `: ${failure.detail}` : ""}`
      );
    }
  }
}

async function main() {
  const execute = process.argv.includes("--execute");

  console.log("SEC-104 Rate Limiting — Development Verification\n");

  if (!url || !anonKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
    process.exit(1);
  }

  const projectRef = assertDevelopmentEnvironment(url);

  console.log(`Environment: Development (${projectRef})`);
  console.log(`Production: NOT targeted`);
  console.log(`Mode: ${execute ? "--execute" : "read-only"}`);

  record(
    "Development project ref guard",
    projectRef === DEVELOPMENT_SUPABASE_PROJECT_REF
  );

  runStaticChecks();
  await runAnonProbes();

  if (!execute) {
    console.log(
      "\nLive adversarial probes require --execute (synthetic fixtures only)."
    );
    printSummary();
    process.exit(results.some((result) => !result.pass) ? 1 : 0);
  }

  if (!serviceRoleKey || serviceRoleKey.includes("your-service-role")) {
    console.error("SUPABASE_SERVICE_ROLE_KEY required for --execute");
    process.exit(1);
  }

  const stamp = randomUUID().slice(0, 8);
  const admin = serviceClient();
  let fixture: FixtureContext | null = null;

  try {
    fixture = await createFixture(admin, stamp);
    console.log(`\nFixture stamp: ${stamp}`);
    await runExecuteProbes(fixture);
  } finally {
    if (fixture) {
      console.log("\n--- Cleanup ---\n");
      await cleanupFixture(admin, fixture);
    }
  }

  printSummary();
  process.exit(results.some((result) => !result.pass) ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
