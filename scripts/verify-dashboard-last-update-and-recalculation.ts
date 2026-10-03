/**
 * Offline checks for the EA dashboard "Last updated" fix and the
 * chain-intelligence recalculation schedule.
 *
 *   supabase/migrations/20261005150000_dashboard_last_update_at.sql
 *   lib/estateAgent/commandCentrePresentation.ts (resolveDaysSinceLastUpdate)
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
import { resolveDaysSinceLastUpdate } from "../lib/estateAgent/commandCentrePresentation";

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

function main() {
  // ---------------------------------------------------------------------------
  // Dashboard "Last updated"
  // ---------------------------------------------------------------------------
  const day1 = new Date("2026-11-02T09:00:00.000Z");
  const day3 = new Date(day1.getTime() + 2 * DAY_MS + 3 * 3_600_000);

  record(
    "Acceptance: activity on Day 1, chain-intelligence run on Day 3 → still 2 days (Day 1), not 0",
    resolveDaysSinceLastUpdate(
      { last_update_at: day1.toISOString(), days_since_last_update: 0 },
      day3
    ) === 2
  );
  record(
    "Between recalculations the count keeps moving with time",
    resolveDaysSinceLastUpdate(
      { last_update_at: day1.toISOString(), days_since_last_update: 0 },
      new Date(day1.getTime() + 9 * DAY_MS)
    ) === 9
  );
  record(
    "Without last_update_at (pre-migration view) the stored count is used",
    resolveDaysSinceLastUpdate({ last_update_at: null, days_since_last_update: 4 }, day3) === 4 &&
      resolveDaysSinceLastUpdate({ days_since_last_update: null }, day3) === null
  );
  record(
    "An invalid timestamp falls back; a future timestamp floors at 0",
    resolveDaysSinceLastUpdate({ last_update_at: "not-a-date", days_since_last_update: 6 }, day3) === 6 &&
      resolveDaysSinceLastUpdate({ last_update_at: at(day3, 1), days_since_last_update: 6 }, day3) === 0
  );

  const presentation = read("lib/estateAgent/commandCentrePresentation.ts");
  const card = read("components/agent/commandCentre/OperationalPropertyCard.tsx");
  const workspace = read("lib/estateAgent/workspacePresentation.ts");
  record(
    "Dashboard sorters, card and workspace alerts use resolveDaysSinceLastUpdate",
    (presentation.match(/resolveDaysSinceLastUpdate\(/g) ?? []).length >= 3 &&
      card.includes("resolveDaysSinceLastUpdate(summary)") &&
      (workspace.match(/resolveDaysSinceLastUpdate\(summary\)/g) ?? []).length === 3 &&
      !/summary\.days_since_last_update/.test(card)
  );
  record(
    "Summary type exposes last_update_at",
    read("lib/estateAgent/assignmentTypes.ts").includes("last_update_at?: string | null;")
  );

  const migration = read("supabase/migrations/20261005150000_dashboard_last_update_at.sql");
  const previous = read("supabase/migrations/20260720100000_chain_intelligence_timing.sql");
  const current = viewSelect(migration);
  const before = viewSelect(previous);
  record(
    "View: identical to 20260720100000 except pos.last_update_at appended last",
    before.length > 0 &&
      current === before.replace("cos.eta_algorithm_version from", "cos.eta_algorithm_version, pos.last_update_at from"),
    current.length === 0 ? "view not found" : undefined
  );
  const flatMigration = normalize(migration);
  record(
    "View: definer view kept; authenticated select only; anon refused (postflight)",
    flatMigration.includes("with (security_invoker = false)") &&
      flatMigration.includes("revoke all on public.agent_branch_property_summaries from anon;") &&
      flatMigration.includes("grant select on public.agent_branch_property_summaries to authenticated;") &&
      flatMigration.includes("has_table_privilege('anon', 'public.agent_branch_property_summaries', 'select')")
  );
  record(
    "View migration creates no activity rows and changes no data",
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
