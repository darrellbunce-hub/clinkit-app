import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  OPERATIONAL_IDENTITY_GRANT_VIA,
  type OperationalIdentityGrantVia,
} from "@/lib/ownership/types";
import {
  mapTransactionParticipationError,
} from "@/lib/auth/emailVerificationGate";

export type EstablishOperationalHomeownerResult =
  | { ok: true; propertyId: number; idempotent?: boolean }
  | { ok: false; error: string };

export type GrantCounterpartyParticipationResult =
  | { ok: true; propertyId: number; counterpartyRole: string }
  | { ok: false; error: string };

type GrantRpcRow = {
  ok?: boolean;
  error?: string;
  property_id?: number;
  idempotent?: boolean;
  counterparty_role?: string;
};

/**
 * Approved workflow: grant the single operational homeowner identity for the
 * authenticated user on a sale/purchase property.
 */
export async function establishOperationalHomeowner(
  supabase: SupabaseClient,
  params: {
    propertyId: number;
    grantedVia: OperationalIdentityGrantVia;
  }
): Promise<{ data: EstablishOperationalHomeownerResult; error: PostgrestError | null }> {
  const rpcName =
    params.grantedVia === OPERATIONAL_IDENTITY_GRANT_VIA.startMove
      ? "establish_operational_homeowner_for_created_property"
      : "establish_operational_homeowner";

  const rpcArgs =
    params.grantedVia === OPERATIONAL_IDENTITY_GRANT_VIA.startMove
      ? { p_property_id: params.propertyId }
      : {
          p_property_id: params.propertyId,
          p_granted_via: params.grantedVia,
        };

  const { data, error } = await supabase.rpc(rpcName, rpcArgs);

  if (error) {
    return { data: { ok: false, error: error.message }, error };
  }

  const row = (data ?? {}) as GrantRpcRow;

  if (!row.ok) {
    return {
      data: {
        ok: false,
        error:
          mapTransactionParticipationError(row.error) ??
          row.error ??
          "establish_failed",
      },
      error: null,
    };
  }

  return {
    data: {
      ok: true,
      propertyId: row.property_id ?? params.propertyId,
      idempotent: row.idempotent,
    },
    error: null,
  };
}

/**
 * @deprecated Join-chain counterparty participation must use join_chain_property.
 */
export async function grantCounterpartyParticipation(
  supabase: SupabaseClient,
  params: { propertyId: number }
): Promise<{ data: GrantCounterpartyParticipationResult; error: PostgrestError | null }> {
  void supabase;
  void params;
  return {
    data: { ok: false, error: "not_authorized" },
    error: null,
  };
}

export async function invitePropertyDelegate(
  supabase: SupabaseClient,
  params: {
    propertyId: number;
    delegateUserId: string;
    permissions?: string[];
  }
): Promise<{ ok: boolean; error: PostgrestError | string | null }> {
  const { data, error } = await supabase.rpc("invite_property_delegate", {
    p_property_id: params.propertyId,
    p_delegate_user_id: params.delegateUserId,
    p_permissions: params.permissions ?? ["view"],
  });

  if (error) {
    return { ok: false, error };
  }

  const row = (data ?? {}) as GrantRpcRow;
  return {
    ok: Boolean(row.ok),
    error:
      mapTransactionParticipationError(
        row.error ?? null
      ) ?? row.error ?? null,
  };
}

export async function acceptPropertyDelegate(
  supabase: SupabaseClient,
  params: { propertyId: number }
): Promise<{ ok: boolean; error: PostgrestError | string | null }> {
  const { data, error } = await supabase.rpc("accept_property_delegate", {
    p_property_id: params.propertyId,
  });

  if (error) {
    return { ok: false, error };
  }

  const row = (data ?? {}) as GrantRpcRow;
  return {
    ok: Boolean(row.ok),
    error:
      mapTransactionParticipationError(
        row.error ?? null
      ) ?? row.error ?? null,
  };
}

export { OPERATIONAL_IDENTITY_GRANT_VIA };
