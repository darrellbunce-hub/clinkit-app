/**
 * Development-only chain join / access-code security verification.
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-chain-join-security-development.ts
 *   npx tsx scripts/verify-chain-join-security-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { accessCodeLookupCandidates } from "../lib/accessCode/normalizeAccessCode";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const TEST_EMAIL_PREFIX = "chain-join-sec";
const TEST_DOMAIN_SUFFIX = ".chain-join-sec.test";
const PASSWORD = "ChainJoinSecDev123!";
const GENERIC_JOIN_ERROR = "join_details_not_matched";

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

function isRpcExecuteRevokedOrDenied(params: {
  data: { ok?: boolean; error?: string } | null;
  error: { code?: string; message?: string } | null;
  allowedDataErrors?: string[];
}): boolean {
  if (params.error) {
    const message = params.error.message?.toLowerCase() ?? "";
    const code = params.error.code ?? "";
    return (
      code === "42501" ||
      code === "PGRST202" ||
      message.includes("permission denied") ||
      message.includes("could not find the function")
    );
  }

  if (params.data?.ok === false) {
    if (params.allowedDataErrors?.includes(params.data.error ?? "")) {
      return true;
    }
    return params.data.error === "not_authorized";
  }

  return false;
}

function runStaticChecks(): void {
  console.log("\n--- Static access-code / join boundary checks ---\n");

  const remediation = readProjectFile(
    "supabase/migrations/20260727100000_chain_join_security_remediation.sql"
  );
  const generator = readProjectFile("lib/accessCode/generateAccessCode.ts");
  const startMove = readProjectFile("app/start-move/page.tsx");
  const eaOriginate = readProjectFile(
    "lib/estateAgent/originateOperationalProperty.ts"
  );

  record(
    "Shared access-code generator uses CSPRNG (randomBytes)",
    generator.includes("randomBytes") &&
      !generator.includes("Math.random"),
    "lib/accessCode/generateAccessCode.ts"
  );

  record(
    "Shared generator emits KN-XXX-XXXX canonical format",
    generator.includes('return `KN-${partA}-${partB}`'),
    "lib/accessCode/generateAccessCode.ts"
  );

  record(
    "Start Move imports shared generateAccessCode",
    startMove.includes("@/lib/accessCode"),
    "app/start-move/page.tsx"
  );

  record(
    "EA origination reuses shared generateAccessCode",
    eaOriginate.includes("generateAccessCode"),
    "lib/estateAgent/originateOperationalProperty.ts"
  );

  record(
    "join_chain_property uses lookup-side access code candidates",
    remediation.includes("_access_code_lookup_candidates"),
    "remediation migration"
  );

  record(
    "join_chain_property returns generic join_details_not_matched",
    remediation.includes("'join_details_not_matched'"),
    "remediation migration"
  );

  record(
    "grant_counterparty_participation EXECUTE revoked from authenticated",
    remediation.includes(
      "revoke all on function public.grant_counterparty_participation"
    ) &&
      remediation.includes("from authenticated"),
    "remediation migration"
  );

  record(
    "resolve_chain_for_join EXECUTE revoked from authenticated",
    remediation.includes(
      "revoke all on function public.resolve_chain_for_join"
    ) &&
      remediation.includes("from authenticated"),
    "remediation migration"
  );

  record(
    "property_exists_for_onboarding EXECUTE revoked from authenticated",
    remediation.includes(
      "revoke all on function public.property_exists_for_onboarding"
    ) &&
      remediation.includes("from authenticated"),
    "remediation migration"
  );

  record(
    "establish_operational_homeowner_for_created_property granted to authenticated",
    remediation.includes(
      "grant execute on function public.establish_operational_homeowner_for_created_property"
    ),
    "remediation migration"
  );

  record(
    "establish_operational_homeowner start_move blocked at RPC boundary",
    remediation.includes("p_granted_via = 'start_move'") &&
      remediation.includes("'not_authorized'"),
    "remediation migration"
  );
}

async function runAnonProbes(): Promise<void> {
  console.log("\n--- Anon PostgREST probes ---\n");

  const client = anonClient();

  for (const table of ["chains", "properties", "property_members"]) {
    const { data, error, count } = await client
      .from(table)
      .select("*", { count: "exact", head: false })
      .limit(1);

    const blocked = !!error || (count ?? data?.length ?? 0) === 0;

    record(
      `Anon cannot read ${table}`,
      blocked,
      error?.message ?? `rows=${count ?? data?.length ?? 0}`
    );
  }

  const { data: joinData, error: joinError } = await client.rpc(
    "join_chain_property",
    {
      p_access_code: "KN-AAA-BBBB",
      p_address: "1 Test Street",
      p_postcode: "TE1 1ST",
    }
  );

  record(
    "Anon join_chain_property blocked",
    !!joinError || joinData?.ok === false,
    joinError?.message ?? JSON.stringify(joinData)
  );

  const { data: resolveData, error: resolveError } = await client.rpc(
    "resolve_chain_for_join",
    { p_access_code: "KN-AAA-BBBB" }
  );

  record(
    "Anon resolve_chain_for_join blocked",
    !!resolveError || resolveData?.ok === false,
    resolveError?.message ?? JSON.stringify(resolveData)
  );
}

type PropertySnapshot = {
  status: string | null;
  buyer_connected: boolean | null;
  seller_connected: boolean | null;
};

type FixtureContext = {
  stamp: string;
  hostEmail: string;
  strangerEmail: string;
  hostUserId: string;
  strangerUserId: string;
  chainAId: number;
  chainBId: number;
  chainLegacyId: number;
  newFormatAccessCode: string;
  legacyHomeownerAccessCode: string;
  legacyEaAccessCode: string;
  salePropertyId: number;
  saleAddress: string;
  salePostcode: string;
  chainBAddress: string;
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
  const newFormatAccessCode = `KN-${alnum.slice(0, 3)}-${alnum.slice(3, 7)}`;
  const legacyHomeownerAccessCode = `KN-${alnum.slice(0, 3)}-${alnum.slice(3, 6)}`;
  const legacyEaAccessCode = alnum.slice(0, 7);

  const { data: chainA, error: chainAError } = await host.rpc(
    "create_chain_for_onboarding",
    {
      p_name: `JOIN-A-${stamp}`,
      p_access_code: newFormatAccessCode,
    }
  );

  if (chainAError || !chainA?.ok) {
    throw new Error(
      `create_chain_for_onboarding A failed: ${chainAError?.message ?? chainA?.error}`
    );
  }

  const { data: chainLegacy, error: chainLegacyError } = await host.rpc(
    "create_chain_for_onboarding",
    {
      p_name: `JOIN-LEG-${stamp}`,
      p_access_code: legacyHomeownerAccessCode,
    }
  );

  if (chainLegacyError || !chainLegacy?.ok) {
    throw new Error(
      `legacy homeowner chain failed: ${chainLegacyError?.message ?? chainLegacy?.error}`
    );
  }

  const { data: chainB, error: chainBError } = await host.rpc(
    "create_chain_for_onboarding",
    {
      p_name: `JOIN-B-${stamp}`,
      p_access_code: legacyEaAccessCode,
    }
  );

  if (chainBError || !chainB?.ok) {
    throw new Error(
      `create_chain_for_onboarding B failed: ${chainBError?.message ?? chainB?.error}`
    );
  }

  const saleAddress = `10 Join Security Lane ${stamp}`;
  const salePostcode = "JS1 1AA";
  const chainBAddress = `20 Other Chain Road ${stamp}`;

  const { data: saleProperty, error: saleError } = await host
    .from("properties")
    .insert({
      chain_id: chainA.chain_id,
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
      `establish_operational_homeowner_for_created_property failed: ${establishError?.message ?? establishData?.error}`
    );
  }

  const { data: chainBProperty, error: chainBPropertyError } = await host
    .from("properties")
    .insert({
      chain_id: chainB.chain_id,
      chain_position: 1,
      address: chainBAddress,
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

  if (chainBPropertyError || !chainBProperty) {
    throw new Error(
      `chain B sale property insert failed: ${chainBPropertyError?.message}`
    );
  }

  const { data: chainBEstablish, error: chainBEstablishError } = await host.rpc(
    "establish_operational_homeowner_for_created_property",
    { p_property_id: chainBProperty.id }
  );

  if (chainBEstablishError || !chainBEstablish?.ok) {
    throw new Error(
      `chain B establish failed: ${chainBEstablishError?.message ?? chainBEstablish?.error}`
    );
  }

  void chainLegacy;

  return {
    stamp,
    hostEmail,
    strangerEmail,
    hostUserId,
    strangerUserId,
    chainAId: chainA.chain_id as number,
    chainBId: chainB.chain_id as number,
    chainLegacyId: chainLegacy.chain_id as number,
    newFormatAccessCode,
    legacyHomeownerAccessCode,
    legacyEaAccessCode,
    salePropertyId: saleProperty.id as number,
    saleAddress,
    salePostcode,
    chainBAddress,
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

  for (const chainId of [
    fixture.chainAId,
    fixture.chainBId,
    fixture.chainLegacyId,
  ]) {
    const { data: properties } = await admin
      .from("properties")
      .select("id")
      .eq("chain_id", chainId);

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
      await deleteEq("properties", "id", property.id);
    }

    await deleteEq("chains", "id", chainId);
  }

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

async function countCounterparty(
  admin: SupabaseClient,
  propertyId: number,
  userId: string
): Promise<number> {
  const { count } = await admin
    .from("property_counterparty_participants")
    .select("property_id", { count: "exact", head: true })
    .eq("property_id", propertyId)
    .eq("user_id", userId);

  return count ?? 0;
}

async function readPropertySnapshot(
  admin: SupabaseClient,
  propertyId: number
): Promise<PropertySnapshot | null> {
  const { data } = await admin
    .from("properties")
    .select("status, buyer_connected, seller_connected")
    .eq("id", propertyId)
    .maybeSingle();

  return data;
}

function snapshotsEqual(
  before: PropertySnapshot | null,
  after: PropertySnapshot | null
): boolean {
  return (
    before?.status === after?.status &&
    before?.buyer_connected === after?.buyer_connected &&
    before?.seller_connected === after?.seller_connected
  );
}

function assertGenericJoinFailure(data: { ok?: boolean; error?: string } | null) {
  return data?.ok === false && data.error === GENERIC_JOIN_ERROR;
}

async function runExecuteProbes(fixture: FixtureContext): Promise<void> {
  console.log("\n--- Adversarial join probes (--execute) ---\n");

  const admin = serviceClient();
  const stranger = await signIn(fixture.strangerEmail, PASSWORD);

  const { data: resolveValid, error: resolveValidError } =
    await stranger.rpc("resolve_chain_for_join", {
      p_access_code: fixture.newFormatAccessCode,
    });

  record(
    "Authenticated stranger cannot resolve_chain_for_join(valid code)",
    !!resolveValidError || resolveValid?.ok !== true,
    resolveValidError?.message ?? JSON.stringify(resolveValid)
  );

  const { data: strangerPropertyReadBeforeJoin } = await stranger
    .from("properties")
    .select("id, address")
    .eq("id", fixture.salePropertyId)
    .maybeSingle();

  record(
    "Unrelated base-table RLS still protects property reads",
    !strangerPropertyReadBeforeJoin?.address,
    strangerPropertyReadBeforeJoin?.address ?? "no row"
  );

  const wrongCodeJoin = await stranger.rpc("join_chain_property", {
    p_access_code: "KN-WRG-CODE",
    p_address: fixture.saleAddress,
    p_postcode: fixture.salePostcode,
  });

  record(
    "Wrong code + correct address denied (generic)",
    assertGenericJoinFailure(wrongCodeJoin.data),
    JSON.stringify(wrongCodeJoin.data)
  );

  const wrongAddressJoin = await stranger.rpc("join_chain_property", {
    p_access_code: fixture.newFormatAccessCode,
    p_address: "999 Nonexistent Street",
    p_postcode: fixture.salePostcode,
  });

  record(
    "Valid code + wrong address denied (generic)",
    assertGenericJoinFailure(wrongAddressJoin.data),
    JSON.stringify(wrongAddressJoin.data)
  );

  const wrongPostcodeJoin = await stranger.rpc("join_chain_property", {
    p_access_code: fixture.newFormatAccessCode,
    p_address: fixture.saleAddress,
    p_postcode: "ZZ9 9ZZ",
  });

  record(
    "Valid code + wrong postcode denied (generic)",
    assertGenericJoinFailure(wrongPostcodeJoin.data),
    JSON.stringify(wrongPostcodeJoin.data)
  );

  const crossChainJoin = await stranger.rpc("join_chain_property", {
    p_access_code: fixture.newFormatAccessCode,
    p_address: fixture.chainBAddress,
    p_postcode: fixture.salePostcode,
  });

  record(
    "Chain A code + Chain B property denied (generic)",
    assertGenericJoinFailure(crossChainJoin.data),
    JSON.stringify(crossChainJoin.data)
  );

  record(
    "Join failures indistinguishable at public boundary",
    wrongCodeJoin.data?.error === wrongAddressJoin.data?.error &&
      wrongAddressJoin.data?.error === wrongPostcodeJoin.data?.error,
    `errors=${wrongCodeJoin.data?.error}/${wrongAddressJoin.data?.error}/${wrongPostcodeJoin.data?.error}`
  );

  const lowercaseJoin = await stranger.rpc("join_chain_property", {
    p_access_code: fixture.newFormatAccessCode.toLowerCase(),
    p_address: fixture.saleAddress,
    p_postcode: fixture.salePostcode,
  });

  record(
    "Lowercase access code variant accepted via normalisation",
    lowercaseJoin.data?.ok === true,
    JSON.stringify(lowercaseJoin.data)
  );

  if (lowercaseJoin.data?.ok === true) {
    await admin
      .from("property_counterparty_participants")
      .delete()
      .eq("property_id", fixture.salePropertyId)
      .eq("user_id", fixture.strangerUserId);
    await admin
      .from("property_members")
      .delete()
      .eq("property_id", fixture.salePropertyId)
      .eq("user_id", fixture.strangerUserId);
    await admin
      .from("properties")
      .update({
        status: "pending_connection",
        buyer_connected: false,
      })
      .eq("id", fixture.salePropertyId);
  }

  const spacedCode = fixture.newFormatAccessCode.replace(/-/g, " ");
  const spacedJoin = await stranger.rpc("join_chain_property", {
    p_access_code: spacedCode,
    p_address: fixture.saleAddress,
    p_postcode: fixture.salePostcode,
  });

  record(
    "Spaces-instead-of-hyphens access code variant accepted",
    spacedJoin.data?.ok === true,
    JSON.stringify(spacedJoin.data)
  );

  if (spacedJoin.data?.ok === true) {
    await admin
      .from("property_counterparty_participants")
      .delete()
      .eq("property_id", fixture.salePropertyId)
      .eq("user_id", fixture.strangerUserId);
    await admin
      .from("property_members")
      .delete()
      .eq("property_id", fixture.salePropertyId)
      .eq("user_id", fixture.strangerUserId);
    await admin
      .from("properties")
      .update({
        status: "pending_connection",
        buyer_connected: false,
      })
      .eq("id", fixture.salePropertyId);
  }

  const noHyphenCode = fixture.newFormatAccessCode.replace(/-/g, "");
  const noHyphenJoin = await stranger.rpc("join_chain_property", {
    p_access_code: noHyphenCode,
    p_address: fixture.saleAddress,
    p_postcode: fixture.salePostcode,
  });

  record(
    "Hyphens-omitted access code variant accepted",
    noHyphenJoin.data?.ok === true,
    JSON.stringify(noHyphenJoin.data)
  );

  if (noHyphenJoin.data?.ok === true) {
    await admin
      .from("property_counterparty_participants")
      .delete()
      .eq("property_id", fixture.salePropertyId)
      .eq("user_id", fixture.strangerUserId);
    await admin
      .from("property_members")
      .delete()
      .eq("property_id", fixture.salePropertyId)
      .eq("user_id", fixture.strangerUserId);
    await admin
      .from("properties")
      .update({
        status: "pending_connection",
        buyer_connected: false,
      })
      .eq("id", fixture.salePropertyId);
  }

  const beforeSelfJoinProperty = await readPropertySnapshot(
    admin,
    fixture.salePropertyId
  );
  const beforeSelfJoinMembership = await countMembership(
    admin,
    fixture.salePropertyId,
    fixture.hostUserId
  );
  const beforeSelfJoinCounterparty = await countCounterparty(
    admin,
    fixture.salePropertyId,
    fixture.hostUserId
  );

  const hostAsCounterparty = await signIn(fixture.hostEmail, PASSWORD);
  const { data: hostSelfJoin } = await hostAsCounterparty.rpc(
    "join_chain_property",
    {
      p_access_code: fixture.newFormatAccessCode,
      p_address: fixture.saleAddress,
      p_postcode: fixture.salePostcode,
    }
  );

  const afterFailedSelfJoinProperty = await readPropertySnapshot(
    admin,
    fixture.salePropertyId
  );

  record(
    "Operational homeowner self-join denied (generic public error)",
    assertGenericJoinFailure(hostSelfJoin),
    JSON.stringify(hostSelfJoin)
  );

  record(
    "Failed self-join leaves property state unchanged",
    snapshotsEqual(beforeSelfJoinProperty, afterFailedSelfJoinProperty),
    JSON.stringify({
      before: beforeSelfJoinProperty,
      after: afterFailedSelfJoinProperty,
    })
  );

  record(
    "Failed self-join creates zero counterparty rows",
    (await countCounterparty(
      admin,
      fixture.salePropertyId,
      fixture.hostUserId
    )) === beforeSelfJoinCounterparty,
    `before=${beforeSelfJoinCounterparty}`
  );

  record(
    "Failed self-join preserves membership count",
    (await countMembership(admin, fixture.salePropertyId, fixture.hostUserId)) ===
      beforeSelfJoinMembership,
    `before=${beforeSelfJoinMembership}`
  );

  const beforeMembership = await countMembership(
    admin,
    fixture.salePropertyId,
    fixture.strangerUserId
  );

  const legitimateJoin = await stranger.rpc("join_chain_property", {
    p_access_code: fixture.newFormatAccessCode,
    p_address: fixture.saleAddress,
    p_postcode: fixture.salePostcode,
  });

  record(
    "Legitimate stranger join succeeds (new KN-XXX-XXXX code)",
    legitimateJoin.data?.ok === true &&
      legitimateJoin.data?.joining_role === "buyer",
    JSON.stringify(legitimateJoin.data)
  );

  record(
    "Successful join creates property_members row",
    (await countMembership(
      admin,
      fixture.salePropertyId,
      fixture.strangerUserId
    )) === 1 && beforeMembership === 0,
    `before=${beforeMembership}`
  );

  const legacyEaJoin = await stranger.rpc("join_chain_property", {
    p_access_code: fixture.legacyEaAccessCode,
    p_address: fixture.chainBAddress,
    p_postcode: fixture.salePostcode,
  });

  record(
    "Legacy EA 7-char access code join succeeds",
    legacyEaJoin.data?.ok === true,
    JSON.stringify(legacyEaJoin.data)
  );

  record(
    "TS normalisation helper includes canonical candidate",
    accessCodeLookupCandidates(fixture.newFormatAccessCode.toLowerCase()).includes(
      fixture.newFormatAccessCode
    ),
    accessCodeLookupCandidates(fixture.newFormatAccessCode.toLowerCase()).join(",")
  );

  const { data: directGrant, error: directGrantError } = await stranger.rpc(
    "grant_counterparty_participation",
    { p_property_id: fixture.salePropertyId }
  );

  record(
    "Direct grant_counterparty_participation blocked for authenticated client",
    !!directGrantError ||
      directGrant?.ok === false ||
      directGrant?.error === "not_authorized",
    directGrantError?.message ?? JSON.stringify(directGrant)
  );

  const { data: startMoveBypass, error: startMoveBypassError } =
    await stranger.rpc("establish_operational_homeowner", {
      p_property_id: fixture.salePropertyId,
      p_granted_via: "start_move",
    });

  record(
    "Direct establish_operational_homeowner(start_move) blocked",
    isRpcExecuteRevokedOrDenied({
      data: startMoveBypass,
      error: startMoveBypassError,
      allowedDataErrors: ["not_authorized"],
    }),
    startMoveBypassError?.message ?? JSON.stringify(startMoveBypass)
  );

  const { data: globalAddressOracle, error: globalAddressOracleError } =
    await stranger.rpc("property_exists_for_onboarding", {
      p_address: fixture.saleAddress,
      p_postcode: fixture.salePostcode,
    });

  record(
    "Global property_exists_for_onboarding oracle blocked",
    !!globalAddressOracleError || globalAddressOracle == null,
    globalAddressOracleError?.message ?? String(globalAddressOracle)
  );

  const { data: scopedAddressCheck } = await stranger.rpc(
    "validate_onboarding_property_address",
    {
      p_address: fixture.saleAddress,
      p_postcode: fixture.salePostcode,
      p_chain_id: fixture.chainBId,
    }
  );

  record(
    "validate_onboarding_property_address requires caller-owned chain",
    scopedAddressCheck?.ok === false &&
      scopedAddressCheck?.error === "not_authorized",
    JSON.stringify(scopedAddressCheck)
  );

  const hostClient = await signIn(fixture.hostEmail, PASSWORD);
  const { data: hostScopedCheck } = await hostClient.rpc(
    "validate_onboarding_property_address",
    {
      p_address: fixture.saleAddress,
      p_postcode: fixture.salePostcode,
      p_chain_id: fixture.chainAId,
    }
  );

  record(
    "Caller-owned chain duplicate check returns address_unavailable for occupied address",
    hostScopedCheck?.ok === false &&
      hostScopedCheck?.error === "address_unavailable",
    JSON.stringify(hostScopedCheck)
  );
}

function printSummary(): void {
  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("\nFailed checks:");
    for (const failure of failed) {
      console.log(`  - ${failure.name}${failure.detail ? `: ${failure.detail}` : ""}`);
    }
  }
}

async function main() {
  const execute = process.argv.includes("--execute");

  console.log("Chain Join Security — Development Verification\n");

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

  record("Development project ref guard", projectRef === DEVELOPMENT_SUPABASE_PROJECT_REF);

  runStaticChecks();
  await runAnonProbes();

  if (!execute) {
    console.log(
      "\nLive adversarial join probes require --execute (synthetic fixtures only)."
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
