/**
 * Participation de-link regression tests (Phase 2).
 *
 * Requires migrations through 20260714160000_participation_delink.sql
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { assignPropertyToBranch } from "../lib/estateAgent/assignments";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const password = "TraceBuyerReady123!";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

async function signUp(email: string) {
  const boot = createClient(url, anonKey);
  await boot.auth.signUp({ email, password });
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const userId = (await client.auth.getUser()).data.user!.id;
  return { client, userId };
}

async function setupHomeowner(client: SupabaseClient, userId: string) {
  await client.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "HO Delink",
    onboarding_completed_at: new Date().toISOString(),
  });
}

async function setupEa(email: string, stamp: number) {
  const { client, userId } = await signUp(email);
  const emailDomain = `delink-ea-${stamp}.dev`;

  await client.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "estate_agent",
    contact_name: "EA Delink",
    email_domain: emailDomain,
    onboarding_completed_at: new Date().toISOString(),
  });

  const { data: company } = await client
    .from("ea_companies")
    .insert({
      name: `Agency ${stamp}`,
      email_domain: emailDomain,
      created_by_user_id: userId,
    })
    .select("id")
    .single();

  const { data: branch } = await client
    .from("ea_branches")
    .insert({
      company_id: company!.id,
      name: "Main",
      town_or_city: "London",
      postcode: "E1 1DL",
      region_code: "UK-LONDON",
      is_head_office: true,
    })
    .select("id")
    .single();

  await client.from("ea_branch_members").insert({
    branch_id: branch!.id,
    user_id: userId,
    role: "branch_admin",
  });

  return { client, userId, branchId: branch!.id as string };
}

async function createEaPendingProperty(
  ea: SupabaseClient,
  branchId: string,
  hoEmail: string,
  stamp: number
) {
  const { data: chainRpc } = await ea.rpc("create_ea_operational_chain", {
    p_name: `Delink EA ${stamp}`,
    p_access_code: `KN-DLK-${stamp}`,
  });

  const { data: saleRpc } = await ea.rpc("create_ea_operational_property", {
    p_chain_id: chainRpc.chain_id,
    p_relationship_type: "sale",
    p_address: `EA Orig ${stamp}`,
    p_postcode: "E2 2DL",
    p_branch_id: branchId,
    p_homeowner_only_updates: false,
    p_invite_email: hoEmail,
    p_awaiting_buyer: false,
  });

  return saleRpc.property_id as number;
}

async function main() {
  const stamp = Date.now();
  const hoEmail = `delink-ho-${stamp}@keynetic-test.dev`;
  const eaEmail = `delink-ea-${stamp}@keynetic-test.dev`;

  const { client: ho, userId: hoId } = await signUp(hoEmail);
  await setupHomeowner(ho, hoId);

  const { client: ea, branchId } = await setupEa(eaEmail, stamp);

  const { data: chainResult } = await ho.rpc("create_chain_for_onboarding", {
    p_name: `Delink-${stamp}`,
    p_access_code: `KN-HO-${stamp}`,
  });
  const chainId = chainResult.chain_id as number;

  const { data: sale } = await ho
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 1,
      address: `Delink Sale ${stamp}`,
      postcode: "D1 1DL",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: hoId,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();

  const saleId = sale!.id as number;

  await ho.rpc("establish_operational_homeowner", {
    p_property_id: saleId,
    p_granted_via: "start_move",
  });

  const assignResult = await assignPropertyToBranch(ho, {
    propertyId: saleId,
    branchId,
    homeownerOnlyUpdates: true,
    assignedByUserId: hoId,
  });
  if (assignResult.error) {
    throw new Error(assignResult.error);
  }

  const { data: options } = await ho.rpc("get_participation_delink_options", {
    p_property_id: saleId,
  });

  record(
    "homeowner sees self + remove EA options",
    options?.ok === true &&
      options.options?.some(
        (o: { operation: string }) => o.operation === "homeowner_self"
      ) &&
      options.options?.some(
        (o: { operation: string }) => o.operation === "homeowner_remove_ea"
      ),
    JSON.stringify(options)
  );

  const { data: removeEa } = await ho.rpc("execute_participation_delink", {
    p_property_id: saleId,
    p_operation: "homeowner_remove_ea",
    p_branch_id: null,
    p_reason_code: "no_longer_need_agent",
  });

  record(
    "homeowner_remove_ea succeeds",
    removeEa?.ok === true,
    JSON.stringify(removeEa)
  );

  const assignAgain = await assignPropertyToBranch(ho, {
    propertyId: saleId,
    branchId,
    homeownerOnlyUpdates: true,
    assignedByUserId: hoId,
  });
  if (assignAgain.error) {
    throw new Error(assignAgain.error);
  }

  const { data: eaOptions } = await ea.rpc("get_participation_delink_options", {
    p_property_id: saleId,
  });

  record(
    "EA sees remove branch option",
    eaOptions?.ok === true &&
      eaOptions.options?.some(
        (o: { operation: string }) =>
          o.operation === "estate_agent_remove_branch"
      ),
    JSON.stringify(eaOptions)
  );

  const { data: eaRemove } = await ea.rpc("execute_participation_delink", {
    p_property_id: saleId,
    p_operation: "estate_agent_remove_branch",
    p_branch_id: branchId,
    p_reason_code: "added_by_mistake",
  });

  record(
    "estate_agent_remove_branch succeeds",
    eaRemove?.ok === true,
    JSON.stringify(eaRemove)
  );

  const pendingInviteEmail = `invite-${stamp}@keynetic-test.dev`;
  const eaPropertyId = await createEaPendingProperty(
    ea,
    branchId,
    pendingInviteEmail,
    stamp + 1
  );

  const { data: pendingOptions } = await ea.rpc(
    "get_participation_delink_options",
    { p_property_id: eaPropertyId }
  );

  record(
    "EA sees withdraw homeowner on pending invite",
    pendingOptions?.ok === true &&
      pendingOptions.options?.some(
        (o: { operation: string }) =>
          o.operation === "estate_agent_remove_homeowner"
      ),
    JSON.stringify(pendingOptions)
  );

  const { data: withdrawHo } = await ea.rpc("execute_participation_delink", {
    p_property_id: eaPropertyId,
    p_operation: "estate_agent_remove_homeowner",
    p_branch_id: branchId,
    p_reason_code: "invitation_no_longer_required",
  });

  record(
    "estate_agent_remove_homeowner on pending invite",
    withdrawHo?.ok === true,
    JSON.stringify(withdrawHo)
  );

  const stamp2 = stamp + 2;
  const ho2Email = `delink-ho2-${stamp2}@keynetic-test.dev`;
  const { client: ho2 } = await signUp(ho2Email);
  await setupHomeowner(ho2, (await ho2.auth.getUser()).data.user!.id);

  const activePropertyId = await createEaPendingProperty(
    ea,
    branchId,
    ho2Email,
    stamp2
  );

  await ho2.rpc("claim_operational_property", {
    p_property_id: activePropertyId,
    p_invitation_token: null,
  });

  await ho2.from("activities").insert({
    property_id: activePropertyId,
    update: "Meaningful homeowner update",
    updated_by: "homeowner",
  });

  const { data: blocked } = await ea.rpc("execute_participation_delink", {
    p_property_id: activePropertyId,
    p_operation: "estate_agent_remove_homeowner",
    p_branch_id: branchId,
    p_reason_code: "wrong_homeowner_invited",
  });

  record(
    "blocked: EA cannot remove meaningful participant",
    blocked?.ok === false &&
      blocked?.error === "homeowner_actively_participating",
    JSON.stringify(blocked)
  );

  const stamp3 = stamp + 3;
  const ho3Email = `delink-ho3-${stamp3}@keynetic-test.dev`;
  const { client: ho3, userId: ho3Id } = await signUp(ho3Email);
  await setupHomeowner(ho3, ho3Id);

  const { data: chain3 } = await ho3.rpc("create_chain_for_onboarding", {
    p_name: `Delink3-${stamp3}`,
    p_access_code: `KN-D3-${stamp3}`,
  });

  const { data: sale3 } = await ho3
    .from("properties")
    .insert({
      chain_id: chain3.chain_id,
      chain_position: 1,
      address: `Self Delink ${stamp3}`,
      postcode: "D3 3DL",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: ho3Id,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();

  await ho3.rpc("establish_operational_homeowner", {
    p_property_id: sale3!.id,
    p_granted_via: "start_move",
  });

  const { data: selfDelink } = await ho3.rpc("execute_participation_delink", {
    p_property_id: sale3!.id,
    p_operation: "homeowner_self",
    p_branch_id: null,
    p_reason_code: "no_longer_moving",
  });

  record(
    "homeowner_self releases property",
    selfDelink?.ok === true && selfDelink?.lifecycle_state === "released",
    JSON.stringify(selfDelink)
  );

  const { data: lifecycle } = await ho3
    .from("property_lifecycle_states")
    .select("operational_state")
    .eq("property_id", sale3!.id)
    .maybeSingle();

  record(
    "lifecycle state persisted as released",
    lifecycle?.operational_state === "released",
    JSON.stringify(lifecycle)
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\nPassed: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.error("Failures:", failed);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
