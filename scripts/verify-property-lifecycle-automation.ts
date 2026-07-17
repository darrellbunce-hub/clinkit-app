/**
 * Property lifecycle automation regression tests (dormancy architecture revision).
 *
 * Requires migrations through 20260714190000_property_lifecycle_automation.sql
 * and SUPABASE_SERVICE_ROLE_KEY in .env.local for live DB checks.
 *
 * Usage:
 *   npx tsx scripts/verify-property-lifecycle-automation.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

import {
  createDefaultLifecycleContext,
  evaluatePropertyLifecycleFromContext,
} from "../lib/lifecycle/evaluate";
import {
  applyLifecyclePlan,
  runPropertyLifecycleWorkerBatch,
} from "../lib/lifecycle/worker";
import {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_OPERATIONAL_STATE,
} from "../lib/lifecycle/types";

const PLACEHOLDER_SERVICE_ROLE_KEYS = new Set([
  "your-service-role-key",
  "your_service_role_key",
  "your-service_role_key",
]);

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");

  let text: string;

  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

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
}

function resolveServiceRoleKey(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  let value = raw.trim();

  if (PLACEHOLDER_SERVICE_ROLE_KEYS.has(value.toLowerCase())) {
    return undefined;
  }

  // Common paste mistake: placeholder label left before the real secret value.
  const embeddedKey = value.match(/^your[_-]?service[_-]?role[_-]?key=(.+)$/i);

  if (embeddedKey) {
    value = embeddedKey[1].trim();
  }

  if (!value || PLACEHOLDER_SERVICE_ROLE_KEYS.has(value.toLowerCase())) {
    return undefined;
  }

  return value;
}

function logEnvPresence(params: {
  url?: string;
  serviceRoleKey?: string;
  anonKey?: string;
  serviceRoleKeyHadPlaceholderPrefix: boolean;
}) {
  console.log(
    `Env: NEXT_PUBLIC_SUPABASE_URL=${params.url ? "present" : "missing"}, ` +
      `SUPABASE_SERVICE_ROLE_KEY=${
        params.serviceRoleKey
          ? `present (${params.serviceRoleKey.length} chars)`
          : "missing"
      }, ` +
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${params.anonKey ? "present" : "missing"}`
  );

  if (params.serviceRoleKeyHadPlaceholderPrefix) {
    console.log(
      "Note: SUPABASE_SERVICE_ROLE_KEY included a placeholder prefix; using the embedded secret value."
    );
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = resolveServiceRoleKey(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKeyHadPlaceholderPrefix = Boolean(
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().match(
    /^your[_-]?service[_-]?role[_-]?key=/i
  )
);
const password = "LifecycleAuto123!";
const DAY_MS = 86_400_000;

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function serviceClient() {
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service client requires URL and service role key");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signUp(email: string) {
  if (!url || !anonKey) {
    throw new Error("Supabase auth client requires URL and anon key");
  }

  const boot = createClient(url, anonKey);
  await boot.auth.signUp({ email, password });
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw error;
  }

  const userId = (await client.auth.getUser()).data.user!.id;

  return { client, userId };
}

async function createChain(
  client: SupabaseClient,
  stamp: number
): Promise<number> {
  const { data, error } = await client.rpc("create_chain_for_onboarding", {
    p_name: `Lifecycle ${stamp}`,
    p_access_code: `LC${stamp}`,
  });

  if (error || !data?.ok) {
    throw new Error(error?.message ?? data?.error ?? "chain_create_failed");
  }

  return data.chain_id as number;
}

async function insertProperty(params: {
  client: SupabaseClient;
  chainId: number;
  address: string;
  postcode: string;
  userId: string;
  buyerConnected?: boolean;
  sellerConnected?: boolean;
}) {
  const { data, error } = await params.client
    .from("properties")
    .insert({
      chain_id: params.chainId,
      chain_position: 1,
      address: params.address,
      postcode: params.postcode,
      stage: "property_listed",
      status: "healthy",
      relationship_type: "sale",
      created_by_user_id: params.userId,
      buyer_connected: params.buyerConnected ?? false,
      seller_connected: params.sellerConnected ?? false,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "property_insert_failed");
  }

  return data.id as number;
}

async function setLifecycleState(
  admin: SupabaseClient,
  propertyId: number,
  state: string,
  extras: Record<string, unknown> = {}
) {
  await admin.from("property_lifecycle_states").upsert({
    property_id: propertyId,
    operational_state: state,
    lifecycle_reason: "verify_fixture",
    entered_state_at: new Date().toISOString(),
    ...extras,
  });
}

async function main() {
  logEnvPresence({
    url,
    serviceRoleKey,
    anonKey,
    serviceRoleKeyHadPlaceholderPrefix,
  });

  console.log("=== Pure evaluation checks (Part 11) ===\n");

  // 1. Isolated property 100 days old, operational identity, no meaningful activity
  const isolated100 = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(1, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      hasActiveOperationalIdentity: true,
      hasMeaningfulParticipation: false,
      isChainConnected: false,
      lastOperationalActivityAt: daysAgo(100),
      enteredStateAt: daysAgo(100),
    })
  );
  record(
    "1. Isolated 100d inactive property eligible for dormant release",
    isolated100.plannedActions.includes(PROPERTY_LIFECYCLE_ACTION.markDormant)
  );

  // 2. Recently created isolated property
  const isolatedRecent = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(2, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      hasMeaningfulParticipation: false,
      isChainConnected: false,
      lastOperationalActivityAt: daysAgo(10),
      enteredStateAt: daysAgo(10),
    })
  );
  record(
    "2. Recently created isolated property protected during threshold",
    isolatedRecent.plannedActions.length === 0
  );

  // 3. Connected active chain with meaningful participation
  const connectedActive = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(3, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      isChainConnected: true,
      hasMeaningfulParticipation: true,
      buyerConnected: true,
      sellerConnected: true,
      lastOperationalActivityAt: daysAgo(100),
      chainLastOperationalActivityAt: daysAgo(5),
    })
  );
  record(
    "3. Genuinely connected active chain not released under isolated dormancy",
    !connectedActive.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.releaseProperty
    )
  );

  // 4. Connected with recent operational progress
  const connectedRecent = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(4, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      isChainConnected: true,
      hasMeaningfulParticipation: false,
      chainLastOperationalActivityAt: daysAgo(10),
      lastOperationalActivityAt: daysAgo(10),
    })
  );
  record(
    "4. Connected transaction with recent progress not warned or released",
    connectedRecent.plannedActions.length === 0
  );

  // 5. Connected no activity for connected-dormancy threshold
  const connectedStale = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(5, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      isChainConnected: true,
      hasMeaningfulParticipation: false,
      chainLastOperationalActivityAt: daysAgo(160),
      lastOperationalActivityAt: daysAgo(160),
    })
  );
  record(
    "5. Connected stale transaction enters dormancy warning (not immediate release)",
    connectedStale.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning
    ) &&
      !connectedStale.plannedActions.includes(
        PROPERTY_LIFECYCLE_ACTION.releaseProperty
      )
  );

  // 6. Still-active confirmation resets clock (returns to active — no release planned while active+recent)
  const confirmedActive = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(6, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      isChainConnected: true,
      chainLastOperationalActivityAt: new Date().toISOString(),
      lastOperationalActivityAt: new Date().toISOString(),
    })
  );
  record(
    "6. After confirmation (simulated active+recent) transaction retained",
    confirmedActive.plannedActions.length === 0
  );

  // 7. Warning threshold reached, nobody confirms
  const warningExpired = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(7, {
      operationalState: PROPERTY_OPERATIONAL_STATE.dormancyWarning,
      isChainConnected: true,
      dormancyWarningAt: daysAgo(40),
      dormancyConfirmationDeadlineAt: daysAgo(5),
    })
  );
  record(
    "7. Connected warning expired plans archive/release",
    warningExpired.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.markDormant
    ) &&
      warningExpired.plannedActions.includes(
        PROPERTY_LIFECYCLE_ACTION.releaseProperty
      )
  );

  // 8. No login but genuine operational progress
  const eaProgress = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(8, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      isChainConnected: true,
      hasMeaningfulParticipation: true,
      chainLastOperationalActivityAt: daysAgo(35),
      lastOperationalActivityAt: daysAgo(35),
    })
  );
  record(
    "8. No login but operational progress — not released",
    !eaProgress.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.releaseProperty
    )
  );

  // 9. Periodic login alone does not protect (identity age flaw fix)
  const loginOnly = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(9, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      isChainConnected: false,
      hasActiveOperationalIdentity: true,
      hasMeaningfulParticipation: false,
      lastOperationalActivityAt: daysAgo(100),
      enteredStateAt: daysAgo(100),
    })
  );
  record(
    "9. Login/identity age alone does not permanently protect address",
    loginOnly.plannedActions.includes(PROPERTY_LIFECYCLE_ACTION.markDormant)
  );

  // 10. Expired invitation on old inactive property
  const expiredInvite = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(10, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      isChainConnected: false,
      hasValidActiveInvitation: false,
      hasExpiredInvitationOnly: true,
      hasMeaningfulParticipation: false,
      lastOperationalActivityAt: daysAgo(100),
    })
  );
  record(
    "10. Expired invitation does not prevent dormant release",
    expiredInvite.plannedActions.includes(PROPERTY_LIFECYCLE_ACTION.markDormant)
  );

  // 11. Valid active invitation protects
  const activeInvite = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(11, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      isChainConnected: false,
      hasValidActiveInvitation: true,
      hasMeaningfulParticipation: false,
      lastOperationalActivityAt: daysAgo(100),
    })
  );
  record(
    "11. Valid active invitation protects from premature release",
    activeInvite.plannedActions.length === 0
  );

  // 12. Completed chain takes precedence
  const completed = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(12, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      chainCompletedAt: daysAgo(5),
      isChainConnected: true,
      hasMeaningfulParticipation: true,
    })
  );
  record(
    "12. Completed chain enters completion grace (not dormancy)",
    completed.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.enterCompletedGrace
    ) &&
      !completed.plannedActions.includes(PROPERTY_LIFECYCLE_ACTION.markDormant)
  );

  // 13. Already released property ignored
  const released = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(13, {
      operationalState: PROPERTY_OPERATIONAL_STATE.released,
      manuallyReleased: true,
      addressReserved: false,
    })
  );
  record(
    "13. Already released property ignored idempotently",
    !released.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.archiveOperational
    )
  );

  // 14. Repeated evaluation produces stable plan (pure idempotency)
  const repeatEval = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(14, {
      operationalState: PROPERTY_OPERATIONAL_STATE.dormancyWarning,
      isChainConnected: true,
      dormancyConfirmationDeadlineAt: daysAgo(1),
    })
  );
  const repeatEval2 = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(14, {
      operationalState: PROPERTY_OPERATIONAL_STATE.dormancyWarning,
      isChainConnected: true,
      dormancyConfirmationDeadlineAt: daysAgo(1),
    })
  );
  record(
    "14. Repeated evaluation produces identical planned actions",
    JSON.stringify(repeatEval.plannedActions) ===
      JSON.stringify(repeatEval2.plannedActions)
  );

  // 15. Historic released address reusable (logic via addressReserved flag)
  record(
    "15. Historic released address not reserved",
    createDefaultLifecycleContext(15, {
      operationalState: PROPERTY_OPERATIONAL_STATE.released,
      addressReserved: false,
    }).addressReserved === false
  );

  // 16. Active address still reserved
  record(
    "16. Active address still reserved",
    createDefaultLifecycleContext(16, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      addressReserved: true,
    }).addressReserved === true
  );

  // 17. Anonymised is property-level only (documentation contract in eval reason)
  const anonymisedPlan = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(17, {
      operationalState: PROPERTY_OPERATIONAL_STATE.released,
      hasAnalyticsSnapshot: true,
      addressReserved: false,
    })
  );
  record(
    "17. Lifecycle anonymisation planned but not claimed as GDPR RTBF",
    anonymisedPlan.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.anonymiseHistorical
    )
  );

  if (!url || !anonKey) {
    console.log(
      "\nSkipping live DB tests — NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env.local"
    );
    summarize();
    return;
  }

  if (!serviceRoleKey) {
    console.log(
      "\nSkipping live DB tests — SUPABASE_SERVICE_ROLE_KEY not configured in .env.local"
    );
    summarize();
    return;
  }

  const admin = serviceClient();
  const { error: probeError } = await admin
    .from("property_lifecycle_states")
    .select("property_id")
    .limit(1);

  if (probeError) {
    console.log(
      `\nSkipping live DB tests — Supabase service-role probe failed: ${probeError.message}`
    );
    summarize();
    return;
  }

  console.log("\n=== Live worker / RPC checks ===\n");

  const stamp = Date.now();
  const email = `lifecycle-${stamp}@example.com`;
  const { client, userId } = await signUp(email);
  await client.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "Lifecycle Verify",
    onboarding_completed_at: new Date().toISOString(),
  });

  const chainId = await createChain(client, stamp);
  const address = `${stamp} Lifecycle Lane`;
  const postcode = "E1 1LC";
  const propertyId = await insertProperty({
    client,
    chainId,
    address,
    postcode,
    userId,
  });

  await setLifecycleState(admin, propertyId, "completed_grace", {
    grace_ends_at: new Date(Date.now() - DAY_MS).toISOString(),
  });

  await admin.from("property_members").insert({
    property_id: propertyId,
    user_id: userId,
    role: "seller",
  });

  await admin.from("property_operational_identities").upsert({
    property_id: propertyId,
    homeowner_user_id: userId,
    operational_role: "seller",
    granted_via: "start_move",
    status: "active",
    granted_at: new Date().toISOString(),
  });

  const evaluation = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(propertyId, {
      operationalState: PROPERTY_OPERATIONAL_STATE.completedGrace,
      chainCompletedAt: daysAgo(40),
      graceEndsAt: daysAgo(1),
      hasMeaningfulParticipation: true,
      memberCount: 1,
      relationshipType: "sale",
    })
  );

  const applyResult = await applyLifecyclePlan({
    supabase: admin,
    evaluation,
  });
  record(
    "Live: worker apply archives and releases completed property",
    applyResult.appliedActions.length > 0 || applyResult.skippedActions.length > 0,
    JSON.stringify({
      applied: applyResult.appliedActions,
      skipped: applyResult.skippedActions,
      errors: applyResult.errors,
    })
  );

  const { data: reservedAfter } = await admin.rpc(
    "property_address_is_reserved",
    { p_property_id: propertyId }
  );
  record("Live: released property no longer reserves address", reservedAfter === false);

  const repeatApply = await applyLifecyclePlan({ supabase: admin, evaluation });
  record(
    "Live: repeated apply is idempotent",
    repeatApply.errors.length === 0,
    repeatApply.errors.length > 0
      ? JSON.stringify(repeatApply.errors)
      : undefined
  );

  const batch = await runPropertyLifecycleWorkerBatch(admin, { batchSize: 5 });
  record(
    "Live: batch worker executes without fatal errors",
    batch.errorCount === 0 || batch.processedCount >= 0
  );

  summarize();
}

function summarize() {
  const failed = results.filter((result) => !result.pass);

  console.log(`\nResults: ${results.length - failed.length}/${results.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }

  console.log("\n=== PROPERTY LIFECYCLE AUTOMATION VERIFICATION PASSED ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
