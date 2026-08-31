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
  isPrivacyRedactedPeerProperty,
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
// Part 3 scenario — User B after join (privacy-redacted upstream Cuckoo)
// ---------------------------------------------------------------------------

const userBCuckooRedacted = baseProperty({
  id: 31,
  chainPosition: 1,
  stage: "offer_accepted",
  address: null,
  relationship_type: "sale",
  buyer_connected: false,
  seller_connected: true,
  linked_property_id: 32,
  currentUserRole: null,
});

const userBDowning = baseProperty({
  id: 32,
  chainPosition: 2,
  stage: "offer_accepted",
  address: DOWNING_ADDRESS,
  relationship_type: "purchase",
  buyer_connected: true,
  seller_connected: true,
  linked_property_id: 33,
  currentUserRole: "seller",
});

const userBSearching = baseProperty({
  id: 33,
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

assert(
  "redacted Cuckoo is classified as privacy-redacted peer",
  isPrivacyRedactedPeerProperty(userBCuckooRedacted)
);

assert(
  "redacted Cuckoo is renderable in topology",
  isRenderableTopologyProperty(userBCuckooRedacted)
);

assert(
  "searching placeholder is not classified as privacy-redacted peer",
  !isPrivacyRedactedPeerProperty(userBSearching) &&
    isSearchingPlaceholder(userBSearching)
);

const userBTopology = buildChainTopology(
  [userBCuckooRedacted, userBDowning, userBSearching],
  null
);

assertEqual(
  "User B topology contains upstream Cuckoo + Downing + Next Home Search",
  userBTopology.flatPropertyNodes.map((p) => p.id),
  [31, 32, 33]
);

const cuckooInBView = userBTopology.flatPropertyNodes.find(
  (p) => p.id === 31
);

assert(
  "User B topology retains Cuckoo without exposing address",
  cuckooInBView != null && cuckooInBView.address === null
);

assert(
  "User B still sees Next Home Search node",
  userBTopology.flatPropertyNodes.some(
    (p) => p.id === 33 && isSearchingPlaceholder(p)
  )
);

const cuckooTileTitle = getChainTileDisplayTitle(
  {
    relationship_type: "sale",
    stage: "offer_accepted",
    address: null,
    currentUserRole: null,
    isOwnProperty: false,
    chainPosition: 1,
  },
  false
);

assert(
  "redacted Cuckoo tile title does not leak real address",
  !cuckooTileTitle.includes("Cuckoo") &&
    !cuckooTileTitle.includes(CUCKOO_ADDRESS)
);

assert(
  "searching tile remains Next Home Search label",
  getChainTileDisplayTitle(
    {
      relationship_type: "purchase",
      stage: "searching",
      address: null,
      currentUserRole: "buyer",
      isOwnProperty: true,
      chainPosition: 3,
    },
    false
  ) === CHAIN_TILE_LABEL.nextHomeSearch
);

// Pre-fix regression: without privacy-redacted peer support, Cuckoo would drop.
assert(
  "legacy address-only rule would have dropped redacted Cuckoo",
  !(
    !!userBCuckooRedacted.address ||
    isSearchingPlaceholder(userBCuckooRedacted)
  )
);

if (process.exitCode && process.exitCode !== 0) {
  console.error("\nPart 3 connected-hop topology verification FAILED");
  process.exit(process.exitCode);
}

console.log("\nPart 3 connected-hop topology verification PASSED");
