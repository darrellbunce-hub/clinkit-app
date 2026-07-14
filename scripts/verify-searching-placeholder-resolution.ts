import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import {
  convertSearchingPlaceholder,
  resolveConvertibleSearchingPlaceholder,
  resolveConvertibleSearchingPlaceholderForChain,
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

function runSyncUnitTests() {
  const sale = {
    id: 1,
    linked_property_id: 2,
    stage: "property_listed",
    address: "10 Sale Street",
  };
  const purchase = {
    id: 2,
    linked_property_id: 3,
    stage: "offer_accepted",
    address: "20 Purchase Street",
  };
  const searching = {
    id: 3,
    linked_property_id: null,
    stage: "searching",
    address: null,
  };

  const multiHop = resolveConvertibleSearchingPlaceholder(
    [sale, purchase, searching],
    sale.id
  );
  assert(
    multiHop?.id === searching.id,
    "sync unit: multi-hop should resolve searching placeholder"
  );

  const directSale = {
    id: 10,
    linked_property_id: 11,
    stage: "property_listed",
    address: "1 Direct Sale",
  };
  const directSearch = {
    id: 11,
    linked_property_id: null,
    stage: "searching",
    address: null,
  };
  const direct = resolveConvertibleSearchingPlaceholder(
    [directSale, directSearch],
    directSale.id
  );
  assert(
    direct?.id === directSearch.id,
    "sync unit: direct link should resolve"
  );

  const orphanSale = {
    id: 20,
    linked_property_id: null,
    stage: "property_listed",
    address: "Orphan Sale",
  };
  const orphanSearch = {
    id: 21,
    linked_property_id: null,
    stage: "searching",
    address: null,
  };
  const orphan = resolveConvertibleSearchingPlaceholder(
    [orphanSale, orphanSearch],
    orphanSale.id
  );
  assert(
    orphan === null,
    "sync unit: orphan searching must not resolve"
  );

  console.log("Sync unit tests passed");
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

async function scenario(
  name: string,
  setup: (
    client: ReturnType<typeof createClient>,
    chainId: number,
    userId: string,
    stamp: number
  ) => Promise<{
    saleId: number;
    expectedPlaceholderId: number | null;
  }>
) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `spr-${stamp}@keynetic-test.dev`;
  const boot = createClient(url, anonKey);
  await boot.auth.signUp({ email, password });
  const client = await signIn(email);
  const userId = (await client.auth.getUser()).data.user!.id;
  const code = `KN-SPR-${stamp}`;
  const { data: chainResult } = await client.rpc(
    "create_chain_for_onboarding",
    {
      p_name: `SPR-${stamp}`,
      p_access_code: code,
    }
  );
  const chainId = chainResult.chain_id as number;
  const ids = await setup(client, chainId, userId, stamp);

  const { data: props } = await client
    .from("properties")
    .select(
      "id, chain_id, stage, address, postcode, linked_property_id, relationship_type"
    )
    .eq("chain_id", chainId);

  const sync = resolveConvertibleSearchingPlaceholder(
    props ?? [],
    ids.saleId
  );
  const asyncResult =
    await resolveConvertibleSearchingPlaceholderForChain(client, {
      chainId,
      salePropertyId: ids.saleId,
    });

  console.log(`\n=== ${name} ===`);
  console.log(
    JSON.stringify(
      {
        expected: ids.expectedPlaceholderId,
        sync: sync?.id ?? null,
        async: asyncResult?.id ?? null,
      },
      null,
      2
    )
  );

  assert(
    (sync?.id ?? null) === ids.expectedPlaceholderId,
    `${name}: sync resolver mismatch`
  );
  assert(
    (asyncResult?.id ?? null) === ids.expectedPlaceholderId,
    `${name}: async resolver mismatch`
  );
}

async function main() {
  runSyncUnitTests();

  await scenario("Sell only + Searching (direct link)", async (c, chainId, userId, stamp) => {
    const { data: sale } = await c
      .from("properties")
      .insert({
        chain_id: chainId,
        chain_position: 1,
        address: `Sale ${stamp}`,
        postcode: "S1 1AA",
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
    await c.rpc("establish_operational_homeowner", {
      p_property_id: sale!.id,
      p_granted_via: "start_move",
    });
    const { data: search } = await c
      .from("properties")
      .insert({
        chain_id: chainId,
        chain_position: 2,
        stage: "searching",
        address: null,
        postcode: null,
        relationship_type: "purchase",
        status: "pending_connection",
        created_by_user_id: userId,
        is_searching: true,
        buyer_connected: false,
        seller_connected: true,
      })
      .select("id")
      .single();
    await c.rpc("establish_operational_homeowner", {
      p_property_id: search!.id,
      p_granted_via: "start_move",
    });
    await c
      .from("properties")
      .update({ linked_property_id: search!.id })
      .eq("id", sale!.id);
    return {
      saleId: sale!.id,
      expectedPlaceholderId: search!.id,
    };
  });

  await scenario(
    "Sale → Purchase → Searching (multi-hop)",
    async (c, chainId, userId, stamp) => {
      const { data: sale } = await c
        .from("properties")
        .insert({
          chain_id: chainId,
          chain_position: 1,
          address: `Sale ${stamp}`,
          postcode: "S2 2BB",
          stage: "property_listed",
          status: "healthy",
          relationship_type: "sale",
          created_by_user_id: userId,
          buyer_connected: true,
          seller_connected: true,
          is_searching: false,
        })
        .select("id")
        .single();
      await c.rpc("establish_operational_homeowner", {
        p_property_id: sale!.id,
        p_granted_via: "start_move",
      });
      const { data: purchase } = await c
        .from("properties")
        .insert({
          chain_id: chainId,
          chain_position: 2,
          address: `Purchase ${stamp}`,
          postcode: "P2 2BB",
          stage: "offer_accepted",
          status: "healthy",
          relationship_type: "purchase",
          created_by_user_id: userId,
          buyer_connected: true,
          seller_connected: true,
          is_searching: false,
        })
        .select("id")
        .single();
      await c.rpc("establish_operational_homeowner", {
        p_property_id: purchase!.id,
        p_granted_via: "start_move",
      });
      const { data: search } = await c
        .from("properties")
        .insert({
          chain_id: chainId,
          chain_position: 3,
          stage: "searching",
          address: null,
          postcode: null,
          relationship_type: "purchase",
          status: "pending_connection",
          created_by_user_id: userId,
          is_searching: true,
          buyer_connected: false,
          seller_connected: true,
        })
        .select("id")
        .single();
      await c.rpc("establish_operational_homeowner", {
        p_property_id: search!.id,
        p_granted_via: "start_move",
      });
      await c
        .from("properties")
        .update({ linked_property_id: purchase!.id })
        .eq("id", sale!.id);
      await c
        .from("properties")
        .update({ linked_property_id: search!.id })
        .eq("id", purchase!.id);
      return {
        saleId: sale!.id,
        expectedPlaceholderId: search!.id,
      };
    }
  );

  await scenario("Orphan searching (no graph link)", async (c, chainId, userId, stamp) => {
    const { data: sale } = await c
      .from("properties")
      .insert({
        chain_id: chainId,
        chain_position: 1,
        address: `Sale ${stamp}`,
        postcode: "S3 3CC",
        stage: "property_listed",
        status: "pending_connection",
        relationship_type: "sale",
        created_by_user_id: userId,
        buyer_connected: false,
        seller_connected: true,
        is_searching: false,
        linked_property_id: null,
      })
      .select("id")
      .single();
    await c.rpc("establish_operational_homeowner", {
      p_property_id: sale!.id,
      p_granted_via: "start_move",
    });
    await c
      .from("properties")
      .insert({
        chain_id: chainId,
        chain_position: 2,
        stage: "searching",
        address: null,
        postcode: null,
        relationship_type: "purchase",
        status: "pending_connection",
        created_by_user_id: userId,
        is_searching: true,
        buyer_connected: false,
        seller_connected: true,
        linked_property_id: null,
      })
      .select("id")
      .single();
    return {
      saleId: sale!.id,
      expectedPlaceholderId: null,
    };
  });

  const convertStamp = Date.now();
  const convertEmail = `spr-convert-${convertStamp}@keynetic-test.dev`;
  const convertBoot = createClient(url, anonKey);
  await convertBoot.auth.signUp({ email: convertEmail, password });
  const convertClient = await signIn(convertEmail);
  const convertUserId = (await convertClient.auth.getUser()).data.user!.id;
  const convertCode = `KN-CONV-${convertStamp}`;
  const { data: convertChain } = await convertClient.rpc(
    "create_chain_for_onboarding",
    {
      p_name: `CONV-${convertStamp}`,
      p_access_code: convertCode,
    }
  );
  const convertChainId = convertChain.chain_id as number;
  const { data: convertSale } = await convertClient
    .from("properties")
    .insert({
      chain_id: convertChainId,
      chain_position: 1,
      address: `Convert Sale ${convertStamp}`,
      postcode: "V1 1VV",
      stage: "property_listed",
      status: "healthy",
      relationship_type: "sale",
      created_by_user_id: convertUserId,
      buyer_connected: true,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();
  await convertClient.rpc("establish_operational_homeowner", {
    p_property_id: convertSale!.id,
    p_granted_via: "start_move",
  });
  const { data: convertPurchase } = await convertClient
    .from("properties")
    .insert({
      chain_id: convertChainId,
      chain_position: 2,
      address: `Convert Purchase ${convertStamp}`,
      postcode: "V2 2VV",
      stage: "offer_accepted",
      status: "healthy",
      relationship_type: "purchase",
      created_by_user_id: convertUserId,
      buyer_connected: true,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();
  await convertClient.rpc("establish_operational_homeowner", {
    p_property_id: convertPurchase!.id,
    p_granted_via: "start_move",
  });
  const { data: convertSearch } = await convertClient
    .from("properties")
    .insert({
      chain_id: convertChainId,
      chain_position: 3,
      stage: "searching",
      address: null,
      postcode: null,
      relationship_type: "purchase",
      status: "pending_connection",
      created_by_user_id: convertUserId,
      is_searching: true,
      buyer_connected: false,
      seller_connected: true,
    })
    .select("id")
    .single();
  await convertClient.rpc("establish_operational_homeowner", {
    p_property_id: convertSearch!.id,
    p_granted_via: "start_move",
  });
  await convertClient
    .from("properties")
    .update({ linked_property_id: convertPurchase!.id })
    .eq("id", convertSale!.id);
  await convertClient
    .from("properties")
    .update({ linked_property_id: convertSearch!.id })
    .eq("id", convertPurchase!.id);

  const convertResult = await convertSearchingPlaceholder(
    convertClient,
    {
      chainId: convertChainId,
      salePropertyId: convertSale!.id,
      address: `Converted ${convertStamp}`,
      postcode: "V9 9VV",
    }
  );
  assert(convertResult.ok, "multi-hop convert should succeed");
  const afterConvert =
    await resolveConvertibleSearchingPlaceholderForChain(
      convertClient,
      {
        chainId: convertChainId,
        salePropertyId: convertSale!.id,
      }
    );
  assert(
    afterConvert === null,
    "placeholder should be consumed after convert"
  );
  console.log("\n=== Multi-hop convert ===");
  console.log(
    JSON.stringify(
      {
        convertedPropertyId: convertResult.ok
          ? convertResult.propertyId
          : null,
        afterConvert,
      },
      null,
      2
    )
  );

  console.log("\n=== ALL SEARCHING PLACEHOLDER RESOLUTION CHECKS PASSED ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
