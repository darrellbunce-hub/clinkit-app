/**
 * Part 3 connected-hop regression — P0.1 (RPC SQL) + P0.2 (topology).
 *
 * Scenario:
 *   User A sells 1 Cuckoo Lane and buys 10 Downing Street.
 *   User B sells Downing (counterparty on A's purchase) and has Next Home Search.
 *   After B joins, A's Cuckoo buyer_connected must stay false (Awaiting Buyer),
 *   and B's topology must include upstream Cuckoo without exposing its address.
 *
 * Usage:
 *   npx tsx scripts/verify-part3-connected-hop-topology.ts
 *
 * Offline only — does not mutate databases. Does not apply migrations.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  buildChainTopology,
  isRenderableTopologyProperty,
  isSearchingPlaceholder,
  type TopologyProperty,
} from "../lib/buildChainTopology";
import {
  resolveUpstreamPurchaserState,
  shouldRenderUpstreamPurchaserBeforeProperty,
} from "../lib/resolveUpstreamPurchaser";
import {
  getChainTileDisplayTitle,
  CHAIN_TILE_LABEL,
} from "../lib/operationalPosition";

function assert(name: string, condition: boolean) {
  if (!condition) {
    console.error("FAIL:", name);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function assertEqual<T>(name: string, actual: T, expected: T) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    console.error("FAIL:", name);
    console.error("  expected:", expectedJson);
    console.error("  actual:  ", actualJson);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function baseProperty(
  overrides: Partial<TopologyProperty> &
    Pick<TopologyProperty, "id" | "chainPosition" | "stage">
): TopologyProperty {
  return {
    status: "healthy",
    currentUserRole: null,
    lastUpdatedDays: 0,
    address: null,
    awaiting_buyer: false,
    is_searching: false,
    buyer_connected: false,
    seller_connected: true,
    relationship_type: null,
    linked_property_id: null,
    ...overrides,
  };
}

const CUCKOO_ADDRESS = "1 Cuckoo Lane, Fareham";
const DOWNING_ADDRESS =
  "Prime Minister & First Lord Of The Treasury, 10 Downing Street, London";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260831200000_establish_connected_hop_preserve_host_sale_buyer.sql"
);

// ---------------------------------------------------------------------------
// P0.1 — migration SQL must preserve host_sale.buyer_connected
// ---------------------------------------------------------------------------

const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

assert(
  "migration defines establish_connected_hop",
  /create or replace function public\.establish_connected_hop\s*\(\s*p_purchase_property_id\s+bigint\s*\)/i.test(
    migrationSql
  )
);

const hostSaleWhereIdx = migrationSql.search(
  /where id = v_host_sale\.id;/i
);
const hostSaleUpdateStart =
  hostSaleWhereIdx >= 0
    ? migrationSql.lastIndexOf(
        "update public.properties",
        hostSaleWhereIdx
      )
    : -1;
const hostSaleUpdateBlock =
  hostSaleUpdateStart >= 0 && hostSaleWhereIdx >= 0
    ? migrationSql.slice(hostSaleUpdateStart, hostSaleWhereIdx)
    : "";
const hostSaleSetClause =
  hostSaleUpdateBlock.match(/set\s+([\s\S]+)/i)?.[1] ?? "";

assert(
  "migration includes host_sale UPDATE",
  hostSaleUpdateStart >= 0 && hostSaleWhereIdx >= 0
);

assert(
  "host_sale UPDATE does not assign buyer_connected",
  !/\bbuyer_connected\b/i.test(hostSaleSetClause)
);

assert(
  "host_sale UPDATE still sets linked_property_id to purchase",
  /linked_property_id\s*=\s*v_purchase\.id/i.test(hostSaleSetClause)
);

assert(
  "host_sale UPDATE still sets seller_connected",
  /seller_connected\s*=\s*true/i.test(hostSaleSetClause)
);

assert(
  "host_sale UPDATE still sets status healthy",
  /status\s*=\s*'healthy'/i.test(hostSaleSetClause)
);

assert(
  "purchase UPDATE may still set buyer_connected (purchase hop only)",
  /where id = v_purchase\.id;/i.test(migrationSql) &&
    /buyer_connected\s*=\s*true/i.test(migrationSql)
);

assert(
  "migration does not alter join_chain_property",
  !/create or replace function public\.join_chain_property/i.test(
    migrationSql
  )
);

/**
 * Pure model of the host_sale flag semantics after establish_connected_hop.
 * Old bug flipped buyer_connected; fix preserves it.
 */
