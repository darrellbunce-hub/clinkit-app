"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import PrivacyStatusBadge from "@/components/privacyAdmin/PrivacyStatusBadge";
import { createPrivacyErasureRequestAction } from "@/lib/privacyAdmin/actions";
import type { PrivacyRequestListItem } from "@/lib/privacyAdmin/types";
import { CARD_CLASS, DASHBOARD_LIST_CLASS, DASHBOARD_LIST_ROW_CLASS } from "@/lib/theme/themeTokens";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function PrivacyRequestListPanel({
  requests,
}: {
  requests: PrivacyRequestListItem[];
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleCreateRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    startTransition(async () => {
      const result = await createPrivacyErasureRequestAction({
        subjectEmail: email,
        requestSource: "privacy_email",
      });

      if (!result.ok) {
        if (result.error === "mfa_required") {
          setMessage(
            "Authenticator verification (AAL2) is required before creating privacy requests."
          );
          return;
        }
        if (result.error === "subject_not_found") {
          setMessage("No Keynetic account matched that email address.");
          return;
        }
        if (result.error === "unauthenticated" || result.error === "forbidden") {
          setMessage("You are not authorised to create privacy requests.");
          return;
        }
        setMessage("Could not create privacy request. Check the email and try again.");
        return;
      }

      window.location.href = `/admin/privacy/${result.requestId}`;
    });
  }

  return (
    <div className="space-y-6">
      <section className={CARD_CLASS}>
        <h1 className="text-2xl font-semibold text-slate-900">
          Privacy erasure requests
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Internal GDPR Right to Erasure operations. Exact-match subject lookup only.
        </p>

        <form className="mt-6 space-y-3" onSubmit={handleCreateRequest}>
          <label className="block text-sm font-medium text-slate-700">
            Create privacy request
          </label>
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              type="email"
              required
              autoComplete="off"
              placeholder="Requester email (exact match)"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-2xl bg-brand-primary px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {isPending ? "Creating…" : "Create request"}
            </button>
          </div>
          {message ? (
            <p className="text-sm text-slate-700" role="status">
              {message}
            </p>
          ) : null}
        </form>
      </section>

      <section className={CARD_CLASS}>
        <h2 className="text-lg font-semibold text-slate-900">Open and recent requests</h2>
        {requests.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No privacy requests yet.</p>
        ) : (
          <div className={`${DASHBOARD_LIST_CLASS} mt-4`}>
            {requests.map((request) => (
              <Link
                key={request.id}
                href={`/admin/privacy/${request.id}`}
                className={`${DASHBOARD_LIST_ROW_CLASS} block hover:bg-surface-panel-hover`}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-mono text-xs text-slate-500">
                      {request.id}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <PrivacyStatusBadge status={request.status} />
                      {request.manualReviewRequired ? (
                        <span className="rounded-full bg-rose-50 px-2 py-1 text-xs text-rose-700">
                          Manual review
                        </span>
                      ) : null}
                      {request.hasOutstandingProcessors ? (
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">
                          External processors
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-sm text-slate-600">
                    <p>{formatDate(request.requestedAt)}</p>
                    <p className="mt-1">
                      Identity: {request.identityVerified ? "verified" : "pending"}
                      {" · "}
                      Scope: {request.scopeAssessed ? "assessed" : "pending"}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
