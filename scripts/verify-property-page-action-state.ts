/**
 * Property page "Action Required" state (offline).
 *
 * The page reads the cached property activity clock (genuine activity, else
 * stage entry / record creation / chain creation) instead of the newest
 * loaded activity, and words the panel for the owner, a delegated EA or an
 * observer.
 *
 * Usage:
 *   npx tsx scripts/verify-property-page-action-state.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import type { OperationalActivity } from "../lib/activityIntelligence";
import {
  cachedPropertyClockDays,
  isCachedPropertyClockBehind,
  type CachedPropertyClock,
} from "../lib/operationalSummary/cachedPropertyClock";
import {
  getBuyerReadyActionMessage,
  getPropertyActionMessage,
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
const NOW = new Date("2026-10-07T12:00:00.000Z");
const daysAgo = (days: number, extraMs = 3_600_000) =>
  new Date(NOW.getTime() - days * DAY_MS - extraMs).toISOString();

const owner: WorkflowAccess = {
  canView: true,
  canEdit: true,
  mode: "editable",
  viewerRole: "owner",
  bannerMessage: null,
};
const delegatedEa: WorkflowAccess = { ...owner, viewerRole: "estate_agent" };
const readOnlyEa: WorkflowAccess = {
  ...owner,
  canEdit: false,
  mode: "read_only",
  viewerRole: "estate_agent",
};
const observer: WorkflowAccess = {
  ...owner,
  canEdit: false,
  mode: "read_only",
  viewerRole: "chain_participant",
};

function clock(params: {
  activityClockAt: string | null;
  lastUpdateAt: string | null;
  computedAt?: string;
}): CachedPropertyClock {
  return {
    property_id: 205,
    chain_id: 199,
    activity_clock_at: params.activityClockAt,
    last_update_at: params.lastUpdateAt,
    computed_at: params.computedAt ?? daysAgo(1),
  };
}

function action(
  access: WorkflowAccess,
  cached: CachedPropertyClock | null,
  options: { delay?: string | null; frozen?: boolean } = {}
) {
  return getPropertyActionMessage({
    access,
    activeDelayReason: options.delay ?? null,
    staleClockDays: cachedPropertyClockDays(cached, NOW),
    isCompletionLifecycleFrozen: options.frozen ?? false,
  });
}

const OWNER_STALE = (days: number) =>
  `No updates have been added for ${days} days. Consider checking progress with your estate agent or conveyancer.`;

// A: genuine activity older than 14 days.
const genuine30 = clock({ activityClockAt: daysAgo(30), lastUpdateAt: daysAgo(30) });
assert("A: genuine activity 30 days ago → 30 clock days", cachedPropertyClockDays(genuine30, NOW) === 30);
assert(
  "A: owner sees Update Recommended",
  action(owner, genuine30).title === "Update Recommended" &&
    action(owner, genuine30).message === OWNER_STALE(30) &&
    action(owner, genuine30).colour === "bg-red-100 text-red-700",
  action(owner, genuine30)
);

// B: no activity, fallback clock older than 14 days.
const fallback97 = clock({ activityClockAt: daysAgo(97), lastUpdateAt: null });
const b = action(owner, fallback97);
assert(
  "B: no activity, fallback clock 97 days → Update Recommended (property 205 case)",
  b.title === "Update Recommended" && b.message === OWNER_STALE(97),
  b
);
assert(
  "B: the fallback date is not presented as Last updated (no date in the panel, last_update_at stays null)",
  fallback97.last_update_at === null &&
    !b.message.includes(fallback97.activity_clock_at!.slice(0, 10)) &&
    !/last updated/i.test(`${b.title} ${b.message}`),
  b
);

// C: no activity, fallback clock at or under 14 days.
for (const days of [0, 10, 14]) {
  const fresh = clock({ activityClockAt: daysAgo(days), lastUpdateAt: null });
  assert(
    `C: no activity, fallback clock ${days} days → no stale alert`,
    action(owner, fresh).title === "No Immediate Actions",
    action(owner, fresh)
  );
}
assert(
  "C: boundary — 15 days on the fallback clock alerts",
  action(owner, clock({ activityClockAt: daysAgo(15), lastUpdateAt: null })).title === "Update Recommended"
);
assert(
  "C: no cached clock (missing summary) → no stale alert",
  cachedPropertyClockDays(null, NOW) === null && action(owner, null).title === "No Immediate Actions"
);

// D: a system notice is the newest activity.
const genuine20 = clock({ activityClockAt: daysAgo(20), lastUpdateAt: daysAgo(20), computedAt: daysAgo(1) });
const withNewerNotice: OperationalActivity[] = [
  { timestamp: daysAgo(20), update: "Solicitors Instructed", updated_by: "homeowner" },
  { timestamp: daysAgo(0, 60_000), update: "Estate agent branch reconnected to this property.", updated_by: "system" },
];
assert(
  "D: a system notice newer than the genuine activity does not reset the stale decision",
  action(owner, genuine20).title === "Update Recommended" &&
    action(owner, genuine20).message === OWNER_STALE(20),
  action(owner, genuine20)
);
assert(
  "D: activity newer than the cached summary asks for a (server-gated) refresh once",
  isCachedPropertyClockBehind(genuine20, withNewerNotice) === true
);

// E: genuine activity resets the clock.
const reset = clock({ activityClockAt: daysAgo(0, 60_000), lastUpdateAt: daysAgo(0, 60_000), computedAt: daysAgo(0, 1_000) });
assert(
  "E: after recalculation, recent genuine activity clears the alert",
  cachedPropertyClockDays(reset, NOW) === 0 && action(owner, reset).title === "No Immediate Actions"
);
assert(
  "E: a cache computed after the newest activity is not behind",
  isCachedPropertyClockBehind(reset, [
    { timestamp: daysAgo(0, 60_000), update: "Searches Ordered", updated_by: "homeowner" },
  ]) === false
);
assert("E: no cache at all is behind", isCachedPropertyClockBehind(null, []) === true);
assert(
  "E: a cache with no loaded activities is not behind",
  isCachedPropertyClockBehind(fallback97, []) === false
);

// F: completed / scheduled (frozen) lifecycle suppresses the stale alert.
assert(
  "F: frozen lifecycle suppresses the stale alert",
  action(owner, fallback97, { frozen: true }).title === "No Immediate Actions"
);
assert(
  "F: frozen lifecycle still shows an active delay report",
  action(owner, fallback97, { frozen: true, delay: "Awaiting mortgage valuation" }).title === "Delay reported"
);

// G: EA and observer wording.
const ea = action(delegatedEa, fallback97);
assert(
  "G: delegated EA sees the EA stale wording",
  ea.title === "Progress Update Recommended" &&
    ea.message === "No updates have been added for 97 days. Consider posting an update on behalf of the homeowner.",
  ea
);
assert(
  "G: delegated EA default is not homeowner wording",
  action(delegatedEa, reset).message === "This transaction appears to be progressing normally."
);
assert(
  "G: read-only EA and other participants see observer wording",
  action(readOnlyEa, reset).message === "This participant's transaction appears to be progressing normally." &&
    action(observer, fallback97).title === "Progress Update Recommended" &&
    action(observer, fallback97).message.includes("This participant may need to check progress")
);
assert(
  "G: owner keeps the existing homeowner wording",
  action(owner, reset).message === "Your transaction appears to be progressing normally."
);

// H: delay behaviour is unchanged.
const delay = "Delay reported — awaiting searches";
assert(
  "H: an active delay with a recent clock shows Delay reported with its reason (amber)",
  action(owner, reset, { delay }).title === "Delay reported" &&
    action(owner, reset, { delay }).message === delay &&
    action(owner, reset, { delay }).colour === "bg-amber-100 text-amber-700"
);
assert(
  "H: as before, a stale clock outranks an active delay on the Property page",
  action(owner, fallback97, { delay }).title === "Update Recommended"
);
assert(
  "H: Buyer Ready keeps its own precedence (delay first) and wording",
  getBuyerReadyActionMessage({
    access: owner,
    activeDelayReport: true,
    latestDelayUpdate: delay,
    buyerLastUpdatedDays: 40,
    isCompletionLifecycleFrozen: false,
  }).title === "Delay reported" &&
    getBuyerReadyActionMessage({
      access: delegatedEa,
      activeDelayReport: false,
      latestDelayUpdate: null,
      buyerLastUpdatedDays: 40,
      isCompletionLifecycleFrozen: false,
    }).title === "Progress Update Recommended" &&
    getBuyerReadyActionMessage({
      access: owner,
      activeDelayReport: false,
      latestDelayUpdate: null,
      buyerLastUpdatedDays: 3,
      isCompletionLifecycleFrozen: false,
    }).message === "Your transaction appears to be progressing normally."
);

// Static wiring: the page uses the cached clock and no browser intelligence.
const root = join(__dirname, "..");
const page = readFileSync(join(root, "app/property/[propertyId]/page.tsx"), "utf8");
const loader = readFileSync(join(root, "lib/operationalSummary/cachedPropertyClock.ts"), "utf8");

assert(
  "Static: the Property page no longer derives staleness from the newest loaded activity",
  !page.includes("daysSinceLastActivity") && !page.includes("STALE_DAYS_PAGE_ALERT")
);
assert(
  "Static: the Property page uses the cached property clock and the shared action helper",
  page.includes("loadCachedPropertyClock(") &&
    page.includes("cachedPropertyClockDays(cachedPropertyClock)") &&
    page.includes("getPropertyActionMessage(")
);
assert(
  "Static: the Property page performs no chain intelligence calculation",
  !/computeChainIntelligence|computeTimingChainIntelligence|deriveChainSummary|derivePropertySummary|selectBottleneckProperty/.test(
    page
  )
);
assert(
  "Static: the cached clock is a single RLS-gated select of property_operational_summary by property_id",
  (loader.match(/\.from\(/g) ?? []).length === 1 &&
    loader.includes('.from("property_operational_summary")') &&
    loader.includes('.eq("property_id", propertyId)') &&
    loader.includes(".maybeSingle()") &&
    !loader.includes(".rpc(")
);
assert(
  "Static: the cached fallback clock is never rendered as a date on the Property page",
  !page.includes("activity_clock_at") && !page.includes("last_update_at")
);
assert(
  "Static: completed lifecycle still hides the Action Required panel",
  page.includes("!isCompletedCompletionMode && cachedClockLoaded")
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  process.exitCode = 1;
}
