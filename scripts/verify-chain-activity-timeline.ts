/**
 * Chain page "Recent Chain Activity" — offline checks.
 *
 *   lib/chainActivityTimeline.ts (buildChainActivityTimeline, position labels)
 *   components/operational/ActivityActorBadge.tsx + lib/workflowPermissions.ts
 *   app/chain/[chainId]/page.tsx, app/property/[propertyId]/page.tsx,
 *   app/buyer-ready/[chainId]/page.tsx (shared actor badge)
 *
 * Each viewer is assembled as the chain page does it: participant rows →
 * operational subject lens → operational position → timeline + composed tiles.
 *
 * Usage:
 *   npx tsx scripts/verify-chain-activity-timeline.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import type { OperationalActivity } from "../lib/activityIntelligence";
import {
  buildChainTopology,
  type TopologyProperty,
} from "../lib/buildChainTopology";
import {
  buildChainActivityTimeline,
  CHAIN_ACTIVITY_POSITION_SEPARATOR,
  resolveChainPropertyNumbers,
  type ChainActivityNode,
  type ChainTimelineActivity,
} from "../lib/chainActivityTimeline";
import type { ChainNodesChainSummary } from "../lib/chainNodesSummary";
import { composeChainTiles } from "../lib/composeChainTiles";
import {
  CHAIN_TILE_LABEL,
  type OperationalBuyerReadyNode,
  type OperationalProperty,
} from "../lib/operationalPosition";
import {
  applyOperationalSubjectLens,
  resolveOperationalSubject,
  resolveSubjectOperationalPosition,
  type EstateAgentOperationalAssignment,
} from "../lib/operationalSubject";
import {
  formatActivityUpdaterLabel,
  getActivityUpdaterBadgeClass,
} from "../lib/workflowPermissions";

const ROOT = join(import.meta.dirname, "..");

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function assertEqual<T>(name: string, actual: T, expected: T) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  record(name, pass, pass ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Row = TopologyProperty &
  OperationalProperty & {
    chainId: number;
    chainPosition: number;
    isOwnProperty: boolean;
    postcode: string | null;
    activities: OperationalActivity[];
  };

type RowSpec = Pick<Row, "id" | "chainPosition" | "relationship_type"> &
  Partial<Omit<Row, "id" | "chainPosition" | "relationship_type">>;

function rowFor(chainId: number, spec: RowSpec): Row {
  return {
    chainId,
    stage: "offer_accepted",
    status: "healthy",
    currentUserRole: null,
    lastUpdatedDays: 0,
    address: null,
    postcode: null,
    awaiting_buyer: false,
    is_searching: false,
    buyer_connected: true,
    seller_connected: true,
    linked_property_id: null,
    members: [],
    isOwnProperty: false,
    activities: [],
    ...spec,
  };
}

function act(
  id: number,
  update: string,
  updatedBy: string,
  minute: number
): OperationalActivity {
  return {
    id,
    update,
    updated_by: updatedBy,
    timestamp: new Date(Date.UTC(2026, 9, 5, 18, minute)).toISOString(),
  };
}

type Viewer = {
  userId: string;
  accountType: "homeowner" | "estate_agent";
  assignments?: EstateAgentOperationalAssignment[];
};

type ViewResult = {
  timeline: ChainTimelineActivity[];
  propertyTileLabels: Map<number, string>;
  lensRows: Row[];
};

function summariesFor(chainId: number, nodes: ChainActivityNode[]): ChainNodesChainSummary[] {
  return nodes
    .filter((node) => node.chain_id === chainId && node.node_type === "buyer_ready")
    .map(
      (node, index) =>
        ({
          id: node.id,
          chain_id: node.chain_id,
          node_type: "buyer_ready",
          position: index,
          linked_property_id: node.linked_property_id ?? null,
          status: "healthy",
          progress: 10,
          public_stage_label: "Buyer Ready",
          latest_activity_at: null,
        }) as ChainNodesChainSummary
    );
}

function view(
  chainId: number,
  rows: Row[],
  viewer: Viewer,
  chainNodes: Array<ChainActivityNode & { user_id: string }> = []
): ViewResult {
  const subject = resolveOperationalSubject({
    viewerUserId: viewer.userId,
    accountType: viewer.accountType,
    chainId,
    chainProperties: rows,
    estateAgentAssignments: viewer.assignments ?? [],
  });
  const lensById = new Map(
    applyOperationalSubjectLens(rows, subject).map((row) => [row.id, row])
  );
  const lensRows: Row[] = rows.map((row) => ({
    ...row,
    currentUserRole: lensById.get(row.id)?.currentUserRole ?? null,
    isOwnProperty: lensById.get(row.id)?.isOwnProperty ?? row.isOwnProperty,
  }));
  const { position } = resolveSubjectOperationalPosition({
    subject,
    chainId,
    chainProperties: rows,
    chainNodes: chainNodes as unknown as OperationalBuyerReadyNode[],
  });
  const ownerNode =
    position?.kind === "buyer_ready"
      ? chainNodes.find((node) => node.id === position.nodeId) ?? null
      : null;

  const timeline = buildChainActivityTimeline({
    chainId,
    chainProperties: rows,
    labelProperties: lensRows,
    operationalPosition: position,
    ownerBuyerReadyLinkedPropertyId: ownerNode?.linked_property_id ?? null,
    chainNodes,
  });

  const tiles = composeChainTiles({
    chainProperties: lensRows,
    operationalPosition: position,
    buyerReadySummaries: summariesFor(chainId, chainNodes),
  });
  const propertyTileLabels = new Map<number, string>();
  for (const tile of tiles) {
    if (tile.kind === "property" && tile.anchorPropertyId != null) {
      propertyTileLabels.set(tile.anchorPropertyId, tile.label);
    }
  }

  return { timeline, propertyTileLabels, lensRows };
}

function labelsById(timeline: ChainTimelineActivity[]): Record<number, string> {
  return Object.fromEntries(timeline.map((entry) => [entry.id ?? -1, entry.positionLabel]));
}

function baseLabel(label: string): string {
  return label.split(CHAIN_ACTIVITY_POSITION_SEPARATOR)[0];
}

/** Every property activity label is its tile's title (plus at most a Property N suffix). */
function labelsMatchTiles(result: ViewResult): boolean {
  return result.timeline
    .filter((entry) => entry.source.kind === "property")
    .every((entry) => {
      const propertyId = entry.source.kind === "property" ? entry.source.propertyId : -1;
      return baseLabel(entry.positionLabel) === result.propertyTileLabels.get(propertyId);
    });
}

