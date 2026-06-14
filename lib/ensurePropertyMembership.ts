import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export type PropertyMemberRole =
  | "seller"
  | "buyer"
  | "participant"
  | string;

/**
 * Idempotent membership for the authenticated user.
 * Requires migration 20260610215000 (unique constraint + ensure_property_membership RPC).
 */
export async function ensurePropertyMembership(
  supabase: SupabaseClient,
  params: {
    propertyId: number;
    role: PropertyMemberRole;
  }
): Promise<{ error: PostgrestError | null }> {
  const { error } = await supabase.rpc(
    "ensure_property_membership",
    {
      p_property_id: params.propertyId,
      p_role: params.role,
    }
  );

  return { error };
}