function applyHostSaleHopFlags(params: {
  hostSaleBuyerConnectedBefore: boolean;
  preserveBuyerConnected: boolean;
}): { buyer_connected: boolean; seller_connected: boolean } {
  return {
    seller_connected: true,
    buyer_connected: params.preserveBuyerConnected
      ? params.hostSaleBuyerConnectedBefore
      : true,
  };
}

assertEqual(
  "P0.1 semantics: preserved buyer_connected stays false",
  applyHostSaleHopFlags({
    hostSaleBuyerConnectedBefore: false,
    preserveBuyerConnected: true,
  }),
  { seller_connected: true, buyer_connected: false }
);

assertEqual(
  "P0.1 semantics: legacy bug would force buyer_connected true",
  applyHostSaleHopFlags({
    hostSaleBuyerConnectedBefore: false,
    preserveBuyerConnected: false,
  }),
  { seller_connected: true, buyer_connected: true }
);

// ---------------------------------------------------------------------------
// Part 3 scenario — User A after correct hop
// ---------------------------------------------------------------------------

const userACuckoo = baseProperty({
  id: 31,
  chainPosition: 1,
  stage: "offer_accepted",
  address: CUCKOO_ADDRESS,
  relationship_type: "sale",
  buyer_connected: false,
  seller_connected: true,
  linked_property_id: 32,
  currentUserRole: "seller",
});

const userADowning = baseProperty({
  id: 32,
  chainPosition: 2,
  stage: "offer_accepted",
  address: DOWNING_ADDRESS,
  relationship_type: "purchase",
  buyer_connected: true,
  seller_connected: true,
  linked_property_id: 33,
  currentUserRole: "buyer",
});

const userASearchingPeer = baseProperty({
  id: 33,
  chainPosition: 3,
  stage: "searching",
  address: null,
  relationship_type: "purchase",
  buyer_connected: false,
  seller_connected: true,
  linked_property_id: null,
  is_searching: true,
});

const userATopology = buildChainTopology(
  [userACuckoo, userADowning, userASearchingPeer],
  null
);

assertEqual(
  "User A topology walk order: Cuckoo → Downing → searching",
  userATopology.flatPropertyNodes.map((p) => p.id),
  [31, 32, 33]
);

const userAUpstream = resolveUpstreamPurchaserState({
  operationalSalePropertyId: 31,
  chainProperties: [
    { id: 31, buyer_connected: false },
    { id: 32, buyer_connected: true },
  ],
  buyerReadyForAnchor: null,
});

assertEqual(
  "User A still sees Awaiting Buyer for Cuckoo when buyer_connected false",
  userAUpstream,
  { kind: "awaiting_buyer", anchorPropertyId: 31 }
);

assert(
  "User A Awaiting Buyer renders before operational Cuckoo sale",
  shouldRenderUpstreamPurchaserBeforeProperty(
    userAUpstream,
    31,
    true
  )
);

assert(
  "If host sale buyer_connected were true, Awaiting Buyer would disappear",
  resolveUpstreamPurchaserState({
    operationalSalePropertyId: 31,
    chainProperties: [
      { id: 31, buyer_connected: true },
      { id: 32, buyer_connected: true },
    ],
    buyerReadyForAnchor: null,
  }) === null
);

// ---------------------------------------------------------------------------
// Fresh scenario — 2 Cuckoo / 69 Crofton (chain 692 shape)
// User A: sale Cuckoo + purchase Crofton
// User B: seller counterparty on Crofton + Next Home Search
// Both must see the same property-node topology; only labels/redaction differ.
// ---------------------------------------------------------------------------

const CUCKOO2 = "2 Cuckoo Lane, Fareham";
const CROFTON = "69 Crofton Lane, Fareham";

const userACuckoo2 = baseProperty({
  id: 34,
  chainPosition: 1,
  stage: "property_listed",
  address: CUCKOO2,
  relationship_type: "sale",
  buyer_connected: false,
  seller_connected: true,
  linked_property_id: 35,
  currentUserRole: "seller",
});

const userACrofton = baseProperty({
  id: 35,
  chainPosition: 2,
  stage: "offer_accepted",
  address: CROFTON,
  relationship_type: "purchase",
  buyer_connected: true,
  seller_connected: true,
  linked_property_id: 36,
  currentUserRole: "buyer",
});

const userANextHome = baseProperty({
  id: 36,
  chainPosition: 3,
  stage: "searching",
  address: null,
  relationship_type: "purchase",
  buyer_connected: false,
  seller_connected: true,
  linked_property_id: null,
  is_searching: true,
});

