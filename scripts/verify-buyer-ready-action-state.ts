/**
 * Buyer Ready page "Next Recommended Action" state (offline).
 *
 * The page reads the cached Buyer Ready node clock from
 * chain_operational_summary (latest genuine node activity, else node stage
 * entry, else node creation) instead of the newest loaded activity. The
 * existing order is kept: an active delay first, then the clock past 14 days,
 * otherwise no action.
 *
 * Usage:
 *   npx tsx scripts/verify-buyer-ready-action-state.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import type { OperationalActivity } from "../lib/activityIntelligence";
import {
  cachedBuyerReadyClockDays,
  cachedBuyerReadyClockForNode,
  type CachedBuyerReadyClock,
} from "../lib/operationalSummary/cachedBuyerReadyClock";
import { isCachedPropertyClockBehind } from "../lib/operationalSummary/cachedPropertyClock";
import { deriveOperationalSummaries } from "../lib/operationalSummary/processOperationalRefresh";
import type {
  OperationalRefreshChainNode,
  OperationalRefreshDataset,
  OperationalRefreshProperty,
} from "../lib/operationalSummary/types";
import {
  getBuyerReadyActionMessage,
  type WorkflowAccess,
} from "../lib/workflowPermissions";

let failures = 0;
let checks = 0;

function assert(name: string, condition: boolean, detail?: unknown) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error("FAIL:", name, detail === undefined ? "" : JSON.stringify(detail));
  } else {
    console.log("PASS:", name);
  }
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const NOW = new Date("2026-10-08T12:00:00.000Z");
const daysAgo = (days: number, extraMs = HOUR_MS) =>
  new Date(NOW.getTime() - days * DAY_MS - extraMs).toISOString();

const NODE_ID = 900;

const buyerOwner: WorkflowAccess = {
  canView: true,
  canEdit: true,
  mode: "editable",
  viewerRole: "owner",
  bannerMessage: null,
};
const readOnlyEa: WorkflowAccess = {
  ...buyerOwner,
  canEdit: false,
  mode: "read_only",
  viewerRole: "estate_agent",
};
const seller: WorkflowAccess = {
  ...buyerOwner,
  canEdit: false,
  mode: "read_only",
  viewerRole: "chain_participant",
};
const delegatedEa: WorkflowAccess = { ...buyerOwner, viewerRole: "estate_agent" };

function clock(params: {
  clockAt: string | null;
  source?: string | null;
  nodeId?: number | null;
  computedAt?: string;
}): CachedBuyerReadyClock {
  return {
    chain_id: 199,
    buyer_ready_node_id: params.nodeId === undefined ? NODE_ID : params.nodeId,
    buyer_ready_activity_clock_at: params.clockAt,
    buyer_ready_activity_clock_source: params.source ?? "genuine_activity",
    computed_at: params.computedAt ?? daysAgo(1),
  };
}

/** Mirrors the page: the cached clock only counts for this page's node. */
function panel(
  access: WorkflowAccess,
  cached: CachedBuyerReadyClock | null,
  options: { delay?: string | null; frozen?: boolean; nodeId?: number } = {}
) {
  const nodeClock = cachedBuyerReadyClockForNode(cached, options.nodeId ?? NODE_ID);
  return getBuyerReadyActionMessage({
    access,
    activeDelayReport: options.delay != null,
    latestDelayUpdate: options.delay ?? null,
    staleClockDays: cachedBuyerReadyClockDays(nodeClock, NOW),
    isCompletionLifecycleFrozen: options.frozen ?? false,
  });
}

const OWNER_STALE = (days: number) =>
  `No updates have been added for ${days} days. Consider checking progress with your estate agent or conveyancer.`;
const OBSERVER_STALE = (days: number) =>
  `No updates have been added for ${days} days. This participant may need to check progress with their estate agent or conveyancer.`;

// 1. Genuine activity 3 days ago.
const genuine3 = clock({ clockAt: daysAgo(3) });
assert(
  "1: genuine activity 3 days ago → no stale alert",
  cachedBuyerReadyClockDays(genuine3, NOW) === 3 &&
    panel(buyerOwner, genuine3).title === "No Immediate Actions" &&
    panel(buyerOwner, genuine3).message === "Your transaction appears to be progressing normally." &&
    panel(buyerOwner, genuine3).colour === "bg-green-100 text-green-700"
);

// 2. Genuine activity 30 days ago.
const genuine30 = clock({ clockAt: daysAgo(30) });
assert(
  "2: genuine activity 30 days ago → Update Recommended (red)",
  panel(buyerOwner, genuine30).title === "Update Recommended" &&
    panel(buyerOwner, genuine30).message === OWNER_STALE(30) &&
    panel(buyerOwner, genuine30).colour === "bg-red-100 text-red-700",
  panel(buyerOwner, genuine30)
);

