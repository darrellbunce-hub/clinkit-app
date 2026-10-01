/**
 * EA signup recovery — Auth metadata is durable; client storage is supplementary.
 *
 * Proves: EA signup intent must never fall through to ensure_user_profile as homeowner.
 *
 * Usage:
 *   npx tsx scripts/verify-ea-signup-pending-profile.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { User } from "@supabase/supabase-js";

import {
  clearPendingEstateAgentProfile,
  PENDING_EA_PROFILE_TTL_MS,
  readPendingEstateAgentProfile,
  savePendingEstateAgentProfile,
} from "../lib/estateAgent/pendingEstateAgentProfile";
import {
  buildEstateAgentSignupAuthMetadata,
  emailsMatchForPendingProfile,
  readEstateAgentSignupIntentFromUser,
} from "../lib/estateAgent/signupAuthMetadata";

const ROOT = join(import.meta.dirname, "..");

function assert(name: string, condition: boolean) {
  if (!condition) {
    console.error("FAIL:", name);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function assertEqual<T>(name: string, actual: T, expected: T) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    console.error("FAIL:", name);
    console.error("  expected:", expectedJson);
    console.error("  actual:  ", actualJson);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function readProjectFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function mockUser(
  overrides: Partial<User> & {
    email?: string;
    user_metadata?: Record<string, unknown>;
  }
): User {
  return {
    id: overrides.id ?? "user-ea-1",
    email: overrides.email ?? "alex@agency.example",
    user_metadata: overrides.user_metadata ?? {},
    app_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as User;
}

// ---------------------------------------------------------------------------
// Storage mock (session + local) for new-tab simulation
// ---------------------------------------------------------------------------

const sessionMemory = new Map<string, string>();
const localMemory = new Map<string, string>();

function installStorageMock(options?: {
  disableSession?: boolean;
}) {
  const disableSession = options?.disableSession ?? false;

  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      setItem(key: string, value: string) {
        if (disableSession) {
          throw new Error("sessionStorage unavailable");
        }
        sessionMemory.set(key, value);
      },
      getItem(key: string) {
        if (disableSession) {
          return null;
        }
        return sessionMemory.get(key) ?? null;
      },
      removeItem(key: string) {
        sessionMemory.delete(key);
      },
    },
    localStorage: {
      setItem(key: string, value: string) {
        localMemory.set(key, value);
      },
      getItem(key: string) {
        return localMemory.get(key) ?? null;
      },
      removeItem(key: string) {
        localMemory.delete(key);
      },
    },
  };
}

sessionMemory.clear();
localMemory.clear();
installStorageMock();

// ---------------------------------------------------------------------------
// Auth metadata helpers
// ---------------------------------------------------------------------------

const meta = buildEstateAgentSignupAuthMetadata("  Alex Agent  ");
assertEqual("Signup metadata account_type", meta.account_type, "estate_agent");
assertEqual("Signup metadata contact_name trimmed", meta.contact_name, "Alex Agent");

const eaUser = mockUser({
  user_metadata: meta,
  email: "alex@agency.example",
});
assertEqual(
  "readEstateAgentSignupIntentFromUser detects EA",
  readEstateAgentSignupIntentFromUser(eaUser),
  { isEstateAgentSignup: true, contactName: "Alex Agent" }
);

const homeownerUser = mockUser({
  id: "user-ho-1",
  email: "pat@home.example",
  user_metadata: {},
});
assertEqual(
  "Homeowner user has no EA signup intent",
  readEstateAgentSignupIntentFromUser(homeownerUser),
  { isEstateAgentSignup: false, contactName: null }
);

assert(
  "Email match is case-insensitive",
  emailsMatchForPendingProfile(
    "Alex@Agency.Example",
    "alex@agency.example"
  )
);
assert(
  "Email mismatch rejected",
  !emailsMatchForPendingProfile(
    "alex@agency.example",
    "other@agency.example"
  )
);

// ---------------------------------------------------------------------------
// Dual storage + TTL + new-tab (session lost)
// ---------------------------------------------------------------------------

clearPendingEstateAgentProfile();
savePendingEstateAgentProfile({
  contactName: "Alex Agent",
  email: "alex@agency.example",
});

assert(
  "Pending written to sessionStorage",
  sessionMemory.size === 1
);
assert(
  "Pending written to localStorage",
  localMemory.size === 1
);

assertEqual(
  "Pending readable from dual storage",
  readPendingEstateAgentProfile()?.contactName,
  "Alex Agent"
);

// Simulate email confirmation in a NEW TAB — sessionStorage gone, localStorage remains
sessionMemory.clear();
installStorageMock({ disableSession: true });

assertEqual(
  "New tab without sessionStorage still reads localStorage pending",
  readPendingEstateAgentProfile()?.email,
  "alex@agency.example"
);

assert(
  "EA metadata still identifies estate_agent when sessionStorage lost",
  readEstateAgentSignupIntentFromUser(eaUser).isEstateAgentSignup
);

// Stale email cannot apply to another authenticated user
assert(
  "Stale pending email does not match a different authenticated user",
  !emailsMatchForPendingProfile(
    readPendingEstateAgentProfile()?.email,
    homeownerUser.email
  )
);

// Expired TTL
installStorageMock();
sessionMemory.clear();
localMemory.clear();
const expiredKey = "keynetic:pending-estate-agent-profile";
const expiredPayload = JSON.stringify({
  contactName: "Old Agent",
  email: "alex@agency.example",
  savedAt: new Date(
    Date.now() - PENDING_EA_PROFILE_TTL_MS - 1000
  ).toISOString(),
});
localMemory.set(expiredKey, expiredPayload);
assertEqual(
  "Expired pending is ignored",
  readPendingEstateAgentProfile(),
  null
);

clearPendingEstateAgentProfile();

// ---------------------------------------------------------------------------
// Source: signup writes metadata; no anon profiles write without session
// ---------------------------------------------------------------------------

const signupSource = readProjectFile("app/estate-agents/signup/page.tsx");
assert(
  "EA signUp passes Auth metadata via options.data",
  signupSource.includes("buildEstateAgentSignupAuthMetadata") &&
    signupSource.includes("options:") &&
    signupSource.includes("data:")
);

const firstCreateIdx = signupSource.indexOf(
  "createEstateAgentProfile("
);
const firstNoSessionIdx = signupSource.indexOf("if (!data.session)");
assert(
  "No-session path queues pending and does not write profiles before authenticated create",
  firstNoSessionIdx >= 0 &&
    firstCreateIdx > firstNoSessionIdx &&
    signupSource
      .slice(firstNoSessionIdx, firstCreateIdx)
      .includes("queuePendingEstateAgentProfile")
);

assert(
  "Signup preserves legal acceptance + invite redirects",
  signupSource.includes("persistSignupLegalAcceptanceAfterAuth") &&
    signupSource.includes("estateAgentJoin")
);

// ---------------------------------------------------------------------------
// Source: bootstrap ordering invariant
// ---------------------------------------------------------------------------

const flushSource = readProjectFile(
  "lib/estateAgent/flushPendingEstateAgentProfile.ts"
);
const bootstrapFn = flushSource.slice(
  flushSource.indexOf("bootstrapAuthenticatedEstateAgentProfile")
);

assert(
  "CRITICAL: EA signup intent must never fall through to ensure_user_profile as homeowner",
  bootstrapFn.includes("hasEaSignupIntent") &&
    bootstrapFn.indexOf("hasEaSignupIntent") <
      bootstrapFn.indexOf("ensureUserProfile") &&
    bootstrapFn.includes("flushPendingEstateAgentProfile") &&
    bootstrapFn.includes('accountType !== "estate_agent"')
);

assert(
  "bootstrap flushes EA profile before ensureUserProfile when EA intent present",
  /if \(hasEaSignupIntent\) \{[\s\S]*flushPendingEstateAgentProfile[\s\S]*ensureUserProfile/.test(
    bootstrapFn
  )
);

assert(
  "Failed EA create does not clear pending (clear only after success)",
  /if \(profileResult\.error\) \{[\s\S]*flushed: false[\s\S]*\}[\s\S]*clearPendingEstateAgentProfile\(\)/.test(
    flushSource
  )
);

assert(
  "createEstateAgentProfile requires auth + rejects mismatched ids",
  readProjectFile("lib/estateAgent/createEstateAgentProfile.ts").includes(
    "not_authenticated"
  ) &&
    readProjectFile("lib/estateAgent/createEstateAgentProfile.ts").includes(
      "profile_user_mismatch"
    )
);

// ---------------------------------------------------------------------------
// Source: login / join / verify-email / homeowner login recovery paths
// ---------------------------------------------------------------------------

const eaLoginSource = readProjectFile("app/estate-agents/login/page.tsx");
assert(
  "EA login uses bootstrapAuthenticatedEstateAgentProfile",
  eaLoginSource.includes("bootstrapAuthenticatedEstateAgentProfile")
);

const homeownerLoginSource = readProjectFile("app/login/page.tsx");
assert(
  "Homeowner login bootstraps EA metadata intent before profile use",
  homeownerLoginSource.includes(
    "bootstrapAuthenticatedEstateAgentProfile"
  )
);
assert(
  "Homeowner signup still uses ensureUserProfile (no EA metadata path)",
  homeownerLoginSource.includes("ensureUserProfile(supabase)") &&
    homeownerLoginSource.includes("buildHomeownerSignupLegalAcceptance")
);

const joinSource = readProjectFile("app/estate-agents/join/page.tsx");
assert(
  "Join bootstraps EA profile before fetchAuthenticatedProfileAccountFields",
  joinSource.includes("bootstrapAuthenticatedEstateAgentProfile") &&
    joinSource.indexOf("bootstrapAuthenticatedEstateAgentProfile") <
      joinSource.indexOf("fetchAuthenticatedProfileAccountFields")
);

const verifyEmailSource = readProjectFile("app/verify-email/page.tsx");
assert(
  "verify-email bootstraps EA when session user exists",
  verifyEmailSource.includes("bootstrapAuthenticatedEstateAgentProfile")
);

assert(
  "Real flow documented in signupAuthMetadata: Auth metadata primary",
  readProjectFile("lib/estateAgent/signupAuthMetadata.ts").includes(
    "durable cross-tab recovery"
  )
);

if (process.exitCode && process.exitCode !== 0) {
  console.error("\nEA signup recovery verification FAILED");
  process.exit(process.exitCode);
}

console.log("\nEA signup recovery verification PASSED");
