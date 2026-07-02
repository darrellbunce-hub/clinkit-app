import type { SupabaseClient } from "@supabase/supabase-js";

import { finalizeOperationalSaleCreation } from "@/lib/estateAgent/finalizeOperationalSaleCreation";
import { createEaOperationalProperty } from "@/lib/estateAgent/originateOperationalProperty";
import type { SellerOnwardPlan } from "@/lib/estateAgent/sellerOnwardPlan";
import { refreshOperationalSummary } from "@/lib/operationalSummary/refreshOperationalSummary";

export type CompleteEaManagedPropertyOriginationInput = {
  chainId: number;
  salePropertyId: number;
  userId: string;
  branchId: string;
  homeownerOnlyUpdates: boolean;
  onwardPlan: SellerOnwardPlan;
  onwardAddress?: string;
  onwardPostcode?: string;
};

export async function completeEaManagedPropertyOrigination(
  supabase: SupabaseClient,
  input: CompleteEaManagedPropertyOriginationInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.onwardPlan === "purchase_agreed") {
    const purchaseResult =
      await createEaOperationalProperty(supabase, {
        chainId: input.chainId,
        relationshipType: "purchase",
        address: input.onwardAddress ?? "",
        postcode: input.onwardPostcode ?? "",
        branchId: input.branchId,
        homeownerOnlyUpdates:
          input.homeownerOnlyUpdates,
        awaitingBuyer: false,
      });

    if (
      purchaseResult.error ||
      purchaseResult.propertyId == null
    ) {
      return {
        ok: false,
        error:
          purchaseResult.error ??
          "Could not create the onward purchase property.",
      };
    }

    const refreshResult =
      await refreshOperationalSummary(supabase, {
        chainId: input.chainId,
      });

    if (!refreshResult.ok) {
      return {
        ok: false,
        error:
          refreshResult.error ??
          "summary_refresh_failed",
      };
    }

    return { ok: true };
  }

  return finalizeOperationalSaleCreation(supabase, {
    chainId: input.chainId,
    salePropertyId: input.salePropertyId,
    userId: input.userId,
    endOfChain: input.onwardPlan === "no_onward",
    refreshSummaries: true,
  });
}
