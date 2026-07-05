export const INVITATION_LIFECYCLE_STATUSES = [
  "claimed",
  "awaiting_claim",
  "invitation_active",
  "invitation_expired",
  "invitation_deferred",
] as const;

export type InvitationLifecycleStatus =
  (typeof INVITATION_LIFECYCLE_STATUSES)[number];

export type PropertyInvitationStatus =
  | {
      ok: true;
      state: "none";
      inviteEmail: string | null;
      hasInviteEmail: boolean;
    }
  | {
      ok: true;
      state: "active";
      inviteEmail: string | null;
      sentAt: string;
      expiresAt: string;
      hoursRemaining: number;
      invitationVersion: number;
      hasInviteEmail: boolean;
    }
  | {
      ok: true;
      state: "expired";
      inviteEmail: string | null;
      sentAt: string;
      expiredAt: string;
      invitationVersion: number;
      hasInviteEmail: boolean;
    }
  | {
      ok: true;
      state: "deferred";
      inviteEmail: string | null;
      hasInviteEmail: boolean;
    }
  | {
      ok: true;
      state: "claimed";
      inviteEmail: string | null;
      claimedAt: string | null;
      hasInviteEmail: boolean;
    }
  | {
      ok: false;
      error: string;
    };

export type GenerateInvitationResult =
  | {
      ok: true;
      token: string;
      expiresAt: string;
      invitationVersion: number;
      error: null;
    }
  | {
      ok: false;
      token: null;
      expiresAt: null;
      invitationVersion: null;
      error: string;
    };

export type ResolveInvitationTokenResult =
  | {
      ok: true;
      error: null;
      property: import("@/lib/propertyClaim/types").ClaimablePropertySummary;
    }
  | {
      ok: false;
      error: string;
      property: null;
    };

export type ClaimTokenResolutionError =
  | "invalid_token"
  | "expired"
  | "already_used"
  | "already_claimed"
  | "email_mismatch"
  | "not_authenticated"
  | "homeowner_only"
  | "email_required";

export type UpdateInviteEmailResult =
  | {
      ok: true;
      inviteEmail: string | null;
    }
  | {
      ok: false;
      error: string;
    };
