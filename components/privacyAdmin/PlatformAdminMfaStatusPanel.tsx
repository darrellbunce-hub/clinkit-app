"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { unenrollPlatformAdminMfaFactorAction } from "@/lib/auth/platformAdminMfaActions";
import { ROUTES } from "@/lib/auth/routes";
import { CARD_CLASS } from "@/lib/theme/themeTokens";

type MfaStatus = {
  hasVerifiedTotp: boolean;
  assuranceLevel: string | null;
  nextAssuranceLevel: string | null;
  unverifiedFactorCount: number;
  verifiedFactorId: string | null;
};

export default function PlatformAdminMfaStatusPanel({
  status,
}: {
  status: MfaStatus | null;
}) {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleRemoveFactor() {
    if (!status?.verifiedFactorId) {
      return;
    }

    const confirmed = window.confirm(
      "Removing your only verified authenticator will block Privacy Admin access until MFA is re-enrolled. Continue?"
    );
    if (!confirmed) {
      return;
    }

    setMessage("");
    startTransition(async () => {
      const result = await unenrollPlatformAdminMfaFactorAction({
        factorId: status.verifiedFactorId!,
      });
      if (!result.ok) {
        setMessage("Could not remove the authenticator factor.");
      }
    });
  }

  return (
    <section className={CARD_CLASS}>
      <h1 className="text-2xl font-semibold text-slate-900">MFA status</h1>
      <p className="mt-2 text-sm text-slate-600">
        Privacy Admin requires a verified TOTP factor and an active AAL2 session.
      </p>

      {status ? (
        <dl className="mt-6 space-y-3 text-sm">
          <div className="rounded-2xl bg-surface-inset px-4 py-3">
            <dt className="text-slate-500">Verified authenticator</dt>
            <dd className="mt-1 font-medium text-slate-900">
              {status.hasVerifiedTotp ? "Enrolled" : "Not enrolled"}
            </dd>
          </div>
          <div className="rounded-2xl bg-surface-inset px-4 py-3">
            <dt className="text-slate-500">Current assurance level</dt>
            <dd className="mt-1 font-medium text-slate-900">
              {status.assuranceLevel ?? "unknown"}
            </dd>
          </div>
          <div className="rounded-2xl bg-surface-inset px-4 py-3">
            <dt className="text-slate-500">Next assurance level</dt>
            <dd className="mt-1 font-medium text-slate-900">
              {status.nextAssuranceLevel ?? "none"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-6 text-sm text-slate-600">MFA status unavailable.</p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <Link
          href={ROUTES.privacyAdmin}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-brand-primary px-4 py-3 text-sm font-medium text-white"
        >
          Open Privacy Admin
        </Link>
        {status?.verifiedFactorId ? (
          <button
            type="button"
            disabled={isPending}
            onClick={handleRemoveFactor}
            className="min-h-11 rounded-2xl border border-red-200 px-4 py-3 text-sm font-medium text-red-700 disabled:opacity-60"
          >
            Remove authenticator (requires re-enrolment)
          </button>
        ) : null}
      </div>

      {message ? (
        <p className="mt-4 text-sm text-slate-700" role="status">
          {message}
        </p>
      ) : null}

      <p className="mt-6 text-xs text-slate-500">
        Lost device recovery is operational only: contact engineering leadership to verify
        identity out-of-band, then re-provision platform-admin MFA. There is no self-service
        bypass in Production.
      </p>
    </section>
  );
}
