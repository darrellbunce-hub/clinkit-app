/**
 * Route classification checks for email verification transaction gate.
 *
 * Run: npx tsx scripts/verify-email-verification-gate.ts
 */

import {
  isTransactionParticipationRoute,
  ROUTES,
} from "../lib/auth/routes";
import {
  buildVerifyEmailRedirectPath,
  isEmailVerificationRequiredError,
  mapTransactionParticipationError,
} from "../lib/auth/emailVerificationGate";
import { isEmailVerified } from "../lib/auth/emailVerification";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }

  failed += 1;
  console.error(`  ✗ ${label}`);
}

console.log("Email verification transaction gate checks\n");

console.log("Route classification");
assert(
  isTransactionParticipationRoute("/start-move"),
  "start-move requires verification"
);
assert(
  isTransactionParticipationRoute("/join-chain"),
  "join-chain requires verification"
);
assert(
  isTransactionParticipationRoute("/claim"),
  "claim requires verification"
);
assert(
  isTransactionParticipationRoute("/chain/42"),
  "chain pages require verification"
);
assert(
  isTransactionParticipationRoute("/property/99"),
  "property pages require verification"
);
assert(
  isTransactionParticipationRoute("/agent"),
  "agent command centre requires verification"
);
assert(
  !isTransactionParticipationRoute("/dashboard"),
  "dashboard remains account access"
);
assert(
  !isTransactionParticipationRoute("/account"),
  "account settings remain accessible"
);
assert(
  !isTransactionParticipationRoute("/estate-agents/onboarding"),
  "EA onboarding remains accessible"
);

console.log("\nVerification helpers");
assert(
  isEmailVerified({
    id: "user-1",
    email_confirmed_at: "2026-01-01T00:00:00Z",
  } as never),
  "confirmed user passes"
);
assert(
  !isEmailVerified({
    id: "user-2",
    email_confirmed_at: null,
  } as never),
  "unconfirmed user fails"
);

console.log("\nError mapping");
assert(
  isEmailVerificationRequiredError(
    "email_verification_required"
  ),
  "detects verification error code"
);
assert(
  mapTransactionParticipationError(
    "email_verification_required"
  )?.includes("Verify your email"),
  "maps friendly transaction message"
);

console.log("\nRedirect builder");
const redirectPath = buildVerifyEmailRedirectPath(
  "/start-move",
  "transaction_participation"
);
assert(
  redirectPath.startsWith(`${ROUTES.verifyEmail}?`),
  "redirect targets verify-email"
);
assert(
  redirectPath.includes("reason=transaction_participation"),
  "redirect includes reason"
);
assert(
  redirectPath.includes(
    encodeURIComponent("/start-move")
  ),
  "redirect preserves next destination"
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

console.log("\nAll email verification gate checks passed.");
