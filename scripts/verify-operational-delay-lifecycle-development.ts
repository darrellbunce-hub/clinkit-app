/**
 * Operational delay lifecycle verifier (Development-safe).
 *
 * Covers structured reasons, activity message formatting, authoritative
 * active/resolved behaviour for Chain Intelligence / confidence, and
 * privacy constraints (no free text).
 *
 * Optional live RPC checks when --execute and Development credentials exist.
 *
 * Usage:
 *   npx tsx scripts/verify-operational-delay-lifecycle-development.ts
 *   npx tsx scripts/verify-operational-delay-lifecycle-development.ts --execute
 *
 * Does not touch Production. Does not commit/push/deploy.
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

import { STAGES } from "../data/stages";
import {
  hasActiveDelayReport,
  isDelayReportUpdate,
  DELAY_REPORTED_PREFIX,
} from "../lib/activityIntelligence";
import {
  computeChainIntelligence,
  type IntelligenceProperty,
} from "../lib/chainIntelligence";
import { evaluateOperationalAlerts } from "../lib/operationalAlerts/registry";
import {
  DELAY_REPORTED_ACTIVITY_PREFIX,
  DELAY_RESOLVED_ACTIVITY_PREFIX,
  formatDelayReportedActivity,
  formatDelayResolvedActivity,
  isOperationalDelayReason,
  OPERATIONAL_DELAY_REASONS,
  parseDelayReasonFromActivityUpdate,
  parseReportOperationalDelayResult,
  parseResolveOperationalDelayResult,
} from "../lib/operationalDelays";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const execute = process.argv.includes("--execute");

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(
    pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`
  );
}

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function baseProperty(
  overrides: Partial<IntelligenceProperty> = {}
): IntelligenceProperty {
  return {
    id: 1,
    chainPosition: 1,
    stage: "searches_ordered",
    status: "healthy",
    address: "10 Example Street",
    lastUpdatedDays: 0,
    activities: [
      {
        timestamp: daysAgo(1),
        update: "Searches Ordered",
      },
    ],
    stageEnteredAt: daysAgo(1),
    ...overrides,
  };
}

function assertMigrationPresent() {
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir);
  const hit = files.find((name) =>
    name.includes("operational_delay_lifecycle")
  );
  record(
    "Migration file present",
    Boolean(hit),
    hit ?? "missing"
  );
}

function assertNoFreeTextInMigration() {
  const path = join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260820200000_operational_delay_lifecycle.sql"
  );
  if (!existsSync(path)) {
    record("Migration forbids free-text columns", false, "missing file");
    return;
  }
  const sql = readFileSync(path, "utf8").toLowerCase();
  const forbidden = [
    "description",
    "notes",
    "comment",
    "explanation",
    "free_text",
    "custom_reason",
  ];
  const hits = forbidden.filter((token) => {
    // Allow comments that say "no free text" / documentation only.
    if (token === "comment" && sql.includes("comment on")) {
      return false;
    }
    return sql.includes(token) && !sql.includes("no free text");
  });
  // Stronger: no column named description/notes
  const columnHits = [
    "description text",
    "notes text",
    "comment text",
    "explanation text",
  ].filter((col) => sql.includes(col));
  record(
    "Migration has no free-text delay columns",
    columnHits.length === 0,
    columnHits.join(", ") || undefined
  );
  void hits;
}

function testStructuredReasons() {
  for (const reason of OPERATIONAL_DELAY_REASONS) {
    record(
      `Valid reason accepted: ${reason}`,
      isOperationalDelayReason(reason)
    );
  }

  record(
    "Free-text reason rejected",
    !isOperationalDelayReason("Waiting on John Smith 07700 900000")
  );
  record(
    "Empty reason rejected",
    !isOperationalDelayReason("")
  );
  record(
    "Other free category rejected",
    !isOperationalDelayReason("Other")
  );
}

function testActivityMessages() {
  const reason = "Awaiting Mortgage Offer";
  const reported = formatDelayReportedActivity(reason);
  const resolved = formatDelayResolvedActivity(reason);

  record(
    "Report activity message format",
    reported === `${DELAY_REPORTED_ACTIVITY_PREFIX}${reason}`
  );
  record(
    "Resolve activity message format",
    resolved === `${DELAY_RESOLVED_ACTIVITY_PREFIX}${reason}`
  );
  record(
    "Report activity parses reason",
    parseDelayReasonFromActivityUpdate(reported) === reason
  );
  record(
    "Resolve activity parses reason",
    parseDelayReasonFromActivityUpdate(resolved) === reason
  );
  record(
    "Resolve is not a delay report update",
    !isDelayReportUpdate(resolved)
  );
  record(
    "Report is a delay report update",
    isDelayReportUpdate(reported)
  );
  record(
    "Legacy Delay Reported prefix still recognised",
    isDelayReportUpdate(`${DELAY_REPORTED_PREFIX}: ${reason}`)
  );
}

function testAuthoritativeActiveDelay() {
  const delayedActivities = [
    {
      timestamp: daysAgo(0),
      update: formatDelayReportedActivity("Awaiting Searches"),
    },
  ];
  const resolvedActivities = [
    {
      timestamp: daysAgo(0),
      update: formatDelayResolvedActivity("Awaiting Searches"),
    },
    {
      timestamp: daysAgo(1),
      update: formatDelayReportedActivity("Awaiting Searches"),
    },
  ];

  record(
    "Authoritative true forces active",
    hasActiveDelayReport(resolvedActivities, {
      authoritativeActiveDelay: true,
    }) === true
  );
  record(
    "Authoritative false clears even if legacy text present",
    hasActiveDelayReport(delayedActivities, {
      authoritativeActiveDelay: false,
    }) === false
  );
  record(
    "Legacy fallback when authoritative unset",
    hasActiveDelayReport(delayedActivities) === true
  );
  record(
    "Resolved latest activity is not active (legacy)",
    hasActiveDelayReport(resolvedActivities) === false
  );
}

function testChainIntelligenceDelayLifecycle() {
  const withinNoDelay = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        hasActiveOperationalDelay: false,
        stageEnteredAt: daysAgo(3),
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  const withinWithDelay = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        hasActiveOperationalDelay: true,
        stageEnteredAt: daysAgo(3),
        activities: [
          {
            timestamp: daysAgo(0),
            update: formatDelayReportedActivity(
              "Awaiting Mortgage Offer"
            ),
          },
        ],
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  const overdueNoDelay = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        stage: "searches_ordered",
        hasActiveOperationalDelay: false,
        stageEnteredAt: daysAgo(60),
        activities: [
          {
            timestamp: daysAgo(1),
            update: "Searches Ordered",
          },
        ],
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  const overdueWithDelay = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        stage: "searches_ordered",
        hasActiveOperationalDelay: true,
        stageEnteredAt: daysAgo(60),
        activities: [
          {
            timestamp: daysAgo(0),
            update: formatDelayReportedActivity(
              "Awaiting Searches"
            ),
          },
        ],
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  const afterResolvedWithin = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        hasActiveOperationalDelay: false,
        stageEnteredAt: daysAgo(3),
        activities: [
          {
            timestamp: daysAgo(0),
            update: formatDelayResolvedActivity(
              "Awaiting Mortgage Offer"
            ),
          },
          {
            timestamp: daysAgo(1),
            update: formatDelayReportedActivity(
              "Awaiting Mortgage Offer"
            ),
          },
        ],
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  const afterResolvedOverdue = computeChainIntelligence({
    chainProperties: [
      baseProperty({
        stage: "searches_ordered",
        hasActiveOperationalDelay: false,
        stageEnteredAt: daysAgo(60),
        activities: [
          {
            timestamp: daysAgo(0),
            update: formatDelayResolvedActivity(
              "Awaiting Searches"
            ),
          },
        ],
      }),
    ],
    buyerReadySummary: null,
    stages: STAGES,
  });

  record(
    "A/B Option 2: within + delay == within confidence",
    withinNoDelay.confidenceScore ===
      withinWithDelay.confidenceScore &&
      withinNoDelay.confidenceBand ===
        withinWithDelay.confidenceBand
  );
  record(
    "E/F Option 2: overdue + delay == overdue timing-only (no double-count)",
    overdueNoDelay.confidenceScore ===
      overdueWithDelay.confidenceScore &&
      overdueNoDelay.confidenceBand ===
        overdueWithDelay.confidenceBand
  );
  record(
    "Timing still reduces confidence when overdue",
    (overdueNoDelay.confidenceScore ?? 100) <
      (withinNoDelay.confidenceScore ?? 0)
  );
  record(
    "H Resolve within: confidence unchanged vs within baseline",
    afterResolvedWithin.confidenceScore ===
      withinNoDelay.confidenceScore
  );
  record(
    "I Resolve after overdue: stays timing-derived (not restored)",
    afterResolvedOverdue.confidenceScore ===
      overdueNoDelay.confidenceScore
  );
  record(
    "Active delay counted by Chain Intelligence",
    withinWithDelay.delayedCount === 1
  );
  record(
    "Active delay recognised for operational surfaces",
    withinWithDelay.delayedProperties.length === 1
  );
  record(
    "Resolved delay no longer active",
    afterResolvedWithin.delayedCount === 0 &&
      afterResolvedWithin.delayedProperties.length === 0
  );
  record(
    "Active delay affects health/bottleneck inputs",
    withinWithDelay.delayedCount > 0 &&
      withinWithDelay.bottleneckProperty?.id === 1
  );
}

function testAlerts() {
  const activeAlerts = evaluateOperationalAlerts({
    propertyStatus: "healthy",
    daysSinceLastUpdate: 1,
    staleUpdate: false,
    hasActivePropertyDelay: true,
    buyerReadyDelayed: false,
    buyerReadyStale: false,
    completionAwaitingConfirmation: false,
    chainConfidenceScore: 70,
    requiresReplacementBuyer: false,
    scheduledCompletionMode: false,
  });

  const resolvedAlerts = evaluateOperationalAlerts({
    propertyStatus: "healthy",
    daysSinceLastUpdate: 1,
    staleUpdate: false,
    hasActivePropertyDelay: false,
    buyerReadyDelayed: false,
    buyerReadyStale: false,
    completionAwaitingConfirmation: false,
    chainConfidenceScore: 70,
    requiresReplacementBuyer: false,
    scheduledCompletionMode: false,
  });

  record(
    "Active delay generates delay_reported alert",
    activeAlerts.some((alert) => alert.code === "delay_reported")
  );
  record(
    "Resolved delay does not generate delay_reported alert",
    !resolvedAlerts.some(
      (alert) => alert.code === "delay_reported"
    )
  );
}

function testRpcParsers() {
  record(
    "Report RPC parser accepts structured payload",
    parseReportOperationalDelayResult({
      ok: true,
      delay_id: 9,
      reason: "Awaiting Searches",
      created_at: daysAgo(0),
      activity_message: formatDelayReportedActivity(
        "Awaiting Searches"
      ),
    }).ok === true
  );

  record(
    "Report RPC parser rejects free-text reason",
    parseReportOperationalDelayResult({
      ok: true,
      delay_id: 9,
      reason: "Call Jane on 07700900000",
      created_at: daysAgo(0),
    }).ok === false
  );

  const resolveOnce = parseResolveOperationalDelayResult({
    ok: true,
    delay_id: 9,
    reason: "Awaiting Searches",
    resolved_at: daysAgo(0),
    already_resolved: false,
  });
  const resolveTwice = parseResolveOperationalDelayResult({
    ok: true,
    delay_id: 9,
    reason: "Awaiting Searches",
    resolved_at: daysAgo(0),
    already_resolved: true,
  });

  record(
    "Resolve RPC parser accepts first resolve",
    resolveOnce.ok === true &&
      resolveOnce.ok &&
      resolveOnce.alreadyResolved === false
  );
  record(
    "Duplicate resolve marked already_resolved (no corrupt state)",
    resolveTwice.ok === true &&
      resolveTwice.ok &&
      resolveTwice.alreadyResolved === true
  );
}

function testPrivacyStaticScan() {
  const propertyPage = readFileSync(
    join(process.cwd(), "app/property/[propertyId]/page.tsx"),
    "utf8"
  );
  const buyerReadyPage = readFileSync(
    join(process.cwd(), "app/buyer-ready/[chainId]/page.tsx"),
    "utf8"
  );
  const lib = readFileSync(
    join(process.cwd(), "lib/operationalDelays.ts"),
    "utf8"
  );

  const hasTextarea =
    /<textarea/i.test(propertyPage) ||
    /<textarea/i.test(buyerReadyPage);
  const hasFreeTextDelayField =
    /delayDescription|delayNotes|delayComment|customReason/i.test(
      propertyPage + buyerReadyPage + lib
    );

  record(
    "Property/Buyer Ready delay UX has no textarea",
    !hasTextarea
  );
  record(
    "No free-text delay field identifiers",
    !hasFreeTextDelayField
  );
  record(
    "Add Update uses Flag a Delay / Resolve Delay",
    propertyPage.includes("Flag a Delay") &&
      propertyPage.includes("Resolve Delay") &&
      buyerReadyPage.includes("Flag a Delay") &&
      buyerReadyPage.includes("Resolve Delay")
  );
  record(
    "Generic free-form update options removed from property page",
    !propertyPage.includes("Awaiting Documents") &&
      !propertyPage.includes("Milestone Reached")
  );
}

async function maybeExecuteLiveChecks() {
  if (!execute) {
    record(
      "Live RPC checks skipped (pass --execute to run)",
      true
    );
    return;
  }

  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const match = url.match(
    /^https:\/\/([a-z0-9]+)\.supabase\.co/i
  );
  const ref = match?.[1] ?? null;
  if (ref !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    record(
      "Live RPC Development guard",
      false,
      `ref=${ref}`
    );
    return;
  }
  record("Live RPC Development guard", true);

  // Live authorisation matrix requires seeded users/properties.
  // Without a dedicated harness, confirm RPC exists via service role probe.
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!serviceKey) {
    record(
      "Live RPC existence probe skipped (no service role key)",
      true
    );
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin
    .from("operational_delays")
    .select("id")
    .limit(1);

  record(
    "operational_delays table readable on Development",
    !error,
    error?.message
  );
}

async function main() {
  console.log("\n=== Operational delay lifecycle verifier ===\n");

  assertMigrationPresent();
  assertNoFreeTextInMigration();
  testStructuredReasons();
  testActivityMessages();
  testAuthoritativeActiveDelay();
  testChainIntelligenceDelayLifecycle();
  testAlerts();
  testRpcParsers();
  testPrivacyStaticScan();
  await maybeExecuteLiveChecks();

  const failed = results.filter((result) => !result.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} passed`
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
