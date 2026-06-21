/**
 * Read-only DB verification for Buyer Ready upstream purchaser gap.
 * Uses SUPABASE_SERVICE_ROLE_KEY from .env.local when present; otherwise exits with instructions.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY not set in .env.local — cannot run admin verification."
  );
  process.exit(2);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SELLER_USER_ID = "e77f8d7e-a6c4-444f-a659-c3b0e2b19f47";
const BUYER_USER_ID = "f1312436-0d34-4859-9254-ab307ae6bf8b";
const CHAIN_CANDIDATES = [186, 188, 189];

function pickOperationalSaleId(properties, sellerUserId) {
  const sellerHops = properties.filter((property) => {
    const members = property.property_members ?? [];
    return members.some(
      (member) =>
        member.user_id === sellerUserId && member.role === "seller"
    );
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

async function inspectChain(chainId) {
  const { data: properties, error: propertiesError } = await admin
    .from("properties")
    .select(
      "id, chain_id, chain_position, relationship_type, buyer_connected, seller_connected, address, property_members(user_id, role)"
    )
    .eq("chain_id", chainId)
    .order("chain_position");

  const { data: nodes, error: nodesError } = await admin
    .from("chain_nodes")
    .select(
      "id, chain_id, node_type, linked_property_id, user_id, stage, position, status, progress"
    )
    .eq("chain_id", chainId)
    .eq("node_type", "buyer_ready");

  return {
    chainId,
    propertiesError: propertiesError?.message ?? null,
    nodesError: nodesError?.message ?? null,
    properties: properties ?? [],
    buyerReadyNodes: nodes ?? [],
    operationalSalePropertyId: pickOperationalSaleId(
      properties ?? [],
      SELLER_USER_ID
    ),
  };
}

console.log("=== Buyer Ready DB verification ===\n");
console.log("Test accounts:");
console.log(`  Seller user_id: ${SELLER_USER_ID}`);
console.log(`  Buyer user_id:  ${BUYER_USER_ID}\n`);

for (const chainId of CHAIN_CANDIDATES) {
  const result = await inspectChain(chainId);

  console.log(`--- Chain ${chainId} ---`);

  if (result.propertiesError) {
    console.log("properties error:", result.propertiesError);
    continue;
  }

  if (result.properties.length === 0) {
    console.log("(no properties)\n");
    continue;
  }

  console.log("\nProperties:");
  for (const property of result.properties) {
    console.log(
      `  id=${property.id} type=${property.relationship_type} pos=${property.chain_position} buyer_connected=${property.buyer_connected} address=${property.address ?? "(null)"}`
    );
    for (const member of property.property_members ?? []) {
      console.log(`    member ${member.role}: ${member.user_id}`);
    }
  }

  console.log("\nbuyer_ready chain_nodes:");
  if (result.buyerReadyNodes.length === 0) {
    console.log("  (none)");
  } else {
    for (const node of result.buyerReadyNodes) {
      console.log(
        `  id=${node.id} linked_property_id=${node.linked_property_id} user_id=${node.user_id} stage=${node.stage} position=${node.position}`
      );
    }
  }

  const operationalSalePropertyId = result.operationalSalePropertyId;
  const buyerNode = result.buyerReadyNodes[0] ?? null;

  console.log("\nAnchor analysis:");
  console.log(`  operationalSalePropertyId (seller): ${operationalSalePropertyId}`);
  console.log(
    `  buyerReady.linked_property_id:       ${buyerNode?.linked_property_id ?? "(no row)"}`
  );

  if (operationalSalePropertyId != null && buyerNode?.linked_property_id != null) {
    const strict =
      buyerNode.linked_property_id === operationalSalePropertyId;
    const numeric =
      Number(buyerNode.linked_property_id) ===
      Number(operationalSalePropertyId);
    console.log(`  strict === match:  ${strict}`);
    console.log(`  Number() match:  ${numeric}`);
  }

  console.log("");
}

// Latest chains involving test users
const { data: recentMemberships } = await admin
  .from("property_members")
  .select("property_id, user_id, role, properties(chain_id, id, relationship_type)")
  .in("user_id", [SELLER_USER_ID, BUYER_USER_ID]);

const recentChainIds = [
  ...new Set(
    (recentMemberships ?? [])
      .map((row) => row.properties?.chain_id)
      .filter((id) => id != null)
  ),
].sort((a, b) => b - a);

console.log("=== Recent chains for test users ===");
console.log(recentChainIds.join(", ") || "(none)");

for (const chainId of recentChainIds.slice(0, 5)) {
  if (CHAIN_CANDIDATES.includes(chainId)) continue;
  const result = await inspectChain(chainId);
  if (result.properties.length === 0) continue;

  console.log(`\n--- Chain ${chainId} (from memberships) ---`);
  console.log(
    `properties: ${result.properties.length}, buyer_ready nodes: ${result.buyerReadyNodes.length}, operationalSalePropertyId: ${result.operationalSalePropertyId}`
  );
  for (const node of result.buyerReadyNodes) {
    console.log(
      `  buyer_ready id=${node.id} linked_property_id=${node.linked_property_id} user_id=${node.user_id}`
    );
  }
}
