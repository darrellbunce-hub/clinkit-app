/**
 * Development-only platform security live verification (Phase 0).
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-platform-security-development.ts
 *   npx tsx scripts/verify-platform-security-development.ts --execute
 *
 * Default: read-only — environment preflight + anon PostgREST probes.
 * --execute: creates isolated fixtures, runs authenticated exploit probes, cleans up.
 *
 * Never prints secrets, JWTs, tokens, or key values.
 */
import { createHash, randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const TEST_EMAIL_PREFIX = "platform-sec-dev";
const TEST_DOMAIN_SUFFIX = ".platform-sec.test";
const PASSWORD = "PlatformSecDev123!";

type LiveStatus =
  | "CONFIRMED EXPLOITABLE"
  | "CONFIRMED PROTECTED"
  | "PARTIALLY PROTECTED"
  | "NOT TESTABLE"
  | "STALE / ALREADY REMEDIATED";

type FindingVerdict = {
  id: string;
  status: LiveStatus;
  detail: string;
  enforcement?: string;
  disclosureLevel?: string;
  mutationImpact?: string;
};

type TestResult = { name: string; pass: boolean; detail?: string };

const results: TestResult[] = [];
const verdicts: FindingVerdict[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function addVerdict(verdict: FindingVerdict) {
  verdicts.push(verdict);
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
  if (
    value === "your-service-role-key" ||
    value === "your_service_role_key"
  ) {
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

function isTestEmail(email: string | undefined, stamp: string): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase();
  return (
    normalized.startsWith(`${TEST_EMAIL_PREFIX}-`) &&
    normalized.includes(`-${stamp}@`) &&
    normalized.endsWith(TEST_DOMAIN_SUFFIX)
  );
}

function buildTestEmail(stamp: string, label: string): string {
  return `${TEST_EMAIL_PREFIX}-${label}-${stamp}@${stamp}${TEST_DOMAIN_SUFFIX}`;
}

function redactInvitationRow(row: Record<string, unknown> | null): string {
  if (!row) return "null";
  const safe = { ...row };
  if ("invitation_token_hash" in safe) safe.invitation_token_hash = "[REDACTED]";
  return JSON.stringify(safe);
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = resolveServiceRoleKey(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

async function probeTableRead(
  client: SupabaseClient,
  table: string,
  filter?: { column: string; value: string | number }
): Promise<{ allowed: boolean; rowCount: number; error?: string }> {
  let query = client.from(table).select("*", { count: "exact", head: false }).limit(5);
  if (filter) {
    query = query.eq(filter.column, filter.value);
  }
  const { data, error, count } = await query;
  if (error) {
    return { allowed: false, rowCount: 0, error: error.message };
  }
  return { allowed: true, rowCount: count ?? data?.length ?? 0 };
}

async function probeTableWrite(
  client: SupabaseClient,
  table: string,
  payload: Record<string, unknown>
): Promise<{ allowed: boolean; error?: string }> {
  const { error } = await client.from(table).insert(payload);
  if (error) {
    return { allowed: false, error: error.message };
  }
  return { allowed: true };
}

async function runAnonProbes(): Promise<void> {
  console.log("\n--- Anon PostgREST probes (read-only) ---\n");
  const client = anonClient();

  for (const table of [
    "properties",
    "chains",
    "activities",
    "profiles",
    "property_members",
    "email_events",
  ]) {
    const probe = await probeTableRead(client, table);
    const protected_ =
      !probe.allowed ||
      probe.rowCount === 0 ||
      !!probe.error?.includes("permission denied");
    record(
      `Anon SELECT ${table} blocked or empty`,
      protected_,
      probe.error ?? `rows=${probe.rowCount}`
    );
  }

  const { error: rpcError, data: rpcData } = await client.rpc(
    "get_property_lifecycle_signals",
    { p_property_id: 1 }
  );
  const anonDiscloses =
    rpcData?.ok === true && rpcData?.context?.propertyId != null;
  const anonOnlyNotFound =
    !rpcError &&
    rpcData?.ok === false &&
    rpcData?.error === "property_not_found";
  record(
    "Anon get_property_lifecycle_signals not exploitable",
    !anonDiscloses,
    rpcError?.message ??
      (anonDiscloses
        ? `disclosed propertyId=${rpcData.context.propertyId}`
        : anonOnlyNotFound
          ? "callable but property_not_found only"
          : "no disclosure")
  );

  const { data: anonWrite, error: anonWriteError } = await client.rpc(
    "record_property_lifecycle_transition",
    {
      p_property_id: 1,
      p_to_state: "dormant",
      p_trigger: "manual",
      p_reason: "anon_probe",
    }
  );
  const anonWriteSucceeded = anonWrite?.ok === true;
  record(
    "Anon record_property_lifecycle_transition blocked",
    !anonWriteSucceeded && !!anonWriteError,
    anonWriteError?.message ?? (anonWriteSucceeded ? "mutation succeeded" : "rejected")
  );

  const emailInsert = await probeTableWrite(client, "email_events", {
    template: "platform_sec_probe",
    recipient_email: "probe@example.test",
    status: "queued",
  });
  record(
    "Anon INSERT email_events blocked",
    !emailInsert.allowed,
    emailInsert.error ?? "unexpected insert success"
  );

  for (const fn of [
    "get_active_property_claim_invitation",
    "get_latest_property_claim_invitation",
    "report_multiple_operational_homeowners",
  ] as const) {
    const { error } = await client.rpc(
      fn,
      fn === "report_multiple_operational_homeowners"
        ? undefined
        : { p_property_id: 1 }
    );
    record(
      `Anon ${fn} blocked`,
      !!error,
      error?.message ?? "unexpected success"
    );
  }
}

type FixtureContext = {
  stamp: string;
  participantEmail: string;
  strangerEmail: string;
  participantUserId: string;
  strangerUserId: string;
  chainId: number;
  propertyId: number;
  propertyAddress: string;
  invitationId?: string;
};

async function createFixture(admin: SupabaseClient, stamp: string): Promise<FixtureContext> {
  const participantEmail = buildTestEmail(stamp, "participant");
  const strangerEmail = buildTestEmail(stamp, "stranger");

  const participantUserId = await ensureAuthUser(
    admin,
    participantEmail,
    PASSWORD
  );
  const strangerUserId = await ensureAuthUser(admin, strangerEmail, PASSWORD);

  const participant = await signIn(participantEmail, PASSWORD);
  const accessCode = `KN-SEC-${stamp.slice(0, 8).toUpperCase()}`;

  const { data: chainResult, error: chainError } = await participant.rpc(
    "create_chain_for_onboarding",
    {
      p_name: `SEC-${stamp}`,
      p_access_code: accessCode,
    }
  );
  if (chainError || !chainResult?.ok || chainResult.chain_id == null) {
    throw new Error(
      `create_chain_for_onboarding failed: ${chainError?.message ?? chainResult?.error ?? "unknown"}`
    );
  }

  const chainId = chainResult.chain_id as number;
  const propertyAddress = `999 Security Lane ${stamp}`;

  const { data: property, error: propertyError } = await participant
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 1,
      address: propertyAddress,
      postcode: "SEC1",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: participantUserId,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();

  if (propertyError || !property) {
    throw new Error(`property insert failed: ${propertyError?.message}`);
  }

  const { error: memberError } = await participant.rpc(
    "establish_operational_homeowner_for_created_property",
    {
      p_property_id: property.id,
    }
  );
  if (memberError) {
    throw new Error(
      `establish_operational_homeowner_for_created_property failed: ${memberError.message}`
    );
  }

  const syntheticToken = `sec-fixture-${stamp}`;
  const tokenHash = createHash("sha256").update(syntheticToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invitation, error: invitationError } = await admin
    .from("property_claim_invitations")
    .insert({
      property_id: property.id,
      invitation_token_hash: tokenHash,
      invitation_expires_at: expiresAt,
      created_by_user_id: participantUserId,
      invitation_sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (invitationError || !invitation) {
    throw new Error(
      `invitation fixture failed: ${invitationError?.message}`
    );
  }

  return {
    stamp,
    participantEmail,
    strangerEmail,
    participantUserId,
    strangerUserId,
    chainId,
    propertyId: property.id,
    propertyAddress,
    invitationId: invitation.id,
  };
}

async function cleanupFixture(
  admin: SupabaseClient,
  fixture: FixtureContext
): Promise<string[]> {
  const warnings: string[] = [];

  const deleteEq = async (table: string, column: string, value: string | number) => {
    const { error } = await admin.from(table).delete().eq(column, value);
    if (error) {
      warnings.push(`${table}.${column}=${value}: ${error.message}`);
    }
  };

  await deleteEq("property_lifecycle_events", "property_id", fixture.propertyId);
  await deleteEq("property_lifecycle_states", "property_id", fixture.propertyId);
  if (fixture.invitationId) {
    await deleteEq("property_claim_invitations", "id", fixture.invitationId);
  }
  await deleteEq("property_members", "property_id", fixture.propertyId);
  await deleteEq("property_operational_identities", "property_id", fixture.propertyId);
  await deleteEq("property_claim_metadata", "property_id", fixture.propertyId);
  await deleteEq("activities", "property_id", fixture.propertyId);
  await deleteEq("properties", "id", fixture.propertyId);
  await deleteEq("chains", "id", fixture.chainId);

  for (const userId of [fixture.participantUserId, fixture.strangerUserId]) {
    await deleteAuthUser(admin, userId);
  }

  return warnings;
}

async function verifyCleanup(admin: SupabaseClient, fixture: FixtureContext): Promise<boolean> {
  const checks = [
    { table: "properties", column: "id", value: fixture.propertyId },
    { table: "chains", column: "id", value: fixture.chainId },
  ];
  for (const check of checks) {
    const { data } = await admin
      .from(check.table)
      .select("id")
      .eq(check.column, check.value)
      .maybeSingle();
    if (data) return false;
  }
  return true;
}

async function runExecuteProbes(fixture: FixtureContext): Promise<void> {
  console.log("\n--- Authenticated exploit probes (--execute) ---\n");

  const participant = await signIn(fixture.participantEmail, PASSWORD);
  const stranger = await signIn(fixture.strangerEmail, PASSWORD);
  const admin = serviceClient();

  // SEC-003 base-table RLS
  const strangerPropertyProbe = await probeTableRead(stranger, "properties", {
    column: "id",
    value: fixture.propertyId,
  });
  const strangerPeerAddress =
    strangerPropertyProbe.allowed &&
    strangerPropertyProbe.rowCount > 0 &&
    !strangerPropertyProbe.error;

  const { data: strangerPeerRow } = await stranger
    .from("properties")
    .select("address, postcode, chain_id")
    .eq("id", fixture.propertyId)
    .maybeSingle();

  const strangerDisclosesAddress = !!strangerPeerRow?.address;

  record(
    "SEC-003 stranger cannot read unrelated property base row",
    !strangerDisclosesAddress,
    strangerDisclosesAddress
      ? `address leaked`
      : strangerPropertyProbe.error ?? "no row"
  );

  for (const table of ["chains", "activities", "property_members", "profiles"]) {
    const probe = await probeTableRead(stranger, table, {
      column: table === "chains" ? "id" : "property_id",
      value: table === "chains" ? fixture.chainId : fixture.propertyId,
    });
    const protected_ = !probe.allowed || probe.rowCount === 0;
    record(
      `SEC-003 stranger SELECT ${table} scoped/blocked`,
      protected_,
      probe.error ?? `rows=${probe.rowCount}`
    );
  }

  const { data: participantOwn } = await participant
    .from("properties")
    .select("id, address")
    .eq("id", fixture.propertyId)
    .maybeSingle();
  record(
    "Participant can read own property via base table",
    !!participantOwn?.id,
    participantOwn?.address ? "own address visible" : "missing"
  );

  if (strangerDisclosesAddress) {
    addVerdict({
      id: "SEC-003",
      status: "CONFIRMED EXPLOITABLE",
      detail: "Authenticated stranger reads unrelated property base-table row including address.",
      enforcement: "RLS policy failure on properties",
      disclosureLevel: "HIGH",
    });
  } else {
    addVerdict({
      id: "SEC-003",
      status: "CONFIRMED PROTECTED",
      detail: "Direct PostgREST SELECT on unrelated property/chain rows denied or empty for stranger.",
      enforcement: "RLS on base tables",
    });
  }

  // SEC-001 lifecycle write RPC
  const { data: beforeState } = await admin
    .from("property_lifecycle_states")
    .select("operational_state")
    .eq("property_id", fixture.propertyId)
    .maybeSingle();

  const beforeOperationalState = beforeState?.operational_state ?? "active";

  const { data: writeResult, error: writeError } = await stranger.rpc(
    "record_property_lifecycle_transition",
    {
      p_property_id: fixture.propertyId,
      p_to_state: "dormant",
      p_trigger: "manual",
      p_reason: "unauthorised_probe",
      p_metadata: { probe: fixture.stamp },
    }
  );

  const { data: afterState } = await admin
    .from("property_lifecycle_states")
    .select("operational_state")
    .eq("property_id", fixture.propertyId)
    .maybeSingle();

  const { count: eventCount } = await admin
    .from("property_lifecycle_events")
    .select("id", { count: "exact", head: true })
    .eq("property_id", fixture.propertyId)
    .eq("trigger", "manual")
    .contains("metadata", { probe: fixture.stamp });

  const strangerMutatedLifecycle =
    writeResult?.ok === true ||
    afterState?.operational_state === "dormant" ||
    (eventCount ?? 0) > 0;

  const strangerWriteBlocked =
    !strangerMutatedLifecycle &&
    (!!writeError ||
      writeResult?.ok === false ||
      writeResult?.error === "forbidden");

  record(
    "SEC-001 stranger lifecycle write blocked",
    strangerWriteBlocked,
    writeError?.message ??
      JSON.stringify({
        rpcOk: writeResult?.ok,
        rpcError: writeResult?.error,
        afterState: afterState?.operational_state,
        events: eventCount,
      })
  );

  if (strangerMutatedLifecycle) {
    addVerdict({
      id: "SEC-001",
      status: "CONFIRMED EXPLOITABLE",
      detail: "Authenticated stranger mutates lifecycle state/events for unrelated property.",
      enforcement: "Missing membership check in record_property_lifecycle_transition",
      mutationImpact: "Persists lifecycle state + audit events; may affect automation",
    });
  } else {
    addVerdict({
      id: "SEC-001",
      status: "CONFIRMED PROTECTED",
      detail: "Stranger cannot persist lifecycle transition on unrelated property.",
      enforcement:
        writeError?.message ??
        "RPC rejected or no state change (check auth.uid-only vs membership gate)",
    });
  }

  // Restore lifecycle if mutated
  if (afterState?.operational_state === "dormant") {
    await admin
      .from("property_lifecycle_events")
      .delete()
      .eq("property_id", fixture.propertyId)
      .eq("trigger", "manual")
      .contains("metadata", { probe: fixture.stamp });
    await admin.from("property_lifecycle_states").upsert({
      property_id: fixture.propertyId,
      operational_state: beforeOperationalState,
      lifecycle_reason: "verification_cleanup",
      entered_state_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  // SEC-002 lifecycle read RPC
  const { data: signals, error: signalsError } = await stranger.rpc(
    "get_property_lifecycle_signals",
    { p_property_id: fixture.propertyId }
  );

  const signalsDisclose =
    signals?.ok === true &&
    signals?.context?.propertyId === fixture.propertyId;

  record(
    "SEC-002 stranger lifecycle signals blocked",
    !signalsDisclose,
    signalsError?.message ??
      (signalsDisclose
        ? `context keys=${Object.keys(signals.context ?? {}).join(",")}`
        : JSON.stringify(signals))
  );

  const { data: participantSignals } = await participant.rpc(
    "get_property_lifecycle_signals",
    { p_property_id: fixture.propertyId }
  );
  record(
    "Participant can read lifecycle signals for own property",
    participantSignals?.ok === true,
    participantSignals?.error ?? "ok"
  );

  if (signalsDisclose) {
    addVerdict({
      id: "SEC-002",
      status: "CONFIRMED EXPLOITABLE",
      detail:
        "Authenticated stranger reads operational lifecycle context for unrelated property.",
      enforcement: "Missing membership check in get_property_lifecycle_signals",
      disclosureLevel: "MODERATE",
    });
  } else {
    addVerdict({
      id: "SEC-002",
      status: "CONFIRMED PROTECTED",
      detail: "Stranger cannot obtain lifecycle signals for unrelated property.",
      enforcement: signalsError?.message ?? "RPC returns not found / denied",
    });
  }

  for (const fn of [
    "get_active_property_claim_invitation",
    "get_latest_property_claim_invitation",
  ] as const) {
    const { error: anonInviteError } = await anonClient().rpc(fn, {
      p_property_id: fixture.propertyId,
    });
    record(
      `Anon ${fn} blocked`,
      !!anonInviteError,
      anonInviteError?.message ?? "unexpected success"
    );
  }

  // Service role regression (required backend paths)
  const { data: serviceSignals, error: serviceSignalsError } = await admin.rpc(
    "get_property_lifecycle_signals",
    { p_property_id: fixture.propertyId }
  );
  record(
    "Service role lifecycle signals read works",
    !serviceSignalsError && serviceSignals?.ok === true,
    serviceSignalsError?.message ?? serviceSignals?.error ?? "ok"
  );

  const { error: serviceEnumError } = await admin.rpc(
    "report_multiple_operational_homeowners"
  );
  record(
    "Service role enumeration RPC executable",
    !serviceEnumError,
    serviceEnumError?.message ?? "ok"
  );

  // SEC-004 invitation helper RPCs
  let sec004Exploitable = false;
  for (const fn of [
    "get_active_property_claim_invitation",
    "get_latest_property_claim_invitation",
  ] as const) {
    const { data, error } = await stranger.rpc(fn, {
      p_property_id: fixture.propertyId,
    });
    const row = data as Record<string, unknown> | null;
    const discloses =
      !!row &&
      typeof row === "object" &&
      row.id != null &&
      row.property_id === fixture.propertyId;

    record(
      `SEC-004 stranger ${fn} blocked`,
      !discloses,
      error?.message ?? redactInvitationRow(row)
    );

    if (discloses) {
      sec004Exploitable = true;
    }
  }

  addVerdict({
    id: "SEC-004",
    status: sec004Exploitable ? "CONFIRMED EXPLOITABLE" : "CONFIRMED PROTECTED",
    detail: sec004Exploitable
      ? "Invitation helper RPCs return invitation metadata for unrelated property to stranger."
      : "Invitation helper RPCs do not disclose unrelated invitation rows to stranger.",
    enforcement: sec004Exploitable
      ? "SECURITY DEFINER without caller membership gate"
      : "RLS/grant/RPC gate",
    disclosureLevel: sec004Exploitable ? "HIGH" : undefined,
  });

  // SEC-101 enumeration RPC
  const { data: enumRows, error: enumError } = await stranger.rpc(
    "report_multiple_operational_homeowners"
  );
  const rows = (enumRows ?? []) as Array<Record<string, unknown>>;
  const disclosesEnumeration =
    rows.length > 0 &&
    rows.some(
      (row) =>
        row.property_id != null &&
        Array.isArray(row.user_ids) &&
        row.user_ids.length > 0
    );

  record(
    "SEC-101 stranger enumeration RPC scoped/blocked",
    !disclosesEnumeration,
    enumError?.message ?? `rows=${rows.length}`
  );

  if (disclosesEnumeration) {
    addVerdict({
      id: "SEC-101",
      status: "CONFIRMED EXPLOITABLE",
      detail:
        "report_multiple_operational_homeowners returns cross-property user UUID arrays to stranger.",
      enforcement: "Missing role restriction on SECURITY DEFINER RPC",
      disclosureLevel: "HIGH",
    });
  } else {
    addVerdict({
      id: "SEC-101",
      status: "CONFIRMED PROTECTED",
      detail: enumError
        ? `RPC not executable by stranger: ${enumError.message}`
        : "RPC returned no cross-property enumeration rows to stranger.",
      enforcement: enumError?.message ?? "Revoked authenticated EXECUTE",
    });
  }

  // SEC-105 email_events
  const { data: seededEmail, error: seedError } = await admin
    .from("email_events")
    .insert({
      template: `platform_sec_probe_${fixture.stamp}`,
      recipient_email: `probe-${fixture.stamp}@example.test`,
      status: "queued",
    })
    .select("id, status")
    .single();

  if (seedError || !seededEmail) {
    record(
      "SEC-105 seed email_events fixture",
      false,
      seedError?.message ?? "missing seed row"
    );
  }

  const probe = await probeTableRead(stranger, "email_events");
  record(
    "SEC-105 stranger email_events SELECT blocked/empty",
    !probe.allowed || probe.rowCount === 0,
    probe.error ?? `rows=${probe.rowCount}`
  );

  const insertProbe = await probeTableWrite(stranger, "email_events", {
    template: "platform_sec_probe",
    recipient_email: `probe-${fixture.stamp}@example.test`,
    status: "queued",
  });
  record(
    "SEC-105 stranger email_events INSERT blocked",
    !insertProbe.allowed,
    insertProbe.error ?? "unexpected insert"
  );

  if (seededEmail) {
    const { error: updateError } = await stranger
      .from("email_events")
      .update({ status: "failed" })
      .eq("id", seededEmail.id);
    const { data: afterUpdate } = await admin
      .from("email_events")
      .select("status")
      .eq("id", seededEmail.id)
      .maybeSingle();
    record(
      "SEC-105 stranger email_events UPDATE blocked",
      afterUpdate?.status === "queued",
      updateError?.message ?? `status=${afterUpdate?.status ?? "missing"}`
    );

    const { error: deleteError } = await stranger
      .from("email_events")
      .delete()
      .eq("id", seededEmail.id);
    const { data: afterDelete } = await admin
      .from("email_events")
      .select("id")
      .eq("id", seededEmail.id)
      .maybeSingle();
    record(
      "SEC-105 stranger email_events DELETE blocked",
      !!afterDelete?.id,
      deleteError?.message ?? "row removed unexpectedly"
    );

    await admin.from("email_events").delete().eq("id", seededEmail.id);
  }

  const { error: listEmailRpcError } = await stranger.rpc(
    "list_recent_email_events",
    { p_status: null, p_limit: 5 }
  );
  record(
    "SEC-105 stranger list_recent_email_events blocked",
    !!listEmailRpcError,
    listEmailRpcError?.message ?? "unexpected rpc success"
  );

  const { error: createEmailRpcError } = await stranger.rpc("create_email_event", {
    p_template: "platform_sec_probe",
    p_recipient_email: `probe-${fixture.stamp}@example.test`,
  });
  record(
    "SEC-105 stranger create_email_event blocked",
    !!createEmailRpcError,
    createEmailRpcError?.message ?? "unexpected rpc success"
  );

  const emailProtected =
    listEmailRpcError &&
    createEmailRpcError &&
    !(await probeTableRead(stranger, "email_events")).rowCount;

  addVerdict({
    id: "SEC-105",
    status: emailProtected ? "CONFIRMED PROTECTED" : "CONFIRMED EXPLOITABLE",
    detail: emailProtected
      ? "email_events table and admin RPCs deny stranger/anon access on Development."
      : "Unauthorised email_events read or RPC access detected for stranger.",
    enforcement: "RLS + revoked EXECUTE on email RPCs (20260713000000)",
  });
}

async function main() {
  const execute = process.argv.includes("--execute");

  console.log("Platform Security — Development Live Verification\n");

  if (!url || !anonKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    process.exit(1);
  }

  const projectRef = assertDevelopmentEnvironment(url);

  console.log(`Environment: Development (${projectRef})`);
  console.log(`Production: NOT targeted`);
  console.log(
    `Keys present: NEXT_PUBLIC_SUPABASE_ANON_KEY=${!!anonKey}, SUPABASE_SERVICE_ROLE_KEY=${!!serviceRoleKey}`
  );
  console.log(`Mode: ${execute ? "--execute (fixtures + authenticated probes)" : "read-only"}`);
  console.log(
    `Catalog SQL: scripts/verify-platform-security-catalog.sql (run in Supabase SQL Editor for grant/policy inventory)`
  );

  record("Development project ref matches expected", true, projectRef);

  await runAnonProbes();

  addVerdict({
    id: "ANON-POSTGREST",
    status: results.some((r) => !r.pass && r.name.startsWith("Anon"))
      ? "PARTIALLY PROTECTED"
      : "CONFIRMED PROTECTED",
    detail: "Anon direct PostgREST probes against sensitive tables/RPCs.",
    enforcement: "RLS + revoked grants",
  });

  if (!execute) {
    console.log(
      "\nAuthenticated stranger/participant probes require --execute (creates isolated fixtures)."
    );
    printSummary();
    process.exit(results.some((r) => !r.pass) ? 1 : 0);
  }

  if (!serviceRoleKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY required for --execute fixture setup/cleanup");
    process.exit(1);
  }

  const stamp = randomUUID().slice(0, 8);
  const admin = serviceClient();
  let fixture: FixtureContext | null = null;
  const cleanupWarnings: string[] = [];

  try {
    fixture = await createFixture(admin, stamp);
    console.log(`\nFixture stamp: ${stamp}`);
    await runExecuteProbes(fixture);
  } finally {
    if (fixture) {
      console.log("\n--- Cleanup ---\n");
      cleanupWarnings.push(...(await cleanupFixture(admin, fixture)));
      const clean = await verifyCleanup(admin, fixture);
      record("Fixture data removed", clean, clean ? undefined : "residual rows remain");
      if (cleanupWarnings.length > 0) {
        console.warn("Cleanup warnings:");
        for (const warning of cleanupWarnings) {
          console.warn(`  - ${warning}`);
        }
      }
    }
  }

  printSummary();
  const failedTests = results.filter((r) => !r.pass);
  const exploitable = verdicts.filter((v) => v.status === "CONFIRMED EXPLOITABLE");
  process.exit(failedTests.length > 0 || exploitable.length > 0 ? 1 : 0);
}

function printSummary() {
  console.log("\n--- Finding verdicts ---");
  for (const verdict of verdicts) {
    console.log(
      `${verdict.id}: ${verdict.status} — ${verdict.detail}${
        verdict.enforcement ? ` [${verdict.enforcement}]` : ""
      }`
    );
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n--- Test summary ---");
  console.log(
    `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