function leaksIdentifiers(timeline: ChainTimelineActivity[], rows: Row[]): string[] {
  const identifiers = rows
    .flatMap((row) => [row.address, row.postcode])
    .filter((value): value is string => Boolean(value));
  return timeline
    .map((entry) => entry.positionLabel)
    .filter((label) => identifiers.some((identifier) => label.includes(identifier)));
}

// ---------------------------------------------------------------------------
// 1. Stage case: EA sale bought by a homeowner whose own sale links in
// ---------------------------------------------------------------------------

const HL_CHAIN = 1551;
const HO_SALE = 2293;
const EA_SALE = 2291;
const SEARCH = 2292;
const HO_ID = "homeowner-buyer";
const EA_ID = "estate-agent";
const OUTSIDE_ADDRESS = "2 Owner Road";
const OUTSIDE_POSTCODE = "PO1 1AA";
const EA_ADDRESS = "321 Harry Lane";
const EA_POSTCODE = "PO2 2BB";

const hlActivities = {
  ea: act(1068, "Offer Accepted", "estate_agent", 12),
  hoOffer: act(1069, "Offer Accepted", "homeowner", 16),
  hoSolicitors: act(1070, "Solicitors Instructed", "homeowner", 17),
};

function harryLaneRows(viewer: "homeowner" | "estate_agent"): Row[] {
  const isHomeowner = viewer === "homeowner";
  return [
    rowFor(HL_CHAIN, {
      id: HO_SALE,
      chainPosition: 1,
      relationship_type: "sale",
      stage: "solicitors_instructed",
      status: "pending_connection",
      buyer_connected: false,
      linked_property_id: EA_SALE,
      currentUserRole: isHomeowner ? "seller" : null,
      isOwnProperty: isHomeowner,
      address: isHomeowner ? OUTSIDE_ADDRESS : null,
      postcode: isHomeowner ? OUTSIDE_POSTCODE : null,
      activities: [hlActivities.hoSolicitors, hlActivities.hoOffer],
    }),
    rowFor(HL_CHAIN, {
      id: EA_SALE,
      chainPosition: 1,
      relationship_type: "sale",
      linked_property_id: SEARCH,
      currentUserRole: isHomeowner ? "buyer" : null,
      isOwnProperty: isHomeowner,
      address: EA_ADDRESS,
      postcode: EA_POSTCODE,
      activities: [hlActivities.ea],
    }),
    rowFor(HL_CHAIN, {
      id: SEARCH,
      chainPosition: 2,
      relationship_type: "purchase",
      stage: "searching",
      status: "pending_connection",
      buyer_connected: false,
    }),
  ];
}

