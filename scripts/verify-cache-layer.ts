/**
 * Verifies the Upstash cache layer wiring (no production integrations).
 *
 * Usage:
 *   npx tsx scripts/verify-cache-layer.ts
 *
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, "");
  }
}

import {
  addressQueryKey,
  estateAgentSearchKey,
  rateLimitKey,
} from "../lib/cache/cacheKeys";
import {
  cacheDelete,
  cacheGetJson,
  getCacheAvailability,
  getRedisConfig,
  isRedisConfigured,
  resetRedisClientForTests,
} from "../lib/cache/redis";
import {
  cacheAddressSearch,
  getCachedAddressSearch,
} from "../lib/cache/addressCache";
import {
  cacheEstateAgentSearch,
  cacheSearchResult,
  getCachedEstateAgentSearch,
} from "../lib/cache/searchCache";
import { consumeRateLimit } from "../lib/cache/rateLimit";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  resetRedisClientForTests();

  assert(isRedisConfigured(), "Redis env vars should be configured");
  assert(getRedisConfig()?.url.startsWith("https://"), "Redis URL should be HTTPS");

  const availability = getCacheAvailability();
  assert(availability.available, "Redis should be available");

  const stamp = Date.now();
  const addressQuery = `10 Example Street ${stamp}`;
  const addressKey = addressQueryKey(addressQuery.toLowerCase());
  const searchKey = estateAgentSearchKey(`agency ${stamp}`);
  const limitKey = rateLimitKey("verify-cache-layer", `user-${stamp}`);

  await cacheDelete(addressKey);
  await cacheDelete(searchKey);
  await cacheDelete(limitKey);

  const miss = await getCachedAddressSearch(addressQuery);
  assert(miss.status === "miss", "Expected address cache miss");

  const payload = { results: [{ label: "Example", id: stamp }] };
  const stored = await cacheAddressSearch(addressQuery, payload, 60);
  assert(stored.status === "stored", "Expected address cache store");

  const hit = await getCachedAddressSearch(addressQuery);
  assert(hit.status === "hit", "Expected address cache hit");
  assert(
    hit.status === "hit" && hit.value.results?.[0]?.id === stamp,
    "Cached address payload should round-trip"
  );

  await cacheSearchResult("solicitor", `firm ${stamp}`, { firms: [] }, 60);
  const searchHit = await cacheGetJson<{ firms: unknown[] }>(
    `solicitor:search:firm-${stamp}`
  );
  assert(searchHit.status === "hit", "Expected generic search cache hit");

  await cacheEstateAgentSearch(`branch ${stamp}`, { branches: [stamp] }, 60);
  const eaHit = await getCachedEstateAgentSearch<{ branches: number[] }>(
    `branch ${stamp}`
  );
  assert(eaHit.status === "hit", "Expected estate agent search cache hit");

  const firstLimit = await consumeRateLimit(
    "verify-cache-layer",
    `user-${stamp}`,
    { limit: 2, windowSeconds: 60 }
  );
  assert(firstLimit.allowed && !firstLimit.bypassed, "First rate-limit call allowed");

  const secondLimit = await consumeRateLimit(
    "verify-cache-layer",
    `user-${stamp}`,
    { limit: 2, windowSeconds: 60 }
  );
  assert(secondLimit.allowed, "Second rate-limit call allowed");

  const thirdLimit = await consumeRateLimit(
    "verify-cache-layer",
    `user-${stamp}`,
    { limit: 2, windowSeconds: 60 }
  );
  assert(!thirdLimit.allowed, "Third rate-limit call should be blocked");

  await cacheDelete(addressKey);
  await cacheDelete(searchKey);
  await cacheDelete(limitKey);

  console.log("=== CACHE LAYER VERIFICATION PASSED ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
