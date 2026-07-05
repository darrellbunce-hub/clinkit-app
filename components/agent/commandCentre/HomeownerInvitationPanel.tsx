"use client";

import { useEffect, useId, useState } from "react";

import HomeownerInvitationNotice from "@/components/agent/commandCentre/HomeownerInvitationNotice";
import {
  formatExpiryLabel,
  formatFullTimestamp,
  formatRelativePast,
} from "@/lib/formatting/relativeTime";
import {
  getHomeownerInvitationHeadline,
  getHomeownerInvitationPanelPhase,
  getHomeownerInvitationPillClasses,
  getHomeownerInvitationPillLabel,
} from "@/lib/propertyClaim/invitationPanelPresentation";
import type { PropertyInvitationStatus } from "@/lib/propertyClaim/invitationTypes";
import {
  buildClaimInvitationUrl,
  deferPropertyClaimInvitation,
  generatePropertyClaimInvitation,
  loadPropertyInvitationStatus,
  resendPropertyClaimInvitation,
  revokePropertyClaimInvitation,
  updatePropertyClaimInviteEmail,
} from "@/lib/propertyClaim/propertyInvitations";
import {
  BTN_PRIMARY_SM_CLASS,
  BTN_SECONDARY_OUTLINE_SM_CLASS,
} from "@/lib/theme/themeTokens";
import { WorkspaceIcon } from "@/lib/theme/workspaceIcons";
import { supabase } from "@/lib/supabase";

type PanelNotice = {
  variant: "success" | "warning" | "neutral";
  message: string;
};