const hlHomeowner = view(HL_CHAIN, harryLaneRows("homeowner"), {
  userId: HO_ID,
  accountType: "homeowner",
});
const hlEa = view(HL_CHAIN, harryLaneRows("estate_agent"), {
  userId: EA_ID,
  accountType: "estate_agent",
  assignments: [
    { propertyId: EA_SALE, chainId: HL_CHAIN, subjectUserId: null, homeownerOnlyUpdates: false },
  ],
});

assertEqual(
  "Homeowner perspective: own sale activity = Your Sale, the EA's = Your Purchase",
  labelsById(hlHomeowner.timeline),
  { 1070: CHAIN_TILE_LABEL.yourSale, 1069: CHAIN_TILE_LABEL.yourSale, 1068: CHAIN_TILE_LABEL.yourPurchase }
);
assertEqual(
  "EA perspective: own activity = Your Sale, the buyer's own sale = Connected Buyer",
  labelsById(hlEa.timeline),
  { 1070: CHAIN_TILE_LABEL.connectedBuyer, 1069: CHAIN_TILE_LABEL.connectedBuyer, 1068: CHAIN_TILE_LABEL.yourSale }
);
assertEqual(
  "Both viewers see the same activities, newest first",
  [hlHomeowner.timeline.map((entry) => entry.id), hlEa.timeline.map((entry) => entry.id)],
  [
    [1070, 1069, 1068],
    [1070, 1069, 1068],
  ]
);
record("Homeowner labels match the chain tile titles", labelsMatchTiles(hlHomeowner));
record("EA labels match the chain tile titles", labelsMatchTiles(hlEa));
assertEqual(
  "Activities carry their source property",
  hlEa.timeline.map((entry) => entry.source),
  [
    { kind: "property", propertyId: HO_SALE },
    { kind: "property", propertyId: HO_SALE },
    { kind: "property", propertyId: EA_SALE },
  ]
);
assertEqual(
  "Hidden address/postcode: EA labels carry no address or postcode (own or the homeowner's)",
  leaksIdentifiers(hlEa.timeline, [...harryLaneRows("homeowner"), ...harryLaneRows("estate_agent")]),
  []
);
assertEqual(
  "Homeowner labels carry no address or postcode, even for rows the homeowner may see",
  leaksIdentifiers(hlHomeowner.timeline, harryLaneRows("homeowner")),
  []
);
assertEqual(
  "Activity entries expose only activity fields, source and label",
  [...new Set(hlEa.timeline.flatMap((entry) => Object.keys(entry)))].sort(),
  ["id", "key", "positionLabel", "source", "timestamp", "update", "updated_by"]
);
record(
  "No viewer-relative 'You' is produced",
  [...hlHomeowner.timeline, ...hlEa.timeline].every(
    (entry) => entry.positionLabel !== "You" && formatActivityUpdaterLabel(entry.updated_by) !== "You"
  )
);

// ---------------------------------------------------------------------------
// 2. Longer chain: repeated Connected Buyer / Connected Purchase
// ---------------------------------------------------------------------------

const LONG_CHAIN = 4200;
const MID_SELLER = "middle-seller";

