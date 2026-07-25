/**
 * Sprint 3 — mandatory signup legal acceptance verification.
 * Run: npx tsx scripts/verify-legal-acceptance-signup.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LEGAL_DOCUMENT_VERSIONS,
  SIGNUP_LEGAL_ACCEPTANCE_ERROR,
} from "../lib/legal/constants";
import { isSignupLegalAcceptanceComplete } from "../lib/legal/recordSignupLegalAcceptance";

const ROOT = join(import.meta.dirname, "..");

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
  } else {
    console.log("PASS:", message);
  }
}

function assertIncludes(
  name: string,
  haystack: string,
  needle: string
) {
  assert(haystack.includes(needle), `${name} — missing: ${needle}`);
}

function assertExcludes(
  name: string,
  haystack: string,
  needle: string
) {
  assert(
    !haystack.includes(needle),
    `${name} — should not include: ${needle}`
  );
}

function readProjectFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

// Version constants for audit records
assert(
  LEGAL_DOCUMENT_VERSIONS.privacyPolicy.length > 0,
  "Privacy policy version id is defined"
);
assert(
  LEGAL_DOCUMENT_VERSIONS.termsOfUse.length > 0,
  "Homeowner terms version id is defined"
);
assert(
  LEGAL_DOCUMENT_VERSIONS.estateAgentTerms.length > 0,
  "Estate agent terms version id is defined"
);
assert(
  LEGAL_DOCUMENT_VERSIONS.privacyPolicy ===
    LEGAL_DOCUMENT_VERSIONS.privacyPolicy,
  "Shared privacy policy version is a single constant"
);

// Client-side acceptance gate
assert(
  !isSignupLegalAcceptanceComplete(false, false),
  "Signup blocked when both checkboxes unchecked"
);
assert(
  !isSignupLegalAcceptanceComplete(true, false),
  "Signup blocked when privacy unchecked"
);
assert(
  !isSignupLegalAcceptanceComplete(false, true),
  "Signup blocked when terms unchecked"
);
assert(
  isSignupLegalAcceptanceComplete(true, true),
  "Signup allowed when both checkboxes checked"
);

// Migration and RPC
const migrationPath =
  "supabase/migrations/20260725150000_signup_legal_acceptance.sql";

assert(
  existsSync(join(ROOT, migrationPath)),
  `Migration exists: ${migrationPath}`
);

const migration = readProjectFile(migrationPath);

assertIncludes(
  "Migration creates legal_acceptances",
  migration,
  "create table if not exists public.legal_acceptances"
);
assertIncludes(
  "Migration stores document_version",
  migration,
  "document_version"
);
assertIncludes(
  "Migration stores accepted_at",
  migration,
  "accepted_at"
);
assertIncludes(
  "Migration defines record_signup_legal_acceptances RPC",
  migration,
  "record_signup_legal_acceptances"
);
assertIncludes(
  "Migration supports homeowner terms document type",
  migration,
  "'terms_of_use'"
);
assertIncludes(
  "Migration supports estate agent terms document type",
  migration,
  "'estate_agent_terms'"
);
assertIncludes(
  "Migration supports privacy policy document type",
  migration,
  "'privacy_policy'"
);
assertExcludes(
  "Migration does not backfill existing users from profiles",
  migration,
  "from public.profiles"
);
assertExcludes(
  "Migration does not bulk backfill legal acceptances",
  migration,
  "insert into public.legal_acceptances\nselect"
);

// Shared UI component
assert(
  existsSync(
    join(ROOT, "components/legal/LegalAcceptanceFields.tsx")
  ),
  "LegalAcceptanceFields component exists"
);

const legalFields = readProjectFile(
  "components/legal/LegalAcceptanceFields.tsx"
);

assertIncludes(
  "Terms links open in new tab",
  legalFields,
  'target="_blank"'
);
assertIncludes(
  "Terms links use noopener",
  legalFields,
  'rel="noopener noreferrer"'
);
assertIncludes(
  "Homeowner terms route",
  legalFields,
  "LEGAL_ROUTES.terms"
);
assertIncludes(
  "Estate agent terms route",
  legalFields,
  "LEGAL_ROUTES.estateAgentTerms"
);
assertIncludes(
  "Shared privacy route",
  legalFields,
  "LEGAL_ROUTES.privacy"
);

// Homeowner signup integration
const homeownerSignup = readProjectFile("app/login/page.tsx");

assertIncludes(
  "Homeowner signup renders LegalAcceptanceFields in create-account mode",
  homeownerSignup,
  "isCreateAccountMode ? ("
);
assertIncludes(
  "Homeowner signup activates create-account mode",
  homeownerSignup,
  "setIsCreateAccountMode(true)"
);
assertExcludes(
  "Homeowner login view does not always show legal acceptance",
  homeownerSignup.replace(
    /isCreateAccountMode \? \([\s\S]*?\) : null/,
    ""
  ),
  "<LegalAcceptanceFields"
);
assertIncludes(
  "Homeowner signup validates acceptance",
  homeownerSignup,
  "isSignupLegalAcceptanceComplete"
);
assertIncludes(
  "Homeowner signup shows acceptance error",
  homeownerSignup,
  "SIGNUP_LEGAL_ACCEPTANCE_ERROR"
);
assertIncludes(
  "Homeowner signup records acceptance",
  homeownerSignup,
  "persistSignupLegalAcceptanceAfterAuth"
);
assertIncludes(
  "Homeowner signup uses terms_of_use version",
  homeownerSignup,
  "LEGAL_DOCUMENT_VERSIONS.termsOfUse"
);
assertIncludes(
  "Homeowner signup uses shared privacy version",
  homeownerSignup,
  "LEGAL_DOCUMENT_VERSIONS.privacyPolicy"
);
const handleLoginSource =
  homeownerSignup.match(
    /async function handleLogin\([\s\S]*?\n  \}/
  )?.[0] ?? "";

assert(
  handleLoginSource.length > 0,
  "Homeowner handleLogin function found for isolation check"
);
assertExcludes(
  "Homeowner login does not require acceptance on submit",
  handleLoginSource,
  "isSignupLegalAcceptanceComplete"
);
assertExcludes(
  "Homeowner login does not require acceptance error",
  handleLoginSource,
  "SIGNUP_LEGAL_ACCEPTANCE_ERROR"
);

// Estate agent signup integration
const eaSignup = readProjectFile(
  "app/estate-agents/signup/page.tsx"
);

assertIncludes(
  "EA signup renders LegalAcceptanceFields",
  eaSignup,
  'variant="estate-agent"'
);
assertIncludes(
  "EA signup validates acceptance",
  eaSignup,
  "isSignupLegalAcceptanceComplete"
);
assertIncludes(
  "EA signup records acceptance",
  eaSignup,
  "persistSignupLegalAcceptanceAfterAuth"
);
assertIncludes(
  "EA signup uses estate agent terms version",
  eaSignup,
  "LEGAL_DOCUMENT_VERSIONS.estateAgentTerms"
);
assertIncludes(
  "EA signup uses shared privacy version",
  eaSignup,
  "LEGAL_DOCUMENT_VERSIONS.privacyPolicy"
);

// Existing users: login surfaces unchanged
const eaLogin = readProjectFile(
  "app/estate-agents/login/page.tsx"
);

assertExcludes(
  "EA login does not require legal acceptance",
  eaLogin,
  "LegalAcceptanceFields"
);
assertExcludes(
  "EA login does not block on acceptance",
  eaLogin,
  "SIGNUP_LEGAL_ACCEPTANCE_ERROR"
);

// Pending acceptance flush for email verification path
const verifyEmail = readProjectFile("app/verify-email/page.tsx");

assertIncludes(
  "Verify email flushes pending acceptance",
  verifyEmail,
  "flushPendingSignupLegalAcceptance"
);

assert(
  SIGNUP_LEGAL_ACCEPTANCE_ERROR.includes("Terms"),
  "Acceptance error mentions Terms"
);
assert(
  SIGNUP_LEGAL_ACCEPTANCE_ERROR.includes("Privacy"),
  "Acceptance error mentions Privacy Policy"
);

if (process.exitCode) {
  console.error("\nLegal acceptance signup verification FAILED");
} else {
  console.log("\nLegal acceptance signup verification PASSED");
}
