import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

import { isEstateAgentOnboardingComplete } from "@/lib/accountType";
import { fetchAuthenticatedProfileAccountFields } from "@/lib/currentUserContext";

export type AuthorisedBranchContext = {
  user: User;
  branchId: string;
  companyId: string;
  companyName: string;
  companyStripeCustomerId: string | null;
  memberRole: "branch_admin" | "agent";
  isOwner: boolean;
};

/**
 * Resolve branch ownership for billing mutations.
 * Requires authenticated estate agent Owner (branch_admin) of the target branch.
 */
export async function requireEaBranchBillingOwner(
  supabase: SupabaseClient,
  user: User,
  branchId: string
): Promise<
  | { ok: true; context: AuthorisedBranchContext }
  | { ok: false; error: string; status: number }
> {
  if (!branchId) {
    return { ok: false, error: "branch_required", status: 400 };
  }

  const profile = await fetchAuthenticatedProfileAccountFields(
    supabase,
    user.id
  );
  if (!profile || !isEstateAgentOnboardingComplete(profile)) {
    return { ok: false, error: "estate_agent_required", status: 403 };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("ea_branch_members")
    .select("role, branch_id")
    .eq("user_id", user.id)
    .eq("branch_id", branchId)
    .maybeSingle();

  if (membershipError || !membership) {
    return { ok: false, error: "not_branch_member", status: 403 };
  }

  if (membership.role !== "branch_admin") {
    return { ok: false, error: "not_branch_admin", status: 403 };
  }

  const { data: branch, error: branchError } = await supabase
    .from("ea_branches")
    .select("id, company_id")
    .eq("id", branchId)
    .maybeSingle();

  if (branchError || !branch) {
    return { ok: false, error: "branch_not_found", status: 404 };
  }

  const { data: company, error: companyError } = await supabase
    .from("ea_companies")
    .select("id, name, stripe_customer_id")
    .eq("id", branch.company_id)
    .maybeSingle();

  if (companyError || !company) {
    return { ok: false, error: "company_not_found", status: 404 };
  }

  return {
    ok: true,
    context: {
      user,
      branchId: branch.id as string,
      companyId: company.id as string,
      companyName: company.name as string,
      companyStripeCustomerId:
        (company.stripe_customer_id as string | null) ?? null,
      memberRole: "branch_admin",
      isOwner: true,
    },
  };
}

/** Portal/read: any branch member may open portal for their company customer. */
export async function requireEaBranchBillingMember(
  supabase: SupabaseClient,
  user: User,
  branchId: string
): Promise<
  | { ok: true; context: AuthorisedBranchContext }
  | { ok: false; error: string; status: number }
> {
  if (!branchId) {
    return { ok: false, error: "branch_required", status: 400 };
  }

  const profile = await fetchAuthenticatedProfileAccountFields(
    supabase,
    user.id
  );
  if (!profile || !isEstateAgentOnboardingComplete(profile)) {
    return { ok: false, error: "estate_agent_required", status: 403 };
  }

  const { data: membership } = await supabase
    .from("ea_branch_members")
    .select("role, branch_id")
    .eq("user_id", user.id)
    .eq("branch_id", branchId)
    .maybeSingle();

  if (!membership) {
    return { ok: false, error: "not_branch_member", status: 403 };
  }

  const { data: branch } = await supabase
    .from("ea_branches")
    .select("id, company_id")
    .eq("id", branchId)
    .maybeSingle();

  if (!branch) {
    return { ok: false, error: "branch_not_found", status: 404 };
  }

  const { data: company } = await supabase
    .from("ea_companies")
    .select("id, name, stripe_customer_id")
    .eq("id", branch.company_id)
    .maybeSingle();

  if (!company) {
    return { ok: false, error: "company_not_found", status: 404 };
  }

  return {
    ok: true,
    context: {
      user,
      branchId: branch.id as string,
      companyId: company.id as string,
      companyName: company.name as string,
      companyStripeCustomerId:
        (company.stripe_customer_id as string | null) ?? null,
      memberRole: membership.role as "branch_admin" | "agent",
      isOwner: membership.role === "branch_admin",
    },
  };
}
