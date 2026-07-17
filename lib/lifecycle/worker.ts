import { randomUUID } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAnonymisedAnalyticsSnapshot } from "@/lib/lifecycle/analyticsSnapshot";
import { getLifecycleConfig } from "@/lib/lifecycle/config";
import { evaluatePropertyLifecycleFromContext } from "@/lib/lifecycle/evaluate";
import {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_LIFECYCLE_SCENARIO,
  type PropertyAnalyticsSnapshotPayload,
  type PropertyLifecycleAction,
  type PropertyLifecycleContext,
  type PropertyLifecycleEvaluation,
  type PropertyLifecycleScenario,
} from "@/lib/lifecycle/types";
import { PropertyLifecycleService } from "@/lib/lifecycle/service";

type ActionRpcResult = {
  ok?: boolean;
  error?: string;
  skipped?: boolean;
  idempotent?: boolean;
  inserted?: boolean;
};

export type ApplyLifecyclePlanResult = {
  propertyId: number;
  workerRunId: string;
  evaluation: PropertyLifecycleEvaluation;
  appliedActions: PropertyLifecycleAction[];
  skippedActions: PropertyLifecycleAction[];
  errors: Array<{ action: PropertyLifecycleAction; error: string }>;
};

function scenarioForAction(
  action: PropertyLifecycleAction,
  evaluation: PropertyLifecycleEvaluation
): PropertyLifecycleScenario | null {
  const recommendation = evaluation.recommendations.find(
    (entry) => entry.action === action
  );

  if (recommendation?.scenario) {
    return recommendation.scenario;
  }

  switch (action) {
    case PROPERTY_LIFECYCLE_ACTION.enterCompletedGrace:
      return PROPERTY_LIFECYCLE_SCENARIO.completedGrace;
    case PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning:
      return PROPERTY_LIFECYCLE_SCENARIO.connectedDormant;
    case PROPERTY_LIFECYCLE_ACTION.markDormant:
      return PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant;
    case PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot:
    case PROPERTY_LIFECYCLE_ACTION.anonymiseHistorical:
      return PROPERTY_LIFECYCLE_SCENARIO.analytics;
    case PROPERTY_LIFECYCLE_ACTION.archiveOperational:
      return PROPERTY_LIFECYCLE_SCENARIO.completedGrace;
    case PROPERTY_LIFECYCLE_ACTION.releaseProperty:
      return PROPERTY_LIFECYCLE_SCENARIO.futureClaim;
    default:
      return null;
  }
}

function reasonForAction(
  action: PropertyLifecycleAction,
  evaluation: PropertyLifecycleEvaluation
): string {
  const recommendation = evaluation.recommendations.find(
    (entry) => entry.action === action
  );

  return recommendation?.reason ?? `worker_${action}`;
}

async function loadSnapshotPostcode(
  supabase: SupabaseClient,
  propertyId: number
): Promise<string | null> {
  const { data } = await supabase
    .from("properties")
    .select("postcode")
    .eq("id", propertyId)
    .maybeSingle();

  return data?.postcode ?? null;
}

async function loadActivityCount(
  supabase: SupabaseClient,
  propertyId: number
): Promise<number> {
  const { count } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);

  return count ?? 0;
}

/**
 * Executes a planned lifecycle action via the service-role RPC layer.
 */
