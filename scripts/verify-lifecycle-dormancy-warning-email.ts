/**
 * Dormancy warning email notification verification.
 *
 * Requires migrations through 20260714201000_fix_dormancy_warning_recipient_banned_check.sql
 * and SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
 *
 * Auth pattern:
 * - Homeowner onboarding RPCs (create_chain_for_onboarding, confirm_transaction_still_active)
 *   run on signed-in anon clients (auth.uid() required).
 * - Lifecycle notification RPCs and test fixtures run on service role.
 *
 * Usage:
 *   npx tsx scripts/verify-lifecycle-dormancy-warning-email.ts
 */
import { randomUUID } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

import { renderDormancyWarning } from "../lib/communications/render";
import { buildDormancyWarningPropertyUrl } from "../lib/communications/dormancyWarningLinks";
import { processDormancyWarningNotifications } from "../lib/lifecycle/dormancyWarningNotifications";
import type { SendEmailResult } from "../lib/communications/types";

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

  const embeddedKey = value.match(/^your[_-]?service[_-]?role[_-]?key=(.+)$/i);

  if (embeddedKey) {
    value = embeddedKey[1].trim();
  }

  if (!value || PLACEHOLDER_SERVICE_ROLE_KEYS.has(value.toLowerCase())) {
    return undefined;
  }

  return value;
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = resolveServiceRoleKey(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const password = "DormancyEmail123!";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function serviceClient() {
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service client requires URL and service role key");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function migrationReady(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.rpc("get_dormancy_warning_email_recipient", {
    p_property_id: -1,
  });

  return !error;
}

type TestUser = {
  client: SupabaseClient;
  userId: string;
};

/** Verified homeowner session — matches verify-property-lifecycle-automation.ts */
async function signUpHomeowner(email: string): Promise<TestUser> {
  if (!url || !anonKey) {
    throw new Error("Supabase auth client requires URL and anon key");
  }

  const boot = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await boot.auth.signUp({ email, password });

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw error;
  }

  const userId = (await client.auth.getUser()).data.user!.id;

  await client.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "Dormancy Verify",
    onboarding_completed_at: new Date().toISOString(),
  });

  return { client, userId };
}

/** Unverified user fixture — no session required for recipient exclusion tests */
async function createUnverifiedUserId(
  admin: SupabaseClient,
  email: string
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "create_unverified_user_failed");
  }

  await admin.from("profiles").upsert({
    id: data.user.id,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "Dormancy Verify Unverified",
    onboarding_completed_at: new Date().toISOString(),
  });

  return data.user.id;
}

/** Verified user fixture when only userId is needed (no RPC session required) */
async function signUpUserIdOnly(email: string): Promise<string> {
  const { userId } = await signUpHomeowner(email);
  return userId;
}

async function createChain(
  client: SupabaseClient,
  stamp: number
): Promise<number> {
  const { data, error } = await client.rpc("create_chain_for_onboarding", {
    p_name: `Dormancy Email ${stamp}`,
    p_access_code: `DE${stamp}`,
  });

  if (error || !data?.ok) {
    throw new Error(error?.message ?? data?.error ?? "chain_create_failed");
  }

  return data.chain_id as number;
}

async function insertProperty(params: {
  admin: SupabaseClient;
  chainId: number | null;
  chainPosition: number;
  address: string;
  postcode: string;
  userId: string;
}) {
  const { data, error } = await params.admin
    .from("properties")
    .insert({
      chain_id: params.chainId,
      chain_position: params.chainPosition,
      address: params.address,
      postcode: params.postcode,
      stage: "property_listed",
      status: "healthy",
      relationship_type: "sale",
      created_by_user_id: params.userId,
      buyer_connected: false,
      seller_connected: false,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "property_insert_failed");
  }

  return data.id as number;
}

async function upsertOperationalIdentity(params: {
  admin: SupabaseClient;
  propertyId: number;
  userId: string;
  status?: "active" | "delinked" | "released";
}) {
  await params.admin.from("property_operational_identities").upsert({
    property_id: params.propertyId,
    homeowner_user_id: params.userId,
    operational_role: "seller",
    granted_via: "start_move",
    status: params.status ?? "active",
    granted_at: new Date().toISOString(),
  });
}

