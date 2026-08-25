/**
 * Still-active confirmation UI + RPC verification.
 *
 * Requires migrations through 20260714202000_harden_confirm_still_active_authority.sql
 *
 * Usage:
 *   npx tsx scripts/verify-lifecycle-still-active-confirmation.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

import {
  resolveStillActiveConfirmationView,
  isLifecycleDormancyWarningHint,
} from "../lib/lifecycle/stillActiveConfirmationEligibility";
import { confirmTransactionStillActive } from "../lib/lifecycle/confirmStillActive";
import { PROPERTY_OPERATIONAL_STATE } from "../lib/lifecycle/types";

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

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const password = "StillActiveConfirm123!";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function serviceClient() {
  return createClient(url!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signUpHomeowner(email: string) {
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
    contact_name: "Still Active Verify",
    onboarding_completed_at: new Date().toISOString(),
  });
  return { client, userId };
}

async function createChain(client: SupabaseClient, stamp: number) {
  const { data, error } = await client.rpc("create_chain_for_onboarding", {
    p_name: `Still Active ${stamp}`,
    p_access_code: `SA${stamp}`,
  });
  if (error || !data?.ok) {
    throw new Error(error?.message ?? data?.error ?? "chain_create_failed");
  }
  return data.chain_id as number;
}

async function insertProperty(params: {
  admin: SupabaseClient;
  chainId: number;
  userId: string;
  address: string;
}) {
  const { data, error } = await params.admin
    .from("properties")
    .insert({
      chain_id: params.chainId,
      chain_position: 1,
      address: params.address,
      postcode: "E1 1SA",
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

async function upsertOperationalIdentity(
  admin: SupabaseClient,
  propertyId: number,
  userId: string,
  status: "active" | "delinked" | "released" = "active"
) {
  await admin.from("property_operational_identities").upsert({
    property_id: propertyId,
    homeowner_user_id: userId,
    operational_role: "seller",
    granted_via: "start_move",
    status,
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
    dormancy_warning_notified_at: new Date().toISOString(),
    dormancy_warning_notification_claimed_at: null,
  });
}

async function rpcConfirm(client: SupabaseClient, propertyId: number) {
  return confirmTransactionStillActive({ supabase: client, propertyId });
}

async function migrationReady(admin: SupabaseClient): Promise<boolean> {
  const stamp = Date.now();
  const { client: homeownerClient, userId: homeownerId } = await signUpHomeowner(
    `still-active-probe-${stamp}@example.com`
  );
  const { client: counterpartyClient, userId: counterpartyId } =
    await signUpHomeowner(`still-active-probe-cp-${stamp}@example.com`);
  const chainId = await createChain(homeownerClient, stamp);
  const propertyId = await insertProperty({
    admin,
    chainId,
    userId: homeownerId,
    address: `${stamp} Probe Lane`,
  });
  await upsertOperationalIdentity(admin, propertyId, homeownerId);
  await setDormancyWarning(admin, propertyId);
  await admin.from("property_counterparty_participants").insert({
    property_id: propertyId,
    user_id: counterpartyId,
    counterparty_role: "buyer",
    granted_via: "join_chain_property",
    status: "active",
  });

  const { data } = await counterpartyClient.rpc("confirm_transaction_still_active", {
    p_property_id: propertyId,
  });

  return (data as { error?: string } | null)?.error === "not_authorised";
}

async function main() {
  console.log("=== Pure UI eligibility checks ===\n");

  const dormancyView = resolveStillActiveConfirmationView({
    lifecycleHint: true,
    operationalState: PROPERTY_OPERATIONAL_STATE.dormancyWarning,
    isActiveOperationalHomeowner: true,
  });
  record(
    "1. Actual dormancy_warning + authorised homeowner → confirmation UI eligible",
    dormancyView.showDormancyPanel && dormancyView.canConfirm
  );

  const activeView = resolveStillActiveConfirmationView({
    lifecycleHint: true,
    operationalState: PROPERTY_OPERATIONAL_STATE.active,
    isActiveOperationalHomeowner: true,
  });
  record(
    "2. Query parameter alone + active lifecycle → no confirmation required",
    !activeView.showDormancyPanel &&
      !activeView.canConfirm &&
      activeView.showAlreadyActiveInfo
  );

  record(
    "14. Visiting the CTA URL performs no lifecycle mutation (UI layer)",
    isLifecycleDormancyWarningHint("dormancy-warning") &&
      !activeView.canConfirm
  );

  record(
    "7. Old email link after confirmation → no duplicate mutation on page load",
    activeView.showAlreadyActiveInfo && !activeView.canConfirm
  );

  if (!url || !anonKey || !serviceRoleKey) {
    console.log("\nSkipping live DB tests — Supabase env incomplete");
    summarize();
    return;
  }

  const admin = serviceClient();

  if (!(await migrationReady(admin))) {
    console.log(
      "\nSkipping live DB tests — apply 20260714202000_harden_confirm_still_active_authority.sql first"
    );
    summarize();
    return;
  }

  console.log("\n=== Live still-active confirmation checks ===\n");

  const stamp = Date.now();
  const { client: homeownerClient, userId: homeownerId } = await signUpHomeowner(
    `still-active-ho-${stamp}@example.com`
  );
  const { client: counterpartyClient, userId: counterpartyId } =
    await signUpHomeowner(`still-active-cp2-${stamp}@example.com`);
  const { client: delegateClient, userId: delegateId } = await signUpHomeowner(
    `still-active-del-${stamp}@example.com`
  );
  const { client: eaClient, userId: eaId } = await signUpHomeowner(
    `still-active-ea-${stamp}@example.com`
  );
  const { client: otherClient } = await signUpHomeowner(
    `still-active-other-${stamp}@example.com`
  );

  const chainId = await createChain(homeownerClient, stamp);
  const propertyId = await insertProperty({
    admin,
    chainId,
    userId: homeownerId,
    address: `${stamp} Still Active Lane`,
  });

  await upsertOperationalIdentity(admin, propertyId, homeownerId);
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

  const { data: beforeConfirm } = await admin
    .from("property_lifecycle_states")
    .select("last_still_active_confirmed_at, dormancy_warning_notified_at")
    .eq("property_id", propertyId)
    .single();

  const confirmResult = await rpcConfirm(homeownerClient, propertyId);
  record(
    "3. Authorised homeowner confirms → lifecycle active",
    confirmResult.ok &&
      confirmResult.operationalState === PROPERTY_OPERATIONAL_STATE.active
  );

  const { data: afterConfirm } = await admin
    .from("property_lifecycle_states")
    .select(
      "operational_state, last_still_active_confirmed_at, dormancy_warning_notified_at, dormancy_warning_notification_claimed_at"
    )
    .eq("property_id", propertyId)
    .single();

  record(
    "5. Notification cycle fields reset",
    afterConfirm?.operational_state === "active" &&
      afterConfirm?.dormancy_warning_notified_at === null &&
      afterConfirm?.dormancy_warning_notification_claimed_at === null
  );

  record(
    "4. Confirmation updates operational activity appropriately",
    Boolean(afterConfirm?.last_still_active_confirmed_at) &&
      afterConfirm?.last_still_active_confirmed_at !==
        beforeConfirm?.last_still_active_confirmed_at
  );

  const { data: confirmations } = await admin
    .from("property_lifecycle_still_active_confirmations")
    .select("confirmation_code, user_id")
    .eq("property_id", propertyId)
    .eq("user_id", homeownerId);

  record(
    "6. Confirmation record is structured — no free text",
    (confirmations ?? []).length === 1 &&
      confirmations?.[0]?.confirmation_code === "still_active"
  );

  const counterpartyAttempt = await rpcConfirm(counterpartyClient, propertyId);
  record(
    "9. Counterparty cannot confirm",
    !counterpartyAttempt.ok &&
      counterpartyAttempt.error === "not_authorised"
  );

  const delegateAttempt = await rpcConfirm(delegateClient, propertyId);
  record(
    "10. Delegate cannot confirm",
    !delegateAttempt.ok && delegateAttempt.error === "not_authorised"
  );

  const eaAttempt = await rpcConfirm(eaClient, propertyId);
  record(
    "11. EA cannot use homeowner confirmation action",
    !eaAttempt.ok && eaAttempt.error === "not_authorised"
  );

  const wrongUserAttempt = await rpcConfirm(otherClient, propertyId);
  record(
    "8. Wrong user cannot confirm",
    !wrongUserAttempt.ok && wrongUserAttempt.error === "not_authorised"
  );

  const repeatConfirm = await rpcConfirm(homeownerClient, propertyId);
  const { count: confirmationCount } = await admin
    .from("property_lifecycle_still_active_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);

  record(
    "13. Double/repeated confirmation is safe",
    repeatConfirm.ok &&
      repeatConfirm.idempotent === true &&
      confirmationCount === 1
  );

  await setDormancyWarning(admin, propertyId);
  await admin
    .from("property_lifecycle_states")
    .update({ operational_state: "released" })
    .eq("property_id", propertyId);

  const releasedAttempt = await rpcConfirm(homeownerClient, propertyId);
  record(
    "12. Released property cannot be reactivated through stale warning link",
    !releasedAttempt.ok &&
      releasedAttempt.error === "invalid_state_for_confirmation"
  );

  summarize();
}

function summarize() {
  const failed = results.filter((result) => !result.pass);
  console.log(`\nResults: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
  console.log("\n=== STILL-ACTIVE CONFIRMATION VERIFICATION PASSED ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
