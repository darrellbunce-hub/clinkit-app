"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";

import {
  isCheckoutReturnConfirmed,
  readCheckoutReturn,
  urlWithoutCheckoutReturnParams,
} from "@/components/account/SubscriptionSection";
import EaMarketingShell from "@/components/estate-agents/EaMarketingShell";
import { AUTH_TITLE_CLASS } from "@/components/mobileStandards";
import { ROUTES } from "@/lib/auth/routes";
import {
  EA_STANDARD_MONTHLY_LABEL,
  EA_TRIAL_HEADLINE,
  EA_TRIAL_OFFER_SUMMARY,
  EA_TRIAL_PERIOD_DAYS,
  EA_TRIAL_TERMS_COPY,
} from "@/lib/billing/eaBranchPricing";
import {
  EA_ACCOUNT_SUBSCRIPTION_HREF,
  EA_CHECKOUT_CONFIRMATION_TIMEOUT_NOTICE,
  EA_CHECKOUT_CONFIRMING_DETAIL,
  EA_CHECKOUT_CONFIRMING_TITLE,
  EA_SOFT_SKIP_BUTTON_LABEL,
  EA_SOFT_SKIP_CONSEQUENCES_COPY,
  EA_SOFT_SKIP_START_LATER_COPY,
} from "@/lib/billing/eaSoftSkipExpectations";
import type { EaBranchSubscriptionSummary } from "@/lib/billing/eaBranchSubscription";
import { fetchAuthenticatedProfileAccountFields } from "@/lib/currentUserContext";
import { loadAgentHomeContext } from "@/lib/estateAgent/loadAgentHomeContext";
import { supabase } from "@/lib/supabase";

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 30000;

type BillingView =
  | "loading"
  | "offer"
  | "confirming"
  | "confirmed"
  | "error";

/**
 * Customer-facing confirmed copy from the authoritative summary.
 * Does not change Checkout confirmation gating — only the wording shown after
 * `isCheckoutReturnConfirmed` (or an already-subscribed API result) succeeds.
 */
function onboardingConfirmedCopy(
  summary: EaBranchSubscriptionSummary | null,
  branchName: string | null
): { title: string; detail: string } {
  const branchPrefix = branchName
    ? `Billing is set up for ${branchName}. `
    : "";
  const stripeStatus = summary?.stripe_status ?? null;
  const isEntitled =
    summary?.entitlement_status === "entitled" ||
    summary?.entitlement_status === "grace";

  if (stripeStatus === "trialing" && isEntitled && !summary?.ended_at) {
    return {
      title: "Your free trial is active",
      detail: `${branchPrefix}You can manage or cancel your subscription any time from Account → Subscription. If you cancel during the trial, you will not be charged.`,
    };
  }

  if (stripeStatus === "active" && !summary?.ended_at) {
    return {
      title: "Your subscription is active",
      detail: `${branchPrefix}You can manage or cancel your subscription any time from Account → Subscription.`,
    };
  }

  return {
    title: "Subscription confirmed",
    detail: `${branchPrefix}We're finishing billing setup. Check the latest status any time from Account → Subscription.`,
  };
}

function BillingLoadingCard({ message }: { message: string }) {
  return (
    <EaMarketingShell>
      <section className="max-w-xl mx-auto px-6 py-16">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center text-slate-600">
          {message}
        </div>
      </section>
    </EaMarketingShell>
  );
}

