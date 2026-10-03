import type { AccountType } from "@/lib/accountType";
import {
  resolveOperationalPosition,
  type OperationalBuyerReadyNode,
  type OperationalProperty,
  type ResolveOperationalPositionResult,
} from "@/lib/operationalPosition";
import {
  applyOperationalSubjectLens,
  pickEstateAgentAssignmentInChain,
  resolveOperationalSubject,
  type EstateAgentOperationalAssignment,
} from "@/lib/operationalSubject";

export type MutationPermissionContext = {
  accountType?: AccountType | null;
  estateAgentAssignments?: EstateAgentOperationalAssignment[];
};

export function isEstateAgentDelegationEnabled(
  assignment: Pick<
    EstateAgentOperationalAssignment,
    "homeownerOnlyUpdates"
  > | null | undefined
): boolean {
  return assignment?.homeownerOnlyUpdates === false;
}

/**
 * Mirrors can_operate_property for the assigned branch: with no seller-side
 * homeowner connected the EA is the operator; otherwise the homeowner's
 * EA-update permission decides.
 */
export function canEstateAgentOperateAssignment(
  assignment: Pick<
    EstateAgentOperationalAssignment,
    "homeownerOnlyUpdates" | "subjectUserId"
  > | null | undefined
): boolean {
  if (!assignment) {
    return false;
  }

  return (
    assignment.subjectUserId == null ||
    isEstateAgentDelegationEnabled(assignment)
  );
}

function findActiveAssignmentInChain(
  chainId: number,
  chainProperties: OperationalProperty[],
  estateAgentAssignments: EstateAgentOperationalAssignment[]
): EstateAgentOperationalAssignment | null {
  return pickEstateAgentAssignmentInChain(
    estateAgentAssignments,
    chainId,
    chainProperties
  );
}

/**
 * Resolves operational position for mutation checks.
 *
 * Homeowners: viewer membership (unchanged).
 * Estate agents: subject position when the branch may operate the assigned row
 * (EA-only, or the seller-side homeowner allows EA updates). EA-only rows use
 * the assigned-property lens with subject_user_id null; seller-hop topology
 * still resolves via applyOperationalSubjectLens.
 */
export function resolveMutationOperationalPosition(params: {
  viewerUserId: string | null | undefined;
  chainId: number;
  chainProperties: OperationalProperty[];
  chainNodes: OperationalBuyerReadyNode[];
  mutationContext?: MutationPermissionContext;
}): ResolveOperationalPositionResult {
  const {
    viewerUserId,
    chainId,
    chainProperties,
    chainNodes,
    mutationContext,
  } = params;

  if (!viewerUserId) {
    return { position: null };
  }

  if (mutationContext?.accountType !== "estate_agent") {
    return resolveOperationalPosition(
      viewerUserId,
      chainId,
      chainProperties,
      chainNodes
    );
  }

  const assignments =
    mutationContext.estateAgentAssignments ?? [];

  const subject = resolveOperationalSubject({
    viewerUserId,
    accountType: mutationContext.accountType,
    chainId,
    chainProperties,
    estateAgentAssignments: assignments,
  });

  if (!subject) {
    return { position: null };
  }

  const assignment = findActiveAssignmentInChain(
    chainId,
    chainProperties,
    assignments
  );

  if (!canEstateAgentOperateAssignment(assignment)) {
    return { position: null };
  }

  const scopedProperties = applyOperationalSubjectLens(
    chainProperties,
    subject
  );

  return resolveOperationalPosition(
    subject.subjectUserId,
    chainId,
    scopedProperties,
    chainNodes
  );
}

export function resolveActivityUpdaterRole(
  accountType: AccountType | null | undefined
): "homeowner" | "estate_agent" {
  return accountType === "estate_agent"
    ? "estate_agent"
    : "homeowner";
}
