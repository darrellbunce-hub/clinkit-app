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

  if (membershipError || !membership) {
    return null;
  }

  const { data: branch, error: branchError } =
    await supabase
      .from("ea_branches")
      .select("*")
      .eq("id", membership.branch_id)
      .maybeSingle();

  if (branchError || !branch) {
    return null;
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
