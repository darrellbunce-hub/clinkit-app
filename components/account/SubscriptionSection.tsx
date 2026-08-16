"use client";

import { useCallback, useEffect, useState } from "react";

import {
  accountAlertErrorClassName,
  accountSectionClassName,
} from "@/components/account/accountStyles";
import {
  EA_FOUNDING_MONTHLY_LABEL,
  EA_STANDARD_MONTHLY_LABEL,
  formatGbpMinorAsMonthlyLabel,
} from "@/lib/billing/eaBranchPricing";
import type { EaBranchSubscriptionSummary } from "@/lib/billing/eaBranchSubscription";
import { loadAgentHomeContext } from "@/lib/estateAgent/loadAgentHomeContext";
import {
  BTN_PRIMARY_SM_CLASS,
  BTN_SECONDARY_OUTLINE_SM_CLASS,
} from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

type SubscriptionSectionProps = {
  userId: string;
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function describeSummary(summary: EaBranchSubscriptionSummary | null): {
  title: string;
  detail: string;
  tone: "neutral" | "success" | "warning" | "danger";
} {
  if (!summary?.ok || !summary.has_subscription) {
    return {
      title: "No subscription",
      detail:
        "Subscribe to Keynetic for this branch when you are ready. Billing is in Sandbox test mode during Stage 2.",
      tone: "neutral",
    };
  }

  const priceLabel =
    typeof summary.amount_gbp_minor === "number"
      ? formatGbpMinorAsMonthlyLabel(summary.amount_gbp_minor)
      : summary.pricing_tier === "founding"
        ? EA_FOUNDING_MONTHLY_LABEL
        : EA_STANDARD_MONTHLY_LABEL;

  const tierLabel =
    summary.pricing_tier === "founding" ? "Founding" : "Standard";

  if (summary.stripe_status === "checkout_pending") {
    return {
      title: "Payment confirmation pending",
      detail:
        "If you completed Checkout, we are confirming your subscription from Stripe. This page will update shortly.",
      tone: "warning",
    };
  }

  if (summary.entitlement_status === "grace") {
    const grace = formatDate(summary.grace_ends_at ?? null);
    return {
      title: "Payment issue",
      detail: grace
        ? `There is a problem with the latest payment. Please update your payment method. Grace continues until ${grace}.`
        : "There is a problem with the latest payment. Please update your payment method.",
      tone: "danger",
    };
  }

  if (
    summary.entitlement_status === "ended" ||
    summary.stripe_status === "canceled" ||
    summary.ended_at
  ) {
    if (summary.cancel_at_period_end && summary.current_period_end) {
      const end = formatDate(summary.current_period_end);
      if (end && new Date(summary.current_period_end).getTime() > Date.now()) {
        return {
          title: `${tierLabel} — ${priceLabel}`,
          detail: `Cancels on ${end}. You retain access through the end of the billing period.`,
          tone: "warning",
        };
      }
    }
    return {
      title: "Subscription ended",
      detail: "This branch no longer has an active Keynetic subscription.",
      tone: "neutral",
    };
  }

  if (summary.cancel_at_period_end && summary.current_period_end) {
    const end = formatDate(summary.current_period_end);
    return {
      title: `Active — ${tierLabel} ${priceLabel}`,
      detail: end
        ? `Cancels on ${end}.`
        : "Cancellation is scheduled at the end of the current period.",
      tone: "warning",
    };
  }

  if (
    summary.entitlement_status === "entitled" ||
    summary.stripe_status === "active"
  ) {
    const renews = formatDate(summary.current_period_end ?? null);
    return {
      title: `Active — ${tierLabel} ${priceLabel}`,
      detail: renews
        ? `Next billing date: ${renews}.`
        : "Your branch subscription is active.",
      tone: "success",
    };
  }

  return {
    title: "Subscription status updating",
    detail: "We are reconciling the latest billing information.",
    tone: "neutral",
  };
}

export default function SubscriptionSection({
  userId,
}: SubscriptionSectionProps) {
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [summary, setSummary] = useState<EaBranchSubscriptionSummary | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    setErrorMessage("");
    const context = await loadAgentHomeContext(supabase, userId);
    if (!context) {
      setErrorMessage("Unable to load your branch for billing.");
      setIsLoading(false);
      return;
    }

    setBranchId(context.branch.id);
    setBranchName(context.branch.name);

    const { data: membership } = await supabase
      .from("ea_branch_members")
      .select("role")
      .eq("user_id", userId)
      .eq("branch_id", context.branch.id)
      .maybeSingle();
    setIsOwner(membership?.role === "branch_admin");

    const { data } = await supabase.rpc("get_ea_branch_subscription_summary", {
      p_branch_id: context.branch.id,
    });
    setSummary((data as EaBranchSubscriptionSummary) ?? null);
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (billing === "success") {
      setNotice(
        "Payment received — we're confirming your subscription. This usually takes a few seconds."
      );
    } else if (billing === "cancelled") {
      setNotice(
        "Checkout was cancelled. No subscription was created. You can try again when ready."
      );
    }
    void reload();

    if (billing === "success") {
      const timer = window.setInterval(() => {
        void reload();
      }, 4000);
      const stop = window.setTimeout(() => window.clearInterval(timer), 30000);
      return () => {
        window.clearInterval(timer);
        window.clearTimeout(stop);
      };
    }
  }, [reload]);

  async function startCheckout(acceptStandardPricing = false) {
    if (!branchId || !isOwner) return;
    setIsActing(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/billing/ea/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          ...(acceptStandardPricing ? { acceptStandardPricing: true } : {}),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
        message?: string;
        pricingTier?: string;
        reservationExpiresAt?: string | null;
      };
      if (
        response.status === 409 &&
        (payload.error === "founding_just_secured" ||
          payload.error === "founding_unavailable")
      ) {
        const proceed = window.confirm(
          payload.message ??
            "Founding places have been secured. Continue at £129/month?"
        );
        if (!proceed) {
          setNotice(
            payload.message ??
              "Founding pricing is no longer available. You can subscribe at £129/month when ready."
          );
          setIsActing(false);
          return;
        }
        await startCheckout(true);
        return;
      }
      if (!response.ok || !payload.ok || !payload.url) {
        setErrorMessage(
          payload.error === "already_subscribed"
            ? "This branch already has an active subscription."
            : "Unable to start Checkout right now. Please try again."
        );
        setIsActing(false);
        return;
      }
      if (
        payload.pricingTier === "founding" &&
        payload.reservationExpiresAt
      ) {
        const until = new Date(payload.reservationExpiresAt);
        if (!Number.isNaN(until.getTime())) {
          setNotice(
            `Your £99 founding place is reserved until ${until.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Complete Checkout before then.`
          );
        }
      }
      window.location.href = payload.url;
    } catch {
      setErrorMessage("Unable to start Checkout right now. Please try again.");
      setIsActing(false);
    }
  }

  async function openPortal() {
    if (!branchId || !isOwner) return;
    setIsActing(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/billing/ea/portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.url) {
        setErrorMessage(
          payload.error === "no_stripe_customer"
            ? "No billing customer is linked yet. Start a subscription first."
            : "Unable to open billing portal right now."
        );
        setIsActing(false);
        return;
      }
      window.location.href = payload.url;
    } catch {
      setErrorMessage("Unable to open billing portal right now.");
      setIsActing(false);
    }
  }

  const view = describeSummary(summary);
  const canSubscribe =
    isOwner &&
    (!summary?.has_subscription ||
      summary.entitlement_status === "ended" ||
      summary.stripe_status === "checkout_pending" ||
      summary.stripe_status === "incomplete" ||
      summary.stripe_status === "incomplete_expired");
  const canManage =
    isOwner &&
    !!summary?.has_subscription &&
    summary.entitlement_status !== "ended" &&
    summary.stripe_status !== "checkout_pending";

  return (
    <section id="subscription" className={accountSectionClassName}>
      <h2 className="text-lg font-semibold text-slate-900">Subscription</h2>
      <p className="mt-1 text-sm text-slate-600">
        Keynetic Estate Agent branch billing
        {branchName ? ` · ${branchName}` : ""}.
      </p>

      {notice ? (
        <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {notice}
        </p>
      ) : null}

      {errorMessage ? (
        <p className={`mt-4 ${accountAlertErrorClassName}`}>{errorMessage}</p>
      ) : null}

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-600">Loading subscription…</p>
      ) : (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <p
            className={
              view.tone === "success"
                ? "text-base font-semibold text-emerald-800"
                : view.tone === "danger"
                  ? "text-base font-semibold text-red-800"
                  : view.tone === "warning"
                    ? "text-base font-semibold text-amber-800"
                    : "text-base font-semibold text-slate-900"
            }
          >
            {view.title}
          </p>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            {view.detail}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Founding {EA_FOUNDING_MONTHLY_LABEL} while places remain · Standard{" "}
            {EA_STANDARD_MONTHLY_LABEL} thereafter. The server selects the price
            at Checkout; founding places are secured only when reservation
            succeeds.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            {canSubscribe ? (
              <button
                type="button"
                className={BTN_PRIMARY_SM_CLASS}
                disabled={isActing}
                onClick={() => void startCheckout()}
              >
                {summary?.entitlement_status === "ended"
                  ? "Resubscribe"
                  : summary?.stripe_status === "checkout_pending"
                    ? "Continue checkout"
                    : "Subscribe"}
              </button>
            ) : null}
            {canManage ? (
              <button
                type="button"
                className={BTN_SECONDARY_OUTLINE_SM_CLASS}
                disabled={isActing}
                onClick={() => void openPortal()}
              >
                {summary?.entitlement_status === "grace"
                  ? "Resolve payment issue"
                  : "Manage subscription"}
              </button>
            ) : null}
            {!isOwner ? (
              <p className="text-sm text-slate-500">
                Only the branch Owner can manage billing.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
