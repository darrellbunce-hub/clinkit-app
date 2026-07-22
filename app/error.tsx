"use client";

import Link from "next/link";
import { useEffect } from "react";

import { PAGE_TITLE_CLASS } from "@/components/mobileStandards";
import { captureObservabilityException } from "@/lib/observability/sentryShared";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({
  error,
  reset,
}: ErrorPageProps) {
  useEffect(() => {
    void captureObservabilityException(error, {
      route: "app/error",
      operation: "render_error_boundary",
      errorCode: error.digest ? "render_error_digest" : "render_error",
    });
  }, [error]);

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <h1 className={PAGE_TITLE_CLASS}>
          Something went wrong
        </h1>

        <p className="mt-4 text-lg text-slate-600">
          We could not load this page. You can try again or return
          to your dashboard.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="bg-slate-900 text-white px-6 py-4 rounded-xl font-semibold hover:bg-slate-700 transition"
          >
            Try again
          </button>

          <Link
            href="/dashboard"
            className="bg-white text-slate-900 border border-slate-300 px-6 py-4 rounded-xl font-semibold hover:bg-slate-50 transition"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