async function setDormancyWarning(admin: SupabaseClient, propertyId: number) {
  await admin.from("property_lifecycle_states").upsert({
    property_id: propertyId,
    operational_state: "dormancy_warning",
    lifecycle_reason: "verify_fixture",
    entered_state_at: new Date().toISOString(),
    dormancy_warning_at: new Date().toISOString(),
    dormancy_confirmation_deadline_at: new Date(
      Date.now() + 30 * 86_400_000
    ).toISOString(),
    dormancy_warning_notified_at: null,
    dormancy_warning_notification_claimed_at: null,
  });
}

async function getRecipientEmail(
  admin: SupabaseClient,
  propertyId: number
): Promise<string | null> {
  const { data } = await admin.rpc("get_dormancy_warning_email_recipient", {
    p_property_id: propertyId,
  });

  const row = ((data ?? []) as Array<{ recipient_email?: string }>)[0];
  return row?.recipient_email ?? null;
}

function mockSendSuccess(): () => Promise<SendEmailResult> {
  return async () => ({
    ok: true,
    sent: true,
    provider: "mock",
    messageId: "mock-message-id",
    eventId: null,
  });
}

function mockSendFailure(): () => Promise<SendEmailResult> {
  return async () => ({
    ok: false,
    sent: false,
    error: "mock_send_failed",
    eventId: null,
  });
}

