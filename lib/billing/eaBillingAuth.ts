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
  /**
   * Day 1 authoritative Stripe Customer for this branch
   * (`ea_branches.stripe_customer_id`).
   */
  branchStripeCustomerId: string | null;
  /**
   * Reserved for FUTURE organisation-level billing only.
   * Not used by Day 1 Checkout/Portal.
   */
  companyStripeCustomerId: string | null;
  memberRole: "branch_admin" | "agent";
  isOwner: boolean;
};

type BranchBillingRow = {
  id: string;
  company_id: string;
  stripe_customer_id: string | null;
};

async function loadBranchForBilling(
  supabase: SupabaseClient,
  branchId: string
): Promise<BranchBillingRow | null> {
  const withCustomer = await supabase
    .from("ea_branches")
    .select("id, company_id, stripe_customer_id")
    .eq("id", branchId)
    .maybeSingle();

  if (!withCustomer.error && withCustomer.data) {
    return {
      id: withCustomer.data.id as string,
      company_id: withCustomer.data.company_id as string,
      stripe_customer_id:
        (withCustomer.data.stripe_customer_id as string | null) ?? null,
    };
  }

  // Pre-migration resilience: column may not exist yet on Development.
  const message = withCustomer.error?.message?.toLowerCase() ?? "";
  if (message.includes("stripe_customer_id")) {
    const basic = await supabase
      .from("ea_branches")
      .select("id, company_id")
      .eq("id", branchId)
      .maybeSingle();
    if (!basic.data) return null;
    return {
      id: basic.data.id as string,
      company_id: basic.data.company_id as string,
      stripe_customer_id: null,
    };
  }

  return null;
}

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

  const branch = await loadBranchForBilling(supabase, branchId);
  if (!branch) {
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
      branchId: branch.id,
      companyId: company.id as string,
      companyName: company.name as string,
      branchStripeCustomerId: branch.stripe_customer_id,
      companyStripeCustomerId:
        (company.stripe_customer_id as string | null) ?? null,
      memberRole: "branch_admin",
      isOwner: true,
    },
  };
}

/** Portal/read: branch member context; Portal mutations still require Owner at route. */
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

  const branch = await loadBranchForBilling(supabase, branchId);
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
      branchId: branch.id,
      companyId: company.id as string,
      companyName: company.name as string,
      branchStripeCustomerId: branch.stripe_customer_id,
      companyStripeCustomerId:
        (company.stripe_customer_id as string | null) ?? null,
      memberRole: membership.role as "branch_admin" | "agent",
      isOwner: membership.role === "branch_admin",
    },
  };
}
