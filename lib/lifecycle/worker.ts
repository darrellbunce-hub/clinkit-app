import { randomUUID } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAnonymisedAnalyticsSnapshot } from "@/lib/lifecycle/analyticsSnapshot";
import { getLifecycleConfig } from "@/lib/lifecycle/config";
import { processDormancyWarningNotifications } from "@/lib/lifecycle/dormancyWarningNotifications";
import { evaluatePropertyLifecycleFromContext } from "@/lib/lifecycle/evaluate";
import { computeNextLifecycleEvaluationAt } from "@/lib/lifecycle/schedule";
import {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_LIFECYCLE_SCENARIO,
  PROPERTY_OPERATIONAL_STATE,
  type LifecycleConfig,
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
  dormancyWarningNotifications?: Awaited<
    ReturnType<typeof processDormancyWarningNotifications>
  >;
  nextEvaluationAt?: string | null;
};

/**
 * Steps that move a row into dormant. When one is skipped (the warning was
 * reset, the row became active again, or its seller side is represented) or
 * fails, the archive and release steps planned after it must not run.
 */
const DORMANCY_GATE_ACTIONS: ReadonlySet<PropertyLifecycleAction> = new Set([
  PROPERTY_LIFECYCLE_ACTION.expireDormancyWarning,
  PROPERTY_LIFECYCLE_ACTION.markDormant,
]);

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
    case PROPERTY_LIFECYCLE_ACTION.expireDormancyWarning:
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

    const isDormancyGate = DORMANCY_GATE_ACTIONS.has(action);

    if (!result.ok) {
      errors.push({
        action,
        error: result.error ?? "action_failed",
      });
      if (isDormancyGate) break;
      continue;
    }

    if (result.skipped || result.idempotent) {
      skippedActions.push(action);
      if (isDormancyGate) break;
      continue;
    }

    appliedActions.push(action);
  }

  let dormancyWarningNotifications:
    | Awaited<ReturnType<typeof processDormancyWarningNotifications>>
    | undefined;

  const shouldProcessDormancyNotifications =
    appliedActions.includes(PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning) ||
    params.evaluation.context.operationalState ===
      PROPERTY_OPERATIONAL_STATE.dormancyWarning;

  if (shouldProcessDormancyNotifications) {
    try {
      dormancyWarningNotifications = await processDormancyWarningNotifications({
        supabase: params.supabase,
        sourcePropertyId: params.evaluation.propertyId,
        workerRunId,
      });
    } catch (error) {
      errors.push({
        action: PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning,
        error:
          error instanceof Error
            ? error.message
            : "dormancy_warning_notification_failed",
      });
    }
  }

  return {
    propertyId: params.evaluation.propertyId,
    workerRunId,
    evaluation: params.evaluation,
    appliedActions,
    skippedActions,
    errors,
    dormancyWarningNotifications,
  };
}

/** Writes next_evaluation_at; returns false when the write failed. */
async function scheduleNextEvaluation(
  supabase: SupabaseClient,
  propertyId: number,
  nextEvaluationAt: string | null
): Promise<boolean> {
  const { error } = await supabase.rpc(
    "schedule_property_lifecycle_evaluation",
    {
      p_property_id: propertyId,
      p_next_evaluation_at: nextEvaluationAt,
    }
  );

  if (error) {
    console.error(
      `[lifecycle] schedule_property_lifecycle_evaluation failed for property ${propertyId}:`,
      error.message
    );
    return false;
  }

  return true;
}

function retryAt(config: LifecycleConfig, now: Date): string {
  return new Date(now.getTime() + config.workerRetryDelayMs).toISOString();
}

export type LifecycleWorkerBatchResult = {
  workerRunId: string;
  candidateCount: number;
  processedCount: number;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
  results: ApplyLifecyclePlanResult[];
  attemptedPropertyIds: number[];
  /**
   * A candidate already attempted earlier in this run came back (its schedule
   * write failed). The run stops instead of re-processing it.
   */
  repeatedCandidate: boolean;
};

/**
 * Processes one bounded lifecycle worker batch: due, unleased rows earliest
 * first (list_property_lifecycle_worker_candidates). Every processed row is
 * rescheduled, so it leaves the candidate set until its next evaluation.
 */
