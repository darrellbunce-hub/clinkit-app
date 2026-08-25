import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  getParticipationDelinkReasonOptions,
  type ParticipationDelinkReasonCode,
} from "@/lib/ownership/participationDelinkReasonCodes";
import {
  mapParticipationDelinkError,
  type ParticipationDelinkExecuteResult,
  type ParticipationDelinkOperation,
  type ParticipationDelinkOption,
  type ParticipationDelinkOptionsResult,
  type ParticipationDelinkSignals,
} from "@/lib/ownership/participationDelinkTypes";

type OptionsRpcRow = {
  ok?: boolean;
  error?: string;
  property_id?: number;
  options?: Array<{
    operation: ParticipationDelinkOperation;
    label: string;
    requires_confirmation?: boolean;
    branch_id?: string | null;
    invitation_pending?: boolean;
    reason_codes?: string[];
  }>;
  signals?: {
    invitation_pending?: boolean;
    meaningful_participation?: boolean;
    is_operational_homeowner?: boolean;
  };
};

type ExecuteRpcRow = {
  ok?: boolean;
  error?: string;
  property_id?: number;
  operation?: ParticipationDelinkOperation;
  reason_code?: string;
  branch_id?: string;
  lifecycle_state?: string;
  invitation_reset?: boolean;
};

function mapReasonCodes(
  operation: ParticipationDelinkOperation,
  codes: string[] | undefined
): ParticipationDelinkReasonCode[] {
  const allowed = getParticipationDelinkReasonOptions(operation).map(
    (option) => option.code
  );

  return (codes ?? allowed).filter((code): code is ParticipationDelinkReasonCode =>
    allowed.includes(code as ParticipationDelinkReasonCode)
  );
}

function mapOptions(row: OptionsRpcRow): ParticipationDelinkOptionsResult {
  if (!row.ok) {
    return { ok: false, error: mapParticipationDelinkError(row.error) };
  }

  const options: ParticipationDelinkOption[] = (row.options ?? []).map(
    (option) => ({
      operation: option.operation,
      label: option.label,
      requiresConfirmation: option.requires_confirmation ?? true,
      branchId: option.branch_id ?? null,
      invitationPending: option.invitation_pending,
      reasonCodes: mapReasonCodes(option.operation, option.reason_codes),
    })
  );

  const signals: ParticipationDelinkSignals = {
    invitationPending: Boolean(row.signals?.invitation_pending),
    meaningfulParticipation: Boolean(row.signals?.meaningful_participation),
    isOperationalHomeowner: Boolean(row.signals?.is_operational_homeowner),
  };

  return {
    ok: true,
    propertyId: row.property_id ?? 0,
    options,
    signals,
  };
}

function mapExecute(row: ExecuteRpcRow): ParticipationDelinkExecuteResult {
  if (!row.ok) {
    return { ok: false, error: mapParticipationDelinkError(row.error) };
  }

  if (!row.operation || !row.reason_code) {
    return { ok: false, error: "De-link completed without an operation result." };
  }

  return {
    ok: true,
    propertyId: row.property_id ?? 0,
    operation: row.operation,
    reasonCode: row.reason_code as ParticipationDelinkReasonCode,
    branchId: row.branch_id,
    lifecycleState: row.lifecycle_state,
    invitationReset: row.invitation_reset,
  };
}

/** Load permission-checked de-link options for the current user. */
export async function getParticipationDelinkOptions(
  supabase: SupabaseClient,
  propertyId: number
): Promise<{
  data: ParticipationDelinkOptionsResult;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc(
    "get_participation_delink_options",
    { p_property_id: propertyId }
  );

  if (error) {
    return {
      data: { ok: false, error: error.message },
      error,
    };
  }

  return {
    data: mapOptions((data ?? {}) as OptionsRpcRow),
    error: null,
  };
}

/** Execute a unified participation de-link operation. */
export async function executeParticipationDelink(
  supabase: SupabaseClient,
  params: {
    propertyId: number;
    operation: ParticipationDelinkOperation;
    reasonCode: ParticipationDelinkReasonCode;
    branchId?: string | null;
  }
): Promise<{
  data: ParticipationDelinkExecuteResult;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc(
    "execute_participation_delink",
    {
      p_property_id: params.propertyId,
      p_operation: params.operation,
      p_reason_code: params.reasonCode,
      p_branch_id: params.branchId ?? null,
    }
  );

  if (error) {
    return {
      data: { ok: false, error: error.message },
      error,
    };
  }

  return {
    data: mapExecute((data ?? {}) as ExecuteRpcRow),
    error: null,
  };
}

export {
  PARTICIPATION_DELINK_OPERATION,
  PARTICIPATION_DELINK_PERMISSION_MATRIX,
  type ParticipationDelinkOption,
  type ParticipationDelinkSignals,
} from "@/lib/ownership/participationDelinkTypes";

export {
  getParticipationDelinkReasonOptions,
  type ParticipationDelinkReasonCode,
  type ParticipationDelinkReasonOption,
} from "@/lib/ownership/participationDelinkReasonCodes";
