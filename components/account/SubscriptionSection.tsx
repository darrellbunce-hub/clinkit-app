"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  accountAlertErrorClassName,
  accountSectionClassName,
} from "@/components/account/accountStyles";
import {
  EA_FOUNDING_MONTHLY_LABEL,
  EA_STANDARD_MONTHLY_LABEL,
  EA_TRIAL_HEADLINE,
  EA_TRIAL_PERIOD_DAYS,
  EA_TRIAL_REPEAT_COPY,
  EA_TRIAL_TERMS_COPY,
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

/** Query parameters Stripe Checkout appends to the account return URL. */
const CHECKOUT_RETURN_PARAMS = ["billing", "branch"] as const;

export function readCheckoutReturn(search: string): {
  billing: string | null;
  branchId: string | null;
} {
  const params = new URLSearchParams(search);
  return { billing: params.get("billing"), branchId: params.get("branch") };
}

/**
 * A returning Checkout is confirmed only once a successfully loaded summary
 * shows the branch's open subscription row past checkout_pending. Failed or
 * missing summaries, a missing return branch ID, other branches and ended rows
 * never count.
 */
export function isCheckoutReturnConfirmed(
  summary: EaBranchSubscriptionSummary | null,
  expectedBranchId: string | null
): boolean {
  if (!summary || summary.ok !== true || summary.has_subscription !== true) {
    return false;
  }
  if (!expectedBranchId || summary.branch_id !== expectedBranchId) return false;
  const status = summary.stripe_status;
  if (!status || status === "checkout_pending") return false;
  if (summary.ended_at || summary.entitlement_status === "ended") return false;
  return true;
}

/**
 * Relative URL with the Checkout return parameters removed (path, other query
 * parameters and hash kept), or null when there is nothing to remove.
 */
export function urlWithoutCheckoutReturnParams(href: string): string | null {
  const url = new URL(href);
  if (!CHECKOUT_RETURN_PARAMS.some((name) => url.searchParams.has(name))) {
    return null;
  }
  for (const name of CHECKOUT_RETURN_PARAMS) url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Follow-up summary loads after returning from the Stripe billing portal
 * (`?billing=portal`), measured from the return. The webhook usually lands
 * before the first load; these cover a slow one and stop once the status
 * changes.
 */
export const PORTAL_RETURN_REFRESH_DELAYS_MS = [3000, 8000, 15000] as const;

/** Minimum gap between refreshes triggered by the tab becoming visible again. */
export const VISIBILITY_REFRESH_MIN_INTERVAL_MS = 30000;

/** The summary fields the displayed status depends on. */
export function subscriptionStatusFingerprint(
  summary: EaBranchSubscriptionSummary | null
): string {
  if (!summary?.ok || !summary.has_subscription) return "none";
  return JSON.stringify([
    summary.stripe_status ?? null,
    summary.entitlement_status ?? null,
    summary.cancel_at_period_end ?? null,
    summary.current_period_end ?? null,
    summary.grace_ends_at ?? null,
    summary.ended_at ?? null,
    summary.pricing_tier ?? null,
  ]);
}

export function isRefreshDue(
  lastLoadedAt: number | null,
  now: number,
  minIntervalMs: number
): boolean {
  return lastLoadedAt === null || now - lastLoadedAt >= minIntervalMs;
}

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

export function describeSummary(summary: EaBranchSubscriptionSummary | null): {
  title: string;
  detail: string;
  tone: "neutral" | "success" | "warning" | "danger";
} {
  if (!summary?.ok || !summary.has_subscription) {
    return {
      title: "No subscription",
      detail: `Start your ${EA_TRIAL_PERIOD_DAYS}-day free trial for this Branch when you are ready. Recurring monthly billing is handled through Stripe. This environment may use Stripe test (Sandbox) mode before Production charging is enabled.`,
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
      title: "Subscription confirmation pending",
      detail:
        "If you completed Checkout, we are confirming your subscription from Stripe. This page will update shortly.",
      tone: "warning",
    };
  }

  if (summary.entitlement_status === "grace") {
    const grace = formatDate(summary.grace_ends_at ?? null);
    return {
      title: "Payment issue — grace period",
      detail: grace
        ? `The latest recurring payment failed. Please update your payment method. Your Branch remains in a payment-recovery grace period until ${grace}. If payment is not recovered by then, commercial subscription access for this Branch ends. Billing is monthly.`
        : "The latest recurring payment failed. Please update your payment method during the payment-recovery grace period. Billing is monthly.",
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
      detail: "This branch no longer has an active MoveLoop subscription.",
      tone: "neutral",
    };
  }

  if (summary.stripe_status === "trialing") {
    const trialEnds = formatDate(summary.current_period_end ?? null);
    if (summary.cancel_at_period_end) {
      return {
        title: "Free trial — cancellation scheduled",
        detail: trialEnds
          ? `Your free trial continues until ${trialEnds}, then the subscription ends. You will not be charged.`
          : "Your free trial continues until the end of the trial, then the subscription ends. You will not be charged.",
        tone: "warning",
      };
    }
    return {
      title: `Free trial — ${EA_TRIAL_HEADLINE}`,
      detail: trialEnds
        ? `Your free trial ends on ${trialEnds}. Your subscription then continues at ${priceLabel} unless you cancel before the trial ends.`
        : `Your subscription continues at ${priceLabel} after the free trial unless you cancel before the trial ends.`,
      tone: "success",
    };
  }

  if (summary.cancel_at_period_end && summary.current_period_end) {
    const end = formatDate(summary.current_period_end);
    const foundingNote =
      summary.pricing_tier === "founding"
        ? " Founding status ends permanently when this cancellation takes effect."
        : "";
    return {
      title: `Active — ${tierLabel} ${priceLabel}`,
      detail: end
        ? `Monthly billing. Cancels on ${end}.${foundingNote}`
        : `Cancellation is scheduled at the end of the current period.${foundingNote}`,
      tone: "warning",
    };
  }

  if (
    summary.entitlement_status === "entitled" ||
    summary.stripe_status === "active"
  ) {
    const renews = formatDate(summary.current_period_end ?? null);
    const foundingNote =
      summary.pricing_tier === "founding"
        ? " Founding price remains while this subscription stays continuously active."
        : "";
    return {
      title: `Active — ${tierLabel} ${priceLabel}`,
      detail: renews
        ? `Monthly billing. Next payment date: ${renews}.${foundingNote}`
        : `Your branch subscription is active (monthly billing).${foundingNote}`,
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
  const [isConfirmingCheckout, setIsConfirmingCheckout] = useState(false);
  /** Set while returning from a successful Checkout that is not yet confirmed. */
  const checkoutReturnRef = useRef<{ branchId: string | null } | null>(null);
  const checkoutPollRef = useRef<{ interval: number; timeout: number } | null>(
    null
  );
  const lastLoadedAtRef = useRef<number | null>(null);

  const reload = useCallback(async (): Promise<EaBranchSubscriptionSummary | null> => {
    setErrorMessage("");
    lastLoadedAtRef.current = Date.now();
    const context = await loadAgentHomeContext(supabase, userId);
    if (!context) {
      setErrorMessage("Unable to load your branch for billing.");
      setIsLoading(false);
      return null;
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
    const loaded = (data as EaBranchSubscriptionSummary) ?? null;
    setSummary(loaded);
    setIsLoading(false);

    const checkoutReturn = checkoutReturnRef.current;
    if (
      checkoutReturn &&
      isCheckoutReturnConfirmed(loaded, checkoutReturn.branchId)
    ) {
      checkoutReturnRef.current = null;
      if (checkoutPollRef.current) {
        window.clearInterval(checkoutPollRef.current.interval);
        window.clearTimeout(checkoutPollRef.current.timeout);
        checkoutPollRef.current = null;
      }
      setIsConfirmingCheckout(false);
      setNotice("");
      const cleaned = urlWithoutCheckoutReturnParams(window.location.href);
      if (cleaned) {
        window.history.replaceState(window.history.state, "", cleaned);
      }
    }
    return loaded;
  }, [userId]);

  useEffect(() => {
    const { billing, branchId: returnBranchId } = readCheckoutReturn(
      window.location.search
    );
    if (billing === "success") {
      checkoutReturnRef.current = { branchId: returnBranchId };
      setIsConfirmingCheckout(true);
      setNotice(
        "Checkout complete — we're confirming your subscription. This usually takes a few seconds."
      );
    } else if (billing === "cancelled") {
      setNotice(
        "Checkout was cancelled. No subscription was created. You can try again when ready."
      );
    }
    if (billing === "portal") {
      const cleaned = urlWithoutCheckoutReturnParams(window.location.href);
      if (cleaned) {
        window.history.replaceState(window.history.state, "", cleaned);
      }
      let cancelled = false;
      const timers: number[] = [];
      const stopFollowUps = () => {
        cancelled = true;
        for (const timer of timers) window.clearTimeout(timer);
      };
      void reload().then((initial) => {
        if (cancelled) return;
        const initialFingerprint = subscriptionStatusFingerprint(initial);
        const startedAt = Date.now();
        for (const delay of PORTAL_RETURN_REFRESH_DELAYS_MS) {
          timers.push(
            window.setTimeout(() => {
              if (cancelled) return;
              void reload().then((latest) => {
                if (
                  latest?.ok &&
                  subscriptionStatusFingerprint(latest) !== initialFingerprint
                ) {
                  stopFollowUps();
                }
              });
            }, Math.max(0, delay - (Date.now() - startedAt)))
          );
        }
      });
      return stopFollowUps;
    }

    void reload();

    if (billing === "success") {
      const timer = window.setInterval(() => {
        void reload();
      }, 4000);
      const stop = window.setTimeout(() => {
        window.clearInterval(timer);
        checkoutPollRef.current = null;
        setIsConfirmingCheckout(false);
      }, 30000);
      checkoutPollRef.current = { interval: timer, timeout: stop };
      return () => {
        window.clearInterval(timer);
        window.clearTimeout(stop);
        checkoutPollRef.current = null;
      };
    }
  }, [reload]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        isRefreshDue(
          lastLoadedAtRef.current,
          Date.now(),
          VISIBILITY_REFRESH_MIN_INTERVAL_MS
        )
      ) {
        void reload();
      }
    };
    // Back from the Stripe portal can restore this page from the back/forward
    // cache with the pre-redirect state (buttons disabled, old status).
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setIsActing(false);
      void reload();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [reload]);

  async function startCheckout() {
    if (!branchId || !isOwner) return;
    setIsActing(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/billing/ea/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
        message?: string;
      };
      if (payload.error === "checkout_processing") {
        setNotice(
          payload.message ??
            "Your Checkout is complete and we're confirming your subscription with Stripe. This usually takes a few seconds — please refresh shortly."
        );
        setIsActing(false);
        void reload();
        return;
      }
      if (!response.ok || !payload.ok || !payload.url) {
        setErrorMessage(
          payload.error === "already_subscribed"
            ? "This branch already has an active subscription."
            : (payload.error === "subscription_check_unavailable" ||
                  payload.error === "stripe_subscription_exists" ||
                  payload.error === "checkout_session_expiry_failed") &&
                payload.message
              ? payload.message
              : "Unable to start Checkout right now. Please try again."
        );
        setIsActing(false);
        return;
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
  const confirmingCompletedCheckout =
    isConfirmingCheckout && summary?.stripe_status === "checkout_pending";
  const canSubscribe =
    isOwner &&
    !confirmingCompletedCheckout &&
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
        MoveLoop Estate Agent branch billing
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
            {summary?.has_subscription && summary.entitlement_status === "ended"
              ? EA_TRIAL_REPEAT_COPY
              : EA_TRIAL_TERMS_COPY}{" "}
            Cancellation takes effect at the end of the trial or current billing
            period via Manage subscription.
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
                    : summary?.has_subscription
                      ? "Subscribe"
                      : "Start free trial"}
              </button>
            ) : null}
            {confirmingCompletedCheckout ? (
              <p className="text-sm text-slate-600" role="status">
                Confirming your subscription with Stripe…
              </p>
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
