/**
 * Development-only verification for generate_erasure_impact_report (read-only).
 *
 * Requires migration 20260718100000_gdpr_erasure_impact_report.sql applied on Development.
 *
 * Usage (after manual migration apply):
 *   npx tsx scripts/verify-gdpr-erasure-impact-report.ts
 */
import { randomUUID } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

import { generateErasureImpactReport } from "../lib/gdpr/erasureImpactReport";
import type { ErasureImpactReportSuccess } from "../lib/gdpr/types";
import {
  establishOperationalHomeowner,
  OPERATIONAL_IDENTITY_GRANT_VIA,
} from "../lib/ownership/grants";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "GdprImpactReport123!";

const PLACEHOLDER_SERVICE_ROLE_KEYS = new Set([
  "your-service-role-key",
  "your_service_role_key",
  "your-service_role_key",
]);

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

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
  let value = raw.trim();
  if (PLACEHOLDER_SERVICE_ROLE_KEYS.has(value.toLowerCase())) return undefined;
  const embeddedKey = value.match(/^your[_-]?service[_-]?role[_-]?key=(.+)$/i);
  if (embeddedKey) value = embeddedKey[1].trim();
  if (!value || PLACEHOLDER_SERVICE_ROLE_KEYS.has(value.toLowerCase())) {
    return undefined;
  }
  return value;
}

function assertDevelopmentEnvironment(supabaseUrl: string): void {
  const match = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const projectRef = match?.[1] ?? null;
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(
      `Refusing to run: Supabase project "${projectRef ?? "unknown"}" is not Development.`
    );
  }
}

/** Leaf JSON keys that must never carry raw string PII in report output. */
const RAW_PII_LEAF_KEYS = new Set([
  "recipient_email",
  "invite_email",
  "contact_name",
  "email",
  "address",
  "postcode",
  "access_code",
  "invitation_token",
  "invitation_token_hash",
  "provider_payload",
  "raw_user_meta_data",
  "user_metadata",
]);

const EMAIL_VALUE_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * Walk parsed report JSON and reject actual PII values or forbidden leaf keys.
 * Schema keys such as email_correlated_records or claim_metadata_invite_email
 * (with numeric counts) are allowed.
 */
function findReportPiiViolation(
  node: unknown,
  path: string
): string | null {
  if (typeof node === "string") {
    if (EMAIL_VALUE_PATTERN.test(node)) {
      return `${path}: email-shaped string value`;
    }
    return null;
  }

  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const found = findReportPiiViolation(node[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }

  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;

      if (
        RAW_PII_LEAF_KEYS.has(key) &&
        typeof value === "string" &&
        value.trim().length > 0
      ) {
        return `${childPath}: sensitive leaf key holds non-empty string`;
      }

      const nested = findReportPiiViolation(value, childPath);
      if (nested) return nested;
    }
  }

  return null;
}

/** Reject common PII patterns in serialized report output. */
function assertReportContainsNoRawPii(reportJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reportJson);
  } catch {
    return "report output is not valid JSON";
  }

  return findReportPiiViolation(parsed, "");
}

async function signUpUser(stamp: number, label: string) {
  const email = `gdpr-impact-${label}-${stamp}@keynetic-test.dev`;
  const boot = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await boot.auth.signUp({ email, password: PASSWORD });
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw error;
  const userId = (await client.auth.getUser()).data.user!.id;
  await client.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "GDPR Impact Test",
    onboarding_completed_at: new Date().toISOString(),
  });
  return { client, userId, email };
}

async function createChain(client: SupabaseClient, stamp: number, suffix: string) {
  const { data, error } = await client.rpc("create_chain_for_onboarding", {
    p_name: `GDPR Impact ${suffix} ${stamp}`,
    p_access_code: `GI${stamp}${suffix}`.slice(0, 12),
  });
  if (error || !data?.ok) {
    throw new Error(error?.message ?? data?.error ?? "chain_create_failed");
  }
  return data.chain_id as number;
}

