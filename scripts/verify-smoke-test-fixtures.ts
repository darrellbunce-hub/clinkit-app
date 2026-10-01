/**
 * Smoke-test fixture architecture verification (source + invariants).
 *
 * Usage:
 *   npx tsx scripts/verify-smoke-test-fixtures.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function assert(name: string, condition: boolean) {
  if (!condition) {
    console.error("FAIL:", name);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20260902120000_smoke_test_fixtures.sql"
);
const onboarding = read("lib/estateAgent/completeOnboarding.ts");
const signup = read("app/estate-agents/signup/page.tsx");
const checkout = read("lib/billing/eaCheckout.ts");
const assignments = read("lib/estateAgent/assignments.ts");
const cleanup = read("lib/smokeTest/cleanup.ts");
const registry = read("lib/smokeTest/registry.ts");
const synthetic = read("lib/smokeTest/createSyntheticFixture.ts");
const fixturesRoute = read("app/api/admin/smoke-test/fixtures/route.ts");

assert(
  "Migration creates smoke_test_fixtures registry",
  migration.includes("create table if not exists public.smoke_test_fixtures") &&
    migration.includes("smoke_test_fixture_objects")
);

assert(
  "Fixture tables revoke authenticated writes",
  migration.includes(
    "revoke all on public.smoke_test_fixtures from public, anon, authenticated"
  )
);

assert(
  "Directory view excludes active smoke-test branches via fixture registry",
  migration.includes("create or replace view public.ea_branch_directory") &&
    migration.includes("smoke_test_fixture_objects") &&
    migration.includes("object_type = 'ea_branch'") &&
    migration.includes("f.status = 'active'")
);

assert(
  "is_smoke_test_ea_branch helper exists",
  migration.includes("create or replace function public.is_smoke_test_ea_branch")
);

assert(
  "Normal EA onboarding has no is_test / fixture fields",
  !onboarding.includes("is_test") &&
    !onboarding.includes("smoke_test") &&
    !onboarding.includes("fixture")
);

assert(
  "EA signup page has no test account UI/flag",
  !signup.includes("is_test") &&
    !signup.includes("Test account") &&
    !signup.includes("smoke_test")
);

assert(
  "Checkout blocks smoke-test fixture branches",
  checkout.includes("smoke_test_fixture_checkout_forbidden") &&
    checkout.includes("is_smoke_test_ea_branch")
);

assert(
  "Directory still loaded via ea_branch_directory view",
  assignments.includes('from("ea_branch_directory")')
);

assert(
  "Cleanup refuses unmarked / requires fixture id confirm",
  cleanup.includes("confirm_fixture_id_mismatch") &&
    cleanup.includes("ownership !== \"owned\"") &&
    cleanup.includes("revoke_assignment") &&
    cleanup.includes("founding_slots_never_restored_by_cleanup")
);

assert(
  "Cleanup does not delete linked properties/chains",
  cleanup.includes("Linked object — not deleted by fixture cleanup") &&
    cleanup.includes("ownership !== \"owned\"") &&
    cleanup.includes("revoke_assignment")
);

assert(
  "Cleanup avoids explicit owned member delete when owned branch cascades",
  cleanup.includes('action: "expect_cascade"') &&
    cleanup.includes("preserves owner invariant") &&
    /"ea_branch",\s*"ea_branch_member"/.test(cleanup)
);

assert(
  "Cleanup treats Auth user-not-found as idempotent success",
  cleanup.includes("isAuthUserNotFoundError") &&
    cleanup.includes("already_absent")
);

assert(
  "Cleanup returns structured results on partial failure",
  cleanup.includes("cleanup_execution_result") &&
    cleanup.includes("consistency_errors") &&
    cleanup.includes("cleanup_partial_failure")
);

assert(
  "Cleanup verifies owned objects absent before fixture_cleaned",
  cleanup.includes("verifyOwnedObjectsAbsent") &&
    cleanup.includes("owned_still_present")
);

assert(
  "Registry registerEaOrg requires explicit auth user id",
  registry.includes("registerEaOrgForSmokeFixture") &&
    registry.includes("authUserId")
);

assert(
  "Synthetic fixture creates owned property without Ideal Postcodes",
  synthetic.includes("Synthetic Smoke Property") &&
    !synthetic.includes("idealPostcodes") &&
    !synthetic.includes("createEaBranchCheckoutSession")
);

assert(
  "Admin fixture API requires privileged platform admin",
  fixturesRoute.includes("requirePrivilegedPlatformAdminSession") &&
    fixturesRoute.includes("forbidden_client_test_flag")
);

assert(
  "No Stripe Checkout session creation in synthetic fixture",
  !synthetic.includes("createEaBranchCheckoutSession") &&
    !synthetic.includes("reserve_ea_founding_slot") &&
    !synthetic.includes("stripe.checkout")
);

if (process.exitCode && process.exitCode !== 0) {
  console.error("\nSmoke-test fixture verification FAILED");
  process.exit(process.exitCode);
}

console.log("\nSmoke-test fixture verification PASSED");
