import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountType } from "@/lib/accountType";
import { ROUTES } from "@/lib/auth/routes";
import {
  discoverClaimableProperties,
  hasClaimableProperties,
} from "@/lib/propertyClaim/discoverClaimableProperties";

/**
 * Resolves where a homeowner should land immediately after authentication.
 * Estate agents and other account types are out of scope for this helper.
 */
export async function resolveHomeownerPostAuthDestination(
  supabase: SupabaseClient,
  accountType: AccountType
): Promise<string> {
  if (accountType !== "homeowner") {
    return ROUTES.homeownerDashboard;
  }

  const claimable =
    await discoverClaimableProperties(supabase);

  if (hasClaimableProperties(claimable)) {
    return ROUTES.claimProperty;
  }

  return ROUTES.homeownerDashboard;
}
