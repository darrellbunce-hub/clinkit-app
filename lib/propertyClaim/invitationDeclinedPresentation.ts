import { formatFullTimestamp } from "@/lib/formatting/relativeTime";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import { formatInvitationRejectionReason } from "@/lib/propertyClaim/invitationRejection";
import {
  isInvitationDeclinedPriority,
  isUnacknowledgedInvitationDeclinedPriority,
} from "@/lib/propertyClaim/invitationPresentation";

export const INVITATION_DECLINED_ACTION_REASON =
  "Homeowner declined invitation";

export function formatInvitationDeclinedTimestamp(
  rejectedAt: string | null | undefined
): string | null {
  if (!rejectedAt) {
    return null;
  }

  return formatFullTimestamp(rejectedAt);
}

export function getInvitationDeclinedActionDetails(
  summary: Pick<
    AgentBranchPropertySummary,
    | "invite_email"
    | "invitation_rejected_at"
    | "invitation_rejection_reason"
  >
): {
  inviteEmail: string | null;
  declinedAtLabel: string | null;
  rejectionReasonLabel: string | null;
} {
  return {
    inviteEmail: summary.invite_email ?? null,
    declinedAtLabel: formatInvitationDeclinedTimestamp(
      summary.invitation_rejected_at
    ),
    rejectionReasonLabel: formatInvitationRejectionReason(
      summary.invitation_rejection_reason
    ),
  };
}

export function shouldShowInvitationDeclinedActionDetails(
  summary: AgentBranchPropertySummary
): boolean {
  return isUnacknowledgedInvitationDeclinedPriority(summary);
}

export function shouldShowInvitationDeclinedManagedState(
  summary: AgentBranchPropertySummary
): boolean {
  return isInvitationDeclinedPriority(summary);
}
