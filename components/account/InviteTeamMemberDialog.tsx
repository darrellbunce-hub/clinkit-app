"use client";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import {
  accountAlertErrorClassName,
  accountAlertSuccessClassName,
  accountButtonPrimaryClassName,
  accountInputClassName,
  accountSectionClassName,
} from "@/components/account/accountStyles";
import {
  createEaBranchInvitation,
  formatEaBranchInvitationError,
} from "@/lib/estateAgent/branchTeam";
import { BTN_SECONDARY_OUTLINE_SM_CLASS } from "@/lib/theme/themeTokens";

type InviteTeamMemberDialogProps = {
  branchId: string;
  isOpen: boolean;
  onClose: () => void;
  onInvited: () => void | Promise<void>;
};

export default function InviteTeamMemberDialog({
  branchId,
  isOpen,
  onClose,
  onInvited,
}: InviteTeamMemberDialogProps) {
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [errorMessage, setErrorMessage] =
    useState("");
  const [successMessage, setSuccessMessage] =
    useState("");
  const [isSubmitting, setIsSubmitting] =
    useState(false);

  useEffect(() => {
    if (!isOpen) {
      setInviteName("");
      setInviteEmail("");
      setErrorMessage("");
      setSuccessMessage("");
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      const { supabase } = await import("@/lib/supabase");
      const invitationResult =
        await createEaBranchInvitation(supabase, {
          branchId,
          inviteEmail,
          inviteName,
        });

      if (!invitationResult.ok) {
        setErrorMessage(
          formatEaBranchInvitationError(
            invitationResult.error
          )
        );
        return;
      }

      const emailResponse = await fetch(
        "/api/communications/estate-agent-invitation",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            invitationId: invitationResult.invitationId,
            invitationToken: invitationResult.token,
          }),
        }
      );

      const emailResult = await emailResponse.json();

      if (!emailResult.ok) {
        setErrorMessage(
          "Invitation was created but the email could not be sent. Try again from Team Members."
        );
        return;
      }

      setSuccessMessage(
        emailResult.sent
          ? `Invitation sent to ${inviteEmail.trim().toLowerCase()}. They will join as Staff.`
          : "Invitation created as Staff. Email sending is disabled in this environment."
      );

      await onInvited();
    } catch {
      setErrorMessage(
        "Could not send the invitation. Try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-team-member-title"
        className={`w-full max-w-lg ${accountSectionClassName}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3
              id="invite-team-member-title"
              className="text-xl font-bold text-slate-900"
            >
              Invite Team Member
            </h3>

            <p className="mt-2 text-sm text-slate-600">
              They will join your branch as Staff and share the
              operational dashboard. To assign a new Owner, use
              Transfer Ownership instead.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
          >
            Close
          </button>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="mt-6 space-y-5"
          noValidate
        >
          <div>
            <label
              htmlFor="invite-name"
              className="block text-sm font-medium text-slate-700"
            >
              Name
            </label>

            <input
              id="invite-name"
              name="inviteName"
              type="text"
              autoComplete="name"
              value={inviteName}
              onChange={(event) =>
                setInviteName(event.target.value)
              }
              disabled={isSubmitting}
              className={accountInputClassName}
            />
          </div>

          <div>
            <label
              htmlFor="invite-email"
              className="block text-sm font-medium text-slate-700"
            >
              Email
            </label>

            <input
              id="invite-email"
              name="inviteEmail"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={inviteEmail}
              onChange={(event) =>
                setInviteEmail(event.target.value)
              }
              disabled={isSubmitting}
              className={accountInputClassName}
            />
          </div>

          {errorMessage ? (
            <p
              role="alert"
              className={accountAlertErrorClassName}
            >
              {errorMessage}
            </p>
          ) : null}

          {successMessage ? (
            <p className={accountAlertSuccessClassName}>
              {successMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className={accountButtonPrimaryClassName}
          >
            {isSubmitting
              ? "Sending invitation..."
              : "Send Invitation"}
          </button>
        </form>
      </div>
    </div>
  );
}
