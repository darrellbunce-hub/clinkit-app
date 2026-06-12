import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CHAIN_COMPLETION_EVENT_TYPE,
  COMPLETION_LIFECYCLE_STATUS,
  formatCompletionAmendmentActivityUpdate,
  getCompletionAmendmentReasonLabel,
  isCompletionAmendmentReasonCode,
  isValidCompletionScheduledDateInput,
  type ChainCompletionLifecycleRow,
  type CompletionAmendmentReasonCode,
} from "@/lib/completionLifecycle";
import {
  canOperationalParticipantManageChainCompletionDate,
} from "@/lib/recordChainCompletionDate";

export type AmendChainCompletionDateResult =
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

export function canAmendChainCompletionDate(params: {
  chainScheduledDate: string | null | undefined;
  chainLifecycleStatus: string | null | undefined;
  userId: string | null | undefined;
  chainId: number;
  chainProperties: Parameters<
    typeof canOperationalParticipantManageChainCompletionDate
  >[0]["chainProperties"];
  chainNodes: Parameters<
    typeof canOperationalParticipantManageChainCompletionDate
  >[0]["chainNodes"];
}): boolean {
  if (!params.chainScheduledDate) {
    return false;
  }

  if (
    params.chainLifecycleStatus !==
    COMPLETION_LIFECYCLE_STATUS.scheduled
  ) {
    return false;
  }

  return canOperationalParticipantManageChainCompletionDate(
    params
  ).ok;
}

export async function amendChainCompletionDate(
  supabase: SupabaseClient,
  params: {
    chainId: number;
    userId: string;
    newScheduledDate: string;
    reasonCode: string;
    chainProperties: Parameters<
      typeof canOperationalParticipantManageChainCompletionDate
    >[0]["chainProperties"];
    chainNodes: Parameters<
      typeof canOperationalParticipantManageChainCompletionDate
    >[0]["chainNodes"];
  }
): Promise<AmendChainCompletionDateResult> {
  if (
    !isCompletionAmendmentReasonCode(
      params.reasonCode
    )
  ) {
    return {
      ok: false,
      message: "Select a reason for the date change.",
    };
  }

  if (
    !isValidCompletionScheduledDateInput(
      params.newScheduledDate
    )
  ) {
    return {
      ok: false,
      message: "Enter a valid agreed completion date.",
    };
  }

  const managementAccess =
    canOperationalParticipantManageChainCompletionDate(
      {
        userId: params.userId,
        chainId: params.chainId,
        chainProperties: params.chainProperties,
        chainNodes: params.chainNodes,
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
    !canAmendChainCompletionDate({
      chainScheduledDate:
        existingChain.completion_scheduled_date,
      chainLifecycleStatus:
        existingChain.completion_lifecycle_status,
      userId: params.userId,
      chainId: params.chainId,
      chainProperties: params.chainProperties,
      chainNodes: params.chainNodes,
    })
  ) {
    return {
      ok: false,
      message:
        "This completion date can no longer be amended.",
    };
  }

  const previousScheduledDate =
    existingChain.completion_scheduled_date!;

  if (
    previousScheduledDate ===
    params.newScheduledDate
  ) {
    return {
      ok: false,
      message:
        "Choose a different completion date to continue.",
    };
  }

  const updatedAt = new Date().toISOString();

  const {
    data: updatedChain,
    error: updateChainError,
  } = await supabase
    .from("chains")
    .update({
      completion_scheduled_date:
        params.newScheduledDate,
      completion_date_updated_at: updatedAt,
      completion_date_updated_by_user_id:
        params.userId,
    })
    .eq("id", params.chainId)
    .eq(
      "completion_lifecycle_status",
      COMPLETION_LIFECYCLE_STATUS.scheduled
    )
    .eq(
      "completion_scheduled_date",
      previousScheduledDate
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
        "Could not update the completion date. Please try again.",
    };
  }

  const reasonCode =
    params.reasonCode as CompletionAmendmentReasonCode;

  const { error: eventError } = await supabase
    .from("chain_completion_events")
    .insert({
      chain_id: params.chainId,
      event_type:
        CHAIN_COMPLETION_EVENT_TYPE.completionDateChanged,
      actor_user_id: params.userId,
      actor_role: "operational_participant",
      scheduled_date: params.newScheduledDate,
      previous_scheduled_date:
        previousScheduledDate,
      reason_code: reasonCode,
      payload: {
        reason_label:
          getCompletionAmendmentReasonLabel(
            reasonCode
          ),
        operational_position_kind: position.kind,
      },
    });

  if (eventError) {
    console.error(eventError);

    return {
      ok: false,
      message:
        "Completion date was updated, but the audit event could not be recorded.",
    };
  }

  const activityUpdate =
    formatCompletionAmendmentActivityUpdate(
      previousScheduledDate,
      params.newScheduledDate,
      reasonCode
    );

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
    activityUpdate,
  };
}

export const COMPLETION_AMENDMENT_UNAVAILABLE_MESSAGE =
  "Only an operational participant can change the chain completion date while it is scheduled.";
