import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EaBranch,
  EaCompany,
} from "@/lib/estateAgent/types";

export type AgentHomeContext = {
  contactName: string | null;
  company: EaCompany;
  branch: EaBranch;
};

async function loadFounderBranchContext(
  supabase: SupabaseClient,
  userId: string
): Promise<AgentHomeContext | null> {
  const { data: company, error: companyError } =
    await supabase
      .from("ea_companies")
      .select("*")
      .eq("created_by_user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  if (companyError || !company) {
    return null;
  }

  const { data: branches, error: branchError } =
    await supabase
      .from("ea_branches")
      .select("*")
      .eq("company_id", company.id)
      .order("is_head_office", {
        ascending: false,
      })
      .order("created_at", { ascending: true })
      .limit(1);

  if (branchError || !branches?.length) {
    return null;
  }

  const branch = branches[0] as EaBranch;

  const { data: profile } = await supabase
    .from("profiles")
    .select("contact_name")
    .eq("id", userId)
    .maybeSingle();

  return {
    contactName: profile?.contact_name ?? null,
    company: company as EaCompany,
    branch,
  };
}

export async function loadAgentHomeContext(
  supabase: SupabaseClient,
  userId: string
): Promise<AgentHomeContext | null> {
  const { data: membership, error: membershipError } =
    await supabase
      .from("ea_branch_members")
      .select("branch_id")
      .eq("user_id", userId)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  if (membershipError) {
    return loadFounderBranchContext(supabase, userId);
  }

  if (!membership) {
    return loadFounderBranchContext(supabase, userId);
  }

  const { data: branch, error: branchError } =
    await supabase
      .from("ea_branches")
      .select("*")
      .eq("id", membership.branch_id)
      .maybeSingle();

  if (branchError || !branch) {
    return loadFounderBranchContext(supabase, userId);
  }

  const { data: company, error: companyError } =
    await supabase
      .from("ea_companies")
      .select("*")
      .eq("id", branch.company_id)
      .maybeSingle();

  if (companyError || !company) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("contact_name")
    .eq("id", userId)
    .maybeSingle();

  return {
    contactName: profile?.contact_name ?? null,
    company: company as EaCompany,
    branch: branch as EaBranch,
  };
}
