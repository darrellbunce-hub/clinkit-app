"use client";

import { useCallback, useEffect, useState } from "react";

import InviteTeamMemberDialog from "@/components/account/InviteTeamMemberDialog";
import {
  accountAlertErrorClassName,
  accountSectionClassName,
} from "@/components/account/accountStyles";
import {
  formatEaBranchMemberRoleLabel,
  formatEaBranchMemberStatusLabel,
  getEaBranchMemberStatusClasses,
} from "@/lib/estateAgent/branchTeamPresentation";
import {
  formatEaBranchInvitationError,
  formatEaBranchTeamLoadError,
  loadEaBranchTeamDirectory,
  removeEaBranchMember,
  revokeEaBranchInvitation,
  type EaBranchTeamDirectory,
} from "@/lib/estateAgent/branchTeam";
import { loadAgentHomeContext } from "@/lib/estateAgent/loadAgentHomeContext";
import { BTN_PRIMARY_SM_CLASS, BTN_SECONDARY_OUTLINE_SM_CLASS } from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

type TeamMembersSectionProps = {
  userId: string;
};

export default function TeamMembersSection({
  userId,
}: TeamMembersSectionProps) {
  const [directory, setDirectory] =
    useState<EaBranchTeamDirectory | null>(null);
  const [branchId, setBranchId] = useState<string | null>(
    null
  );
  const [companyName, setCompanyName] = useState<
    string | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isInviteOpen, setIsInviteOpen] =
    useState(false);
  const [pendingActionId, setPendingActionId] =
    useState<string | null>(null);

  const reloadDirectory = useCallback(async () => {
    setErrorMessage("");

    const context = await loadAgentHomeContext(
      supabase,
      userId
    );

    if (!context) {
      setDirectory(null);
      setBranchId(null);
      setCompanyName(null);
      setErrorMessage(
        formatEaBranchTeamLoadError({
          stage: "context",
          error: "branch_context_unavailable",
        })
      );
      setIsLoading(false);
      return;
    }

    setBranchId(context.branch.id);
    setCompanyName(context.company.name);

    const result = await loadEaBranchTeamDirectory(
      supabase,
      context.branch.id
    );

    if (!result.ok) {
      setDirectory(null);
      setErrorMessage(
        formatEaBranchTeamLoadError({
          stage: "directory",
          error: result.error,
          supabaseMessage: result.supabaseMessage,
        })
      );
      setIsLoading(false);
      return;
    }

    setDirectory(result.directory);
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    void reloadDirectory();
  }, [reloadDirectory]);

  async function handleRevokeInvitation(
    invitationId: string
  ) {
    setPendingActionId(invitationId);

    const result = await revokeEaBranchInvitation(
      supabase,
      invitationId
    );

    setPendingActionId(null);

    if (!result.ok) {
      setErrorMessage(
        formatEaBranchInvitationError(
          result.error ?? "revoke_failed"
        )
      );
      return;
    }

    await reloadDirectory();
  }

  async function handleRemoveMember(memberId: string) {
    setPendingActionId(memberId);

    const result = await removeEaBranchMember(
      supabase,
      memberId
    );

    setPendingActionId(null);

    if (!result.ok) {
      setErrorMessage(
        formatEaBranchInvitationError(
          result.error ?? "remove_failed"
        )
      );
      return;
    }

    await reloadDirectory();
  }

  return (
    <section
      id="team"
      className={accountSectionClassName}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Team Members
          </h2>

          <p className="mt-2 text-sm text-slate-600">
            {companyName
              ? `Everyone at ${companyName} shares the same operational dashboard.`
              : "Manage who can access your branch workspace."}
          </p>
        </div>

        {directory?.canManageTeam ? (
          <button
            type="button"
            onClick={() => setIsInviteOpen(true)}
            className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold ${BTN_PRIMARY_SM_CLASS}`}
          >
            Invite Team Member
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-slate-600">
          Loading team members...
        </p>
      ) : errorMessage ? (
        <p
          role="alert"
          className={`mt-6 ${accountAlertErrorClassName}`}
        >
          {errorMessage}
        </p>
      ) : directory ? (
        <div className="mt-6 space-y-3">
          {[
            ...directory.members.map((member) => ({
              key: member.member_id,
              name: member.contact_name,
              email: member.email,
              role: formatEaBranchMemberRoleLabel(
                member.role
              ),
              status: "active" as const,
              action:
                directory.canManageTeam &&
                member.role === "agent" ? (
                  <button
                    type="button"
                    disabled={
                      pendingActionId ===
                      member.member_id
                    }
                    onClick={() =>
                      void handleRemoveMember(
                        member.member_id
                      )
                    }
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
                  >
                    {pendingActionId ===
                    member.member_id
                      ? "Removing..."
                      : "Remove"}
                  </button>
                ) : null,
            })),
            ...directory.pendingInvitations.map(
              (invitation) => ({
                key: invitation.invitation_id,
                name: invitation.invite_name,
                email: invitation.invite_email,
                role: formatEaBranchMemberRoleLabel(
                  invitation.invite_role
                ),
                status: invitation.status,
                action:
                  directory.canManageTeam &&
                  invitation.status === "pending" ? (
                    <button
                      type="button"
                      disabled={
                        pendingActionId ===
                        invitation.invitation_id
                      }
                      onClick={() =>
                        void handleRevokeInvitation(
                          invitation.invitation_id
                        )
                      }
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
                    >
                      {pendingActionId ===
                      invitation.invitation_id
                        ? "Revoking..."
                        : "Revoke"}
                    </button>
                  ) : null,
              })
            ),
          ].map((row) => (
            <div
              key={row.key}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">
                  {row.name}
                </p>

                <p className="mt-1 text-sm text-slate-600 break-words">
                  {row.email}
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  {row.role}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${getEaBranchMemberStatusClasses(row.status)}`}
                >
                  {formatEaBranchMemberStatusLabel(
                    row.status
                  )}
                </span>

                {row.action}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {branchId ? (
        <InviteTeamMemberDialog
          branchId={branchId}
          isOpen={isInviteOpen}
          onClose={() => setIsInviteOpen(false)}
          onInvited={reloadDirectory}
        />
      ) : null}
    </section>
  );
}
