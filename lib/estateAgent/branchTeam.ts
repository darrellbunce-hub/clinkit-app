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
  canTransferOwnership: boolean;
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

/** Invitations always create Staff (`agent`) access. Owner is assigned only via transfer. */
export type EaBranchInviteRoleOption = "staff";

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
  can_transfer_ownership?: boolean;
};

export type EaBranchOwnershipOutgoingAction =
  | "remain_staff"
  | "leave_branch";

export function mapInviteRoleOptionToDbRole(
  role: EaBranchInviteRoleOption = "staff"
): EaBranchMemberRole {
  void role;
  return "agent";
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
      p_invite_role: "agent",
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

export async function transferEaBranchOwnership(
  supabase: SupabaseClient,
  input: {
    branchId: string;
    newOwnerMemberId: string;
    outgoingAction: EaBranchOwnershipOutgoingAction;
  }
): Promise<
  | {
      ok: true;
      newOwnerUserId: string;
      outgoingAction: EaBranchOwnershipOutgoingAction;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc(
    "transfer_ea_branch_ownership",
    {
      p_branch_id: input.branchId,
      p_new_owner_member_id: input.newOwnerMemberId,
      p_outgoing_action: input.outgoingAction,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as RpcResult & {
    new_owner_user_id?: string;
    outgoing_action?: EaBranchOwnershipOutgoingAction;
  } | null;

  if (
    !result?.ok ||
    !result.new_owner_user_id ||
    !result.outgoing_action
  ) {
    return {
      ok: false,
      error: result?.error ?? "transfer_failed",
    };
  }

  return {
    ok: true,
    newOwnerUserId: result.new_owner_user_id,
    outgoingAction: result.outgoing_action,
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
      canTransferOwnership:
        result.can_transfer_ownership === true,
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
      case "owner_invitation_not_allowed":
        return "New team invitations can only add Staff. Transfer ownership to assign a new Owner.";
      case "target_must_be_staff":
        return "Ownership can only be transferred to an active Staff member.";
      case "target_not_found":
        return "The selected team member could not be found.";
      case "cannot_transfer_to_self":
        return "You cannot transfer ownership to yourself.";
      case "owner_invariant_violation":
        return "This branch does not have a valid Owner record. Contact support.";
      case "invalid_outgoing_action":
        return "Choose what should happen to your branch access after transfer.";
      case "transfer_failed":
        return "Ownership could not be transferred. Try again.";
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
