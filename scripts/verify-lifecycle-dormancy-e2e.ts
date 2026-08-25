/**
 * Development-only end-to-end verification:
 * stale connected transaction → worker → dormancy_warning → notification → confirm → active
 *
 * Requires migrations through 20260714202000_harden_confirm_still_active_authority.sql
 * and Development Supabase (.env.local with service role + anon key).
 *
 * Usage:
 *   npx tsx scripts/verify-lifecycle-dormancy-e2e.ts
 */
import { randomUUID } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

import { buildDormancyWarningPropertyUrl } from "../lib/communications/dormancyWarningLinks";
import type { SendEmailResult } from "../lib/communications/types";
import { getLifecycleConfig } from "../lib/lifecycle/config";
import { confirmTransactionStillActive } from "../lib/lifecycle/confirmStillActive";
import { processDormancyWarningNotifications } from "../lib/lifecycle/dormancyWarningNotifications";
import { applyLifecyclePlan } from "../lib/lifecycle/worker";
import { PropertyLifecycleService } from "../lib/lifecycle/service";
import {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_OPERATIONAL_STATE,
} from "../lib/lifecycle/types";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const DAY_MS = 86_400_000;

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
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to run: VERCEL_ENV=production.");
  }
}

loadEnvLocal();
process.env.EMAIL_SENDING_ENABLED = "false";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = resolveServiceRoleKey(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const password = "LifecycleE2E123!";

function serviceClient() {
  return createClient(url!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signUpHomeowner(stamp: number) {
  const email = `lifecycle-e2e-${stamp}@keynetic-test.dev`;
  const boot = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await boot.auth.signUp({ email, password });
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const userId = (await client.auth.getUser()).data.user!.id;
  await client.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "Lifecycle E2E",
    onboarding_completed_at: new Date().toISOString(),
  });
  return { client, userId };
}

async function createChain(client: SupabaseClient, stamp: number) {
  const { data, error } = await client.rpc("create_chain_for_onboarding", {
    p_name: `Lifecycle E2E ${stamp}`,
    p_access_code: `LE2E${stamp}`,
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
      address: `${params.stamp} ${params.label}`,
      postcode: "E1 1E2",
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

async function simulateConnectedInactivity(params: {
  admin: SupabaseClient;
  chainId: number;
  propertyIds: number[];
  inactiveDays: number;
}) {
  const staleAt = new Date(
    Date.now() - params.inactiveDays * DAY_MS
  ).toISOString();

  await params.admin
    .from("chains")
    .update({ last_operational_activity_at: staleAt })
    .eq("id", params.chainId);

  await params.admin
    .from("properties")
    .update({ last_operational_activity_at: staleAt })
    .in("id", params.propertyIds);
}

type LifecycleRow = {
  operational_state: string;
  dormancy_warning_at: string | null;
  dormancy_confirmation_deadline_at: string | null;
  dormancy_warning_notified_at: string | null;
  dormancy_warning_notification_claimed_at: string | null;
  last_still_active_confirmed_at: string | null;
};

async function loadLifecycleRow(
  admin: SupabaseClient,
  propertyId: number
): Promise<LifecycleRow> {
  const { data } = await admin
    .from("property_lifecycle_states")
    .select(
      "operational_state, dormancy_warning_at, dormancy_confirmation_deadline_at, dormancy_warning_notified_at, dormancy_warning_notification_claimed_at, last_still_active_confirmed_at"
    )
    .eq("property_id", propertyId)
    .maybeSingle();

  return {
    operational_state: data?.operational_state ?? "active",
    dormancy_warning_at: data?.dormancy_warning_at ?? null,
    dormancy_confirmation_deadline_at:
      data?.dormancy_confirmation_deadline_at ?? null,
    dormancy_warning_notified_at: data?.dormancy_warning_notified_at ?? null,
    dormancy_warning_notification_claimed_at:
      data?.dormancy_warning_notification_claimed_at ?? null,
    last_still_active_confirmed_at: data?.last_still_active_confirmed_at ?? null,
  };
}

function mockSendSuccess(): () => Promise<SendEmailResult> {
  return async () => ({
    ok: true,
    sent: true,
    provider: "mock-e2e",
    messageId: "mock-e2e-message",
    eventId: null,
  });
}

async function main() {
  console.log("=== Lifecycle dormancy E2E (Development only) ===\n");

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required."
    );
  }

  assertDevelopmentEnvironment(url);
  const admin = serviceClient();
  const config = getLifecycleConfig();
  const stamp = Date.now();
  const inactiveDays = config.connectedDormantDays + 10;

  console.log(`Development project: ${DEVELOPMENT_SUPABASE_PROJECT_REF}`);
  console.log(
    `Simulated inactivity: ${inactiveDays} days (threshold ${config.connectedDormantDays})\n`
  );

  const { client: homeownerClient, userId: homeownerId } =
    await signUpHomeowner(stamp);
  const chainId = await createChain(homeownerClient, stamp);

  const primaryPropertyId = await insertProperty({
    client: homeownerClient,
    chainId,
    chainPosition: 1,
    userId: homeownerId,
    stamp,
    label: "E2E Primary",
  });

  const peerPropertyId = await insertProperty({
    client: homeownerClient,
    chainId,
    chainPosition: 2,
    userId: homeownerId,
    stamp,
    label: "E2E Peer",
  });

  const { data: grant, error: grantError } = await homeownerClient.rpc(
    "establish_operational_homeowner",
    { p_property_id: primaryPropertyId, p_granted_via: "start_move" }
  );
  record(
    "Fixture: operational homeowner established via RPC",
    !grantError && grant?.ok === true,
    grantError?.message ?? grant?.error
  );

  await simulateConnectedInactivity({
    admin,
    chainId,
    propertyIds: [primaryPropertyId, peerPropertyId],
    inactiveDays,
  });

  const service = new PropertyLifecycleService(admin);
  const contextBefore = await service.loadContext(primaryPropertyId);

  if (!contextBefore) {
    throw new Error("Could not load lifecycle context for test property.");
  }

  record(
    "Pre-worker: connected chain with stale operational activity",
    Boolean(
      contextBefore?.isChainConnected &&
        (contextBefore.daysSinceChainOperationalActivity ?? 0) >=
          config.connectedDormantDays
    ),
    JSON.stringify({
      isChainConnected: contextBefore?.isChainConnected,
      daysSinceChainOperationalActivity:
        contextBefore?.daysSinceChainOperationalActivity,
      hasMeaningfulParticipation: contextBefore?.hasMeaningfulParticipation,
    })
  );

  const evaluation = service.evaluateContext(contextBefore);
  record(
    "Evaluator plans enter_dormancy_warning via real worker path",
    evaluation.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning
    ),
    JSON.stringify(evaluation.plannedActions)
  );

  const lifecycleBeforeWorker = await loadLifecycleRow(admin, primaryPropertyId);
  record(
    "Pre-worker lifecycle state is active",
    lifecycleBeforeWorker.operational_state ===
      PROPERTY_OPERATIONAL_STATE.active
  );

  const workerRunId = randomUUID();
  const applyResult = await applyLifecyclePlan({
    supabase: admin,
    evaluation,
    workerRunId,
  });

  record(
    "Worker apply: active → dormancy_warning",
    applyResult.appliedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning
    ),
    JSON.stringify({
      applied: applyResult.appliedActions,
      errors: applyResult.errors,
    })
  );

  const lifecycleWarning = await loadLifecycleRow(admin, primaryPropertyId);
  record(
    "Transition: operational_state is dormancy_warning",
    lifecycleWarning.operational_state ===
      PROPERTY_OPERATIONAL_STATE.dormancyWarning
  );
  record(
    "Transition: dormancy_warning_at populated",
    Boolean(lifecycleWarning.dormancy_warning_at)
  );
  record(
    "Transition: dormancy_confirmation_deadline_at populated",
    Boolean(lifecycleWarning.dormancy_confirmation_deadline_at)
  );
  record(
    "Transition: notification not yet marked before delivery",
    lifecycleWarning.dormancy_warning_notified_at === null
  );

  const { data: warningEvent } = await admin
    .from("property_lifecycle_events")
    .select("from_state, to_state, trigger, scenario")
    .eq("property_id", primaryPropertyId)
    .eq("to_state", "dormancy_warning")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  record(
    "Audit: lifecycle event recorded for dormancy_warning",
    warningEvent?.from_state === "active" &&
      warningEvent?.to_state === "dormancy_warning" &&
      warningEvent?.trigger === "worker"
  );

  const { data: recipientBeforeSend } = await admin.rpc(
    "get_dormancy_warning_email_recipient",
    { p_property_id: primaryPropertyId }
  );
  const recipientRow = (
    (recipientBeforeSend ?? []) as Array<{ homeowner_user_id?: string }>
  )[0];

  record(
    "Recipient: active operational homeowner resolved (no PII printed)",
    recipientRow?.homeowner_user_id === homeownerId
  );

  let notificationSendCount = 0;
  const firstNotification = await processDormancyWarningNotifications({
    supabase: admin,
    sourcePropertyId: primaryPropertyId,
    workerRunId: randomUUID(),
    sendEmail: async () => {
      notificationSendCount += 1;
      return mockSendSuccess()();
    },
  });

  const lifecycleAfterNotify = await loadLifecycleRow(admin, primaryPropertyId);
  record(
    "Notification: mocked delivery processed once",
    notificationSendCount === 1 &&
      firstNotification.some((entry) => entry.sent)
  );
  record(
    "Notification: dormancy_warning_notified_at set after successful mock send",
    Boolean(lifecycleAfterNotify.dormancy_warning_notified_at)
  );
  record(
    "Notification: claim cleared after successful send",
    lifecycleAfterNotify.dormancy_warning_notification_claimed_at === null
  );

  const secondNotification = await processDormancyWarningNotifications({
    supabase: admin,
    sourcePropertyId: primaryPropertyId,
    workerRunId: randomUUID(),
    sendEmail: async () => {
      notificationSendCount += 1;
      return mockSendSuccess()();
    },
  });

  record(
    "Notification: repeat processing does not duplicate send",
    notificationSendCount === 1 &&
      secondNotification.every((entry) => !entry.sent && entry.skipped)
  );

  const ctaUrl = buildDormancyWarningPropertyUrl(primaryPropertyId);
  const parsedCta = new URL(ctaUrl);

  record(
    "CTA destination matches expected dormancy-warning route",
    parsedCta.pathname === `/property/${primaryPropertyId}` &&
      parsedCta.searchParams.get("lifecycle") === "dormancy-warning"
  );

  const { data: propertyActivityBeforeConfirm } = await admin
    .from("properties")
    .select("last_operational_activity_at")
    .eq("id", primaryPropertyId)
    .single();

  const confirmResult = await confirmTransactionStillActive({
    supabase: homeownerClient,
    propertyId: primaryPropertyId,
  });

  record(
    "Confirmation: authenticated homeowner returns lifecycle to active",
    confirmResult.ok &&
      confirmResult.operationalState === PROPERTY_OPERATIONAL_STATE.active
  );

  const lifecycleAfterConfirm = await loadLifecycleRow(admin, primaryPropertyId);
  record(
    "Confirmation: dormancy timestamps cleared",
    lifecycleAfterConfirm.dormancy_warning_at === null &&
      lifecycleAfterConfirm.dormancy_confirmation_deadline_at === null
  );
  record(
    "Confirmation: notification cycle reset for future warning",
    lifecycleAfterConfirm.dormancy_warning_notified_at === null &&
      lifecycleAfterConfirm.dormancy_warning_notification_claimed_at === null
  );
  record(
    "Confirmation: last_still_active_confirmed_at recorded",
    Boolean(lifecycleAfterConfirm.last_still_active_confirmed_at)
  );

  const { data: propertyActivityAfterConfirm } = await admin
    .from("properties")
    .select("last_operational_activity_at")
    .eq("id", primaryPropertyId)
    .single();

  record(
    "Confirmation: last_operational_activity_at updated",
    Boolean(propertyActivityAfterConfirm?.last_operational_activity_at) &&
      propertyActivityAfterConfirm?.last_operational_activity_at !==
        propertyActivityBeforeConfirm?.last_operational_activity_at
  );

  const { count: confirmationCount } = await admin
    .from("property_lifecycle_still_active_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("property_id", primaryPropertyId)
    .eq("user_id", homeownerId);

  const { data: confirmationRows } = await admin
    .from("property_lifecycle_still_active_confirmations")
    .select("confirmation_code")
    .eq("property_id", primaryPropertyId)
    .eq("user_id", homeownerId)
    .limit(1);

  record(
    "Confirmation: structured audit only (still_active, no free text)",
    confirmationCount === 1 &&
      confirmationRows?.[0]?.confirmation_code === "still_active"
  );

  const repeatConfirm = await confirmTransactionStillActive({
    supabase: homeownerClient,
    propertyId: primaryPropertyId,
  });

  const { count: confirmationCountAfterRepeat } = await admin
    .from("property_lifecycle_still_active_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("property_id", primaryPropertyId);

  record(
    "Confirmation idempotency: second call safe, no duplicate audit row",
    repeatConfirm.ok &&
      repeatConfirm.idempotent === true &&
      confirmationCountAfterRepeat === 1
  );

  const immediateContext = await service.loadContext(primaryPropertyId);
  const immediateEvaluation = service.evaluateContext(immediateContext!);
  record(
    "Immediate re-evaluation: does not re-enter dormancy_warning",
    !immediateEvaluation.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning
    ),
    JSON.stringify(immediateEvaluation.plannedActions)
  );

  const immediateApply = await applyLifecyclePlan({
    supabase: admin,
    evaluation: immediateEvaluation,
    workerRunId: randomUUID(),
  });

  record(
    "Immediate worker re-run: no dormancy_warning action applied",
    !immediateApply.appliedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning
    ),
    JSON.stringify({
      applied: immediateApply.appliedActions,
      errors: immediateApply.errors,
    })
  );

  await simulateConnectedInactivity({
    admin,
    chainId,
    propertyIds: [primaryPropertyId, peerPropertyId],
    inactiveDays,
  });

  const futureContext = await service.loadContext(primaryPropertyId);
  const futureEvaluation = service.evaluateContext(futureContext!);
  record(
    "Future cycle: evaluator plans dormancy_warning after renewed inactivity",
    futureEvaluation.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning
    )
  );

  const futureApply = await applyLifecyclePlan({
    supabase: admin,
    evaluation: futureEvaluation,
    workerRunId: randomUUID(),
  });

  record(
    "Future cycle: worker can enter dormancy_warning again",
    futureApply.appliedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning
    )
  );

  console.log(`\nTest fixture property ID: ${primaryPropertyId}`);
  console.log(`Chain ID: ${chainId}`);
  console.log("No real Resend emails were sent.\n");

  summarize();
}

function summarize() {
  const failed = results.filter((result) => !result.pass);
  console.log(`Results: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
  console.log("\n=== LIFECYCLE DORMANCY E2E VERIFICATION PASSED ===");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
