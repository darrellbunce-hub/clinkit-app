import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CHAIN_COMPLETION_EVENT_TYPE,
  COMPLETION_LIFECYCLE_STATUS,
  computeCompletionCountdown,
  formatCompletionConfirmedAt,
  type ChainCompletionLifecycleRow,
} from "@/lib/completionLifecycle";
import {
  canOperationalParticipantManageChainCompletionDate,
} from "@/lib/recordChainCompletionDate";

export const COMPLETION_CONFIRMATION_ACTIVITY_UPDATE =
  "Completion Confirmed\n\nTransaction marked as completed.";

export type ConfirmChainCompletionResult =
  | {
      ok: true;
      chain: ChainCompletionLifecycleRow;
      activityTarget:
        | {
            kind: "sale";
            propertyId: number;
          }
        | {
            kind: "buyer_ready";
            nodeId: number;
          };
      activityUpdate: string;
    }
  | {
      ok: false;
      message: string;
    };

export function canConfirmChainCompletion(params: {
  completionLifecycleStatus: string | null | undefined;
  completionScheduledDate: string | null | undefined;
  userId: string | null | undefined;
  chainId: number;
  chainProperties: Parameters<
    typeof canOperationalParticipantManageChainCompletionDate
  >[0]["chainProperties"];
  chainNodes: Parameters<
    typeof canOperationalParticipantManageChainCompletionDate
  >[0]["chainNodes"];
  mutationContext?: Parameters<
    typeof canOperationalParticipantManageChainCompletionDate
  >[0]["mutationContext"];
}): boolean {
  if (
    params.completionLifecycleStatus !==
    COMPLETION_LIFECYCLE_STATUS.scheduled
  ) {
    return false;
  }

  if (!params.completionScheduledDate) {
    return false;
  }

  const countdown = computeCompletionCountdown(
    params.completionScheduledDate
  );

  if (countdown.daysRemaining >= 0) {
    return false;
  }

  return canOperationalParticipantManageChainCompletionDate(
    params
  ).ok;
}

export async function confirmChainCompletion(
  supabase: SupabaseClient,
  params: {
    chainId: number;
    userId: string;
    chainProperties: Parameters<
      typeof canOperationalParticipantManageChainCompletionDate
    >[0]["chainProperties"];
    chainNodes: Parameters<
      typeof canOperationalParticipantManageChainCompletionDate
    >[0]["chainNodes"];
    mutationContext?: Parameters<
      typeof canOperationalParticipantManageChainCompletionDate
    >[0]["mutationContext"];
  }
): Promise<ConfirmChainCompletionResult> {
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

  if (
    !canConfirmChainCompletion({
      completionLifecycleStatus:
        existingChain.completion_lifecycle_status,
      completionScheduledDate:
        existingChain.completion_scheduled_date,
      userId: params.userId,
      chainId: params.chainId,
      chainProperties: params.chainProperties,
      chainNodes: params.chainNodes,
    })
  ) {
    return {
      ok: false,
      message:
        "Completion can only be confirmed once the agreed date has passed.",
    };
  }

  const confirmedAt = new Date().toISOString();

  const {
    data: updatedChain,
    error: updateChainError,
  } = await supabase
    .from("chains")
    .update({
      completion_lifecycle_status:
        COMPLETION_LIFECYCLE_STATUS.completed,
      completed_at: confirmedAt,
      completion_confirmed_at: confirmedAt,
      completion_confirmed_by_user_id:
        params.userId,
      completion_confirmed_by_role:
        "participant",
    })
    .eq("id", params.chainId)
    .eq(
      "completion_lifecycle_status",
      COMPLETION_LIFECYCLE_STATUS.scheduled
    )
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
      message:
        "Could not confirm completion. Please try again.",
    };
  }

  const { error: eventError } = await supabase
    .from("chain_completion_events")
    .insert({
      chain_id: params.chainId,
      event_type:
        CHAIN_COMPLETION_EVENT_TYPE.completionConfirmed,
      actor_user_id: params.userId,
      actor_role: "operational_participant",
      scheduled_date:
        existingChain.completion_scheduled_date,
      payload: {
        confirmed_at_display:
          formatCompletionConfirmedAt(confirmedAt),
      },
    });

  if (eventError) {
    console.error(eventError);

    return {
      ok: false,
      message:
        "Completion was confirmed, but the audit event could not be recorded.",
    };
  }

  const activityTarget =
    position.kind === "sale"
      ? {
          kind: "sale" as const,
          propertyId: position.propertyId,
        }
      : {
          kind: "buyer_ready" as const,
          nodeId: position.nodeId,
        };

  return {
    ok: true,
    chain: updatedChain,
    activityTarget,
    activityUpdate:
      COMPLETION_CONFIRMATION_ACTIVITY_UPDATE,
  };
}