export default function HomeownerInvitationPanel({
  propertyId,
  onChanged,
}: {
  propertyId: number;
  onChanged?: () => void | Promise<void>;
}) {
  const emailFieldId = useId();
  const [status, setStatus] =
    useState<PropertyInvitationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [notice, setNotice] = useState<PanelNotice | null>(
    null
  );
  const [sessionToken, setSessionToken] =
    useState<string | null>(null);
  const [isEditingEmail, setIsEditingEmail] =
    useState(false);
  const [draftEmail, setDraftEmail] = useState("");

  const storageKey = `claim-invitation-token:${propertyId}`;

  async function reloadStatus() {
    setIsLoading(true);
    const nextStatus = await loadPropertyInvitationStatus(
      supabase,
      propertyId
    );
    setStatus(nextStatus);
    setIsLoading(false);
  }

  useEffect(() => {
    setSessionToken(readStoredInvitationToken(storageKey));
    void reloadStatus();
  }, [propertyId, storageKey]);

  function rememberInvitationToken(token: string) {
    storeInvitationToken(storageKey, token);
    setSessionToken(token);
  }

  function getActiveInvitationToken(): string | null {
    return (
      sessionToken ?? readStoredInvitationToken(storageKey)
    );
  }

  function beginEmailEdit(email: string | null) {
    setDraftEmail(email ?? "");
    setIsEditingEmail(true);
    setNotice(null);
  }

  async function handleSaveEmail() {
    setIsWorking(true);
    setNotice(null);

    const result = await updatePropertyClaimInviteEmail(
      supabase,
      propertyId,
      draftEmail
    );

    setIsWorking(false);

    if (!result.ok) {
      setNotice({
        variant: "warning",
        message: mapInvitationError(result.error),
      });
      return;
    }

    setIsEditingEmail(false);
    await reloadStatus();
  }

  async function handleSendInvitation() {
    setIsWorking(true);
    setNotice(null);

    const result = await generatePropertyClaimInvitation(
      supabase,
      propertyId
    );

    if (!result.ok) {
      setIsWorking(false);
      setNotice({
        variant: "warning",
        message: mapInvitationError(result.error),
      });
      return;
    }

    rememberInvitationToken(result.token);

    const emailStatus = await dispatchInvitationEmail(
      result.token,
      result.expiresAt
    );

    setIsWorking(false);
    await reloadStatus();
    await onChanged?.();
    setDeliveryNotice(emailStatus, status?.ok ? status.inviteEmail : null);
  }

  async function handleResendInvitationPeriod() {
    setIsWorking(true);
    setNotice(null);

    const result = await resendPropertyClaimInvitation(
      supabase,
      propertyId
    );

    if (!result.ok) {
      setIsWorking(false);
      setNotice({
        variant: "warning",
        message: mapInvitationError(result.error),
      });
      return;
    }

    rememberInvitationToken(result.token);

    const emailStatus = await dispatchInvitationEmail(
      result.token,
      result.expiresAt
    );

    setIsWorking(false);
    await reloadStatus();
    await onChanged?.();
    setDeliveryNotice(emailStatus, status?.ok ? status.inviteEmail : null);
  }

  async function handleResendEmail() {
    if (!status?.ok || status.state !== "active") {
      return;
    }

    const token = getActiveInvitationToken();

    if (!token) {
      setNotice({
        variant: "warning",
        message:
          "This invitation was sent from another browser. Revoke and send a new invitation, or open this property on the device where it was originally sent.",
      });
      return;
    }

    setIsWorking(true);
    setNotice(null);

    const emailStatus = await dispatchInvitationEmail(
      token,
      status.expiresAt,
      { resendExisting: true }
    );

    setIsWorking(false);
    setDeliveryNotice(emailStatus, status.inviteEmail);
  }

  async function handleDefer() {
    setIsWorking(true);
    setNotice(null);

    const result = await deferPropertyClaimInvitation(
      supabase,
      propertyId
    );

    setIsWorking(false);

    if (!result.ok) {
      setNotice({
        variant: "warning",
        message: mapInvitationError(result.error),
      });
      return;
    }

    await reloadStatus();
    await onChanged?.();
  }

  async function handleRevoke() {
    setIsWorking(true);
    setNotice(null);

    const result = await revokePropertyClaimInvitation(
      supabase,
      propertyId
    );

    setIsWorking(false);

    if (!result.ok) {
      setNotice({
        variant: "warning",
        message: mapInvitationError(result.error),
      });
      return;
    }

    clearStoredInvitationToken(storageKey);
    setSessionToken(null);
    await reloadStatus();
    await onChanged?.();
  }

  async function handleCopyLink() {
    const token = getActiveInvitationToken();

    if (!token) {
      setNotice({
        variant: "warning",
        message:
          "The invitation link is not available in this browser. Send or resend an invitation here first.",
      });
      return;
    }

    const url = buildClaimInvitationUrl(token);

    try {
      await navigator.clipboard.writeText(url);
      setNotice({
        variant: "neutral",
        message: "Invitation link copied.",
      });
    } catch {
      setNotice({
        variant: "warning",
        message: "Could not copy the invitation link.",
      });
    }
  }

  async function dispatchInvitationEmail(
    token: string,
    expiresAt: string,
    options?: { resendExisting?: boolean }
  ): Promise<"sent" | "skipped" | "failed"> {
    const claimUrl = buildClaimInvitationUrl(token);

    try {
      const response = await fetch(
        "/api/communications/homeowner-invitation",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            propertyId,
            claimUrl,
            expiresAt,
            resendExisting: options?.resendExisting ?? false,
          }),
        }
      );

      const result = (await response.json()) as {
        ok?: boolean;
        sent?: boolean;
        skipped?: boolean;
        error?: string;
      };

      if (result.ok && result.sent) {
        return "sent";
      }

      if (result.ok && result.skipped) {
        return "skipped";
      }

      return "failed";
    } catch {
      return "failed";
    }
  }

  function setDeliveryNotice(
    emailStatus: "sent" | "skipped" | "failed",
    inviteEmail: string | null | undefined
  ) {
    const recipient = inviteEmail?.trim();

    if (emailStatus === "sent" && recipient) {
      setNotice({
        variant: "success",
        message: `Invitation email sent to ${recipient}`,
      });
      return;
    }

    if (emailStatus === "sent") {
      setNotice({
        variant: "success",
        message: "Invitation email sent.",
      });
      return;
    }

    if (emailStatus === "skipped") {
      setNotice({
        variant: "warning",
        message:
          "Email sending is not configured. You can copy the invitation link and share it manually.",
      });
      return;
    }

    setNotice({
      variant: "warning",
      message:
        "Email couldn't be sent. The invitation remains active. You can copy the invitation link and share it manually.",
    });
  }

  if (isLoading) {
    return (
      <div
        className="rounded-xl bg-surface-mist px-4 py-3 ring-1 ring-surface-card-border"
        aria-busy="true"
        aria-label="Loading homeowner invitation"
      >
        <p className="text-sm text-text-muted">
          Loading invitation…
        </p>
      </div>
    );
  }

  if (!status?.ok) {
    return (
      <div className="rounded-xl bg-surface-mist px-4 py-3 ring-1 ring-surface-card-border">
        <HomeownerInvitationNotice variant="warning">
          Could not load invitation status.
        </HomeownerInvitationNotice>
      </div>
    );
  }

  const phase = getHomeownerInvitationPanelPhase(status);
  const inviteEmail = status.inviteEmail?.trim() ?? "";
  const hasInviteEmail = Boolean(inviteEmail);
  const isConnected = phase === "connected";
  const panelPadding = isConnected
    ? "rounded-xl bg-surface-mist px-4 py-3 ring-1 ring-surface-card-border"
    : "rounded-xl bg-surface-mist px-4 py-4 ring-1 ring-surface-card-border";

  const joinedLabel =
    status.state === "claimed"
      ? formatRelativePast(status.claimedAt, "Joined")
      : null;

  const sentLabel =
    status.state === "active"
      ? formatRelativePast(status.sentAt, "Sent")
      : null;

  return (
    <section
      className={panelPadding}
      aria-labelledby={`${emailFieldId}-title`}
    >
      <div
        className={
          isConnected
            ? "space-y-2"
            : "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
        }
      >
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-2">
            <p
              id={`${emailFieldId}-title`}
              className="text-xs font-medium uppercase tracking-wide text-text-muted"
            >
              Homeowner invitation
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${getHomeownerInvitationPillClasses(phase)}`}
              >
                {getHomeownerInvitationPillLabel(phase)}
              </span>
            </div>

            <p className="text-sm font-medium text-text-charcoal">
              {getHomeownerInvitationHeadline(phase)}
            </p>

            {isConnected && joinedLabel ? (
              <p className="text-sm text-text-muted">
                {joinedLabel}
              </p>
            ) : null}
          </div>

          {!isConnected ? (
            <EmailSection
              emailFieldId={emailFieldId}
              inviteEmail={inviteEmail}
              isEditingEmail={isEditingEmail}
              draftEmail={draftEmail}
              isWorking={isWorking}
              onDraftChange={setDraftEmail}
              onBeginEdit={() => beginEmailEdit(status.inviteEmail)}
              onCancelEdit={() => {
                setIsEditingEmail(false);
                setDraftEmail("");
              }}
              onSave={() => void handleSaveEmail()}
            />
          ) : null}

          {status.state === "active" ? (
            <ActiveInvitationMeta
              sentLabel={sentLabel}
              sentAt={status.sentAt}
              expiresAt={status.expiresAt}
            />
          ) : null}
        </div>

        {!isConnected ? (
          <ActionSection
            phase={phase}
            hasInviteEmail={hasInviteEmail}
            isWorking={isWorking}
            onSend={() => void handleSendInvitation()}
            onDefer={() => void handleDefer()}
            onResendEmail={() => void handleResendEmail()}
            onCopyLink={() => void handleCopyLink()}
            onRevoke={() => void handleRevoke()}
            onResendPeriod={() =>
              void handleResendInvitationPeriod()
            }
          />
        ) : null}
      </div>

      {notice ? (
        <div className="mt-3">
          <HomeownerInvitationNotice variant={notice.variant}>
            {notice.message}
          </HomeownerInvitationNotice>
        </div>
      ) : null}
    </section>
  );
}

function EmailSection({
  emailFieldId,
  inviteEmail,
  isEditingEmail,
  draftEmail,
  isWorking,
  onDraftChange,
  onBeginEdit,
  onCancelEdit,
  onSave,
}: {
  emailFieldId: string;
  inviteEmail: string;
  isEditingEmail: boolean;
  draftEmail: string;
  isWorking: boolean;
  onDraftChange: (value: string) => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={
            isEditingEmail ? `${emailFieldId}-input` : undefined
          }
          className="text-xs font-medium text-text-muted"
        >
          Homeowner email
        </label>

        {!isEditingEmail ? (
          <button
            type="button"
            onClick={onBeginEdit}
            className="text-xs font-medium text-brand-primary hover:text-brand-link-hover"
          >
            Edit
          </button>
        ) : null}
      </div>

      {isEditingEmail ? (
        <div className="space-y-2">
          <input
            id={`${emailFieldId}-input`}
            type="email"
            autoComplete="email"
            value={draftEmail}
            disabled={isWorking}
            onChange={(event) =>
              onDraftChange(event.target.value)
            }
            className="w-full rounded-lg border border-surface-card-border bg-surface-card px-3 py-2 text-sm text-text-charcoal"
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isWorking}
              onClick={onSave}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
            >
              Save email
            </button>

            <button
              type="button"
              disabled={isWorking}
              onClick={onCancelEdit}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-charcoal">
          {inviteEmail || "Not provided"}
        </p>
      )}
    </div>
  );
}

function ActiveInvitationMeta({
  sentLabel,
  sentAt,
  expiresAt,
}: {
  sentLabel: string | null;
  sentAt: string;
  expiresAt: string;
}) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium text-text-muted">
          Sent
        </dt>
        <dd
          className="text-text-charcoal"
          title={formatFullTimestamp(sentAt)}
        >
          {sentLabel ?? formatFullTimestamp(sentAt)}
        </dd>
      </div>

      <div>
        <dt className="text-xs font-medium text-text-muted">
          Expires
        </dt>
        <dd
          className="text-text-charcoal"
          title={formatFullTimestamp(expiresAt)}
        >
          {formatExpiryLabel(expiresAt)}
        </dd>
      </div>
    </dl>
  );
}

function ActionSection({
  phase,
  hasInviteEmail,
  isWorking,
  onSend,
  onDefer,
  onResendEmail,
  onCopyLink,
  onRevoke,
  onResendPeriod,
}: {
  phase: ReturnType<typeof getHomeownerInvitationPanelPhase>;
  hasInviteEmail: boolean;
  isWorking: boolean;
  onSend: () => void;
  onDefer: () => void;
  onResendEmail: () => void;
  onCopyLink: () => void;
  onRevoke: () => void;
  onResendPeriod: () => void;
}) {
  const primaryDisabled = isWorking || !hasInviteEmail;

  return (
    <div className="flex w-full shrink-0 flex-col gap-2 lg:w-auto lg:min-w-[14rem]">
      {phase === "ready" ? (
        <>
          <button
            type="button"
            disabled={primaryDisabled}
            onClick={onSend}
            className={`w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
          >
            {isWorking
              ? "Sending…"
              : "Send invitation email"}
          </button>

          <button
            type="button"
            disabled={isWorking}
            onClick={onDefer}
            className={`w-full rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60 ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
          >
            Not ready yet
          </button>
        </>
      ) : null}

      {phase === "not_ready" ? (
        <button
          type="button"
          disabled={primaryDisabled}
          onClick={onSend}
          className={`w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
        >
          {isWorking
            ? "Sending…"
            : "Send invitation email"}
        </button>
      ) : null}

      {phase === "awaiting_claim" ? (
        <>
          <button
            type="button"
            disabled={primaryDisabled || isWorking}
            onClick={onResendEmail}
            className={`w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
          >
            {isWorking ? "Sending…" : "Resend email"}
          </button>

          <button
            type="button"
            disabled={isWorking}
            onClick={onCopyLink}
            className={`w-full rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60 ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
          >
            Copy invitation link
          </button>

          <button
            type="button"
            disabled={isWorking}
            onClick={onRevoke}
            className={`w-full rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60 ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
          >
            Revoke invitation
          </button>
        </>
      ) : null}

      {phase === "expired" ? (
        <button
          type="button"
          disabled={primaryDisabled}
          onClick={onResendPeriod}
          className={`w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
        >
          {isWorking
            ? "Sending…"
            : "Send invitation email"}
        </button>
      ) : null}
    </div>
  );
}

function mapInvitationError(error: string): string {
  switch (error) {
    case "invite_email_required":
      return "Add a homeowner email before sending an invitation.";
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
  window.localStorage.setItem(storageKey, token);
}

function readStoredInvitationToken(
  storageKey: string
): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    window.sessionStorage.getItem(storageKey) ??
    window.localStorage.getItem(storageKey)
  );
}

function clearStoredInvitationToken(storageKey: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(storageKey);
  window.localStorage.removeItem(storageKey);
}