const userBUpstreamCuckooRedacted = baseProperty({
  id: 34,
  chainPosition: 1,
  stage: "property_listed",
  address: null,
  relationship_type: "sale",
  buyer_connected: false,
  seller_connected: true,
  linked_property_id: 35,
  currentUserRole: null,
});

const userBCroftonSale = baseProperty({
  id: 35,
  chainPosition: 2,
  stage: "offer_accepted",
  address: CROFTON,
  relationship_type: "purchase",
  buyer_connected: true,
  seller_connected: true,
  linked_property_id: 36,
  currentUserRole: "seller",
});

const userBNextHome = baseProperty({
  id: 36,
  chainPosition: 3,
  stage: "searching",
  address: null,
  relationship_type: "purchase",
  buyer_connected: false,
  seller_connected: true,
  linked_property_id: null,
  is_searching: true,
  currentUserRole: "buyer",
});

const topologyA = buildChainTopology(
  [userACuckoo2, userACrofton, userANextHome],
  null
);
const topologyB = buildChainTopology(
  [userBUpstreamCuckooRedacted, userBCroftonSale, userBNextHome],
  null
);

assertEqual(
  "User A topology: Cuckoo → Crofton → Next Home Search",
  topologyA.flatPropertyNodes.map((p) => p.id),
  [34, 35, 36]
);

assertEqual(
  "User B topology: same property nodes as User A (privacy-redacted upstream)",
  topologyB.flatPropertyNodes.map((p) => p.id),
  [34, 35, 36]
);

assertEqual(
  "Viewer-asymmetric address redaction must not change topology node set",
  topologyA.flatPropertyNodes.map((p) => p.id),
  topologyB.flatPropertyNodes.map((p) => p.id)
);

assert(
  "User B upstream Cuckoo remains address-null in topology",
  topologyB.flatPropertyNodes.find((p) => p.id === 34)?.address ===
    null
);

assert(
  "User B still has Next Home Search node",
  topologyB.flatPropertyNodes.some(
    (p) => p.id === 36 && isSearchingPlaceholder(p)
  )
);

assertEqual(
  "User A labels: Your Sale / Connected Purchase / Next Home Search",
  [
    getChainTileDisplayTitle(userACuckoo2, true),
    getChainTileDisplayTitle(userACrofton, false),
    getChainTileDisplayTitle(userANextHome, false),
  ],
  [
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.connectedPurchase,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ]
);

assertEqual(
  "User B labels: Connected Buyer / Your Sale / Next Home Search",
  [
    getChainTileDisplayTitle(userBUpstreamCuckooRedacted, false),
    getChainTileDisplayTitle(userBCroftonSale, true),
    getChainTileDisplayTitle(userBNextHome, false),
  ],
  [
    CHAIN_TILE_LABEL.connectedBuyer,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ]
);

assert(
  "User B rendered labels must not contain 2 Cuckoo Lane",
  ![
    getChainTileDisplayTitle(userBUpstreamCuckooRedacted, false),
    getChainTileDisplayTitle(userBCroftonSale, true),
    getChainTileDisplayTitle(userBNextHome, false),
  ].some((label) => label.includes("Cuckoo") || label.includes(CUCKOO2))
);

assertEqual(
  "User A still gets Awaiting Buyer for unresolved Cuckoo purchaser",
  resolveUpstreamPurchaserState({
    operationalSalePropertyId: 34,
    chainProperties: [
      { id: 34, buyer_connected: false },
      { id: 35, buyer_connected: true },
    ],
    buyerReadyForAnchor: null,
  }),
  { kind: "awaiting_buyer", anchorPropertyId: 34 }
);

// Truncation regression: if upstream were dropped, roots would start at 35.
const truncatedAsIfUpstreamDropped = buildChainTopology(
  [userBCroftonSale, userBNextHome],
  null
);
assertEqual(
  "Without upstream peer, walk wrongly starts at Crofton (documents truncation)",
  truncatedAsIfUpstreamDropped.flatPropertyNodes.map((p) => p.id),
  [35, 36]
);

assert(
  "address-null sale/purchase peers remain renderable regardless of address",
  isRenderableTopologyProperty(userBUpstreamCuckooRedacted) &&
    isRenderableTopologyProperty(userBNextHome)
);

if (process.exitCode && process.exitCode !== 0) {
  console.error("\nPart 3 connected-hop topology verification FAILED");
  process.exit(process.exitCode);
}

console.log("\nPart 3 connected-hop topology verification PASSED");
