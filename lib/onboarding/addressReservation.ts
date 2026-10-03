import type { SupabaseClient } from "@supabase/supabase-js";

import { mapTransactionParticipationError } from "@/lib/auth/emailVerificationGate";

export type StartMoveAddressSide = "selling" | "buying";

export type StartMoveAddressState =
  | { state: "available" }
  | { state: "yours"; chainId: number | null }
  | { state: "awaiting_connection" }
  | { state: "already_represented" };

export type StartMoveAddressCheckResult =
  | ({ ok: true } & StartMoveAddressState)
  | { ok: false; error: string; message: string };

type CheckStartMoveAddressRpcResult = {
  ok?: boolean;
  error?: string;
  state?: string;
  chain_id?: number | null;
};

const CHECK_FAILED_MESSAGE =
  "We could not check this address. Please try again.";

/**
 * Classifies a Start Move address before anything is created. Discloses no
 * other party; "yours" carries the caller's own chain id only.
 */
export async function checkStartMoveAddress(
  supabase: SupabaseClient,
  params: {
    address: string;
    postcode: string;
    side: StartMoveAddressSide;
  }
): Promise<StartMoveAddressCheckResult> {
  const { data, error } = await supabase.rpc(
    "check_start_move_address",
    {
      p_address: params.address,
      p_postcode: params.postcode,
      p_side: params.side,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
      message: CHECK_FAILED_MESSAGE,
    };
  }

  const result = data as CheckStartMoveAddressRpcResult | null;

  if (!result?.ok) {
    const code = result?.error ?? "unknown_error";

    return {
      ok: false,
      error: code,
      message:
        mapTransactionParticipationError(code) ??
        (code === "invalid_address"
          ? "Enter a valid address and postcode."
          : CHECK_FAILED_MESSAGE),
    };
  }

  switch (result.state) {
    case "available":
    case "awaiting_connection":
    case "already_represented":
      return { ok: true, state: result.state };
    case "yours":
      return {
        ok: true,
        state: "yours",
        chainId:
          result.chain_id == null ? null : Number(result.chain_id),
      };
    default:
      return {
        ok: false,
        error: "unknown_state",
        message: CHECK_FAILED_MESSAGE,
      };
  }
}
