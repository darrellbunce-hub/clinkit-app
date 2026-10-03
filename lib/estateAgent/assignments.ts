import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AgentBranchPropertySummary,
  EaBranchDirectoryEntry,
  PropertyEaAssignment,
} from "@/lib/estateAgent/assignmentTypes";
import type { PropertyClaimStatus } from "@/lib/propertyClaim/types";

export async function loadEaBranchDirectory(
  supabase: SupabaseClient
): Promise<{
  branches: EaBranchDirectoryEntry[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("ea_branch_directory")
    .select("*")
    .order("company_name")
    .order("branch_name")
    .limit(200);

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

export function filterEaBranchDirectory(
  branches: EaBranchDirectoryEntry[],
  query: string,
  minimumLength = 2
): EaBranchDirectoryEntry[] {
  const trimmedQuery = query
    .trim()
    .toLowerCase();

  if (
    trimmedQuery.length < minimumLength
  ) {
    return [];
  }

  const terms = trimmedQuery
    .split(/\s+/)
    .filter(Boolean);

  return branches.filter((entry) => {
    const haystack = [
      entry.company_name,
      entry.branch_name,
      entry.town_or_city,
      entry.postcode,
    ]
      .join(" ")
      .toLowerCase();

    return terms.every((term) =>
      haystack.includes(term)
    );
  });
}

export async function searchEaBranchDirectory(
  supabase: SupabaseClient,
  query: string
): Promise<EaBranchDirectoryEntry[]> {
  const { branches, error } =
    await loadEaBranchDirectory(supabase);

  if (error) {
    return [];
  }

  return filterEaBranchDirectory(
    branches,
    query
  );
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

async function callAssignmentRpc(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>
): Promise<{ assignmentId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    return {
      assignmentId: null,
      error: formatPropertyEaAssignmentError(null),
    };
  }

  const result = data as AssignmentRpcResult | null;

  if (!result?.ok) {
    return {
      assignmentId: null,
      error: formatPropertyEaAssignmentError(result?.error),
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
    }
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

  const { data: branch } = await supabase
    .from("ea_branch_directory")
    .select("*")
    .eq("branch_id", assignment.branch_id)
    .maybeSingle();

  return {
    assignment,
    branch:
      (branch as EaBranchDirectoryEntry | null) ??
      null,
  };
}
