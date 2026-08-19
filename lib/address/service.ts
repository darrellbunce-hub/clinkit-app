import "server-only";

import { consumeMemoryRateLimit } from "@/lib/address/memoryRateLimit";
import { getAddressLookupProvider } from "@/lib/address/providers";
import type { ResolvedAddress } from "@/lib/address/types";
import {
  ADDRESS_LOOKUP_MAX_QUERY_LENGTH,
  ADDRESS_LOOKUP_MIN_QUERY_LENGTH,
  ADDRESS_RESOLVE_RATE_LIMIT,
  ADDRESS_SUGGEST_RATE_LIMIT,
  type AddressResolveResult,
  type AddressSuggestResult,
} from "@/lib/address/types";

type ResolveCacheEntry = {
  value: ResolvedAddress;
  expiresAt: number;
};

const RESOLVE_CACHE_TTL_MS = 5 * 60 * 1000;
const resolveCache = new Map<string, ResolveCacheEntry>();

function getCachedResolve(id: string): ResolvedAddress | null {
  const entry = resolveCache.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    resolveCache.delete(id);
    return null;
  }
  return entry.value;
}

function setCachedResolve(id: string, value: ResolvedAddress) {
  if (resolveCache.size > 500) {
    const first = resolveCache.keys().next().value;
    if (first) resolveCache.delete(first);
  }
  resolveCache.set(id, {
    value,
    expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS,
  });
}

export function parseSuggestQuery(
  raw: unknown
):
  | { ok: true; query: string }
  | { ok: false; error: "invalid_request" | "query_too_short" | "query_too_long" } {
  if (typeof raw !== "string") {
    return { ok: false, error: "invalid_request" };
  }
  const query = raw.trim().replace(/\s+/g, " ");
  if (!query) {
    return { ok: false, error: "invalid_request" };
  }
  if (query.length < ADDRESS_LOOKUP_MIN_QUERY_LENGTH) {
    return { ok: false, error: "query_too_short" };
  }
  if (query.length > ADDRESS_LOOKUP_MAX_QUERY_LENGTH) {
    return { ok: false, error: "query_too_long" };
  }
  return { ok: true, query };
}

export function parseResolveId(
  raw: unknown
):
  | { ok: true; id: string }
  | { ok: false; error: "invalid_request" } {
  if (typeof raw !== "string") {
    return { ok: false, error: "invalid_request" };
  }
  const id = raw.trim();
  if (!id || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return { ok: false, error: "invalid_request" };
  }
  return { ok: true, id };
}

export async function suggestAddressesForUser(
  userId: string,
  rawQuery: unknown
): Promise<AddressSuggestResult> {
  const parsed = parseSuggestQuery(rawQuery);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const rate = consumeMemoryRateLimit(
    "address-suggest",
    userId,
    ADDRESS_SUGGEST_RATE_LIMIT
  );
  if (!rate.allowed) {
    return { ok: false, error: "rate_limited" };
  }

  const provider = getAddressLookupProvider();
  return provider.suggest(parsed.query);
}

export async function resolveAddressForUser(
  userId: string,
  rawId: unknown
): Promise<AddressResolveResult> {
  const parsed = parseResolveId(rawId);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const cached = getCachedResolve(parsed.id);
  if (cached) {
    return { ok: true, address: cached };
  }

  const rate = consumeMemoryRateLimit(
    "address-resolve",
    userId,
    ADDRESS_RESOLVE_RATE_LIMIT
  );
  if (!rate.allowed) {
    return { ok: false, error: "rate_limited" };
  }

  const provider = getAddressLookupProvider();
  const result = await provider.resolve(parsed.id);
  if (result.ok) {
    setCachedResolve(parsed.id, result.address);
  }
  return result;
}
