"use client";

import { useEffect } from "react";

import { PAGE_TITLE_CLASS } from "@/components/mobileStandards";
import { captureObservabilityException } from "@/lib/observability/sentryShared";

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalErrorPage({
  error,
  reset,
}: GlobalErrorPageProps) {
  useEffect(() => {
    captureObservabilityException(error, {
      route: "app/global-error",
      operation: "global_error_boundary",
      errorCode: error.digest ? "global_error_digest" : "global_error",
    });
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100 antialiased">
        <main>
          <div className="max-w-2xl mx-auto px-6 py-24 text-center">
            <h1 className={PAGE_TITLE_CLASS}>
              Something went wrong
            </h1>

            <p className="mt-4 text-lg text-slate-600">
              Keynetic hit an unexpected problem. Please try again.
            </p>

            <button
              type="button"
              onClick={() => reset()}
              className="mt-10 bg-slate-900 text-white px-6 py-4 rounded-xl font-semibold hover:bg-slate-700 transition"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
