import "server-only";

/**
 * Keynetic cache layer (Upstash Redis).
 *
 * Server-only utilities for address lookup, search, rate limiting, dashboards,
 * and analytics. Import from `@/lib/cache` in API routes and server modules.
 */

export {
  ADDRESS_SEARCH_CACHE_TTL_SECONDS,
  cacheAddressSearch,
  getCachedAddressSearch,
  normaliseAddressSearchQuery,
  type AddressCacheReadResult,
  type CachedAddressSearchResult,
} from "@/lib/cache/addressCache";

export {
  addressQueryKey,
  analyticsCacheKey,
  dashboardCacheKey,
  estateAgentSearchKey,
  genericSearchKey,
  normaliseSearchQuery,
  rateLimitKey,
  sanitiseKeySegment,
  solicitorSearchKey,
} from "@/lib/cache/cacheKeys";

export {
  cacheDelete,
  cacheGetJson,
  cacheGetString,
  cacheIncrement,
  cacheSetJson,
  cacheSetString,
  cacheTtl,
  getCacheAvailability,
  getRedisClient,
  getRedisConfig,
  isRedisConfigured,
  resetRedisClientForTests,
  type CacheAvailability,
  type CacheReadResult,
  type CacheReadStatus,
  type CacheWriteResult,
  type CacheWriteStatus,
  type RedisConfig,
} from "@/lib/cache/redis";

export {
  consumeRateLimit,
  peekRateLimit,
  rateLimitHeaders,
  type RateLimitConfig,
  type RateLimitOptions,
  type RateLimitResult,
} from "@/lib/cache/rateLimit";

export {
  SEARCH_CACHE_DEFAULT_TTL_SECONDS,
  cacheEstateAgentSearch,
  cacheSearchResult,
  cacheSolicitorSearch,
  getCachedEstateAgentSearch,
  getCachedSearchResult,
  getCachedSolicitorSearch,
  type SearchCacheNamespace,
  type SearchCacheReadResult,
} from "@/lib/cache/searchCache";
