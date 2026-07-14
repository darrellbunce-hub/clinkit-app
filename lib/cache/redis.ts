import { Redis } from "@upstash/redis";

let redisSingleton: Redis | null | undefined;

export type RedisConfig = {
  url: string;
  token: string;
};

export type CacheAvailability =
  | { available: true; client: Redis }
  | { available: false; reason: "not_configured" | "initialisation_failed" };

export type CacheReadStatus = "hit" | "miss" | "unavailable";

export type CacheWriteStatus = "stored" | "unavailable";

export type CacheReadResult<T> =
  | { status: "hit"; value: T }
  | { status: "miss" }
  | { status: "unavailable"; reason: string };

export type CacheWriteResult =
  | { status: "stored" }
  | { status: "unavailable"; reason: string };

/**
 * Reads Upstash credentials from the environment.
 * Returns null when either variable is missing or blank.
 */
export function getRedisConfig(): RedisConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    return null;
  }

  return { url, token };
}

/** True when both Upstash REST env vars are present. */
export function isRedisConfigured(): boolean {
  return getRedisConfig() !== null;
}

/**
 * Returns a singleton Upstash client, or null when Redis is not configured.
 * Safe to call repeatedly; initialisation happens once per process.
 */
export function getRedisClient(): Redis | null {
  if (redisSingleton !== undefined) {
    return redisSingleton;
  }

  const config = getRedisConfig();
  if (!config) {
    redisSingleton = null;
    return null;
  }

  try {
    redisSingleton = new Redis({
      url: config.url,
      token: config.token,
    });
  } catch (error) {
    console.error(
      "[cache] Failed to initialise Upstash Redis client:",
      error instanceof Error ? error.message : error
    );
    redisSingleton = null;
  }

  return redisSingleton;
}

/** Describes whether Redis can be used for the current request/process. */
export function getCacheAvailability(): CacheAvailability {
  const client = getRedisClient();

  if (client) {
    return { available: true, client };
  }

  if (!getRedisConfig()) {
    return { available: false, reason: "not_configured" };
  }

  return { available: false, reason: "initialisation_failed" };
}

type RedisOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_configured" | "operation_failed" };

async function withRedis<T>(
  operation: string,
  fn: (client: Redis) => Promise<T>
): Promise<RedisOperationResult<T>> {
  const availability = getCacheAvailability();

  if (!availability.available) {
    return {
      ok: false,
      reason:
        availability.reason === "not_configured"
          ? "not_configured"
          : "operation_failed",
    };
  }

  try {
    return {
      ok: true,
      value: await fn(availability.client),
    };
  } catch (error) {
    console.error(
      `[cache] Redis ${operation} failed:`,
      error instanceof Error ? error.message : error
    );
    return { ok: false, reason: "operation_failed" };
  }
}

function unavailableReason(
  reason: "not_configured" | "operation_failed"
): string {
  return reason === "not_configured"
    ? "redis_not_configured"
    : "redis_operation_failed";
}

/** Reads a raw string value. */
export async function cacheGetString(
  key: string
): Promise<CacheReadResult<string>> {
  const result = await withRedis("GET", (client) => client.get<string>(key));

  if (!result.ok) {
    return {
      status: "unavailable",
      reason: unavailableReason(result.reason),
    };
  }

  if (result.value === null) {
    return { status: "miss" };
  }

  return {
    status: "hit",
    value: result.value,
  };
}

/** Reads and parses JSON. Unavailable operations return `{ status: "unavailable" }`. */
export async function cacheGetJson<T>(key: string): Promise<CacheReadResult<T>> {
  const result = await withRedis("GET", (client) => client.get<unknown>(key));

  if (!result.ok) {
    return {
      status: "unavailable",
      reason: unavailableReason(result.reason),
    };
  }

  if (result.value === null) {
    return { status: "miss" };
  }

  if (typeof result.value === "string") {
    try {
      return {
        status: "hit",
        value: JSON.parse(result.value) as T,
      };
    } catch (error) {
      console.error(
        `[cache] Failed to parse JSON for key "${key}":`,
        error instanceof Error ? error.message : error
      );
      return { status: "miss" };
    }
  }

  return {
    status: "hit",
    value: result.value as T,
  };
}

/** Stores a raw string with optional TTL (seconds). */
export async function cacheSetString(
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<CacheWriteResult> {
  const result = await withRedis("SET", async (client) => {
    if (ttlSeconds && ttlSeconds > 0) {
      await client.set(key, value, { ex: ttlSeconds });
    } else {
      await client.set(key, value);
    }
    return true;
  });

  if (!result.ok) {
    return {
      status: "unavailable",
      reason: unavailableReason(result.reason),
    };
  }

  return { status: "stored" };
}

/** Serialises and stores JSON with optional TTL (seconds). */
export async function cacheSetJson<T>(
  key: string,
  value: T,
  ttlSeconds?: number
): Promise<CacheWriteResult> {
  const result = await withRedis("SET", async (client) => {
    if (ttlSeconds && ttlSeconds > 0) {
      await client.set(key, value, { ex: ttlSeconds });
    } else {
      await client.set(key, value);
    }
    return true;
  });

  if (!result.ok) {
    return {
      status: "unavailable",
      reason: unavailableReason(result.reason),
    };
  }

  return { status: "stored" };
}

/** Deletes a key. Returns true when Redis confirmed deletion or key was absent. */
export async function cacheDelete(key: string): Promise<boolean> {
  const result = await withRedis("DEL", (client) => client.del(key));
  return result.ok;
}

/** Increments a counter and optionally sets expiry on first increment. */
export async function cacheIncrement(
  key: string,
  windowSeconds?: number
): Promise<number | null> {
  const result = await withRedis("INCR", async (client) => {
    const count = await client.incr(key);

    if (windowSeconds && windowSeconds > 0 && count === 1) {
      await client.expire(key, windowSeconds);
    }

    return count;
  });

  return result.ok ? result.value : null;
}

/** Returns remaining TTL in seconds, or null when key has no expiry. */
export async function cacheTtl(
  key: string
): Promise<number | null | undefined> {
  const result = await withRedis("TTL", (client) => client.ttl(key));

  if (!result.ok) {
    return undefined;
  }

  return result.value;
}

/** Clears the in-process singleton (for tests). */
export function resetRedisClientForTests(): void {
  redisSingleton = undefined;
}
