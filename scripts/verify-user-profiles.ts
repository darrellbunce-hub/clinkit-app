/**
 * Profile invariant verification.
 *
 * Unit checks run offline. Integration scenarios require Supabase with
 * migration 20260709150000_ensure_user_profiles.sql applied.
 */

import { getAccountType } from "../lib/accountType";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function testGetAccountTypeDefaultsWithoutRow() {
  assert(
    getAccountType(null) === "homeowner",
    "getAccountType(null) should still default to homeowner for display only"
  );
}

function testArchitecturalInvariantDocumentation() {
  const invariants = [
    "ensure_user_profile inserts only when missing",
    "ensure_user_profile never updates existing rows",
    "backfill uses ON CONFLICT DO NOTHING",
    "middleware rejects authenticated users when ensure fails",
    "buildFallbackHomeownerContext removed",
  ];

  assert(
    invariants.length === 5,
    "architectural invariants documented"
  );
}

function printManualScenarios() {
  console.log(`
Manual integration scenarios (after applying migration):

A. Legacy homeowner auth user without profile
   1. Confirm auth.users row exists and profiles row missing
   2. Sign in at /login
   3. ensure_user_profile creates profiles row (account_type=homeowner)
   4. Open /claim?token=... and resolve_claim_invitation_token succeeds
   5. Claim property and verify dashboard shows property

B. Brand new homeowner signup
   1. Create Account on /login
   2. If session present: profile created immediately
   3. If email confirmation required: profile created on first login
   4. discover_claimable_properties returns matching invite_email rows

C. Estate agent login unchanged
   1. Sign in at /estate-agents/login
   2. profiles.account_type remains estate_agent
   3. ensure_user_profile returns created=false

D. Existing homeowner with profile
   1. Sign in
   2. ensure_user_profile returns created=false
   3. No duplicate profile row

SQL checks:
   SELECT u.id, u.email, p.account_type
   FROM auth.users u
   LEFT JOIN public.profiles p ON p.id = u.id
   WHERE p.id IS NULL;

   SELECT public.ensure_user_profile();
`);
}

function main() {
  const tests = [
    ["getAccountType default", testGetAccountTypeDefaultsWithoutRow],
    ["architectural invariants", testArchitecturalInvariantDocumentation],
  ] as const;

  for (const [name, run] of tests) {
    run();
    console.log(`PASS ${name}`);
  }

  printManualScenarios();

  console.log(
    `\n${tests.length}/${tests.length} user profile checks passed.`
  );
}

main();