function OnboardingBillingContent() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<BillingView>("loading");
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [confirmedSummary, setConfirmedSummary] =
    useState<EaBranchSubscriptionSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [isActing, setIsActing] = useState(false);
  const [confirmationTimedOut, setConfirmationTimedOut] = useState(false);
  const [trialPeriodDays, setTrialPeriodDays] = useState<number | null>(
    EA_TRIAL_PERIOD_DAYS
  );
  const checkoutReturnRef = useRef<{ branchId: string | null } | null>(null);
  const pollRef = useRef<{ interval: number; timeout: number } | null>(null);
  const pollingUserIdRef = useRef<string | null>(null);

  const clearPoll = useCallback(() => {
    if (!pollRef.current) return;
    window.clearInterval(pollRef.current.interval);
    window.clearTimeout(pollRef.current.timeout);
    pollRef.current = null;
  }, []);

  const loadSummary = useCallback(
    async (
      userId: string,
      preferredBranchId: string | null
    ): Promise<{
      branchId: string;
      branchName: string;
      summary: EaBranchSubscriptionSummary | null;
    } | null> => {
      const context = await loadAgentHomeContext(supabase, userId);
      if (!context) return null;

      const resolvedBranchId = preferredBranchId ?? context.branch.id;
      if (preferredBranchId && preferredBranchId !== context.branch.id) {
        const { data: membership } = await supabase
          .from("ea_branch_members")
          .select("role")
          .eq("user_id", userId)
          .eq("branch_id", preferredBranchId)
          .maybeSingle();
        if (membership?.role !== "branch_admin") {
          return null;
        }
      } else {
        const { data: membership } = await supabase
          .from("ea_branch_members")
          .select("role")
          .eq("user_id", userId)
          .eq("branch_id", resolvedBranchId)
          .maybeSingle();
        if (membership?.role !== "branch_admin") {
          return null;
        }
      }

      const { data } = await supabase.rpc("get_ea_branch_subscription_summary", {
        p_branch_id: resolvedBranchId,
      });
      const summary = (data as EaBranchSubscriptionSummary) ?? null;

      let branchName = context.branch.name;
      if (resolvedBranchId !== context.branch.id) {
        const { data: branchRow } = await supabase
          .from("ea_branches")
          .select("name")
          .eq("id", resolvedBranchId)
          .maybeSingle();
        if (branchRow?.name) {
          branchName = branchRow.name as string;
        }
      }

      return {
        branchId: resolvedBranchId,
        branchName,
        summary,
      };
    },
    []
  );

  const startPolling = useCallback(
    (userId: string, expectedBranchId: string) => {
      clearPoll();
      pollingUserIdRef.current = userId;
      setConfirmationTimedOut(false);
      setView("confirming");
      setNotice(EA_CHECKOUT_CONFIRMING_DETAIL);

      const tick = async () => {
        const loaded = await loadSummary(userId, expectedBranchId);
        if (!loaded) return;
        setBranchId(loaded.branchId);
        setBranchName(loaded.branchName);
        if (isCheckoutReturnConfirmed(loaded.summary, expectedBranchId)) {
          clearPoll();
          checkoutReturnRef.current = null;
          setConfirmationTimedOut(false);
          setConfirmedSummary(loaded.summary);
          setView("confirmed");
          setNotice("");
          const cleaned = urlWithoutCheckoutReturnParams(window.location.href);
          if (cleaned) {
            window.history.replaceState(window.history.state, "", cleaned);
          }
        }
      };

      void tick();
      const interval = window.setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
      const timeout = window.setTimeout(() => {
        window.clearInterval(interval);
        pollRef.current = null;
        setConfirmationTimedOut(true);
        setView("offer");
        setNotice(EA_CHECKOUT_CONFIRMATION_TIMEOUT_NOTICE);
      }, POLL_TIMEOUT_MS);
      pollRef.current = { interval, timeout };
    },
    [clearPoll, loadSummary]
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = `${ROUTES.estateAgentLogin}?next=${encodeURIComponent(ROUTES.estateAgentOnboardingBilling)}`;
        return;
      }

      const profile = await fetchAuthenticatedProfileAccountFields(
        supabase,
        user.id
      );
      if (!profile || profile.account_type !== "estate_agent") {
        window.location.href = ROUTES.estateAgentLogin;
        return;
      }
      if (!profile.onboarding_completed_at) {
        window.location.href = ROUTES.estateAgentOnboarding;
        return;
      }

      const { billing, branchId: returnBranchId } = readCheckoutReturn(
        window.location.search
      );
      const queryBranch =
        returnBranchId ?? searchParams.get("branch")?.trim() ?? null;

      const loaded = await loadSummary(user.id, queryBranch);
      if (cancelled) return;

      if (!loaded) {
        // Invitees and non-owners are not part of founder Checkout.
        window.location.href = ROUTES.agentHome;
        return;
      }

      setBranchId(loaded.branchId);
      setBranchName(loaded.branchName);

      if (isCheckoutReturnConfirmed(loaded.summary, loaded.branchId)) {
        setConfirmedSummary(loaded.summary);
        setView("confirmed");
        if (billing === "success") {
          const cleaned = urlWithoutCheckoutReturnParams(window.location.href);
          if (cleaned) {
            window.history.replaceState(window.history.state, "", cleaned);
          }
        }
        return;
      }

      if (billing === "success") {
        checkoutReturnRef.current = { branchId: loaded.branchId };
        startPolling(user.id, loaded.branchId);
        return;
      }

      if (billing === "cancelled") {
        setNotice(
          "Checkout was cancelled. No subscription was created and you have not been charged. You can start your free trial when ready."
        );
        const cleaned = urlWithoutCheckoutReturnParams(window.location.href);
        if (cleaned) {
          window.history.replaceState(window.history.state, "", cleaned);
        }
      }

      setView("offer");
    }

    void bootstrap();
    return () => {
      cancelled = true;
      clearPoll();
    };
  }, [clearPoll, loadSummary, searchParams, startPolling]);

  async function startCheckout() {
    if (!branchId || isActing) return;
    setIsActing(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/billing/ea/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          returnFlow: "onboarding",
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
        message?: string;
        trialPeriodDays?: number | null;
      };

      if (typeof payload.trialPeriodDays === "number") {
        setTrialPeriodDays(payload.trialPeriodDays);
      } else if (payload.trialPeriodDays === null) {
        setTrialPeriodDays(null);
      }

      if (payload.error === "checkout_processing") {
        setNotice(
          payload.message ?? EA_CHECKOUT_CONFIRMING_DETAIL
        );
        setIsActing(false);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user && branchId) {
          startPolling(user.id, branchId);
        } else {
          setView("offer");
        }
        return;
      }

      if (payload.error === "already_subscribed") {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user && branchId) {
          const loaded = await loadSummary(user.id, branchId);
          if (loaded) {
            setBranchName(loaded.branchName);
            setConfirmedSummary(loaded.summary);
          }
        }
        setView("confirmed");
        setIsActing(false);
        return;
      }

      if (!response.ok || !payload.ok || !payload.url) {
        setErrorMessage(
          payload.message ??
            (payload.error === "subscription_check_unavailable" ||
            payload.error === "checkout_session_expiry_failed"
              ? "Billing is temporarily unavailable. Please try again in a moment."
              : "Could not start Checkout. Please try again.")
        );
        setView("offer");
        setIsActing(false);
        return;
      }

      window.location.href = payload.url;
    } catch {
      setErrorMessage("Could not start Checkout. Please try again.");
      setView("offer");
      setIsActing(false);
    }
  }

  if (view === "loading") {
    return <BillingLoadingCard message="Preparing your free trial…" />;
  }

  if (view === "confirmed") {
    const confirmed = onboardingConfirmedCopy(confirmedSummary, branchName);
    return (
      <EaMarketingShell>
        <section className="max-w-xl mx-auto px-6 py-16">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
            <h1 className={AUTH_TITLE_CLASS}>{confirmed.title}</h1>
            <p className="mt-3 text-slate-600">{confirmed.detail}</p>
            <button
              type="button"
              onClick={() => {
                window.location.href = ROUTES.agentHome;
              }}
              className="mt-8 w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold hover:bg-slate-800"
            >
              Continue to agent dashboard
            </button>
          </div>
        </section>
      </EaMarketingShell>
    );
  }

  const offerHeadline =
    trialPeriodDays != null
      ? `${trialPeriodDays}-day free trial`
      : "Start your branch subscription";
  const offerSummary =
    trialPeriodDays != null
      ? EA_TRIAL_OFFER_SUMMARY
      : `Your branch subscription is ${EA_STANDARD_MONTHLY_LABEL}.`;

  return (
    <EaMarketingShell>
      <section className="max-w-xl mx-auto px-6 py-16">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Final onboarding step
          </p>
          <h1 className={`mt-3 ${AUTH_TITLE_CLASS}`}>{offerHeadline}</h1>
          <p className="mt-3 text-slate-600">{offerSummary}</p>

          {branchName ? (
            <p className="mt-2 text-sm text-slate-500">
              Branch: <span className="font-medium text-slate-800">{branchName}</span>
            </p>
          ) : null}

          <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5 text-sm text-slate-700">
            <p>
              <span className="font-semibold text-slate-900">{EA_TRIAL_HEADLINE}</span>
              {" — "}
              then {EA_STANDARD_MONTHLY_LABEL} per branch.
            </p>
            <p>{EA_TRIAL_TERMS_COPY}</p>
            <p>
              You can cancel before the trial ends from Account → Subscription
              (Stripe Customer Portal). Cancellation during the trial means you
              are not charged for the paid subscription.
            </p>
          </div>

          {notice ? (
            <p
              role="status"
              className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              {notice}
            </p>
          ) : null}

          {errorMessage ? (
            <p
              role="alert"
              className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
            >
              {errorMessage}
            </p>
          ) : null}

          {view === "confirming" ? (
            <div className="mt-8 space-y-3 text-center">
              <p className="font-semibold text-slate-900">
                {EA_CHECKOUT_CONFIRMING_TITLE}
              </p>
              <p className="text-sm text-slate-600">
                {EA_CHECKOUT_CONFIRMING_DETAIL}
              </p>
            </div>
          ) : (
            <>
              {confirmationTimedOut && branchId ? (
                <button
                  type="button"
                  onClick={() => {
                    const userId = pollingUserIdRef.current;
                    if (!userId || !branchId) return;
                    startPolling(userId, branchId);
                  }}
                  className="mt-8 w-full border border-slate-300 text-slate-900 rounded-2xl py-4 font-semibold hover:bg-slate-50"
                >
                  Check confirmation again
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  void startCheckout();
                }}
                disabled={isActing || !branchId}
                className={`${confirmationTimedOut ? "mt-3" : "mt-8"} w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold hover:bg-slate-800 disabled:bg-slate-400`}
              >
                {isActing ? "Starting Checkout…" : "Start my free trial"}
              </button>

              <button
                type="button"
                onClick={() => {
                  window.location.href = ROUTES.agentHome;
                }}
                className="mt-3 w-full border border-slate-300 text-slate-900 rounded-2xl py-4 font-semibold hover:bg-slate-50"
              >
                {EA_SOFT_SKIP_BUTTON_LABEL}
              </button>

              <p className="mt-3 text-center text-xs text-slate-600">
                {EA_SOFT_SKIP_CONSEQUENCES_COPY}{" "}
                {EA_SOFT_SKIP_START_LATER_COPY}
              </p>

              <p className="mt-2 text-center text-sm">
                <a
                  href={EA_ACCOUNT_SUBSCRIPTION_HREF}
                  className="font-semibold text-slate-900 underline underline-offset-2 hover:text-slate-700"
                >
                  Open Account → Subscription
                </a>
              </p>
            </>
          )}
        </div>
      </section>
    </EaMarketingShell>
  );
}

export default function EstateAgentOnboardingBillingPage() {
  return (
    <Suspense fallback={<BillingLoadingCard message="Loading…" />}>
      <OnboardingBillingContent />
    </Suspense>
  );
}
