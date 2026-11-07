/**
 * Join Chain: adding a carried, accepted onward purchase after a seller-side
 * join. The purchase is only ever created by converting the joined property's
 * Searching placeholder (convert_searching_placeholder_for_sale), which
 * re-checks permission, the placeholder and duplicate addresses on the
 * server. Failures never undo the join.
 */

/**
 * - none: nothing carried, or not a seller-side join; the ordinary join runs.
 * - convert_existing_link: the joined property already links onward. No
 *   Searching placeholder is created; the server converts the existing link
 *   only if it is still Searching and otherwise leaves it untouched.
 * - searching_then_convert: no onward link yet; the Searching step runs first.
 */
export type CarriedOnwardPurchasePlan =
  | "none"
  | "convert_existing_link"
  | "searching_then_convert";

export function planCarriedOnwardPurchase(params: {
  joiningRole: string | null | undefined;
  hasCarriedOnwardPurchase: boolean;
  joinedPropertyLinkedId: number | null | undefined;
}): CarriedOnwardPurchasePlan {
  if (!params.hasCarriedOnwardPurchase || params.joiningRole !== "seller") {
    return "none";
  }

  return params.joinedPropertyLinkedId != null
    ? "convert_existing_link"
    : "searching_then_convert";
}

export function shouldAddCarriedOnwardPurchase(params: {
  plan: CarriedOnwardPurchasePlan;
  searchingPlaceholderLinked: boolean;
}): boolean {
  return (
    params.plan === "convert_existing_link" ||
    (params.plan === "searching_then_convert" &&
      params.searchingPlaceholderLinked)
  );
}

/** Structural subset of ConvertSearchingPlaceholderResult. */
export type OnwardPurchaseConversionResult =
  | { ok: true }
  | { ok: false; reason: string; error?: unknown };

export type OnwardPurchaseOutcome =
  | "added"
  | "already_linked"
  | "duplicate_address"
  | "retry"
  | "support"
  | "uncertain";

const RETRYABLE_RPC_ERRORS = new Set(["not_authenticated"]);

function readConversionFailure(error: unknown): {
  transportCode: string | null | undefined;
  rpcError: string | undefined;
} {
  const failure = (error ?? {}) as {
    transportError?: { code?: string | null } | null;
    applicationPayload?: { error?: unknown } | null;
  };

  return {
    transportCode: failure.transportError
      ? (failure.transportError.code ?? null)
      : undefined,
    rpcError:
      typeof failure.applicationPayload?.error === "string"
        ? failure.applicationPayload.error
        : undefined,
  };
}

/**
 * `null` means the attempt threw. A transport error without a database or
 * PostgREST code (network failure, timeout, gateway error) may still have
 * committed, as may an `update_failed` from the server's guarded update
 * (the row changed underneath it), so both are reported as uncertain.
 */
export function classifyOnwardPurchaseConversion(
  result: OnwardPurchaseConversionResult | null
): OnwardPurchaseOutcome {
  if (result === null) {
    return "uncertain";
  }

  if (result.ok) {
    return "added";
  }

  if (result.reason === "duplicate_address") {
    return "duplicate_address";
  }

  if (result.reason === "not_authorized") {
    return "support";
  }

  const { transportCode, rpcError } = readConversionFailure(result.error);

  if (transportCode !== undefined) {
    return transportCode ? "retry" : "uncertain";
  }

  if (rpcError === undefined || rpcError === "update_failed") {
    return "uncertain";
  }

  if (rpcError === "not_searching_placeholder") {
    return "already_linked";
  }

  return RETRYABLE_RPC_ERRORS.has(rpcError) ? "retry" : "support";
}

export function onwardPurchaseOutcomeMessage(
  outcome: OnwardPurchaseOutcome
): string | null {
  switch (outcome) {
    case "added":
      return null;
    case "already_linked":
      return "You have joined the chain. The property you are selling already has an onward purchase in this chain, so nothing further was added. Open your chain to check it.";
    case "duplicate_address":
      return "You have joined the chain, but the property you are buying is already on MoveLoop, so it could not be added again. Your next home shows as Searching for now. For what to do next, see Help & FAQs.";
    case "retry":
      return "You have joined the chain, but we could not add the property you are buying. Open your chain and, if your next home still shows as Searching, use Add Onward Purchase to try again.";
    case "support":
      return "You have joined the chain, but we could not add the property you are buying. Open your chain to check it. For what to do next, see Help & FAQs.";
    case "uncertain":
      return "You have joined the chain, but we could not confirm whether the property you are buying was added. Please open your chain and check before trying again.";
  }
}
