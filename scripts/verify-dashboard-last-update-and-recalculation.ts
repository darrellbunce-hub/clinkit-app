/**
 * Offline checks for the EA dashboard "Last updated" rule and the
 * chain-intelligence recalculation schedule.
 *
 *   supabase/migrations/20261005150000_dashboard_last_update_at.sql (historical)
 *   supabase/migrations/20261005170000_dashboard_genuine_last_update.sql
 *   lib/estateAgent/commandCentrePresentation.ts (resolveDaysSinceLastUpdate,
 *     compareLeastRecentlyUpdatedFirst, dashboard sorters)
 *   lib/chainIntelligence/{timingHealth,timingEngine}.ts (next_recalculation_at)
 *   vercel.json (chain-intelligence 30 5 * * *)
 *
 * Usage:
 *   npx tsx scripts/verify-dashboard-last-update-and-recalculation.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  computeStalenessRecalculationCandidates,
  selectNextRecalculationAt,
  STALENESS_RECALCULATION_OFFSETS_DAYS,
} from "../lib/chainIntelligence/timingHealth";
import { computeTimingChainIntelligence } from "../lib/chainIntelligence/timingEngine";
import type { AgentBranchPropertySummary } from "../lib/estateAgent/assignmentTypes";
import {
  compareLeastRecentlyUpdatedFirst,
  formatDaysSinceLastUpdate,
  resolveDaysSinceLastUpdate,
  sortActionRequiredSummaries,
  sortManagedPropertySummaries,
} from "../lib/estateAgent/commandCentrePresentation";

const ROOT = join(import.meta.dirname, "..");
const DAY_MS = 86_400_000;

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function viewSelect(sql: string): string {
  const flat = normalize(sql.replace(/--[^\n]*/g, ""));
  const start = flat.indexOf("create or replace view public.agent_branch_property_summaries");
  const end = flat.indexOf("pea.status in ('active', 'revoked');", start);
  return start > -1 && end > -1 ? flat.slice(start, end) : "";
}

function at(base: Date, days: number): string {
  return new Date(base.getTime() + days * DAY_MS).toISOString();
}

function row(
  id: string,
  lastUpdateAt: string | null,
  extra: Partial<AgentBranchPropertySummary> = {}
): AgentBranchPropertySummary {
  return {
    assignment_id: id,
    property_id: 1,
    branch_id: "branch-1",
    assignment_status: "active",
    homeowner_only_updates: false,
    assigned_at: "2026-01-01T00:00:00.000Z",
    chain_id: 10,
    address: "Fixture",
    postcode: "AB1 2CD",
    stage: "searches_ordered",
    property_status: "healthy",
    completion_lifecycle_status: null,
    completion_scheduled_date: null,
    completed_at: null,
    needs_attention: false,
    last_update_at: lastUpdateAt,
    ...extra,
  };
}

const AGREED_GENUINE_TEXTS = [
  "'searching'",
  "'property listed'",
  "'offer accepted'",
  "'solicitors instructed'",
  "'survey booked'",
  "'mortgage offer received'",
  "'contracts exchanged'",
  "'completion date agreed'",
  "'completed'",
  "'onward purchase added'",
  "'chain connection broken - buyer side'",
  "'chain connection broken - seller side'",
  "p_update like 'delay reported %'",
  "p_update like 'delay resolved %'",
  "p_update like 'delay reported: %'",
  "p_update like ('completion date updated' || chr(10) || '%')",
];

const SYSTEM_NOTICE_TEXTS = [
  "estate agent branch reconnected",
  "archived by lifecycle automation",
  "released for future transactions",
  "homeowner left this transaction",
  "released operational management",
  "withdrew the homeowner association",
  "removed the estate agent branch",
  "onward purchase was unlinked",
  "completion confirmed",
  "awaiting documents",
];

