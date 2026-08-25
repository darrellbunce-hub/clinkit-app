/**
 * Ensures all auth password-creation/reset surfaces render the shared checklist.
 *
 * Run: npx tsx scripts/verify-auth-password-checklist-surfaces.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getPasswordRequirementStates,
  PASSWORD_MIN_LENGTH,
} from "../lib/auth/passwordPolicy";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertUsesSharedPasswordGuidance(
  label: string,
  relativePath: string
) {
  const source = read(relativePath);

  assert(
    source.includes("AuthPasswordFieldWithRequirements") ||
      source.includes("PasswordRequirementsChecklist"),
    `${label}: must use AuthPasswordFieldWithRequirements or PasswordRequirementsChecklist (${relativePath})`
  );
}

const surfaces: Array<[string, string]> = [
  ["Homeowner create account", "app/login/page.tsx"],
  ["Homeowner login", "app/login/page.tsx"],
  ["Estate agent create account", "app/estate-agents/signup/page.tsx"],
  ["Estate agent login", "app/estate-agents/login/page.tsx"],
  ["Homeowner reset password", "components/account/ResetPasswordForm.tsx"],
  [
    "Estate agent reset password (shared route)",
    "components/account/ResetPasswordForm.tsx",
  ],
  ["Change password", "components/account/SecuritySection.tsx"],
];

for (const [label, path] of surfaces) {
  assertUsesSharedPasswordGuidance(label, path);
}

const checklistSource = read(
  "components/auth/PasswordRequirementsChecklist.tsx"
);

assert(
  checklistSource.includes("getPasswordRequirementStates"),
  "PasswordRequirementsChecklist must derive labels from passwordPolicy"
);

const policySource = read("lib/auth/passwordPolicy.ts");

assert(
  policySource.includes("PASSWORD_MIN_LENGTH = 10"),
  "passwordPolicy minimum length must remain 10"
);

const requirementLabels = getPasswordRequirementStates("").map(
  (requirement) => requirement.label
);

assertEqual(requirementLabels, [
  `Minimum ${PASSWORD_MIN_LENGTH} characters`,
  "Uppercase letter",
  "Lowercase letter",
  "Number",
  "Symbol",
]);

function assertEqual<T>(actual: T, expected: T) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected requirement labels ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

console.log(
  "verify-auth-password-checklist-surfaces: all auth surfaces use shared password guidance"
);
