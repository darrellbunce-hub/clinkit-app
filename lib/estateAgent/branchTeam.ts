import type { SupabaseClient } from "@supabase/supabase-js";

import { ROUTES } from "@/lib/auth/routes";
import type { EaBranchMemberRole } from "@/lib/estateAgent/types";

export type EaBranchTeamMemberStatus = "active";

export type EaBranchTeamInvitationStatus =
  | "pending"
  | "expired";

export type EaBranchTeamMemberRow = {
  member_id: string;
  user_id: string;
  contact_name: string;
  email: string;
  role: EaBranchMemberRole;
  status: EaBranchTeamMemberStatus;
  joined_at: string;
};

export type EaBranchTeamPendingInvitationRow = {
  invitation_id: string;
  invite_name: string;
  invite_email: string;
  invite_role: EaBranchMemberRole;
  status: EaBranchTeamInvitationStatus;
  expires_at: string;
  sent_at: string | null;
  created_at: string;
};

export type EaBranchTeamDirectory = {
  members: EaBranchTeamMemberRow[];
  pendingInvitations: EaBranchTeamPendingInvitationRow[];
  canManageTeam: boolean;
};

export type EaBranchInvitationPreview = {
  invitationId: string;
  inviteName: string;
  inviteEmail: string;
  inviteRole: EaBranchMemberRole;
  branchName: string;
  companyName: string;
  expiresAt: string;
};

export type EaBranchInviteRoleOption = "owner" | "staff";

type RpcResult = {
  ok?: boolean;
  error?: string;
};

type CreateInvitationRpc = RpcResult & {
  invitation_id?: string;
  token?: string;
  expires_at?: string;
};

type PreviewInvitationRpc = RpcResult & {
  invitation_id?: string;
  invite_name?: string;
  invite_email?: string;
  invite_role?: EaBranchMemberRole;
  branch_name?: string;
  company_name?: string;
  expires_at?: string;
};

type TeamDirectoryRpc = RpcResult & {
  members?: EaBranchTeamMemberRow[];
  pending_invitations?: EaBranchTeamPendingInvitationRow[];
  can_manage_team?: boolean;
};

export function mapInviteRoleOptionToDbRole(
  role: EaBranchInviteRoleOption
): EaBranchMemberRole {
  return role === "owner" ? "branch_admin" : "agent";
}

export function buildEaBranchInvitationUrl(
  token: string,
  origin = typeof window !== "undefined"
    ? window.location.origin
    : ""
): string {
  const url = new URL(
    ROUTES.estateAgentJoin,
    origin || "http://localhost"
  );
  url.searchParams.set("token", token);
  return url.toString();
}

export async function previewEaBranchInvitation(
  supabase: SupabaseClient,
  token: string
): Promise<
  | { ok: true; preview: EaBranchInvitationPreview }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc(
    "preview_ea_branch_invitation",
    { p_token: token }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as PreviewInvitationRpc | null;

  if (
    !result?.ok ||
    !result.invitation_id ||
    !result.invite_email ||
    !result.invite_name ||
    !result.invite_role ||
    !result.branch_name ||
    !result.company_name ||
    !result.expires_at
  ) {
    return {
      ok: false,
      error: result?.error ?? "preview_unavailable",
    };
  }

  return {
    ok: true,
    preview: {
      invitationId: result.invitation_id,
      inviteName: result.invite_name,
      inviteEmail: result.invite_email,
      inviteRole: result.invite_role,
      branchName: result.branch_name,
      companyName: result.company_name,
      expiresAt: result.expires_at,
    },
  };
}