function longRows(): Row[] {
  const spec = (
    id: number,
    chainPosition: number,
    relationship_type: "sale" | "purchase",
    linked: number | null,
    extra: Partial<Row> = {}
  ) =>
    rowFor(LONG_CHAIN, {
      id,
      chainPosition,
      relationship_type,
      linked_property_id: linked,
      address: `${id} Distant Street`,
      postcode: `ZZ${id} 9ZZ`,
      activities: [act(id * 10, "Offer Accepted", "homeowner", chainPosition)],
      ...extra,
    });

  return [
    spec(41, 1, "sale", 42, { address: null, postcode: null }),
    spec(42, 2, "sale", 43, { address: null, postcode: null }),
    spec(43, 3, "sale", 44, { currentUserRole: "seller", isOwnProperty: true }),
    spec(44, 4, "sale", 45, { currentUserRole: "buyer", isOwnProperty: true }),
    spec(45, 5, "purchase", null, { address: null, postcode: null, status: "pending_connection" }),
    spec(46, 6, "sale", 47, { address: null, postcode: null }),
    spec(47, 7, "purchase", null, { address: null, postcode: null, status: "pending_connection" }),
  ];
}

const longHomeowner = view(LONG_CHAIN, longRows(), { userId: MID_SELLER, accountType: "homeowner" });
const longOrder = buildChainTopology(longRows(), null).flatPropertyNodes.map((row) => row.id);
const longNumbers = resolveChainPropertyNumbers(longRows());

assertEqual(
  "Property N follows the rendered chain order",
  longOrder.map((id) => longNumbers.get(id)),
  longOrder.map((_, index) => index + 1)
);

const numbered = (label: string, id: number) =>
  `${label}${CHAIN_ACTIVITY_POSITION_SEPARATOR}Property ${longNumbers.get(id)}`;

assertEqual(
  "Longer chain (homeowner): repeated Connected Buyer and Connected Purchase are numbered; unique titles are not",
  labelsById(longHomeowner.timeline),
  {
    410: numbered(CHAIN_TILE_LABEL.connectedBuyer, 41),
    420: numbered(CHAIN_TILE_LABEL.connectedBuyer, 42),
    430: CHAIN_TILE_LABEL.yourSale,
    440: CHAIN_TILE_LABEL.yourPurchase,
    450: numbered(CHAIN_TILE_LABEL.connectedPurchase, 45),
    460: numbered(CHAIN_TILE_LABEL.connectedBuyer, 46),
    470: numbered(CHAIN_TILE_LABEL.connectedPurchase, 47),
  }
);
record("Longer chain (homeowner): labels match the chain tile titles", labelsMatchTiles(longHomeowner));
record(
  "Longer chain: every label is unique, so each activity identifies one position",
  new Set(longHomeowner.timeline.map((entry) => entry.positionLabel)).size === longRows().length
);

const longEaRows = longRows().map((row) => ({
  ...row,
  currentUserRole: null,
  isOwnProperty: false,
  address: row.id === 43 ? row.address : null,
  postcode: row.id === 43 ? row.postcode : null,
}));
const longEa = view(LONG_CHAIN, longEaRows, {
  userId: EA_ID,
  accountType: "estate_agent",
  assignments: [{ propertyId: 43, chainId: LONG_CHAIN, subjectUserId: MID_SELLER, homeownerOnlyUpdates: true }],
});
record("Longer chain (EA): labels match the chain tile titles", labelsMatchTiles(longEa));
record(
  "Longer chain (EA): assigned sale is Your Sale; every other repeated title is numbered",
  labelsById(longEa.timeline)[430] === CHAIN_TILE_LABEL.yourSale &&
    new Set(longEa.timeline.map((entry) => entry.positionLabel)).size === longEaRows.length,
  JSON.stringify(labelsById(longEa.timeline))
);
assertEqual(
  "Longer chain: no address or postcode in any label (homeowner or EA)",
  [...leaksIdentifiers(longHomeowner.timeline, longRows()), ...leaksIdentifiers(longEa.timeline, longRows())],
  []
);
assertEqual(
  "Longer chain: homeowner and EA see the same activities",
  longEa.timeline.map((entry) => entry.id),
  longHomeowner.timeline.map((entry) => entry.id)
);

// ---------------------------------------------------------------------------
// 3. Buyer Ready steps: one, several, own, another participant's, EA
// ---------------------------------------------------------------------------

const BR_CHAIN = 3100;
const BR_SALE_A = 311;
const BR_SALE_B = 312;
const BUYER_A = "buyer-a";
const BUYER_B = "buyer-b";

