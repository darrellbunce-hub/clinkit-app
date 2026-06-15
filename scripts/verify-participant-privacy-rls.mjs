/**
 * PR5 privacy verification — run after applying migrations through 20260610227000.
 *
 * Usage:
 *   node scripts/verify-participant-privacy-rls.mjs
 *
 * Optional env (.env.local):
 *   PRIVACY_TEST_USER_A_EMAIL / PRIVACY_TEST_USER_A_PASSWORD
 *   PRIVACY_TEST_USER_B_EMAIL / PRIVACY_TEST_USER_B_PASSWORD
 *
 * If omitted, creates two ephemeral homeowner accounts in a shared chain.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(".env.local", "utf8");
for (const line of envText.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].trim();
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(1);
}

const results = [];

function record(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`
  );
}

async function signIn(email, password) {
  const client = createClient(supabaseUrl, anonKey);
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(`Sign in failed for ${email}: ${error.message}`);
  }

  return client;
}

async function ensureTestUsers() {
  const stamp = Date.now();
  const emailA =
    process.env.PRIVACY_TEST_USER_A_EMAIL ||
    `privacy-a-${stamp}@keynetic-test.dev`;
  const emailB =
    process.env.PRIVACY_TEST_USER_B_EMAIL ||
    `privacy-b-${stamp}@keynetic-test.dev`;
  const password =
    process.env.PRIVACY_TEST_USER_A_PASSWORD ||
    process.env.PRIVACY_TEST_USER_B_PASSWORD ||
    "PrivacyTest123!";

  const admin = createClient(supabaseUrl, anonKey);

  for (const email of [emailA, emailB]) {
    const { error } = await admin.auth.signUp({ email, password });
    if (error && !error.message.includes("already registered")) {
      console.warn(`signUp ${email}:`, error.message);
    }
  }

  return { emailA, emailB, password };
}

async function createSharedChain(clientA) {
  const accessCode = `KN-PRIV-${Date.now().toString(36).toUpperCase()}`;

  const { data: chainResult, error: chainError } = await clientA.rpc(
    "create_chain_for_onboarding",
    {
      p_name: `PRIVACY-${Date.now()}`,
      p_access_code: accessCode,
    }
  );

  if (chainError) {
    throw new Error(`Chain create failed: ${chainError.message}`);
  }

  if (!chainResult?.ok || chainResult.chain_id == null) {
    throw new Error(
      `Chain create rejected: ${chainResult?.error ?? "unknown"}`
    );
  }

  const chainId = chainResult.chain_id;

  const userA = (await clientA.auth.getUser()).data.user.id;

  const { data: propertyA, error: propertyAError } = await clientA
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 1,
      address: `357 Jenni Place ${Date.now()}`,
      postcode: "ABCD",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: userA,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id, address")
    .single();

  if (propertyAError || !propertyA) {
    throw new Error(`Property A create failed: ${propertyAError?.message}`);
  }

  const { error: memberAError } = await clientA.rpc(
    "ensure_property_membership",
    {
      p_property_id: propertyA.id,
      p_role: "seller",
    }
  );

  if (memberAError) {
    throw new Error(`Member A failed: ${memberAError.message}`);
  }

  const { data: propertyB, error: propertyBError } = await clientA
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 2,
      address: `7777 Pickle Close ${Date.now()}`,
      postcode: "ABCD",
      stage: "offer_accepted",
      status: "pending_connection",
      relationship_type: "purchase",
      created_by_user_id: userA,
      buyer_connected: true,
      seller_connected: false,
      is_searching: false,
    })
    .select("id, address")
    .single();

  if (propertyBError || !propertyB) {
    throw new Error(`Property B create failed: ${propertyBError?.message}`);
  }

  return {
    chainId,
    accessCode,
    propertyA,
    propertyB,
    addressA: propertyA.address,
    addressB: propertyB.address,
  };
}

async function joinAsBuyer(clientB, accessCode, address, postcode) {
  const { data, error } = await clientB.rpc("join_chain_property", {
    p_access_code: accessCode,
    p_address: address,
    p_postcode: postcode,
  });

  if (error) {
    throw new Error(`join_chain_property failed: ${error.message}`);
  }

  if (!data?.ok) {
    throw new Error(`join_chain_property rejected: ${data?.error}`);
  }

  return data;
}

async function main() {
  console.log("PR5 Participant Privacy Verification\n");

  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: anonProperties, error: anonError } = await anonClient
    .from("properties")
    .select("address")
    .limit(1);

  record(
    "Anon cannot read properties base table",
    !!anonError || (anonProperties || []).length === 0,
    anonError?.message || `rows=${(anonProperties || []).length}`
  );

  const { emailA, emailB, password } = await ensureTestUsers();
  let clientA = await signIn(emailA, password);
  const setup = await createSharedChain(clientA);

  await joinAsBuyer(
    await signIn(emailB, password),
    setup.accessCode,
    setup.addressB,
    "ABCD"
  );

  clientA = await signIn(emailA, password);
  const clientB = await signIn(emailB, password);

  const { data: viewA, error: viewAError } = await clientA
    .from("chain_properties_participant")
    .select("id, address, postcode, is_own_property, chain_position")
    .eq("chain_id", setup.chainId)
    .order("chain_position");

  record(
    "Account A participant view loads",
    !viewAError && (viewA || []).length >= 2,
    viewAError?.message || `rows=${(viewA || []).length}`
  );

  const peerFromA = (viewA || []).find(
    (row) => row.address === setup.addressB
  );
  const ownFromA = (viewA || []).find(
    (row) => row.address === setup.addressA
  );

  record(
    "Account A cannot see Account B address in view",
    !peerFromA?.address,
    peerFromA?.address || "redacted"
  );
  record(
    "Account A sees own address in view",
    !!ownFromA?.address,
    ownFromA?.address || "missing"
  );

  const { data: viewB, error: viewBError } = await clientB
    .from("chain_properties_participant")
    .select("id, address, postcode, is_own_property, chain_position")
    .eq("chain_id", setup.chainId)
    .order("chain_position");

  record(
    "Account B participant view loads",
    !viewBError && (viewB || []).length >= 2,
    viewBError?.message || `rows=${(viewB || []).length}`
  );

  const peerFromB = (viewB || []).find(
    (row) => row.address === setup.addressA
  );
  const ownFromB = (viewB || []).find(
    (row) => row.address === setup.addressB
  );

  record(
    "Account B cannot see Account A address in view",
    !peerFromB?.address,
    peerFromB?.address || "redacted"
  );
  record(
    "Account B sees own address in view",
    !!ownFromB?.address,
    ownFromB?.address || "missing"
  );

  const { data: baseLeakA, error: baseLeakAError } = await clientA
    .from("properties")
    .select("address")
    .eq("id", setup.propertyB.id)
    .maybeSingle();

  record(
    "Account A cannot read peer property via base table",
    !!baseLeakAError || !baseLeakA?.address,
    baseLeakAError?.message || baseLeakA?.address || "no row"
  );

  const { data: existsCheck } = await clientA.rpc(
    "property_exists_for_onboarding",
    {
      p_address: setup.addressA,
      p_postcode: "ABCD",
    }
  );

  record(
    "property_exists_for_onboarding RPC works",
    existsCheck === true,
    String(existsCheck)
  );

  const { data: resolveJoin } = await clientB.rpc("resolve_chain_for_join", {
    p_access_code: setup.accessCode,
  });

  record(
    "resolve_chain_for_join RPC works",
    resolveJoin?.ok === true,
    JSON.stringify(resolveJoin)
  );

  const { data: summaries, error: summariesError } = await clientA
    .from("agent_branch_property_summaries")
    .select("address");

  record(
    "Homeowner agent summaries query does not error",
    !summariesError,
    summariesError?.message || `rows=${(summaries || []).length}`
  );

  const failed = results.filter((result) => !result.passed);

  console.log("\n--- Summary ---");
  console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
