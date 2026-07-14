/**
 * P0 operational identity enforcement regression + malicious scenario checks.
 *
 * Requires migrations:
 *   20260714140000_property_operational_identity_foundation.sql
 *   20260714150000_operational_identity_enforcement.sql
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

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

async function signUpAndIn(email: string) {
  const boot = createClient(url, anonKey);
  await boot.auth.signUp({ email, password });
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const userId = (await client.auth.getUser()).data.user!.id;
  await client.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "HO Test",
    onboarding_completed_at: new Date().toISOString(),
  });
  return { client, userId };
}

async function createChain(client: SupabaseClient, stamp: number) {
  const { data, error } = await client.rpc("create_chain_for_onboarding", {
    p_name: `Enforce-${stamp}`,
    p_access_code: `KN-ENF-${stamp}`,
  });
  if (error || !data?.chain_id) {
    throw error ?? new Error("chain create failed");
  }
  return { id: data.chain_id as number, access_code: `KN-ENF-${stamp}` };
}

async function createSale(
  client: SupabaseClient,
  chainId: number,
  userId: string,
  stamp: number
) {
  const { data, error } = await client
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 1,
      address: `Enforce Sale ${stamp}`,
      postcode: "E1 1EN",
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
  if (error || !data) throw error ?? new Error("sale create failed");
  return data.id as number;
}

async function main() {
  const stamp = Date.now();
  const ho1Email = `enforce-ho1-${stamp}@keynetic-test.dev`;
  const ho2Email = `enforce-ho2-${stamp}@keynetic-test.dev`;

  const { client: ho1, userId: ho1Id } = await signUpAndIn(ho1Email);
  const { client: ho2 } = await signUpAndIn(ho2Email);

  const chain = await createChain(ho1, stamp);
  const saleId = await createSale(ho1, chain.id, ho1Id, stamp);

  // --- establish operational homeowner (start move) ---
  const { data: grant1, error: grant1Err } = await ho1.rpc(
    "establish_operational_homeowner",
    { p_property_id: saleId, p_granted_via: "start_move" }
  );
  record(
    "establish_operational_homeowner (start_move)",
    !grant1Err && grant1?.ok === true,
    grant1Err?.message ?? grant1?.error
  );

  const { data: idempotent } = await ho1.rpc("establish_operational_homeowner", {
    p_property_id: saleId,
    p_granted_via: "start_move",
  });
  record(
    "establish idempotent (same user)",
    idempotent?.ok === true && idempotent?.idempotent === true,
    idempotent?.error
  );

  const { data: secondHo } = await ho2.rpc("establish_operational_homeowner", {
    p_property_id: saleId,
    p_granted_via: "start_move",
  });
  record(
    "malicious: second homeowner blocked",
    secondHo?.ok === false && secondHo?.error === "operational_homeowner_exists",
    JSON.stringify(secondHo)
  );

  // --- ensure_property_membership revoked ---
  const { error: ensureErr } = await ho2.rpc("ensure_property_membership", {
    p_property_id: saleId,
    p_role: "seller",
  });
  record(
    "malicious: ensure_property_membership revoked",
    Boolean(ensureErr?.message?.includes("deprecated_use_establish_operational_homeowner")),
    ensureErr?.message
  );

  // --- direct INSERT blocked ---
  const { error: insertErr } = await ho2.from("property_members").insert({
    property_id: saleId,
    user_id: (await ho2.auth.getUser()).data.user!.id,
    role: "seller",
  });
  record(
    "malicious: direct property_members INSERT blocked",
    Boolean(insertErr),
    insertErr?.message
  );

  // --- counterparty without homeowner ---
  const { client: ho3, userId: ho3Id } = await signUpAndIn(
    `enforce-ho3-${stamp}@keynetic-test.dev`
  );
  const chain2 = await createChain(ho3, stamp + 1);
  const orphanSaleId = await createSale(ho3, chain2.id, ho3Id, stamp + 1);
  const { data: orphanGrant } = await ho3.rpc("grant_counterparty_participation", {
    p_property_id: orphanSaleId,
  });
  record(
    "malicious: counterparty without homeowner blocked",
    orphanGrant?.ok === false && orphanGrant?.error === "no_operational_homeowner",
    JSON.stringify(orphanGrant)
  );

  // --- join chain counterparty (happy path) ---
  const { data: joinGrant } = await ho2.rpc("grant_counterparty_participation", {
    p_property_id: saleId,
  });
  record(
    "grant_counterparty_participation (join chain)",
    joinGrant?.ok === true && joinGrant?.counterparty_role === "buyer",
    JSON.stringify(joinGrant)
  );

  record(
    "malicious: homeowner cannot be counterparty",
    (await ho1.rpc("grant_counterparty_participation", { p_property_id: saleId }))
      .data?.error === "homeowner_cannot_be_counterparty"
  );

  // --- get_property_operational_owner_user_id uses identity ---
  const { data: ownerId } = await ho1.rpc(
    "get_property_operational_owner_user_id",
    { p_property_id: saleId }
  );
  record(
    "get_property_operational_owner_user_id resolves identity",
    ownerId === ho1Id,
    `expected ${ho1Id}, got ${ownerId}`
  );

  // --- RPC existence ---
  const { error: delinkHoErr } = await ho1.rpc("delink_homeowner_from_property", {
    p_property_id: saleId,
    p_reason_code: "no_longer_moving",
  });
  record(
    "delink_homeowner_from_property callable",
    !delinkHoErr,
    delinkHoErr?.message
  );

  const failed = results.filter((r) => !r.pass);
  console.log("\n--- Regression report ---");
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.error("Failures:", failed);
    process.exit(1);
  }
  console.log("All operational identity enforcement checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
