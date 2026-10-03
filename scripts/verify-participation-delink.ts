/**
 * Participation de-link regression tests (Phase 2).
 *
 * Requires migrations through 20261005120000_operational_authority_enforcement.sql
 * (W1-W7: estate_agent_remove_homeowner follows current seller-side
 * assignment and the claim / invitation flow, not property origin).
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
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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

  await ho.rpc("establish_operational_homeowner_for_created_property", {
    p_property_id: saleId,
  });

  const assignResult = await assignPropertyToBranch(ho, {
    propertyId: saleId,
    branchId,
    homeownerOnlyUpdates: true,
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

  record(
    "estate_agent_remove_branch with homeowner remaining changes nothing else",
    eaRemove?.lifecycle_state === "active" && eaRemove?.placeholder === false,
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
    update: "Offer Accepted",
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

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function selfDelinkIsolatedSale(suffix: number, reasonCode: string) {
    const ownerEmail = `delink-ho${suffix}-${stamp + suffix}@keynetic-test.dev`;
    const { client: owner, userId: ownerId } = await signUp(ownerEmail);
    await setupHomeowner(owner, ownerId);

    const { data: chain } = await owner.rpc("create_chain_for_onboarding", {
      p_name: `Delink${suffix}-${stamp + suffix}`,
      p_access_code: `KN-D${suffix}-${stamp + suffix}`,
    });

    const { data: row } = await owner
      .from("properties")
      .insert({
        chain_id: chain.chain_id,
        chain_position: 1,
        address: `Self Delink ${suffix} ${stamp}`,
        postcode: "D3 3DL",
        stage: "property_listed",
        status: "pending_connection",
        relationship_type: "sale",
        created_by_user_id: ownerId,
        buyer_connected: false,
        seller_connected: true,
        is_searching: false,
      })
      .select("id")
      .single();

    await owner.rpc("establish_operational_homeowner_for_created_property", {
      p_property_id: row!.id,
    });

    const { data: result } = await owner.rpc("execute_participation_delink", {
      p_property_id: row!.id,
      p_operation: "homeowner_self",
      p_branch_id: null,
      p_reason_code: reasonCode,
    });

    const { data: lifecycle } = await admin
      .from("property_lifecycle_states")
      .select("operational_state")
      .eq("property_id", row!.id)
      .maybeSingle();

    return { result, lifecycle };
  }

  // Intentional change (M3): only a mistake reason releases immediately.
  const leaving = await selfDelinkIsolatedSale(3, "no_longer_moving");
  record(
    "homeowner_self (no_longer_moving) leaves an unrepresented placeholder",
    leaving.result?.ok === true &&
      leaving.result?.lifecycle_state === "active" &&
      leaving.result?.placeholder === true,
    JSON.stringify(leaving.result)
  );
  record(
    "placeholder is not released",
    leaving.lifecycle?.operational_state !== "released",
    JSON.stringify(leaving.lifecycle)
  );

  const mistake = await selfDelinkIsolatedSale(4, "wrong_property");
  record(
    "homeowner_self (wrong_property, no dependants) releases property",
    mistake.result?.ok === true && mistake.result?.lifecycle_state === "released",
    JSON.stringify(mistake.result)
  );
  record(
    "lifecycle state persisted as released",
    mistake.lifecycle?.operational_state === "released",
    JSON.stringify(mistake.lifecycle)
  );

  // estate_agent_remove_homeowner: EA-originated != EA-authorised. Each case
  // checks the RPC and that the options RPC (what the UI renders) agrees.
  async function withdraw(client: SupabaseClient, propertyId: number, branch: string | null) {
    const { data } = await client.rpc("execute_participation_delink", {
      p_property_id: propertyId,
      p_operation: "estate_agent_remove_homeowner",
      p_branch_id: branch,
      p_reason_code: "wrong_homeowner_invited",
    });
    return data;
  }
  async function offersWithdraw(client: SupabaseClient, propertyId: number) {
    const { data } = await client.rpc("get_participation_delink_options", {
      p_property_id: propertyId,
    });
    return (
      data?.options?.some(
        (o: { operation: string }) => o.operation === "estate_agent_remove_homeowner"
      ) === true
    );
  }

  // W1: seller-side EA, invited homeowner who has claimed but not participated.
  const stampW = stamp + 20;
  const hoWEmail = `delink-how-${stampW}@keynetic-test.dev`;
  const { client: hoW } = await signUp(hoWEmail);
  await setupHomeowner(hoW, (await hoW.auth.getUser()).data.user!.id);
  const invitedPropertyId = await createEaPendingProperty(ea, branchId, hoWEmail, stampW);
  await hoW.rpc("claim_operational_property", {
    p_property_id: invitedPropertyId,
    p_invitation_token: null,
  });
  const w1Offered = await offersWithdraw(ea, invitedPropertyId);
  const w1 = await withdraw(ea, invitedPropertyId, branchId);
  record(
    "W1: seller-side EA can withdraw a homeowner its branch invited (options agree)",
    w1Offered && w1?.ok === true,
    JSON.stringify({ w1Offered, w1 })
  );

  // W7: seller-side EA cannot withdraw a homeowner who created the sale.
  const { data: selfChain } = await hoW.rpc("create_chain_for_onboarding", {
    p_name: `DelinkSelf-${stampW}`,
    p_access_code: `KN-DSF-${stampW}`,
  });
  const hoWId = (await hoW.auth.getUser()).data.user!.id;
  const { data: selfSale } = await hoW
    .from("properties")
    .insert({
      chain_id: selfChain.chain_id,
      chain_position: 1,
      address: `Delink Self Sale ${stampW}`,
      postcode: "D4 4DL",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: hoWId,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();
  const selfSaleId = selfSale!.id as number;
  await hoW.rpc("establish_operational_homeowner_for_created_property", {
    p_property_id: selfSaleId,
  });
  const selfAssign = await assignPropertyToBranch(hoW, {
    propertyId: selfSaleId,
    branchId,
    homeownerOnlyUpdates: false,
  });
  const w7Offered = await offersWithdraw(ea, selfSaleId);
  const w7 = await withdraw(ea, selfSaleId, branchId);
  record(
    "W7: assigned EA cannot withdraw a homeowner who created the sale (homeowner_not_invited; not offered)",
    !selfAssign.error && !w7Offered && w7?.ok === false && w7?.error === "homeowner_not_invited",
    JSON.stringify({ assignError: selfAssign.error, w7Offered, w7 })
  );

  // W2: an EA assigned to a buyer-side (purchase) row cannot withdraw the buyer.
  const { data: purchase } = await hoW
    .from("properties")
    .insert({
      chain_id: selfChain.chain_id,
      chain_position: 2,
      address: `Delink Onward Purchase ${stampW}`,
      postcode: "D5 5DL",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "purchase",
      created_by_user_id: hoWId,
      buyer_connected: true,
      seller_connected: false,
      is_searching: false,
    })
    .select("id")
    .single();
  const purchaseId = purchase?.id as number | undefined;
  let w2Detail: unknown = "purchase fixture not created";
  let w2Pass = false;
  if (purchaseId) {
    await hoW.rpc("establish_operational_homeowner_for_created_property", {
      p_property_id: purchaseId,
    });
    const { error: buyerAssignError } = await admin.from("property_ea_assignments").insert({
      property_id: purchaseId,
      branch_id: branchId,
      status: "active",
      homeowner_only_updates: false,
      assigned_by_user_id: hoWId,
    });
    const w2Offered = await offersWithdraw(ea, purchaseId);
    const w2 = await withdraw(ea, purchaseId, branchId);
    w2Pass = !buyerAssignError && !w2Offered && w2?.ok === false && w2?.error === "not_seller_side_row";
    w2Detail = { buyerAssignError: buyerAssignError?.message, w2Offered, w2 };
  }
  record(
    "W2: EA on the buyer side cannot withdraw the buyer (not_seller_side_row; not offered)",
    w2Pass,
    JSON.stringify(w2Detail)
  );

  // W3: an EA assigned to another property (different company) cannot act here.
  const { client: otherEa, branchId: otherBranchId } = await setupEa(
    `delink-ea-other-${stampW}@keynetic-test.dev`,
    stampW + 1
  );
  await createEaPendingProperty(otherEa, otherBranchId, `invite-other-${stampW}@keynetic-test.dev`, stampW + 2);
  const targetPropertyId = await createEaPendingProperty(
    ea,
    branchId,
    `invite-target-${stampW}@keynetic-test.dev`,
    stampW + 3
  );
  const w3Offered = await offersWithdraw(otherEa, targetPropertyId);
  const w3 = await withdraw(otherEa, targetPropertyId, otherBranchId);
  const w3Spoofed = await withdraw(otherEa, targetPropertyId, branchId);
  record(
    "W3: EA representing another property cannot withdraw (not_assigned_ea, even naming the assigned branch)",
    !w3Offered &&
      w3?.ok === false &&
      w3?.error === "not_assigned_ea" &&
      w3Spoofed?.ok === false &&
      w3Spoofed?.error === "not_assigned_ea",
    JSON.stringify({ w3Offered, w3, w3Spoofed })
  );

  // W4: a connected participant (the homeowner on the row) cannot use the EA action.
  const w4 = await withdraw(ho2, activePropertyId, branchId);
  record(
    "W4: connected participant cannot withdraw (not_assigned_ea)",
    w4?.ok === false && w4?.error === "not_assigned_ea",
    JSON.stringify(w4)
  );

  // W5: a member of an unassigned branch in the same company cannot act.
  const { client: sameCoMember, userId: sameCoMemberId } = await signUp(
    `delink-ea-samecompany-${stampW}@keynetic-test.dev`
  );
  const { data: assignedBranch } = await admin
    .from("ea_branches")
    .select("company_id")
    .eq("id", branchId)
    .single();
  const { data: unassignedBranch } = await admin
    .from("ea_branches")
    .insert({
      company_id: assignedBranch!.company_id,
      name: "Unassigned",
      town_or_city: "London",
      postcode: "E3 3DL",
      region_code: "UK-LONDON",
      is_head_office: false,
    })
    .select("id")
    .single();
  await admin.from("ea_branch_members").insert({
    branch_id: unassignedBranch!.id,
    user_id: sameCoMemberId,
    role: "agent",
  });
  const w5Offered = await offersWithdraw(sameCoMember, targetPropertyId);
  const w5 = await withdraw(sameCoMember, targetPropertyId, branchId);
  record(
    "W5: unassigned branch member (same company) cannot withdraw (not_assigned_ea; not offered)",
    !w5Offered && w5?.ok === false && w5?.error === "not_assigned_ea",
    JSON.stringify({ w5Offered, w5 })
  );

  // W6: the assigned EA's options and RPC agree on the pending-invite target.
  const w6Offered = await offersWithdraw(ea, targetPropertyId);
  const w6 = await withdraw(ea, targetPropertyId, branchId);
  record(
    "W6: options RPC and execute RPC agree for the assigned EA",
    w6Offered && w6?.ok === true,
    JSON.stringify({ w6Offered, w6 })
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
