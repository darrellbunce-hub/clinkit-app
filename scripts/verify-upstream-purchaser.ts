import type { ChainNodesChainSummary } from "../lib/chainNodesSummary";
import {
  findBuyerReadySummaryForAnchor,
  resolvePurchaserStateForProperty,
  resolvePurchaserStatesByPropertyId,
  resolveUpstreamPurchaserState,
  shouldRenderAwaitingBuyerBeforeProperty,
  shouldRenderUpstreamPurchaserBeforeProperty,
} from "../lib/resolveUpstreamPurchaser";

function assert(name: string, condition: boolean) {
  if (!condition) {
    console.error("FAIL:", name);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function assertEqual<T>(
  name: string,
  actual: T,
  expected: T
) {
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

const operationalSaleId = 10;

const sellAndBuyChain = [
  { id: 10, buyer_connected: false, relationship_type: "sale" as const },
  { id: 11, buyer_connected: true, relationship_type: "purchase" as const },
  { id: 12, buyer_connected: false, relationship_type: "purchase" as const },
];

const buyerReadySummaryForSale: ChainNodesChainSummary =
  {
    id: 501,
    chain_id: 1,
    node_type: "buyer_ready",
    position: 0,
    linked_property_id: operationalSaleId,
    status: "healthy",
    progress: 10,
    public_stage_label: "Mortgage preparation",
    latest_activity_at: null,
  };

const buyerReadySummaryOtherAnchor: ChainNodesChainSummary =
  {
    ...buyerReadySummaryForSale,
    id: 502,
    linked_property_id: 99,
  };

assertEqual(
  "Awaiting buyer when sale has no purchaser",
  resolveUpstreamPurchaserState({
    operationalSalePropertyId: operationalSaleId,
    chainProperties: sellAndBuyChain,
    buyerReadyForAnchor: null,
  }),
  {
    kind: "awaiting_buyer",
    anchorPropertyId: 10,
  }
);

assertEqual(
  "Buyer ready when connected and summary anchored to sale",
  resolveUpstreamPurchaserState({
    operationalSalePropertyId: operationalSaleId,
    chainProperties: [
      { id: 10, buyer_connected: true, relationship_type: "sale" },
      { id: 11, buyer_connected: true, relationship_type: "purchase" },
    ],
    buyerReadyForAnchor: buyerReadySummaryForSale,
  }),
  {
    kind: "buyer_ready",
    anchorPropertyId: 10,
    summary: buyerReadySummaryForSale,
  }
);

assertEqual(
  "No upstream tile when buyer_connected without buyer_ready",
  resolveUpstreamPurchaserState({
    operationalSalePropertyId: operationalSaleId,
    chainProperties: [
      { id: 10, buyer_connected: true, relationship_type: "sale" },
      { id: 11, buyer_connected: true, relationship_type: "purchase" },
    ],
    buyerReadyForAnchor: null,
  }),
  null
);

assertEqual(
  "No upstream purchaser without property id",
  resolveUpstreamPurchaserState({
    operationalSalePropertyId: null,
    chainProperties: sellAndBuyChain,
    buyerReadyForAnchor: null,
  }),
  null
);

assertEqual(
  "No upstream purchaser when anchor missing from properties",
  resolveUpstreamPurchaserState({
    operationalSalePropertyId: 99,
    chainProperties: sellAndBuyChain,
    buyerReadyForAnchor: null,
  }),
  null
);

assertEqual(
  "findBuyerReadySummaryForAnchor picks matching linked_property_id",
  findBuyerReadySummaryForAnchor(
    [
      buyerReadySummaryOtherAnchor,
      buyerReadySummaryForSale,
    ],
    operationalSaleId
  ),
  buyerReadySummaryForSale
);

assertEqual(
  "findBuyerReadySummaryForAnchor returns null when no match",
  findBuyerReadySummaryForAnchor(
    [buyerReadySummaryOtherAnchor],
    operationalSaleId
  ),
  null
);

const awaitingState = {
  kind: "awaiting_buyer" as const,
  anchorPropertyId: 10,
};

const buyerReadyState = {
  kind: "buyer_ready" as const,
  anchorPropertyId: 10,
  summary: buyerReadySummaryForSale,
};

assert(
  "Render awaiting buyer immediately before anchored sale tile",
  shouldRenderUpstreamPurchaserBeforeProperty(
    awaitingState,
    10,
    true
  )
);

assert(
  "Render buyer ready immediately before anchored sale tile",
  shouldRenderUpstreamPurchaserBeforeProperty(
    buyerReadyState,
    10,
    true
  )
);

assert(
  "Structural state still renders when property is not the viewer operational sale",
  shouldRenderUpstreamPurchaserBeforeProperty(
    awaitingState,
    10,
    false
  )
);

assert(
  "Do not render purchaser synthetic before a different property",
  !shouldRenderUpstreamPurchaserBeforeProperty(
    buyerReadyState,
    11,
    false
  )
);

assert(
  "Do not render when upstream purchaser state is null",
  !shouldRenderUpstreamPurchaserBeforeProperty(
    null,
    10,
    true
  )
);

assert(
  "Awaiting-only helper still matches awaiting buyer",
  shouldRenderAwaitingBuyerBeforeProperty(
    awaitingState,
    10,
    true
  )
);

assert(
  "Awaiting-only helper rejects buyer ready state",
  !shouldRenderAwaitingBuyerBeforeProperty(
    buyerReadyState,
    10,
    true
  )
);

assert(
  "Only one anchor match — other-property summary does not resolve for sale 10",
  resolveUpstreamPurchaserState({
    operationalSalePropertyId: operationalSaleId,
    chainProperties: [
      { id: 10, buyer_connected: true, relationship_type: "sale" },
    ],
    buyerReadyForAnchor: findBuyerReadySummaryForAnchor(
      [buyerReadySummaryOtherAnchor],
      operationalSaleId
    ),
  }) === null
);

assertEqual(
  "Per-property resolve matches map entry for unresolved sale",
  resolvePurchaserStateForProperty({
    propertyId: 10,
    chainProperties: sellAndBuyChain,
    buyerReadySummaries: [],
  }),
  { kind: "awaiting_buyer", anchorPropertyId: 10 }
);

assertEqual(
  "Purchase hop does not get Awaiting Buyer structural state",
  resolvePurchaserStateForProperty({
    propertyId: 12,
    chainProperties: sellAndBuyChain,
    buyerReadySummaries: [],
  }),
  null
);

const multiHopChain = [
  { id: 1, buyer_connected: false, relationship_type: "sale" as const },
  { id: 2, buyer_connected: true, relationship_type: "purchase" as const },
  { id: 3, buyer_connected: true, relationship_type: "sale" as const },
  { id: 4, buyer_connected: true, relationship_type: "purchase" as const },
  {
    id: 5,
    buyer_connected: false,
    relationship_type: "purchase" as const,
    stage: "searching",
    address: null,
  },
];

const states = resolvePurchaserStatesByPropertyId({
  chainProperties: multiHopChain,
  buyerReadySummaries: [],
});

assert(
  "Full-chain map includes Awaiting Buyer for P1 only",
  states.size === 1 &&
    states.get(1)?.kind === "awaiting_buyer"
);

assert(
  "Searching placeholder is not an Awaiting Buyer anchor",
  !states.has(5)
);

const summaryAnchoredToP1: ChainNodesChainSummary = {
  ...buyerReadySummaryForSale,
  linked_property_id: 1,
};

const connectedWithReady = resolvePurchaserStatesByPropertyId({
  chainProperties: [
    { id: 1, buyer_connected: true, relationship_type: "sale" },
    { id: 2, buyer_connected: true, relationship_type: "purchase" },
    { id: 3, buyer_connected: true, relationship_type: "sale" },
  ],
  buyerReadySummaries: [summaryAnchoredToP1],
});

assert(
  "Buyer Ready attaches to summary anchor property, not viewer ops sale",
  connectedWithReady.size === 1 &&
    connectedWithReady.get(1)?.kind === "buyer_ready"
);

console.log(
  process.exitCode === 1
    ? "\nSome checks failed."
    : "\nAll upstream purchaser Phase 1–2 checks passed."
);
