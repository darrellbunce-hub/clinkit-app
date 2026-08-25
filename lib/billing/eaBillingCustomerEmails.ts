import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatGbpMinorAsMonthlyLabel,
} from "@/lib/billing/eaBranchPricing";
import {
  billingCancellationDispatchKey,
  billingConfirmationDispatchKey,
  billingGraceFinalDispatchKey,
  billingGraceMidDispatchKey,
  billingPaymentFailedDispatchKey,
  isGraceFinalWarningDue,
  isGraceMidReminderDue,
  type EaBillingEmailTemplateId,
} from "@/lib/billing/eaBillingEmailKeys";
import { EA_PAYMENT_FAILURE_GRACE_DAYS } from "@/lib/billing/mapStripeStatus";
import { getAppBaseUrl } from "@/lib/communications/config";
import {
  sendEaGraceFinalWarning,
  sendEaGraceReminder,
  sendEaPaymentFailed,
  sendEaSubscriptionCancelled,
  sendEaSubscriptionConfirmation,
} from "@/lib/communications/email";
import type { SendEmailResult } from "@/lib/communications/types";

export type BillingEmailTransitionContext = {
  branchId: string;
  subscriptionRowId: string;
  stripeSubscriptionId: string;
  pricingTier: "founding" | "standard";
  amountGbpMinor: number;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  becameEntitled: boolean;
  enteredGrace: boolean;
  cancellationScheduled: boolean;
  invoiceId?: string | null;
};

type ClaimResult =
  | { action: "claimed" | "reclaimed" }
  | { action: "already_claimed" | "invalid_request" | "claim_failed" | "unavailable" };

type SendFn = () => Promise<SendEmailResult>;

function formatEnGbDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function manageBillingUrl(): string {
  return `${getAppBaseUrl()}/account#subscription`;
}

async function resolveBranchBillingOwner(
  admin: SupabaseClient,
  branchId: string
): Promise<{ userId: string; email: string; name: string } | null> {
  const { data: membership } = await admin
    .from("ea_branch_members")
    .select("user_id")
    .eq("branch_id", branchId)
    .eq("role", "branch_admin")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership?.user_id) {
    return null;
  }

  const { data: userData, error } = await admin.auth.admin.getUserById(
    membership.user_id as string
  );
  if (error || !userData.user?.email) {
    return null;
  }

  const meta = userData.user.user_metadata as
    | { full_name?: string; name?: string }
    | undefined;
  const name =
    (typeof meta?.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta?.name === "string" && meta.name.trim()) ||
    "";

  return {
    userId: membership.user_id as string,
    email: userData.user.email,
    name,
  };
}

async function loadBranchName(
  admin: SupabaseClient,
  branchId: string
): Promise<string> {
  const { data } = await admin
    .from("ea_branches")
    .select("name")
    .eq("id", branchId)
    .maybeSingle();
  return (data?.name as string | undefined)?.trim() || "your branch";
}

async function claimDispatch(
  admin: SupabaseClient,
  input: {
    dispatchKey: string;
    template: EaBillingEmailTemplateId;
    branchId: string;
    subscriptionId: string;
    recipientEmail: string;
    metadata?: Record<string, unknown>;
  }
): Promise<ClaimResult> {
  const { data, error } = await admin.rpc(
    "claim_billing_customer_email_dispatch",
    {
      p_dispatch_key: input.dispatchKey,
      p_template: input.template,
      p_branch_id: input.branchId,
      p_subscription_id: input.subscriptionId,
      p_recipient_email: input.recipientEmail,
      p_metadata: input.metadata ?? {},
    }
  );

  if (error) {
    console.error("[billing-customer-email] claim RPC unavailable");
    return { action: "unavailable" };
  }

  const action =
    data && typeof data === "object" && "action" in data
      ? String((data as { action?: string }).action)
      : "claim_failed";

  if (action === "claimed" || action === "reclaimed") {
    return { action };
  }
  if (action === "already_claimed") {
    return { action: "already_claimed" };
  }
  if (action === "invalid_request") {
    return { action: "invalid_request" };
  }
  return { action: "claim_failed" };
}

