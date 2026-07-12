import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import { getInvitationDeclinedActionDetails } from "@/lib/propertyClaim/invitationDeclinedPresentation";

export default function InvitationDeclinedActionDetails({
  summary,
}: {
  summary: Pick<
    AgentBranchPropertySummary,
    | "invite_email"
    | "invitation_rejected_at"
    | "invitation_rejection_reason"
  >;
}) {
  const details = getInvitationDeclinedActionDetails(summary);

  return (
    <dl className="grid gap-3 rounded-xl border border-surface-card-border bg-surface-mist px-4 py-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium text-text-muted">
          Homeowner email
        </dt>
        <dd className="mt-0.5 text-text-charcoal">
          {details.inviteEmail ?? "Not provided"}
        </dd>
      </div>

      <div>
        <dt className="text-xs font-medium text-text-muted">
          Declined
        </dt>
        <dd className="mt-0.5 text-text-charcoal">
          {details.declinedAtLabel ?? "—"}
        </dd>
      </div>

      {details.rejectionReasonLabel ? (
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-text-muted">
            Reason
          </dt>
          <dd className="mt-0.5 text-text-charcoal">
            {details.rejectionReasonLabel}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