export async function createEaBranchInvitation(
  supabase: SupabaseClient,
  input: {
    branchId: string;
    inviteEmail: string;
    inviteName: string;
    role: EaBranchInviteRoleOption;
  }
): Promise<
  | {
      ok: true;
      invitationId: string;
      token: string;
      expiresAt: string;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc(
    "create_ea_branch_invitation",
    {
      p_branch_id: input.branchId,
      p_invite_email: input.inviteEmail.trim(),
      p_invite_name: input.inviteName.trim(),
      p_invite_role: mapInviteRoleOptionToDbRole(
        input.role
      ),
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as CreateInvitationRpc | null;

  if (
    !result?.ok ||
    !result.invitation_id ||
    !result.token ||
    !result.expires_at
  ) {
    return {
      ok: false,
      error: result?.error ?? "invitation_create_failed",
    };
  }

  return {
    ok: true,
    invitationId: result.invitation_id,
    token: result.token,
    expiresAt: result.expires_at,
  };
}

export async function recordEaBranchInvitationSent(
  supabase: SupabaseClient,
  invitationId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc(
    "record_ea_branch_invitation_sent",
    { p_invitation_id: invitationId }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as RpcResult | null;

  return {
    ok: result?.ok === true,
    error: result?.error,
  };
}

export async function acceptEaBranchInvitation(
  supabase: SupabaseClient,
  token: string
): Promise<
  | { ok: true; branchId: string }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc(
    "accept_ea_branch_invitation",
    { p_token: token }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as RpcResult & {
    branch_id?: string;
  } | null;

  if (!result?.ok || !result.branch_id) {
    return {
      ok: false,
      error: result?.error ?? "accept_failed",
    };
  }

  return {
    ok: true,
    branchId: result.branch_id,
  };
}

export async function revokeEaBranchInvitation(
  supabase: SupabaseClient,
  invitationId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc(
    "revoke_ea_branch_invitation",
    { p_invitation_id: invitationId }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as RpcResult | null;

  return {
    ok: result?.ok === true,
    error: result?.error,
  };
}

export async function removeEaBranchMember(
  supabase: SupabaseClient,
  memberId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc(
    "remove_ea_branch_member",
    { p_member_id: memberId }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as RpcResult | null;

  return {
    ok: result?.ok === true,
    error: result?.error,
  };
}

export async function loadEaBranchTeamDirectory(
  supabase: SupabaseClient,
  branchId: string
): Promise<
  | { ok: true; directory: EaBranchTeamDirectory }
  | {
      ok: false;
      error: string;
      supabaseMessage?: string;
    }
> {
  const { data, error } = await supabase.rpc(
    "get_ea_branch_team_directory",
    { p_branch_id: branchId }
  );

  if (error) {
    return {
      ok: false,
      error: "team_directory_rpc_failed",
      supabaseMessage: error.message,
    };
  }

  const result = data as TeamDirectoryRpc | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "team_directory_unavailable",
    };
  }

  return {
    ok: true,
    directory: {
      members: result.members ?? [],
      pendingInvitations:
        result.pending_invitations ?? [],
      canManageTeam: result.can_manage_team === true,
    },
  };
}

export function formatEaBranchInvitationError(
  error: string,
  options?: {
    includeTechnicalDetail?: boolean;
  }
): string {
  const friendlyMessage = (() => {
    switch (error) {
      case "not_branch_admin":
        return "Only branch owners can manage team invitations.";
      case "not_branch_member":
        return "Your account is not linked to this branch yet. Ask your branch owner or support to restore branch membership.";
      case "team_directory_unavailable":
        return "The team directory could not be loaded.";
      case "team_directory_rpc_failed":
        return "The team directory request failed.";
      case "cannot_invite_self":
        return "You cannot invite yourself.";
      case "already_branch_member":
        return "This person already belongs to a branch.";
      case "invitation_already_active":
        return "An active invitation already exists for this email.";
      case "invalid_email":
        return "Enter a valid email address.";
      case "invalid_name":
        return "Enter the team member's name.";
      case "invitation_expired":
        return "This invitation has expired. Ask your branch owner to send a new one.";
      case "invitation_revoked":
        return "This invitation is no longer active.";
      case "invitation_already_accepted":
        return "This invitation has already been accepted.";
      case "invitation_not_found":
        return "We could not find this invitation.";
      case "email_mismatch":
        return "Sign in with the email address that received this invitation.";
      case "estate_agent_account_required":
        return "Create an estate agent account before accepting this invitation.";
      case "authentication_required":
        return "Sign in to accept this invitation.";
      case "cannot_remove_self":
        return "You cannot remove yourself from the branch.";
      case "cannot_remove_owner":
        return "Branch owners cannot be removed.";
      default:
        return null;
    }
  })();

  const shouldShowTechnicalDetail =
    options?.includeTechnicalDetail ??
    process.env.NODE_ENV === "development";

  if (friendlyMessage) {
    if (shouldShowTechnicalDetail) {
      return `${friendlyMessage} (${error})`;
    }

    return friendlyMessage;
  }

  if (shouldShowTechnicalDetail) {
    return error;
  }

  return "Something went wrong. Try again.";
}

export function formatEaBranchTeamLoadError(params: {
  stage: "context" | "directory";
  error: string;
  supabaseMessage?: string;
}): string {
  const shouldShowTechnicalDetail =
    process.env.NODE_ENV === "development";

  if (params.stage === "context") {
    const base =
      "We could not load your branch team details.";

    if (!shouldShowTechnicalDetail) {
      return base;
    }

    return `${base} (${params.error}${
      params.supabaseMessage
        ? `: ${params.supabaseMessage}`
        : ""
    })`;
  }

  return formatEaBranchInvitationError(params.error, {
    includeTechnicalDetail: shouldShowTechnicalDetail,
  }) + (
    shouldShowTechnicalDetail && params.supabaseMessage
      ? ` [${params.supabaseMessage}]`
      : ""
  );
}
