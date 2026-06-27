import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CHAIN_COMPLETION_EVENT_TYPE,
  COMPLETION_DATE_AGREED_STAGE,
  COMPLETION_DATE_ALREADY_RECORDED_MESSAGE,
  COMPLETION_LIFECYCLE_STATUS,
  COMPLETION_SCHEDULING_GUIDANCE,
  hasOperationalPositionReachedContractsExchanged,
  isOperationalPositionAtCompletionDateAgreed,
  isValidCompletionScheduledDateInput,
  type ChainCompletionLifecycleRow,
} from "@/lib/completionLifecycle";
import {
  canMutateBuyerReadyTarget,
  canMutatePropertyTarget,
  OPERATIONAL_EDIT_DENIED_MESSAGE,
  type OperationalBuyerReadyNode,
  type OperationalProperty,
} from "@/lib/operationalPosition";
import {
  resolveMutationOperationalPosition,
  type MutationPermissionContext,
} from "@/lib/mutationPermission";

export type RecordChainCompletionDateResult =
  | {
      ok: true;
      chain: ChainCompletionLifecycleRow;
    }
  | {
      ok: false;
      message: string;
    };

export type OperationalCompletionManagementAccess =
  | {
      ok: true;
      position:
        | {
            kind: "sale";
            propertyId: number;
          }
        | {
            kind: "buyer_ready";
            nodeId: number;
          };
    }
  | {
      ok: false;
      message: string;
    };

export function canOperationalParticipantManageChainCompletionDate(params: {
  userId: string | null | undefined;
  chainId: number;
  chainProperties: OperationalProperty[];
  chainNodes: OperationalBuyerReadyNode[];
  mutationContext?: MutationPermissionContext;
}): OperationalCompletionManagementAccess {
  if (!params.userId) {
    return {
      ok: false,
      message: OPERATIONAL_EDIT_DENIED_MESSAGE,
    };
  }

  const { position } = resolveMutationOperationalPosition({
    viewerUserId: params.userId,
    chainId: params.chainId,
    chainProperties: params.chainProperties,
    chainNodes: params.chainNodes,
    mutationContext: params.mutationContext,
  });

  if (!position) {
    return {
      ok: false,
      message: OPERATIONAL_EDIT_DENIED_MESSAGE,
    };
  }

  const canManage =
    position.kind === "sale"
      ? canMutatePropertyTarget(
          params.chainProperties.find(
            (property) =>
              property.id === position.propertyId
          ),
          params.userId,
          params.chainProperties,
          params.chainNodes,
          params.mutationContext
        )
      : canMutateBuyerReadyTarget(
          position.nodeId,
          params.chainId,
          params.userId,
          params.chainProperties,
          params.chainNodes,
          params.mutationContext
        );

  if (!canManage) {
    return {
      ok: false,
      message: OPERATIONAL_EDIT_DENIED_MESSAGE,
    };
  }

  return {
    ok: true,
    position,
  };
}

