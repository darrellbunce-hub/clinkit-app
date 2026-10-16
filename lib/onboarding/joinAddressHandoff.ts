/**
 * Start Move → Join Chain address hand-over.
 *
 * Held only in this browser tab's memory: a full page load (refresh, new tab,
 * sign-out) discards it and Join Chain falls back to the normal picker. It is
 * a convenience, not evidence of ownership; join_chain_property still checks
 * the access code, address and postcode. Never log, persist or put it in a URL.
 */

export const JOIN_ADDRESS_HANDOFF_TTL_MS = 15 * 60 * 1000;

export type JoinAddressHandoffAddress = {
  address: string;
  postcode: string;
};

export type JoinAddressHandoff = {
  userId: string;
  address: string;
  postcode: string;
  /** Accepted onward purchase to add after a seller-side join. */
  onwardPurchase: JoinAddressHandoffAddress | null;
  expiresAt: number;
};

let current: JoinAddressHandoff | null = null;

function isCompleteAddress(
  value: JoinAddressHandoffAddress | null | undefined
): value is JoinAddressHandoffAddress {
  return (
    value != null && value.address.trim() !== "" && value.postcode.trim() !== ""
  );
}

export function setJoinAddressHandoff(
  params: {
    userId: string;
    address: string;
    postcode: string;
    onwardPurchase?: JoinAddressHandoffAddress | null;
  },
  now: number = Date.now()
): void {
  if (!params.userId || !isCompleteAddress(params)) {
    current = null;
    return;
  }

  current = {
    userId: params.userId,
    address: params.address,
    postcode: params.postcode,
    onwardPurchase: isCompleteAddress(params.onwardPurchase)
      ? {
          address: params.onwardPurchase.address,
          postcode: params.onwardPurchase.postcode,
        }
      : null,
    expiresAt: now + JOIN_ADDRESS_HANDOFF_TTL_MS,
  };
}

/** Returns the unexpired hand-over, if any; an expired one is discarded. */
export function peekJoinAddressHandoff(
  now: number = Date.now()
): JoinAddressHandoff | null {
  if (current && current.expiresAt <= now) {
    current = null;
  }

  return current;
}

export function isJoinAddressHandoffUsable(
  handoff: JoinAddressHandoff | null,
  userId: string | null | undefined,
  now: number = Date.now()
): handoff is JoinAddressHandoff {
  return (
    handoff != null &&
    userId != null &&
    handoff.userId === userId &&
    handoff.expiresAt > now
  );
}

export function clearJoinAddressHandoff(): void {
  current = null;
}
