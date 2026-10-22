import type { SupabaseClient } from "@supabase/supabase-js";

export const BRANCH_ACCESS_ENDED_REASON_CODE = "branch_access_ended";

/** Approved neutral wording (Business Rules 25.27, 25.33): no billing reason, no successor agency, no change to the transaction. */
export const BRANCH_ACCESS_ENDED_NOTICE = {
  title: "Branch Access Ended",
  body: "The estate agent branch that was handling your sale no longer has access to this property. Your property and your place in the chain are unchanged. You can assign an estate agent branch below at any time.",
} as const;

/**
 * True when the most recent branch-related delink event on the property is a
 * Branch Access Ended notice. RLS returns these rows only to the seller-side
 * homeowner and current members of the named branch.
 */
export async function loadBranchAccessEndedNotice(
  supabase: SupabaseClient,
  propertyId: number
): Promise<boolean> {
  const { data, error } = await supabase
    .from("property_delink_events")
    .select("reason_code")
    .eq("property_id", propertyId)
    .not("metadata->>branch_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  return data.reason_code === BRANCH_ACCESS_ENDED_REASON_CODE;
}