// 3. No activity, node stage entry 20 days ago.
const stageEntry20 = clock({ clockAt: daysAgo(20), source: "stage_entered_at" });
const p3 = panel(buyerOwner, stageEntry20);
assert(
  "3: no activity, stage-entry clock 20 days ago → Update Recommended",
  p3.title === "Update Recommended" && p3.message === OWNER_STALE(20),
  p3
);
assert(
  "3: node creation fallback ages the same way",
  panel(buyerOwner, clock({ clockAt: daysAgo(40), source: "node_created" })).message === OWNER_STALE(40)
);

// 4–5. Boundaries.
for (const days of [0, 10, 14]) {
  assert(
    `4: clock ${days} days → no stale alert`,
    panel(buyerOwner, clock({ clockAt: daysAgo(days), source: "stage_entered_at" })).title ===
      "No Immediate Actions"
  );
}
assert(
  "5: clock 15 days → Update Recommended",
  panel(buyerOwner, clock({ clockAt: daysAgo(15), source: "stage_entered_at" })).title === "Update Recommended"
);

// 6. Missing cache.
assert(
  "6: no cached summary → no stale alert and no day count",
  cachedBuyerReadyClockDays(null, NOW) === null && panel(buyerOwner, null).title === "No Immediate Actions"
);
assert(
  "6: a cached summary without a clock → no stale alert",
  panel(buyerOwner, clock({ clockAt: null, source: null })).title === "No Immediate Actions"
);
assert(
  "6: a missing cache is behind (one server-gated refresh request)",
  isCachedPropertyClockBehind(null, []) === true
);

// 7. System notices.
const nodeActivities: OperationalActivity[] = [
  { timestamp: daysAgo(20), update: "Mortgage In Principle", updated_by: "homeowner" },
  { timestamp: daysAgo(0, 60_000), update: "Estate agent branch reconnected to this property.", updated_by: "system" },
];
const cachedBeforeNotice = clock({ clockAt: daysAgo(20), computedAt: daysAgo(1) });
assert(
  "7: a newer system notice does not move the cached clock (decision stays stale)",
  panel(buyerOwner, cachedBeforeNotice).title === "Update Recommended" &&
    panel(buyerOwner, cachedBeforeNotice).message === OWNER_STALE(20)
);
assert(
  "7: activity newer than the cached summary asks for one server-gated refresh",
  isCachedPropertyClockBehind(cachedBeforeNotice, nodeActivities) === true
);

// 8. Genuine activity resets the clock.
const reset = clock({ clockAt: daysAgo(0, 60_000), computedAt: daysAgo(0, 1_000) });
assert(
  "8: after recalculation, recent genuine activity clears the alert",
  cachedBuyerReadyClockDays(reset, NOW) === 0 && panel(buyerOwner, reset).title === "No Immediate Actions"
);
assert(
  "8: a cache computed after the newest node activity is not behind",
  isCachedPropertyClockBehind(reset, [
    { timestamp: daysAgo(0, 60_000), update: "Mortgage Application Submitted", updated_by: "homeowner" },
  ]) === false
);

// 9. The fallback date is never a Last updated date.
assert(
  "9: the panel never shows the fallback date or the words Last updated",
  !`${p3.title} ${p3.message}`.includes(stageEntry20.buyer_ready_activity_clock_at!.slice(0, 10)) &&
    !/last updated/i.test(`${p3.title} ${p3.message}`)
);

// 10. Frozen lifecycle.
assert(
  "10: frozen (scheduled / completed) lifecycle suppresses the stale alert",
  panel(buyerOwner, genuine30, { frozen: true }).title === "No Immediate Actions"
);

// 12–13. Delay behaviour and order.
const delay = "Awaiting mortgage valuation";
assert(
  "12: an active delay stays Delay reported even when the clock is stale",
  panel(buyerOwner, genuine30, { delay }).title === "Delay reported" &&
    panel(buyerOwner, genuine30, { delay }).message === delay &&
    panel(buyerOwner, genuine30, { delay }).colour === "bg-amber-100 text-amber-700"
);
assert(
  "13: delay only (recent clock, missing cache, frozen) → Delay reported with its reason",
  panel(buyerOwner, genuine3, { delay }).title === "Delay reported" &&
    panel(buyerOwner, null, { delay }).title === "Delay reported" &&
    panel(buyerOwner, genuine3, { delay, frozen: true }).title === "Delay reported" &&
    panel(seller, genuine3, { delay }).message === delay
);
assert(
  "13: a delay report without a reason does not show an empty delay panel",
  getBuyerReadyActionMessage({
    access: buyerOwner,
    activeDelayReport: true,
    latestDelayUpdate: null,
    staleClockDays: 30,
    isCompletionLifecycleFrozen: false,
  }).title === "Update Recommended"
);

