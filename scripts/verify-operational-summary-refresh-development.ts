/**
 * Development-only verification for operational-summary refresh remediation.
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-operational-summary-refresh-development.ts
 *   npx tsx scripts/verify-operational-summary-refresh-development.ts --execute
 *
 * Default: read-only column/view probes + structured failure shape.
 * --execute: isolated fixture stage update + summary refresh + cleanup.
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadOperationalRefreshDataset } from "../lib/operationalSummary/loadOperationalRefreshDataset";
import { refreshOperationalSummary } from "../lib/operationalSummary/refreshOperationalSummary";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const TEST_EMAIL_PREFIX = "ops-refresh-dev";
const TEST_DOMAIN_SUFFIX = ".ops-refresh.test";
const PASSWORD = "OpsRefreshDev123!";

type TestResult = { name: string; pass: boolean; detail?: string };

const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function formatPostgrestError(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null): string {
  if (!error) {
    return "no error";
  }

  return [
    error.code ? `code=${error.code}` : null,
    error.message ? `message=${error.message}` : null,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null,
  ]
    .filter(Boolean)
    .join("; ");
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

function assertDevelopmentEnvironment(supabaseUrl: string): void {
  const match = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const projectRef = match?.[1] ?? null;
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(
      `Refusing to run: Supabase project "${projectRef ?? "unknown"}" is not Development (${DEVELOPMENT_SUPABASE_PROJECT_REF}).`
    );
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = resolveServiceRoleKey(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

if (!url || !anonKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

assertDevelopmentEnvironment(url);

function anonClient(): SupabaseClient {
  return createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function serviceClient(): SupabaseClient | null {
  if (!serviceRoleKey) return null;
  return createClient(url!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Sign in failed: ${error.message}`);
  }
  return client;
}

async function verifyViewColumnProbe(): Promise<void> {
  const anon = anonClient();
  const { error: anonError } = await anon
    .from("chain_properties_participant")
    .select("id")
    .limit(1);

  record(
    "Anon cannot read chain_properties_participant",
    !!anonError &&
      (anonError.code === "42501" ||
        anonError.message.includes("permission denied")),
    anonError?.code ?? "no error"
  );

  const service = serviceClient();
  if (!service) {
    record(
      "PostgREST accepts stage_entered_at column on participant view",
      false,
      "SUPABASE_SERVICE_ROLE_KEY required"
    );
    return;
  }

  const { error: columnError } = await service
    .from("chain_properties_participant")
    .select("id, stage_entered_at")
    .limit(0);

  record(
    "PostgREST accepts stage_entered_at column on participant view",
    !columnError || columnError.code !== "42703",
    columnError?.code ?? "accepted"
  );
}

async function verifyStructuredFailureShape(): Promise<void> {
  const anon = anonClient();
  const loadResult = await loadOperationalRefreshDataset(anon, 999_999_999);

  record(
    "Structured dataset load failure (no throw)",
    !loadResult.ok,
    loadResult.ok ? "unexpected success" : loadResult.step
  );

  if (!loadResult.ok) {
    record(
      "Structured failure includes step/code/message",
      Boolean(loadResult.step && loadResult.message),
      `${loadResult.step}:${loadResult.code ?? "null"}`
    );
  }

  const refreshResult = await refreshOperationalSummary(anon, {
    chainId: 999_999_999,
  });

  record(
    "Structured refresh failure (no throw)",
    !refreshResult.ok,
    refreshResult.ok ? "unexpected success" : refreshResult.step ?? "unknown"
  );
}

async function verifyExecuteFlow(): Promise<void> {
  const service = serviceClient();
  if (!service) {
    record("--execute fixture flow", false, "SUPABASE_SERVICE_ROLE_KEY required");
    return;
  }

  const stamp = randomUUID().slice(0, 8);
  const ownerEmail = `${TEST_EMAIL_PREFIX}-owner-${stamp}@${stamp}${TEST_DOMAIN_SUFFIX}`;
  const strangerEmail = `${TEST_EMAIL_PREFIX}-stranger-${stamp}@${stamp}${TEST_DOMAIN_SUFFIX}`;
  const chainName = `operational-summary-refresh-verification-${stamp}`;

  let ownerUserId: string | undefined;
  let strangerUserId: string | undefined;
  let chainId: number | undefined;
  let propertyId: number | undefined;

  try {
    const { data: ownerAuth, error: ownerAuthError } =
      await service.auth.admin.createUser({
        email: ownerEmail,
        password: PASSWORD,
        email_confirm: true,
      });

    if (ownerAuthError || !ownerAuth.user) {
      record(
        "--execute fixture setup",
        false,
        ownerAuthError?.message ?? "owner create failed"
      );
      return;
    }

    ownerUserId = ownerAuth.user.id;

    const { data: strangerAuth, error: strangerAuthError } =
      await service.auth.admin.createUser({
        email: strangerEmail,
        password: PASSWORD,
        email_confirm: true,
      });

    if (strangerAuthError || !strangerAuth.user) {
      record(
        "--execute fixture setup",
        false,
        strangerAuthError?.message ?? "stranger create failed"
      );
      return;
    }

    strangerUserId = strangerAuth.user.id;

    const { data: chainRow, error: chainError } = await service
      .from("chains")
      .insert({
        name: chainName,
        access_code: `OPS-${stamp}`,
        state: "active",
        created_by_user_id: ownerUserId,
      })
      .select("id")
      .single();

    if (chainError || !chainRow) {
      record(
        "--execute fixture chain",
        false,
        chainError?.message ?? "chain insert failed"
      );
      return;
    }

    chainId = chainRow.id;

    const propertyAddress = `${stamp} Operational Summary Test Lane`;

    const { data: propertyRow, error: propertyError } = await service
      .from("properties")
      .insert({
        chain_id: chainId,
        chain_position: 1,
        address: propertyAddress,
        postcode: "OPS1",
        stage: "offer_accepted",
        status: "healthy",
        relationship_type: "sale",
        created_by_user_id: ownerUserId,
        stage_entered_at: new Date().toISOString(),
        buyer_connected: false,
        seller_connected: true,
        is_searching: false,
      })
      .select("id, stage")
      .single();

    if (propertyError || !propertyRow) {
      record(
        "--execute fixture property",
        false,
        propertyError?.message ?? "property insert failed"
      );
      return;
    }

    propertyId = propertyRow.id;

    const { error: memberError } = await service.from("property_members").insert({
      property_id: propertyId,
      user_id: ownerUserId,
      role: "seller",
    });

    if (memberError) {
      record(
        "--execute fixture membership",
        false,
        memberError.message
      );
      return;
    }

    const ownerClient = await signIn(ownerEmail, PASSWORD);

    const { data: participantRows, error: participantError } =
      await ownerClient
        .from("chain_properties_participant")
        .select("id, stage, stage_entered_at, address")
        .eq("chain_id", chainId);

    record(
      "Legitimate participant reads chain_properties_participant with stage_entered_at",
      !participantError &&
        (participantRows?.length ?? 0) === 1 &&
        participantRows?.[0]?.stage_entered_at != null,
      participantError?.code ?? `rows=${participantRows?.length ?? 0}`
    );

    const loadResult = await loadOperationalRefreshDataset(
      ownerClient,
      chainId
    );

    record(
      "loadOperationalRefreshDataset succeeds for authorised chain",
      loadResult.ok,
      loadResult.ok ? undefined : `${loadResult.step}:${loadResult.code}`
    );

    if (loadResult.ok) {
      record(
        "Dataset includes stageEnteredAt for Chain Intelligence",
        loadResult.dataset.properties.some(
          (property) => property.stageEnteredAt != null
        ),
        "stageEnteredAt present"
      );
    }

    const strangerClient = await signIn(strangerEmail, PASSWORD);
    const { data: strangerRows, error: strangerError } =
      await strangerClient
        .from("chain_properties_participant")
        .select("id, stage_entered_at")
        .eq("chain_id", chainId);

    record(
      "Authenticated stranger cannot read unrelated participant view rows",
      !strangerError && (strangerRows?.length ?? 0) === 0,
      strangerError?.code ?? `rows=${strangerRows?.length ?? 0}`
    );

    const newStage = "contracts_exchanged";
    const stageEnteredAt = new Date().toISOString();
    const { error: updateError } = await ownerClient
      .from("properties")
      .update({ stage: newStage, stage_entered_at: stageEnteredAt })
      .eq("id", propertyId);

    record(
      "Stage mutation succeeds for operational owner",
      !updateError,
      updateError ? formatPostgrestError(updateError) : undefined
    );

    const refreshResult = await refreshOperationalSummary(ownerClient, {
      chainId,
    });

    record(
      "Operational-summary refresh succeeds after stage update",
      refreshResult.ok,
      refreshResult.ok
        ? undefined
        : `${refreshResult.step}:${refreshResult.errorCode}:${refreshResult.error}`
    );

    const { data: chainSummary, error: chainSummaryError } =
      await ownerClient
        .from("chain_operational_summary")
        .select("chain_id, summary_version, computed_at")
        .eq("chain_id", chainId)
        .maybeSingle();

    record(
      "chain_operational_summary row upserted",
      !chainSummaryError && chainSummary != null,
      chainSummaryError
        ? formatPostgrestError(chainSummaryError)
        : chainSummary
          ? "present"
          : "missing"
    );

    record(
      "chain_operational_summary computed_at populated",
      !chainSummaryError &&
        chainSummary != null &&
        chainSummary.computed_at != null,
      chainSummaryError
        ? formatPostgrestError(chainSummaryError)
        : chainSummary?.computed_at ?? "null"
    );

    const { data: propertySummary, error: propertySummaryError } =
      await ownerClient
        .from("property_operational_summary")
        .select("property_id, chain_id, computed_at, current_stage")
        .eq("property_id", propertyId)
        .maybeSingle();

    record(
      "property_operational_summary row upserted",
      !propertySummaryError && propertySummary != null,
      propertySummaryError
        ? formatPostgrestError(propertySummaryError)
        : propertySummary
          ? "present"
          : "missing"
    );

    record(
      "property_operational_summary computed_at populated",
      !propertySummaryError &&
        propertySummary != null &&
        propertySummary.computed_at != null,
      propertySummaryError
        ? formatPostgrestError(propertySummaryError)
        : propertySummary?.computed_at ?? "null"
    );

    record(
      "property_operational_summary current_stage reflects stage mutation",
      !propertySummaryError &&
        propertySummary?.current_stage === newStage,
      propertySummaryError
        ? formatPostgrestError(propertySummaryError)
        : `expected=${newStage}; actual=${propertySummary?.current_stage ?? "null"}`
    );

    const invisibleChainResult = await refreshOperationalSummary(
      strangerClient,
      { chainId }
    );

    record(
      "Secondary refresh failure is structured (stranger on foreign chain)",
      !invisibleChainResult.ok &&
        Boolean(invisibleChainResult.step) &&
        Boolean(invisibleChainResult.error),
      invisibleChainResult.ok
        ? "unexpected success"
        : `${invisibleChainResult.step}:${invisibleChainResult.errorCode}`
    );
  } finally {
    if (propertyId != null) {
      await service.from("property_operational_summary").delete().eq("property_id", propertyId);
      await service.from("activities").delete().eq("property_id", propertyId);
      await service.from("property_members").delete().eq("property_id", propertyId);
      await service.from("properties").delete().eq("id", propertyId);
    }

    if (chainId != null) {
      await service.from("chain_operational_summary").delete().eq("chain_id", chainId);
      await service.from("chains").delete().eq("id", chainId);
    }

    if (ownerUserId) {
      await service.auth.admin.deleteUser(ownerUserId);
    }

    if (strangerUserId) {
      await service.auth.admin.deleteUser(strangerUserId);
    }

    if (ownerUserId || strangerUserId || chainId != null || propertyId != null) {
      record("Fixture cleanup", true);
    }
  }
}

async function main() {
  const execute = process.argv.includes("--execute");

  console.log("=== Operational Summary Refresh Verification (Development) ===\n");
  console.log(`Project ref: ${DEVELOPMENT_SUPABASE_PROJECT_REF}`);
  console.log(`Mode: ${execute ? "--execute" : "read-only"}\n`);

  await verifyViewColumnProbe();
  await verifyStructuredFailureShape();

  if (execute) {
    await verifyExecuteFlow();
  } else {
    record("--execute stage/refresh flow", true, "skipped (pass --execute)");
  }

  const passed = results.filter((result) => result.pass).length;
  const total = results.length;

  console.log(`\nResults: ${passed}/${total} passed`);

  if (passed !== total) {
    process.exit(1);
  }

  console.log("\n=== OPERATIONAL SUMMARY REFRESH VERIFICATION PASSED ===");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
