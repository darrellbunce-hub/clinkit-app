import type { ChainNodesChainSummary } from "../lib/chainNodesSummary";
import {
  findBuyerReadySummaryForAnchor,
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
  { id: 10, buyer_connected: false },
  { id: 11, buyer_connected: true },
  { id: 12, buyer_connected: false },
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
  "Awaiting buyer when operational sale has no purchaser",
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
      { id: 10, buyer_connected: true },
      { id: 11, buyer_connected: true },
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
      { id: 10, buyer_connected: true },
      { id: 11, buyer_connected: true },
    ],
    buyerReadyForAnchor: null,
  }),
  null
);

assertEqual(
  "No upstream purchaser without operational sale id",
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
  "Render awaiting buyer immediately before operational sale tile",
  shouldRenderUpstreamPurchaserBeforeProperty(
    awaitingState,
    10,
    true
  )
);

assert(
  "Render buyer ready immediately before operational sale tile",
  shouldRenderUpstreamPurchaserBeforeProperty(
    buyerReadyState,
    10,
    true
  )
);

assert(
  "Do not render upstream purchaser before non-operational tiles",
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
      { id: 10, buyer_connected: true },
    ],
    buyerReadyForAnchor: findBuyerReadySummaryForAnchor(
      [buyerReadySummaryOtherAnchor],
      operationalSaleId
    ),
  }) === null
);

console.log(
  process.exitCode === 1
    ? "\nSome checks failed."
    : "\nAll upstream purchaser Phase 1–2 checks passed."
);
