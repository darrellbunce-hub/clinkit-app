"use client";

import Navbar from "@/components/Navbar";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import { PAGE_BG_CLASS } from "@/lib/theme/themeTokens";

type ParticipantDataLoadingStateProps = {
  message?: string;
  showNav?: boolean;
};

/**
 * Full-page loading shell while participant chain data is loading.
 * Prevents transient empty/error states on property and dashboard routes.
 */
export default function ParticipantDataLoadingState({
  message = "Loading your property data…",
  showNav = true,
}: ParticipantDataLoadingStateProps) {
  return (
    <main className={PAGE_BG_CLASS}>
      {showNav ? (
        <>
          <Navbar />
          <PageHeaderBand />
        </>
      ) : null}

      <div className="max-w-4xl mx-auto px-6 py-12">
        <div
          className="rounded-3xl border border-surface-card-border bg-surface-card p-10 text-center text-text-muted shadow-sm"
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
      </div>
    </main>
  );
}
