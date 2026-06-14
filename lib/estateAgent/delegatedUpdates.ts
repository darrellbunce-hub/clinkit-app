import type { PropertyEaAssignment } from "@/lib/estateAgent/assignmentTypes";

/**
 * Foundation check for future delegated property updates by estate agents.
 * Does not grant operational position — assignment + delegation only.
 */
export function canAgentMutateAssignedProperty(
  assignment: Pick<
    PropertyEaAssignment,
    "status" | "homeowner_only_updates"
  > | null
): boolean {
  if (!assignment) {
    return false;
  }

  if (assignment.status !== "active") {
    return false;
  }

  return !assignment.homeowner_only_updates;
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
