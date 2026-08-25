/**
 * Development-only helper: put a property into dormancy_warning for manual UI testing.
 *
 * Does NOT send dormancy-warning emails.
 * Refuses to run against non-Development Supabase projects.
 *
 * Usage:
 *   npx tsx scripts/set-test-property-dormancy-warning.ts <propertyId>
 *   npx tsx scripts/set-test-property-dormancy-warning.ts <propertyId> --confirm
 */
import { randomUUID } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

import { buildDormancyWarningPropertyUrl } from "../lib/communications/dormancyWarningLinks";
import { PROPERTY_LIFECYCLE_ACTION } from "../lib/lifecycle/types";

/** Authoritative Development Supabase project ref (see docs/PRODUCTION_READINESS_CHECKLIST.md). */
const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";

const BLOCKED_OPERATIONAL_STATES = new Set([
  "released",
  "anonymised",
  "archived",
  "dormant",
]);

const PLACEHOLDER_SERVICE_ROLE_KEYS = new Set([
  "your-service-role-key",
  "your_service_role_key",
  "your-service_role_key",
]);

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

function extractSupabaseProjectRef(supabaseUrl: string): string | null {
  try {
    const hostname = new URL(supabaseUrl).hostname;
    const match = hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function assertDevelopmentEnvironment(supabaseUrl: string): void {
  const projectRef = extractSupabaseProjectRef(supabaseUrl);

  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(
      `Refusing to run: Supabase project "${projectRef ?? "unknown"}" is not Development (` +
        `${DEVELOPMENT_SUPABASE_PROJECT_REF}).`
    );
  }

  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to run: VERCEL_ENV=production.");
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "";

  if (
    appUrl &&
    /:\/\/(www\.)?keynetic\.(co\.uk|com)(\/|$)/i.test(appUrl) &&
    !/staging|preview|localhost|127\.0\.0\.1|dev\./i.test(appUrl)
  ) {
    throw new Error(
      "Refusing to run: APP_URL appears to be production Keynetic."
    );
  }
}

function parsePropertyId(raw: string | undefined): number {
  if (!raw || raw.startsWith("--")) {
    throw new Error("Property ID is required.\n\nUsage: npx tsx scripts/set-test-property-dormancy-warning.ts <propertyId> [--confirm]");
  }

  const propertyId = Number(raw);

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    throw new Error(`Invalid property ID: ${raw}`);
  }

  return propertyId;
}

type LifecycleSnapshot = {
  operational_state: string;
  dormancy_warning_at: string | null;
  dormancy_confirmation_deadline_at: string | null;
  dormancy_warning_notified_at: string | null;
  dormancy_warning_notification_claimed_at: string | null;
};