export async function runPropertyLifecycleWorkerBatch(
  supabase: SupabaseClient,
  options?: {
    batchSize?: number;
    workerRunId?: string;
    evaluatedAt?: Date;
    /** Rows already attempted in this run; seeing one again stops the run. */
    attemptedInRun?: ReadonlySet<number>;
  }
): Promise<LifecycleWorkerBatchResult> {
  const config = getLifecycleConfig();
  const workerRunId = options?.workerRunId ?? randomUUID();
  const batchSize = options?.batchSize ?? config.evaluationBatchSize;
  const attemptedInRun = options?.attemptedInRun ?? new Set<number>();
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

  const candidateIds = ((candidates ?? []) as Array<{ property_id?: number }>)
    .map((row) => row.property_id)
    .filter((id): id is number => typeof id === "number");

  const repeatedCandidate = candidateIds.some((id) => attemptedInRun.has(id));
  const propertyIds = candidateIds.filter((id) => !attemptedInRun.has(id));

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

    const evaluatedAt = options?.evaluatedAt ?? new Date();

    try {
      const context = await service.loadContext(propertyId);

      if (!context) {
        errorCount += 1;
        await scheduleNextEvaluation(
          supabase,
          propertyId,
          retryAt(config, evaluatedAt)
        );
        continue;
      }

      const evaluation = evaluatePropertyLifecycleFromContext(
        context,
        evaluatedAt
      );

      if (evaluation.plannedActions.length === 0) {
        let dormancyWarningNotifications:
          | Awaited<ReturnType<typeof processDormancyWarningNotifications>>
          | undefined;
        let notificationFailed = false;

        if (
          context.operationalState === PROPERTY_OPERATIONAL_STATE.dormancyWarning
        ) {
          try {
            dormancyWarningNotifications =
              await processDormancyWarningNotifications({
                supabase,
                sourcePropertyId: propertyId,
                workerRunId,
              });
          } catch {
            errorCount += 1;
            notificationFailed = true;
          }
        }

        const nextEvaluationAt = notificationFailed
          ? retryAt(config, evaluatedAt)
          : computeNextLifecycleEvaluationAt(context, config, evaluatedAt);

        await scheduleNextEvaluation(supabase, propertyId, nextEvaluationAt);

        skippedCount += 1;
        results.push({
          propertyId,
          workerRunId,
          evaluation,
          appliedActions: [],
          skippedActions: [],
          errors: [],
          dormancyWarningNotifications,
          nextEvaluationAt,
        });
        continue;
      }

      const applyResult = await applyLifecyclePlan({
        supabase,
        evaluation,
        workerRunId,
      });

      const refreshed = await service.loadContext(propertyId);
      const nextEvaluationAt =
        applyResult.errors.length > 0 || !refreshed
          ? retryAt(config, evaluatedAt)
          : computeNextLifecycleEvaluationAt(refreshed, config, evaluatedAt);

      await scheduleNextEvaluation(supabase, propertyId, nextEvaluationAt);

      appliedCount += applyResult.appliedActions.length;
      skippedCount += applyResult.skippedActions.length;
      errorCount += applyResult.errors.length;
      results.push({ ...applyResult, nextEvaluationAt });
    } catch (error) {
      errorCount += 1;
      console.error(
        `[lifecycle] evaluation failed for property ${propertyId}:`,
        error instanceof Error ? error.message : error
      );
      await scheduleNextEvaluation(
        supabase,
        propertyId,
        retryAt(config, evaluatedAt)
      );
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
    attemptedPropertyIds: propertyIds,
    repeatedCandidate,
  };
}

export type LifecycleWorkerRunResult = Omit<
  LifecycleWorkerBatchResult,
  "results" | "attemptedPropertyIds" | "repeatedCandidate"
> & {
  batchCount: number;
  timeBudgetExhausted: boolean;
  stoppedOnRepeatedCandidate: boolean;
};

/**
 * Runs lifecycle batches until no row is due or the time budget is spent.
 * Each processed row is rescheduled into the future, so the next batch sees
 * new rows; a row seen twice in one run stops the run.
 */
export async function runPropertyLifecycleWorker(
  supabase: SupabaseClient,
  options?: {
    batchSize?: number;
    timeBudgetMs?: number;
    evaluatedAt?: Date;
  }
): Promise<LifecycleWorkerRunResult> {
  const config = getLifecycleConfig();
  const workerRunId = randomUUID();
  const deadline = Date.now() + (options?.timeBudgetMs ?? config.workerTimeBudgetMs);
  const attempted = new Set<number>();
  const totals: LifecycleWorkerRunResult = {
    workerRunId,
    candidateCount: 0,
    processedCount: 0,
    appliedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    batchCount: 0,
    timeBudgetExhausted: false,
    stoppedOnRepeatedCandidate: false,
  };

  while (true) {
    if (Date.now() >= deadline) {
      totals.timeBudgetExhausted = true;
      break;
    }

    const batch = await runPropertyLifecycleWorkerBatch(supabase, {
      batchSize: options?.batchSize,
      workerRunId,
      evaluatedAt: options?.evaluatedAt,
      attemptedInRun: attempted,
    });

    for (const id of batch.attemptedPropertyIds) {
      attempted.add(id);
    }

    if (batch.attemptedPropertyIds.length > 0) {
      totals.batchCount += 1;
      totals.candidateCount += batch.candidateCount;
      totals.processedCount += batch.processedCount;
      totals.appliedCount += batch.appliedCount;
      totals.skippedCount += batch.skippedCount;
      totals.errorCount += batch.errorCount;
    }

    if (batch.repeatedCandidate) {
      totals.stoppedOnRepeatedCandidate = true;
      break;
    }

    if (batch.attemptedPropertyIds.length === 0) {
      break;
    }
  }

  return totals;
}
