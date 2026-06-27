import {
  canMutateBuyerReadyTarget,
  canMutatePropertyTarget,
  type MutationPermissionContext,
  type OperationalBuyerReadyNode,
  type OperationalProperty,
} from "@/lib/operationalPosition";
import { canOperationalParticipantManageChainCompletionDate } from "@/lib/recordChainCompletionDate";
import { STALE_DAYS_PAGE_ALERT } from "@/lib/activityIntelligence";
import type { AccountType } from "@/lib/accountType";
import type { EstateAgentOperationalAssignment } from "@/lib/operationalSubject";

export type WorkflowKind =
  | "buyer_ready"
  | "property"
  | "completion"
  | "mortgage"
  | "conveyancing";

export type WorkflowTarget =
  | {
      kind: "buyer_ready";
      chainId: number;
      nodeId: number;
    }
  | {
      kind: "property";
      chainId: number;
      propertyId: number;
    }
  | {
      kind: "completion";
      chainId: number;
    };

export type WorkflowAccessMode =
  | "editable"
  | "read_only"
  | "denied";

export type WorkflowViewerRole =
  | "owner"
  | "chain_participant"
  | "estate_agent"
  | "none";

export type WorkflowPermissionContext = {
  userId: string | null | undefined;
  chainProperties: OperationalProperty[];
  chainNodes: OperationalBuyerReadyNode[];
  accountType?: AccountType | null;
  estateAgentAssignments?: EstateAgentOperationalAssignment[];
};

export type WorkflowAccess = {
  canView: boolean;
  canEdit: boolean;
  mode: WorkflowAccessMode;
  viewerRole: WorkflowViewerRole;
  bannerMessage: string | null;
};

export const WORKFLOW_READ_ONLY_BANNER_MESSAGE =
  "You are viewing another participant's workflow. You can follow their progress to understand the chain, but only the owner can make updates.";

export const WORKFLOW_EA_DELEGATED_BANNER_MESSAGE =
  "You are managing this workflow on behalf of the homeowner. All updates you make are recorded in the activity history.";

function buildMutationContext(
  ctx: WorkflowPermissionContext
): MutationPermissionContext {
  return {
    accountType: ctx.accountType,
    estateAgentAssignments: ctx.estateAgentAssignments,
  };
}

function editableWorkflowAccess(
  viewerRole: Extract<WorkflowViewerRole, "owner" | "estate_agent">,
  bannerMessage: string | null = null
): WorkflowAccess {
  return {
    canView: true,
    canEdit: true,
    mode: "editable",
    viewerRole,
    bannerMessage,
  };
}

function findBuyerReadyNode(
  chainId: number,
  nodeId: number,
  chainNodes: OperationalBuyerReadyNode[]
) {
  return chainNodes.find(
    (node) =>
      Number(node.chain_id) === Number(chainId) &&
      node.node_type === "buyer_ready" &&
      node.id === nodeId
  );
}

function isChainParticipantInContext(
  chainId: number,
  ctx: WorkflowPermissionContext
): boolean {
  return ctx.chainProperties.some(
    (property) =>
      Number(property.chainId) === Number(chainId)
  );
}

function isEstateAgentViewer(
  ctx: WorkflowPermissionContext
): boolean {
  return ctx.accountType === "estate_agent";
}

function readOnlyWorkflowAccess(
  viewerRole: Extract<
    WorkflowViewerRole,
    "chain_participant" | "estate_agent"
  >
): WorkflowAccess {
  return {
    canView: true,
    canEdit: false,
    mode: "read_only",
    viewerRole,
    bannerMessage: WORKFLOW_READ_ONLY_BANNER_MESSAGE,
  };
}

function resolveBuyerReadyAccess(
  target: Extract<WorkflowTarget, { kind: "buyer_ready" }>,
  ctx: WorkflowPermissionContext
): WorkflowAccess {
  const node = findBuyerReadyNode(
    target.chainId,
    target.nodeId,
    ctx.chainNodes
  );

  if (!node) {
    return {
      canView: false,
      canEdit: false,
      mode: "denied",
      viewerRole: "none",
      bannerMessage: null,
    };
  }

  const isParticipant = isChainParticipantInContext(
    target.chainId,
    ctx
  );

  if (!isParticipant) {
    return {
      canView: false,
      canEdit: false,
      mode: "denied",
      viewerRole: "none",
      bannerMessage: null,
    };
  }

  const canEdit = canMutateBuyerReadyTarget(
    target.nodeId,
    target.chainId,
    ctx.userId,
    ctx.chainProperties,
    ctx.chainNodes,
    buildMutationContext(ctx)
  );

  if (canEdit) {
    if (isEstateAgentViewer(ctx)) {
      return editableWorkflowAccess(
        "estate_agent",
        WORKFLOW_EA_DELEGATED_BANNER_MESSAGE
      );
    }

    return editableWorkflowAccess("owner");
  }

  if (isEstateAgentViewer(ctx)) {
    return readOnlyWorkflowAccess("estate_agent");
  }

  return readOnlyWorkflowAccess("chain_participant");
}