async function main() {
  console.log("=== Template / privacy checks ===\n");

  const rendered = await renderDormancyWarning({
    to: "homeowner@example.com",
    confirmationLink: buildDormancyWarningPropertyUrl(99),
  });

  record(
    "12. Email does not expose another participant property/address",
    !rendered.html.includes("Maple Grove") &&
      !rendered.text.includes("Maple Grove") &&
      rendered.subject === "Is your property transaction still active?"
  );

  record(
    "CTA uses authenticated property route without lifecycle mutation",
    rendered.html.includes("lifecycle=dormancy-warning") &&
      rendered.html.includes("/property/99")
  );

  if (!url || !serviceRoleKey || !anonKey) {
    console.log(
      "\nSkipping live DB tests — Supabase URL, service role key, or anon key missing"
    );
    summarize();
    return;
  }

  const admin = serviceClient();

  if (!(await migrationReady(admin))) {
    console.log(
      "\nSkipping live DB tests — apply 20260714200000_lifecycle_dormancy_warning_email.sql first"
    );
    summarize();
    return;
  }

  console.log("\n=== Live dormancy warning email checks ===\n");

  const stamp = Date.now();
  const homeownerEmail = `dormancy-homeowner-${stamp}@example.com`;
  const counterpartyEmail = `dormancy-counterparty-${stamp}@example.com`;
  const delegateEmail = `dormancy-delegate-${stamp}@example.com`;
  const eaEmail = `dormancy-ea-${stamp}@example.com`;
  const unverifiedEmail = `dormancy-unverified-${stamp}@example.com`;
  const delinkedEmail = `dormancy-delinked-${stamp}@example.com`;

  const { client: homeownerClient, userId: homeownerId } =
    await signUpHomeowner(homeownerEmail);
  const counterpartyId = await signUpUserIdOnly(counterpartyEmail);
  const delegateId = await signUpUserIdOnly(delegateEmail);
  const eaId = await signUpUserIdOnly(eaEmail);
  const unverifiedId = await createUnverifiedUserId(admin, unverifiedEmail);
  const delinkedId = await signUpUserIdOnly(delinkedEmail);

  const chainId = await createChain(homeownerClient, stamp);

  const propertyId = await insertProperty({
    admin,
    chainId,
    chainPosition: 1,
    address: `${stamp} Secret Lane`,
    postcode: "E1 1DW",
    userId: homeownerId,
  });

  await upsertOperationalIdentity({
    admin,
    propertyId,
    userId: homeownerId,
    status: "active",
  });

  await admin.from("property_counterparty_participants").insert({
    property_id: propertyId,
    user_id: counterpartyId,
    counterparty_role: "buyer",
    granted_via: "join_chain_property",
    status: "active",
  });

  await admin.from("property_delegates").insert({
    property_id: propertyId,
    delegate_user_id: delegateId,
    invited_by_user_id: homeownerId,
    permissions: ["view"],
    status: "active",
    accepted_at: new Date().toISOString(),
  });

  await admin.from("property_members").insert([
    { property_id: propertyId, user_id: homeownerId, role: "seller" },
    { property_id: propertyId, user_id: eaId, role: "estate_agent" },
  ]);

  await setDormancyWarning(admin, propertyId);

  const resolvedRecipient = await getRecipientEmail(admin, propertyId);
  record(
    "1. Dormancy warning resolves active operational homeowner",
    resolvedRecipient === homeownerEmail.toLowerCase()
  );
  record(
    "2. Counterparty is not treated as homeowner recipient",
    resolvedRecipient !== counterpartyEmail.toLowerCase()
  );
  record(
    "3. Delegate is not emailed",
    resolvedRecipient !== delegateEmail.toLowerCase()
  );
  record(
    "4. EA is not emailed",
    resolvedRecipient !== eaEmail.toLowerCase()
  );

  const unverifiedPropertyId = await insertProperty({
    admin,
    chainId,
    chainPosition: 2,
    address: `${stamp} Unverified Lane`,
    postcode: "E1 1UV",
    userId: unverifiedId,
  });
  await upsertOperationalIdentity({
    admin,
    propertyId: unverifiedPropertyId,
    userId: unverifiedId,
    status: "active",
  });
  await setDormancyWarning(admin, unverifiedPropertyId);
  record(
    "5. Unverified user is not emailed",
    (await getRecipientEmail(admin, unverifiedPropertyId)) === null
  );

  const delinkedPropertyId = await insertProperty({
    admin,
    chainId,
    chainPosition: 3,
    address: `${stamp} Delinked Lane`,
    postcode: "E1 1DL",
    userId: delinkedId,
  });
  await upsertOperationalIdentity({
    admin,
    propertyId: delinkedPropertyId,
    userId: delinkedId,
    status: "delinked",
  });
  await admin
    .from("property_operational_identities")
    .update({ delinked_at: new Date().toISOString() })
    .eq("property_id", delinkedPropertyId);
  await setDormancyWarning(admin, delinkedPropertyId);
  record(
    "6. Released/delinked identity is not emailed",
    (await getRecipientEmail(admin, delinkedPropertyId)) === null
  );

  await admin
    .from("property_lifecycle_states")
    .update({
      dormancy_warning_notified_at: null,
      dormancy_warning_notification_claimed_at: null,
    })
    .eq("property_id", propertyId);

  let sendCount = 0;
  const firstSend = await processDormancyWarningNotifications({
    supabase: admin,
    sourcePropertyId: propertyId,
    workerRunId: randomUUID(),
    sendEmail: async () => {
      sendCount += 1;
      return mockSendSuccess()();
    },
  });

  const { data: afterFirstSend } = await admin
    .from("property_lifecycle_states")
    .select("dormancy_warning_notified_at")
    .eq("property_id", propertyId)
    .single();

  record(
    "7. First dormancy warning sends one email",
    sendCount === 1 && firstSend.some((entry) => entry.sent)
  );
  record(
    "10. Successful send records notification state",
    Boolean(afterFirstSend?.dormancy_warning_notified_at)
  );

  const repeatSend = await processDormancyWarningNotifications({
    supabase: admin,
    sourcePropertyId: propertyId,
    workerRunId: randomUUID(),
    sendEmail: async () => {
      sendCount += 1;
      return mockSendSuccess()();
    },
  });

  record(
    "8. Repeated worker run does not send duplicate email",
    sendCount === 1 &&
      repeatSend.every((entry) => !entry.sent && entry.skipped)
  );

  await admin
    .from("property_lifecycle_states")
    .update({
      dormancy_warning_notified_at: null,
      dormancy_warning_notification_claimed_at: null,
    })
    .eq("property_id", propertyId);

  let failedAttempt = false;
  await processDormancyWarningNotifications({
    supabase: admin,
    sourcePropertyId: propertyId,
    workerRunId: randomUUID(),
    sendEmail: async () => {
      failedAttempt = true;
      return mockSendFailure()();
    },
  });

  const { data: afterFailure } = await admin
    .from("property_lifecycle_states")
    .select("dormancy_warning_notified_at, dormancy_warning_notification_claimed_at")
    .eq("property_id", propertyId)
    .single();

  let retrySent = false;
  await processDormancyWarningNotifications({
    supabase: admin,
    sourcePropertyId: propertyId,
    workerRunId: randomUUID(),
    sendEmail: async () => {
      retrySent = true;
      return mockSendSuccess()();
    },
  });

  record(
    "9. Failed send remains retryable",
    failedAttempt &&
      !afterFailure?.dormancy_warning_notified_at &&
      !afterFailure?.dormancy_warning_notification_claimed_at &&
      retrySent
  );

  const chainStamp = stamp + 1;
  const { client: ownerAClient, userId: ownerA } = await signUpHomeowner(
    `dormancy-a-${chainStamp}@example.com`
  );
  const ownerB = await signUpUserIdOnly(`dormancy-b-${chainStamp}@example.com`);
  const ownerC = await signUpUserIdOnly(`dormancy-c-${chainStamp}@example.com`);
  const chainIdWide = await createChain(ownerAClient, chainStamp);

  const propertyA = await insertProperty({
    admin,
    chainId: chainIdWide,
    chainPosition: 1,
    address: `${chainStamp} Chain A Street`,
    postcode: "E2 2DW",
    userId: ownerA,
  });
  const propertyB = await insertProperty({
    admin,
    chainId: chainIdWide,
    chainPosition: 2,
    address: `${chainStamp} Chain B Street`,
    postcode: "E2 2DX",
    userId: ownerB,
  });
  const propertyC = await insertProperty({
    admin,
    chainId: chainIdWide,
    chainPosition: 3,
    address: `${chainStamp} Chain C Street`,
    postcode: "E2 2DY",
    userId: ownerC,
  });

  for (const [property, owner] of [
    [propertyA, ownerA],
    [propertyB, ownerB],
    [propertyC, ownerC],
  ] as const) {
    await upsertOperationalIdentity({
      admin,
      propertyId: property,
      userId: owner,
    });
    await setDormancyWarning(admin, property);
  }

  const chainRecipients = await Promise.all([
    getRecipientEmail(admin, propertyA),
    getRecipientEmail(admin, propertyB),
    getRecipientEmail(admin, propertyC),
  ]);

  const chainSent: string[] = [];
  await processDormancyWarningNotifications({
    supabase: admin,
    sourcePropertyId: propertyA,
    workerRunId: randomUUID(),
    sendEmail: async (params) => {
      chainSent.push(params.to);
      return mockSendSuccess()();
    },
  });

  record(
    "11. Chain-wide warning resolves each operational homeowner independently",
    chainRecipients.every(Boolean) &&
      chainSent.length === 3 &&
      new Set(chainSent).size === 3
  );

  {
    await setDormancyWarning(admin, propertyId);
    await admin
      .from("property_lifecycle_states")
      .update({
        dormancy_warning_notified_at: new Date().toISOString(),
      })
      .eq("property_id", propertyId);

    const { data: confirmResult, error: confirmError } = await homeownerClient.rpc(
      "confirm_transaction_still_active",
      {
        p_property_id: propertyId,
      }
    );

    const { data: afterConfirm } = await admin
      .from("property_lifecycle_states")
      .select("operational_state, dormancy_warning_notified_at")
      .eq("property_id", propertyId)
      .single();

    record(
      "13. Confirmation resets notification cycle",
      !confirmError &&
        confirmResult?.ok === true &&
        afterConfirm?.operational_state === "active" &&
        afterConfirm?.dormancy_warning_notified_at === null
    );

    await setDormancyWarning(admin, propertyId);

    let secondCycleSent = false;
    await processDormancyWarningNotifications({
      supabase: admin,
      sourcePropertyId: propertyId,
      workerRunId: randomUUID(),
      sendEmail: async () => {
        secondCycleSent = true;
        return mockSendSuccess()();
      },
    });

    record(
      "14. A future new dormancy cycle can generate a new warning",
      secondCycleSent
    );
  }

  summarize();
}

function summarize() {
  const failed = results.filter((result) => !result.pass);

  console.log(`\nResults: ${results.length - failed.length}/${results.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }

  console.log("\n=== DORMANCY WARNING EMAIL VERIFICATION PASSED ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
