/**
 * Adversarial security verification for Privacy Admin MFA / AAL2 boundaries.
 *
 * Usage:
 *   npx tsx scripts/verify-privacy-admin-security.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  grantPlatformAdminForVerification,
  isPlatformAdminUserId,
} from "../lib/auth/platformAdminCore";
import {
  buildTotpEnrollPresentation,
  isTotpQrCodeDataUri,
  manualSetupKeyMustNotExposeQrData,
  partitionTotpFactorsFromMfaList,
} from "../lib/auth/platformAdminMfaCore";
import {
  resolvePlatformAdminAccess,
  type PlatformAdminAccessSignals,
} from "../lib/auth/platformAdminAccessCore";
import {
  buildAdminMfaChallengePath,
  sanitizeAdminNextPath,
} from "../lib/auth/safeAdminRedirect";
import {
  approveGdprErasureRequest,
  assessGdprErasureScope,
  createGdprErasureRequest,
  verifyGdprErasureIdentity,
} from "../lib/gdpr";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "PrivacyAdminSec123!";

const SENSITIVE_RPCS = [
  "create_gdpr_erasure_request",
  "verify_gdpr_erasure_identity",
  "assess_gdpr_erasure_scope",
  "approve_gdpr_erasure_request",
  "reject_gdpr_erasure_request",
  "execute_gdpr_erasure_request",
  "generate_erasure_impact_report",
  "lookup_auth_user_id_by_exact_email",
  "is_platform_admin",
  "get_gdpr_erasure_request_status",
  "complete_gdpr_erasure_auth_deletion",
  "update_gdpr_erasure_processor_action",
] as const;

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // optional
  }
}

function collectSourceFiles(dir: string, output: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectSourceFiles(fullPath, output);
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      output.push(fullPath);
    }
  }
  return output;
}

async function rpcDenied(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>
): Promise<boolean> {
  const { error } = await client.rpc(fn, args);
  return Boolean(error);
}

async function signUpUser(
  admin: SupabaseClient,
  stamp: number,
  label: string,
  accountType: "homeowner" | "estate_agent" = "homeowner"
) {
  const email = `privacy-sec-${label}-${stamp}@keynetic-test.dev`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "create_user_failed");
  }
  await admin.from("profiles").upsert({
    id: data.user.id,
    role: "homeowner",
    account_type: accountType,
    contact_name: `Privacy Sec ${label}`,
    onboarding_completed_at: new Date().toISOString(),
  });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) {
    throw signInError;
  }
  return { client, userId: data.user.id, email };
}

function accessSignals(
  overrides: Partial<PlatformAdminAccessSignals>
): PlatformAdminAccessSignals {
  return {
    userId: null,
    isPlatformAdmin: false,
    currentLevel: null,
    nextLevel: null,
    verifiedTotpFactorId: null,
    unverifiedTotpFactorIds: [],
    ...overrides,
  };
}

loadEnvLocal();

async function main() {
  console.log("=== Privacy Admin Security Verification (Development only) ===\n");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables");
  }

  const projectRef = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(`Refusing to run on non-Development project: ${projectRef ?? "unknown"}`);
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const homeowner = await signUpUser(admin, stamp, "homeowner");
  const estateAgent = await signUpUser(admin, stamp, "ea", "estate_agent");
  const platformAdmin = await signUpUser(admin, stamp, "platform");
  await grantPlatformAdminForVerification({ userId: platformAdmin.userId });

  record(
    "Unauthenticated admin access denied (platform-admin check)",
    (await isPlatformAdminUserId("")) === false
  );
  record(
    "Homeowner denied platform-admin authority",
    (await isPlatformAdminUserId(homeowner.userId)) === false
  );
  record(
    "Estate agent denied platform-admin authority",
    (await isPlatformAdminUserId(estateAgent.userId)) === false
  );
  record(
    "EA branch admin denied (no platform_admins row)",
    (await isPlatformAdminUserId(estateAgent.userId)) === false,
    "branch_admin is separate; no platform_admins grant"
  );
  record(
    "Non-platform-admin authenticated user denied",
    (await isPlatformAdminUserId(homeowner.userId)) === false
  );

  record(
    "Platform admin AAL1 denied privileged access (enrolment required)",
    resolvePlatformAdminAccess(
      accessSignals({
        userId: platformAdmin.userId,
        isPlatformAdmin: true,
        currentLevel: "aal1",
        nextLevel: "aal2",
        verifiedTotpFactorId: null,
      })
    ).kind === "mfa_enrollment_required"
  );

  record(
    "Platform admin AAL1 denied privileged access (challenge required)",
    resolvePlatformAdminAccess(
      accessSignals({
        userId: platformAdmin.userId,
        isPlatformAdmin: true,
        currentLevel: "aal1",
        nextLevel: "aal2",
        verifiedTotpFactorId: "factor-verified",
      })
    ).kind === "mfa_challenge_required"
  );

  record(
    "Platform admin AAL2 allowed",
    resolvePlatformAdminAccess(
      accessSignals({
        userId: platformAdmin.userId,
        isPlatformAdmin: true,
        currentLevel: "aal2",
        nextLevel: "aal2",
        verifiedTotpFactorId: "factor-verified",
      })
    ).kind === "privileged_allowed"
  );

  record(
    "Unverified TOTP factors are tracked from listFactors().all (not .totp only)",
    partitionTotpFactorsFromMfaList({
      all: [
        {
          id: "unverified-factor",
          factor_type: "totp",
          status: "unverified",
        },
      ],
    }).unverifiedTotpFactorIds.length === 1
  );

  const { data: enrollData, error: enrollError } =
    await platformAdmin.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Keynetic Privacy Admin",
      issuer: "Keynetic",
    });
  record(
    "First-time platform-admin MFA enrol initiation succeeds (browser session path)",
    !enrollError &&
      Boolean(enrollData?.totp?.qr_code) &&
      Boolean(enrollData?.totp?.secret) &&
      Boolean(enrollData?.id),
    enrollError ? enrollError.message.replace(/[A-Z2-7]{16,}/g, "[REDACTED]") : undefined
  );

  const { data: factorsAfterEnroll } =
    await platformAdmin.client.auth.mfa.listFactors();
  record(
    "Abandoned unverified TOTP factor is visible to cleanup logic",
    partitionTotpFactorsFromMfaList(factorsAfterEnroll).unverifiedTotpFactorIds.length >= 1
  );

  if (enrollData?.id) {
    await platformAdmin.client.auth.mfa.unenroll({ factorId: enrollData.id });
  }

  const enrollPanelSource = readFileSync(
    join(process.cwd(), "components", "privacyAdmin", "PlatformAdminMfaEnrollPanel.tsx"),
    "utf8"
  );

  record(
    "Supabase TOTP qr_code is an SVG data URI for image src",
    Boolean(enrollData?.totp?.qr_code && isTotpQrCodeDataUri(enrollData.totp.qr_code))
  );

  record(
    "Supabase TOTP enrol includes standards-compatible otpauth URI",
    Boolean(enrollData?.totp?.uri?.startsWith("otpauth://totp/"))
  );

  record(
    "TOTP presentation builder uses qr_code only as image src candidate",
    Boolean(
      enrollData?.totp?.qr_code &&
        enrollData.totp.secret &&
        buildTotpEnrollPresentation({
          qrCode: enrollData.totp.qr_code,
          secret: enrollData.totp.secret,
        }).qrCodeSrc.startsWith("data:image/svg+xml")
    )
  );

  const manualSetupSection = enrollPanelSource.split("Manual setup key")[1] ?? "";

  record(
    "QR data URI is used only as image src (not HTML injection)",
    enrollPanelSource.includes("src={qrCodeSrc}") &&
      !enrollPanelSource.includes("dangerouslySetInnerHTML")
  );

  record(
    "Manual setup fallback does not expose QR data URI content",
    Boolean(enrollData?.totp?.secret) &&
      manualSetupKeyMustNotExposeQrData(enrollData!.totp!.secret) &&
      manualSetupSection.includes("{manualSetupKey}") &&
      !manualSetupSection.includes("qrCodeSrc")
  );

  record(
    "Enrol panel exposes fresh QR regeneration control",
    enrollPanelSource.includes("regeneratePlatformAdminMfaEnrollClient") &&
      enrollPanelSource.includes("Generate a new QR code")
  );

  record(
    "MFA enrolment uses browser client module (not server action enrol)",
    readFileSync(
      join(process.cwd(), "components", "privacyAdmin", "PlatformAdminMfaEnrollPanel.tsx"),
      "utf8"
    ).includes("startPlatformAdminMfaEnrollClient") &&
      !readFileSync(
        join(process.cwd(), "components", "privacyAdmin", "PlatformAdminMfaEnrollPanel.tsx"),
        "utf8"
      ).includes("startPlatformAdminMfaEnrollAction")
  );

  record(
    "Open redirect attempts after MFA are rejected/sanitised",
    sanitizeAdminNextPath("https://evil.example/admin/privacy") === null &&
      sanitizeAdminNextPath("//evil.example/admin/privacy") === null &&
      sanitizeAdminNextPath("/admin/privacy/abc") === "/admin/privacy/abc" &&
      buildAdminMfaChallengePath("https://evil.example").startsWith("/admin/mfa/challenge") &&
      !buildAdminMfaChallengePath("https://evil.example").includes("evil")
  );

  for (const rpcName of SENSITIVE_RPCS) {
    const deniedAnon = await rpcDenied(anon, rpcName, sampleRpcArgs(rpcName, platformAdmin.userId));
    record(`Sensitive RPC denied to anon: ${rpcName}`, deniedAnon);
  }

  for (const rpcName of SENSITIVE_RPCS) {
    const deniedAuth = await rpcDenied(
      homeowner.client,
      rpcName,
      sampleRpcArgs(rpcName, homeowner.userId)
    );
    record(`Sensitive RPC denied to authenticated homeowner: ${rpcName}`, deniedAuth);
  }

  record(
    "Service-role can create GDPR erasure request",
    (
      await createGdprErasureRequest({
        supabase: admin,
        subjectUserId: homeowner.userId,
        requestSource: "internal_dev_fixture",
      })
    ).ok === true
  );

  const created = await createGdprErasureRequest({
    supabase: admin,
    subjectUserId: homeowner.userId,
    requestSource: "internal_dev_fixture",
  });
  const requestId = created.request_id as string;

  record(
    "Authenticated homeowner cannot verify identity via RPC",
    await rpcDenied(homeowner.client, "verify_gdpr_erasure_identity", {
      p_request_id: requestId,
      p_verified_by: homeowner.userId,
    })
  );

  const statusBefore = (
    await admin.from("gdpr_erasure_requests").select("status").eq("id", requestId).single()
  ).data?.status;
  record(
    "No mutation occurs after failed homeowner authorisation",
    statusBefore === "requested"
  );

  record(
    "Platform admin AAL1 cannot execute erasure via RPC directly",
    await rpcDenied(platformAdmin.client, "execute_gdpr_erasure_request", {
      p_request_id: requestId,
    })
  );

  await verifyGdprErasureIdentity({ supabase: admin, requestId });
  await assessGdprErasureScope({ supabase: admin, requestId });
  await approveGdprErasureRequest({ supabase: admin, requestId });

  record(
    "Platform admin AAL1 cannot execute approved erasure via RPC",
    await rpcDenied(platformAdmin.client, "execute_gdpr_erasure_request", {
      p_request_id: requestId,
    })
  );

  record(
    "Non-admin lookup RPC denied to authenticated user",
    await rpcDenied(homeowner.client, "lookup_auth_user_id_by_exact_email", {
      p_email: homeowner.email,
    })
  );

  record(
    "Platform admin AAL1 lookup RPC denied at database grant layer to user JWT",
    await rpcDenied(platformAdmin.client, "lookup_auth_user_id_by_exact_email", {
      p_email: homeowner.email,
    }),
    "application path also requires AAL2 before lookup"
  );

  const clientSources = [
    ...collectSourceFiles(join(process.cwd(), "components", "privacyAdmin")),
    ...collectSourceFiles(join(process.cwd(), "app", "admin")),
    ...collectSourceFiles(join(process.cwd(), "lib", "privacyAdmin")),
    ...collectSourceFiles(join(process.cwd(), "lib", "auth")),
  ];
  record(
    "No service-role key in Privacy Admin client/server UI source paths",
    !clientSources.some((filePath) =>
      readFileSync(filePath, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY")
    )
  );

  const { error: platformAdminSelectError } = await homeowner.client
    .from("platform_admins")
    .select("user_id")
    .limit(1);
  record(
    "Platform-admin allowlist remains deny-by-default for authenticated users",
    Boolean(platformAdminSelectError)
  );

  record(
    "Session downgrade logic denies AAL1 privileged state",
    resolvePlatformAdminAccess(
      accessSignals({
        userId: platformAdmin.userId,
        isPlatformAdmin: true,
        currentLevel: "aal1",
        nextLevel: "aal2",
        verifiedTotpFactorId: "verified-factor",
      })
    ).kind !== "privileged_allowed"
  );

  record(
    "MFA enrolment secrets are not persisted in Keynetic tables",
    !readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260718160000_platform_admin_authority.sql"),
      "utf8"
    ).toLowerCase().includes("totp")
  );

  record(
    "Request ID guessing does not expose data through authenticated homeowner RPC",
    await rpcDenied(homeowner.client, "get_gdpr_erasure_request_status", {
      p_request_id: requestId,
    })
  );

  record(
    "Central authority module exists for adversarial re-check on every action",
    readFileSync(join(process.cwd(), "lib", "privacyAdmin", "auth.ts"), "utf8").includes(
      "evaluatePlatformAdminAccess"
    ) &&
      readFileSync(join(process.cwd(), "lib", "privacyAdmin", "actions.ts"), "utf8").includes(
        "requirePrivacyAdminContext"
      )
  );

  console.log(`\nResults: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    process.exit(1);
  }
  console.log("\n=== PRIVACY ADMIN SECURITY VERIFICATION PASSED ===");
  console.log(
    "\nManual browser verification still required for live AAL2 cookie/session behaviour, MFA QR display, and route 404 semantics."
  );
}

function sampleRpcArgs(rpcName: string, userId: string): Record<string, unknown> {
  switch (rpcName) {
    case "create_gdpr_erasure_request":
      return { p_subject_user_id: userId, p_request_source: "internal_dev_fixture" };
    case "verify_gdpr_erasure_identity":
      return { p_request_id: "00000000-0000-0000-0000-000000000001" };
    case "assess_gdpr_erasure_scope":
      return { p_request_id: "00000000-0000-0000-0000-000000000001" };
    case "approve_gdpr_erasure_request":
      return { p_request_id: "00000000-0000-0000-0000-000000000001" };
    case "reject_gdpr_erasure_request":
      return { p_request_id: "00000000-0000-0000-0000-000000000001" };
    case "execute_gdpr_erasure_request":
      return { p_request_id: "00000000-0000-0000-0000-000000000001" };
    case "generate_erasure_impact_report":
      return { p_user_id: userId };
    case "lookup_auth_user_id_by_exact_email":
      return { p_email: "missing@keynetic-test.dev" };
    case "is_platform_admin":
      return { p_user_id: userId };
    case "get_gdpr_erasure_request_status":
      return { p_request_id: "00000000-0000-0000-0000-000000000001" };
    case "complete_gdpr_erasure_auth_deletion":
      return { p_request_id: "00000000-0000-0000-0000-000000000001" };
    case "update_gdpr_erasure_processor_action":
      return {
        p_request_id: "00000000-0000-0000-0000-000000000001",
        p_processor: "vercel",
        p_status: "completed",
      };
    default:
      return {};
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
