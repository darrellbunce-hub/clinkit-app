import "server-only";

import { deliverOperationalEmail } from "@/lib/communications/operationalEmail";
import type { BillingOpsSeverity } from "@/lib/billing/eaBillingHealth";

/**
 * Ops alert destination — must be configured per environment.
 * Suggested Day 1 mailbox: admin@keynetic.co.uk (do not hard-code personal addresses).
 */
export function getBillingOpsAlertEmail(): string | null {
  const configured = process.env.BILLING_OPS_ALERT_EMAIL?.trim();
  return configured || null;
}

export type BillingOpsAlertEmailResult =
  | { ok: true; sent: true; messageId?: string }
  | { ok: true; sent: false; skipped: true; reason: string }
  | { ok: false; sent: false; error: string };

/**
 * Send a billing ops alert via the existing Resend pipeline.
 * Does not include customer emails, Stripe customer IDs, or branch PII in the body
 * (caller must already have sanitized the text).
 */
export async function sendBillingOpsAlertEmail(input: {
  severity: BillingOpsSeverity;
  subject: string;
  bodyText: string;
  incidentKey: string;
}): Promise<BillingOpsAlertEmailResult> {
  const to = getBillingOpsAlertEmail();
  if (!to) {
    console.warn(
      "[billing-ops] BILLING_OPS_ALERT_EMAIL unset — health issue detected but email not sent:",
      input.incidentKey
    );
    return {
      ok: true,
      sent: false,
      skipped: true,
      reason: "billing_ops_alert_email_unset",
    };
  }

  const html = `<pre style="font-family:ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(
    input.bodyText
  )}</pre>`;

  const result = await deliverOperationalEmail({
    to,
    subject: input.subject,
    html,
    text: input.bodyText,
    template: "billing-ops-alert",
  });

  if (result.ok && result.sent) {
    return { ok: true, sent: true, messageId: result.messageId };
  }
  if (result.ok && result.skipped) {
    return {
      ok: true,
      sent: false,
      skipped: true,
      reason: result.reason,
    };
  }
  if (!result.ok) {
    return { ok: false, sent: false, error: result.error };
  }
  return {
    ok: true,
    sent: false,
    skipped: true,
    reason: "unknown_skip",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
