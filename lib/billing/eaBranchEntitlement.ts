/**
 * Central EA branch entitlement abstraction — Billing Stage 1.
 *
 * Stage 1 contract:
 * - Provides a single place for membership + commercial entitlement checks.
 * - DOES NOT enforce paid access yet (enforcementEnabled === false).
 * - mayAccessPaidFeatures === isBranchMember while enforcement is off.
 *
 * Stage 2+ will set enforcementEnabled true and require commercial entitlement
 * for Command Centre / origination / paid operational surfaces.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isCommerciallyEntitledStatus,
  type EaBranchSubscriptionSummary,
  type EaEntitlementStatus,
} from "@/lib/billing/eaBranchSubscription";

/** Flip only when Billing Stage 3 entitlement wiring is approved. */
export const EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED = false;

export type EaBranchEntitlementResult = {
  branchId: string;
  userId: string | null;
  isBranchMember: boolean;
  entitlementStatus: EaEntitlementStatus;
  isCommerciallyEntitled: boolean;
  enforcementEnabled: boolean;
  /**
   * Whether paid EA functionality may proceed.
   * Stage 1: membership only (enforcement off).
   * Stage 2+: membership AND commercial entitlement when enforcement on.
   */
  mayAccessPaidFeatures: boolean;
  summary: EaBranchSubscriptionSummary | null;
};

export async function getEaBranchEntitlement(
  client: SupabaseClient,
  branchId: string,
  userId: string | null
): Promise<EaBranchEntitlementResult> {
  if (!userId) {
    return {
      branchId,
      userId: null,
      isBranchMember: false,
      entitlementStatus: "none",
      isCommerciallyEntitled: false,
      enforcementEnabled: EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED,
      mayAccessPaidFeatures: false,
      summary: null,
    };
  }

  const { data: membership } = await client
    .from("ea_branch_members")
    .select("id")
    .eq("branch_id", branchId)
    .eq("user_id", userId)
    .maybeSingle();

  const isBranchMember = !!membership?.id;

  let summary: EaBranchSubscriptionSummary | null = null;
  let entitlementStatus: EaEntitlementStatus = "none";

  if (isBranchMember) {
    const { data } = await client.rpc("get_ea_branch_subscription_summary", {
      p_branch_id: branchId,
    });
    summary = (data as EaBranchSubscriptionSummary | null) ?? null;
    if (summary?.ok && summary.entitlement_status) {
      entitlementStatus = summary.entitlement_status;
    }
  }

  const commerciallyEntitled = isCommerciallyEntitledStatus(entitlementStatus);
  const enforcementEnabled = EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED;

  return {
    branchId,
    userId,
    isBranchMember,
    entitlementStatus,
    isCommerciallyEntitled: commerciallyEntitled,
    enforcementEnabled,
    mayAccessPaidFeatures: enforcementEnabled
      ? isBranchMember && commerciallyEntitled
      : isBranchMember,
    summary,
  };
}
