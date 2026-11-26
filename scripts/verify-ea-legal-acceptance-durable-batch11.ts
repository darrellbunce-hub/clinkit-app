/**
 * Batch 11 — EA-04 durable estate-agent legal acceptance.
 * Static + pending-storage checks for signup recovery and auth gates.
 *
 *   npx tsx scripts/verify-ea-legal-acceptance-durable-batch11.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SIGNUP_LEGAL_ACCEPTANCE_PERSIST_FAILED_MESSAGE,
  SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE,
} from "../lib/legal/constants";
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

const recordHelper = read(
  "lib/legal/recordSignupLegalAcceptance.ts"
);
const eaSignup = read("app/estate-agents/signup/page.tsx");
const eaLogin = read("app/estate-agents/login/page.tsx");
const eaOnboarding = read(
  "app/estate-agents/onboarding/page.tsx"
);
const eaJoin = read("app/estate-agents/join/page.tsx");
const verifyEmail = read("app/verify-email/page.tsx");
const homeownerLogin = read("app/login/page.tsx");
const constants = read("lib/legal/constants.ts");

// --- Persist behaviour: queue first, clear only on RPC success ---

check(
  "persist queues pending acceptance before RPC",
  /queueSignupLegalAcceptanceForSession\(input\)[\s\S]*getSession\(\)/.test(
    recordHelper
  ) &&
    recordHelper.includes(
      "export async function persistSignupLegalAcceptanceAfterAuth"
    )
);

check(
  "persist clears pending only after successful RPC",
  /if \(result\.ok\) \{[\s\S]*clearPendingSignupLegalAcceptance\(\)[\s\S]*return \{ ok: true/.test(
    recordHelper
  )
);

check(
  "persist reports failure when session exists and RPC fails",
  recordHelper.includes("pendingQueued: true") &&
    /return \{\s*ok: false,\s*error: result\.error,\s*pendingQueued: true,/.test(
      recordHelper
    )
);

check(
  "persist does not invent legal versions",
  !recordHelper.includes('termsVersion: "') &&
    !recordHelper.includes('privacyVersion: "') &&
    recordHelper.includes("input.termsVersion")
);

check(
  "flush exposes pendingRemains for gate decisions",
  recordHelper.includes("pendingRemains") &&
    recordHelper.includes(
      "export async function flushPendingSignupLegalAcceptance"
    )
);

check(
  "ensure gate blocks failed persistence and expiry, not historical row absence",
  recordHelper.includes(
    "ensurePendingSignupLegalAcceptanceFlushed"
  ) &&
    recordHelper.includes('disposition === "persist_failed"') &&
    recordHelper.includes('disposition === "expired"') &&
    recordHelper.includes(
      "SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE"
    ) &&
    recordHelper.includes(
      "SIGNUP_LEGAL_ACCEPTANCE_EXPIRED_MESSAGE"
    ) &&
    !recordHelper.includes('.from("legal_acceptances")')
);

check(
  "durable path uses record_signup_legal_acceptances RPC",
  recordHelper.includes(
    '"record_signup_legal_acceptances"'
  )
);

check(
  "helper does not treat user metadata as acceptance proof",
  !recordHelper.includes("user_metadata") &&
    !recordHelper.includes("app_metadata")
);

// --- Messaging constants ---

check(
  "persist-failed message tells user to sign in to finish",
  SIGNUP_LEGAL_ACCEPTANCE_PERSIST_FAILED_MESSAGE.includes(
    "Sign in to finish"
  ) &&
    constants.includes(
      "SIGNUP_LEGAL_ACCEPTANCE_PERSIST_FAILED_MESSAGE"
    )
);

check(
  "retry-failed message is actionable",
  SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE.includes(
    "try again"
  ) &&
    SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE.includes(
      "contact support"
    )
);

// --- EA signup: Auth ok + legal fail recovery ---

check(
  "EA signup surfaces persist-failed message",
  eaSignup.includes(
    "SIGNUP_LEGAL_ACCEPTANCE_PERSIST_FAILED_MESSAGE"
  )
);

check(
  "EA signup stops progression when legal persist fails",
  /if \(!legalRecord\.ok\) \{[\s\S]*SIGNUP_LEGAL_ACCEPTANCE_PERSIST_FAILED_MESSAGE[\s\S]*return;/.test(
    eaSignup
  )
);

check(
  "EA signup does not create profile after legal persist failure",
  (() => {
    const failBlock =
      eaSignup.match(
        /if \(!legalRecord\.ok\) \{[\s\S]*?\n      \}/
      )?.[0] ?? "";
    return (
      failBlock.includes(
        "SIGNUP_LEGAL_ACCEPTANCE_PERSIST_FAILED_MESSAGE"
      ) && !failBlock.includes("createEstateAgentProfile")
    );
  })()
);

check(
  "EA signup still uses Auth signUp once (no recovery re-signup)",
  (eaSignup.match(/supabase\.auth\.signUp/g) ?? []).length ===
    1
);

// --- Recovery gates ---

check(
  "EA login gates on ensurePendingSignupLegalAcceptanceFlushed",
  eaLogin.includes(
    "ensurePendingSignupLegalAcceptanceFlushed"
  ) &&
    /const legalFlush =[\s\S]*ensurePendingSignupLegalAcceptanceFlushed[\s\S]*if \(!legalFlush\.ok\)/.test(
      eaLogin
    )
);

check(
  "EA login does not require LegalAcceptanceFields for existing users",
  !eaLogin.includes("LegalAcceptanceFields") &&
    !eaLogin.includes("isSignupLegalAcceptanceComplete")
);

check(
  "verify-email gates redirect on pending flush failure",
  verifyEmail.includes(
    "ensurePendingSignupLegalAcceptanceFlushed"
  ) &&
    /if \(!legalFlush\.ok\) \{[\s\S]*setIsFinishingVerification\(false\)[\s\S]*return;/.test(
      verifyEmail
    )
);

check(
  "EA onboarding gates load and submit on pending flush",
  (eaOnboarding.match(
    /ensurePendingSignupLegalAcceptanceFlushed/g
  ) ?? []).length >= 2
);

check(
  "EA join blocks auto-accept when legal pending remains",
  eaJoin.includes(
    "ensurePendingSignupLegalAcceptanceFlushed"
  ) &&
    eaJoin.includes("legalAcceptanceBlocked") &&
    eaJoin.includes("legalAcceptanceBlocked ||") &&
    /if \(!token \|\| legalAcceptanceBlocked\)/.test(eaJoin)
);

check(
  "homeowner login gates pending flush without signup checkboxes",
  homeownerLogin.includes(
    "ensurePendingSignupLegalAcceptanceFlushed"
  ) &&
    (() => {
      const handleLogin =
        homeownerLogin.match(
          /async function handleLogin\([\s\S]*?\n  \}/
        )?.[0] ?? "";
      return (
        handleLogin.includes(
          "ensurePendingSignupLegalAcceptanceFlushed"
        ) &&
        !handleLogin.includes(
          "isSignupLegalAcceptanceComplete"
        ) &&
        !handleLogin.includes("LegalAcceptanceFields")
      );
    })()
);

// --- Pending storage recovery (no duplicate Auth user) ---

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
    privacyVersion: "1.1",
    acceptedAt: new Date().toISOString(),
  });

  const pending = readPendingSignupLegalAcceptance();
  check(
    "pending acceptance survives for post-Auth recovery retry",
    pending?.termsDocument === "terms_of_use" &&
      pending.termsVersion === "1.0" &&
      pending.privacyVersion === "1.1"
  );

  clearPendingSignupLegalAcceptance();
  check(
    "pending acceptance cleared only via explicit clear (RPC success path)",
    readPendingSignupLegalAcceptance() === null
  );

  delete (globalThis as { window?: Window }).window;
}

check(
  "queue helper is available for session-less and fail paths",
  recordHelper.includes(
    "export function queueSignupLegalAcceptanceForSession"
  )
);

if (failed > 0) {
  console.error(`\n${failed} Batch 11 check(s) failed`);
  process.exit(1);
}

console.log(
  "\nAll Batch 11 EA durable legal acceptance checks passed."
);
