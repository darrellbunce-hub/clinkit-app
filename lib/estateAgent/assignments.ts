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
  assignedByUserId: string;
};

export async function assignPropertyToBranch(
  supabase: SupabaseClient,
  input: AssignPropertyToBranchInput
): Promise<{ error: string | null }> {
  const existingAssignment =
    await loadPropertyEaAssignment(
      supabase,
      input.propertyId
    );

  if (
    existingAssignment &&
    existingAssignment.branch_id ===
      input.branchId &&
    existingAssignment.homeowner_only_updates ===
      input.homeownerOnlyUpdates
  ) {
    return { error: null };
  }

  if (existingAssignment) {
    const { error: revokeError } =
      await supabase
        .from("property_ea_assignments")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingAssignment.id);

    if (revokeError) {
      return { error: revokeError.message };
    }
  }

  const { error: insertError } = await supabase
    .from("property_ea_assignments")
    .insert({
      property_id: input.propertyId,
      branch_id: input.branchId,
      status: "active",
      homeowner_only_updates:
        input.homeownerOnlyUpdates,
      assigned_by_user_id:
        input.assignedByUserId,
    });

  if (insertError) {
    return { error: insertError.message };
  }

  return { error: null };
}

export async function updatePropertyEaDelegation(
  supabase: SupabaseClient,
  assignmentId: string,
  homeownerOnlyUpdates: boolean
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("property_ea_assignments")
    .update({
      homeowner_only_updates:
        homeownerOnlyUpdates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assignmentId)
    .eq("status", "active");

  if (error) {
    return { error: error.message };
  }

  return { error: null };
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