// 14. Wording.
assert(
  "14: the Buyer Ready owner keeps homeowner wording",
  panel(buyerOwner, genuine30).title === "Update Recommended" &&
    panel(buyerOwner, reset).message === "Your transaction appears to be progressing normally."
);
assert(
  "14: a read-only EA and the seller see observer wording",
  panel(readOnlyEa, genuine30).title === "Progress Update Recommended" &&
    panel(readOnlyEa, genuine30).message === OBSERVER_STALE(30) &&
    panel(seller, reset).message === "This participant's transaction appears to be progressing normally."
);
assert(
  "14: a delegated EA keeps the delegated wording",
  panel(delegatedEa, genuine30).message ===
    "No updates have been added for 30 days. Consider posting an update on behalf of the homeowner." &&
    panel(delegatedEa, reset).message === "This transaction appears to be progressing normally."
);

// 15. Node ID guard.
assert(
  "15: a cached clock for a different Buyer Ready node is ignored",
  cachedBuyerReadyClockForNode(clock({ clockAt: daysAgo(30), nodeId: 901 }), NODE_ID) === null &&
    panel(buyerOwner, clock({ clockAt: daysAgo(30), nodeId: 901 })).title === "No Immediate Actions"
);
assert(
  "15: a cached summary without a Buyer Ready node is ignored",
  cachedBuyerReadyClockForNode(clock({ clockAt: daysAgo(30), nodeId: null }), NODE_ID) === null &&
    cachedBuyerReadyClockForNode(genuine30, null) === null
);
assert(
  "15: the matching node's clock is used (numeric and string ids)",
  cachedBuyerReadyClockForNode(genuine30, NODE_ID) === genuine30 &&
    cachedBuyerReadyClockForNode(
      { ...genuine30, buyer_ready_node_id: String(NODE_ID) as unknown as number },
      NODE_ID
    ) != null
);
assert(
  "15: a mismatched cache is treated as behind (one server-gated refresh request)",
  isCachedPropertyClockBehind(
    cachedBuyerReadyClockForNode(clock({ clockAt: daysAgo(30), nodeId: 901 }), NODE_ID),
    nodeActivities
  ) === true
);

// Worker derivation: the chain summary carries the node clock it was given.
function property(id: number): OperationalRefreshProperty {
  return {
    id,
    chainId: 1,
    chainPosition: id,
    stage: "searches_ordered",
    status: "healthy",
    address: `${id} Example Street`,
    stageEnteredAt: daysAgo(10),
    activities: [],
    genuineLastActivityAt: null,
    activityClockAt: daysAgo(2),
    activityClockSource: "stage_entered_at",
    hasActiveOperationalDelay: false,
  };
}
function node(overrides: Partial<OperationalRefreshChainNode>): OperationalRefreshChainNode {
  return {
    id: NODE_ID,
    chain_id: 1,
    node_type: "buyer_ready",
    linked_property_id: 1,
    stage: "mortgage_in_principle",
    status: "healthy",
    progress: 10,
    stageEnteredAt: daysAgo(20),
    activities: [],
    genuineLastActivityAt: null,
    activityClockAt: daysAgo(20),
    activityClockSource: "stage_entered_at",
    hasActiveOperationalDelay: false,
    ...overrides,
  };
}
function dataset(nodes: OperationalRefreshChainNode[]): OperationalRefreshDataset {
  return {
    chain: {
      id: 1,
      completionLifecycleStatus: null,
      completionScheduledDate: null,
      completionConfirmedAt: null,
      completedAt: null,
    },
    properties: [property(1), property(2)],
    chainNodes: nodes,
  };
}
const NEW_FIELDS = [
  "buyer_ready_node_id",
  "buyer_ready_activity_clock_at",
  "buyer_ready_activity_clock_source",
] as const;
function withoutNewFields(summary: Record<string, unknown>) {
  const copy = { ...summary };
  for (const key of NEW_FIELDS) delete copy[key];
  return copy;
}

