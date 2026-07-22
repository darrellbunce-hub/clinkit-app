"use client";

import { useState } from "react";

import { PAGE_TITLE_CLASS } from "@/components/mobileStandards";
import { captureObservabilityException } from "@/lib/observability/sentryShared";
import {
  SENTRY_CLIENT_VERIFICATION_MESSAGE,
  SENTRY_SERVER_VERIFICATION_MESSAGE,
} from "@/lib/observability/sentryVerification";

type VerificationStatus = "idle" | "sent" | "failed";

export default function SentryVerificationPanel() {
  const [clientStatus, setClientStatus] =
    useState<VerificationStatus>("idle");
  const [serverStatus, setServerStatus] =
    useState<VerificationStatus>("idle");

  function triggerClientVerification() {
    setClientStatus("idle");

    try {
      throw new Error(SENTRY_CLIENT_VERIFICATION_MESSAGE);
    } catch (error) {
      captureObservabilityException(error, {
        operation: "sentry_verification_client",
        route: "/dev/sentry-verification",
        errorCode: "sentry_verification_client",
      });
      setClientStatus("sent");
    }
  }

  async function triggerServerVerification() {
    setServerStatus("idle");

    try {
      const response = await fetch("/api/dev/sentry-verification", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        setServerStatus("sent");
        return;
      }

      setServerStatus("failed");
    } catch {
      setServerStatus("sent");
    }
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="max-w-2xl mx-auto px-6 py-24">
        <h1 className={PAGE_TITLE_CLASS}>
          Sentry verification
        </h1>

        <p className="mt-4 text-lg text-slate-600">
          Non-Production only. Use these fixed checks to confirm browser and
          server errors reach Sentry with privacy scrubbing applied.
        </p>

        <div className="mt-10 space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Client verification
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Sends a controlled browser error tagged{" "}
              <code className="text-xs">{SENTRY_CLIENT_VERIFICATION_MESSAGE}</code>
            </p>
            <button
              type="button"
              onClick={triggerClientVerification}
              className="mt-4 bg-slate-900 text-white px-5 py-3 rounded-xl font-semibold hover:bg-slate-700 transition"
            >
              Trigger client verification
            </button>
            {clientStatus === "sent" ? (
              <p className="mt-3 text-sm text-emerald-700">
                Client verification event sent. Check Sentry for the fixed
                message above.
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Server verification
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Calls a fixed server route tagged{" "}
              <code className="text-xs">{SENTRY_SERVER_VERIFICATION_MESSAGE}</code>
            </p>
            <button
              type="button"
              onClick={() => void triggerServerVerification()}
              className="mt-4 bg-slate-900 text-white px-5 py-3 rounded-xl font-semibold hover:bg-slate-700 transition"
            >
              Trigger server verification
            </button>
            {serverStatus === "sent" ? (
              <p className="mt-3 text-sm text-emerald-700">
                Server verification request completed. Check Sentry for the
                fixed message above.
              </p>
            ) : null}
            {serverStatus === "failed" ? (
              <p className="mt-3 text-sm text-amber-700">
                Unexpected success response. The server route should fail when
                verification throws.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
