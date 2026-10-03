/**
 * Development-only verification for the returning-EA reconnection rule
 * (reconnect_returning_ea_branch, 20261005120000).
 *
 * Under the approved representation model a homeowner leaving never drops the
 * EA (homeowner_self keeps the assignment), so the only path that ends an
 * assignment because the appointing homeowner left is the GDPR person-link
 * removal (_gdpr_remove_subject_property_links, revocation_reason =
 * homeowner_left_cascade). R1 uses that real function to produce the state.
 *
 *   R0  homeowner_self with an EA assigned keeps the EA (no reconnection needed)
 *   R1  returning branch reconnects after the cascade; audited; managed again
 *   R2  branch that removed itself (branch_left) cannot reconnect
 *   R3  branch the homeowner removed (homeowner_removed_ea) cannot reconnect
 *   R4  a different branch cannot use the cascade
 *   R5  a non-member naming the branch is refused
 *   R6  seller side represented again -> refused
 *   R7  a replacement branch was assigned since -> refused
 *   R8  released row -> refused
 *   R9  a second attempt after reconnecting is refused (no duplicate authority)
 *
 * The returning-branch lookup (list_reconnectable_ea_properties, used by
 * /agent/reconnect):
 *   L1  offers the cascade row to the returning branch only, with limited
 *       fields, and grants nothing by itself
 *   R6  a row the lookup offered earlier is still refused by the RPC once it
 *       is no longer eligible (independent recheck)
 *   L2  offers none of the R2/R3/R6/R7/R8 rows or the reconnected R1 row
 *   L3  archived row: not offered, refused
 *   L4  branch acting for the linking sale (buyer side): not offered, refused
 *   L5  member who has left the branch: not offered, not_ea_branch_member
 *   L6  address / postcode / access-code parameters rejected by both functions
 *   L7  anon cannot call the lookup
 *   L8  remaining branch member is offered the row and reconnects
 *
 * Usage (only after the migrations are applied to Development):
 *   npx tsx scripts/verify-ea-reconnection-development.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

import { assignPropertyToBranch } from "../lib/estateAgent/assignments";
import { createGdprErasureRequest } from "../lib/gdpr/erasureRequest";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "EaReconnectVerify123!";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function loadEnvLocal(): void {
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const at = trimmed.indexOf("=");
      if (at <= 0) continue;
      let value = trimmed.slice(at + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[trimmed.slice(0, at).trim()] = value;
    }
  } catch {
    // optional
  }
}

loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

function assertDevelopmentEnvironment(supabaseUrl: string): void {
  const projectRef = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null;
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(`Refusing to run: Supabase project "${projectRef ?? "unknown"}" is not Development.`);
  }
}

async function signUp(email: string) {
  const boot = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  await boot.auth.signUp({ email, password: PASSWORD });
  const client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { client, userId: (await client.auth.getUser()).data.user!.id };
}

async function main() {
  console.log("=== EA reconnection verification (Development only) ===\n");
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Supabase URL, anon key, and service role key are required.");
  }
  assertDevelopmentEnvironment(url);
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!process.env.GDPR_SUPPRESSION_HMAC_KEY?.trim()) {
    process.env.GDPR_SUPPRESSION_HMAC_KEY = "dev-ea-reconnection-verification-pepper";
  }

  const stamp = Date.now();
  let seq = 0;

  async function setupEa(label: string) {
    const n = ++seq;
    const domain = `reconnect-ea-${label}-${stamp}.dev`;
    const { client, userId } = await signUp(`reconnect-ea-${label}-${stamp}@keynetic-test.dev`);
    await client.from("profiles").upsert({
      id: userId,
      role: "homeowner",
      account_type: "estate_agent",
      contact_name: `EA Reconnect ${label}`,
      email_domain: domain,
      onboarding_completed_at: new Date().toISOString(),
    });
    const { data: company } = await client
      .from("ea_companies")
      .insert({ name: `Reconnect Agency ${label} ${stamp}`, email_domain: domain, created_by_user_id: userId })
      .select("id")
      .single();
    const { data: branch } = await client
      .from("ea_branches")
      .insert({
        company_id: company!.id,
        name: `Main ${n}`,
        town_or_city: "London",
        postcode: "E1 1RC",
        region_code: "UK-LONDON",
        is_head_office: true,
      })
      .select("id")
      .single();
    await client.from("ea_branch_members").insert({ branch_id: branch!.id, user_id: userId, role: "branch_admin" });
    return { client, userId, branchId: branch!.id as string };
  }

  async function homeownerSale(label: string, branchId: string) {
    const n = ++seq;
    const { client, userId } = await signUp(`reconnect-ho-${label}-${stamp}@keynetic-test.dev`);
    await client.from("profiles").upsert({
      id: userId,
      role: "homeowner",
      account_type: "homeowner",
      contact_name: `HO Reconnect ${label}`,
      onboarding_completed_at: new Date().toISOString(),
    });
    const { data: chain } = await client.rpc("create_chain_for_onboarding", {
      p_name: `Reconnect ${label} ${stamp}`,
      p_access_code: `KN-RC${n}-${stamp}`,
    });
    const { data: sale } = await client
      .from("properties")
      .insert({
        chain_id: chain.chain_id,
        chain_position: 1,
        address: `Reconnect ${label} ${stamp}`,
        postcode: "E2 2RC",
        stage: "property_listed",
        status: "pending_connection",
        relationship_type: "sale",
        created_by_user_id: userId,
        buyer_connected: false,
        seller_connected: true,
        is_searching: false,
      })
      .select("id")
      .single();
    const propertyId = sale!.id as number;
    await client.rpc("establish_operational_homeowner_for_created_property", { p_property_id: propertyId });
    const assigned = await assignPropertyToBranch(client, {
      propertyId,
      branchId,
      homeownerOnlyUpdates: false,
    });
    if (assigned.error) throw new Error(`assign failed (${label}): ${assigned.error}`);
    return { client, userId, propertyId };
  }

  async function cascade(subjectUserId: string, propertyId: number) {
    const request = await createGdprErasureRequest({
      supabase: admin,
      subjectUserId,
      requestSource: "internal_dev_fixture",
    });
    if (request.ok !== true || !request.request_id) throw new Error(request.error ?? "erasure_request_failed");
    const { data, error } = await admin.rpc("_gdpr_remove_subject_property_links", {
      p_subject_user_id: subjectUserId,
      p_property_id: propertyId,
      p_erasure_request_id: request.request_id,
    });
    if (error || data?.ok !== true) throw new Error(error?.message ?? "cascade_failed");
  }

  async function reconnect(client: SupabaseClient, propertyId: number, branchId: string) {
    const { data } = await client.rpc("reconnect_returning_ea_branch", {
      p_property_id: propertyId,
      p_branch_id: branchId,
    });
    return data as { ok?: boolean; error?: string; assignment_id?: string } | null;
  }

  async function latestAssignment(propertyId: number) {
    const { data } = await admin
      .from("property_ea_assignments")
      .select("id, branch_id, status, revocation_reason")
      .eq("property_id", propertyId)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }

  async function sellerSide(propertyId: number) {
    const { data } = await admin.rpc("_property_side_representation", { p_property_id: propertyId });
    const row = Array.isArray(data) ? data[0] : data;
    return row?.seller_side as string | undefined;
  }

  type LookupRow = {
    property_id: number;
    branch_id: string;
    branch_name: string | null;
    address: string | null;
    postcode: string | null;
    assignment_ended_at: string | null;
  };
  type LookupResult = { ok?: boolean; error?: string; properties?: LookupRow[] } | null;

  async function lookup(client: SupabaseClient): Promise<LookupResult> {
    const { data, error } = await client.rpc("list_reconnectable_ea_properties");
    if (error) return { ok: false, error: error.message };
    return data as LookupResult;
  }

  function listed(result: LookupResult, propertyId: number, branchId: string) {
    return (result?.properties ?? []).some(
      (row) => row.property_id === propertyId && row.branch_id === branchId
    );
  }

  async function transition(propertyId: number, toState: string) {
    const { data, error } = await admin.rpc("record_property_lifecycle_transition_worker", {
      p_property_id: propertyId,
      p_to_state: toState,
      p_trigger: "manual",
      p_scenario: null,
      p_reason: "ea_reconnection_verifier",
      p_metadata: {},
    });
    return !error && data?.ok === true;
  }

  const ea = await setupEa("main");
  const otherEa = await setupEa("other");

  // R0
  const r0 = await homeownerSale("r0", ea.branchId);
  const { data: r0Leave } = await r0.client.rpc("execute_participation_delink", {
    p_property_id: r0.propertyId,
    p_operation: "homeowner_self",
    p_branch_id: null,
    p_reason_code: "no_longer_moving",
  });
  const r0Assignment = await latestAssignment(r0.propertyId);
  record(
    "R0: homeowner leaving keeps the EA (no cascade, nothing to reconnect)",
    r0Leave?.ok === true && r0Leave?.ea_retained === true && r0Assignment?.status === "active",
    JSON.stringify({ r0Leave, r0Assignment })
  );

  // R1 / R4 / R5 / R9
  const f1 = await homeownerSale("f1", ea.branchId);
  await cascade(f1.userId, f1.propertyId);
  const f1Revoked = await latestAssignment(f1.propertyId);
  record(
    "R1 setup: the GDPR person-link removal tags the appointed branch homeowner_left_cascade; seller side unrepresented",
    f1Revoked?.status === "revoked" &&
      f1Revoked?.revocation_reason === "homeowner_left_cascade" &&
      (await sellerSide(f1.propertyId)) === "none",
    JSON.stringify(f1Revoked)
  );

  // L1: the lookup offers the row to the returning branch only, exposes only
  // what the branch already held, and grants nothing by itself.
  const l1Main = await lookup(ea.client);
  const l1Other = await lookup(otherEa.client);
  const l1Row = (l1Main?.properties ?? []).find((row) => row.property_id === f1.propertyId);
  const { data: l1CanOperate } = await ea.client.rpc("can_operate_property", { p_property_id: f1.propertyId });
  const l1After = await latestAssignment(f1.propertyId);
  record(
    "L1: lookup offers the cascade row to the returning branch only; fields limited to row/branch/address/postcode/ended",
    l1Main?.ok === true &&
      l1Row?.branch_id === ea.branchId &&
      l1Other?.ok === true &&
      !listed(l1Other, f1.propertyId, ea.branchId) &&
      !listed(l1Other, f1.propertyId, otherEa.branchId) &&
      Object.keys(l1Row ?? {}).sort().join(",") ===
        "address,assignment_ended_at,branch_id,branch_name,postcode,property_id",
    JSON.stringify({ l1Main, l1Other })
  );
  record(
    "L1: the lookup grants no authority (still revoked, seller side none, cannot operate)",
    l1After?.status === "revoked" &&
      (await sellerSide(f1.propertyId)) === "none" &&
      l1CanOperate !== true,
    JSON.stringify({ l1After, l1CanOperate })
  );

  const r4 = await reconnect(otherEa.client, f1.propertyId, otherEa.branchId);
  record("R4: a different branch cannot use another branch's cascade", r4?.ok === false && r4?.error === "not_reconnectable", JSON.stringify(r4));

  const r5 = await reconnect(otherEa.client, f1.propertyId, ea.branchId);
  record("R5: a non-member naming the returning branch is refused", r5?.ok === false && r5?.error === "not_ea_branch_member", JSON.stringify(r5));

  const r1 = await reconnect(ea.client, f1.propertyId, ea.branchId);
  const f1Active = await latestAssignment(f1.propertyId);
  const { count: auditCount } = await admin
    .from("property_ea_reconnection_events")
    .select("id", { count: "exact", head: true })
    .eq("property_id", f1.propertyId);
  const { data: canOperate } = await ea.client.rpc("can_operate_property", { p_property_id: f1.propertyId });
  record(
    "R1: returning branch reconnects; audited once; managed again (seller side ea, can operate)",
    r1?.ok === true &&
      f1Active?.status === "active" &&
      f1Active?.branch_id === ea.branchId &&
      auditCount === 1 &&
      (await sellerSide(f1.propertyId)) === "ea" &&
      canOperate === true,
    JSON.stringify({ r1, f1Active, auditCount, canOperate })
  );

  const r9 = await reconnect(ea.client, f1.propertyId, ea.branchId);
  record("R9: second attempt after reconnecting is refused", r9?.ok === false && r9?.error === "not_reconnectable", JSON.stringify(r9));

  // R2: EA-originated sale, branch removes itself -> placeholder, branch_left.
  const { data: r2Chain } = await ea.client.rpc("create_ea_operational_chain", {
    p_name: `Reconnect R2 ${stamp}`,
    p_access_code: `KN-RC2-${stamp}`,
  });
  const { data: r2Sale } = await ea.client.rpc("create_ea_operational_property", {
    p_chain_id: r2Chain.chain_id,
    p_relationship_type: "sale",
    p_address: `Reconnect R2 ${stamp}`,
    p_postcode: "E3 3RC",
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: false,
    p_invite_email: null,
    p_awaiting_buyer: false,
  });
  const r2PropertyId = r2Sale.property_id as number;
  await ea.client.rpc("execute_participation_delink", {
    p_property_id: r2PropertyId,
    p_operation: "estate_agent_remove_branch",
    p_branch_id: ea.branchId,
    p_reason_code: "branch_no_longer_instructed",
  });
  const r2Revoked = await latestAssignment(r2PropertyId);
  const r2 = await reconnect(ea.client, r2PropertyId, ea.branchId);
  record(
    "R2: branch that removed itself (branch_left) cannot reconnect",
    r2Revoked?.revocation_reason === "branch_left" && r2?.ok === false && r2?.error === "not_reconnectable",
    JSON.stringify({ r2Revoked, r2 })
  );

  // R3: homeowner removes the EA, then leaves -> placeholder, homeowner_removed_ea.
  const f3 = await homeownerSale("f3", ea.branchId);
  await f3.client.rpc("execute_participation_delink", {
    p_property_id: f3.propertyId,
    p_operation: "homeowner_remove_ea",
    p_branch_id: null,
    p_reason_code: "no_longer_need_agent",
  });
  await f3.client.rpc("execute_participation_delink", {
    p_property_id: f3.propertyId,
    p_operation: "homeowner_self",
    p_branch_id: null,
    p_reason_code: "no_longer_moving",
  });
  const r3 = await reconnect(ea.client, f3.propertyId, ea.branchId);
  record(
    "R3: branch the homeowner removed cannot reconnect after the homeowner leaves",
    (await sellerSide(f3.propertyId)) === "none" && r3?.ok === false && r3?.error === "not_reconnectable",
    JSON.stringify(r3)
  );

  // R6: cascade, then a new homeowner holds the seller side.
  const f6 = await homeownerSale("f6", ea.branchId);
  await cascade(f6.userId, f6.propertyId);
  const f6OfferedBefore = listed(await lookup(ea.client), f6.propertyId, ea.branchId);
  const { userId: newOwnerId } = await signUp(`reconnect-ho-new-${stamp}@keynetic-test.dev`);
  await admin.rpc("_establish_operational_homeowner_core", {
    p_property_id: f6.propertyId,
    p_homeowner_user_id: newOwnerId,
    p_granted_via: "claim_operational_property",
    p_sync_claim: true,
  });
  const r6 = await reconnect(ea.client, f6.propertyId, ea.branchId);
  record(
    "R6: seller side represented again -> refused",
    (await sellerSide(f6.propertyId)) !== "none" && r6?.ok === false && r6?.error === "not_reconnectable",
    JSON.stringify(r6)
  );
  record(
    "R6: the RPC re-checks independently — a row the lookup offered earlier is refused once it is no longer eligible",
    f6OfferedBefore && r6?.ok === false,
    JSON.stringify({ f6OfferedBefore, r6 })
  );

  // R7: cascade, then a replacement branch was assigned (and later left).
  const f7 = await homeownerSale("f7", ea.branchId);
  await cascade(f7.userId, f7.propertyId);
  await admin.from("property_ea_assignments").insert({
    property_id: f7.propertyId,
    branch_id: otherEa.branchId,
    status: "revoked",
    homeowner_only_updates: false,
    assigned_by_user_id: otherEa.userId,
    revoked_at: new Date().toISOString(),
    revocation_reason: "branch_left",
  });
  const r7 = await reconnect(ea.client, f7.propertyId, ea.branchId);
  record(
    "R7: a replacement branch was assigned since -> refused",
    r7?.ok === false && r7?.error === "not_reconnectable",
    JSON.stringify(r7)
  );

  // R8: cascade, then the row is released.
  const f8 = await homeownerSale("f8", ea.branchId);
  await cascade(f8.userId, f8.propertyId);
  const f8Released = await transition(f8.propertyId, "released");
  const r8 = await reconnect(ea.client, f8.propertyId, ea.branchId);
  record(
    "R8: released row -> refused",
    f8Released && r8?.ok === false && r8?.error === "not_reconnectable",
    JSON.stringify({ f8Released, r8 })
  );

  // L2: none of the refused fixtures is offered by the lookup.
  const mainList = await lookup(ea.client);
  const offered = (propertyId: number) => listed(mainList, propertyId, ea.branchId);
  record(
    "L2: lookup offers none of branch_left (R2), homeowner_removed_ea (R3), represented (R6), replaced (R7), released (R8), or the reconnected row (R1)",
    mainList?.ok === true &&
      !offered(r2PropertyId) &&
      !offered(f3.propertyId) &&
      !offered(f6.propertyId) &&
      !offered(f7.propertyId) &&
      !offered(f8.propertyId) &&
      !offered(f1.propertyId),
    JSON.stringify(mainList)
  );

  // The remaining scenarios use their own branches so the reconnect rate
  // limit (10 per 15 minutes per user) on the main EA is not reached.

  // L3: archived row.
  const archEa = await setupEa("arch");
  const f10 = await homeownerSale("f10", archEa.branchId);
  await cascade(f10.userId, f10.propertyId);
  const f10Archived = await transition(f10.propertyId, "archived");
  const archList = await lookup(archEa.client);
  const l3 = await reconnect(archEa.client, f10.propertyId, archEa.branchId);
  record(
    "L3: archived row -> not offered and refused",
    f10Archived &&
      archList?.ok === true &&
      !listed(archList, f10.propertyId, archEa.branchId) &&
      l3?.ok === false &&
      l3?.error === "not_reconnectable",
    JSON.stringify({ f10Archived, archList, l3 })
  );

  // L4: buyer-side EA. The branch's assignment on P ended through the cascade,
  // but the branch acts for the sale S whose onward purchase is P.
  const buyerEa = await setupEa("buyer");
  const fP = await homeownerSale("fp", buyerEa.branchId);
  await cascade(fP.userId, fP.propertyId);
  const { data: pRow } = await admin.from("properties").select("chain_id").eq("id", fP.propertyId).single();
  const { data: sRow, error: sError } = await admin
    .from("properties")
    .insert({
      chain_id: pRow!.chain_id,
      chain_position: 0,
      address: `Reconnect linking sale ${stamp}`,
      postcode: "E4 4RC",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: buyerEa.userId,
      buyer_connected: false,
      seller_connected: false,
      is_searching: false,
      linked_property_id: fP.propertyId,
    })
    .select("id")
    .single();
  const { error: sAssignError } = await admin.from("property_ea_assignments").insert({
    property_id: sRow?.id,
    branch_id: buyerEa.branchId,
    status: "active",
    homeowner_only_updates: false,
    assigned_by_user_id: buyerEa.userId,
  });
  const buyerList = await lookup(buyerEa.client);
  const l4 = await reconnect(buyerEa.client, fP.propertyId, buyerEa.branchId);
  record(
    "L4: branch acting for the linking sale (buyer side) -> not offered and cannot reconnect as the seller-side EA",
    !sError &&
      !sAssignError &&
      (await sellerSide(fP.propertyId)) === "none" &&
      buyerList?.ok === true &&
      !listed(buyerList, fP.propertyId, buyerEa.branchId) &&
      l4?.ok === false &&
      l4?.error === "not_reconnectable",
    JSON.stringify({ sError: sError?.message, sAssignError: sAssignError?.message, buyerList, l4 })
  );

  // L5: a member who has left the branch.
  const teamEa = await setupEa("team");
  const { client: leaverClient, userId: leaverId } = await signUp(`reconnect-ea-leaver-${stamp}@keynetic-test.dev`);
  await admin.from("ea_branch_members").insert({ branch_id: teamEa.branchId, user_id: leaverId, role: "agent" });
  const f11 = await homeownerSale("f11", teamEa.branchId);
  await cascade(f11.userId, f11.propertyId);
  const leaverListBefore = await lookup(leaverClient);
  await admin.from("ea_branch_members").delete().eq("branch_id", teamEa.branchId).eq("user_id", leaverId);
  const leaverListAfter = await lookup(leaverClient);
  const l5 = await reconnect(leaverClient, f11.propertyId, teamEa.branchId);
  const f11After = await latestAssignment(f11.propertyId);
  record(
    "L5: a member who has left the branch -> not offered and refused (not_ea_branch_member); nothing changed",
    listed(leaverListBefore, f11.propertyId, teamEa.branchId) &&
      leaverListAfter?.ok === true &&
      !listed(leaverListAfter, f11.propertyId, teamEa.branchId) &&
      l5?.ok === false &&
      l5?.error === "not_ea_branch_member" &&
      f11After?.status === "revoked",
    JSON.stringify({ leaverListAfter, l5, f11After })
  );

  // L6: address / access code are not accepted by either function.
  const { error: l6Address } = await teamEa.client.rpc("reconnect_returning_ea_branch", {
    p_property_id: f11.propertyId,
    p_branch_id: teamEa.branchId,
    p_address: `Reconnect f11 ${stamp}`,
  });
  const { error: l6AccessCode } = await teamEa.client.rpc("reconnect_returning_ea_branch", {
    p_address: `Reconnect f11 ${stamp}`,
    p_postcode: "E2 2RC",
    p_access_code: "KN-ANY",
  });
  const { error: l6Lookup } = await teamEa.client.rpc("list_reconnectable_ea_properties", {
    p_address: `Reconnect f11 ${stamp}`,
    p_access_code: "KN-ANY",
  });
  const f11Still = await latestAssignment(f11.propertyId);
  record(
    "L6: address / postcode / access-code parameters are rejected by the reconnect RPC and the lookup",
    Boolean(l6Address) && Boolean(l6AccessCode) && Boolean(l6Lookup) && f11Still?.status === "revoked",
    JSON.stringify({ l6Address: l6Address?.code, l6AccessCode: l6AccessCode?.code, l6Lookup: l6Lookup?.code })
  );

  // L7: anonymous callers cannot use the lookup.
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: anonData, error: anonError } = await anonClient.rpc("list_reconnectable_ea_properties");
  record(
    "L7: anon cannot call the lookup",
    Boolean(anonError) && !anonData,
    JSON.stringify({ code: anonError?.code })
  );

  // L8: the remaining member of the branch reconnects via the lookup's row.
  const teamList = await lookup(teamEa.client);
  const l8 = await reconnect(teamEa.client, f11.propertyId, teamEa.branchId);
  record(
    "L8: the remaining branch member is offered the row and reconnects",
    listed(teamList, f11.propertyId, teamEa.branchId) && l8?.ok === true,
    JSON.stringify({ l8 })
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\nPassed: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