async function completeDispatch(
  admin: SupabaseClient,
  dispatchKey: string,
  status: "sent" | "failed",
  emailEventId?: string | null,
  errorMessage?: string
): Promise<void> {
  await admin.rpc("complete_billing_customer_email_dispatch", {
    p_dispatch_key: dispatchKey,
    p_status: status,
    p_email_event_id: emailEventId ?? null,
    p_error_message: errorMessage ?? null,
  });
}

async function claimAndSend(
  admin: SupabaseClient,
  input: {
    dispatchKey: string;
    template: EaBillingEmailTemplateId;
    branchId: string;
    subscriptionId: string;
    recipientEmail: string;
    metadata?: Record<string, unknown>;
    send: SendFn;
  }
): Promise<"sent" | "skipped" | "failed"> {
  const claim = await claimDispatch(admin, input);
  if (claim.action === "already_claimed") {
    return "skipped";
  }
  if (
    claim.action === "unavailable" ||
    claim.action === "invalid_request" ||
    claim.action === "claim_failed"
  ) {
    return "failed";
  }

  try {
    const result = await input.send();
    if (result.ok && result.sent) {
      await completeDispatch(
        admin,
        input.dispatchKey,
        "sent",
        result.eventId ?? null
      );
      return "sent";
    }
    if (result.ok && result.skipped) {
      // Email sending disabled — release claim as failed so a later env can retry.
      await completeDispatch(
        admin,
        input.dispatchKey,
        "failed",
        null,
        result.reason
      );
      return "skipped";
    }
    await completeDispatch(
      admin,
      input.dispatchKey,
      "failed",
      result.ok === false ? result.eventId ?? null : null,
      result.ok === false ? result.error : "send_failed"
    );
    return "failed";
  } catch (error) {
    await completeDispatch(
      admin,
      input.dispatchKey,
      "failed",
      null,
      error instanceof Error ? error.message : "send_exception"
    );
    return "failed";
  }
}

/**
 * After a successful subscription reconcile, send at most one email per
 * detected transition. Failures never throw — webhook processing must succeed.
 */
export async function dispatchBillingCustomerEmailsForTransition(
  admin: SupabaseClient,
  transition: BillingEmailTransitionContext
): Promise<void> {
  try {
    const owner = await resolveBranchBillingOwner(admin, transition.branchId);
    if (!owner) {
      console.error("[billing-customer-email] branch owner email unavailable");
      return;
    }

    const branchName = await loadBranchName(admin, transition.branchId);
    const isFounding = transition.pricingTier === "founding";
    const priceLabel = formatGbpMinorAsMonthlyLabel(transition.amountGbpMinor);
    const planLabel = isFounding ? "Founding" : "Standard";
    const common = {
      to: owner.email,
      recipientName: owner.name,
      branchName,
      manageBillingUrl: manageBillingUrl(),
    };

    if (transition.becameEntitled) {
      const dispatchKey = billingConfirmationDispatchKey(
        transition.stripeSubscriptionId
      );
      await claimAndSend(admin, {
        dispatchKey,
        template: "ea-subscription-confirmation",
        branchId: transition.branchId,
        subscriptionId: transition.subscriptionRowId,
        recipientEmail: owner.email,
        metadata: { kind: "confirmation" },
        send: () =>
          sendEaSubscriptionConfirmation({
            ...common,
            planLabel,
            priceLabel,
            nextBillingDateLabel: formatEnGbDate(transition.currentPeriodEnd),
            isFounding,
          }),
      });
    }

    if (transition.enteredGrace && transition.graceEndsAt) {
      const dispatchKey = billingPaymentFailedDispatchKey({
        invoiceId: transition.invoiceId,
        stripeSubscriptionId: transition.stripeSubscriptionId,
        graceEndsAt: transition.graceEndsAt,
      });
      await claimAndSend(admin, {
        dispatchKey,
        template: "ea-payment-failed",
        branchId: transition.branchId,
        subscriptionId: transition.subscriptionRowId,
        recipientEmail: owner.email,
        metadata: { kind: "payment_failed" },
        send: () =>
          sendEaPaymentFailed({
            ...common,
            graceEndsAtLabel: formatEnGbDate(transition.graceEndsAt),
          }),
      });
    }

    if (
      transition.cancellationScheduled &&
      transition.currentPeriodEnd
    ) {
      const dispatchKey = billingCancellationDispatchKey(
        transition.stripeSubscriptionId,
        transition.currentPeriodEnd
      );
      await claimAndSend(admin, {
        dispatchKey,
        template: "ea-subscription-cancelled",
        branchId: transition.branchId,
        subscriptionId: transition.subscriptionRowId,
        recipientEmail: owner.email,
        metadata: { kind: "cancellation" },
        send: () =>
          sendEaSubscriptionCancelled({
            ...common,
            accessEndsAtLabel:
              formatEnGbDate(transition.currentPeriodEnd) ??
              "the end of the current billing period",
            isFounding,
          }),
      });
    }
  } catch (error) {
    console.error(
      "[billing-customer-email] transition dispatch failed:",
      error instanceof Error ? error.message : "unknown_error"
    );
  }
}

