/**
 * Batch 7 static checks: verify-email next sanitisation, legal acceptance
 * dual-storage, signup next carry-through, and signup confirmation support.
 *
 *   npx tsx scripts/verify-auth-verification-hardening-batch7.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildPostSignupVerifiedPath,
  buildSignupConfirmUrl,
  buildVerifyEmailPathWithNext,
} from "../lib/auth/signupConfirm";
import { buildVerifyEmailRedirectPath } from "../lib/auth/emailVerificationGate";
import { resolveLoginNextDestination } from "../lib/auth/redirects";
import { ROUTES } from "../lib/auth/routes";
import {
  clearPendingSignupLegalAcceptance,
  readPendingSignupLegalAcceptance,
  savePendingSignupLegalAcceptance,
} from "../lib/legal/pendingLegalAcceptance";

const root = resolve(__dirname, "..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

let failed = 0;

function check(label: string, ok: boolean) {
  if (ok) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}

const verifyEmailPage = read("app/verify-email/page.tsx");
const loginPage = read("app/login/page.tsx");
const eaSignup = read("app/estate-agents/signup/page.tsx");
const confirmRoute = read("app/auth/confirm/route.ts");
const pendingLegal = read("lib/legal/pendingLegalAcceptance.ts");
const authArchitecture = read("docs/AUTH_ARCHITECTURE.md");

// HO-06
check(
  "verify-email sanitises next via resolveLoginNextDestination",
  verifyEmailPage.includes("resolveLoginNextDestination") &&
    verifyEmailPage.includes("safeNextDestination")
);

check(
  "buildVerifyEmailRedirectPath rejects absolute next",
  buildVerifyEmailRedirectPath("https://evil.example") ===
    `${ROUTES.verifyEmail}?reason=transaction_participation` &&
    buildVerifyEmailRedirectPath("/claim?token=1").includes(
      "next=%2Fclaim%3Ftoken%3D1"
    )
);

check(
  "Return To Account does not use raw searchParams next",
  !verifyEmailPage.includes("nextDestination ?? ROUTES.homeownerLogin") &&
    verifyEmailPage.includes("href={safeNextDestination}")
);

// HO-05
check(
  "pending legal acceptance uses dual browser storage",
  pendingLegal.includes("sessionStorage") &&
    pendingLegal.includes("localStorage") &&
    pendingLegal.includes("PENDING_SIGNUP_LEGAL_TTL_MS")
);

check(
  "pending legal helpers validate payload shape",
  pendingLegal.includes('value === "terms_of_use"') &&
    pendingLegal.includes("Date.parse(acceptedAt)")
);

{
  const memory = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  } as Storage;

  (globalThis as { window?: Window }).window = {
    sessionStorage: fakeStorage,
    localStorage: fakeStorage,
  } as Window;

  savePendingSignupLegalAcceptance({
    termsDocument: "terms_of_use",
    termsVersion: "1.0",
    privacyVersion: "1.0",
    acceptedAt: new Date().toISOString(),
  });

  const pending = readPendingSignupLegalAcceptance();
  check(
    "pending legal round-trip reads saved acceptance",
    pending?.termsDocument === "terms_of_use" &&
      pending.termsVersion === "1.0"
  );

  clearPendingSignupLegalAcceptance();
  check(
    "pending legal clear removes stored acceptance",
    readPendingSignupLegalAcceptance() === null
  );

  delete (globalThis as { window?: Window }).window;
}

// HO-13
check(
  "homeowner signup carries sanitised next to verify-email",
  loginPage.includes("buildVerifyEmailPathWithNext") &&
    loginPage.includes("buildSignupConfirmUrl") &&
    loginPage.includes("safeNext")
);

check(
  "buildVerifyEmailPathWithNext drops unsafe next",
  buildVerifyEmailPathWithNext("https://evil.example") ===
    ROUTES.verifyEmail &&
    buildVerifyEmailPathWithNext("/claim?token=ABC") ===
      "/verify-email?next=%2Fclaim%3Ftoken%3DABC"
);

check(
  "resolveLoginNextDestination still rejects open redirects",
  resolveLoginNextDestination(
    "//evil.example",
    ROUTES.homeownerDashboard
  ) === ROUTES.homeownerDashboard
);

// HO-01
check(
  "auth confirm route verifies signup OTP type",
  confirmRoute.includes('type: "signup"') &&
    confirmRoute.includes("isAuthConfirmSignupType") &&
    confirmRoute.includes("resolveSignupConfirmDestination")
);

check(
  "auth confirm recovery path still verifies recovery OTP",
  confirmRoute.includes('type: "recovery"') &&
    confirmRoute.includes("isAuthConfirmRecoveryType")
);

check(
  "signup confirm URL targets /auth/confirm with next",
  buildSignupConfirmUrl(
    "https://app.example",
    "/claim?token=1"
  ) ===
    "https://app.example/auth/confirm?next=%2Fclaim%3Ftoken%3D1"
);

check(
  "post-signup verified bridge keeps sanitised next",
  buildPostSignupVerifiedPath("https://evil.example") ===
    `/verify-email?verified=1&next=${encodeURIComponent(ROUTES.homeownerDashboard)}`
);

check(
  "EA signup sets emailRedirectTo and verify-email next",
  eaSignup.includes("emailRedirectTo") &&
    eaSignup.includes("buildVerifyEmailPathWithNext")
);

check(
  "AUTH_ARCHITECTURE documents Phase 2 signup confirmation",
  authArchitecture.includes("Phase 2 — Signup email confirmation") &&
    authArchitecture.includes("type=signup") &&
    authArchitecture.includes("Confirm signup email template")
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}

console.log("\nAll Batch 7 auth verification hardening checks passed.");
