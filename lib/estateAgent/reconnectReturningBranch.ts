import type { SupabaseClient } from "@supabase/supabase-js";

export type ReconnectReturningBranchResult =
  | { ok: true; assignmentId: string | null }
  | { ok: false; error: string };

export function formatReconnectReturningBranchError(
  code: string | null | undefined
): string {
  switch (code) {
    case "not_authenticated":
      return "You must be signed in.";
    case "email_verification_required":
      return "Verify your email address before reconnecting.";
    case "not_ea_branch_member":
      return "You are not a member of that branch.";
    case "rate_limited":
      return "Too many attempts. Please try again later.";
    default:
      return "This branch cannot reconnect to this property.";
  }
}

/**
 * A branch whose assignment ended only because the homeowner's departure
 * cascaded to it reconnects to the still-unrepresented property. All other
 * refusals are deliberately generic (reconnect_returning_ea_branch).
 */
export async function reconnectReturningBranch(
  supabase: SupabaseClient,
  params: { propertyId: number; branchId: string }
): Promise<ReconnectReturningBranchResult> {
  const { data, error } = await supabase.rpc(
    "reconnect_returning_ea_branch",
    {
      p_property_id: params.propertyId,
      p_branch_id: params.branchId,
    }
  );

  if (error) {
    return { ok: false, error: formatReconnectReturningBranchError(null) };
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    assignment_id?: string | null;
  } | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: formatReconnectReturningBranchError(result?.error),
    };
  }

  return { ok: true, assignmentId: result.assignment_id ?? null };
}

export type ReconnectableProperty = {
  propertyId: number;
  branchId: string;
  branchName: string;
  address: string;
  postcode: string;
  assignmentEndedAt: string | null;
};

export type ListReconnectablePropertiesResult =
  | { ok: true; properties: ReconnectableProperty[] }
  | { ok: false; error: string };

/**
 * The caller's own branches' properties that reconnectReturningBranch would
 * currently accept. Display only: it grants nothing, and the reconnect RPC
 * re-checks every condition (list_reconnectable_ea_properties).
 */
export async function listReconnectableProperties(
  supabase: SupabaseClient
): Promise<ListReconnectablePropertiesResult> {
  const { data, error } = await supabase.rpc(
    "list_reconnectable_ea_properties"
  );

  if (error) {
    return { ok: false, error: "Could not load properties to reconnect." };
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    properties?: Array<{
      property_id?: number;
      branch_id?: string;
      branch_name?: string | null;
      address?: string | null;
      postcode?: string | null;
      assignment_ended_at?: string | null;
    }>;
  } | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: formatReconnectReturningBranchError(result?.error),
    };
  }

  const properties: ReconnectableProperty[] = [];

  for (const row of result.properties ?? []) {
    if (typeof row.property_id !== "number" || typeof row.branch_id !== "string") {
      continue;
    }

    properties.push({
      propertyId: row.property_id,
      branchId: row.branch_id,
      branchName: row.branch_name ?? "",
      address: row.address ?? "",
      postcode: row.postcode ?? "",
      assignmentEndedAt: row.assignment_ended_at ?? null,
    });
  }

  return { ok: true, properties };
}
