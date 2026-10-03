import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  mapTransactionParticipationError,
} from "@/lib/auth/emailVerificationGate";

type RpcResult = {
  ok: boolean;
  error?: string;
  chain_id?: number;
  access_code?: string;
  property_id?: number;
  claim_status?: string;
};

/** Agents originate sales only; a purchase's EA connects for its seller. */
export type OriginateOperationalPropertyInput = {
  chainId: number;
  relationshipType: "sale";
  address: string;
  postcode: string;
  branchId: string;
  homeownerOnlyUpdates: boolean;
  inviteEmail?: string | null;
  awaitingBuyer?: boolean;
};

export type JoinOperationalChainInput = {
  accessCode: string;
  relationshipType: "sale";
  address: string;
  postcode: string;
  branchId: string;
  homeownerOnlyUpdates: boolean;
  inviteEmail?: string | null;
  awaitingBuyer?: boolean;
};

function mapRpcError(
  error: PostgrestError | null,
  result: RpcResult | null
): string {
  const rpcError =
    mapTransactionParticipationError(
      result?.error ?? null
    ) ?? result?.error;

  if (rpcError) {
    return rpcError;
  }

  if (error?.message) {
    return error.message;
  }

  return "unknown_error";
}

export async function createEaOperationalChain(
  supabase: SupabaseClient,
  params: {
    name: string;
    accessCode: string;
  }
): Promise<
  | {
      chainId: number;
      accessCode: string;
      error: null;
    }
  | {
      chainId: null;
      accessCode: null;
      error: string;
    }
> {
  const { data, error } = await supabase.rpc(
    "create_ea_operational_chain",
    {
      p_name: params.name,
      p_access_code: params.accessCode,
    }
  );

  const result = data as RpcResult | null;

  if (error || !result?.ok || result.chain_id == null) {
    return {
      chainId: null,
      accessCode: null,
      error: mapRpcError(error, result),
    };
  }

  return {
    chainId: result.chain_id,
    accessCode:
      result.access_code ?? params.accessCode,
    error: null,
  };
}

export async function createEaOperationalProperty(
  supabase: SupabaseClient,
  input: OriginateOperationalPropertyInput
): Promise<
  | {
      propertyId: number;
      chainId: number;
      claimStatus: string;
      error: null;
    }
  | {
      propertyId: null;
      chainId: null;
      claimStatus: null;
      error: string;
    }
> {
  const { data, error } = await supabase.rpc(
    "create_ea_operational_property",
    {
      p_chain_id: input.chainId,
      p_relationship_type: input.relationshipType,
      p_address: input.address,
      p_postcode: input.postcode,
      p_branch_id: input.branchId,
      p_homeowner_only_updates:
        input.homeownerOnlyUpdates,
      p_invite_email: input.inviteEmail ?? null,
      p_awaiting_buyer: input.awaitingBuyer ?? false,
    }
  );

  const result = data as RpcResult | null;

  if (
    error ||
    !result?.ok ||
    result.property_id == null ||
    result.chain_id == null
  ) {
    return {
      propertyId: null,
      chainId: null,
      claimStatus: null,
      error: mapRpcError(error, result),
    };
  }

  return {
    propertyId: result.property_id,
    chainId: result.chain_id,
    claimStatus: result.claim_status ?? "unclaimed",
    error: null,
  };
}

export async function joinEaOperationalChain(
  supabase: SupabaseClient,
  input: JoinOperationalChainInput
): Promise<
  | {
      propertyId: number;
      chainId: number;
      claimStatus: string;
      error: null;
    }
  | {
      propertyId: null;
      chainId: null;
      claimStatus: null;
      error: string;
    }
> {
  const { data, error } = await supabase.rpc(
    "join_ea_operational_chain",
    {
      p_access_code: input.accessCode,
      p_relationship_type: input.relationshipType,
      p_address: input.address,
      p_postcode: input.postcode,
      p_branch_id: input.branchId,
      p_homeowner_only_updates:
        input.homeownerOnlyUpdates,
      p_invite_email: input.inviteEmail ?? null,
      p_awaiting_buyer: input.awaitingBuyer ?? false,
    }
  );

  const result = data as RpcResult | null;

  if (
    error ||
    !result?.ok ||
    result.property_id == null ||
    result.chain_id == null
  ) {
    return {
      propertyId: null,
      chainId: null,
      claimStatus: null,
      error: mapRpcError(error, result),
    };
  }

  return {
    propertyId: result.property_id,
    chainId: result.chain_id,
    claimStatus: result.claim_status ?? "unclaimed",
    error: null,
  };
}

/**
 * The seller's EA takes the seller side of a purchase that is awaiting its
 * seller (access code + address). Writes the branch assignment only.
 */
export async function connectEaToAwaitingProperty(
  supabase: SupabaseClient,
  input: {
    accessCode: string;
    address: string;
    postcode: string;
    branchId: string;
  }
): Promise<
  | { propertyId: number; chainId: number; error: null }
  | { propertyId: null; chainId: null; error: string }
> {
  const { data, error } = await supabase.rpc(
    "connect_ea_to_awaiting_property",
    {
      p_access_code: input.accessCode,
      p_address: input.address,
      p_postcode: input.postcode,
      p_branch_id: input.branchId,
    }
  );

  const result = data as RpcResult | null;

  if (
    error ||
    !result?.ok ||
    result.property_id == null ||
    result.chain_id == null
  ) {
    return {
      propertyId: null,
      chainId: null,
      error: mapRpcError(error, result),
    };
  }

  return {
    propertyId: result.property_id,
    chainId: result.chain_id,
    error: null,
  };
}

import { generateAccessCode } from "@/lib/accessCode/generateAccessCode";

export function generateOperationalAccessCode(): string {
  return generateAccessCode();
}
