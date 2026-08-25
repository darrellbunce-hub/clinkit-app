"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import InviteTeamMemberDialog from "@/components/account/InviteTeamMemberDialog";
import TeamActionConfirmDialog from "@/components/account/TeamActionConfirmDialog";
import TransferOwnershipDialog from "@/components/account/TransferOwnershipDialog";
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
  type EaBranchTeamMemberRow,
} from "@/lib/estateAgent/branchTeam";
import { loadAgentHomeContext } from "@/lib/estateAgent/loadAgentHomeContext";
import { BTN_PRIMARY_SM_CLASS, BTN_SECONDARY_OUTLINE_SM_CLASS } from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

type TeamMembersSectionProps = {
  userId: string;
};

type PendingConfirmAction =
  | {
      type: "remove_member";
      member: EaBranchTeamMemberRow;
    }
  | {
      type: "revoke_invitation";
      invitationId: string;
      inviteName: string;
      inviteEmail: string;
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
  const [isTransferOpen, setIsTransferOpen] =
    useState(false);
  const [pendingActionId, setPendingActionId] =
    useState<string | null>(null);
  const [confirmAction, setConfirmAction] =
    useState<PendingConfirmAction | null>(null);

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

  const staffMembers = useMemo(
    () =>
      directory?.members.filter(
        (member) => member.role === "agent"
      ) ?? [],
    [directory]
  );

  const confirmCopy = useMemo(() => {
    if (!confirmAction) {
      return null;
    }

    if (confirmAction.type === "remove_member") {
      return {
        title: `Remove access for ${confirmAction.member.contact_name}?`,
        description:
          "This person will no longer be able to access this branch or its properties in Keynetic. Their previous activity may remain in branch history.",
        confirmLabel: "Remove access",
      };
    }

    return {
      title: `Cancel invitation for ${confirmAction.inviteName}?`,
      description: `${confirmAction.inviteEmail} will not be able to join using the current invitation link.`,
      confirmLabel: "Cancel invitation",
    };
  }, [confirmAction]);

  async function handleConfirmAction() {
    if (!confirmAction) {
      return;
    }

    if (confirmAction.type === "remove_member") {
      setPendingActionId(confirmAction.member.member_id);

      const result = await removeEaBranchMember(
        supabase,
        confirmAction.member.member_id
      );

      setPendingActionId(null);
      setConfirmAction(null);

      if (!result.ok) {
        setErrorMessage(
          formatEaBranchInvitationError(
            result.error ?? "remove_failed"
          )
        );
        return;
      }

      await reloadDirectory();
      return;
    }

    setPendingActionId(confirmAction.invitationId);

    const result = await revokeEaBranchInvitation(
      supabase,
      confirmAction.invitationId
    );

    setPendingActionId(null);
    setConfirmAction(null);

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
              ? `Manage who can access ${companyName}'s branch workspace.`
              : "Manage who can access your branch workspace."}
          </p>
        </div>

        {directory?.canManageTeam ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            {directory.canTransferOwnership ? (
              <button
                type="button"
                onClick={() => setIsTransferOpen(true)}
                className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
              >
                Transfer Ownership
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setIsInviteOpen(true)}
              className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold ${BTN_PRIMARY_SM_CLASS}`}
            >
              Invite Team Member
            </button>
          </div>
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
                      setConfirmAction({
                        type: "remove_member",
                        member,
                      })
                    }
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
                  >
                    {pendingActionId ===
                    member.member_id
                      ? "Removing..."
                      : "Remove access"}
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
                        setConfirmAction({
                          type: "revoke_invitation",
                          invitationId:
                            invitation.invitation_id,
                          inviteName:
                            invitation.invite_name,
                          inviteEmail:
                            invitation.invite_email,
                        })
                      }
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
                    >
                      {pendingActionId ===
                      invitation.invitation_id
                        ? "Revoking..."
                        : "Cancel invitation"}
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
        <>
          <InviteTeamMemberDialog
            branchId={branchId}
            isOpen={isInviteOpen}
            onClose={() => setIsInviteOpen(false)}
            onInvited={reloadDirectory}
          />

          <TransferOwnershipDialog
            branchId={branchId}
            staffMembers={staffMembers}
            isOpen={isTransferOpen}
            onClose={() => setIsTransferOpen(false)}
            onTransferred={reloadDirectory}
          />
        </>
      ) : null}

      {confirmCopy ? (
        <TeamActionConfirmDialog
          isOpen={confirmAction !== null}
          title={confirmCopy.title}
          description={confirmCopy.description}
          confirmLabel={confirmCopy.confirmLabel}
          isPending={pendingActionId !== null}
          onCancel={() => setConfirmAction(null)}
          onConfirm={handleConfirmAction}
        />
      ) : null}
    </section>
  );
}
