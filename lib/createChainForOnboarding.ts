import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export type CreateChainForOnboardingError =
  | "not_authenticated"
  | "invalid_name"
  | "invalid_access_code"
  | "duplicate_access_code"
  | string;

type CreateChainRpcResult = {
  ok: boolean;
  chain_id?: number;
  access_code?: string;
  error?: string;
};

/**
 * Creates a chain during Start Move onboarding via SECURITY DEFINER RPC.
 * Requires migration 20260610226000 (create_chain_for_onboarding).
 */
export async function createChainForOnboarding(
  supabase: SupabaseClient,
  params: {
    name: string;
    accessCode: string;
  }
): Promise<
  | { chainId: number; accessCode: string; error: null }
  | {
      chainId: null;
      accessCode: null;
      error: CreateChainForOnboardingError;
      rpcError: PostgrestError | null;
    }
> {
  const { data, error } = await supabase.rpc(
    "create_chain_for_onboarding",
    {
      p_name: params.name,
      p_access_code: params.accessCode,
    }
  );

  if (error) {
    return {
      chainId: null,
      accessCode: null,
      error: error.message,
      rpcError: error,
    };
  }

  const result = data as CreateChainRpcResult | null;

  if (!result?.ok) {
    return {
      chainId: null,
      accessCode: null,
      error: result?.error ?? "unknown",
      rpcError: null,
    };
  }

  if (result.chain_id == null) {
    return {
      chainId: null,
      accessCode: null,
      error: "missing_chain_id",
      rpcError: null,
    };
  }

  return {
    chainId: result.chain_id,
    accessCode: result.access_code ?? params.accessCode,
    error: null,
  };
}
