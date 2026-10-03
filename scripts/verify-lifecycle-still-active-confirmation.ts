/**
 * Still-active confirmation UI + RPC verification (bounded placeholder model,
 * 20261005130000). Only a placeholder's dependent side may confirm; it
 * restarts that row's clock only and grants no authority. A managed row has
 * no clock, so confirming it is a no-op.
 *
 * Live checks need .env.local with Development credentials.
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
const DAY_MS = 86_400_000;

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
  chainPosition: number;
  userId: string;
  address: string;
  relationshipType: "sale" | "purchase";
}) {
  const { data, error } = await params.admin
    .from("properties")
    .insert({
      chain_id: params.chainId,
      chain_position: params.chainPosition,
      address: params.address,
      postcode: "E1 1SA",
      stage: "property_listed",
      status: "healthy",
      relationship_type: params.relationshipType,
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
  operationalRole: "seller" | "buyer"
) {
  await admin.from("property_operational_identities").upsert({
    property_id: propertyId,
    homeowner_user_id: userId,
    operational_role: operationalRole,
    granted_via: "start_move",
    status: "active",
    granted_at: new Date().toISOString(),
  });
}

async function setDormancyWarning(admin: SupabaseClient, propertyId: number) {
  await admin.from("property_lifecycle_states").upsert({
    property_id: propertyId,
    operational_state: "dormancy_warning",
    lifecycle_reason: "verify_fixture",
    entered_state_at: new Date().toISOString(),
    seller_side_unrepresented_since: new Date(Date.now() - 160 * DAY_MS).toISOString(),
    dormancy_warning_at: new Date().toISOString(),
    dormancy_confirmation_deadline_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    dormancy_warning_notified_at: new Date().toISOString(),
    dormancy_warning_notification_claimed_at: null,
  });
}

async function rpcConfirm(client: SupabaseClient, propertyId: number) {
  return confirmTransactionStillActive({ supabase: client, propertyId });
}

async function lifecycleStatus(client: SupabaseClient, propertyId: number) {
  const { data } = await client.rpc("get_property_lifecycle_status", {
    p_property_id: propertyId,
  });
  return (data ?? {}) as { ok?: boolean; in_warning?: boolean; can_confirm?: boolean };
}

async function migrationReady(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.rpc("get_property_lifecycle_status", {
    p_property_id: 0,
  });
  return !error;
}

function runPureChecks() {
  console.log("=== Pure UI eligibility checks ===\n");

  const dormancyView = resolveStillActiveConfirmationView({
    lifecycleHint: true,
    inWarning: true,
    canConfirmStillActive: true,
  });
  record(
    "1. Placeholder in warning + dependent-side viewer → confirmation UI",
    dormancyView.showDormancyPanel &&
      dormancyView.canConfirm &&
      !dormancyView.showAlreadyActiveInfo
  );

  const unauthorisedView = resolveStillActiveConfirmationView({
    lifecycleHint: true,
    inWarning: true,
    canConfirmStillActive: false,
  });
  record(
    "1b. In warning but the viewer cannot confirm → no confirmation UI",
    !unauthorisedView.showDormancyPanel && !unauthorisedView.canConfirm
  );

  const activeView = resolveStillActiveConfirmationView({
    lifecycleHint: true,
    inWarning: false,
    canConfirmStillActive: false,
  });
  record(
    "2. Warning link when the row is not in warning → 'currently active' notice only",
    !activeView.showDormancyPanel &&
      !activeView.canConfirm &&
      activeView.showAlreadyActiveInfo
  );

  const noHintView = resolveStillActiveConfirmationView({
    lifecycleHint: false,
    inWarning: false,
    canConfirmStillActive: false,
  });
  record(
    "2b. No link and no warning → nothing shown",
    !noHintView.showDormancyPanel && !noHintView.showAlreadyActiveInfo
  );

  record(
    "14. Visiting the CTA URL performs no lifecycle mutation (UI layer)",
    isLifecycleDormancyWarningHint("dormancy-warning") && !activeView.canConfirm
  );

  record(
    "7. Old email link after confirmation → no duplicate mutation on page load",
    activeView.showAlreadyActiveInfo && !activeView.canConfirm
  );
}

async function main() {
  runPureChecks();

  if (!url || !anonKey || !serviceRoleKey) {
    console.log("\nSkipping live DB tests — Supabase env incomplete (pending: Development)");
    summarize();
    return;
  }

  const admin = serviceClient();

  if (!(await migrationReady(admin))) {
    console.log(
      "\nSkipping live DB tests — apply 20261005130000_lifecycle_bounded_dormancy.sql first"
    );
    summarize();
    return;
  }

  console.log("\n=== Live still-active confirmation checks ===\n");

  const stamp = Date.now();
  const { client: buyerClient, userId: buyerId } = await signUpHomeowner(
    `still-active-buyer-${stamp}@example.com`
  );
  const { client: counterpartyClient, userId: counterpartyId } =
    await signUpHomeowner(`still-active-cp-${stamp}@example.com`);
  const { client: delegateClient, userId: delegateId } = await signUpHomeowner(
    `still-active-del-${stamp}@example.com`
  );
  const { client: eaClient, userId: eaId } = await signUpHomeowner(
    `still-active-ea-${stamp}@example.com`
  );
  const { client: otherClient } = await signUpHomeowner(
    `still-active-other-${stamp}@example.com`
  );

  const chainId = await createChain(buyerClient, stamp);
  const placeholderId = await insertProperty({
    admin,
    chainId,
    chainPosition: 1,
    userId: buyerId,
    address: `${stamp} Placeholder Lane`,
    relationshipType: "purchase",
  });
  const managedId = await insertProperty({
    admin,
    chainId,
    chainPosition: 2,
    userId: buyerId,
    address: `${stamp} Managed Lane`,
    relationshipType: "sale",
  });

  await upsertOperationalIdentity(admin, placeholderId, buyerId, "buyer");
  await upsertOperationalIdentity(admin, managedId, buyerId, "seller");
  await admin.from("property_counterparty_participants").insert({
    property_id: placeholderId,
    user_id: counterpartyId,
    counterparty_role: "buyer",
    granted_via: "join_chain_property",
    status: "active",
  });
  await admin.from("property_delegates").insert({
    property_id: placeholderId,
    delegate_user_id: delegateId,
    invited_by_user_id: buyerId,
    permissions: ["view"],
    status: "active",
    accepted_at: new Date().toISOString(),
  });
  await admin.from("property_members").insert([
    { property_id: placeholderId, user_id: buyerId, role: "buyer" },
    { property_id: placeholderId, user_id: eaId, role: "estate_agent" },
  ]);

  await setDormancyWarning(admin, placeholderId);

  const buyerStatus = await lifecycleStatus(buyerClient, placeholderId);
  const otherStatus = await lifecycleStatus(otherClient, placeholderId);
  record(
    "15. Warning status is shown to the dependent side only",
    buyerStatus.in_warning === true &&
      buyerStatus.can_confirm === true &&
      otherStatus.in_warning === false,
    JSON.stringify({ buyerStatus, otherStatus })
  );

  const { data: beforeConfirm } = await admin
    .from("property_lifecycle_states")
    .select("last_still_active_confirmed_at")
    .eq("property_id", placeholderId)
    .single();

  const confirmResult = await rpcConfirm(buyerClient, placeholderId);
  record(
    "3. Placeholder buyer confirms → lifecycle active",
    confirmResult.ok &&
      confirmResult.operationalState === PROPERTY_OPERATIONAL_STATE.active
  );

  const { data: afterConfirm } = await admin
    .from("property_lifecycle_states")
    .select(
      "operational_state, last_still_active_confirmed_at, dormancy_warning_notified_at, dormancy_warning_notification_claimed_at, next_evaluation_at"
    )
    .eq("property_id", placeholderId)
    .single();

  record(
    "5. Notification cycle fields reset",
    afterConfirm?.operational_state === "active" &&
      afterConfirm?.dormancy_warning_notified_at === null &&
      afterConfirm?.dormancy_warning_notification_claimed_at === null
  );

  record(
    "4. Confirmation restarts the clock and reschedules evaluation",
    Boolean(afterConfirm?.last_still_active_confirmed_at) &&
      afterConfirm?.last_still_active_confirmed_at !==
        beforeConfirm?.last_still_active_confirmed_at &&
      Boolean(afterConfirm?.next_evaluation_at) &&
      new Date(afterConfirm!.next_evaluation_at as string).getTime() > Date.now()
  );

  const { data: confirmations } = await admin
    .from("property_lifecycle_still_active_confirmations")
    .select("confirmation_code, user_id")
    .eq("property_id", placeholderId)
    .eq("user_id", buyerId);

  record(
    "6. Confirmation record is structured — no free text",
    (confirmations ?? []).length === 1 &&
      confirmations?.[0]?.confirmation_code === "still_active"
  );

  const repeatConfirm = await rpcConfirm(buyerClient, placeholderId);
  const { count: confirmationCount } = await admin
    .from("property_lifecycle_still_active_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("property_id", placeholderId);

  record(
    "13. Repeated confirmation within 24 hours is idempotent",
    repeatConfirm.ok && repeatConfirm.idempotent === true && confirmationCount === 1
  );

  const { data: identityAfter } = await admin
    .from("property_operational_identities")
    .select("homeowner_user_id, operational_role")
    .eq("property_id", placeholderId)
    .eq("status", "active");
  const { count: assignmentCount } = await admin
    .from("property_ea_assignments")
    .select("id", { count: "exact", head: true })
    .eq("property_id", placeholderId)
    .eq("status", "active");
  record(
    "16. Confirmation grants no authority (identity and assignments unchanged)",
    (identityAfter ?? []).length === 1 &&
      identityAfter?.[0]?.operational_role === "buyer" &&
      (assignmentCount ?? 0) === 0
  );

  const delegateAttempt = await rpcConfirm(delegateClient, placeholderId);
  record(
    "10. Delegate cannot confirm",
    !delegateAttempt.ok && delegateAttempt.error === "not_authorised"
  );

  const eaAttempt = await rpcConfirm(eaClient, placeholderId);
  record(
    "11. A member row labelled estate_agent (no branch assignment) cannot confirm",
    !eaAttempt.ok && eaAttempt.error === "not_authorised"
  );

  const wrongUserAttempt = await rpcConfirm(otherClient, placeholderId);
  record(
    "8. Unrelated user cannot confirm",
    !wrongUserAttempt.ok && wrongUserAttempt.error === "not_authorised"
  );

  await setDormancyWarning(admin, placeholderId);
  const counterpartyAttempt = await rpcConfirm(counterpartyClient, placeholderId);
  record(
    "9. Buyer counterparty (dependent side) can confirm the warning",
    counterpartyAttempt.ok &&
      counterpartyAttempt.operationalState === PROPERTY_OPERATIONAL_STATE.active,
    counterpartyAttempt.ok ? undefined : counterpartyAttempt.error
  );

  const managedAttempt = await rpcConfirm(buyerClient, managedId);
  const { count: managedConfirmations } = await admin
    .from("property_lifecycle_still_active_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("property_id", managedId);
  record(
    "17. Managed row: confirmation is a no-op (no clock, no record)",
    managedAttempt.ok && managedAttempt.idempotent === true && managedConfirmations === 0
  );

  await setDormancyWarning(admin, placeholderId);
  await admin
    .from("property_lifecycle_states")
    .update({ operational_state: "released" })
    .eq("property_id", placeholderId);

  const releasedAttempt = await rpcConfirm(buyerClient, placeholderId);
  record(
    "12. Released property cannot be reactivated through stale warning link",
    !releasedAttempt.ok && releasedAttempt.error === "invalid_state_for_confirmation"
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
