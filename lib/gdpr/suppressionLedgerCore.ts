/**
 * Pure suppression fingerprint helpers — safe for unit tests without env secrets.
 */
import { createHmac, timingSafeEqual } from "crypto";

export const GDPR_SUPPRESSION_HMAC_ALGORITHM = "hmac_sha256_v1" as const;

export type SuppressionFingerprints = {
  subjectUserIdFingerprint: string;
  emailIdentityFingerprint: string;
  hashAlgorithm: typeof GDPR_SUPPRESSION_HMAC_ALGORITHM;
};

export function normalizeEmailForSuppression(email: string): string {
  return email.trim().toLowerCase();
}

export function computeSuppressionFingerprints(
  hmacKey: string,
  params: { userId: string; email: string }
): SuppressionFingerprints {
  if (!hmacKey.trim()) {
    throw new Error("suppression_hmac_key_missing");
  }

  const normalizedEmail = normalizeEmailForSuppression(params.email);
  const subjectUserIdFingerprint = createHmac("sha256", hmacKey)
    .update(`uid:${params.userId}`)
    .digest("hex");
  const emailIdentityFingerprint = createHmac("sha256", hmacKey)
    .update(`email:${normalizedEmail}`)
    .digest("hex");

  return {
    subjectUserIdFingerprint,
    emailIdentityFingerprint,
    hashAlgorithm: GDPR_SUPPRESSION_HMAC_ALGORITHM,
  };
}

export function fingerprintsMatch(
  left: string,
  right: string
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function assertFingerprintsContainNoRawEmail(
  fingerprints: SuppressionFingerprints,
  rawEmail: string
): boolean {
  const normalized = normalizeEmailForSuppression(rawEmail);
  return (
    !fingerprints.emailIdentityFingerprint.includes("@") &&
    !fingerprints.subjectUserIdFingerprint.includes("@") &&
    fingerprints.emailIdentityFingerprint !== normalized &&
    !fingerprints.emailIdentityFingerprint.includes(normalized)
  );
}

export type ProcessorActionStatus =
  | "pending"
  | "manual_review"
  | "processing"
  | "completed"
  | "failed"
  | "not_required"
  | "not_applicable"
  | "retention_expiry";

export type CompletionSemantic =
  | "DATABASE_ERASURE_COMPLETE"
  | "AUTH_DELETION_COMPLETE"
  | "SUPPRESSION_PROTECTION_RECORDED"
  | "PROCESSOR_ACTION_PENDING"
  | "PROCESSOR_ACTION_COMPLETE"
  | "PROCESSOR_RETENTION_EXPIRY"
  | "MANUAL_REVIEW_REQUIRED";

const PROCESSOR_SATISFIED_STATUSES = new Set<ProcessorActionStatus>([
  "completed",
  "not_required",
  "not_applicable",
  "retention_expiry",
]);

const PROCESSOR_BLOCKING_STATUSES = new Set<ProcessorActionStatus>([
  "pending",
  "manual_review",
  "processing",
  "failed",
]);

export function isProcessorStatusSatisfied(status: string): boolean {
  return PROCESSOR_SATISFIED_STATUSES.has(status as ProcessorActionStatus);
}

export function isProcessorStatusBlocking(status: string): boolean {
  return PROCESSOR_BLOCKING_STATUSES.has(status as ProcessorActionStatus);
}

export function deriveRequestCompletionStatus(params: {
  authDeletionCompleted: boolean;
  requiredProcessors: Array<{ processor: string; status: string; required: boolean }>;
}): "completed" | "partially_completed" {
  const blocking = params.requiredProcessors.filter(
    (processor) =>
      processor.required &&
      processor.processor !== "supabase_auth" &&
      isProcessorStatusBlocking(processor.status)
  );

  if (params.authDeletionCompleted && blocking.length === 0) {
    return "completed";
  }

  return "partially_completed";
}

export function isValidProcessorStatusTransition(
  from: ProcessorActionStatus,
  to: ProcessorActionStatus
): boolean {
  if (from === to) {
    return true;
  }

  if (from === "completed" || from === "not_applicable" || from === "retention_expiry") {
    return to === from;
  }

  return true;
}
