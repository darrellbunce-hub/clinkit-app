"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import PrivacyAuditTimeline from "@/components/privacyAdmin/PrivacyAuditTimeline";
import PrivacyImpactReportPanel from "@/components/privacyAdmin/PrivacyImpactReportPanel";
import PrivacyStatusBadge from "@/components/privacyAdmin/PrivacyStatusBadge";
import {
  approvePrivacyErasureRequestAction,
  assessPrivacyErasureScopeAction,
  completePrivacyAuthDeletionAction,
  executePrivacyErasureRequestAction,
  markPrivacyAuthDeletionEligibleAction,
  rejectPrivacyErasureRequestAction,
  updatePrivacyProcessorActionStatus,
  verifyPrivacyErasureIdentityAction,
} from "@/lib/privacyAdmin/actions";
import type { PrivacyRequestDetail } from "@/lib/privacyAdmin/types";
import { CARD_CLASS } from "@/lib/theme/themeTokens";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ActionMessage({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="rounded-2xl bg-surface-inset px-4 py-3 text-sm text-slate-700" role="status">
      {message}
    </p>
  );
}

export default function PrivacyRequestWorkspace({
  detail,
}: {
  detail: PrivacyRequestDetail;
}) {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const { request, capabilities } = detail;

  function runAction(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setMessage("");
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        if (result.error === "mfa_required" || result.message?.includes("mfa_")) {
          setMessage(
            "Your session is no longer at AAL2. Complete authenticator verification and try again."
          );
          return;
        }
        if (result.message === "scope_changed_reassessment_required") {
          setMessage(
            "Data relationships have changed since this request was approved. Reassessment is required."
          );
          return;
        }
        setMessage(result.message ?? result.error ?? "Operation failed.");
        return;
      }
      setMessage("Saved.");
      window.location.reload();
    });
  }

  return (
    <div className="space-y-6">
      <section className={CARD_CLASS}>
        <Link href="/admin/privacy" className="text-sm text-brand-primary">
          ← All privacy requests
        </Link>
        <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Privacy request</h1>
            <p className="mt-2 font-mono text-xs text-slate-500">{request.id}</p>
            <div className="mt-3">
              <PrivacyStatusBadge status={request.status} />
            </div>
          </div>
          <dl className="grid gap-2 text-sm md:text-right">
            <div>
              <dt className="text-slate-500">Requested</dt>
              <dd>{formatDate(request.requestedAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Subject user ID</dt>
              <dd className="font-mono text-xs">{request.subjectUserId}</dd>
            </div>
          </dl>
        </div>
        {capabilities.isReadOnly ? (
          <p className="mt-4 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
            This request is read-only. Destructive controls are hidden.
          </p>
        ) : null}
        <ActionMessage message={message} />
      </section>

      <section className={CARD_CLASS}>
        <h2 className="text-lg font-semibold text-slate-900">Workflow</h2>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-slate-500">Identity verified</dt>
            <dd>{formatDate(request.identityVerifiedAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Scope assessed</dt>
            <dd>{formatDate(request.scopeAssessedAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Approved</dt>
            <dd>{formatDate(request.approvedAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Database processing completed</dt>
            <dd>{formatDate(request.databaseProcessingCompletedAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Auth deletion completed</dt>
            <dd>{formatDate(request.authDeletionCompletedAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Completed</dt>
            <dd>{formatDate(request.completedAt)}</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-col gap-3">
          {capabilities.canVerifyIdentity ? (
            <ConfirmButton
              label="Mark identity as verified"
              confirmText="Confirm that the data subject identity has been verified through an approved privacy process."
              disabled={isPending}
              onConfirm={() =>
                runAction(async () => verifyPrivacyErasureIdentityAction(request.id))
              }
            />
          ) : null}

          {capabilities.canAssessScope ? (
            <ConfirmButton
              label="Generate impact assessment"
              confirmText="Generate a fresh impact assessment and draft erasure actions from current database state."
              disabled={isPending}
              onConfirm={() =>
                runAction(async () => assessPrivacyErasureScopeAction(request.id))
              }
            />
          ) : null}

          {capabilities.canApprove ? (
            <ConfirmButton
              label="Approve erasure plan"
              confirmText="Approve the proposed erasure plan. Execution still requires a separate action and fresh scope validation."
              disabled={isPending}
              tone="primary"
              onConfirm={() =>
                runAction(async () => approvePrivacyErasureRequestAction(request.id))
              }
            />
          ) : null}

          {capabilities.canReject ? (
            <ConfirmButton
              label="Reject request"
              confirmText="Reject this privacy request before further destructive processing."
              disabled={isPending}
              tone="danger"
              onConfirm={() =>
                runAction(async () =>
                  rejectPrivacyErasureRequestAction({
                    requestId: request.id,
                    reasonCode: "rejected_by_admin",
                  })
                )
              }
            />
          ) : null}

          {capabilities.canExecute ? (
            <ConfirmButton
              label="Execute approved erasure"
              confirmText="This will begin approved database personal-data treatment. Shared-transaction safety and fresh scope validation remain enforced."
              disabled={isPending}
              tone="danger"
              onConfirm={() =>
                runAction(async () => executePrivacyErasureRequestAction(request.id))
              }
            />
          ) : null}

          {capabilities.canMarkAuthEligible ? (
            <ConfirmButton
              label="Prepare Auth deletion"
              confirmText="Prepare the subject account for Auth deletion after database treatment."
              disabled={isPending}
              onConfirm={() =>
                runAction(async () => markPrivacyAuthDeletionEligibleAction(request.id))
              }
            />
          ) : null}

          {capabilities.canDeleteAuth ? (
            <ConfirmButton
              label="Delete Keynetic account"
              confirmText="Permanently remove the subject login from Supabase Auth after approved database treatment. External/manual actions may still affect overall completion."
              disabled={isPending}
              tone="danger"
              onConfirm={() =>
                runAction(async () => completePrivacyAuthDeletionAction(request.id))
              }
            />
          ) : null}
        </div>
      </section>

      <PrivacyImpactReportPanel assessment={detail.impactAssessment} />

      <section className={CARD_CLASS}>
        <h2 className="text-lg font-semibold text-slate-900">Manual and processor actions</h2>
        <div className="mt-4 space-y-4">
          {detail.actions.map((action) => (
            <div key={action.id} className="rounded-2xl bg-surface-inset px-4 py-3 text-sm">
              <p className="font-medium text-slate-900">{action.actionType}</p>
              <p className="text-slate-600">
                {action.status} · {action.reasonCode}
                {action.propertyId ? ` · property ${action.propertyId}` : ""}
                {action.requiresManualReview ? " · manual review" : ""}
              </p>
            </div>
          ))}
          {detail.processors.map((processor) => (
            <div
              key={`${processor.processor}-${processor.actionType}`}
              className="rounded-2xl bg-surface-inset px-4 py-3 text-sm"
            >
              <p className="font-medium text-slate-900">{processor.processor}</p>
              <p className="text-slate-600">
                {processor.actionType} · {processor.status}
                {processor.required ? " · required" : ""}
              </p>
              {capabilities.canUpdateProcessors &&
              processor.processor !== "supabase_auth" &&
              ["pending", "manual_review"].includes(processor.status) ? (
                <ConfirmButton
                  label={`Mark ${processor.processor} complete`}
                  confirmText={`Confirm external ${processor.processor} erasure/review work has been completed manually.`}
                  disabled={isPending}
                  compact
                  onConfirm={() =>
                    runAction(async () =>
                      updatePrivacyProcessorActionStatus({
                        requestId: request.id,
                        processor: processor.processor,
                        status: "completed",
                      })
                    )
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <PrivacyAuditTimeline events={detail.auditEvents} />
    </div>
  );
}

function ConfirmButton({
  label,
  confirmText,
  disabled,
  tone = "neutral",
  compact = false,
  onConfirm,
}: {
  label: string;
  confirmText: string;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "danger";
  compact?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const base =
    tone === "primary"
      ? "bg-brand-primary text-white"
      : tone === "danger"
        ? "bg-red-600 text-white"
        : "bg-white text-slate-900 border border-slate-200";

  return (
    <div className={compact ? "mt-3" : ""}>
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={`rounded-2xl px-4 py-3 text-sm font-medium disabled:opacity-60 ${base}`}
        >
          {label}
        </button>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">{confirmText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
              className={`rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-60 ${base}`}
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setOpen(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
