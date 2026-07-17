/**
 * Regression checks for lib/auth/passwordPolicy.ts
 *
 * Run: npx tsx scripts/verify-auth-password-policy.ts
 */

import {
  formatUnmetPasswordRequirements,
  getPasswordRequirementStates,
  mapAuthSignInError,
  mapAuthSignUpError,
  mapPasswordUpdateError,
  PASSWORD_MIN_LENGTH,
  validateNewPassword,
  validatePasswordForSignUp,
  validatePasswordPolicy,
} from "../lib/auth/passwordPolicy";

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

function assertEqual<T>(
  actual: T,
  expected: T,
  label: string
) {
  assert(actual === expected, label);
}

console.log("Password policy regression checks\n");

console.log("Policy constants");
assertEqual(
  PASSWORD_MIN_LENGTH,
  10,
  "minimum length is 10"
);

console.log("\nWeak passwords rejected");
const weakPasswords = [
  "",
  "short1!",
  "alllowercase1!",
  "ALLUPPERCASE1!",
  "NoNumbers!!",
  "NoSpecialChar1",
];

for (const password of weakPasswords) {
  const result = validatePasswordPolicy(password);
  assert(!result.valid, `rejects "${password || "(empty)"}"`);
}

console.log("\nStrong password accepted");
const strongPassword = "Keynetic1!";
const strongResult = validatePasswordPolicy(strongPassword);
assert(strongResult.valid, "accepts Keynetic1!");

console.log("\nRequirement states");
const states = getPasswordRequirementStates("Keynetic1!");
assertEqual(states.length, 5, "returns five requirements");
assert(
  states.every((state) => state.met),
  "all requirements met for strong password"
);

const partialStates = getPasswordRequirementStates("key1!");
assert(
  partialStates.find((state) => state.id === "uppercase")?.met ===
    false,
  "uppercase unmet for key1!"
);

console.log("\nvalidateNewPassword");
const mismatch = validateNewPassword(
  strongPassword,
  "Different1!"
);
assert(!mismatch.valid, "rejects mismatched confirm");

const sameAsCurrent = validateNewPassword(
  strongPassword,
  strongPassword,
  strongPassword
);
assert(!sameAsCurrent.valid, "rejects same as current password");

const validChange = validateNewPassword(
  strongPassword,
  strongPassword,
  "OldPassword1!"
);
assert(validChange.valid, "accepts valid new password");

console.log("\nvalidatePasswordForSignUp");
const signupValid = validatePasswordForSignUp(
  strongPassword
);
assert(signupValid.valid, "accepts signup password");

const signupWeak = validatePasswordForSignUp("weak");
assert(!signupWeak.valid, "rejects weak signup password");
assert(
  signupWeak.valid === false &&
    signupWeak.message.includes("Password must include"),
  "signup error lists unmet requirements"
);

console.log("\nError message helpers");
assert(
  mapAuthSignInError("Invalid login credentials").includes(
    "Invalid email or password"
  ),
  "sign-in errors are generic"
);

assert(
  mapAuthSignUpError(
    "User already registered"
  ).includes("already exist"),
  "sign-up duplicate email is softened"
);

assert(
  mapPasswordUpdateError(
    "Password is too weak"
  ).includes("Keynetic requirements"),
  "password update weak error is descriptive"
);

assert(
  formatUnmetPasswordRequirements([
    {
      id: "uppercase",
      label: "Uppercase letter",
      met: false,
    },
  ]).startsWith("Password must include:"),
  "unmet requirements formatted for UX"
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

console.log("\nAll password policy checks passed.");
