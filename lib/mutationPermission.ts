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
 * Estate agents: subject position only when delegation is enabled.
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

  if (!isEstateAgentDelegationEnabled(assignment)) {
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
