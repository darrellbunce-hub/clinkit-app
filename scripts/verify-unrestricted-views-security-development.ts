/**
 * Development-only UNRESTRICTED-view security verification (report evidence).
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-unrestricted-views-security-development.ts
 *   npx tsx scripts/verify-unrestricted-views-security-development.ts --execute
 *
 * Default: read-only — project guard + static migration checks + anon PostgREST probes.
 * --execute: synthetic fixtures, authenticated isolation probes, try/finally cleanup.
 *
 * Does not alter grants, views, RLS, or Production. Temporary fixtures only.
 */
import { randomUUID } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const TEST_EMAIL_PREFIX = "unrestricted-views-sec";
const TEST_DOMAIN_SUFFIX = ".unrestricted-views-sec.test";
const PASSWORD = "UnrestrictedViewsSecDev123!";
const ROOT = join(import.meta.dirname, "..");

const NAMED_VIEWS = [
  "agent_branch_property_summaries",
  "chain_nodes_chain_summary",
  "chain_properties_participant",
  "ea_branch_directory",
  "ea_operational_assignments",
] as const;

type NamedView = (typeof NAMED_VIEWS)[number];
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

function readProjectFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function buildTestEmail(stamp: string, label: string, domain = TEST_DOMAIN_SUFFIX): string {
  return `${TEST_EMAIL_PREFIX}-${label}-${stamp}@${stamp}${domain}`;
}

/** Hex stamp → alphabet-safe KN-XXX-XXXX (excludes 0/1/I/O). */
function alphabetSafeAccessCode(stamp: string, tag: string): string {
  const raw = `${stamp}${tag}`
    .toUpperCase()
    .replace(/0/g, "2")
    .replace(/1/g, "3")
    .replace(/[^A-Z0-9]/g, "");
  const alnum = raw.padEnd(7, "X").slice(0, 7);
  return `KN-${alnum.slice(0, 3)}-${alnum.slice(3, 7)}`;
}

function anonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = resolveServiceRoleKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY required for --execute");
  }
  return createClient(url, serviceKey, {
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
  if (!created.error?.message?.toLowerCase().includes("already")) {
    throw new Error(`createUser ${email}: ${created.error?.message}`);
  }
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = listed.data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!existing?.id) throw new Error(`existing user not found: ${email}`);
  return existing.id;
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

async function deleteAuthUser(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.auth.admin.deleteUser(userId);
}

type SelectProbe = {
  errorCode: string | null;
  errorMessage: string | null;
  rowCount: number;
  rows: Record<string, unknown>[];
  permissionDenied: boolean;
};

async function selectView(
  client: SupabaseClient,
  view: string,
  options?: {
    columns?: string;
    filters?: Array<{ column: string; value: string | number }>;
    limit?: number;
  }
): Promise<SelectProbe> {
  let query = client
    .from(view)
    .select(options?.columns ?? "*")
    .limit(options?.limit ?? 50);
  for (const filter of options?.filters ?? []) {
    query = query.eq(filter.column, filter.value);
  }
  const { data, error } = await query;
  const errorMessage = error?.message ?? null;
  const errorCode = (error as { code?: string } | null)?.code ?? null;
  const permissionDenied =
    errorCode === "42501" ||
    !!errorMessage?.toLowerCase().includes("permission denied") ||
    !!errorMessage?.toLowerCase().includes("not accept") ||
    errorCode === "PGRST301";
  return {
    errorCode,
    errorMessage,
    rowCount: data?.length ?? 0,
    rows: (data as Record<string, unknown>[] | null) ?? [],
    permissionDenied,
  };
}

function classifyAnonProbe(probe: SelectProbe): "permission_denied" | "zero_rows" | "rows_returned" {
  if (probe.permissionDenied) return "permission_denied";
  if (probe.rowCount === 0) return "zero_rows";
  return "rows_returned";
}

function runStaticMigrationChecks(): void {
  console.log("\n--- Static migration / source checks ---\n");

  const currentDefs: Record<NamedView, string> = {
    agent_branch_property_summaries:
      "supabase/migrations/20260720100000_chain_intelligence_timing.sql",
    chain_nodes_chain_summary:
      "supabase/migrations/20260610280000_phase4a_ea_chain_operational_viewer.sql",
    chain_properties_participant:
      "supabase/migrations/20260725140000_chain_properties_participant_stage_entered_at.sql",
    ea_branch_directory:
      "supabase/migrations/20260610170000_phase4_ea_property_assignments.sql",
    ea_operational_assignments:
      "supabase/migrations/20260612000000_phase7a_ea_originated_properties.sql",
  };

  for (const view of NAMED_VIEWS) {
    const sql = readProjectFile(currentDefs[view]);
    const hasInvokerFalse = sql.includes(
      `create or replace view public.${view}`
    ) && /security_invoker\s*=\s*false/i.test(sql);
    const revokesAnon =
      sql.includes(`revoke all on public.${view} from anon`) ||
      sql.includes(`revoke all on public.${view} from public`);
    const grantsAuthenticated = sql.includes(
      `grant select on public.${view} to authenticated`
    );

    record(
      `Migration: ${view} uses security_invoker=false`,
      hasInvokerFalse
    );
    record(
      `Migration: ${view} revokes PUBLIC/anon and grants authenticated SELECT`,
      revokesAnon && grantsAuthenticated
    );
  }

  const migrationsDir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const otherViews = new Set<string>();
  for (const file of files) {
    const body = readProjectFile(join("supabase", "migrations", file));
    const matches = body.matchAll(
      /create\s+or\s+replace\s+view\s+public\.([a-z0-9_]+)/gi
    );
    for (const match of matches) {
      const name = match[1]!;
      if (!(NAMED_VIEWS as readonly string[]).includes(name)) {
        otherViews.add(name);
      }
    }
  }

  record(
    "No additional public-schema views created in migrations beyond the five named",
    otherViews.size === 0,
    otherViews.size === 0 ? "only five views" : [...otherViews].join(",")
  );

  const participantSql = readProjectFile(
    currentDefs.chain_properties_participant
  );
  record(
    "chain_properties_participant redacts peer address via is_property_member / is_ea_assigned_to_property",
    participantSql.includes("is_property_member(p.id) then p.address") &&
      participantSql.includes("else null")
  );

  const directorySql = readProjectFile(currentDefs.ea_branch_directory);
  record(
    "ea_branch_directory has no auth.uid() predicate (intentional authenticated directory)",
    !/auth\.uid\(\)/.test(
      directorySql.slice(
        directorySql.indexOf("create or replace view public.ea_branch_directory"),
        directorySql.indexOf("comment on view public.ea_branch_directory")
      )
    )
  );

  const summarySql = readProjectFile(currentDefs.agent_branch_property_summaries);
  record(
    "agent_branch_property_summaries scopes via ea_branch_members + auth.uid()",
    summarySql.includes("bm.user_id = auth.uid()") &&
      summarySql.includes("ea_branch_members")
  );
}

async function runAnonProbes(): Promise<void> {
  console.log("\n--- Anon PostgREST view probes ---\n");
  const anon = anonClient();

  for (const view of NAMED_VIEWS) {
    const probe = await selectView(anon, view, { limit: 5 });
    const classification = classifyAnonProbe(probe);
    const sensitiveHit =
      classification === "rows_returned" &&
      probe.rows.some(
        (row) =>
          row.address != null ||
          row.postcode != null ||
          row.invite_email != null ||
          row.subject_user_id != null ||
          row.access_code != null
      );

    record(
      `Anon SELECT ${view} denied (not rows with private data)`,
      classification === "permission_denied" ||
        (classification === "zero_rows" && !sensitiveHit),
      `${classification}; code=${probe.errorCode ?? "none"}; rows=${probe.rowCount}; sensitive=${sensitiveHit}`
    );

    // Stronger expectation from migrations: anon SELECT revoked → permission denied preferred
    record(
      `Anon SELECT ${view} is permission-denied (grant revoked)`,
      classification === "permission_denied",
      `${classification}; ${probe.errorMessage ?? "ok"}`
    );
  }

  // Compatibility: base tables remain protected
  for (const table of ["properties", "chains", "property_members", "ea_branches"]) {
    const probe = await selectView(anon, table, { limit: 1 });
    const classification = classifyAnonProbe(probe);
    record(
      `Anon SELECT base ${table} blocked/empty`,
      classification === "permission_denied" || classification === "zero_rows",
      `${classification}; rows=${probe.rowCount}`
    );
  }
}

type FixtureContext = {
  stamp: string;
  homeownerAEmail: string;
  peerBEmail: string;
  strangerEmail: string;
  homeownerCEmail: string;
  eaAEmail: string;
  eaBEmail: string;
  homeownerAUserId: string;
  peerBUserId: string;
  strangerUserId: string;
  homeownerCUserId: string;
  eaAUserId: string;
  eaBUserId: string;
  chainAId: number;
  chainCId: number;
  propertyAId: number;
  propertyBId: number;
  propertyCId: number;
  addressA: string;
  addressB: string;
  addressC: string;
  accessCodeA: string;
  branchAId: string;
  branchBId: string;
  companyAId: string;
  companyBId: string;
  assignmentAId: string | null;
  assignmentCId: string | null;
  chainNodeId: number | null;
};

async function createHomeownerChainProperty(
  client: SupabaseClient,
  userId: string,
  stamp: string,
  label: string,
  address: string,
  postcode: string,
  accessCode: string
): Promise<{ chainId: number; propertyId: number }> {
  const { data: chainResult, error: chainError } = await client.rpc(
    "create_chain_for_onboarding",
    {
      p_name: `UV-${label}-${stamp}`,
      p_access_code: accessCode,
    }
  );
  if (chainError || !chainResult?.ok || chainResult.chain_id == null) {
    throw new Error(
      `create_chain_for_onboarding ${label}: ${chainError?.message ?? chainResult?.error}`
    );
  }
  const chainId = chainResult.chain_id as number;

  const { data: property, error: propertyError } = await client
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 1,
      address,
      postcode,
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: userId,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();
  if (propertyError || !property) {
    throw new Error(`property insert ${label}: ${propertyError?.message}`);
  }

  const { error: memberError } = await client.rpc(
    "establish_operational_homeowner_for_created_property",
    { p_property_id: property.id }
  );
  if (memberError) {
    throw new Error(
      `establish_operational_homeowner ${label}: ${memberError.message}`
    );
  }

  return { chainId, propertyId: property.id as number };
}

async function createFixture(admin: SupabaseClient, stamp: string): Promise<FixtureContext> {
  const homeownerAEmail = buildTestEmail(stamp, "homeownera");
  const peerBEmail = buildTestEmail(stamp, "peerb");
  const strangerEmail = buildTestEmail(stamp, "stranger");
  const homeownerCEmail = buildTestEmail(stamp, "homeownerc");

  // Business-email domains for EA onboarding validation
  const eaADomainEmail = `eaa-${stamp}@viewsseca${stamp.slice(0, 6)}.co.uk`;
  const eaBDomainEmail = `eab-${stamp}@viewssecb${stamp.slice(0, 6)}.co.uk`;

  const homeownerAUserId = await ensureAuthUser(admin, homeownerAEmail, PASSWORD);
  const peerBUserId = await ensureAuthUser(admin, peerBEmail, PASSWORD);
  const strangerUserId = await ensureAuthUser(admin, strangerEmail, PASSWORD);
  const homeownerCUserId = await ensureAuthUser(admin, homeownerCEmail, PASSWORD);
  const eaAUserId = await ensureAuthUser(admin, eaADomainEmail, PASSWORD);
  const eaBUserId = await ensureAuthUser(admin, eaBDomainEmail, PASSWORD);

  const homeownerA = await signIn(homeownerAEmail, PASSWORD);
  const homeownerC = await signIn(homeownerCEmail, PASSWORD);
  const peerB = await signIn(peerBEmail, PASSWORD);
  const eaA = await signIn(eaADomainEmail, PASSWORD);
  const eaB = await signIn(eaBDomainEmail, PASSWORD);

  const accessCodeA = alphabetSafeAccessCode(stamp, "A");
  const accessCodeC = alphabetSafeAccessCode(stamp, "C");
  const addressA = `11 Views Audit Lane ${stamp}`;
  const addressB = `22 Peer Views Road ${stamp}`;
  const addressC = `33 Cross Branch Ave ${stamp}`;

  const chainA = await createHomeownerChainProperty(
    homeownerA,
    homeownerAUserId,
    stamp,
    "A",
    addressA,
    "UV1A",
    accessCodeA
  );

  // Peer property on same chain (join target) — needs operational identity for join RPC
  const { data: propertyB, error: propertyBError } = await homeownerA
    .from("properties")
    .insert({
      chain_id: chainA.chainId,
      chain_position: 2,
      address: addressB,
      postcode: "UV1B",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: homeownerAUserId,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();
  if (propertyBError || !propertyB) {
    throw new Error(`property B insert: ${propertyBError?.message}`);
  }

  const { error: identityBError } = await admin
    .from("property_operational_identities")
    .insert({
      property_id: propertyB.id,
      homeowner_user_id: homeownerAUserId,
      operational_role: "seller",
      granted_via: "backfill",
      status: "active",
    });
  if (identityBError) {
    throw new Error(
      `property B operational identity: ${identityBError.message}`
    );
  }

  const join = await peerB.rpc("join_chain_property", {
    p_access_code: accessCodeA,
    p_address: addressB,
    p_postcode: "UV1B",
  });
  if (!join.data?.ok) {
    throw new Error(
      `peer join failed: ${join.error?.message ?? join.data?.error ?? "unknown"}`
    );
  }

  const chainC = await createHomeownerChainProperty(
    homeownerC,
    homeownerCUserId,
    stamp,
    "C",
    addressC,
    "UV1C",
    accessCodeC
  );

  // Buyer Ready node for chain summary probes
  const { data: chainNode, error: chainNodeError } = await admin
    .from("chain_nodes")
    .insert({
      chain_id: chainA.chainId,
      node_type: "buyer_ready",
      position: 1,
      status: "not_started",
      progress: 0,
      linked_property_id: chainA.propertyId,
      stage: null,
    })
    .select("id")
    .single();
  if (chainNodeError) {
    console.warn(`chain_nodes insert warning: ${chainNodeError.message}`);
  }

  // EA onboarding for two isolated branches
  const profileA = await createEstateAgentProfile(eaA, {
    userId: eaAUserId,
    contactName: "Views EA A",
    email: eaADomainEmail,
  });
  if (profileA.error) throw new Error(`EA A profile: ${profileA.error}`);
  const onboardA = await completeEstateAgentOnboarding(eaA, {
    userId: eaAUserId,
    companyName: `Views Co A ${stamp}`,
    branchName: `Views Branch A ${stamp}`,
    townOrCity: "Fareham",
    postcode: "PO16 7AA",
    isHeadOffice: true,
    emailDomain: eaADomainEmail.split("@")[1]!,
  });
  if (!onboardA.success) throw new Error(`EA A onboard: ${onboardA.error}`);

  const profileB = await createEstateAgentProfile(eaB, {
    userId: eaBUserId,
    contactName: "Views EA B",
    email: eaBDomainEmail,
  });
  if (profileB.error) throw new Error(`EA B profile: ${profileB.error}`);
  const onboardB = await completeEstateAgentOnboarding(eaB, {
    userId: eaBUserId,
    companyName: `Views Co B ${stamp}`,
    branchName: `Views Branch B ${stamp}`,
    townOrCity: "Portsmouth",
    postcode: "PO1 2AA",
    isHeadOffice: true,
    emailDomain: eaBDomainEmail.split("@")[1]!,
  });
  if (!onboardB.success) throw new Error(`EA B onboard: ${onboardB.error}`);

  const { data: membershipA } = await admin
    .from("ea_branch_members")
    .select("branch_id")
    .eq("user_id", eaAUserId)
    .single();
  const { data: membershipB } = await admin
    .from("ea_branch_members")
    .select("branch_id")
    .eq("user_id", eaBUserId)
    .single();
  if (!membershipA?.branch_id || !membershipB?.branch_id) {
    throw new Error("EA branch membership missing after onboarding");
  }

  const { data: branchA } = await admin
    .from("ea_branches")
    .select("id, company_id")
    .eq("id", membershipA.branch_id)
    .single();
  const { data: branchB } = await admin
    .from("ea_branches")
    .select("id, company_id")
    .eq("id", membershipB.branch_id)
    .single();
  if (!branchA || !branchB) throw new Error("EA branches missing");

  const { data: assignmentA, error: assignAError } = await admin
    .from("property_ea_assignments")
    .insert({
      property_id: chainA.propertyId,
      branch_id: branchA.id,
      status: "active",
      assigned_by_user_id: homeownerAUserId,
      homeowner_only_updates: false,
    })
    .select("id")
    .single();
  if (assignAError || !assignmentA) {
    throw new Error(`assignment A: ${assignAError?.message}`);
  }

  const { data: assignmentC, error: assignCError } = await admin
    .from("property_ea_assignments")
    .insert({
      property_id: chainC.propertyId,
      branch_id: branchB.id,
      status: "active",
      assigned_by_user_id: homeownerCUserId,
      homeowner_only_updates: false,
    })
    .select("id")
    .single();
  if (assignCError || !assignmentC) {
    throw new Error(`assignment C: ${assignCError?.message}`);
  }

  return {
    stamp,
    homeownerAEmail,
    peerBEmail,
    strangerEmail,
    homeownerCEmail,
    eaAEmail: eaADomainEmail,
    eaBEmail: eaBDomainEmail,
    homeownerAUserId,
    peerBUserId,
    strangerUserId,
    homeownerCUserId,
    eaAUserId,
    eaBUserId,
    chainAId: chainA.chainId,
    chainCId: chainC.chainId,
    propertyAId: chainA.propertyId,
    propertyBId: propertyB.id as number,
    propertyCId: chainC.propertyId,
    addressA,
    addressB,
    addressC,
    accessCodeA,
    branchAId: branchA.id as string,
    branchBId: branchB.id as string,
    companyAId: branchA.company_id as string,
    companyBId: branchB.company_id as string,
    assignmentAId: assignmentA.id as string,
    assignmentCId: assignmentC.id as string,
    chainNodeId: (chainNode?.id as number | undefined) ?? null,
  };
}

async function cleanupFixture(
  admin: SupabaseClient,
  fixture: FixtureContext
): Promise<string[]> {
  const warnings: string[] = [];
  const deleteEq = async (
    table: string,
    column: string,
    value: string | number
  ) => {
    const { error } = await admin.from(table).delete().eq(column, value);
    if (error) warnings.push(`${table}.${column}=${value}: ${error.message}`);
  };

  if (fixture.chainNodeId != null) {
    await deleteEq("chain_nodes", "id", fixture.chainNodeId);
  }
  await deleteEq("activities", "property_id", fixture.propertyAId);
  await deleteEq("activities", "property_id", fixture.propertyBId);
  await deleteEq("activities", "property_id", fixture.propertyCId);
  if (fixture.assignmentAId) {
    await deleteEq("property_ea_assignments", "id", fixture.assignmentAId);
  }
  if (fixture.assignmentCId) {
    await deleteEq("property_ea_assignments", "id", fixture.assignmentCId);
  }
  await deleteEq("property_lifecycle_events", "property_id", fixture.propertyAId);
  await deleteEq("property_lifecycle_events", "property_id", fixture.propertyBId);
  await deleteEq("property_lifecycle_events", "property_id", fixture.propertyCId);
  await deleteEq("property_lifecycle_states", "property_id", fixture.propertyAId);
  await deleteEq("property_lifecycle_states", "property_id", fixture.propertyBId);
  await deleteEq("property_lifecycle_states", "property_id", fixture.propertyCId);
  await deleteEq("property_claim_invitations", "property_id", fixture.propertyAId);
  await deleteEq("property_claim_invitations", "property_id", fixture.propertyCId);
  await deleteEq("property_claim_metadata", "property_id", fixture.propertyAId);
  await deleteEq("property_claim_metadata", "property_id", fixture.propertyCId);
  await deleteEq("property_members", "property_id", fixture.propertyAId);
  await deleteEq("property_members", "property_id", fixture.propertyBId);
  await deleteEq("property_members", "property_id", fixture.propertyCId);
  await deleteEq(
    "property_counterparty_participants",
    "property_id",
    fixture.propertyAId
  );
  await deleteEq(
    "property_counterparty_participants",
    "property_id",
    fixture.propertyBId
  );
  await deleteEq(
    "property_operational_identities",
    "property_id",
    fixture.propertyAId
  );
  await deleteEq(
    "property_operational_identities",
    "property_id",
    fixture.propertyCId
  );
  await deleteEq("property_operational_summary", "property_id", fixture.propertyAId);
  await deleteEq("property_operational_summary", "property_id", fixture.propertyCId);
  await deleteEq("chain_operational_summary", "chain_id", fixture.chainAId);
  await deleteEq("chain_operational_summary", "chain_id", fixture.chainCId);
  await deleteEq("properties", "id", fixture.propertyAId);
  await deleteEq("properties", "id", fixture.propertyBId);
  await deleteEq("properties", "id", fixture.propertyCId);
  await deleteEq("chains", "id", fixture.chainAId);
  await deleteEq("chains", "id", fixture.chainCId);

  // Delete branches first (cascades members) to avoid owner-invariant trigger on member deletes
  await deleteEq("ea_branch_invitations", "branch_id", fixture.branchAId);
  await deleteEq("ea_branch_invitations", "branch_id", fixture.branchBId);
  const { error: eventsA } = await admin
    .from("ea_branch_membership_events")
    .delete()
    .eq("branch_id", fixture.branchAId);
  if (eventsA) warnings.push(`membership_events A: ${eventsA.message}`);
  const { error: eventsB } = await admin
    .from("ea_branch_membership_events")
    .delete()
    .eq("branch_id", fixture.branchBId);
  if (eventsB) warnings.push(`membership_events B: ${eventsB.message}`);
  await deleteEq("ea_branches", "id", fixture.branchAId);
  await deleteEq("ea_branches", "id", fixture.branchBId);
  await deleteEq("ea_companies", "id", fixture.companyAId);
  await deleteEq("ea_companies", "id", fixture.companyBId);

  for (const userId of [
    fixture.homeownerAUserId,
    fixture.peerBUserId,
    fixture.strangerUserId,
    fixture.homeownerCUserId,
    fixture.eaAUserId,
    fixture.eaBUserId,
  ]) {
    const { error: profileError } = await admin
      .from("profiles")
      .delete()
      .eq("id", userId);
    if (profileError) warnings.push(`profile ${userId}: ${profileError.message}`);
    await deleteAuthUser(admin, userId);
  }

  return warnings;
}

async function verifyCleanup(
  admin: SupabaseClient,
  fixture: FixtureContext
): Promise<boolean> {
  const checks = [
    { table: "properties", column: "id", value: fixture.propertyAId },
    { table: "properties", column: "id", value: fixture.propertyCId },
    { table: "chains", column: "id", value: fixture.chainAId },
    { table: "chains", column: "id", value: fixture.chainCId },
    { table: "ea_branches", column: "id", value: fixture.branchAId },
    { table: "ea_branches", column: "id", value: fixture.branchBId },
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
  console.log("\n--- Authenticated view isolation probes (--execute) ---\n");

  const homeownerA = await signIn(fixture.homeownerAEmail, PASSWORD);
  const peerB = await signIn(fixture.peerBEmail, PASSWORD);
  const stranger = await signIn(fixture.strangerEmail, PASSWORD);
  const homeownerC = await signIn(fixture.homeownerCEmail, PASSWORD);
  const eaA = await signIn(fixture.eaAEmail, PASSWORD);
  const eaB = await signIn(fixture.eaBEmail, PASSWORD);

  // --- chain_properties_participant ---
  const aParticipant = await selectView(homeownerA, "chain_properties_participant", {
    columns: "id, chain_id, address, postcode, is_own_property",
    filters: [{ column: "chain_id", value: fixture.chainAId }],
  });
  record(
    "Homeowner A reads chain_properties_participant for own chain",
    !aParticipant.permissionDenied && aParticipant.rowCount >= 2,
    `rows=${aParticipant.rowCount}; err=${aParticipant.errorMessage ?? "none"}`
  );
  const aOwn = aParticipant.rows.find((r) => r.id === fixture.propertyAId);
  const aPeer = aParticipant.rows.find((r) => r.id === fixture.propertyBId);
  record(
    "Homeowner A sees own property address",
    aOwn?.address === fixture.addressA,
    String(aOwn?.address ?? "missing")
  );
  record(
    "Homeowner A peer property address redacted",
    aPeer != null && (aPeer.address == null || aPeer.address === ""),
    `peerAddress=${String(aPeer?.address ?? "null")}`
  );

  const bParticipant = await selectView(peerB, "chain_properties_participant", {
    columns: "id, chain_id, address, postcode, is_own_property",
    filters: [{ column: "chain_id", value: fixture.chainAId }],
  });
  const bOwn = bParticipant.rows.find((r) => r.id === fixture.propertyBId);
  const bPeer = bParticipant.rows.find((r) => r.id === fixture.propertyAId);
  record(
    "Peer B sees own property address",
    bOwn?.address === fixture.addressB,
    String(bOwn?.address ?? "missing")
  );
  record(
    "Peer B cannot see Homeowner A address",
    bPeer != null && (bPeer.address == null || bPeer.address === ""),
    `peerAddress=${String(bPeer?.address ?? "null")}`
  );

  const strangerParticipantA = await selectView(
    stranger,
    "chain_properties_participant",
    {
      columns: "id, address, chain_id",
      filters: [{ column: "chain_id", value: fixture.chainAId }],
    }
  );
  record(
    "Stranger gets zero chain_properties_participant rows for Chain A",
    strangerParticipantA.rowCount === 0 && !strangerParticipantA.permissionDenied,
    `rows=${strangerParticipantA.rowCount}; err=${strangerParticipantA.errorMessage ?? "none"}`
  );

  const strangerParticipantAll = await selectView(
    stranger,
    "chain_properties_participant",
    { columns: "id, address", limit: 20 }
  );
  const strangerSeesFixture = strangerParticipantAll.rows.some(
    (r) =>
      r.id === fixture.propertyAId ||
      r.id === fixture.propertyBId ||
      r.id === fixture.propertyCId ||
      r.address === fixture.addressA ||
      r.address === fixture.addressC
  );
  record(
    "Stranger cannot see fixture properties via chain_properties_participant",
    !strangerSeesFixture,
    `rows=${strangerParticipantAll.rowCount}`
  );

  // Base-table compatibility with platform-security evidence
  const strangerBase = await selectView(stranger, "properties", {
    columns: "id, address",
    filters: [{ column: "id", value: fixture.propertyAId }],
  });
  record(
    "Stranger cannot read fixture property via base properties table",
    strangerBase.rowCount === 0 ||
      strangerBase.rows.every((r) => r.address == null || r.address === ""),
    `rows=${strangerBase.rowCount}; address=${String(strangerBase.rows[0]?.address ?? "none")}`
  );

  // --- chain_nodes_chain_summary ---
  const aNodes = await selectView(homeownerA, "chain_nodes_chain_summary", {
    columns:
      "id, chain_id, node_type, linked_property_id, status, progress, public_stage_label",
    filters: [{ column: "chain_id", value: fixture.chainAId }],
  });
  if (fixture.chainNodeId == null) {
    record(
      "chain_nodes_chain_summary fixture node available",
      false,
      "chain_nodes insert failed — summary isolation partially not testable"
    );
  } else {
    record(
      "Participant sees own-chain buyer_ready summary rows",
      aNodes.rowCount >= 1 &&
        aNodes.rows.some((r) => r.id === fixture.chainNodeId),
      `rows=${aNodes.rowCount}`
    );
    record(
      "chain_nodes_chain_summary does not expose access_code column data",
      aNodes.rows.every((r) => !("access_code" in r) || r.access_code == null),
      Object.keys(aNodes.rows[0] ?? {}).join(",")
    );
  }

  const strangerNodes = await selectView(stranger, "chain_nodes_chain_summary", {
    columns: "id, chain_id, linked_property_id, progress",
    filters: [{ column: "chain_id", value: fixture.chainAId }],
  });
  record(
    "Stranger cannot enumerate Chain A via chain_nodes_chain_summary",
    strangerNodes.rowCount === 0,
    `rows=${strangerNodes.rowCount}`
  );

  const strangerNodesAll = await selectView(stranger, "chain_nodes_chain_summary", {
    columns: "id, chain_id",
    limit: 50,
  });
  record(
    "Stranger cannot see fixture chain_nodes_chain_summary rows globally",
    !strangerNodesAll.rows.some(
      (r) => r.chain_id === fixture.chainAId || r.id === fixture.chainNodeId
    ),
    `rows=${strangerNodesAll.rowCount}`
  );

  // --- ea_branch_directory (intentional authenticated directory) ---
  const strangerDirectory = await selectView(stranger, "ea_branch_directory", {
    columns: "branch_id, branch_name, town_or_city, postcode, company_id, company_name",
    limit: 200,
  });
  record(
    "Authenticated stranger can read ea_branch_directory (intentional)",
    !strangerDirectory.permissionDenied && strangerDirectory.rowCount >= 1,
    `rows=${strangerDirectory.rowCount}`
  );
  const seesFixtureBranches =
    strangerDirectory.rows.some((r) => r.branch_id === fixture.branchAId) &&
    strangerDirectory.rows.some((r) => r.branch_id === fixture.branchBId);
  record(
    "Directory exposes fixture branch/company identity fields only (no member emails)",
    seesFixtureBranches &&
      strangerDirectory.rows.every(
        (r) =>
          !("invite_email" in r) &&
          !("email" in r) &&
          !("user_id" in r) &&
          !("subject_user_id" in r)
      ),
    seesFixtureBranches ? "fixture branches visible" : "fixture branches missing"
  );

  const homeownerDirectory = await selectView(homeownerA, "ea_branch_directory", {
    columns: "branch_id, company_name",
    filters: [{ column: "branch_id", value: fixture.branchAId }],
  });
  record(
    "Homeowner can use ea_branch_directory for assignment search",
    homeownerDirectory.rowCount === 1,
    `rows=${homeownerDirectory.rowCount}`
  );

  // --- agent_branch_property_summaries ---
  const eaASummaries = await selectView(eaA, "agent_branch_property_summaries", {
    columns:
      "assignment_id, property_id, branch_id, address, postcode, chain_id, invite_email",
    limit: 50,
  });
  const eaASeesOwn = eaASummaries.rows.some(
    (r) => r.property_id === fixture.propertyAId && r.branch_id === fixture.branchAId
  );
  const eaASeesForeign = eaASummaries.rows.some(
    (r) =>
      r.property_id === fixture.propertyCId || r.branch_id === fixture.branchBId
  );
  record(
    "EA Branch A sees own assigned property summary (incl. address)",
    eaASeesOwn &&
      eaASummaries.rows.some(
        (r) =>
          r.property_id === fixture.propertyAId && r.address === fixture.addressA
      ),
    `rows=${eaASummaries.rowCount}`
  );
  record(
    "EA Branch A cannot see Branch B property summaries",
    !eaASeesForeign,
    eaASeesForeign ? "cross-branch leak" : "isolated"
  );

  const eaBSummaries = await selectView(eaB, "agent_branch_property_summaries", {
    columns: "property_id, branch_id, address, chain_id",
    limit: 50,
  });
  const eaBSeesOwn = eaBSummaries.rows.some(
    (r) => r.property_id === fixture.propertyCId && r.branch_id === fixture.branchBId
  );
  const eaBSeesForeign = eaBSummaries.rows.some(
    (r) =>
      r.property_id === fixture.propertyAId || r.branch_id === fixture.branchAId
  );
  record(
    "EA Branch B sees own assigned property summary",
    eaBSeesOwn,
    `rows=${eaBSummaries.rowCount}`
  );
  record(
    "EA Branch B cannot see Branch A property summaries",
    !eaBSeesForeign,
    eaBSeesForeign ? "cross-branch leak" : "isolated"
  );

  const homeownerSummaries = await selectView(
    homeownerA,
    "agent_branch_property_summaries",
    {
      columns: "property_id, address, branch_id",
      limit: 50,
    }
  );
  record(
    "Homeowner cannot obtain EA-only agent_branch_property_summaries rows",
    !homeownerSummaries.rows.some(
      (r) =>
        r.property_id === fixture.propertyAId ||
        r.property_id === fixture.propertyCId ||
        r.address === fixture.addressA
    ),
    `rows=${homeownerSummaries.rowCount}`
  );

  const strangerSummaries = await selectView(
    stranger,
    "agent_branch_property_summaries",
    {
      columns: "property_id, branch_id, address",
      limit: 50,
    }
  );
  record(
    "Stranger cannot enumerate agent_branch_property_summaries fixture rows",
    !strangerSummaries.rows.some(
      (r) =>
        r.property_id === fixture.propertyAId ||
        r.property_id === fixture.propertyCId ||
        r.branch_id === fixture.branchAId ||
        r.branch_id === fixture.branchBId
    ),
    `rows=${strangerSummaries.rowCount}`
  );

  // --- ea_operational_assignments ---
  const eaAOps = await selectView(eaA, "ea_operational_assignments", {
    columns: "property_id, chain_id, subject_user_id, claim_status, origin_type",
    limit: 50,
  });
  record(
    "EA Branch A sees operational assignment for assigned property",
    eaAOps.rows.some(
      (r) =>
        r.property_id === fixture.propertyAId &&
        r.subject_user_id === fixture.homeownerAUserId
    ),
    `rows=${eaAOps.rowCount}`
  );
  record(
    "EA Branch A cannot see Branch B operational assignments",
    !eaAOps.rows.some((r) => r.property_id === fixture.propertyCId),
    "isolated"
  );

  const eaBOps = await selectView(eaB, "ea_operational_assignments", {
    columns: "property_id, subject_user_id",
    limit: 50,
  });
  record(
    "EA Branch B sees own operational assignment only",
    eaBOps.rows.some((r) => r.property_id === fixture.propertyCId) &&
      !eaBOps.rows.some((r) => r.property_id === fixture.propertyAId),
    `rows=${eaBOps.rowCount}`
  );

  const homeownerOps = await selectView(homeownerA, "ea_operational_assignments", {
    columns: "property_id, subject_user_id",
    limit: 50,
  });
  record(
    "Homeowner cannot read ea_operational_assignments fixture rows",
    !homeownerOps.rows.some(
      (r) =>
        r.property_id === fixture.propertyAId ||
        r.property_id === fixture.propertyCId
    ),
    `rows=${homeownerOps.rowCount}`
  );

  const strangerOps = await selectView(stranger, "ea_operational_assignments", {
    columns: "property_id, subject_user_id",
    limit: 50,
  });
  record(
    "Stranger cannot enumerate ea_operational_assignments fixture rows",
    !strangerOps.rows.some(
      (r) =>
        r.property_id === fixture.propertyAId ||
        r.property_id === fixture.propertyCId
    ),
    `rows=${strangerOps.rowCount}`
  );

  // EA assigned to property A can see address on participant view for assigned property
  const eaAParticipant = await selectView(eaA, "chain_properties_participant", {
    columns: "id, address, chain_id",
    filters: [{ column: "chain_id", value: fixture.chainAId }],
  });
  record(
    "Assigned EA can view operational chain_properties_participant for assigned chain",
    eaAParticipant.rows.some(
      (r) => r.id === fixture.propertyAId && r.address === fixture.addressA
    ),
    `rows=${eaAParticipant.rowCount}`
  );
  record(
    "Assigned EA cannot see unrelated Chain C via participant view",
    !(
      await selectView(eaA, "chain_properties_participant", {
        columns: "id",
        filters: [{ column: "chain_id", value: fixture.chainCId }],
      })
    ).rows.some((r) => r.id === fixture.propertyCId),
    "isolated"
  );

  // Enumeration note for directory (documented intentional)
  record(
    "ea_branch_directory enumerates branch/company IDs to authenticated users (by design)",
    seesFixtureBranches,
    "documented intentional directory — not treated as exploit"
  );

  void homeownerC;
}

async function main() {
  loadEnvLocal();
  const execute = process.argv.includes("--execute");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  const projectRef = assertDevelopmentEnvironment(supabaseUrl);

  console.log("Unrestricted Views Security — Development Verification\n");
  console.log(`Environment: Development (${projectRef})`);
  console.log("Production: NOT targeted");
  console.log(`Mode: ${execute ? "--execute" : "read-only"}`);
  record("Development project ref guard", true);

  runStaticMigrationChecks();
  await runAnonProbes();

  if (!execute) {
    console.log(
      "\nRead-only complete. Re-run with --execute for authenticated isolation fixtures.\n"
    );
  } else {
    const admin = serviceClient();
    const stamp = randomUUID().slice(0, 8);
    console.log(`\nFixture stamp: ${stamp}\n`);
    let fixture: FixtureContext | null = null;
    try {
      fixture = await createFixture(admin, stamp);
      await runExecuteProbes(fixture);
    } finally {
      console.log("\n--- Cleanup ---\n");
      if (fixture) {
        const warnings = await cleanupFixture(admin, fixture);
        for (const warning of warnings) {
          console.warn(`cleanup warning: ${warning}`);
        }
        const clean = await verifyCleanup(admin, fixture);
        record("Fixture cleanup residual-free", clean);
      }
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed\n`
  );
  if (failed.length > 0) {
    console.log("Failures:");
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
