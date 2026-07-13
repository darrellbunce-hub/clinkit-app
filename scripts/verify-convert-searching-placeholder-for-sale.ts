/**
 * Verifies convert_searching_placeholder_for_sale across product scenarios A–E.
 * Requires migrations applied:
 *   20260713120000_convert_searching_placeholder_for_sale.sql
 *   20260713130000_fix_convert_rpc_delegated_editor_helper.sql
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { finalizeOperationalSaleCreation } from "../lib/estateAgent/finalizeOperationalSaleCreation";
import {
  attachSearchingPlaceholderToSale,
  convertSearchingPlaceholder,
} from "../lib/searchingPlaceholder";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const password = "TraceBuyerReady123!";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function signIn(email: string) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return client;
}

async function setupEa(email: string, stamp: number) {
  const client = await signIn(email);
  const userId = (await client.auth.getUser()).data.user!.id;
  const emailDomain = `keynetic-test-${stamp}.dev`;

  const { error: profileError } = await client.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "estate_agent",
    contact_name: "EA Test",
    email_domain: emailDomain,
    onboarding_completed_at: new Date().toISOString(),
  });
  if (profileError) {
    throw new Error(`EA profile setup failed: ${profileError.message}`);
  }

  const { data: company, error: companyError } = await client
    .from("ea_companies")
    .insert({
      name: `Agency ${stamp}`,
      email_domain: emailDomain,
      created_by_user_id: userId,
    })
    .select("id")
    .single();
  if (companyError || !company) {
    throw new Error(
      `EA company setup failed: ${companyError?.message ?? "no row returned"}`
    );
  }

  const { data: branch, error: branchError } = await client
    .from("ea_branches")
    .insert({
      company_id: company.id,
      name: "Main",
      town_or_city: "London",
      postcode: "E1 1EA",
      region_code: "UK-LONDON",
      is_head_office: true,
    })
    .select("id")
    .single();
  if (branchError || !branch) {
    throw new Error(
      `EA branch setup failed: ${branchError?.message ?? "no row returned"}`
    );
  }

  const { error: memberError } = await client.from("ea_branch_members").insert({
    branch_id: branch.id,
    user_id: userId,
    role: "branch_admin",
  });
  if (memberError) {
    throw new Error(`EA branch member setup failed: ${memberError.message}`);
  }

  return { client, userId, branchId: branch.id };
}

async function createEaSaleWithSearching(
  ea: ReturnType<typeof createClient>,
  eaId: string,
  branchId: string,
  hoEmail: string,
  stamp: number
) {
  const { data: chainRpc } = await ea.rpc("create_ea_operational_chain", {
    p_name: `EA Chain ${stamp}`,
    p_access_code: `KN-EA-${stamp}`,
  });
  const chainId = chainRpc.chain_id as number;

  const { data: saleRpc } = await ea.rpc("create_ea_operational_property", {
    p_chain_id: chainId,
    p_relationship_type: "sale",
    p_address: `EA Sale ${stamp}`,
    p_postcode: "E1 1EA",
    p_branch_id: branchId,
    p_homeowner_only_updates: false,
    p_invite_email: hoEmail,
    p_awaiting_buyer: false,
  });
  const saleId = saleRpc.property_id as number;

  const attach = await finalizeOperationalSaleCreation(ea, {
    chainId,
    salePropertyId: saleId,
    userId: eaId,
    endOfChain: false,
    refreshSummaries: false,
  });
  assert(attach.ok, `EA attach failed: ${!attach.ok ? attach.error : ""}`);

  return { chainId, saleId };
}

async function main() {
  // Scenario A: Homeowner sale → searching → convert
  const stampA = Date.now();
  const hoAEmail = `ho-a-${stampA}@keynetic-test.dev`;
  const bootA = createClient(url, anonKey);
  await bootA.auth.signUp({ email: hoAEmail, password });
  const hoA = await signIn(hoAEmail);
  const hoAId = (await hoA.auth.getUser()).data.user!.id;
  const { data: chainA } = await hoA.rpc("create_chain_for_onboarding", {
    p_name: `A-${stampA}`,
    p_access_code: `KN-A-${stampA}`,
  });
  const chainAId = chainA.chain_id as number;
  const { data: saleA } = await hoA
    .from("properties")
    .insert({
      chain_id: chainAId,
      chain_position: 1,
      address: `Sale A ${stampA}`,
      postcode: "A1 1AA",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: hoAId,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();
  await hoA.rpc("ensure_property_membership", {
    p_property_id: saleA!.id,
    p_role: "seller",
  });
  const attachA = await attachSearchingPlaceholderToSale(hoA, {
    chainId: chainAId,
    salePropertyId: saleA!.id,
    userId: hoAId,
  });
  assert(attachA.ok, "Scenario A attach failed");
  const convertA = await convertSearchingPlaceholder(hoA, {
    chainId: chainAId,
    salePropertyId: saleA!.id,
    address: `Converted A ${stampA}`,
    postcode: "A9 9AA",
  });
  console.log("Scenario A", convertA);
  assert(convertA.ok, "Scenario A convert failed");

  // Scenario B: EA sale → HO claims → HO converts (no placeholder membership)
  const stampB = Date.now() + 1;
  const eaBEmail = `ea-b-${stampB}@keynetic-test.dev`;
  const hoBEmail = `ho-b-${stampB}@keynetic-test.dev`;
  const bootB = createClient(url, anonKey);
  await bootB.auth.signUp({ email: eaBEmail, password });
  await bootB.auth.signUp({ email: hoBEmail, password });
  const { client: eaB, userId: eaBId, branchId: branchB } =
    await setupEa(eaBEmail, stampB);
  const { chainId: chainBId, saleId: saleBId } =
    await createEaSaleWithSearching(
      eaB,
      eaBId,
      branchB,
      hoBEmail,
      stampB
    );
  const hoB = await signIn(hoBEmail);
  const { error: hoBProfileError } = await hoB.from("profiles").upsert({
    id: (await hoB.auth.getUser()).data.user!.id,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "HO B",
  });
  if (hoBProfileError) {
    throw new Error(`Scenario B profile setup failed: ${hoBProfileError.message}`);
  }
  const claimB = await hoB.rpc("claim_operational_property", {
    p_property_id: saleBId,
    p_invitation_token: null,
  });
  assert(
    claimB.data?.ok,
    `Scenario B claim failed: data=${JSON.stringify(claimB.data)} error=${claimB.error?.message ?? "none"}`
  );
  const convertB = await convertSearchingPlaceholder(hoB, {
    chainId: chainBId,
    salePropertyId: saleBId,
    address: `Converted B ${stampB}`,
    postcode: "B9 9BB",
  });
  console.log("Scenario B", convertB);
  assert(convertB.ok, "Scenario B convert failed");

  // Scenario C: EA converts before claim
  const stampC = Date.now() + 2;
  const eaCEmail = `ea-c-${stampC}@keynetic-test.dev`;
  const hoCEmail = `ho-c-${stampC}@keynetic-test.dev`;
  const bootC = createClient(url, anonKey);
  await bootC.auth.signUp({ email: eaCEmail, password });
  await bootC.auth.signUp({ email: hoCEmail, password });
  const { client: eaC, userId: eaCId, branchId: branchC } =
    await setupEa(eaCEmail, stampC);
  const { chainId: chainCId, saleId: saleCId } =
    await createEaSaleWithSearching(
      eaC,
      eaCId,
      branchC,
      hoCEmail,
      stampC
    );
  const convertC = await convertSearchingPlaceholder(eaC, {
    chainId: chainCId,
    salePropertyId: saleCId,
    address: `Converted C ${stampC}`,
    postcode: "C9 9CC",
  });
  console.log("Scenario C", convertC);
  assert(convertC.ok, "Scenario C convert failed");

  // Scenario D: HO claims, delegation on, EA converts
  const stampD = Date.now() + 3;
  const eaDEmail = `ea-d-${stampD}@keynetic-test.dev`;
  const hoDEmail = `ho-d-${stampD}@keynetic-test.dev`;
  const bootD = createClient(url, anonKey);
  await bootD.auth.signUp({ email: eaDEmail, password });
  await bootD.auth.signUp({ email: hoDEmail, password });
  const { client: eaD, userId: eaDId, branchId: branchD } =
    await setupEa(eaDEmail, stampD);
  const createdD = await createEaSaleWithSearching(
    eaD,
    eaDId,
    branchD,
    hoDEmail,
    stampD
  );
  const hoD = await signIn(hoDEmail);
  await hoD.from("profiles").upsert({
    id: (await hoD.auth.getUser()).data.user!.id,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "HO D",
  });
  const claimD = await hoD.rpc("claim_operational_property", {
    p_property_id: createdD.saleId,
    p_invitation_token: null,
  });
  assert(claimD.data?.ok, "Scenario D claim failed");

  const convertD = await convertSearchingPlaceholder(eaD, {
    chainId: createdD.chainId,
    salePropertyId: createdD.saleId,
    address: `Converted D ${stampD}`,
    postcode: "D9 9DD",
  });
  console.log("Scenario D", convertD);
  assert(convertD.ok, "Scenario D convert failed");

  // Scenario E: homeowner_only_updates → EA blocked
  const stampE = Date.now() + 4;
  const eaEEmail = `ea-e-${stampE}@keynetic-test.dev`;
  const hoEEmail = `ho-e-${stampE}@keynetic-test.dev`;
  const bootE = createClient(url, anonKey);
  await bootE.auth.signUp({ email: eaEEmail, password });
  await bootE.auth.signUp({ email: hoEEmail, password });
  const { client: eaE, userId: eaEId, branchId: branchE } =
    await setupEa(eaEEmail, stampE);

  const { data: chainE } = await eaE.rpc("create_ea_operational_chain", {
    p_name: `E-${stampE}`,
    p_access_code: `KN-E-${stampE}`,
  });
  const chainEId = chainE.chain_id as number;
  const { data: saleE } = await eaE.rpc("create_ea_operational_property", {
    p_chain_id: chainEId,
    p_relationship_type: "sale",
    p_address: `Sale E ${stampE}`,
    p_postcode: "E1 1EE",
    p_branch_id: branchE,
    p_homeowner_only_updates: true,
    p_invite_email: hoEEmail,
    p_awaiting_buyer: false,
  });
  const saleEId = saleE.property_id as number;
  const attachE = await finalizeOperationalSaleCreation(eaE, {
    chainId: chainEId,
    salePropertyId: saleEId,
    userId: eaEId,
    endOfChain: false,
    refreshSummaries: false,
  });
  assert(attachE.ok, "Scenario E attach failed");

  const hoE = await signIn(hoEEmail);
  await hoE.from("profiles").upsert({
    id: (await hoE.auth.getUser()).data.user!.id,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "HO E",
  });
  const claimE = await hoE.rpc("claim_operational_property", {
    p_property_id: saleEId,
    p_invitation_token: null,
  });
  assert(claimE.data?.ok, "Scenario E claim failed");

  const convertE = await convertSearchingPlaceholder(eaE, {
    chainId: chainEId,
    salePropertyId: saleEId,
    address: `Converted E ${stampE}`,
    postcode: "E9 9EE",
  });
  console.log("Scenario E", convertE);
  assert(
    !convertE.ok && convertE.reason === "not_authorized",
    "Scenario E should block delegated EA"
  );

  console.log("\n=== ALL CONVERT RPC SCENARIOS PASSED ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
