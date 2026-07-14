/**
 * E2E + optional authenticated verification for Buyer Ready join gap.
 *
 * Modes:
 * 1. SELLER_EMAIL + SELLER_PASSWORD (+ optional CHAIN_ID) — inspect live chain as seller
 * 2. Otherwise — ephemeral seller/buyer flow with ensureBuyerReadyOnJoin
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
// ensureBuyerReadyOnJoin inlined for node E2E (mirrors lib/ensureBuyerReadyOnJoin.ts)
async function ensureBuyerReadyOnJoin(supabase, params) {
  const { data: existingForProperty, error: lookupError } = await supabase
    .from("chain_nodes")
    .select("id")
    .eq("chain_id", params.chainId)
    .eq("node_type", "buyer_ready")
    .eq("linked_property_id", params.purchasePropertyId)
    .maybeSingle();

  if (lookupError) return { ok: false, error: lookupError };
  if (existingForProperty) return { ok: true, created: false, skip: "existingForProperty" };

  const { data: existingForUser, error: userLookupError } = await supabase
    .from("chain_nodes")
    .select("id")
    .eq("chain_id", params.chainId)
    .eq("node_type", "buyer_ready")
    .eq("user_id", params.userId)
    .maybeSingle();

  if (userLookupError) return { ok: false, error: userLookupError };
  if (existingForUser) return { ok: true, created: false, skip: "existingForUser" };

  const { data: inserted, error: insertError } = await supabase
    .from("chain_nodes")
    .insert({
      chain_id: params.chainId,
      linked_property_id: params.purchasePropertyId,
      node_type: "buyer_ready",
      user_id: params.userId,
      position: 0,
      stage: "mortgage_preparation",
      status: "healthy",
      progress: 10,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return { ok: false, error: insertError ?? new Error("insert failed") };
  }

  return { ok: true, created: true, nodeId: inserted.id };
}

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SELLER_USER_ID = "e77f8d7e-a6c4-444f-a659-c3b0e2b19f47";
const BUYER_USER_ID = "f1312436-0d34-4859-9254-ab307ae6bf8b";
const TARGET_CHAIN_ID = Number(process.env.CHAIN_ID || "188");

function pickOperationalSaleId(properties, sellerUserId) {
  const sellerHops = properties.filter((property) => {
    const role =
      property.current_user_role ?? property.currentUserRole;
    const own =
      property.is_own_property ?? property.isOwnProperty;
    return role === "seller" && own;
  });

  const saleType = sellerHops.filter(
    (property) => property.relationship_type === "sale"
  );
  const pool = saleType.length > 0 ? saleType : sellerHops;
  if (pool.length === 0) return null;

  return [...pool].sort(
    (a, b) => (b.chain_position ?? 0) - (a.chain_position ?? 0)
  )[0].id;
}

async function signIn(email, password) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(`Sign in failed (${email}): ${error.message}`);
  return client;
}

async function inspectChain(client, chainId, label, sellerUserId) {
  console.log(`\n=== ${label} — chain ${chainId} ===\n`);

  const { data: nodes, error: nodesError } = await client
    .from("chain_nodes")
    .select(
      "id, chain_id, node_type, linked_property_id, user_id, stage, position"
    )
    .eq("chain_id", chainId)
    .eq("node_type", "buyer_ready");

  console.log("1. chain_nodes (buyer_ready):");
  if (nodesError) {
    console.log("   ERROR:", nodesError.message);
  } else if (!nodes?.length) {
    console.log("   (none)");
  } else {
    for (const node of nodes) {
      console.log(
        `   id=${node.id} chain_id=${node.chain_id} linked_property_id=${node.linked_property_id} user_id=${node.user_id} stage=${node.stage} position=${node.position}`
      );
    }
  }

  const { data: properties, error: propertiesError } = await client
    .from("chain_properties_participant")
    .select(
      "id, chain_id, relationship_type, chain_position, buyer_connected, current_user_role, is_own_property"
    )
    .eq("chain_id", chainId)
    .order("chain_position");

  console.log("\n2. properties (participant view):");
  if (propertiesError) {
    console.log("   ERROR:", propertiesError.message);
  } else {
    for (const property of properties ?? []) {
      console.log(
        `   id=${property.id} type=${property.relationship_type} pos=${property.chain_position} buyer_connected=${property.buyer_connected} role=${property.current_user_role} own=${property.is_own_property}`
      );
    }
  }

  const operationalSalePropertyId = pickOperationalSaleId(
    properties ?? [],
    sellerUserId
  );
  const buyerNode = nodes?.[0] ?? null;

  console.log("\n3. Anchor analysis:");
  console.log(`   operationalSalePropertyId: ${operationalSalePropertyId}`);
  console.log(
    `   buyerReady.linked_property_id: ${buyerNode?.linked_property_id ?? "(no row)"}`
  );

  if (operationalSalePropertyId != null && buyerNode?.linked_property_id != null) {
    const strict =
      buyerNode.linked_property_id === operationalSalePropertyId;
    const numeric =
      Number(buyerNode.linked_property_id) ===
      Number(operationalSalePropertyId);
    console.log(`   strict === match: ${strict}`);
    console.log(`   Number() match:  ${numeric}`);
  } else {
    console.log("   strict === match: n/a");
    console.log("   Number() match:  n/a");
  }

  const { data: summaries, error: summariesError } = await client
    .from("chain_nodes_chain_summary")
    .select("*")
    .eq("chain_id", chainId)
    .eq("node_type", "buyer_ready")
    .order("position");

  console.log("\n6. buyerReadySummaries (chain_nodes_chain_summary):");
  if (summariesError) {
    console.log("   ERROR:", summariesError.message);
  } else {
    console.log(JSON.stringify(summaries ?? [], null, 2));
  }

  let category = "A";
  if (nodes?.length) {
    category =
      buyerNode?.linked_property_id === operationalSalePropertyId ||
      Number(buyerNode?.linked_property_id) ===
        Number(operationalSalePropertyId)
        ? "C (unlikely — ids match)"
        : "B";
    if (
      summaries?.length &&
      operationalSalePropertyId != null &&
      !summaries.some(
        (summary) =>
          summary.linked_property_id === operationalSalePropertyId ||
          Number(summary.linked_property_id) ===
            Number(operationalSalePropertyId)
      )
    ) {
      category = "C";
    }
  }

  console.log(`\nFailure category: ${category}`);
  return { nodes, properties, operationalSalePropertyId, summaries, category };
}

async function runEphemeralE2E() {
  console.log("=== Ephemeral E2E (no live credentials) ===\n");

  const stamp = Date.now();
  const sellerEmail = `br-seller-${stamp}@keynetic-test.dev`;
  const buyerEmail = `br-buyer-${stamp}@keynetic-test.dev`;
  const password = "BuyerReadyTest123!";

  const bootstrap = createClient(url, anonKey);
  for (const email of [sellerEmail, buyerEmail]) {
    const { error } = await bootstrap.auth.signUp({ email, password });
    if (error && !error.message.includes("already registered")) {
      console.warn(`signUp ${email}:`, error.message);
    }
  }

  const seller = await signIn(sellerEmail, password);
  const buyer = await signIn(buyerEmail, password);
  const sellerId = (await seller.auth.getUser()).data.user.id;
  const buyerId = (await buyer.auth.getUser()).data.user.id;

  const accessCode = `KN-BR-${stamp.toString(36).toUpperCase()}`;
  const { data: chainResult, error: chainError } = await seller.rpc(
    "create_chain_for_onboarding",
    { p_name: `BR-${stamp}`, p_access_code: accessCode }
  );
  if (chainError || !chainResult?.ok) {
    throw new Error(`Chain create failed: ${chainError?.message}`);
  }
  const chainId = chainResult.chain_id;

  const saleAddress = `Sale ${stamp}`;
  const { data: saleProperty, error: saleError } = await seller
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 1,
      address: saleAddress,
      postcode: "AB1 2CD",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: sellerId,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();
  if (saleError) throw saleError;

  await seller.rpc("establish_operational_homeowner", {
    p_property_id: saleProperty.id,
    p_granted_via: "start_move",
  });

  const { data: joinResult, error: joinError } = await buyer.rpc(
    "join_chain_property",
    {
      p_access_code: accessCode,
      p_address: saleAddress,
      p_postcode: "AB1 2CD",
    }
  );
  if (joinError || !joinResult?.ok) {
    throw new Error(`Join failed: ${joinError?.message ?? joinResult?.error}`);
  }

  console.log("4. ensureBuyerReadyOnJoin() after buyer join + nothingToSell:");
  const buyerReadyResult = await ensureBuyerReadyOnJoin(buyer, {
    chainId: joinResult.chain_id,
    purchasePropertyId: joinResult.property_id,
    userId: buyerId,
  });
  console.log(JSON.stringify(buyerReadyResult, null, 2));

  if (buyerReadyResult.ok && !buyerReadyResult.created) {
    console.log(
      "\n5. Idempotency skip — re-run same params to identify rule:"
    );
    const { data: existingForProperty } = await buyer
      .from("chain_nodes")
      .select("id")
      .eq("chain_id", joinResult.chain_id)
      .eq("node_type", "buyer_ready")
      .eq("linked_property_id", joinResult.property_id)
      .maybeSingle();
    const { data: existingForUser } = await buyer
      .from("chain_nodes")
      .select("id, linked_property_id")
      .eq("chain_id", joinResult.chain_id)
      .eq("node_type", "buyer_ready")
      .eq("user_id", buyerId)
      .maybeSingle();
    console.log(
      `   existingForProperty (linked_property_id=${joinResult.property_id}):`,
      existingForProperty ? "HIT" : "miss"
    );
    console.log(
      `   existingForUser (user_id=${buyerId}):`,
      existingForUser ?? "miss"
    );
  }

  const sellerAfterJoin = await signIn(sellerEmail, password);
  await inspectChain(sellerAfterJoin, chainId, "Seller view (E2E)", sellerId);
}

async function main() {
  if (!url || !anonKey) {
    console.error("Missing Supabase env in .env.local");
    process.exit(1);
  }

  if (serviceKey) {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log("=== Admin verification (service role) ===");
    await inspectChain(
      admin,
      TARGET_CHAIN_ID,
      "Admin — test chain",
      SELLER_USER_ID
    );

    const { data: memberships } = await admin
      .from("property_members")
      .select("property_id, user_id, role, properties(chain_id)")
      .in("user_id", [SELLER_USER_ID, BUYER_USER_ID]);

    const chainIds = [
      ...new Set(
        (memberships ?? [])
          .map((row) => row.properties?.chain_id)
          .filter((id) => id != null)
      ),
    ].sort((a, b) => b - a);

    console.log("\nRecent chains for test users:", chainIds.join(", ") || "(none)");
    for (const chainId of chainIds.slice(0, 3)) {
      if (chainId === TARGET_CHAIN_ID) continue;
      await inspectChain(
        admin,
        chainId,
        `Admin — membership chain ${chainId}`,
        SELLER_USER_ID
      );
    }
    return;
  }

  const sellerEmail = process.env.SELLER_EMAIL;
  const sellerPassword = process.env.SELLER_PASSWORD;

  if (sellerEmail && sellerPassword) {
    console.log("=== Authenticated seller verification ===");
    const seller = await signIn(sellerEmail, sellerPassword);
    const userId = (await seller.auth.getUser()).data.user.id;
    console.log(`Signed in seller: ${userId}`);

    if (userId !== SELLER_USER_ID) {
      console.warn(
        `Warning: signed-in user ${userId} differs from test seller ${SELLER_USER_ID}`
      );
    }

    await inspectChain(
      seller,
      TARGET_CHAIN_ID,
      "Seller session — target chain",
      SELLER_USER_ID
    );

    const { data: participantChains } = await seller
      .from("chain_properties_participant")
      .select("chain_id")
      .order("chain_id", { ascending: false });

    const chainIds = [
      ...new Set((participantChains ?? []).map((row) => row.chain_id)),
    ];
    console.log("\nSeller participant chains:", chainIds.join(", ") || "(none)");
    return;
  }

  await runEphemeralE2E();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
