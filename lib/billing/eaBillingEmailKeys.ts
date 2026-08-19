/**
 * Deterministic dispatch keys and grace reminder eligibility for EA billing emails.
 * Pure helpers — safe for verifiers without server-only imports.
 */

export const EA_BILLING_EMAIL_TEMPLATES = [
  "ea-subscription-confirmation",
  "ea-payment-failed",
  "ea-grace-reminder",
  "ea-grace-final-warning",
  "ea-subscription-cancelled",
] as const;

export type EaBillingEmailTemplateId =
  (typeof EA_BILLING_EMAIL_TEMPLATES)[number];

/** Mid-grace reminder after ~3.5 days of a 7-day grace window. */
export const EA_GRACE_MID_REMINDER_AFTER_MS = 3.5 * 24 * 60 * 60 * 1000;

/** Final warning when ≤48h remain before grace expiry. */
export const EA_GRACE_FINAL_WARNING_WITHIN_MS = 48 * 60 * 60 * 1000;

export function billingConfirmationDispatchKey(
  stripeSubscriptionId: string
): string {
  return `subscription:${stripeSubscriptionId}:confirmation`;
}

export function billingPaymentFailedDispatchKey(input: {
  invoiceId?: string | null;
  stripeSubscriptionId: string;
  graceEndsAt: string;
}): string {
  if (input.invoiceId?.trim()) {
    return `invoice:${input.invoiceId.trim()}:payment_failed`;
  }
  return `subscription:${input.stripeSubscriptionId}:grace:${input.graceEndsAt}`;
}

export function billingGraceMidDispatchKey(
  stripeSubscriptionId: string,
  graceEndsAt: string
): string {
  return `subscription:${stripeSubscriptionId}:grace_mid:${graceEndsAt}`;
}

export function billingGraceFinalDispatchKey(
  stripeSubscriptionId: string,
  graceEndsAt: string
): string {
  return `subscription:${stripeSubscriptionId}:grace_final:${graceEndsAt}`;
}

export function billingCancellationDispatchKey(
  stripeSubscriptionId: string,
  effectiveEndDate: string
): string {
  return `subscription:${stripeSubscriptionId}:cancellation:${effectiveEndDate}`;
}

export function isGraceMidReminderDue(input: {
  graceEndsAt: string;
  now?: Date;
  graceDays?: number;
}): boolean {
  const now = input.now ?? new Date();
  const ends = new Date(input.graceEndsAt).getTime();
  if (Number.isNaN(ends) || ends <= now.getTime()) return false;
  const remaining = ends - now.getTime();
  if (remaining <= EA_GRACE_FINAL_WARNING_WITHIN_MS) return false;
  const graceDays = input.graceDays ?? 7;
  const started = ends - graceDays * 24 * 60 * 60 * 1000;
  const elapsed = now.getTime() - started;
  return elapsed >= EA_GRACE_MID_REMINDER_AFTER_MS;
}

export function isGraceFinalWarningDue(input: {
  graceEndsAt: string;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  const ends = new Date(input.graceEndsAt).getTime();
  if (Number.isNaN(ends)) return false;
  const remaining = ends - now.getTime();
  return remaining > 0 && remaining <= EA_GRACE_FINAL_WARNING_WITHIN_MS;
}
