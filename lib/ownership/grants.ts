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

export type StartMoveCreatePropertyResult =
  | { ok: true; propertyId: number }
  | { ok: false; error: string; outcomeUnknown: boolean };

/**
 * Start Move: inserts the caller's sale or purchase into their own onboarding
 * chain and grants their operational homeowner identity in one transaction,
 * so a failed grant never leaves a property behind.
 *
 * A refusal in the response ({ ok: false }) means nothing was written. Any
 * other failure may follow a commit whose response was lost, so the chain is
 * read back for the exact property requested; outcomeUnknown is set if it
 * still cannot be seen.
 */
export async function createStartMoveProperty(
  supabase: SupabaseClient,
  params: {
    chainId: number;
    relationshipType: "sale" | "purchase";
    address: string;
    postcode: string;
    awaitingBuyer: boolean;
  }
): Promise<StartMoveCreatePropertyResult> {
  const { data, error } = await supabase.rpc("start_move_create_property", {
    p_chain_id: params.chainId,
    p_relationship_type: params.relationshipType,
    p_address: params.address,
    p_postcode: params.postcode,
    p_awaiting_buyer: params.awaitingBuyer,
  });

  if (error) {
    const existingId = await findStartMoveProperty(supabase, params);

    if (existingId != null) {
      return { ok: true, propertyId: existingId };
    }

    return { ok: false, error: error.message, outcomeUnknown: true };
  }

  const row = (data ?? {}) as GrantRpcRow;

  if (!row.ok || row.property_id == null) {
    return {
      ok: false,
      error:
        mapTransactionParticipationError(row.error) ??
        row.error ??
        "create_failed",
      outcomeUnknown: row.ok !== false,
    };
  }

  return { ok: true, propertyId: row.property_id };
}

async function findStartMoveProperty(
  supabase: SupabaseClient,
  params: {
    chainId: number;
    relationshipType: "sale" | "purchase";
    address: string;
    postcode: string;
  }
): Promise<number | null> {
  const { data, error } = await supabase
    .from("properties")
    .select("id")
    .eq("chain_id", params.chainId)
    .eq("relationship_type", params.relationshipType)
    .eq("is_searching", false)
    .eq("address", params.address.trim())
    .eq("postcode", params.postcode.trim())
    .limit(1)
    .maybeSingle();

  if (error || data == null) {
    return null;
  }

  return Number(data.id);
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
