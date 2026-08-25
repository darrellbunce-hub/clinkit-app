import {
  estateAgentSearchKey,
  genericSearchKey,
  solicitorSearchKey,
} from "@/lib/cache/cacheKeys";
import {
  cacheGetJson,
  cacheSetJson,
  type CacheReadResult,
  type CacheWriteResult,
} from "@/lib/cache/redis";

/** Default TTL for third-party search results (15 minutes). */
export const SEARCH_CACHE_DEFAULT_TTL_SECONDS = 900;

export type SearchCacheNamespace = "estate-agent" | "solicitor" | (string & {});

export type SearchCacheReadResult<T> = CacheReadResult<T>;

function resolveSearchCacheKey(
  namespace: SearchCacheNamespace,
  query: string
): string {
  switch (namespace) {
    case "estate-agent":
      return estateAgentSearchKey(query);
    case "solicitor":
      return solicitorSearchKey(query);
    default:
      return genericSearchKey(namespace, query);
  }
}

/**
 * Reads a cached search result for any supported namespace.
 */
export async function getCachedSearchResult<T>(
  namespace: SearchCacheNamespace,
  query: string
): Promise<SearchCacheReadResult<T>> {
  const trimmed = query.trim();

  if (!trimmed) {
    return { status: "miss" };
  }

  return cacheGetJson<T>(resolveSearchCacheKey(namespace, trimmed));
}

/**
 * Stores a search result for any supported namespace.
 */
export async function cacheSearchResult<T>(
  namespace: SearchCacheNamespace,
  query: string,
  result: T,
  ttlSeconds: number = SEARCH_CACHE_DEFAULT_TTL_SECONDS
): Promise<CacheWriteResult> {
  const trimmed = query.trim();

  if (!trimmed) {
    return { status: "unavailable", reason: "empty_query" };
  }

  return cacheSetJson(
    resolveSearchCacheKey(namespace, trimmed),
    result,
    ttlSeconds
  );
}

/** Convenience wrapper for estate agent directory/search APIs. */
export async function getCachedEstateAgentSearch<T>(
  query: string
): Promise<SearchCacheReadResult<T>> {
  return getCachedSearchResult<T>("estate-agent", query);
}

/** Convenience wrapper for estate agent directory/search APIs. */
export async function cacheEstateAgentSearch<T>(
  query: string,
  result: T,
  ttlSeconds?: number
): Promise<CacheWriteResult> {
  return cacheSearchResult("estate-agent", query, result, ttlSeconds);
}

/** Convenience wrapper for solicitor directory/search APIs. */
export async function getCachedSolicitorSearch<T>(
  query: string
): Promise<SearchCacheReadResult<T>> {
  return getCachedSearchResult<T>("solicitor", query);
}

/** Convenience wrapper for solicitor directory/search APIs. */
export async function cacheSolicitorSearch<T>(
  query: string,
  result: T,
  ttlSeconds?: number
): Promise<CacheWriteResult> {
  return cacheSearchResult("solicitor", query, result, ttlSeconds);
}