async function loadLifecycleSnapshot(
  admin: SupabaseClient,
  propertyId: number
): Promise<LifecycleSnapshot> {
  const { data, error } = await admin
    .from("property_lifecycle_states")
    .select(
      "operational_state, dormancy_warning_at, dormancy_confirmation_deadline_at, dormancy_warning_notified_at, dormancy_warning_notification_claimed_at"
    )
    .eq("property_id", propertyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load lifecycle state: ${error.message}`);
  }

  return {
    operational_state: data?.operational_state ?? "active",
    dormancy_warning_at: data?.dormancy_warning_at ?? null,
    dormancy_confirmation_deadline_at:
      data?.dormancy_confirmation_deadline_at ?? null,
    dormancy_warning_notified_at: data?.dormancy_warning_notified_at ?? null,
    dormancy_warning_notification_claimed_at:
      data?.dormancy_warning_notification_claimed_at ?? null,
  };
}

function printLifecycleSnapshot(label: string, snapshot: LifecycleSnapshot) {
  console.log(`${label}:`);
  console.log(`  operational_state: ${snapshot.operational_state}`);
  console.log(
    `  dormancy_warning_at: ${snapshot.dormancy_warning_at ?? "(null)"}`
  );
  console.log(
    `  dormancy_confirmation_deadline_at: ${snapshot.dormancy_confirmation_deadline_at ?? "(null)"}`
  );
  console.log(
    `  dormancy_warning_notified_at: ${snapshot.dormancy_warning_notified_at ?? "(null)"}`
  );
  console.log(
    `  dormancy_warning_notification_claimed_at: ${snapshot.dormancy_warning_notification_claimed_at ?? "(null)"}`
  );
}

async function runPreflight(admin: SupabaseClient, propertyId: number) {
  const { data: property, error: propertyError } = await admin
    .from("properties")
    .select("id, chain_id, relationship_type")
    .eq("id", propertyId)
    .maybeSingle();

  if (propertyError) {
    throw new Error(`Property lookup failed: ${propertyError.message}`);
  }

  if (!property) {
    throw new Error(`Property ${propertyId} was not found.`);
  }

  const { data: identity, error: identityError } = await admin
    .from("property_operational_identities")
    .select("property_id, status, operational_role")
    .eq("property_id", propertyId)
    .eq("status", "active")
    .maybeSingle();

  if (identityError) {
    throw new Error(
      `Operational identity lookup failed: ${identityError.message}`
    );
  }

  if (!identity) {
    throw new Error(
      `Property ${propertyId} has no active operational homeowner identity.`
    );
  }

  const lifecycle = await loadLifecycleSnapshot(admin, propertyId);

  if (BLOCKED_OPERATIONAL_STATES.has(lifecycle.operational_state)) {
    throw new Error(
      `Property ${propertyId} is ${lifecycle.operational_state}; cannot enter dormancy_warning for UI testing.`
    );
  }

  if (
    lifecycle.operational_state !== "active" &&
    lifecycle.operational_state !== "dormancy_warning" &&
    lifecycle.operational_state !== "completed_grace"
  ) {
    throw new Error(
      `Property ${propertyId} is ${lifecycle.operational_state}; must be active (or already dormancy_warning) to proceed.`
    );
  }

  if (lifecycle.operational_state === "completed_grace") {
    throw new Error(
      `Property ${propertyId} is completed_grace. Reset to active before dormancy UI testing.`
    );
  }

  return { property, identity, lifecycle };
}

async function simulateNotificationSentWithoutEmail(
  admin: SupabaseClient,
  propertyId: number
) {
  const { error } = await admin
    .from("property_lifecycle_states")
    .update({
      dormancy_warning_notified_at: new Date().toISOString(),
      dormancy_warning_notification_claimed_at: null,
    })
    .eq("property_id", propertyId)
    .eq("operational_state", "dormancy_warning");

  if (error) {
    throw new Error(
      `Could not set simulated notification state: ${error.message}`
    );
  }
}

async function enterDormancyWarningViaWorkerAction(
  admin: SupabaseClient,
  propertyId: number
) {
  const { data, error } = await admin.rpc("execute_property_lifecycle_action", {
    p_property_id: propertyId,
    p_action: PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning,
    p_scenario: "connected_dormant",
    p_reason: "development_manual_dormancy_warning_ui_test",
    p_worker_run_id: randomUUID(),
    p_snapshot_payload: null,
  });

  if (error) {
    throw new Error(
      `execute_property_lifecycle_action failed: ${error.message}`
    );
  }

  const payload = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    skipped?: boolean;
    operational_state?: string;
    peers_updated?: number;
  };

  if (payload.ok === false) {
    throw new Error(payload.error ?? "execute_property_lifecycle_action failed");
  }

  if (payload.skipped) {
    throw new Error(
      "Lifecycle action was skipped unexpectedly. Check property state and try again."
    );
  }

  return payload;
}

async function main() {
  loadEnvLocal();

  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const propertyId = parsePropertyId(args.find((arg) => !arg.startsWith("--")));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = resolveServiceRoleKey(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local"
    );
  }

  assertDevelopmentEnvironment(url);

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("Development dormancy-warning UI test helper\n");
  console.log(`Target property ID: ${propertyId}`);
  console.log(`Supabase project: ${DEVELOPMENT_SUPABASE_PROJECT_REF}`);
  console.log(`Mode: ${confirm ? "MUTATE (--confirm)" : "DRY RUN"}\n`);

  const { property, identity, lifecycle: before } = await runPreflight(
    admin,
    propertyId
  );

  console.log(`Property exists: yes`);
  console.log(`Chain ID: ${property.chain_id ?? "(none)"}`);
  console.log(
    `Active operational homeowner: yes (role: ${identity.operational_role})`
  );
  printLifecycleSnapshot("Current lifecycle", before);

  if (!confirm) {
    console.log(
      "\nDry run only. Re-run with --confirm to enter dormancy_warning via execute_property_lifecycle_action."
    );
    console.log(
      "No emails will be sent. Notification state will be simulated after transition."
    );
    return;
  }

  if (before.operational_state === "dormancy_warning") {
    console.log(
      "\nProperty is already in dormancy_warning. Refreshing simulated notification state only."
    );
    await simulateNotificationSentWithoutEmail(admin, propertyId);
  } else {
    console.log(
      "\nApplying enter_dormancy_warning through execute_property_lifecycle_action..."
    );

    const actionResult = await enterDormancyWarningViaWorkerAction(
      admin,
      propertyId
    );

    if (typeof actionResult.peers_updated === "number") {
      console.log(
        `Chain peers also entered dormancy_warning: ${actionResult.peers_updated}`
      );
    }

    await simulateNotificationSentWithoutEmail(admin, propertyId);
  }

  const after = await loadLifecycleSnapshot(admin, propertyId);

  if (after.operational_state !== "dormancy_warning") {
    throw new Error(
      `Expected dormancy_warning after mutation, got ${after.operational_state}.`
    );
  }

  if (!after.dormancy_warning_at || !after.dormancy_confirmation_deadline_at) {
    throw new Error(
      "dormancy_warning_at or dormancy_confirmation_deadline_at was not populated."
    );
  }

  printLifecycleSnapshot("\nResulting lifecycle", after);

  console.log("\nManual UI test URL:");
  console.log(`  ${buildDormancyWarningPropertyUrl(propertyId)}`);
  console.log("\nSign in as the operational homeowner, then verify:");
  console.log("  - warning panel and deadline appear");
  console.log("  - confirmation modal succeeds and lifecycle returns to active");
  console.log("  - reopening this URL after confirmation shows no warning panel");
  console.log("\nNo dormancy-warning email was sent.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
