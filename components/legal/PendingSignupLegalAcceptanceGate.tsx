"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import SignupLegalAcceptanceRecoveryPanel from "@/components/legal/SignupLegalAcceptanceRecoveryPanel";
import ParticipantDataLoadingState from "@/components/loading/ParticipantDataLoadingState";
import Navbar from "@/components/Navbar";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import {
  isAccountGatedRoute,
  isEstateAgentProtectedRoute,
  ROUTES,
} from "@/lib/auth/routes";
import { SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE } from "@/lib/legal/constants";
import { ensurePendingSignupLegalAcceptanceFlushed } from "@/lib/legal/recordSignupLegalAcceptance";
import { PAGE_BG_CLASS } from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

type GatePhase = "clear" | "blocked" | "sign_in";

type GateDecision = {
  path: string;
  phase: GatePhase;
  message: string | null;
  mode: "expired" | "persist_failed" | null;
};

/**
 * Re-reads browser pending-acceptance storage on each product route.
 * Direct navigation cannot skip the flush, and route state cannot mark
 * acceptance as saved. Public, login, recovery, and verify-email routes
 * are left to their existing flows.
 */
export default function PendingSignupLegalAcceptanceGate({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const gated = isAccountGatedRoute(pathname);
  const [decision, setDecision] = useState<GateDecision | null>(
    null
  );

  useEffect(() => {
    if (!gated) {
      return;
    }

    let cancelled = false;

    void (async () => {
      let result;

      try {
        result =
          await ensurePendingSignupLegalAcceptanceFlushed(
            supabase
          );
      } catch {
        if (cancelled) {
          return;
        }

        setDecision({
          path: pathname,
          phase: "blocked",
          message: SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE,
          mode: "persist_failed",
        });
        return;
      }

      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setDecision({
          path: pathname,
          phase: "blocked",
          message: result.message,
          mode:
            result.disposition === "expired"
              ? "expired"
              : "persist_failed",
        });
        return;
      }

      if (result.disposition === "awaiting_session") {
        setDecision({
          path: pathname,
          phase: "sign_in",
          message: result.message,
          mode: null,
        });
        return;
      }

      setDecision({
        path: pathname,
        phase: "clear",
        message: null,
        mode: null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [gated, pathname]);

  const phase: GatePhase | "checking" = !gated
    ? "clear"
    : decision?.path === pathname
      ? decision.phase
      : "checking";

  if (phase === "clear") {
    return children;
  }

  if (phase === "checking") {
    return (
      <ParticipantDataLoadingState message="Checking your account…" />
    );
  }

  if (phase === "sign_in") {
    return (
      <main className={PAGE_BG_CLASS}>
        <Navbar />
        <PageHeaderBand />
        <div className="max-w-xl mx-auto px-6 py-12">
          <div className="rounded-3xl border border-surface-card-border bg-surface-card p-8 text-center shadow-sm">
            <p className="text-slate-700">
              Sign in to finish saving your Terms of Service and
              Privacy Policy acceptance.
            </p>
            <button
              type="button"
              className="mt-6 rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
              onClick={() => {
                const next = `${window.location.pathname}${window.location.search}`;
                const login = isEstateAgentProtectedRoute(
                  window.location.pathname
                )
                  ? ROUTES.estateAgentLogin
                  : ROUTES.homeownerLogin;
                router.push(
                  `${login}?next=${encodeURIComponent(next)}`
                );
              }}
            >
              Sign in
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={PAGE_BG_CLASS}>
      <Navbar />
      <PageHeaderBand />
      <div className="max-w-xl mx-auto px-6 py-12">
        <SignupLegalAcceptanceRecoveryPanel
          mode={decision?.mode ?? "persist_failed"}
          message={decision?.message ?? null}
          onCleared={() => {
            setDecision({
              path: pathname,
              phase: "clear",
              message: null,
              mode: null,
            });
          }}
        />
      </div>
    </main>
  );
}
