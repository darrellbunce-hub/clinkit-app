import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaimOperationalPropertyResult } from "@/lib/propertyClaim/types";
import {
  mapTransactionParticipationError,
} from "@/lib/auth/emailVerificationGate";
import { refreshOperationalSummary } from "@/lib/operationalSummary/refreshOperationalSummary";

type ClaimRpcResult = {
  ok?: boolean;
  error?: string;
  property_id?: number;
  chain_id?: number;
};

export async function claimOperationalProperty(
  supabase: SupabaseClient,
  propertyId: number,
  invitationToken?: string | null
): Promise<ClaimOperationalPropertyResult> {
  const { data, error } = await supabase.rpc(
    "claim_operational_property",
    {
      p_property_id: propertyId,
      p_invitation_token: invitationToken ?? null,
    }
  );

  if (error) {
    return {
      ok: false,
      propertyId: null,
      chainId: null,
      error: error.message,
    };
  }

  const result = data as ClaimRpcResult | null;

  if (
    !result?.ok ||
    result.property_id == null ||
    result.chain_id == null
  ) {
    return {
      ok: false,
      propertyId: null,
      chainId: null,
      error:
        mapTransactionParticipationError(
          result?.error ?? null
        ) ?? result?.error ?? "claim_failed",
    };
  }

  const refreshResult =
    await refreshOperationalSummary(supabase, {
      chainId: result.chain_id,
    });

  if (!refreshResult.ok) {
    console.error(
      "Operational summary refresh after claim failed:",
      refreshResult.error
    );
  }

  return {
    ok: true,
    propertyId: result.property_id,
    chainId: result.chain_id,
    error: null,
  };
}