const derived20 = deriveOperationalSummaries(dataset([node({})]), NOW);
assert(
  "Worker: the chain summary persists the primary Buyer Ready node's server clock",
  derived20.chainSummary.buyer_ready_node_id === NODE_ID &&
    derived20.chainSummary.buyer_ready_activity_clock_at === daysAgo(20) &&
    derived20.chainSummary.buyer_ready_activity_clock_source === "stage_entered_at",
  derived20.chainSummary
);
assert(
  "Worker: no Buyer Ready node → no Buyer Ready clock",
  NEW_FIELDS.every((key) => deriveOperationalSummaries(dataset([]), NOW).chainSummary[key] === null)
);
assert(
  "Worker: a dataset without a server node clock stores no clock (never derived from activities)",
  deriveOperationalSummaries(
    dataset([
      node({
        activityClockAt: undefined,
        activityClockSource: undefined,
        activities: [{ timestamp: daysAgo(1), update: "Mortgage In Principle", updated_by: "homeowner" }],
      }),
    ]),
    NOW
  ).chainSummary.buyer_ready_activity_clock_at === null
);
assert(
  "Worker: the first Buyer Ready node in dataset order is the one stored",
  deriveOperationalSummaries(
    dataset([node({ id: 901, activityClockAt: daysAgo(3) }), node({ id: 902 })]),
    NOW
  ).chainSummary.buyer_ready_node_id === 901
);

const derived20Source = deriveOperationalSummaries(
  dataset([node({ activityClockSource: "node_created" })]),
  NOW
);
assert(
  "19: the new fields change no other chain or property summary value",
  JSON.stringify(withoutNewFields(derived20.chainSummary)) ===
    JSON.stringify(withoutNewFields(derived20Source.chainSummary)) &&
    JSON.stringify(derived20.propertySummaries) === JSON.stringify(derived20Source.propertySummaries)
);
const derived22 = deriveOperationalSummaries(dataset([node({ activityClockAt: daysAgo(22) })]), NOW);
assert(
  "19/12: chain impact still uses 21 days (20 days: not Buyer Ready stale; 22 days: stale), page alert uses 14",
  derived20.chainSummary.buyer_ready_stale === false &&
    derived22.chainSummary.buyer_ready_stale === true &&
    panel(buyerOwner, clock({ clockAt: daysAgo(20) })).title === "Update Recommended"
);
assert(
  "18: Buyer Ready activity never becomes a property's Last updated or activity clock",
  derived20.propertySummaries.every(
    (summary) => summary.last_update_at === null && summary.activity_clock_at === daysAgo(2)
  )
);

// Static wiring.
const root = join(__dirname, "..");
const page = readFileSync(join(root, "app/buyer-ready/[chainId]/page.tsx"), "utf8");
const loader = readFileSync(join(root, "lib/operationalSummary/cachedBuyerReadyClock.ts"), "utf8");

assert(
  "Static: the page no longer ages the newest loaded activity",
  !page.includes("daysSinceLastActivity") && !page.includes("STALE_DAYS_PAGE_ALERT")
);
assert(
  "Static: the page reads the cached Buyer Ready clock for its own node",
  page.includes("loadCachedBuyerReadyClock(supabase, chainId)") &&
    page.includes("cachedBuyerReadyClockForNode(") &&
    page.includes("buyerNodeId") &&
    page.includes("cachedBuyerReadyClockDays(") &&
    page.includes("getBuyerReadyActionMessage(")
);
assert(
  "Static: the page never uses a property clock for the Buyer Ready node",
  !page.includes("loadCachedPropertyClock") && !page.includes("cachedPropertyClockDays")
);
assert(
  "Static: no chain intelligence calculation in the page",
  !/computeChainIntelligence|computeTimingChainIntelligence|deriveChainSummary|derivePropertySummary|deriveOperationalSummaries|isBuyerReadyOperationallyStale|selectBottleneckProperty/.test(
    page
  )
);
assert(
  "Static: the loader is one RLS-gated select of chain_operational_summary by chain_id",
  (loader.match(/\.from\(/g) ?? []).length === 1 &&
    loader.includes('.from("chain_operational_summary")') &&
    loader.includes('.eq("chain_id", chainId)') &&
    loader.includes(".maybeSingle()") &&
    !loader.includes(".rpc(")
);
assert(
  "9: Static: the cached clock is never rendered and the page has no Last updated label",
  !/buyer_ready_activity_clock_at|activity_clock_at|last_update_at/.test(page) && !/last updated/i.test(page)
);
assert(
  "11: Static: completed lifecycle still hides the action panel (and it waits for the cached read)",
  page.includes("!isCompletedCompletionMode && cachedClockLoaded")
);
assert(
  "10: Static: the frozen lifecycle flag still feeds the action panel",
  /getBuyerReadyActionMessage\(\{[\s\S]*?isCompletionLifecycleFrozen,[\s\S]*?\}\)/.test(page)
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  process.exitCode = 1;
}
