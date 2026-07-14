import { rateLimitKey } from "@/lib/cache/cacheKeys";
import {
  cacheIncrement,
  cacheTtl,
  getCacheAvailability,
} from "@/lib/cache/redis";

export type RateLimitConfig = {
  /** Maximum allowed requests within the window. */
  limit: number;
  /** Window size in seconds. */
  windowSeconds: number;
};

export type RateLimitResult = {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Configured maximum for the window. */
  limit: number;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Unix timestamp (ms) when the window resets. */
  resetAt: number;
  /** True when the decision was made without Redis (fail-open). */
  bypassed: boolean;
};

export type RateLimitOptions = {
  /**
   * When Redis is unavailable, allow the request instead of blocking.
   * Defaults to true so cache outages do not take down user flows.
   */
  failOpen?: boolean;
};

function buildBypassedResult(
  config: RateLimitConfig,
  failOpen: boolean
): RateLimitResult {
  const resetAt = Date.now() + config.windowSeconds * 1000;

  return {
    allowed: failOpen,
    limit: config.limit,
    remaining: failOpen ? config.limit : 0,
    resetAt,
    bypassed: true,
  };
}

/**
 * Checks and consumes one unit of quota for a route/identifier pair.
 *
 * Uses a fixed-window counter (`INCR` + `EXPIRE`). This module is a reusable
 * primitive — it does not replace existing invitation email rate limiting yet.
 */
export async function consumeRateLimit(
  route: string,
  identifier: string,
  config: RateLimitConfig,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const failOpen = options.failOpen ?? true;
  const availability = getCacheAvailability();

  if (!availability.available) {
    return buildBypassedResult(config, failOpen);
  }

  const key = rateLimitKey(route, identifier);
  const count = await cacheIncrement(key, config.windowSeconds);

  if (count === null) {
    return buildBypassedResult(config, failOpen);
  }

  const ttl = await cacheTtl(key);
  const resetAt =
    typeof ttl === "number" && ttl > 0
      ? Date.now() + ttl * 1000
      : Date.now() + config.windowSeconds * 1000;

  const allowed = count <= config.limit;
  const remaining = Math.max(config.limit - count, 0);

  return {
    allowed,
    limit: config.limit,
    remaining,
    resetAt,
    bypassed: false,
  };
}

/**
 * Non-mutating rate-limit probe.
 * Prefer {@link consumeRateLimit} at request boundaries; use this for diagnostics.
 */
export async function peekRateLimit(
  route: string,
  identifier: string,
  config: RateLimitConfig,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const failOpen = options.failOpen ?? true;
  const availability = getCacheAvailability();

  if (!availability.available) {
    return buildBypassedResult(config, failOpen);
  }

  const key = rateLimitKey(route, identifier);

  try {
    const current = await availability.client.get<number>(key);
    const ttl = await availability.client.ttl(key);
    const count = typeof current === "number" ? current : 0;
    const resetAt =
      typeof ttl === "number" && ttl > 0
        ? Date.now() + ttl * 1000
        : Date.now() + config.windowSeconds * 1000;

    return {
      allowed: count < config.limit,
      limit: config.limit,
      remaining: Math.max(config.limit - count, 0),
      resetAt,
      bypassed: false,
    };
  } catch (error) {
    console.error(
      "[cache] Rate limit peek failed:",
      error instanceof Error ? error.message : error
    );
    return buildBypassedResult(config, failOpen);
  }
}

/** Standard HTTP response headers derived from a rate-limit decision. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}
