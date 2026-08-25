import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createDefaultLifecycleContext,
  evaluatePropertyLifecycleFromContext,
} from "@/lib/lifecycle/evaluate";
import {
  assertTransitionAllowed,
  targetStateForAction,
} from "@/lib/lifecycle/transitions";
import type {
  PropertyLifecycleContext,
  PropertyLifecycleEvaluation,
  PropertyLifecycleEvaluationRpcResult,
  PropertyLifecycleSignalsRpcResult,
  PropertyLifecycleTransitionRecord,
  PropertyOperationalState,
} from "@/lib/lifecycle/types";

type LifecycleSignalsRpcPayload = {
  ok?: boolean;
  error?: string;
  context?: PropertyLifecycleContext;
};

type LifecycleEvaluationRpcPayload = {
  ok?: boolean;
  error?: string;
  evaluation?: PropertyLifecycleEvaluation;
};

type RecordTransitionRpcPayload = {
  ok?: boolean;
  error?: string;
  property_id?: number;
  operational_state?: PropertyOperationalState;
};

/**
 * Property Lifecycle service — evaluation and state recording.
 *
 * Phase 1 supports dry-run evaluation and explicit state transitions.
 * Operational cleanup (membership removal, address release) is Phase 2.
 */
export class PropertyLifecycleService {
  constructor(private readonly supabase: SupabaseClient) {}

  /** Loads operational signals from the database RPC. */
  async loadContext(
    propertyId: number
  ): Promise<PropertyLifecycleContext | null> {
    const { data, error } = await this.supabase.rpc(
      "get_property_lifecycle_signals",
      { p_property_id: propertyId }
    );

    if (error) {
      console.error(
        "[lifecycle] get_property_lifecycle_signals failed:",
        error.message
      );
      return null;
    }

    const payload = data as LifecycleSignalsRpcPayload | null;

    if (!payload?.ok || !payload.context) {
      return null;
    }

    return payload.context;
  }

  /** Evaluates lifecycle scenarios for a property (dry-run). */
  async evaluateProperty(
    propertyId: number,
    evaluatedAt?: Date
  ): Promise<PropertyLifecycleEvaluation | null> {
    const context = await this.loadContext(propertyId);

    if (!context) {
      return null;
    }

    return evaluatePropertyLifecycleFromContext(context, evaluatedAt);
  }

  /**
   * Pure evaluation when context is already loaded (e.g. tests, batch workers).
   */
  evaluateContext(
    context: PropertyLifecycleContext,
    evaluatedAt?: Date
  ): PropertyLifecycleEvaluation {
    return evaluatePropertyLifecycleFromContext(context, evaluatedAt);
  }

  /**
   * Records an operational state transition (audit + state row).
   * Does not execute cleanup actions — Phase 2 apply layer only.
   */
  async recordTransition(
    record: PropertyLifecycleTransitionRecord
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    assertTransitionAllowed(record.fromState, record.toState);

    const { data, error } = await this.supabase.rpc(
      "record_property_lifecycle_transition",
      {
        p_property_id: record.propertyId,
        p_to_state: record.toState,
        p_trigger: record.trigger,
        p_scenario: record.scenario,
        p_reason: record.reason,
        p_metadata: record.metadata ?? {},
      }
    );

    if (error) {
      return { ok: false, error: error.message };
    }

    const payload = data as RecordTransitionRpcPayload | null;

    if (!payload?.ok) {
      return {
        ok: false,
        error: payload?.error ?? "transition_failed",
      };
    }

    return { ok: true };
  }

  /**
   * Maps a planned action to a state transition and records it.
   * Returns null when the action does not imply a state change.
   */
  async recordActionTransition(params: {
    propertyId: number;
    currentState: PropertyOperationalState;
    action: string;
    trigger: PropertyLifecycleTransitionRecord["trigger"];
    scenario: PropertyLifecycleTransitionRecord["scenario"];
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ ok: true } | { ok: false; error: string } | null> {
    const toState = targetStateForAction(params.action);

    if (!toState || toState === params.currentState) {
      return null;
    }

    return this.recordTransition({
      propertyId: params.propertyId,
      fromState: params.currentState,
      toState,
      trigger: params.trigger,
      scenario: params.scenario,
      reason: params.reason,
      metadata: params.metadata,
    });
  }

  /** Type-safe RPC result helpers for API routes (Phase 2). */
  static parseSignalsResult(
    data: unknown
  ): PropertyLifecycleSignalsRpcResult {
    const payload = data as LifecycleSignalsRpcPayload | null;

    if (!payload?.ok || !payload.context) {
      return {
        ok: false,
        error: payload?.error ?? "signals_unavailable",
      };
    }

    return { ok: true, context: payload.context };
  }

  static parseEvaluationResult(
    data: unknown
  ): PropertyLifecycleEvaluationRpcResult {
    const payload = data as LifecycleEvaluationRpcPayload | null;

    if (!payload?.ok || !payload.evaluation) {
      return {
        ok: false,
        error: payload?.error ?? "evaluation_unavailable",
      };
    }

    return { ok: true, evaluation: payload.evaluation };
  }
}

export {
  createDefaultLifecycleContext,
  evaluatePropertyLifecycleFromContext,
};