function resolvePropertyAccess(
  target: Extract<WorkflowTarget, { kind: "property" }>,
  ctx: WorkflowPermissionContext
): WorkflowAccess {
  const property = ctx.chainProperties.find(
    (row) => row.id === target.propertyId
  );

  if (!property) {
    return {
      canView: false,
      canEdit: false,
      mode: "denied",
      viewerRole: "none",
      bannerMessage: null,
    };
  }

  const isParticipant = isChainParticipantInContext(
    target.chainId,
    ctx
  );

  if (!isParticipant) {
    return {
      canView: false,
      canEdit: false,
      mode: "denied",
      viewerRole: "none",
      bannerMessage: null,
    };
  }

  const canEdit = canMutatePropertyTarget(
    property,
    ctx.userId,
    ctx.chainProperties,
    ctx.chainNodes,
    buildMutationContext(ctx)
  );

  if (canEdit) {
    if (isEstateAgentViewer(ctx)) {
      return editableWorkflowAccess(
        "estate_agent",
        WORKFLOW_EA_DELEGATED_BANNER_MESSAGE
      );
    }

    return editableWorkflowAccess("owner");
  }

  if (isEstateAgentViewer(ctx)) {
    return readOnlyWorkflowAccess("estate_agent");
  }

  return readOnlyWorkflowAccess("chain_participant");
}

function resolveCompletionAccess(
  target: Extract<WorkflowTarget, { kind: "completion" }>,
  ctx: WorkflowPermissionContext
): WorkflowAccess {
  const isParticipant = isChainParticipantInContext(
    target.chainId,
    ctx
  );

  if (!isParticipant) {
    return {
      canView: false,
      canEdit: false,
      mode: "denied",
      viewerRole: "none",
      bannerMessage: null,
    };
  }

  const managementAccess =
    canOperationalParticipantManageChainCompletionDate({
      userId: ctx.userId,
      chainId: target.chainId,
      chainProperties: ctx.chainProperties,
      chainNodes: ctx.chainNodes,
      mutationContext: buildMutationContext(ctx),
    });

  if (managementAccess.ok) {
    if (isEstateAgentViewer(ctx)) {
      return editableWorkflowAccess(
        "estate_agent",
        WORKFLOW_EA_DELEGATED_BANNER_MESSAGE
      );
    }

    return editableWorkflowAccess("owner");
  }

  if (isEstateAgentViewer(ctx)) {
    return readOnlyWorkflowAccess("estate_agent");
  }

  return readOnlyWorkflowAccess("chain_participant");
}

/**
 * Single source of truth for workflow visibility and edit rights.
 */
export function resolveWorkflowAccess(
  target: WorkflowTarget,
  ctx: WorkflowPermissionContext
): WorkflowAccess {
  switch (target.kind) {
    case "buyer_ready":
      return resolveBuyerReadyAccess(target, ctx);
    case "property":
      return resolvePropertyAccess(target, ctx);
    case "completion":
      return resolveCompletionAccess(target, ctx);
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

export function findBuyerReadyNodeForChain(
  chainId: number,
  chainNodes: OperationalBuyerReadyNode[]
) {
  return chainNodes.find(
    (node) =>
      Number(node.chain_id) === Number(chainId) &&
      node.node_type === "buyer_ready"
  );
}

export function getBuyerReadyStatusDescription(
  access: WorkflowAccess
): string {
  if (access.viewerRole === "owner") {
    return "Your property transaction is currently progressing through this stage of the chain process.";
  }

  if (access.viewerRole === "estate_agent" && access.canEdit) {
    return "You are managing this buyer readiness workflow on behalf of the homeowner.";
  }

  return "This participant's buyer readiness is currently progressing through this stage of the chain process.";
}

export function getBuyerReadyActionMessage(params: {
  access: WorkflowAccess;
  activeDelayReport: boolean;
  latestDelayUpdate: string | null;
  buyerLastUpdatedDays: number;
  isCompletionLifecycleFrozen: boolean;
}): {
  title: string;
  message: string;
  colour: string;
} {
  const {
    access,
    activeDelayReport,
    latestDelayUpdate,
    buyerLastUpdatedDays,
    isCompletionLifecycleFrozen,
  } = params;

  const isObserver = access.mode === "read_only";
  const isDelegatedManager =
    access.viewerRole === "estate_agent" && access.canEdit;

  if (activeDelayReport && latestDelayUpdate) {
    return {
      title: "Delay Reported",
      message: latestDelayUpdate,
      colour: "bg-amber-100 text-amber-700",
    };
  }

  if (
    !isCompletionLifecycleFrozen &&
    buyerLastUpdatedDays > STALE_DAYS_PAGE_ALERT
  ) {
    return {
      title: isObserver
        ? "Progress Update Recommended"
        : isDelegatedManager
          ? "Progress Update Recommended"
          : "Update Recommended",
      message: isObserver
        ? `No updates have been added for ${buyerLastUpdatedDays} days. This participant may need to check progress with their estate agent or conveyancer.`
        : isDelegatedManager
          ? `No updates have been added for ${buyerLastUpdatedDays} days. Consider posting an update on behalf of the homeowner.`
          : `No updates have been added for ${buyerLastUpdatedDays} days. Consider checking progress with your estate agent or conveyancer.`,
      colour: "bg-red-100 text-red-700",
    };
  }

  return {
    title: "No Immediate Actions",
    message: isObserver
      ? "This participant's transaction appears to be progressing normally."
      : isDelegatedManager
        ? "This transaction appears to be progressing normally."
        : "Your transaction appears to be progressing normally.",
    colour: "bg-green-100 text-green-700",
  };
}

export function formatActivityUpdaterLabel(
  updatedBy: string | null | undefined
): string {
  switch (updatedBy) {
    case "estate_agent":
      return "Estate Agent";
    case "solicitor":
      return "Solicitor";
    case "conveyancer":
      return "Conveyancer";
    case "system":
      return "System";
    default:
      return "Homeowner";
  }
}
