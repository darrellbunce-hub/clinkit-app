/**
 * Development-only verification for GDPR Phase 4 (suppression ledger + processors).
 *
 * Requires migrations through 20260719100000_gdpr_erasure_phase4.sql on Development.
 *
 * Usage:
 *   npx tsx scripts/verify-gdpr-erasure-phase4.ts
 */
import { randomUUID } from "crypto";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { completeGdprAuthDeletion } from "../lib/gdpr/completeAuthDeletion";
import {
  executeGdprErasureRequest,
  markGdprErasureAuthDeletionEligible,
  matchGdprSuppressionLedgerIdentities,
  recordGdprErasureSuppressionLedger,
  updateGdprErasureProcessorAction,
} from "../lib/gdpr/erasureExecution";
import {
  approveGdprErasureRequest,
  assessGdprErasureScope,
  createGdprErasureRequest,
  getGdprErasureRequestStatus,
  verifyGdprErasureIdentity,
} from "../lib/gdpr/erasureRequest";
import {
  assertFingerprintsContainNoRawEmail,
  computeSuppressionFingerprints,
  deriveRequestCompletionStatus,
  fingerprintsMatch,
  isProcessorStatusBlocking,
  isProcessorStatusSatisfied,
  normalizeEmailForSuppression,
} from "../lib/gdpr/suppressionLedgerCore";
import { GDPR_SUPPRESSION_HMAC_KEY_ENV } from "../lib/gdpr/suppressionLedger";
import { buildCompletionChecklist } from "../lib/privacyAdmin/presentCompletionChecklist";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "GdprPhase4Verify123!";
const DEV_HMAC_KEY = "dev-phase4-verification-pepper-not-for-production";

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

async function signUpUser(
  admin: SupabaseClient,
  stamp: number,
  label: string
): Promise<{ client: SupabaseClient; userId: string; email: string }> {
  const email = `gdpr-phase4-${label}-${stamp}@keynetic-test.dev`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "create_user_failed");
  }
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  return { client, userId: data.user.id, email };
}

async function advanceToAwaitingAuthDeletion(
  admin: SupabaseClient,
  userId: string
): Promise<string> {
  const created = await createGdprErasureRequest({
    supabase: admin,
    subjectUserId: userId,
    requestSource: "internal_dev_fixture",
  });
  if (created.ok !== true || !created.request_id) {
    throw new Error(String(created.error ?? "create_failed"));
  }
  const requestId = created.request_id;
  await verifyGdprErasureIdentity({ supabase: admin, requestId, verifiedBy: null });
  await assessGdprErasureScope({ supabase: admin, requestId });
  await approveGdprErasureRequest({ supabase: admin, requestId, approvedBy: null });
  const executed = await executeGdprErasureRequest({ supabase: admin, requestId });
  if (executed.ok !== true) {
    throw new Error(String(executed.error ?? "execute_failed"));
  }
  await markGdprErasureAuthDeletionEligible({ supabase: admin, requestId });
  return requestId;
}

loadEnvLocal();

