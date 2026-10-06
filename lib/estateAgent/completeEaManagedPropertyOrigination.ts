import type { SupabaseClient } from "@supabase/supabase-js";

import { finalizeOperationalSaleCreation } from "@/lib/estateAgent/finalizeOperationalSaleCreation";
import type { SellerOnwardPlan } from "@/lib/estateAgent/sellerOnwardPlan";
import { requestOperationalSummaryRefresh } from "@/lib/operationalSummary/requestOperationalSummaryRefresh";
import {
  convertSearchingPlaceholder,
  createSearchingPlaceholderForSale,
} from "@/lib/searchingPlaceholder";

export type CompleteEaManagedPropertyOriginationInput = {
  chainId: number;
  /** Anchor row the branch acts for: a sale, or a purchase it connected to as the seller's EA. */
  salePropertyId: number;
  userId: string;
  branchId: string;
  homeownerOnlyUpdates: boolean;
  onwardPlan: SellerOnwardPlan;
  onwardAddress?: string;
  onwardPostcode?: string;
};

/**
 * The seller's onward purchase is created as the anchor's searching
 * placeholder and converted in place. The branch is never assigned to it;
 * it belongs to the seller once they connect.
 */
export async function completeEaManagedPropertyOrigination(
  supabase: SupabaseClient,
  input: CompleteEaManagedPropertyOriginationInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.onwardPlan === "purchase_agreed") {
    const placeholderResult =
      await createSearchingPlaceholderForSale(supabase, {
        salePropertyId: input.salePropertyId,
      });

    if (!placeholderResult.ok) {
      return placeholderResult;
    }

    const convertResult =
      await convertSearchingPlaceholder(supabase, {
        chainId: input.chainId,
        salePropertyId: input.salePropertyId,
        address: input.onwardAddress ?? "",
        postcode: input.onwardPostcode ?? "",
        updatedBy: "estate_agent",
      });

    if (!convertResult.ok) {
      return {
        ok: false,
        error:
          convertResult.reason === "duplicate_address"
            ? "The onward purchase address is already part of MoveLoop."
            : "Could not create the onward purchase property.",
      };
    }

    await requestOperationalSummaryRefresh(input.chainId);

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
