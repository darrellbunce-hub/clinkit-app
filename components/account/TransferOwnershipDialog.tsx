"use client";

import {
  useState,
  type FormEvent,
} from "react";

import TeamActionConfirmDialog from "@/components/account/TeamActionConfirmDialog";
import {
  accountAlertErrorClassName,
  accountButtonPrimaryClassName,
  accountInputClassName,
  accountSectionClassName,
} from "@/components/account/accountStyles";
import {
  formatEaBranchInvitationError,
  transferEaBranchOwnership,
  type EaBranchOwnershipOutgoingAction,
  type EaBranchTeamMemberRow,
} from "@/lib/estateAgent/branchTeam";
import { BTN_SECONDARY_OUTLINE_SM_CLASS } from "@/lib/theme/themeTokens";

type TransferOwnershipDialogProps = {
  branchId: string;
  staffMembers: EaBranchTeamMemberRow[];
  isOpen: boolean;
  onClose: () => void;
  onTransferred: () => void | Promise<void>;
};

export default function TransferOwnershipDialog({
  branchId,
  staffMembers,
  isOpen,
  onClose,
  onTransferred,
}: TransferOwnershipDialogProps) {
  const [selectedMemberId, setSelectedMemberId] =
    useState("");
  const [outgoingAction, setOutgoingAction] =
    useState<EaBranchOwnershipOutgoingAction>(
      "remain_staff"
    );
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function resetForm() {
    setSelectedMemberId("");
    setOutgoingAction("remain_staff");
    setErrorMessage("");
    setIsSubmitting(false);
    setConfirmOpen(false);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  if (!isOpen) {
    return null;
  }

  const selectedMember = staffMembers.find(
    (member) => member.member_id === selectedMemberId
  );

  const confirmDescription = (() => {
    if (!selectedMember) {
      return "";
    }

    if (outgoingAction === "leave_branch") {
      return `${selectedMember.contact_name} will become the branch Owner and take over team administration. You will lose access to this branch and its Keynetic information once the transfer completes.`;
    }

    return `${selectedMember.contact_name} will become the branch Owner and take over team administration. You will remain in the branch as Staff.`;
  })();

  async function executeTransfer() {
    if (!selectedMemberId) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const { supabase } = await import("@/lib/supabase");
      const result = await transferEaBranchOwnership(
        supabase,
        {
          branchId,
          newOwnerMemberId: selectedMemberId,
          outgoingAction,
        }
      );

      if (!result.ok) {
        setErrorMessage(
          formatEaBranchInvitationError(
            result.error ?? "transfer_failed"
          )
        );
        setConfirmOpen(false);
        return;
      }

      setConfirmOpen(false);
      await onTransferred();
      resetForm();
      onClose();
    } catch {
      setErrorMessage(
        "Could not transfer ownership. Try again."
      );
      setConfirmOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (!selectedMemberId) {
      setErrorMessage("Select a Staff member to become Owner.");
      return;
    }

    setConfirmOpen(true);
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-ownership-title"
          className={`w-full max-w-lg ${accountSectionClassName}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3
                id="transfer-ownership-title"
                className="text-xl font-bold text-slate-900"
              >
                Transfer Ownership
              </h3>

              <p className="mt-2 text-sm text-slate-600">
                Choose a Staff member to become the branch Owner.
                Ownership changes immediately once confirmed.
              </p>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
            >
              Close
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="mt-6 space-y-5"
            noValidate
          >
            <div>
              <label
                htmlFor="transfer-target"
                className="block text-sm font-medium text-slate-700"
              >
                New Owner
              </label>

              <select
                id="transfer-target"
                name="transferTarget"
                value={selectedMemberId}
                onChange={(event) =>
                  setSelectedMemberId(event.target.value)
                }
                disabled={isSubmitting || staffMembers.length === 0}
                className={accountInputClassName}
              >
                <option value="">
                  {staffMembers.length === 0
                    ? "No Staff members available"
                    : "Select a Staff member"}
                </option>
                {staffMembers.map((member) => (
                  <option
                    key={member.member_id}
                    value={member.member_id}
                  >
                    {member.contact_name} ({member.email})
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-slate-700">
                After transfer
              </legend>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <input
                  type="radio"
                  name="outgoingAction"
                  value="remain_staff"
                  checked={outgoingAction === "remain_staff"}
                  onChange={() =>
                    setOutgoingAction("remain_staff")
                  }
                  disabled={isSubmitting}
                  className="mt-1"
                />
                <span className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">
                    Remain in the branch as Staff
                  </span>
                  <span className="mt-1 block text-slate-600">
                    Recommended. You keep branch access without team
                    administration rights.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <input
                  type="radio"
                  name="outgoingAction"
                  value="leave_branch"
                  checked={outgoingAction === "leave_branch"}
                  onChange={() =>
                    setOutgoingAction("leave_branch")
                  }
                  disabled={isSubmitting}
                  className="mt-1"
                />
                <span className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">
                    Transfer ownership and leave the branch
                  </span>
                  <span className="mt-1 block text-slate-600">
                    You will lose access to this branch and its
                    Keynetic information after the transfer succeeds.
                  </span>
                </span>
              </label>
            </fieldset>

            {errorMessage ? (
              <p
                role="alert"
                className={accountAlertErrorClassName}
              >
                {errorMessage}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={
                isSubmitting ||
                staffMembers.length === 0
              }
              className={accountButtonPrimaryClassName}
            >
              Continue
            </button>
          </form>
        </div>
      </div>

      <TeamActionConfirmDialog
        isOpen={confirmOpen}
        title={
          outgoingAction === "leave_branch"
            ? "Transfer ownership and leave?"
            : "Transfer ownership?"
        }
        description={confirmDescription}
        confirmLabel={
          outgoingAction === "leave_branch"
            ? "Transfer and leave"
            : "Transfer ownership"
        }
        isPending={isSubmitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={executeTransfer}
      />
    </>
  );
}
