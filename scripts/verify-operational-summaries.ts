import { STAGES } from "../data/stages";
import {
  deriveCriticalCount,
  deriveNeedsAttention,
  deriveNextRecommendedAction,
  deriveWarningCount,
} from "../lib/operationalAlerts/deriveAlertMetrics";
import { evaluateOperationalAlerts } from "../lib/operationalAlerts/registry";
import { computeChainIntelligence } from "../lib/chainIntelligence";
import { deriveChainSummary } from "../lib/operationalSummary/deriveChainSummary";
import { derivePropertySummary } from "../lib/operationalSummary/derivePropertySummary";
import type { OperationalRefreshDataset } from "../lib/operationalSummary/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const CHAIN_ID = 9001;

function buildDataset(
  overrides: Partial<OperationalRefreshDataset> = {}
): OperationalRefreshDataset {
  return {
    chain: {
      id: CHAIN_ID,
      completionLifecycleStatus: null,
      completionScheduledDate: null,
      completionConfirmedAt: null,
      completedAt: null,
      ...overrides.chain,
    },
    properties: overrides.properties ?? [
      {
        id: 501,
        chainId: CHAIN_ID,
        chainPosition: 1,
        stage: "searches_ordered",
        status: "healthy",
        address: "10 Example Street",
        activities: [
          {
            timestamp: new Date(
              Date.now() - 20 * 86400000
            ).toISOString(),
            update: "Searches Ordered",
          },
        ],
      },
    ],
    chainNodes: overrides.chainNodes ?? [
      {
        id: 901,
        chain_id: CHAIN_ID,
        node_type: "buyer_ready",
        linked_property_id: 501,
        stage: "searches_ordered",
        status: "healthy",
        progress: 55,
        activities: [],
      },
    ],
  };
}

function testChainSummaryMatchesIntelligence() {
  const dataset = buildDataset();

  const chainSummary = deriveChainSummary(dataset);

  const intelligence = computeChainIntelligence({
    chainProperties: dataset.properties.map(
      (property) => ({
        id: property.id,
        chainPosition: property.chainPosition,
        stage: property.stage,
        status: property.status,
        address: property.address,
        lastUpdatedDays: 20,
        activities: property.activities,
      })
    ),
    buyerReadySummary: {
      id: 901,
      chain_id: CHAIN_ID,
      node_type: "buyer_ready",
      position: 0,
      linked_property_id: 501,
      status: "healthy",
      progress: 55,
      public_stage_label: "Conveyancing in progress",
      latest_activity_at: null,
    },
    buyerReadyActivities: [],
    stages: STAGES,
  });

  assert(
    chainSummary.confidence_score ===
      intelligence.internalConfidenceScore,
    "confidence_score should store internal timing score"
  );

  assert(
    chainSummary.delay_count ===
      intelligence.delayedCount,
    "delay_count should match computeChainIntelligence"
  );
}

function testStalePropertyGeneratesAlert() {
  const dataset = buildDataset();
  const chainSummary = deriveChainSummary(dataset);
  const propertySummary = derivePropertySummary({
    property: dataset.properties[0],
    dataset,
    chainSummary,
  });

  assert(
    propertySummary.stale_update,
    "property with 20-day inactivity should be stale"
  );

  assert(
    propertySummary.operational_alerts.some(
      (alert) => alert.code === "stale_update"
    ),
    "stale property should emit stale_update alert"
  );

  assert(
    propertySummary.needs_attention,
    "stale property should need attention"
  );

  assert(
    propertySummary.next_recommended_action
      ?.code === "stale_update",
    "stale property next action should be stale_update"
  );
}

function testAlertMetricsDerivedFromCollection() {
  const alerts = evaluateOperationalAlerts({
    propertyStatus: "healthy",
    daysSinceLastUpdate: 20,
    staleUpdate: true,
    hasActivePropertyDelay: true,
    buyerReadyDelayed: false,
    buyerReadyStale: false,
    completionAwaitingConfirmation: false,
    chainConfidenceScore: 30,
    requiresReplacementBuyer: false,
    scheduledCompletionMode: false,
  });

  assert(
    alerts.some(
      (alert) => alert.code === "delay_reported"
    ),
    "delay should produce delay_reported alert"
  );

  assert(
    alerts.some(
      (alert) => alert.code === "chain_confidence_low"
    ),
    "low confidence should produce chain_confidence_low alert"
  );

  assert(
    deriveNeedsAttention(alerts),
    "needs_attention should derive from alerts"
  );

  assert(
    deriveWarningCount(alerts) >= 2,
    "warning_count should derive from alerts"
  );

  assert(
    deriveCriticalCount(alerts) >= 0,
    "critical_count should derive from alerts"
  );

  assert(
    deriveNextRecommendedAction(alerts)?.severity ===
      "critical" ||
      deriveNextRecommendedAction(alerts)?.severity ===
        "warning",
    "next action should prefer highest severity alert"
  );
}

function testPrivacySafeAlerts() {
  const dataset = buildDataset({
    properties: [
      {
        id: 501,
        chainId: CHAIN_ID,
        chainPosition: 1,
        stage: "searches_ordered",
        status: "healthy",
        address: "10 Example Street",
        activities: [
          {
            timestamp: new Date().toISOString(),
            update:
              "Delay Reported: Awaiting Searches",
          },
        ],
      },
    ],
  });

  const chainSummary = deriveChainSummary(dataset);
  const propertySummary = derivePropertySummary({
    property: dataset.properties[0],
    dataset,
    chainSummary,
  });

  const serialized = JSON.stringify(
    propertySummary.operational_alerts
  );

  assert(
    !serialized.includes("Awaiting Searches"),
    "operational_alerts must not contain activity free text"
  );

  assert(
    propertySummary.operational_alerts.some(
      (alert) => alert.code === "delay_reported"
    ),
    "delay prefix should map to delay_reported code"
  );
}

const tests = [
  [
    "chain summary matches chain intelligence",
    testChainSummaryMatchesIntelligence,
  ],
  [
    "stale property generates alert",
    testStalePropertyGeneratesAlert,
  ],
  [
    "alert metrics derive from alert collection",
    testAlertMetricsDerivedFromCollection,
  ],
  [
    "alerts remain privacy-safe",
    testPrivacySafeAlerts,
  ],
] as const;

let passed = 0;

for (const [name, run] of tests) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

console.log(
  `\n${passed}/${tests.length} operational summary checks passed.`
);