function brRows(viewerId: string | null): Row[] {
  return [
    rowFor(BR_CHAIN, {
      id: BR_SALE_A,
      chainPosition: 1,
      relationship_type: "sale",
      currentUserRole: viewerId === BUYER_A ? "buyer" : null,
      isOwnProperty: viewerId === BUYER_A,
      activities: [act(3110, "Offer Accepted", "estate_agent", 1)],
    }),
    rowFor(BR_CHAIN, {
      id: BR_SALE_B,
      chainPosition: 2,
      relationship_type: "sale",
      currentUserRole: viewerId === BUYER_B ? "buyer" : null,
      isOwnProperty: viewerId === BUYER_B,
      activities: [act(3120, "Offer Accepted", "estate_agent", 2)],
    }),
  ];
}

const nodeA = {
  id: 501,
  chain_id: BR_CHAIN,
  user_id: BUYER_A,
  node_type: "buyer_ready",
  linked_property_id: BR_SALE_A,
  activities: [act(5010, "Mortgage In Principle", "homeowner", 10), act(5011, "Solicitor Instructed", "homeowner", 11)],
};
const nodeB = {
  id: 502,
  chain_id: BR_CHAIN,
  user_id: BUYER_B,
  node_type: "buyer_ready",
  linked_property_id: BR_SALE_B,
  activities: [act(5020, "Mortgage In Principle", "homeowner", 12)],
};
const duplicateNodeA = { ...nodeA, activities: [...nodeA.activities, nodeA.activities[0]] };
const otherChainNode = { ...nodeB, id: 503, chain_id: 9999, activities: [act(5030, "Mortgage Application", "homeowner", 13)] };
const nonBuyerReadyNode = { ...nodeB, id: 504, node_type: "searching", activities: [act(5040, "Searching", "homeowner", 14)] };

const brEaViewer: Viewer = {
  userId: EA_ID,
  accountType: "estate_agent",
  assignments: [
    { propertyId: BR_SALE_A, chainId: BR_CHAIN, subjectUserId: null, homeownerOnlyUpdates: false },
    { propertyId: BR_SALE_B, chainId: BR_CHAIN, subjectUserId: null, homeownerOnlyUpdates: false },
  ],
};

const singleEa = view(BR_CHAIN, brRows(null), brEaViewer, [nodeA]);
const singleBuyer = view(BR_CHAIN, brRows(BUYER_A), { userId: BUYER_A, accountType: "homeowner" }, [nodeA]);
assertEqual(
  "One Buyer Ready step: labelled Buyer Ready for the EA and for its owner",
  [singleEa, singleBuyer].map((result) =>
    result.timeline.filter((entry) => entry.source.kind === "buyer_ready").map((entry) => entry.positionLabel)
  ),
  [
    [CHAIN_TILE_LABEL.buyerReady, CHAIN_TILE_LABEL.buyerReady],
    [CHAIN_TILE_LABEL.buyerReady, CHAIN_TILE_LABEL.buyerReady],
  ]
);

const multiNodes = [duplicateNodeA, nodeB, otherChainNode, nonBuyerReadyNode];
const multiEa = view(BR_CHAIN, brRows(null), brEaViewer, multiNodes);
const multiOwnerA = view(BR_CHAIN, brRows(BUYER_A), { userId: BUYER_A, accountType: "homeowner" }, multiNodes);
const multiOwnerB = view(BR_CHAIN, brRows(BUYER_B), { userId: BUYER_B, accountType: "homeowner" }, multiNodes);
const brNumbers = resolveChainPropertyNumbers(brRows(null));
const buyerReadyFor = (propertyId: number) =>
  `${CHAIN_TILE_LABEL.buyerReady}${CHAIN_ACTIVITY_POSITION_SEPARATOR}Property ${brNumbers.get(propertyId)}`;

const expectedBuyerReady = {
  5010: buyerReadyFor(BR_SALE_A),
  5011: buyerReadyFor(BR_SALE_A),
  5020: buyerReadyFor(BR_SALE_B),
};
const buyerReadyLabels = (result: ViewResult) =>
  Object.fromEntries(
    result.timeline
      .filter((entry) => entry.source.kind === "buyer_ready")
      .map((entry) => [entry.id, entry.positionLabel])
  );

assertEqual("Several Buyer Ready steps (EA view): every step included, labelled by the property it buys", buyerReadyLabels(multiEa), expectedBuyerReady);
assertEqual("Several Buyer Ready steps (own step + another participant's, buyer A)", buyerReadyLabels(multiOwnerA), expectedBuyerReady);
assertEqual("Several Buyer Ready steps (own step + another participant's, buyer B)", buyerReadyLabels(multiOwnerB), expectedBuyerReady);