export async function recordChainCompletionDate(
  supabase: SupabaseClient,
  params: {
    chainId: number;
    userId: string;
    scheduledDate: string;
    chainProperties: OperationalProperty[];
    chainNodes: OperationalBuyerReadyNode[];
    mutationContext?: MutationPermissionContext;
  }
): Promise<RecordChainCompletionDateResult> {
  const managementAccess =
    canOperationalParticipantManageChainCompletionDate(
      {
        userId: params.userId,
        chainId: params.chainId,
        chainProperties: params.chainProperties,
        chainNodes: params.chainNodes,
        mutationContext: params.mutationContext,
      }
    );

  if (!managementAccess.ok) {
    return {
      ok: false,
      message: managementAccess.message,
    };
  }

  const { position } = managementAccess;

  if (
    !hasOperationalPositionReachedContractsExchanged(
      position,
      params.chainProperties,
      params.chainNodes
    )
  ) {
    return {
      ok: false,
      message: COMPLETION_SCHEDULING_GUIDANCE,
    };
  }

  if (
    !isValidCompletionScheduledDateInput(
      params.scheduledDate
    )
  ) {
    return {
      ok: false,
      message: "Enter a valid agreed completion date.",
    };
  }

  const {
    data: existingChain,
    error: existingChainError,
  } = await supabase
    .from("chains")
    .select(
      `
        id,
        completion_lifecycle_status,
        completion_scheduled_date,
        completion_date_recorded_at,
        completion_date_recorded_by_user_id,
        completion_date_updated_at,
        completion_date_updated_by_user_id,
        completion_confirmed_at,
        completion_confirmed_by_user_id,
        completion_confirmed_by_role,
        completed_at
      `
    )
    .eq("id", params.chainId)
    .single();

  if (existingChainError || !existingChain) {
    console.error(existingChainError);

    return {
      ok: false,
      message: "Could not load this chain.",
    };
  }

  if (existingChain.completion_scheduled_date) {
    return {
      ok: false,
      message: COMPLETION_DATE_ALREADY_RECORDED_MESSAGE,
    };
  }

  const recordedAt = new Date().toISOString();

  const {
    data: updatedChain,
    error: updateChainError,
  } = await supabase
    .from("chains")
    .update({
      completion_lifecycle_status:
        COMPLETION_LIFECYCLE_STATUS.scheduled,
      completion_scheduled_date:
        params.scheduledDate,
      completion_date_recorded_at: recordedAt,
      completion_date_recorded_by_user_id:
        params.userId,
      completion_date_updated_at: null,
      completion_date_updated_by_user_id: null,
    })
    .eq("id", params.chainId)
    .is("completion_scheduled_date", null)
    .select(
      `
        id,
        completion_lifecycle_status,
        completion_scheduled_date,
        completion_date_recorded_at,
        completion_date_recorded_by_user_id,
        completion_date_updated_at,
        completion_date_updated_by_user_id,
        completion_confirmed_at,
        completion_confirmed_by_user_id,
        completion_confirmed_by_role,
        completed_at
      `
    )
    .single();

  if (updateChainError || !updatedChain) {
    console.error(updateChainError);

    return {
      ok: false,
      message: COMPLETION_DATE_ALREADY_RECORDED_MESSAGE,
    };
  }

  const { error: eventError } = await supabase
    .from("chain_completion_events")
    .insert({
      chain_id: params.chainId,
      event_type:
        CHAIN_COMPLETION_EVENT_TYPE.completionDateRecorded,
      actor_user_id: params.userId,
      actor_role: "operational_participant",
      scheduled_date: params.scheduledDate,
      payload: {
        operational_position_kind: position.kind,
      },
    });

  if (eventError) {
    console.error(eventError);

    return {
      ok: false,
      message:
        "Completion date was saved, but the completion event could not be recorded.",
    };
  }

  if (position.kind === "sale") {
    const { error: propertyStageError } =
      await supabase
        .from("properties")
        .update({
          stage: COMPLETION_DATE_AGREED_STAGE,
        })
        .eq("id", position.propertyId);

    if (propertyStageError) {
      console.error(propertyStageError);
    }
  } else {
    const { error: buyerReadyStageError } =
      await supabase
        .from("chain_nodes")
        .update({
          stage: COMPLETION_DATE_AGREED_STAGE,
          progress: 100,
          status: "healthy",
        })
        .eq("id", position.nodeId);

    if (buyerReadyStageError) {
      console.error(buyerReadyStageError);
    }
  }

  return {
    ok: true,
    chain: updatedChain,
  };
}

export function canShowCompletionSchedulingForm(params: {
  chainScheduledDate: string | null | undefined;
  userId: string | null | undefined;
  chainId: number;
  chainProperties: OperationalProperty[];
  chainNodes: OperationalBuyerReadyNode[];
  mutationContext?: MutationPermissionContext;
}): boolean {
  return canShowOperationalCompletionDateEntry(params);
}

export function canShowOperationalCompletionDateEntry(params: {
  chainScheduledDate: string | null | undefined;
  userId: string | null | undefined;
  chainId: number;
  chainProperties: OperationalProperty[];
  chainNodes: OperationalBuyerReadyNode[];
  mutationContext?: MutationPermissionContext;
}): boolean {
  if (params.chainScheduledDate) {
    return false;
  }

  if (!params.userId) {
    return false;
  }

  const managementAccess =
    canOperationalParticipantManageChainCompletionDate(
      params
    );

  if (!managementAccess.ok) {
    return false;
  }

  return isOperationalPositionAtCompletionDateAgreed(
    managementAccess.position,
    params.chainProperties,
    params.chainNodes
  );
}
