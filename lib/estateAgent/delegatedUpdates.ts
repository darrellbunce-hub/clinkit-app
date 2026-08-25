import type { PropertyEaAssignment } from "@/lib/estateAgent/assignmentTypes";
import { isEstateAgentDelegationEnabled } from "@/lib/mutationPermission";

type DelegatedAssignmentInput = {
  status?: PropertyEaAssignment["status"];
  homeowner_only_updates?: boolean;
  homeownerOnlyUpdates?: boolean;
};

/**
 * Foundation check for delegated property updates by estate agents.
 * Assignment + delegation only — operational position resolved separately.
 */
export function canAgentMutateAssignedProperty(
  assignment: DelegatedAssignmentInput | null
): boolean {
  if (!assignment) {
    return false;
  }

  if (
    assignment.status != null &&
    assignment.status !== "active"
  ) {
    return false;
  }

  const homeownerOnlyUpdates =
    assignment.homeownerOnlyUpdates ??
    assignment.homeowner_only_updates ??
    true;

  return isEstateAgentDelegationEnabled({
    homeownerOnlyUpdates,
  });
}

export function getAgentAssignmentAccessLabel(
  assignment: Pick<
    PropertyEaAssignment,
    "status" | "homeowner_only_updates"
  > | null
): "none" | "view_only" | "delegated_updates" {
  if (
    !assignment ||
    assignment.status !== "active"
  ) {
    return "none";
  }

  if (assignment.homeowner_only_updates) {
    return "view_only";
  }

  return "delegated_updates";
}
