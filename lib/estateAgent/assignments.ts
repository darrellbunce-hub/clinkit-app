import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AgentBranchPropertySummary,
  EaBranchDirectoryEntry,
  PropertyEaAssignment,
} from "@/lib/estateAgent/assignmentTypes";
import type { PropertyClaimStatus } from "@/lib/propertyClaim/types";

export const EA_BRANCH_DIRECTORY_MIN_QUERY_LENGTH = 2;

export const EA_BRANCH_DIRECTORY_SEARCH_LIMIT = 20;

/**
 * Server-side search of eligible branches. Every term must match company,
 * branch, town or postcode; matching happens before the row limit.
 */
export async function searchEaBranchDirectory(
  supabase: SupabaseClient,
  query: string,
  limit = EA_BRANCH_DIRECTORY_SEARCH_LIMIT
): Promise<{
  branches: EaBranchDirectoryEntry[];
  error: string | null;
}> {
  const trimmedQuery = query.trim();

  if (
    trimmedQuery.length <
    EA_BRANCH_DIRECTORY_MIN_QUERY_LENGTH
  ) {
    return {
      branches: [],
      error: null,
    };
  }

  const { data, error } = await supabase.rpc(
    "search_ea_branch_directory",
    {
      p_query: trimmedQuery,
      p_limit: limit,
    }
  );

  if (error) {
    return {
      branches: [],
      error: error.message,
    };
  }

  return {
    branches: (data ??
      []) as EaBranchDirectoryEntry[],
    error: null,
  };
}

export async function loadPropertyEaAssignment(
  supabase: SupabaseClient,
  propertyId: number
): Promise<PropertyEaAssignment | null> {
  const { data, error } = await supabase
    .from("property_ea_assignments")
    .select("*")
    .eq("property_id", propertyId)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as PropertyEaAssignment;
}

export async function loadEstateAgentOperationalAssignments(
  supabase: SupabaseClient
): Promise<
  Array<{
    propertyId: number;
    chainId: number;
    subjectUserId: string | null;
    homeownerOnlyUpdates: boolean;
    claimStatus: PropertyClaimStatus | null;
  }>
> {
  const { data, error } = await supabase
    .from("ea_operational_assignments")
    .select(
      "property_id, chain_id, subject_user_id, homeowner_only_updates, claim_status"
    );

  if (error || !data) {
    if (error) {
      console.error(error);
    }

    return [];
  }

  return data.map((row) => ({
    propertyId: row.property_id,
    chainId: row.chain_id,
    subjectUserId: row.subject_user_id,
    homeownerOnlyUpdates:
      row.homeowner_only_updates ?? true,
    claimStatus:
      (row.claim_status as PropertyClaimStatus | null) ??
      null,
  }));
}

export type AssignPropertyToBranchInput = {
  propertyId: number;
  branchId: string;
  homeownerOnlyUpdates: boolean;
};

type AssignmentRpcResult = {
  ok?: boolean;
  error?: string;
  assignment_id?: string;
};

export function formatPropertyEaAssignmentError(
  code: string | null | undefined
): string {
  switch (code) {
    case "not_authorized":
      return "Only the homeowner selling this property can appoint or change its estate agent.";
    case "branch_acts_for_buyer":
      return "This branch represents the buyer of this property, so it cannot also act for you as seller.";
    case "branch_not_found":
      return "That estate agent branch could not be found.";
    case "no_active_assignment":
      return "This property has no estate agent assigned.";
    case "invalid_property":
      return "An estate agent cannot be assigned to this property.";
    default:
      return "Could not update the estate agent for this property.";
  }
}

/**
 * The delegation toggle returns branch_not_found only when the assigned branch
 * cannot be given delegated updates; the message must not reveal why.
 */
export function formatPropertyEaDelegationError(
  code: string | null | undefined
): string {
  if (code === "branch_not_found") {
    return "This Estate Agent branch is not currently eligible for delegated updates. Please contact support if you think this is incorrect.";
  }

  return formatPropertyEaAssignmentError(code);
}

async function callAssignmentRpc(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  formatError: (
    code: string | null | undefined
  ) => string = formatPropertyEaAssignmentError
): Promise<{ assignmentId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    return {
      assignmentId: null,
      error: formatError(null),
    };
  }

  const result = data as AssignmentRpcResult | null;

  if (!result?.ok) {
    return {
      assignmentId: null,
      error: formatError(result?.error),
    };
  }

  return {
    assignmentId: result.assignment_id ?? null,
    error: null,
  };
}

/** Seller-side homeowner appoints (or replaces) the property's EA branch. */
export async function assignPropertyToBranch(
  supabase: SupabaseClient,
  input: AssignPropertyToBranchInput
): Promise<{ assignmentId: string | null; error: string | null }> {
  return callAssignmentRpc(
    supabase,
    "assign_property_ea_branch",
    {
      p_property_id: input.propertyId,
      p_branch_id: input.branchId,
      p_homeowner_only_updates:
        input.homeownerOnlyUpdates,
    }
  );
}

/** Seller-side homeowner sets whether their EA branch may post updates. */
export async function updatePropertyEaDelegation(
  supabase: SupabaseClient,
  propertyId: number,
  homeownerOnlyUpdates: boolean
): Promise<{ error: string | null }> {
  const { error } = await callAssignmentRpc(
    supabase,
    "set_property_ea_update_permission",
    {
      p_property_id: propertyId,
      p_homeowner_only_updates:
        homeownerOnlyUpdates,
    },
    formatPropertyEaDelegationError
  );

  return { error };
}

export async function loadAgentBranchPropertySummaries(
  supabase: SupabaseClient
): Promise<AgentBranchPropertySummary[]> {
  const { data, error } = await supabase
    .from("agent_branch_property_summaries")
    .select("*")
    .order("assigned_at", {
      ascending: false,
    });

  if (error || !data) {
    return [];
  }

  return data as AgentBranchPropertySummary[];
}

export async function loadAssignmentWithBranchDirectory(
  supabase: SupabaseClient,
  propertyId: number
): Promise<{
  assignment: PropertyEaAssignment | null;
  branch: EaBranchDirectoryEntry | null;
}> {
  const assignment =
    await loadPropertyEaAssignment(
      supabase,
      propertyId
    );

  if (!assignment) {
    return {
      assignment: null,
      branch: null,
    };
  }

  const { data: branches } = await supabase.rpc(
    "get_property_ea_branch_entry",
    { p_property_id: propertyId }
  );

  const branch =
    (
      (branches ?? []) as EaBranchDirectoryEntry[]
    ).find(
      (entry) =>
        entry.branch_id === assignment.branch_id
    ) ?? null;

  return {
    assignment,
    branch,
  };
}
