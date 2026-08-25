/**
 * Provider-agnostic address lookup types.
 * Stored product fields remain properties.address + properties.postcode only.
 */

export type AddressSuggestion = {
  /** Opaque provider suggestion id — used only for resolve; not stored. */
  id: string;
  /** Display text for the suggestion list. */
  label: string;
};

export type ResolvedAddress = {
  address: string;
  postcode: string;
};

export type AddressLookupErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "query_too_short"
  | "query_too_long"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_timeout"
  | "not_found"
  | "misconfigured";

export type AddressSuggestResult =
  | { ok: true; suggestions: AddressSuggestion[] }
  | { ok: false; error: AddressLookupErrorCode };

export type AddressResolveResult =
  | { ok: true; address: ResolvedAddress }
  | { ok: false; error: AddressLookupErrorCode };

export const ADDRESS_LOOKUP_MIN_QUERY_LENGTH = 3;
export const ADDRESS_LOOKUP_MAX_QUERY_LENGTH = 120;
export const ADDRESS_LOOKUP_DEBOUNCE_MS = 300;
export const ADDRESS_SUGGEST_RATE_LIMIT = {
  limit: 30,
  windowSeconds: 60,
} as const;
export const ADDRESS_RESOLVE_RATE_LIMIT = {
  limit: 10,
  windowSeconds: 60,
} as const;
