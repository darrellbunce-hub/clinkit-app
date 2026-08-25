import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import { canAgentMutateAssignedProperty } from "@/lib/estateAgent/delegatedUpdates";
import type { EstateAgentOperationalAssignment } from "@/lib/operationalSubject";

export type EstateAgentManagementMode =
  | "awaiting_homeowner"
  | "shared_management"
  | "homeowner_managing";

export type EstateAgentManagementModeColour =
  | "amber"
  | "green"
  | "slate";

export type EstateAgentManagementModeInput = {
  origin_type?: string | null;
  claim_status?: string | null;
  claimStatus?: string | null;
  homeowner_only_updates?: boolean;
  homeownerOnlyUpdates?: boolean;
};

export type EstateAgentManagementModePresentation = {
  mode: EstateAgentManagementMode;
  badge: string;
  colour: EstateAgentManagementModeColour;
  title: string;
  description: string;
  editable: boolean;
};

const MODE_PRESENTATION: Record<
  EstateAgentManagementMode,
  {
    emoji: string;
    title: string;
    description: string;
    colour: EstateAgentManagementModeColour;
  }
> = {
  awaiting_homeowner: {
    emoji: "⏳",
    title: "Awaiting Homeowner",
    description:
      "Estate agent currently managing this transaction until the homeowner joins.",
    colour: "amber",
  },
  shared_management: {
    emoji: "🟢",
    title: "Shared Management",
    description:
      "Homeowner and estate agent can both update operational progress.",
    colour: "green",
  },
  homeowner_managing: {
    emoji: "🔒",
    title: "Homeowner Managing",
    description:
      "The homeowner has chosen to manage operational updates.",
    colour: "slate",
  },
};

function resolveClaimStatus(
  input: EstateAgentManagementModeInput
): string | null {
  return input.claimStatus ?? input.claim_status ?? null;
}

function resolveHomeownerOnlyUpdates(
  input: EstateAgentManagementModeInput
): boolean {
  return (
    input.homeownerOnlyUpdates ??
    input.homeowner_only_updates ??
    true
  );
}

/**
 * Resolves the estate agent management mode from assignment and claim metadata.
 * Delegation editability is derived from the existing assignment access model.
 */
export function resolveEstateAgentManagementMode(
  input: EstateAgentManagementModeInput
): EstateAgentManagementMode {
  const claimStatus = resolveClaimStatus(input);
  const homeownerOnlyUpdates =
    resolveHomeownerOnlyUpdates(input);
  const isClaimed = claimStatus === "claimed";

  if (!isClaimed) {
    return "awaiting_homeowner";
  }

  if (!homeownerOnlyUpdates) {
    return "shared_management";
  }

  return "homeowner_managing";
}

export function getEstateAgentManagementModePresentation(
  input: EstateAgentManagementModeInput
): EstateAgentManagementModePresentation {
  const mode = resolveEstateAgentManagementMode(input);
  const config = MODE_PRESENTATION[mode];
  const homeownerOnlyUpdates =
    resolveHomeownerOnlyUpdates(input);

  return {
    mode,
    badge: `${config.emoji} ${config.title}`,
    colour: config.colour,
    title: config.title,
    description: config.description,
    editable: canAgentMutateAssignedProperty({
      status: "active",
      homeowner_only_updates: homeownerOnlyUpdates,
      homeownerOnlyUpdates,
    }),
  };
}

export function getEstateAgentManagementModePresentationFromSummary(
  summary: Pick<
    AgentBranchPropertySummary,
    | "origin_type"
    | "claim_status"
    | "homeowner_only_updates"
  >
): EstateAgentManagementModePresentation {
  return getEstateAgentManagementModePresentation({
    origin_type: summary.origin_type,
    claim_status: summary.claim_status,
    homeowner_only_updates:
      summary.homeowner_only_updates,
  });
}

export function getEstateAgentManagementModeForOperationalAssignment(
  assignment:
    | Pick<
        EstateAgentOperationalAssignment,
        "claimStatus" | "homeownerOnlyUpdates"
      >
    | null
    | undefined
): EstateAgentManagementModePresentation | null {
  if (!assignment) {
    return null;
  }

  return getEstateAgentManagementModePresentation({
    claimStatus: assignment.claimStatus,
    homeownerOnlyUpdates:
      assignment.homeownerOnlyUpdates,
  });
}

export function getManagementModeBadgeClasses(
  colour: EstateAgentManagementModeColour
): string {
  switch (colour) {
    case "amber":
      return "bg-status-warning-soft text-status-warning-text ring-1 ring-status-warning/20";
    case "green":
      return "bg-status-success-soft text-status-success-text ring-1 ring-status-success/20";
    case "slate":
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  }
}