function main() {
  // ---------------------------------------------------------------------------
  // Dashboard "Last updated": Europe/London calendar days from last_update_at
  // ---------------------------------------------------------------------------
  const day1 = new Date("2026-11-02T09:00:00.000Z");
  const day3 = new Date(day1.getTime() + 2 * DAY_MS + 3 * 3_600_000);

  record(
    "Acceptance: activity on Day 1, chain-intelligence run on Day 3 → still 2 days (Day 1), not 0",
    resolveDaysSinceLastUpdate({ last_update_at: day1.toISOString() }, day3) === 2
  );
  record(
    "The count keeps moving with time, with no recalculation",
    resolveDaysSinceLastUpdate(
      { last_update_at: day1.toISOString() },
      new Date(day1.getTime() + 9 * DAY_MS)
    ) === 9
  );
  record(
    "No genuine activity → null → 'No updates recorded', even when a cached count of 0 is present",
    resolveDaysSinceLastUpdate({ last_update_at: null }, day3) === null &&
      resolveDaysSinceLastUpdate({}, day3) === null &&
      resolveDaysSinceLastUpdate(
        { last_update_at: null, days_since_last_update: 0 } as Pick<AgentBranchPropertySummary, "last_update_at">,
        day3
      ) === null &&
      formatDaysSinceLastUpdate(resolveDaysSinceLastUpdate({ last_update_at: null }, day3)) === "No updates recorded"
  );
  record(
    "An invalid timestamp → null; a future timestamp floors at 0",
    resolveDaysSinceLastUpdate({ last_update_at: "not-a-date" }, day3) === null &&
      resolveDaysSinceLastUpdate({ last_update_at: at(day3, 1) }, day3) === 0
  );
  record(
    "GMT: 23:30 yesterday seen at 09:00 (9.5 hours) → 'Updated yesterday', not a rolling 'today'",
    formatDaysSinceLastUpdate(
      resolveDaysSinceLastUpdate(
        { last_update_at: "2026-12-09T23:30:00.000Z" },
        new Date("2026-12-10T09:00:00.000Z")
      )
    ) === "Updated yesterday"
  );
  record(
    "GMT: 00:05 seen at 23:55 the same day → 'Updated today'",
    formatDaysSinceLastUpdate(
      resolveDaysSinceLastUpdate(
        { last_update_at: "2026-12-10T00:05:00.000Z" },
        new Date("2026-12-10T23:55:00.000Z")
      )
    ) === "Updated today"
  );
  record(
    "BST: 00:10 London (23:10 UTC the previous day) seen at 01:30 London → 'Updated today'",
    resolveDaysSinceLastUpdate(
      { last_update_at: "2026-07-09T23:10:00.000Z" },
      new Date("2026-07-10T00:30:00.000Z")
    ) === 0
  );
  record(
    "BST: 23:50 London yesterday seen at 01:30 London → 'Updated yesterday'",
    resolveDaysSinceLastUpdate(
      { last_update_at: "2026-07-09T22:50:00.000Z" },
      new Date("2026-07-10T00:30:00.000Z")
    ) === 1
  );
  record(
    "Across the October clock change: 24 Oct noon seen 26 Oct 00:30 → 2 calendar days",
    resolveDaysSinceLastUpdate(
      { last_update_at: "2026-10-24T12:00:00.000Z" },
      new Date("2026-10-26T00:30:00.000Z")
    ) === 2
  );
  record(
    "Labels: null / 0 / 1 / N use the existing terminology",
    formatDaysSinceLastUpdate(null) === "No updates recorded" &&
      formatDaysSinceLastUpdate(0) === "Updated today" &&
      formatDaysSinceLastUpdate(1) === "Updated yesterday" &&
      formatDaysSinceLastUpdate(5) === "5 days since last update"
  );

  const sortRef = Date.now();
  const daysAgoIso = (days: number) => new Date(sortRef - days * DAY_MS).toISOString();
  const rows = [
    row("today", new Date(sortRef).toISOString()),
    row("three", daysAgoIso(3)),
    row("none", null),
    row("ten", daysAgoIso(10)),
  ];
  const order = (list: AgentBranchPropertySummary[]) => list.map((r) => r.assignment_id).join(",");
  record(
    "Sorting: no genuine activity sorts as oldest, then stalest first, freshest last",
    order([...rows].sort(compareLeastRecentlyUpdatedFirst)) === "none,ten,three,today" &&
      order(sortManagedPropertySummaries(rows)) === "none,ten,three,today",
    order(sortManagedPropertySummaries(rows))
  );
  const attention = rows.map((r) => ({ ...r, needs_attention: true }));
  record(
    "Sorting: action-required list also ranks no genuine activity as oldest",
    order(sortActionRequiredSummaries(attention)) === "none,ten,three,today",
    order(sortActionRequiredSummaries(attention))
  );
  record(
    "Sorting: two properties without genuine activity compare equal (no NaN)",
    compareLeastRecentlyUpdatedFirst(row("a", null), row("b", null)) === 0
  );

  const presentation = read("lib/estateAgent/commandCentrePresentation.ts");
  const card = read("components/agent/commandCentre/OperationalPropertyCard.tsx");
  const workspace = read("lib/estateAgent/workspacePresentation.ts");
  record(
    "Card, sorters and workspace alerts use last_update_at only (no stored-count fallback, no '?? 0')",
    card.includes("resolveDaysSinceLastUpdate(summary)") &&
      !/summary\.days_since_last_update/.test(card) &&
      (workspace.match(/resolveDaysSinceLastUpdate\(summary\)/g) ?? []).length === 3 &&
      (presentation.match(/compareLeastRecentlyUpdatedFirst\(left, right\)/g) ?? []).length === 2 &&
      !presentation.includes("days_since_last_update") &&
      !/resolveDaysSinceLastUpdate\([a-z]+\)\s*\?\?\s*0/.test(presentation) &&
      presentation.includes('timeZone: "Europe/London"')
  );
  record(
    "Summary type exposes last_update_at",
    read("lib/estateAgent/assignmentTypes.ts").includes("last_update_at?: string | null;")
  );

  // Historical: 20261005150000 appended the cached pos.last_update_at.
  const migration150 = read("supabase/migrations/20261005150000_dashboard_last_update_at.sql");
  const previous = read("supabase/migrations/20260720100000_chain_intelligence_timing.sql");
  const view150 = viewSelect(migration150);
  const before = viewSelect(previous);
  record(
    "Historical 20261005150000: identical to 20260720100000 except pos.last_update_at appended last",
    before.length > 0 &&
      view150 === before.replace("cos.eta_algorithm_version from", "cos.eta_algorithm_version, pos.last_update_at from"),
    view150.length === 0 ? "view not found" : undefined
  );

  // 20261005170000: last_update_at / days_since_last_update from genuine activity.
  const migration = read("supabase/migrations/20261005170000_dashboard_genuine_last_update.sql");
  const flatMigration = normalize(migration.replace(/--[^\n]*/g, ""));
  const view170 = viewSelect(migration);
  const daysExpression =
    "case when genuine.last_update_at is null then null else greatest( 0, (now() at time zone 'europe/london')::date - (genuine.last_update_at at time zone 'europe/london')::date ) end as days_since_last_update";
  const genuineJoin =
    "left join lateral ( select max(a.\"timestamp\") as last_update_at from public.activities a where a.property_id = pea.property_id and public.is_genuine_property_activity(a.update, a.updated_by) and ( pea.status = 'active' or pea.revoked_at is null or a.\"timestamp\" <= pea.revoked_at ) ) genuine on true ";
  record(
    "View 170000: identical to 150000 except the two derived columns and the genuine-activity join",
    view170.length > 0 &&
      view170.includes(daysExpression) &&
      view170.includes(genuineJoin) &&
      view170
        .replace(daysExpression, "pos.days_since_last_update")
        .replace(genuineJoin, "")
        .replace("genuine.last_update_at from", "pos.last_update_at from") === view150,
    view170.length === 0 ? "view not found" : undefined
  );
  record(
    "View 170000: never reads the cached summary timestamp, count, computed_at or the dormancy touch",
    !view170.includes("pos.last_update_at") &&
      !view170.includes("pos.days_since_last_update") &&
      !view170.includes("computed_at") &&
      !view170.includes("derived_from_activity_at") &&
      !flatMigration.includes("last_operational_activity_at")
  );
  record(
    "View 170000: definer view kept; authenticated select only; anon refused (postflight)",
    flatMigration.includes("with (security_invoker = false)") &&
      flatMigration.includes("revoke all on public.agent_branch_property_summaries from anon;") &&
      flatMigration.includes("grant select on public.agent_branch_property_summaries to authenticated;") &&
      flatMigration.includes("has_table_privilege('anon', 'public.agent_branch_property_summaries', 'select')")
  );

  const fnStart = flatMigration.indexOf("create or replace function public.is_genuine_property_activity(");
  const fnBody = flatMigration.slice(fnStart, flatMigration.indexOf("$$;", fnStart));
  record(
    "is_genuine_property_activity: immutable SQL, not SECURITY DEFINER, pinned search_path",
    fnStart > -1 &&
      fnBody.includes("language sql immutable set search_path = ''") &&
      !fnBody.includes("security definer")
  );
  record(
    "is_genuine_property_activity: excludes the system author and covers every agreed type",
    fnBody.includes("coalesce(p_updated_by, '') <> 'system'") &&
      AGREED_GENUINE_TEXTS.every((text) => fnBody.includes(text)),
    AGREED_GENUINE_TEXTS.filter((text) => !fnBody.includes(text)).join(" | ")
  );
  record(
    "is_genuine_property_activity: no system notice or unreviewed type is listed",
    SYSTEM_NOTICE_TEXTS.every((text) => !fnBody.includes(text)),
    SYSTEM_NOTICE_TEXTS.filter((text) => fnBody.includes(text)).join(" | ")
  );
  record(
    "is_genuine_property_activity: anon cannot execute; no additional SECURITY DEFINER grants",
    flatMigration.includes(
      "revoke all on function public.is_genuine_property_activity(text, text) from public, anon;"
    ) &&
      flatMigration.includes(
        "grant execute on function public.is_genuine_property_activity(text, text) to authenticated, service_role;"
      ) &&
      !flatMigration.includes("security definer")
  );
  record(
    "activities.timestamp: end-user inserts get now(), end-user updates keep the old value",
    flatMigration.includes("if current_user in ('authenticated', 'anon') then") &&
      flatMigration.includes("if tg_op = 'insert' then new.\"timestamp\" := now(); else new.\"timestamp\" := old.\"timestamp\";") &&
      flatMigration.includes(
        "create trigger trg_activities_server_timestamp before insert or update of \"timestamp\" on public.activities for each row execute function public._trg_activities_server_timestamp();"
      ) &&
      flatMigration.includes(
        "revoke all on function public._trg_activities_server_timestamp() from public, anon, authenticated;"
      )
  );
  record(
    "Index on activities(property_id, timestamp desc)",
    flatMigration.includes(
      "create index if not exists activities_property_id_timestamp_idx on public.activities (property_id, \"timestamp\" desc);"
    )
  );
  record(
    "Migration 170000 creates no activity rows and changes no data",
    !/\b(insert into|update public\.|delete from)\b/.test(flatMigration)
  );

  // ---------------------------------------------------------------------------
  // next_recalculation_at
  // ---------------------------------------------------------------------------
  const ref = new Date("2026-11-20T12:00:00.000Z");

  record(
    "Staleness offsets are +15 and +22 days (page alert 14, confidence 21, strict)",
    JSON.stringify(STALENESS_RECALCULATION_OFFSETS_DAYS) === JSON.stringify([15, 22])
  );
  record(
    "Staleness candidates: latest activity +15/+22; none without activity",
    JSON.stringify(computeStalenessRecalculationCandidates(at(ref, -3))) ===
      JSON.stringify([at(ref, 12), at(ref, 19)]) &&
      computeStalenessRecalculationCandidates(null).length === 0 &&
      computeStalenessRecalculationCandidates("bad").length === 0
  );
  record(
    "selectNextRecalculationAt: earliest strictly future candidate",
    selectNextRecalculationAt([at(ref, 9), at(ref, 2), at(ref, -1), null, "bad"], ref) === at(ref, 2)
  );
  record(
    "selectNextRecalculationAt: the reference instant itself is not future",
    selectNextRecalculationAt([ref.toISOString(), at(ref, 5)], ref) === at(ref, 5)
  );
  record(
    "selectNextRecalculationAt: daily fallback when nothing is in the future",
    selectNextRecalculationAt([at(ref, -10), at(ref, -1)], ref) === at(ref, 1) &&
      selectNextRecalculationAt([], ref) === at(ref, 1)
  );

  const withActivity = (activityDaysAgo: number, update = "Note added") =>
    computeTimingChainIntelligence({
      referenceDate: ref,
      properties: [
        {
          id: 1,
          chainPosition: 1,
          stage: "offer_accepted",
          status: "pending_connection",
          address: "Fixture",
          lastUpdatedDays: activityDaysAgo,
          activities: [{ timestamp: at(ref, -activityDaysAgo), update }],
          stageEnteredAt: null,
        },
      ],
      buyerReadyNode: null,
    });
  const fresh = withActivity(3);
  const pastAlert = withActivity(16);
  const pastBoth = withActivity(30);
  const stageFirst = withActivity(3, "Offer Accepted");
  record(
    "Engine: a stage crossing earlier than staleness wins, and is still future",
    stageFirst.nextRecalculationAt !== null &&
      stageFirst.nextRecalculationAt > ref.toISOString() &&
      stageFirst.nextRecalculationAt < at(ref, 12),
    String(stageFirst.nextRecalculationAt)
  );
  record(
    "Engine: activity 3 days ago → recalculate when the page alert flips (+15 days)",
    fresh.nextRecalculationAt === at(ref, 12),
    String(fresh.nextRecalculationAt)
  );
  record(
    "Engine: activity 16 days ago → recalculate when confidence staleness flips (+22 days)",
    pastAlert.nextRecalculationAt === at(ref, 6),
    String(pastAlert.nextRecalculationAt)
  );
  record(
    "Engine: every threshold passed → daily fallback, never in the past",
    pastBoth.nextRecalculationAt === at(ref, 1),
    String(pastBoth.nextRecalculationAt)
  );

  const stageRef = new Date("2026-06-19T12:00:00.000Z");
  const daysAgo = (days: number) => new Date(stageRef.getTime() - days * DAY_MS).toISOString();
  const exampleC = computeTimingChainIntelligence({
    referenceDate: stageRef,
    properties: [
      {
        id: 1,
        chainPosition: 1,
        stage: "searches_ordered",
        status: "healthy",
        address: "10 High St",
        lastUpdatedDays: 8,
        activities: [{ timestamp: daysAgo(8), update: "Searches Ordered" }],
        stageEnteredAt: daysAgo(8),
      },
      {
        id: 2,
        chainPosition: 2,
        stage: "offer_accepted",
        status: "pending_connection",
        address: "Purchase",
        lastUpdatedDays: 11,
        activities: [],
        stageEnteredAt: null,
      },
    ],
    buyerReadyNode: {
      id: 99,
      stage: "mortgage_in_principle",
      status: "healthy",
      stageEnteredAt: null,
      activities: [],
    },
  });
  record(
    "Engine: confidence unchanged (Example C score 94, display 95 Strong)",
    exampleC.score === 94 && exampleC.displayScore === 95 && exampleC.band === "Strong",
    `score=${exampleC.score} display=${exampleC.displayScore}`
  );
  record(
    "Engine: Example C recalculates at the earliest future candidate (activity +15 days)",
    exampleC.nextRecalculationAt === new Date(stageRef.getTime() + 7 * DAY_MS).toISOString(),
    String(exampleC.nextRecalculationAt)
  );

  const vercel = JSON.parse(read("vercel.json")) as { crons?: { path: string; schedule: string }[] };
  record(
    "Cron: chain-intelligence daily at 05:30 UTC",
    (vercel.crons ?? []).some(
      (c) => c.path === "/api/cron/chain-intelligence" && c.schedule === "30 5 * * *"
    )
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
