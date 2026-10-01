/**
 * Service-role CLI for smoke fixtures (Development or Production with service role).
 *
 * Examples:
 *   npx tsx scripts/smoke-test-fixture-cli.ts create-registry --label "EA smoke 2026-09"
 *   npx tsx scripts/smoke-test-fixture-cli.ts register-ea --fixture-id <uuid> --user-id <uuid>
 *   npx tsx scripts/smoke-test-fixture-cli.ts register-owned-property --fixture-id <uuid> --property-id 123 --chain-id 456
 *   npx tsx scripts/smoke-test-fixture-cli.ts cleanup-dry-run --fixture-id <uuid>
 *
 * Does NOT execute destructive cleanup unless --execute --confirm-fixture-id <uuid>.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { cleanupSmokeTestFixture } from "../lib/smokeTest/cleanup";
import { createSyntheticSmokeTestFixture } from "../lib/smokeTest/createSyntheticFixture";
import {
  createSmokeTestFixture,
  registerEaOrgForSmokeFixture,
  registerSmokeTestFixtureObject,
} from "../lib/smokeTest/registry";

function loadEnv() {
  try {
    const envText = readFileSync(".env.local", "utf8");
    for (const line of envText.split("\n")) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^"|"$/g, "");
      }
    }
  } catch {
    // optional
  }
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  loadEnv();
  const command = process.argv[2];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }

  // Safety: refuse Production destructive unless explicitly opted in.
  const isProduction =
    url.includes("qguwzsdonffgfebchfqy") ||
    hasFlag("--production");
  if (isProduction && command === "cleanup-execute" && !hasFlag("--i-understand-production")) {
    console.error(
      "Refusing Production cleanup-execute without --i-understand-production"
    );
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (command === "create-registry") {
    const label = arg("--label");
    if (!label) throw new Error("--label required");
    const result = await createSmokeTestFixture(admin, { label });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "create-synthetic") {
    const label = arg("--label") ?? `synthetic-${Date.now()}`;
    const result = await createSyntheticSmokeTestFixture(admin, { label });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "register-ea") {
    const fixtureId = arg("--fixture-id");
    const userId = arg("--user-id");
    if (!fixtureId || !userId) throw new Error("--fixture-id and --user-id required");
    const result = await registerEaOrgForSmokeFixture(admin, {
      fixtureId,
      authUserId: userId,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "register-owned-property") {
    const fixtureId = arg("--fixture-id");
    const propertyId = Number(arg("--property-id"));
    const chainId = Number(arg("--chain-id"));
    if (!fixtureId || !propertyId || !chainId) {
      throw new Error("--fixture-id --property-id --chain-id required");
    }
    for (const [objectType, objectId] of [
      ["property", propertyId],
      ["chain", chainId],
    ] as const) {
      const result = await registerSmokeTestFixtureObject(admin, {
        fixtureId,
        objectType,
        objectId,
        ownership: "owned",
      });
      if (!result.ok) {
        console.error(result);
        process.exit(1);
      }
    }
    console.log(JSON.stringify({ ok: true }, null, 2));
    return;
  }

  if (command === "register-linked-assignment") {
    const fixtureId = arg("--fixture-id");
    const assignmentId = arg("--assignment-id");
    if (!fixtureId || !assignmentId) {
      throw new Error("--fixture-id --assignment-id required");
    }
    const result = await registerSmokeTestFixtureObject(admin, {
      fixtureId,
      objectType: "property_ea_assignment",
      objectId: assignmentId,
      ownership: "linked",
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "cleanup-dry-run") {
    const fixtureId = arg("--fixture-id");
    if (!fixtureId) throw new Error("--fixture-id required");
    const result = await cleanupSmokeTestFixture(admin, {
      fixtureId,
      dryRun: true,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "cleanup-execute") {
    const fixtureId = arg("--fixture-id");
    const confirm = arg("--confirm-fixture-id");
    if (!fixtureId || !confirm) {
      throw new Error("--fixture-id and --confirm-fixture-id required");
    }
    const result = await cleanupSmokeTestFixture(admin, {
      fixtureId,
      dryRun: false,
      confirmFixtureId: confirm,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Unknown or missing command: ${command ?? "(none)"}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