async function insertProperty(params: {
  client: SupabaseClient;
  chainId: number;
  chainPosition: number;
  userId: string;
  stamp: number;
  label: string;
}) {
  const { data, error } = await params.client
    .from("properties")
    .insert({
      chain_id: params.chainId,
      chain_position: params.chainPosition,
      address: `${params.stamp} GDPR ${params.label}`,
      postcode: "E1 1GD",
      stage: "property_listed",
      status: "healthy",
      relationship_type: "sale",
      created_by_user_id: params.userId,
      buyer_connected: false,
      seller_connected: false,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "property_insert_failed");
  return data.id as number;
}

async function snapshotUserFootprint(admin: SupabaseClient, userId: string) {
  const [identities, members, delinks, confirmations, emailEventsSent] =
    await Promise.all([
      admin
        .from("property_operational_identities")
        .select("property_id", { count: "exact", head: true })
        .eq("homeowner_user_id", userId),
      admin
        .from("property_members")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      admin
        .from("property_delink_events")
        .select("id", { count: "exact", head: true })
        .eq("actor_user_id", userId),
      admin
        .from("property_lifecycle_still_active_confirmations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      admin
        .from("email_events")
        .select("id", { count: "exact", head: true })
        .eq("sent_by", userId),
    ]);

  return {
    identities: identities.count ?? 0,
    members: members.count ?? 0,
    delinks: delinks.count ?? 0,
    confirmations: confirmations.count ?? 0,
    emailEventsSent: emailEventsSent.count ?? 0,
  };
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = resolveServiceRoleKey(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log("=== GDPR Erasure Impact Report Verification (Development only) ===\n");

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Supabase URL, anon key, and service role key are required.");
  }

  assertDevelopmentEnvironment(url);
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rpcProbe = await admin.rpc("generate_erasure_impact_report", {
    p_user_id: randomUUID(),
  });

  if (rpcProbe.error?.message?.includes("Could not find the function")) {
    throw new Error(
      "Migration not applied: generate_erasure_impact_report missing. Apply 20260718100000_gdpr_erasure_impact_report.sql first."
    );
  }

  record("RPC exists on Development", !rpcProbe.error || rpcProbe.data?.ok === false);

  const unknown = await generateErasureImpactReport({
    supabase: admin,
    userId: randomUUID(),
  });
  record(
    "Unknown user returns user_not_found",
    unknown.ok === false && unknown.error === "user_not_found"
  );

  const stamp = Date.now();

  const sole = await signUpUser(stamp, "sole");
  const soleChainId = await createChain(sole.client, stamp, "S");
  const solePropertyId = await insertProperty({
    client: sole.client,
    chainId: soleChainId,
    chainPosition: 1,
    userId: sole.userId,
    stamp,
    label: "Sole",
  });
  await establishOperationalHomeowner(sole.client, {
    propertyId: solePropertyId,
    grantedVia: OPERATIONAL_IDENTITY_GRANT_VIA.startMove,
  });

  const beforeSole = await snapshotUserFootprint(admin, sole.userId);
  const soleReport = (await generateErasureImpactReport({
    supabase: admin,
    userId: sole.userId,
  })) as ErasureImpactReportSuccess;
  const afterSole = await snapshotUserFootprint(admin, sole.userId);

  record("Sole homeowner report ok", soleReport.ok === true);
  record(
    "Sole: operational identity counted",
    (soleReport.direct_personal_data.property_operational_identities_active ?? 0) >= 1
  );
  record(
    "Sole: sole participant candidate flagged",
    soleReport.property_relationships.some(
      (rel) =>
        rel.property_id === solePropertyId && rel.is_sole_participant_candidate
    )
  );
  record(
    "Sole: SOLE_PARTICIPANT_PROPERTY risk flag",
    soleReport.risk_flags.includes("SOLE_PARTICIPANT_PROPERTY")
  );
  record(
    "Sole: read-only guarantee",
    soleReport.read_only_guarantee?.mutations_performed === false
  );
  record(
    "Sole: no DB mutation from report",
    JSON.stringify(beforeSole) === JSON.stringify(afterSole)
  );

  const solePii = assertReportContainsNoRawPii(JSON.stringify(soleReport));
  record("Sole: report JSON contains no raw PII", solePii === null, solePii ?? undefined);

  record(
    "Sole: ready_for_auto_execution is false",
    soleReport.execution_readiness.ready_for_auto_execution === false
  );
  record(
    "Sole: requires_manual_review is true",
    soleReport.execution_readiness.requires_manual_review === true
  );

  const soleReportRepeat = await generateErasureImpactReport({
    supabase: admin,
    userId: sole.userId,
  });
  record(
    "Repeated execution: deterministic property relationship count",
    (soleReportRepeat as ErasureImpactReportSuccess).property_relationships
      .length === soleReport.property_relationships.length
  );

  const seller = await signUpUser(stamp + 1, "seller");
  const buyer = await signUpUser(stamp + 2, "buyer");
  const sharedChainId = await createChain(seller.client, stamp, "SH");
  const salePropertyId = await insertProperty({
    client: seller.client,
    chainId: sharedChainId,
    chainPosition: 1,
    userId: seller.userId,
    stamp,
    label: "Shared Sale",
  });
  await establishOperationalHomeowner(seller.client, {
    propertyId: salePropertyId,
    grantedVia: OPERATIONAL_IDENTITY_GRANT_VIA.startMove,
  });

  await seller.client
    .from("properties")
    .update({ seller_connected: true, buyer_connected: true })
    .eq("id", salePropertyId);

  const purchasePropertyId = await insertProperty({
    client: buyer.client,
    chainId: sharedChainId,
    chainPosition: 2,
    userId: buyer.userId,
    stamp,
    label: "Shared Purchase",
  });
  await establishOperationalHomeowner(buyer.client, {
    propertyId: purchasePropertyId,
    grantedVia: OPERATIONAL_IDENTITY_GRANT_VIA.startMove,
  });

  const sharedReport = (await generateErasureImpactReport({
    supabase: admin,
    userId: seller.userId,
  })) as ErasureImpactReportSuccess;

  record(
    "Shared chain: ACTIVE_SHARED_TRANSACTION flag",
    sharedReport.risk_flags.includes("ACTIVE_SHARED_TRANSACTION")
  );
  record(
    "Shared chain: CONNECTED_CHAIN_DEPENDENCY flag",
    sharedReport.risk_flags.includes("CONNECTED_CHAIN_DEPENDENCY")
  );
  record(
    "Shared chain: address retain review required",
    sharedReport.property_relationships.some(
      (rel) =>
        rel.address_treatment === "retain_shared_operationally_review_required"
    )
  );
  record(
    "Shared chain: ready_for_auto_execution false",
    sharedReport.execution_readiness.ready_for_auto_execution === false
  );

  await admin.rpc("create_email_event", {
    p_template: "lifecycle-dormancy-warning",
    p_recipient_email: sole.email,
    p_sent_by: null,
    p_property_id: solePropertyId,
    p_chain_id: soleChainId,
    p_invitation_id: null,
  });

  const commsReport = (await generateErasureImpactReport({
    supabase: admin,
    userId: sole.userId,
  })) as ErasureImpactReportSuccess;

  record(
    "Email-correlated: recipient count > 0",
    (commsReport.email_correlated_records.email_events_recipient_email as number) > 0
  );
  record(
    "Communications: RESEND flag implied via external_processor_actions",
    commsReport.external_processor_actions.RESEND_ERASURE_REVIEW_REQUIRED === true
  );
  record(
    "Communications: proposed REDACT_EMAIL_REFERENCE action present",
    commsReport.proposed_actions.some(
      (action) => action.category === "REDACT_EMAIL_REFERENCE"
    )
  );

  const commsPii = assertReportContainsNoRawPii(JSON.stringify(commsReport));
  record(
    "Email fixture: report still contains no raw PII",
    commsPii === null,
    commsPii ?? undefined
  );

  record(
    "Proposed actions include DELETE_AUTH_IDENTITY_LAST",
    commsReport.proposed_actions.some(
      (action) => action.category === "DELETE_AUTH_IDENTITY_LAST"
    )
  );

  record(
    "Analytics section present with pseudonymous classification",
    commsReport.analytics.anonymity_classification === "pseudonymous"
  );

  console.log(`\nResults: ${results.filter((r) => r.pass).length}/${results.length} passed`);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) process.exit(1);

  console.log("\n=== GDPR ERASURE IMPACT REPORT VERIFICATION PASSED ===");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
