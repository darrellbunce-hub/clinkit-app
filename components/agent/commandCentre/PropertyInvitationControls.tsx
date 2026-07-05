"use client";

import { useEffect, useState } from "react";

import {
  buildClaimInvitationUrl,
  deferPropertyClaimInvitation,
  generatePropertyClaimInvitation,
  loadPropertyInvitationStatus,
  resendPropertyClaimInvitation,
  resumePropertyClaimInvitation,
  revokePropertyClaimInvitation,
} from "@/lib/propertyClaim/propertyInvitations";
import type { PropertyInvitationStatus } from "@/lib/propertyClaim/invitationTypes";
import {
  formatInvitationExpiryCountdown,
  getInvitationPanelStatusLabel,
} from "@/lib/estateAgent/workspacePresentation";
import {
  BTN_PRIMARY_SM_CLASS,
  BTN_SECONDARY_OUTLINE_SM_CLASS,
} from "@/lib/theme/themeTokens";
import { WorkspaceIcon } from "@/lib/theme/workspaceIcons";
import { supabase } from "@/lib/supabase";

const isDeveloperCopyEnabled =
  process.env.NODE_ENV === "development";

export default function PropertyInvitationControls({
  propertyId,
  onChanged,
}: {
  propertyId: number;
  onChanged?: () => void | Promise<void>;
}) {
  const [status, setStatus] =
    useState<PropertyInvitationStatus | null>(
      null
    );
  const [isLoading, setIsLoading] =
    useState(true);
  const [isWorking, setIsWorking] =
    useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");
  const [copyMessage, setCopyMessage] =
    useState("");
  const [sessionToken, setSessionToken] =
    useState<string | null>(null);

  const storageKey = `claim-invitation-token:${propertyId}`;

  async function reloadStatus() {
    setIsLoading(true);
    const nextStatus =
      await loadPropertyInvitationStatus(
        supabase,
        propertyId
      );
    setStatus(nextStatus);
    setIsLoading(false);
  }

  useEffect(() => {
    setSessionToken(
      readStoredInvitationToken(storageKey)
    );
    void reloadStatus();
  }, [propertyId, storageKey]);

  function rememberInvitationToken(token: string) {
    storeInvitationToken(storageKey, token);
    setSessionToken(token);
  }

  async function handleGenerate() {
    setIsWorking(true);
    setErrorMessage("");
    setCopyMessage("");

    const result =
      await generatePropertyClaimInvitation(
        supabase,
        propertyId
      );

    setIsWorking(false);

    if (!result.ok) {
      setErrorMessage(
        mapInvitationError(result.error)
      );
      return;
    }

    await reloadStatus();
    await onChanged?.();
    rememberInvitationToken(result.token);

    if (isDeveloperCopyEnabled) {
      await copyInvitationLink(result.token);
    }
  }

  async function handleResend() {
    setIsWorking(true);
    setErrorMessage("");
    setCopyMessage("");

    const result =
      await resendPropertyClaimInvitation(
        supabase,
        propertyId
      );

    setIsWorking(false);

    if (!result.ok) {
      setErrorMessage(
        mapInvitationError(result.error)
      );
      return;
    }

    await reloadStatus();
    await onChanged?.();
    rememberInvitationToken(result.token);

    if (isDeveloperCopyEnabled) {
      await copyInvitationLink(result.token);
    }
  }

  async function handleRevoke() {
    setIsWorking(true);
    setErrorMessage("");
    setCopyMessage("");

    const result =
      await revokePropertyClaimInvitation(
        supabase,
        propertyId
      );

    setIsWorking(false);

    if (!result.ok) {
      setErrorMessage(
        mapInvitationError(result.error)
      );
      return;
    }

    await reloadStatus();
    await onChanged?.();
    clearStoredInvitationToken(storageKey);
    setSessionToken(null);
  }

  async function handleDefer() {
    setIsWorking(true);
    setErrorMessage("");
    setCopyMessage("");

    const result =
      await deferPropertyClaimInvitation(
        supabase,
        propertyId
      );

    setIsWorking(false);

    if (!result.ok) {
      setErrorMessage(
        mapInvitationError(result.error)
      );
      return;
    }

    await reloadStatus();
    await onChanged?.();
  }

  async function handleResume() {
    setIsWorking(true);
    setErrorMessage("");
    setCopyMessage("");

    const result =
      await resumePropertyClaimInvitation(
        supabase,
        propertyId
      );

    setIsWorking(false);

    if (!result.ok) {
      setErrorMessage(
        mapInvitationError(result.error)
      );
      return;
    }

    await reloadStatus();
    await onChanged?.();
  }

  async function handleCopyActiveLink() {
    const token =
      sessionToken ??
      readStoredInvitationToken(storageKey);

    if (!token) {
      setCopyMessage(
        "Copy link is available in this browser session immediately after sending or resending an invitation."
      );
      return;
    }

    await copyInvitationLink(token);
  }

  async function copyInvitationLink(
    token: string
  ) {
    const url = buildClaimInvitationUrl(token);

    try {
      await navigator.clipboard.writeText(url);
      setCopyMessage("Invitation link copied.");
    } catch {
      setCopyMessage(
        "Could not copy the invitation link."
      );
    }
  }

  if (isLoading || !status?.ok) {
    return null;
  }

  if (status.state === "claimed") {
    return null;
  }

  if (!status.hasInviteEmail) {
    return (
      <p className="text-sm text-text-muted">
        Add an invitation email on the property to
        enable homeowner invitations.
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-surface-mist px-4 py-3 ring-1 ring-surface-card-border">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <WorkspaceIcon
              name="invitations"
              className="h-4 w-4 text-brand-primary"
            />

            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Invitation
            </p>
          </div>

          <p className="mt-1 text-sm font-medium text-text-charcoal">
            {getInvitationPanelStatusLabel(
              status.state
            )}
          </p>

          {status.state === "active" ? (
            <p className="mt-1 text-sm text-text-muted">
              {formatInvitationExpiryCountdown(
                status.hoursRemaining
              )}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {status.state === "none" ? (
            <>
              <button
                type="button"
                disabled={isWorking}
                onClick={() => void handleGenerate()}
                className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
              >
                {isWorking
                  ? "Sending..."
                  : "Send invitation"}
              </button>

              <button
                type="button"
                disabled={isWorking}
                onClick={() => void handleDefer()}
                className="rounded-lg border border-brand-primary bg-surface-card px-3 py-2 text-sm font-medium text-brand-primary disabled:opacity-60"
              >
                Defer invitation
              </button>
            </>
          ) : null}

          {status.state === "deferred" ? (
            <button
              type="button"
              disabled={isWorking}
              onClick={() => void handleResume()}
              className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
            >
              {isWorking
                ? "Resuming..."
                : "Resume invitation"}
            </button>
          ) : null}

          {status.state === "active" ? (
            <>
              {isDeveloperCopyEnabled ? (
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() =>
                    void handleCopyActiveLink()
                  }
                  className="rounded-lg border border-brand-primary bg-surface-card px-3 py-2 text-sm font-medium text-brand-primary disabled:opacity-60"
                >
                  Copy link
                </button>
              ) : null}

              <button
                type="button"
                disabled={isWorking}
                onClick={() => void handleRevoke()}
                className="rounded-lg border border-brand-primary bg-surface-card px-3 py-2 text-sm font-medium text-brand-primary disabled:opacity-60"
              >
                Revoke
              </button>
            </>
          ) : null}

          {status.state === "expired" ? (
            <button
              type="button"
              disabled={isWorking}
              onClick={() => void handleResend()}
              className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
            >
              {isWorking
                ? "Resending..."
                : "Resend invitation"}
            </button>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <p className="mt-3 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      {copyMessage ? (
        <p className="mt-3 text-sm text-green-700">
          {copyMessage}
        </p>
      ) : null}
    </div>
  );
}

function mapInvitationError(error: string): string {
  switch (error) {
    case "invite_email_required":
      return "An invitation email is required before sending an invitation.";
    case "invitation_already_active":
      return "An active invitation already exists for this property.";
    case "already_claimed":
      return "This property has already been claimed.";
    case "no_active_invitation":
      return "There is no active invitation to revoke.";
    case "no_invitation_to_resend":
      return "There is no previous invitation to resend.";
    case "not_deferred":
      return "This invitation is not currently deferred.";
    default:
      return "Could not update the invitation. Please try again.";
  }
}

function storeInvitationToken(
  storageKey: string,
  token: string
) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(storageKey, token);
}

function readStoredInvitationToken(
  storageKey: string
): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage.getItem(storageKey);
}

function clearStoredInvitationToken(storageKey: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(storageKey);
}