export async function executeLifecycleAction(params: {
  supabase: SupabaseClient;
  propertyId: number;
  action: PropertyLifecycleAction;
  evaluation: PropertyLifecycleEvaluation;
  workerRunId: string;
  context: PropertyLifecycleContext;
}): Promise<ActionRpcResult> {
  const {
    supabase,
    propertyId,
    action,
    evaluation,
    workerRunId,
    context,
  } = params;

  if (action === PROPERTY_LIFECYCLE_ACTION.none) {
    return { ok: true, skipped: true };
  }

  let snapshotPayload: PropertyAnalyticsSnapshotPayload | null = null;

  if (action === PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot) {
    const [postcode, activityCount] = await Promise.all([
      loadSnapshotPostcode(supabase, propertyId),
      loadActivityCount(supabase, propertyId),
    ]);

    snapshotPayload = buildAnonymisedAnalyticsSnapshot({
      context,
      postcode,
      activityCount,
      finalOperationalState: context.operationalState,
    });
  }

  const { data, error } = await supabase.rpc(
    "execute_property_lifecycle_action",
    {
      p_property_id: propertyId,
      p_action: action,
      p_scenario: scenarioForAction(action, evaluation),
      p_reason: reasonForAction(action, evaluation),
      p_worker_run_id: workerRunId,
      p_snapshot_payload: snapshotPayload,
    }
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return (data ?? {}) as ActionRpcResult;
}

/**
 * Applies an evaluated lifecycle plan in deterministic order.
 */
export async function applyLifecyclePlan(params: {
  supabase: SupabaseClient;
  evaluation: PropertyLifecycleEvaluation;
  workerRunId?: string;
}): Promise<ApplyLifecyclePlanResult> {
  const workerRunId = params.workerRunId ?? randomUUID();
  const appliedActions: PropertyLifecycleAction[] = [];
  const skippedActions: PropertyLifecycleAction[] = [];
  const errors: ApplyLifecyclePlanResult["errors"] = [];

  for (const action of params.evaluation.plannedActions) {
    const result = await executeLifecycleAction({
      supabase: params.supabase,
      propertyId: params.evaluation.propertyId,
      action,
      evaluation: params.evaluation,
      workerRunId,
      context: params.evaluation.context,
    });

    if (!result.ok) {
      errors.push({
        action,
        error: result.error ?? "action_failed",
      });
      continue;
    }

    if (result.skipped || result.idempotent) {
      skippedActions.push(action);
      continue;
    }

    appliedActions.push(action);
  }

  return {
    propertyId: params.evaluation.propertyId,
    workerRunId,
    evaluation: params.evaluation,
    appliedActions,
    skippedActions,
    errors,
  };
}

export type LifecycleWorkerBatchResult = {
  workerRunId: string;
  candidateCount: number;
  processedCount: number;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
  results: ApplyLifecyclePlanResult[];
};

/**
 * Processes one bounded lifecycle worker batch.
 */
export async function runPropertyLifecycleWorkerBatch(
  supabase: SupabaseClient,
  options?: {
    batchSize?: number;
    workerRunId?: string;
    evaluatedAt?: Date;
  }
): Promise<LifecycleWorkerBatchResult> {
  const config = getLifecycleConfig();
  const workerRunId = options?.workerRunId ?? randomUUID();
  const batchSize = options?.batchSize ?? config.evaluationBatchSize;
  const service = new PropertyLifecycleService(supabase);

  const { data: candidates, error: candidateError } =
    await supabase.rpc("list_property_lifecycle_worker_candidates", {
      p_limit: batchSize,
    });

  if (candidateError) {
    throw new Error(
      `list_property_lifecycle_worker_candidates failed: ${candidateError.message}`
    );
  }

  const propertyIds = ((candidates ?? []) as Array<{ property_id?: number }>)
    .map((row) => row.property_id)
    .filter((id): id is number => typeof id === "number");

  const results: ApplyLifecyclePlanResult[] = [];
  let appliedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const propertyId of propertyIds) {
    const { data: leased, error: leaseError } = await supabase.rpc(
      "try_acquire_property_lifecycle_lease",
      {
        p_property_id: propertyId,
        p_lease_seconds: config.workerLeaseSeconds,
      }
    );

    if (leaseError || !leased) {
      continue;
    }

    try {
      const context = await service.loadContext(propertyId);

      if (!context) {
        errorCount += 1;
        continue;
      }

      const evaluation = evaluatePropertyLifecycleFromContext(
        context,
        options?.evaluatedAt
      );

      if (evaluation.plannedActions.length === 0) {
        skippedCount += 1;
        results.push({
          propertyId,
          workerRunId,
          evaluation,
          appliedActions: [],
          skippedActions: [],
          errors: [],
        });
        continue;
      }

      const applyResult = await applyLifecyclePlan({
        supabase,
        evaluation,
        workerRunId,
      });

      appliedCount += applyResult.appliedActions.length;
      skippedCount += applyResult.skippedActions.length;
      errorCount += applyResult.errors.length;
      results.push(applyResult);
    } finally {
      await supabase.rpc("release_property_lifecycle_lease", {
        p_property_id: propertyId,
      });
    }
  }

  return {
    workerRunId,
    candidateCount: propertyIds.length,
    processedCount: results.length,
    appliedCount,
    skippedCount,
    errorCount,
    results,
  };
}