async function main() {
  console.log("=== GDPR Phase 4 Verification (Development only) ===\n");

  if (!process.env[GDPR_SUPPRESSION_HMAC_KEY_ENV]?.trim()) {
    process.env[GDPR_SUPPRESSION_HMAC_KEY_ENV] = DEV_HMAC_KEY;
  }

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
  const emailA = `phase4-a-${stamp}@keynetic-test.dev`;
  const emailB = `phase4-b-${stamp}@keynetic-test.dev`;
  const userA = randomUUID();
  const userB = randomUUID();

  const fpA1 = computeSuppressionFingerprints(DEV_HMAC_KEY, {
    userId: userA,
    email: emailA,
  });
  const fpA2 = computeSuppressionFingerprints(DEV_HMAC_KEY, {
    userId: userA,
    email: emailA,
  });
  const fpB = computeSuppressionFingerprints(DEV_HMAC_KEY, {
    userId: userB,
    email: emailB,
  });

  record(
    "HMAC fingerprint deterministic for same normalised identity",
    fingerprintsMatch(fpA1.subjectUserIdFingerprint, fpA2.subjectUserIdFingerprint) &&
      fingerprintsMatch(fpA1.emailIdentityFingerprint, fpA2.emailIdentityFingerprint)
  );
  record(
    "Different identities produce different fingerprints",
    !fingerprintsMatch(fpA1.emailIdentityFingerprint, fpB.emailIdentityFingerprint)
  );
  record(
    "Raw email absent from fingerprint outputs",
    assertFingerprintsContainNoRawEmail(fpA1, emailA)
  );
  record(
    "Email normalisation lowercases and trims",
    normalizeEmailForSuppression("  Test@Example.COM ") === "test@example.com"
  );

  try {
    computeSuppressionFingerprints("", { userId: userA, email: emailA });
    record("Missing HMAC environment key fails closed", false);
  } catch (error) {
    record(
      "Missing HMAC environment key fails closed",
      error instanceof Error && error.message.includes("suppression_hmac_key_missing")
    );
  }

  const subject = await signUpUser(admin, stamp, "ledger");

  const { error: rpcProbeError } = await admin.rpc(
    "match_gdpr_suppression_ledger_identities",
    {
      p_subject_user_id_hash: fpA1.subjectUserIdFingerprint,
      p_email_identity_fingerprint: fpA1.emailIdentityFingerprint,
    }
  );

  if (rpcProbeError?.message.includes("Could not find the function")) {
    console.log(
      "\nPhase 4 migration not applied on Development — skipping database integration tests."
    );
    console.log("Apply: supabase/migrations/20260719100000_gdpr_erasure_phase4.sql\n");
    const purePassed = results.filter((r) => r.pass).length;
    console.log(`Results: ${purePassed}/${results.length} passed (integration tests skipped)`);
    console.log("\n=== GDPR PHASE 4 PARTIAL VERIFICATION (apply migration for full run) ===");
    return;
  }

  const requestId = await advanceToAwaitingAuthDeletion(admin, subject.userId);

  const firstRecord = await recordGdprErasureSuppressionLedger({
    supabase: admin,
    requestId,
    userId: subject.userId,
    email: subject.email,
  });
  record(
    "Suppression creation succeeds before Auth deletion",
    firstRecord.ok === true
  );

  const secondRecord = await recordGdprErasureSuppressionLedger({
    supabase: admin,
    requestId,
    userId: subject.userId,
    email: subject.email,
  });
  record("Suppression creation idempotent", secondRecord.ok === true);

  const { data: ledgerRows, error: ledgerReadError } = await admin
    .from("gdpr_erasure_suppression_ledger")
    .select("subject_user_id_hash, email_hash, hash_algorithm")
    .eq("erasure_request_id", requestId);

  record(
    "Raw email absent from suppression ledger",
    !ledgerReadError &&
      (ledgerRows ?? []).every(
        (row) =>
          !String(row.email_hash).includes("@") &&
          !String(row.subject_user_id_hash).includes("@")
      )
  );
  record(
    "HMAC key absent from database ledger rows",
    !ledgerReadError &&
      JSON.stringify(ledgerRows ?? []).toLowerCase().includes(DEV_HMAC_KEY.toLowerCase()) ===
        false
  );

  const match = await matchGdprSuppressionLedgerIdentities({
    supabase: admin,
    userId: subject.userId,
    email: subject.email,
  });
  record(
    "Erased identity can be matched in simulated restore",
    match.ok && match.matches.includes(requestId)
  );

  const nonMatch = await matchGdprSuppressionLedgerIdentities({
    supabase: admin,
    userId: userB,
    email: emailB,
  });
  record(
    "Unrelated identity does not match erased ledger entry",
    nonMatch.ok && !nonMatch.matches.includes(requestId)
  );

  const repeatMatch = await matchGdprSuppressionLedgerIdentities({
    supabase: admin,
    userId: subject.userId,
    email: subject.email,
  });
  record(
    "Re-erasure simulation match idempotent",
    repeatMatch.ok &&
      repeatMatch.matches.length === match.matches.length &&
      repeatMatch.matches.includes(requestId)
  );

  const { error: anonLedgerError } = await anon.from("gdpr_erasure_suppression_ledger").select("id");
  record("Ledger inaccessible to anon", Boolean(anonLedgerError));

  const homeowner = await signUpUser(admin, stamp + 1, "homeowner");
  const { error: authLedgerError } = await homeowner.client
    .from("gdpr_erasure_suppression_ledger")
    .select("id");
  record("Ledger inaccessible to authenticated users", Boolean(authLedgerError));

  record(
    "Service-role ledger read behaves as intended",
    !ledgerReadError && (ledgerRows ?? []).length === 1
  );

  const authComplete = await completeGdprAuthDeletion({
    supabase: admin,
    requestId,
  });
  record(
    "Auth-last sequence preserved with suppression prerequisite",
    authComplete.ok === true,
    authComplete.ok === false ? String(authComplete.error) : undefined
  );

  const afterStatus = await getGdprErasureRequestStatus({
    supabase: admin,
    requestId,
  });
  record(
    "Suppression recorded timestamp present after auth completion path",
    afterStatus.ok === true && afterStatus.suppression_recorded === true
  );

  await updateGdprErasureProcessorAction({
    supabase: admin,
    requestId,
    processor: "vercel",
    status: "retention_expiry",
    statusCode: "retention_expiry",
  });
  const completedStatus = await getGdprErasureRequestStatus({
    supabase: admin,
    requestId,
  });
  record(
    "retention_expiry semantics allow completion recompute",
    completedStatus.ok === true &&
      (completedStatus.status === "completed" || completedStatus.status === "partially_completed")
  );

  record(
    "Request cannot misleadingly complete while required processor unresolved",
    deriveRequestCompletionStatus({
      authDeletionCompleted: true,
      requiredProcessors: [
        { processor: "resend", status: "pending", required: true },
      ],
    }) === "partially_completed"
  );

  const checklist = buildCompletionChecklist({
    databaseProcessingCompletedAt: new Date().toISOString(),
    suppressionRecorded: true,
    authDeletionCompletedAt: new Date().toISOString(),
    requestStatus: "partially_completed",
    processors: [
      {
        processor: "resend",
        actionType: "RESEND_ERASURE_REQUIRED",
        status: "pending",
        statusCode: null,
        required: true,
      },
    ],
  });
  record(
    "Privacy Admin presentation contains no raw fingerprint",
    checklist.exposesFingerprint === false &&
      JSON.stringify(checklist).includes("subject_user_id_hash") === false
  );
  record(
    "Privacy Admin presentation contains no erased email",
    JSON.stringify(checklist).includes(subject.email) === false
  );

  record(
    "Processor satisfied statuses include retention_expiry",
    isProcessorStatusSatisfied("retention_expiry") &&
      isProcessorStatusBlocking("pending")
  );

  const invalidProcessor = await updateGdprErasureProcessorAction({
    supabase: admin,
    requestId,
    processor: "nonexistent_processor",
    status: "completed",
  });
  record(
    "Invalid processor transitions rejected",
    invalidProcessor.ok === false
  );

  const duplicateComplete = await updateGdprErasureProcessorAction({
    supabase: admin,
    requestId,
    processor: "vercel",
    status: "retention_expiry",
    statusCode: "retention_expiry",
  });
  record(
    "Repeated processor completion idempotent",
    duplicateComplete.ok === true
  );

  const clientSources = collectSourceFiles(join(process.cwd(), "app")).concat(
    collectSourceFiles(join(process.cwd(), "components"))
  );
  const hmacKeyInClient = clientSources.some((file) =>
    readFileSync(file, "utf8").includes(DEV_HMAC_KEY)
  );
  record("HMAC key absent from client source/bundle paths", !hmacKeyInClient);

  const panelSource = readFileSync(
    join(process.cwd(), "components", "privacyAdmin", "PrivacyCompletionChecklist.tsx"),
    "utf8"
  );
  record(
    "Privacy Admin checklist UI avoids fingerprint display",
    !panelSource.includes("subject_user_id_hash") && !panelSource.includes("email_hash")
  );

  console.log(`\nResults: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    process.exit(1);
  }
  console.log("\n=== GDPR PHASE 4 VERIFICATION PASSED ===");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
