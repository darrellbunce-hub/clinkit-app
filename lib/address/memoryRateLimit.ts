/**
 * Best-effort in-process rate limiter for address lookup.
 * Does not require Redis. Limits are per serverless instance (fail-closed
 * within the process; no cross-instance coordination).
 */

export type MemoryRateLimitConfig = {
  limit: number;
  windowSeconds: number;
};

export type MemoryRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const MAX_KEYS = 5_000;

function pruneIfNeeded() {
  if (buckets.size <= MAX_KEYS) return;
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
  if (buckets.size <= MAX_KEYS) return;
  // Drop oldest entries if still over capacity.
  const overflow = buckets.size - MAX_KEYS;
  let removed = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export function consumeMemoryRateLimit(
  route: string,
  identifier: string,
  config: MemoryRateLimitConfig
): MemoryRateLimitResult {
  pruneIfNeeded();
  const key = `${route}:${identifier}`;
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  const allowed = bucket.count <= config.limit;
  return {
    allowed,
    limit: config.limit,
    remaining: Math.max(config.limit - bucket.count, 0),
    resetAt: bucket.resetAt,
  };
}

/** Test helper — clears all in-memory buckets. */
export function resetMemoryRateLimitsForTests() {
  buckets.clear();
}