/**
 * Mid-grace + final warning reminders. Intended for the daily billing-health cron.
 * Skips automatically when entitlement is no longer grace (recovered/ended).
 */
export async function processEaBillingGraceReminderEmails(
  admin: SupabaseClient,
  now: Date = new Date()
): Promise<{
  scanned: number;
  midSent: number;
  finalSent: number;
  skipped: number;
}> {
  const summary = {
    scanned: 0,
    midSent: 0,
    finalSent: 0,
    skipped: 0,
  };

  const { data: rows, error } = await admin
    .from("ea_branch_subscriptions")
    .select(
      "id, branch_id, stripe_subscription_id, pricing_tier, amount_gbp_minor, grace_ends_at, entitlement_status"
    )
    .eq("entitlement_status", "grace")
    .not("grace_ends_at", "is", null)
    .is("ended_at", null)
    .limit(200);

  if (error || !rows) {
    return summary;
  }

  for (const row of rows) {
    summary.scanned += 1;
    const graceEndsAt = row.grace_ends_at as string;
    const stripeSubscriptionId = row.stripe_subscription_id as string | null;
    const branchId = row.branch_id as string;
    const subscriptionId = row.id as string;

    if (!stripeSubscriptionId || !graceEndsAt) {
      summary.skipped += 1;
      continue;
    }

    const owner = await resolveBranchBillingOwner(admin, branchId);
    if (!owner) {
      summary.skipped += 1;
      continue;
    }

    const branchName = await loadBranchName(admin, branchId);
    const common = {
      to: owner.email,
      recipientName: owner.name,
      branchName,
      manageBillingUrl: manageBillingUrl(),
    };
    const graceLabel = formatEnGbDate(graceEndsAt);

    if (
      isGraceMidReminderDue({
        graceEndsAt,
        now,
        graceDays: EA_PAYMENT_FAILURE_GRACE_DAYS,
      })
    ) {
      const result = await claimAndSend(admin, {
        dispatchKey: billingGraceMidDispatchKey(
          stripeSubscriptionId,
          graceEndsAt
        ),
        template: "ea-grace-reminder",
        branchId,
        subscriptionId,
        recipientEmail: owner.email,
        metadata: { kind: "grace_mid" },
        send: () =>
          sendEaGraceReminder({
            ...common,
            graceEndsAtLabel: graceLabel,
          }),
      });
      if (result === "sent") summary.midSent += 1;
      else summary.skipped += 1;
    }

    if (isGraceFinalWarningDue({ graceEndsAt, now })) {
      const result = await claimAndSend(admin, {
        dispatchKey: billingGraceFinalDispatchKey(
          stripeSubscriptionId,
          graceEndsAt
        ),
        template: "ea-grace-final-warning",
        branchId,
        subscriptionId,
        recipientEmail: owner.email,
        metadata: { kind: "grace_final" },
        send: () =>
          sendEaGraceFinalWarning({
            ...common,
            graceEndsAtLabel: graceLabel,
          }),
      });
      if (result === "sent") summary.finalSent += 1;
      else summary.skipped += 1;
    }
  }

  return summary;
}
