import { addressQueryKey, normaliseSearchQuery } from "@/lib/cache/cacheKeys";
import { cacheGetJson, cacheSetJson, type CacheReadResult } from "@/lib/cache/redis";

/** Default TTL for address search results (24 hours). */
export const ADDRESS_SEARCH_CACHE_TTL_SECONDS = 86_400;

/**
 * Payload shape for cached address searches.
 * Extend this type when address lookup is integrated.
 */
export type CachedAddressSearchResult = Record<string, unknown>;

export type AddressCacheReadResult =
  CacheReadResult<CachedAddressSearchResult>;

/**
 * Normalises a user-entered address search string for lookup and cache keys.
 */
export function normaliseAddressSearchQuery(query: string): string {
  return normaliseSearchQuery(query);
}

/**
 * Reads a cached address search result.
 * Returns `{ status: "miss" }` on cache miss and `{ status: "unavailable" }`
 * when Redis is not configured or unreachable.
 */
export async function getCachedAddressSearch(
  query: string
): Promise<AddressCacheReadResult> {
  const normalised = normaliseAddressSearchQuery(query);

  if (!normalised) {
    return { status: "miss" };
  }

  return cacheGetJson<CachedAddressSearchResult>(
    addressQueryKey(normalised)
  );
}

/**
 * Stores an address search result.
 * No-op (returns `{ status: "unavailable" }`) when Redis is unavailable.
 */
export async function cacheAddressSearch(
  query: string,
  result: CachedAddressSearchResult,
  ttlSeconds: number = ADDRESS_SEARCH_CACHE_TTL_SECONDS
): Promise<{ status: "stored" } | { status: "unavailable"; reason: string }> {
  const normalised = normaliseAddressSearchQuery(query);

  if (!normalised) {
    return { status: "unavailable", reason: "empty_query" };
  }

  return cacheSetJson(
    addressQueryKey(normalised),
    result,
    ttlSeconds
  );
}