const allMultiIds = (result: ViewResult) => result.timeline.map((entry) => entry.id);
record(
  "No duplicate activity (an activity repeated on a step appears once)",
  [multiEa, multiOwnerA, multiOwnerB].every((result) => new Set(allMultiIds(result)).size === allMultiIds(result).length)
);
assertEqual(
  "Only this chain's Buyer Ready steps: other chains and non-Buyer Ready nodes are excluded",
  [...new Set(allMultiIds(multiEa))].sort(),
  [3110, 3120, 5010, 5011, 5020]
);
assertEqual(
  "Buyer Ready activities carry their source step",
  multiEa.timeline.filter((entry) => entry.source.kind === "buyer_ready").map((entry) => entry.source),
  [
    { kind: "buyer_ready", chainNodeId: 502 },
    { kind: "buyer_ready", chainNodeId: 501 },
    { kind: "buyer_ready", chainNodeId: 501 },
  ]
);
record("Buyer Ready chain (EA): property labels match the chain tile titles", labelsMatchTiles(multiEa));
record("Buyer Ready chain (buyer A): property labels match the chain tile titles", labelsMatchTiles(multiOwnerA));
assertEqual(
  "Buyer A's own purchase is Your Purchase; the other sale keeps its relative title",
  [labelsById(multiOwnerA.timeline)[3110], baseLabel(labelsById(multiOwnerA.timeline)[3120])],
  [CHAIN_TILE_LABEL.yourPurchase, CHAIN_TILE_LABEL.connectedBuyer]
);
record(
  "Unauthorised activity cannot appear: entries come only from the rows and steps supplied",
  view(BR_CHAIN, brRows(null), brEaViewer, []).timeline.every((entry) => entry.source.kind === "property")
);

// ---------------------------------------------------------------------------
// 4. Actor badge
// ---------------------------------------------------------------------------

assertEqual(
  "Actor labels: Estate Agent / Homeowner / System (no raw values, no 'You')",
  ["estate_agent", "homeowner", "system", undefined, null].map((value) => formatActivityUpdaterLabel(value)),
  ["Estate Agent", "Homeowner", "System", "Homeowner", "Homeowner"]
);
assertEqual(
  "Actor badge colours: purple EA, slate System, blue Homeowner",
  ["estate_agent", "system", "homeowner", null].map((value) => getActivityUpdaterBadgeClass(value)),
  ["bg-purple-100 text-purple-700", "bg-slate-200 text-slate-700", "bg-blue-100 text-blue-700", "bg-blue-100 text-blue-700"]
);

const badge = read("components/operational/ActivityActorBadge.tsx");
record(
  "Badge renders the text label (not colour alone) with a screen-reader prefix",
  /formatActivityUpdaterLabel\(updatedBy\)/.test(badge) &&
    /getActivityUpdaterBadgeClass\(updatedBy\)/.test(badge) &&
    /className="sr-only">Updated by </.test(badge)
);

const chainPage = read("app/chain/[chainId]/page.tsx");
const propertyPage = read("app/property/[propertyId]/page.tsx");
const buyerReadyPage = read("app/buyer-ready/[chainId]/page.tsx");
record(
  "Chain page: shared badge replaces the raw 'Updated by {updated_by}' text",
  /<ActivityActorBadge/.test(chainPage) && !/Updated by \{activity\.updated_by/.test(chainPage)
);
record(
  "Property and Buyer Ready pages use the same shared badge",
  [propertyPage, buyerReadyPage].every(
    (source) => /<ActivityActorBadge/.test(source) && !/bg-purple-100 text-purple-700/.test(source)
  )
);
record(
  "Chain page builds the feed from every chain node, not one Buyer Ready step",
  /buildChainActivityTimeline\(\{[\s\S]*?chainNodes,[\s\S]*?\}\)/.test(chainPage) &&
    !/\.\.\.buyerReadyActivities\.map/.test(chainPage)
);
record(
  "Chain page shows the position label and never the activity's address",
  /\{activity\.positionLabel\}/.test(chainPage) && !/activity\.address/.test(chainPage)
);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  process.exit(1);
}
