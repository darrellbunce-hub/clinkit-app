/**
 * Batch 13 — legal gate integrity, pending-acceptance TTL, signup resend,
 * and onboarding RPC rollback checks.
 *
 *   npx tsx scripts/verify-legal-gate-integrity-batch13.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildSignupConfirmationResendRequest } from "../lib/auth/signupConfirm";
import { buildPasswordRecoveryConfirmUrl } from "../lib/auth/passwordReset";
import { isAccountGatedRoute, ROUTES } from "../lib/auth/routes";
import { LEGAL_DOCUMENT_VERSIONS } from "../lib/legal/constants";
import {
  clearPendingSignupLegalAcceptance,
  inspectPendingSignupLegalAcceptance,
  PENDING_SIGNUP_LEGAL_TTL_MS,
  readPendingSignupLegalAcceptance,
  savePendingSignupLegalAcceptance,
} from "../lib/legal/pendingLegalAcceptance";
import {
  ensurePendingSignupLegalAcceptanceFlushed,
  flushPendingSignupLegalAcceptance,
  recordExplicitSignupLegalAcceptance,
} from "../lib/legal/recordSignupLegalAcceptance";

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

type MemoryStorage = Storage & { memory: Map<string, string> };

function memoryStorage(): MemoryStorage {
  const memory = new Map<string, string>();

  return {
    memory,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  } as MemoryStorage;
}

function installWindow() {
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();

  (globalThis as { window?: Window }).window = {
    sessionStorage,
    localStorage,
  } as Window;

  return { sessionStorage, localStorage };
}

function removeWindow() {
  delete (globalThis as { window?: Window }).window;
}

const layout = read("app/layout.tsx");
const gate = read(
  "components/legal/PendingSignupLegalAcceptanceGate.tsx"
);
const verifyEmail = read("app/verify-email/page.tsx");
const forgotPassword = read("app/forgot-password/page.tsx");
const migration = read(
  "supabase/migrations/20261125220000_complete_estate_agent_onboarding_atomic.sql"
);
const onboardingClient = read("lib/estateAgent/completeOnboarding.ts");
const eaJoin = read("app/estate-agents/join/page.tsx");
const eaOnboarding = read("app/estate-agents/onboarding/page.tsx");
const homeownerLogin = read("app/login/page.tsx");
const eaLogin = read("app/estate-agents/login/page.tsx");

check(
  "Root layout gates product routes through the pending-acceptance gate",
  layout.includes("PendingSignupLegalAcceptanceGate") &&
    layout.includes("<PendingSignupLegalAcceptanceGate>")
);

check(
  "Gate uses account-route classification and only renders children when clear",
  gate.includes("isAccountGatedRoute") &&
    gate.includes("ensurePendingSignupLegalAcceptanceFlushed") &&
    /if \(phase === "clear"\) \{\s*return children;/.test(gate) &&
    !gate.includes("searchParams")
);

check(
  "Homeowner product routes are inside the gate",
  isAccountGatedRoute("/dashboard") &&
    isAccountGatedRoute("/start-move") &&
    isAccountGatedRoute("/join-chain") &&
    isAccountGatedRoute(ROUTES.homeownerDashboard)
);

check(
  "EA onboarding, billing, and agent home are inside the gate",
  isAccountGatedRoute("/estate-agents/onboarding") &&
    isAccountGatedRoute("/estate-agents/onboarding/billing") &&
    isAccountGatedRoute("/agent") &&
    isAccountGatedRoute("/agent/originate")
);

check(
  "Login, recovery, verify-email, and invitation preview stay outside the product gate",
  !isAccountGatedRoute("/login") &&
    !isAccountGatedRoute("/estate-agents/login") &&
    !isAccountGatedRoute("/estate-agents/join") &&
    !isAccountGatedRoute("/verify-email") &&
    !isAccountGatedRoute("/forgot-password") &&
    !isAccountGatedRoute("/reset-password") &&
    !isAccountGatedRoute("/auth/confirm")
);

check(
  "Verify-email return link renders only after the legal gate is clear",
  verifyEmail.includes('legalGate === "clear"') &&
    /legalGate === "clear" \? \([\s\S]*href=\{safeNextDestination\}/.test(
      verifyEmail
    )
);

check(
  "Verify-email still stops automatic redirect when persistence fails",
  /if \(!legalFlush\.ok\) \{[\s\S]*setLegalGate\("blocked"\)[\s\S]*setIsFinishingVerification\(false\)[\s\S]*return;/.test(
    verifyEmail
  )
);

check(
  "Signup resend uses the confirm redirect helper",
  verifyEmail.includes("buildSignupConfirmationResendRequest") &&
    !verifyEmail.includes('type: "recovery"') &&
    !verifyEmail.includes("type: 'recovery'")
);

check(
  "Password recovery resend path is unchanged",
  forgotPassword.includes("resetPasswordForEmail") &&
    forgotPassword.includes("buildPasswordRecoveryConfirmUrl") &&
    !forgotPassword.includes("buildSignupConfirmationResendRequest") &&
    !forgotPassword.includes('type: "signup"')
);

check(
  "EA join, onboarding, and both logins keep a failed-persist block",
  eaJoin.includes("legalAcceptanceBlocked") &&
    eaJoin.includes("SignupLegalAcceptanceRecoveryPanel") &&
    eaOnboarding.includes("legalBlock") &&
    homeownerLogin.includes("showExpiredLegalRecovery") &&
    eaLogin.includes("showExpiredLegalRecovery")
);

const safeResend = buildSignupConfirmationResendRequest(
  "https://app.example",
  "person@example.com",
  "/claim?token=1"
);

check(
  "Signup resend targets /auth/confirm and keeps a safe next",
  safeResend.type === "signup" &&
    safeResend.email === "person@example.com" &&
    safeResend.options.emailRedirectTo ===
      "https://app.example/auth/confirm?next=%2Fclaim%3Ftoken%3D1"
);

const unsafeResend = buildSignupConfirmationResendRequest(
  "https://app.example",
  "person@example.com",
  "https://evil.example/phish"
);

check(
  "Signup resend rejects an open redirect",
  unsafeResend.options.emailRedirectTo.startsWith(
    "https://app.example/auth/confirm?"
  ) &&
    !unsafeResend.options.emailRedirectTo.includes("evil.example") &&
    unsafeResend.options.emailRedirectTo.includes(
      encodeURIComponent(ROUTES.homeownerDashboard)
    )
);

const recoveryUrl = buildPasswordRecoveryConfirmUrl(
  "https://app.example"
);

check(
  "Recovery confirm URL is still the reset-password hop",
  recoveryUrl ===
    "https://app.example/auth/confirm?next=%2Freset-password" &&
    recoveryUrl !== safeResend.options.emailRedirectTo
);

check(
  "profile_update_failed raises instead of returning ok false",
  /raise exception 'profile_update_failed'/.test(migration) &&
    !migration.includes("'error', 'profile_update_failed'") &&
    migration.includes("security definer") &&
    migration.includes("set search_path = public") &&
    migration.includes("v_user_id uuid := auth.uid()") &&
    !/p_user_id/.test(migration) &&
    !/p_email_domain/.test(migration)
);

check(
  "Onboarding client maps a raised profile_update_failed without claiming a saved branch",
  onboardingClient.includes(
    "mapCompleteEstateAgentOnboardingTransportError"
  ) &&
    onboardingClient.includes("Nothing was saved") &&
    !onboardingClient.includes("branch was created")
);

{
  const { sessionStorage, localStorage } = installWindow();
  const acceptedAtMs = 1_700_000_000_000;

  try {
    savePendingSignupLegalAcceptance({
      termsDocument: "terms_of_use",
      termsVersion: "1.0",
      privacyVersion: "1.1",
      acceptedAt: new Date(acceptedAtMs).toISOString(),
    });

    const atTtl = inspectPendingSignupLegalAcceptance(
      acceptedAtMs + PENDING_SIGNUP_LEGAL_TTL_MS
    );
    const pastTtl = inspectPendingSignupLegalAcceptance(
      acceptedAtMs + PENDING_SIGNUP_LEGAL_TTL_MS + 1
    );

    check(
      "Acceptance still inside the TTL remains readable",
      atTtl.state === "valid" &&
        atTtl.state === "valid" &&
        atTtl.record.termsVersion === "1.0"
    );
    check(
      "Acceptance past the TTL is expired, not absent",
      pastTtl.state === "expired" &&
        readPendingSignupLegalAcceptance() === null
    );

    clearPendingSignupLegalAcceptance();

    check(
      "Genuinely absent pending acceptance is absent",
      inspectPendingSignupLegalAcceptance().state === "absent" &&
        readPendingSignupLegalAcceptance() === null &&
        sessionStorage.memory.size === 0 &&
        localStorage.memory.size === 0
    );
  } finally {
    clearPendingSignupLegalAcceptance();
    removeWindow();
  }
}

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

function mockSupabase(options: {
  session: boolean;
  rpc?: (args: Record<string, unknown>) => {
    data: { ok?: boolean; error?: string } | null;
    error: { message: string } | null;
  };
  calls: RpcCall[];
}) {
  return {
    auth: {
      getSession: async () => ({
        data: {
          session: options.session ? { user: { id: "user-1" } } : null,
        },
      }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      options.calls.push({ fn, args });
      if (options.rpc) {
        return options.rpc(args);
      }

      return { data: { ok: true }, error: null };
    },
  };
}

async function main() {
  installWindow();
  const calls: RpcCall[] = [];

  try {
    const absent = await ensurePendingSignupLegalAcceptanceFlushed(
      mockSupabase({ session: true, calls }) as never
    );

    check(
      "Existing user without pending acceptance is not blocked and does not call the RPC",
      absent.ok === true &&
        absent.disposition === "absent" &&
        calls.length === 0
    );
  } finally {
    clearPendingSignupLegalAcceptance();
    removeWindow();
  }

{
  installWindow();
  const calls: RpcCall[] = [];

  try {
    savePendingSignupLegalAcceptance({
      termsDocument: "terms_of_use",
      termsVersion: "1.0",
      privacyVersion: "1.1",
      acceptedAt: new Date(
        Date.now() - PENDING_SIGNUP_LEGAL_TTL_MS - 60_000
      ).toISOString(),
    });

    const expired = await ensurePendingSignupLegalAcceptanceFlushed(
      mockSupabase({ session: true, calls }) as never
    );
    const after = inspectPendingSignupLegalAcceptance();

    check(
      "Expired pending acceptance blocks without an RPC or a new timestamp",
      expired.ok === false &&
        expired.disposition === "expired" &&
        calls.length === 0 &&
        after.state === "expired" &&
        readPendingSignupLegalAcceptance() === null
    );
  } finally {
    clearPendingSignupLegalAcceptance();
    removeWindow();
  }
}

{
  const { sessionStorage, localStorage } = installWindow();
  const calls: RpcCall[] = [];
  const storedAcceptedAt = "2026-11-25T12:00:00.000Z";

  try {
    savePendingSignupLegalAcceptance({
      termsDocument: "terms_of_use",
      termsVersion: "1.0",
      privacyVersion: "1.1",
      acceptedAt: storedAcceptedAt,
    });

    const failed = await flushPendingSignupLegalAcceptance(
      mockSupabase({
        session: true,
        calls,
        rpc: () => ({
          data: { ok: false, error: "legal_acceptance_record_failed" },
          error: null,
        }),
      }) as never
    );

    check(
      "Failed RPC persistence keeps the original acceptance and does not report success",
      failed.ok === false &&
        failed.disposition === "persist_failed" &&
        calls.length === 1 &&
        calls[0]?.args.p_accepted_at === storedAcceptedAt &&
        calls[0]?.args.p_terms_version === "1.0" &&
        readPendingSignupLegalAcceptance()?.acceptedAt ===
          storedAcceptedAt &&
        sessionStorage.memory.has(
          "keynetic:pending-signup-legal-acceptance"
        ) &&
        localStorage.memory.has(
          "keynetic:pending-signup-legal-acceptance"
        )
    );
  } finally {
    clearPendingSignupLegalAcceptance();
    removeWindow();
  }
}

{
  installWindow();
  const calls: RpcCall[] = [];

  try {
    savePendingSignupLegalAcceptance({
      termsDocument: "terms_of_use",
      termsVersion: "1.0",
      privacyVersion: "1.1",
      acceptedAt: new Date().toISOString(),
    });

    let rpcCalls = 0;
    const supabase = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: "user-1" } } },
        }),
      },
      rpc: async () => {
        rpcCalls += 1;
        await new Promise((resolvePromise) => {
          setTimeout(resolvePromise, 20);
        });
        return {
          data: { ok: false, error: "legal_acceptance_record_failed" },
          error: null,
        };
      },
    };

    await Promise.all([
      flushPendingSignupLegalAcceptance(supabase as never),
      flushPendingSignupLegalAcceptance(supabase as never),
    ]);

    check(
      "Concurrent flushes share one RPC call",
      rpcCalls === 1
    );

    const retried = await flushPendingSignupLegalAcceptance(
      mockSupabase({
        session: true,
        calls,
        rpc: () => ({ data: { ok: true }, error: null }),
      }) as never
    );

    check(
      "Retry after a failed flush can still record and clear storage",
      retried.ok === true &&
        retried.disposition === "flushed" &&
        inspectPendingSignupLegalAcceptance().state === "absent"
    );
  } finally {
    clearPendingSignupLegalAcceptance();
    removeWindow();
  }
}

{
  installWindow();
  const calls: RpcCall[] = [];
  const expiredAt = new Date(
    Date.now() - PENDING_SIGNUP_LEGAL_TTL_MS - 60_000
  ).toISOString();

  try {
    savePendingSignupLegalAcceptance({
      termsDocument: "terms_of_use",
      termsVersion: "9.9",
      privacyVersion: "9.9",
      acceptedAt: expiredAt,
    });

    await flushPendingSignupLegalAcceptance(
      mockSupabase({ session: true, calls }) as never
    );

    const recorded = await recordExplicitSignupLegalAcceptance(
      mockSupabase({ session: true, calls }) as never
    );
    const explicitCall = calls[0];

    check(
      "Re-acceptance uses current versions and a new timestamp, not the expired payload",
      recorded.ok === true &&
        calls.length === 1 &&
        explicitCall?.fn === "record_signup_legal_acceptances" &&
        explicitCall.args.p_terms_version ===
          LEGAL_DOCUMENT_VERSIONS.termsOfService &&
        explicitCall.args.p_privacy_version ===
          LEGAL_DOCUMENT_VERSIONS.privacyPolicy &&
        explicitCall.args.p_accepted_at !== expiredAt &&
        explicitCall.args.p_terms_version !== "9.9" &&
        inspectPendingSignupLegalAcceptance().state === "absent"
    );
  } finally {
    clearPendingSignupLegalAcceptance();
    removeWindow();
  }
}

{
  installWindow();

  try {
    sessionStorageSet("{not-json");

    const flushed = await flushPendingSignupLegalAcceptance(
      mockSupabase({
        session: true,
        calls: [],
      }) as never
    );

    check(
      "Invalid pending storage is cleaned and treated as absent",
      flushed.ok === true &&
        flushed.disposition === "absent" &&
        inspectPendingSignupLegalAcceptance().state === "absent"
    );
  } finally {
    clearPendingSignupLegalAcceptance();
    removeWindow();
  }
}

function sessionStorageSet(value: string) {
  window.sessionStorage.setItem(
    "keynetic:pending-signup-legal-acceptance",
    value
  );
}

if (failed > 0) {
  console.error(`\n${failed} Batch 13 check(s) failed`);
  process.exit(1);
}

console.log("\nAll Batch 13 legal gate integrity checks passed.");
}

void main();
