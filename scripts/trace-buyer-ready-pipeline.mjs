/**
 * Full pipeline trace: Sell + Searching chain → buyer joins sale + nothingToSell
 * Mirrors user-reported scenario. Read-only investigation — no app changes.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const BUYER_READY_DEFAULT_STAGE = "mortgage_preparation";

function log(step, data) {
  console.log(`\n--- STEP ${step} ---`);
  console.log(JSON.stringify(data, null, 2));
}

async function ensureBuyerReadyOnJoin(supabase, params) {
  log("5a ensureBuyerReadyOnJoin INPUT", params);

  const { data: existingForProperty, error: lookupError } = await supabase
    .from("chain_nodes")
    .select("id")
    .eq("chain_id", params.chainId)
    .eq("node_type", "buyer_ready")
    .eq("linked_property_id", params.purchasePropertyId)
    .maybeSingle();

  log("5b existingForProperty lookup", {
    existingForProperty,
    lookupError: lookupError?.message ?? null,
  });
  if (lookupError) return { ok: false, error: lookupError, step: "lookup_property" };
  if (existingForProperty) {
    return {
      ok: true,
      created: false,
      skip: "existingForProperty",
      existingId: existingForProperty.id,
    };
  }

  const { data: existingForUser, error: userLookupError } = await supabase
    .from("chain_nodes")
    .select("id, linked_property_id")
    .eq("chain_id", params.chainId)
    .eq("node_type", "buyer_ready")
    .eq("user_id", params.userId)
    .maybeSingle();

  log("5c existingForUser lookup", {
    existingForUser,
    userLookupError: userLookupError?.message ?? null,
  });
  if (userLookupError) return { ok: false, error: userLookupError, step: "lookup_user" };
  if (existingForUser) {
    return {
      ok: true,
      created: false,
      skip: "existingForUser",
      existingId: existingForUser.id,
      existingLinkedPropertyId: existingForUser.linked_property_id,
    };
  }

  const insertPayload = {
    chain_id: params.chainId,
    linked_property_id: params.purchasePropertyId,
    node_type: "buyer_ready",
    user_id: params.userId,
    position: 0,
    stage: BUYER_READY_DEFAULT_STAGE,
    status: "healthy",
    progress: 10,
  };

  log("5d INSERT payload", insertPayload);

  const { data: inserted, error: insertError } = await supabase
    .from("chain_nodes")
    .insert(insertPayload)
    .select("id")
    .single();

  log("5e INSERT result", {
    inserted,
    insertError: insertError?.message ?? null,
    insertErrorCode: insertError?.code ?? null,
    insertErrorDetails: insertError?.details ?? null,
  });

  if (insertError || !inserted) {
    return { ok: false, error: insertError, step: "insert" };
  }

  return { ok: true, created: true, nodeId: inserted.id };
}

function pickOperationalSaleId(properties) {
  const sellerHops = properties.filter(
    (p) => p.current_user_role === "seller" && p.is_own_property
  );
  const saleType = sellerHops.filter((p) => p.relationship_type === "sale");
  const pool = saleType.length ? saleType : sellerHops;
  if (!pool.length) return null;
  return [...pool].sort(
    (a, b) => (b.chain_position ?? 0) - (a.chain_position ?? 0)
  )[0].id;
}

function findBuyerReadySummaryForAnchor(summaries, anchorId) {
  if (anchorId == null) return null;
  return (
    summaries.find((s) => s.linked_property_id === anchorId) ?? null
  );
}

function resolveUpstreamPurchaserState({
  operationalSalePropertyId,
  chainProperties,
  buyerReadyForAnchor,
}) {
  if (operationalSalePropertyId == null) return { result: null, reason: "no_operational_sale" };

  const anchor = chainProperties.find((p) => p.id === operationalSalePropertyId);
  if (!anchor) return { result: null, reason: "anchor_not_in_properties" };

  if (!anchor.buyer_connected) {
    return { result: { kind: "awaiting_buyer" }, reason: "buyer_not_connected" };
  }

  if (
    buyerReadyForAnchor &&
    buyerReadyForAnchor.linked_property_id === operationalSalePropertyId
  ) {
    return { result: { kind: "buyer_ready" }, reason: "matched" };
  }

  return {
    result: null,
    reason: buyerReadyForAnchor
      ? "linked_property_id_mismatch"
      : "no_buyer_ready_for_anchor",
    buyerReadyForAnchorLinkedId: buyerReadyForAnchor?.linked_property_id ?? null,
  };
}

async function signIn(email, password) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function main() {
  const stamp = Date.now();
  const sellerEmail = `trace-seller-${stamp}@keynetic-test.dev`;
  const buyerEmail = `trace-buyer-${stamp}@keynetic-test.dev`;
  const password = "TraceBuyerReady123!";

  const boot = createClient(url, anonKey);
  for (const email of [sellerEmail, buyerEmail]) {
    await boot.auth.signUp({ email, password });
  }

  // STEP 0: Seller creates Sell + Searching chain (matches Awaiting Buyer → Your Sale → Next Home Search)
  const seller = await signIn(sellerEmail, password);
  const sellerId = (await seller.auth.getUser()).data.user.id;

  const accessCode = `KN-TRACE-${stamp.toString(36).toUpperCase()}`;
  const { data: chainResult } = await seller.rpc("create_chain_for_onboarding", {
    p_name: `TRACE-${stamp}`,
    p_access_code: accessCode,
  });
  const chainId = chainResult.chain_id;

  const saleAddress = `Trace Sale ${stamp}`;
  const salePostcode = "TS1 1AA";

  const { data: saleProperty } = await seller
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 1,
      address: saleAddress,
      postcode: salePostcode,
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

  await seller.rpc("ensure_property_membership", {
    p_property_id: saleProperty.id,
    p_role: "seller",
  });

  const { data: searching } = await seller
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 2,
      stage: "searching",
      address: null,
      postcode: null,
      relationship_type: "purchase",
      status: "pending_connection",
      created_by_user_id: sellerId,
      linked_property_id: null,
      buyer_connected: false,
      seller_connected: true,
      is_searching: true,
    })
    .select("id")
    .single();

  await seller.rpc("ensure_property_membership", {
    p_property_id: searching.id,
    p_role: "buyer",
  });

  await seller
    .from("properties")
    .update({ linked_property_id: searching.id })
    .eq("id", saleProperty.id);

  log("0 Seller chain created", {
    chainId,
    accessCode,
    salePropertyId: saleProperty.id,
    searchingId: searching.id,
    topology: "sale → searching",
  });

  // STEP 1-2: Buyer join chain page equivalent
  const buyer = await signIn(buyerEmail, password);
  const buyerId = (await buyer.auth.getUser()).data.user.id;
  const nothingToSell = true;

  log("1 Join inputs", {
    accessCode,
    address: saleAddress,
    postcode: salePostcode,
    nothingToSell,
    buyerUserId: buyerId,
  });

  const { data: joinResult, error: joinError } = await buyer.rpc(
    "join_chain_property",
    {
      p_access_code: accessCode,
      p_address: saleAddress,
      p_postcode: salePostcode,
    }
  );

  log("2 join_chain_property OUTPUT", {
    joinResult,
    joinError: joinError?.message ?? null,
    success: !joinError && joinResult?.ok,
  });

  if (joinError || !joinResult?.ok) {
    console.error("Join failed — aborting trace");
    process.exit(1);
  }

  const property = {
    id: joinResult.property_id,
    chain_id: joinResult.chain_id,
    relationship_type: joinResult.relationship_type,
    joining_role: joinResult.joining_role,
  };

  log("3 Guard check for ensureBuyerReadyOnJoin", {
    joining_role: joinResult.joining_role,
    nothingToSell,
    willCallEnsure:
      joinResult.joining_role === "buyer" && nothingToSell,
  });

  let buyerReadyResult = null;
  if (joinResult.joining_role === "buyer" && nothingToSell) {
    buyerReadyResult = await ensureBuyerReadyOnJoin(buyer, {
      chainId: property.chain_id,
      purchasePropertyId: property.id,
      userId: buyerId,
    });
    log("5 ensureBuyerReadyOnJoin OUTPUT", buyerReadyResult);
  } else {
    log("5 SKIPPED", { reason: "guard failed" });
  }

  // STEP 6: chain_nodes after insert (buyer session)
  const { data: nodesBuyer, error: nodesBuyerError } = await buyer
    .from("chain_nodes")
    .select("id, chain_id, node_type, linked_property_id, user_id, stage, position")
    .eq("chain_id", chainId)
    .eq("node_type", "buyer_ready");

  log("6 chain_nodes (buyer session)", {
    nodes: nodesBuyer,
    error: nodesBuyerError?.message ?? null,
  });

  // STEP 7: chain_nodes_chain_summary (seller session — chain page viewer)
  const seller2 = await signIn(sellerEmail, password);
  const { data: summaries, error: summariesError } = await seller2
    .from("chain_nodes_chain_summary")
    .select("*")
    .eq("chain_id", chainId)
    .eq("node_type", "buyer_ready")
    .order("position");

  log("7 chain_nodes_chain_summary (seller)", {
    summaries,
    error: summariesError?.message ?? null,
  });

  const { data: sellerProperties } = await seller2
    .from("chain_properties_participant")
    .select("id, relationship_type, chain_position, buyer_connected, current_user_role, is_own_property")
    .eq("chain_id", chainId)
    .order("chain_position");

  const operationalSalePropertyId = pickOperationalSaleId(sellerProperties ?? []);
  const buyerReadyForAnchor = findBuyerReadySummaryForAnchor(
    summaries ?? [],
    operationalSalePropertyId
  );
  const resolver = resolveUpstreamPurchaserState({
    operationalSalePropertyId,
    chainProperties: (sellerProperties ?? []).map((p) => ({
      id: p.id,
      buyer_connected: p.buyer_connected,
    })),
    buyerReadyForAnchor,
  });

  log("8 Anchor matching + resolver (seller chain page)", {
    operationalSalePropertyId,
    joinedPropertyId: property.id,
    salePropertyIdAtCreate: saleProperty.id,
    idsMatchStrict: property.id === operationalSalePropertyId,
    idsMatchNumber: Number(property.id) === Number(operationalSalePropertyId),
    buyerReadyForAnchor: buyerReadyForAnchor
      ? {
          id: buyerReadyForAnchor.id,
          linked_property_id: buyerReadyForAnchor.linked_property_id,
        }
      : null,
    anchorStrictMatch:
      buyerReadyForAnchor?.linked_property_id === operationalSalePropertyId,
    anchorNumberMatch:
      Number(buyerReadyForAnchor?.linked_property_id) ===
      Number(operationalSalePropertyId),
    resolver,
  });

  // Also test Sell + Buy + Searching (user said "Sell + Buy")
  console.log("\n\n========== VARIANT: Sell + Buy + Searching ==========\n");

  const stamp2 = Date.now();
  const seller2Email = `trace2-seller-${stamp2}@keynetic-test.dev`;
  const buyer2Email = `trace2-buyer-${stamp2}@keynetic-test.dev`;
  const boot2 = createClient(url, anonKey);
  await boot2.auth.signUp({ email: seller2Email, password });
  await boot2.auth.signUp({ email: buyer2Email, password });

  const sellerB2 = await signIn(seller2Email, password);
  const sellerBId = (await sellerB2.auth.getUser()).data.user.id;
  const code2 = `KN-T2-${stamp2.toString(36).toUpperCase()}`;
  const { data: c2 } = await sellerB2.rpc("create_chain_for_onboarding", {
    p_name: `T2-${stamp2}`,
    p_access_code: code2,
  });
  const chain2 = c2.chain_id;
  const saleAddr2 = `T2 Sale ${stamp2}`;
  const buyAddr2 = `T2 Buy ${stamp2}`;

  const { data: sale2 } = await sellerB2
    .from("properties")
    .insert({
      chain_id: chain2,
      chain_position: 1,
      address: saleAddr2,
      postcode: "TS2 2BB",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: sellerBId,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
    })
    .select("id")
    .single();
  await sellerB2.rpc("ensure_property_membership", {
    p_property_id: sale2.id,
    p_role: "seller",
  });

  const { data: purchase2 } = await sellerB2
    .from("properties")
    .insert({
      chain_id: chain2,
      chain_position: 2,
      address: buyAddr2,
      postcode: "TS2 2BB",
      stage: "offer_accepted",
      status: "pending_connection",
      relationship_type: "purchase",
      created_by_user_id: sellerBId,
      buyer_connected: true,
      seller_connected: false,
      is_searching: false,
    })
    .select("id")
    .single();
  await sellerB2.rpc("ensure_property_membership", {
    p_property_id: purchase2.id,
    p_role: "buyer",
  });

  const { data: search2 } = await sellerB2
    .from("properties")
    .insert({
      chain_id: chain2,
      chain_position: 3,
      stage: "searching",
      address: null,
      relationship_type: "purchase",
      status: "pending_connection",
      created_by_user_id: sellerBId,
      is_searching: true,
      buyer_connected: false,
      seller_connected: true,
    })
    .select("id")
    .single();
  await sellerB2.rpc("ensure_property_membership", {
    p_property_id: search2.id,
    p_role: "buyer",
  });
  await sellerB2
    .from("properties")
    .update({ linked_property_id: search2.id })
    .eq("id", sale2.id);

  const buyerB = await signIn(buyer2Email, password);
  const buyerBId = (await buyerB.auth.getUser()).data.user.id;
  const { data: jr2 } = await buyerB.rpc("join_chain_property", {
    p_access_code: code2,
    p_address: saleAddr2,
    p_postcode: "TS2 2BB",
  });

  const br2 = await ensureBuyerReadyOnJoin(buyerB, {
    chainId: jr2.chain_id,
    purchasePropertyId: jr2.property_id,
    userId: buyerBId,
  });

  const sellerB3 = await signIn(seller2Email, password);
  const { data: sum2 } = await sellerB3
    .from("chain_nodes_chain_summary")
    .select("*")
    .eq("chain_id", chain2)
    .eq("node_type", "buyer_ready");
  const { data: props2 } = await sellerB3
    .from("chain_properties_participant")
    .select("id, relationship_type, chain_position, buyer_connected, current_user_role, is_own_property")
    .eq("chain_id", chain2)
    .order("chain_position");
  const opSale2 = pickOperationalSaleId(props2 ?? []);
  const anchor2 = findBuyerReadySummaryForAnchor(sum2 ?? [], opSale2);
  const res2 = resolveUpstreamPurchaserState({
    operationalSalePropertyId: opSale2,
    chainProperties: (props2 ?? []).map((p) => ({
      id: p.id,
      buyer_connected: p.buyer_connected,
    })),
    buyerReadyForAnchor: anchor2,
  });

  log("VARIANT Sell+Buy+Searching", {
    joinResult: jr2,
    ensureResult: br2,
    summaries: sum2,
    operationalSalePropertyId: opSale2,
    joinedPropertyId: jr2.property_id,
    resolver: res2,
  });

  console.log("\n=== PIPELINE VERDICT ===");
  const pipelineOk =
    buyerReadyResult?.ok &&
    buyerReadyResult?.created &&
    (summaries ?? []).length > 0 &&
    resolver.result?.kind === "buyer_ready";

  console.log(
    pipelineOk
      ? "Sell+Searching E2E: ALL STEPS SUCCEEDED — code path works on fresh chain"
      : "Sell+Searching E2E: FAILURE DETECTED — see step logs above"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
