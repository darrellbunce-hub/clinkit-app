/**
 * Diagnoses EA-originated onward purchase convert via transaction-scoped RPC.
 * Requires migration 20260713120000_convert_searching_placeholder_for_sale.sql applied.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { finalizeOperationalSaleCreation } from "../lib/estateAgent/finalizeOperationalSaleCreation";
import { convertSearchingPlaceholder } from "../lib/searchingPlaceholder";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const password = "TraceBuyerReady123!";

async function signIn(email: string) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return client;
}

async function setupEa(email: string) {
  const client = await signIn(email);
  const userId = (await client.auth.getUser()).data.user!.id;

  await client.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "estate_agent",
    contact_name: "EA Test",
    email_domain: "keynetic-test.dev",
    onboarding_completed_at: new Date().toISOString(),
  });

  const { data: company } = await client
    .from("ea_companies")
    .insert({
      name: `Agency ${Date.now()}`,
      email_domain: "keynetic-test.dev",
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
      postcode: "E1 1EA",
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

  return { client, userId, branchId: branch!.id };
}

async function main() {
  const stamp = Date.now();
  const eaEmail = `ea-rpc-${stamp}@keynetic-test.dev`;
  const hoEmail = `ho-rpc-${stamp}@keynetic-test.dev`;

  const boot = createClient(url, anonKey);
  await boot.auth.signUp({ email: eaEmail, password });
  await boot.auth.signUp({ email: hoEmail, password });

  const { client: ea, userId: eaId, branchId } = await setupEa(eaEmail);
  const { data: chainRpc } = await ea.rpc("create_ea_operational_chain", {
    p_name: `RPC ${stamp}`,
    p_access_code: `KN-RPC-${stamp}`,
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
  if (!attach.ok) {
    throw new Error(`attach failed: ${attach.error}`);
  }

  const ho = await signIn(hoEmail);
  await ho.from("profiles").upsert({
    id: (await ho.auth.getUser()).data.user!.id,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "HO Test",
  });

  const claim = await ho.rpc("claim_operational_property", {
    p_property_id: saleId,
  });
  if (!claim.data?.ok) {
    throw new Error(`claim failed: ${JSON.stringify(claim.data)}`);
  }

  const convert = await convertSearchingPlaceholder(ho, {
    chainId,
    salePropertyId: saleId,
    address: `Converted ${stamp}`,
    postcode: "C1 1CC",
    updatedBy: "homeowner",
  });

  console.log(
    JSON.stringify(
      {
        saleId,
        placeholderId: attach.placeholderId,
        claim: claim.data,
        convert,
      },
      null,
      2
    )
  );

  if (!convert.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
