import type { SupabaseClient } from "@supabase/supabase-js";

import type { EstateAgentInvitationEmailParams } from "@/lib/communications/types";

export async function loadEaBranchInvitationEmailContext(
  supabase: SupabaseClient,
  invitationId: string,
  invitationLink: string
): Promise<EstateAgentInvitationEmailParams | null> {
  const { data, error } = await supabase
    .from("ea_branch_invitations")
    .select(
      `
      invite_email,
      invite_name,
      branch:ea_branches (
        name,
        company:ea_companies (
          name
        )
      )
    `
    )
    .eq("id", invitationId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const branch = Array.isArray(data.branch)
    ? data.branch[0]
    : data.branch;

  const company = Array.isArray(branch?.company)
    ? branch.company[0]
    : branch?.company;

  if (
    !data.invite_email ||
    !data.invite_name ||
    !branch?.name ||
    !company?.name
  ) {
    return null;
  }

  return {
    to: data.invite_email,
    agentName: data.invite_name,
    branchName: branch.name,
    companyName: company.name,
    invitationLink,
  };
}
