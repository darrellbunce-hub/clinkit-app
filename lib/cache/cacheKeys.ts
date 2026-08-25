/**
 * Standardised Redis key builders for Keynetic.
 *
 * Always use these functions instead of ad-hoc string concatenation so key
 * namespaces stay consistent across address lookup, search, rate limiting,
 * dashboards, and analytics.
 */

const KEY_SEGMENT_PATTERN = /[^a-z0-9._-]+/g;

/**
 * Normalises free-text search input for stable cache keys.
 * Trims, lowercases, and collapses internal whitespace.
 */
export function normaliseSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Sanitises a key segment to a safe lowercase token. */
export function sanitiseKeySegment(segment: string): string {
  return segment.trim().toLowerCase().replace(KEY_SEGMENT_PATTERN, "-");
}

/** `address:query:<normalised-search>` */
export function addressQueryKey(normalisedSearch: string): string {
  return `address:query:${sanitiseKeySegment(normalisedSearch)}`;
}

/** `estate-agent:search:<query>` */
export function estateAgentSearchKey(query: string): string {
  return `estate-agent:search:${sanitiseKeySegment(normaliseSearchQuery(query))}`;
}

/** `solicitor:search:<query>` */
export function solicitorSearchKey(query: string): string {
  return `solicitor:search:${sanitiseKeySegment(normaliseSearchQuery(query))}`;
}

/** `rate-limit:<route>:<identifier>` */
export function rateLimitKey(route: string, identifier: string): string {
  return `rate-limit:${sanitiseKeySegment(route)}:${sanitiseKeySegment(identifier)}`;
}

/** `search:<namespace>:<query>` — generic search namespace helper. */
export function genericSearchKey(namespace: string, query: string): string {
  return `search:${sanitiseKeySegment(namespace)}:${sanitiseKeySegment(normaliseSearchQuery(query))}`;
}

/** `dashboard:<scope>:<identifier>` */
export function dashboardCacheKey(scope: string, identifier: string): string {
  return `dashboard:${sanitiseKeySegment(scope)}:${sanitiseKeySegment(identifier)}`;
}

/** `analytics:<scope>:<identifier>` */
export function analyticsCacheKey(scope: string, identifier: string): string {
  return `analytics:${sanitiseKeySegment(scope)}:${sanitiseKeySegment(identifier)}`;
}
