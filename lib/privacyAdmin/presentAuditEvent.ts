const ALLOWED_AUDIT_KEYS = new Set([
  "request_source",
  "mechanism",
  "property_id",
  "action_type",
  "processor",
  "status",
  "completed",
  "skipped",
  "blocked",
  "failed",
  "pending_external",
  "final_status",
  "approved_fingerprint",
  "fresh_fingerprint",
  "gdpr_scope",
  "reason_code",
]);

export function sanitizeAuditEventDetail(
  detail: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!detail) {
    return {};
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (!ALLOWED_AUDIT_KEYS.has(key)) {
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      output[key] = value;
    }
  }

  return output;
}
