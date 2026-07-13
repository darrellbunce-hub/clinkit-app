import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailEventStatus, EmailTemplateId } from "@/lib/communications/types";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

const IDEMPOTENCY_WINDOW_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAX_SENDS = 3;

type RecentSendScope =
  | {
      template: Extract<EmailTemplateId, "homeowner-invitation">;
      propertyId: number;
    }
  | {
      template: Extract<EmailTemplateId, "estate-agent-invitation">;
      recipientEmail: string;
    };

export type InvitationSendGuardResult =
  | { action: "send" }
  | { action: "idempotent_success" }
  | { action: "rate_limited" };

function getSinceTimestamp(windowMs: number): string {
  return new Date(Date.now() - windowMs).toISOString();
}

async function countRecentInvitationEmailAttempts(
  scope: RecentSendScope,
  sinceIso: string,
  statuses?: EmailEventStatus[]
): Promise<number> {
  const serviceSupabase = createServiceRoleSupabaseClient();

  let query = serviceSupabase
    .from("email_events")
    .select("id", { count: "exact", head: true })
    .eq("template", scope.template)
    .gte("created_at", sinceIso);

  if (statuses?.length) {
    query = query.in("status", statuses);
  }

  if (scope.template === "homeowner-invitation") {
    query = query.eq("property_id", scope.propertyId);
  } else {
    query = query.eq(
      "recipient_email",
      scope.recipientEmail.trim().toLowerCase()
    );
  }

  const { count, error } = await query;

  if (error) {
    console.error(
      "[communications] Failed to count recent invitation email attempts:",
      error.message
    );
    return 0;
  }

  return count ?? 0;
}

export async function evaluateInvitationSendGuards(
  scope: RecentSendScope
): Promise<InvitationSendGuardResult> {
  const rateLimitSince = getSinceTimestamp(RATE_LIMIT_WINDOW_MS);
  const recentAttempts = await countRecentInvitationEmailAttempts(
    scope,
    rateLimitSince
  );

  if (recentAttempts >= RATE_LIMIT_MAX_SENDS) {
    return { action: "rate_limited" };
  }

  const idempotencySince = getSinceTimestamp(IDEMPOTENCY_WINDOW_MS);
  const veryRecentAttempts = await countRecentInvitationEmailAttempts(
    scope,
    idempotencySince,
    ["queued", "sent"]
  );

  if (veryRecentAttempts > 0) {
    return { action: "idempotent_success" };
  }

  return { action: "send" };
}

type HomeownerValidationRpc = {
  ok?: boolean;
  error?: string;
  expires_at?: string;
  invitation_version?: number;
  invitation_id?: string;
};

type EaBranchValidationRpc = {
  ok?: boolean;
  error?: string;
  invite_email?: string;
  expires_at?: string;
};

export async function validateHomeownerInvitationForEmailSend(
  supabase: SupabaseClient,
  propertyId: number,
  invitationToken: string
): Promise<
  | {
      ok: true;
      expiresAt: string;
      invitationVersion: number;
      invitationId: string;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc(
    "validate_property_claim_invitation_for_email_send",
    {
      p_property_id: propertyId,
      p_token: invitationToken,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as HomeownerValidationRpc | null;

  if (
    !result?.ok ||
    !result.expires_at ||
    !result.invitation_id ||
    result.invitation_version == null
  ) {
    return {
      ok: false,
      error: result?.error ?? "invitation_not_active",
    };
  }

  return {
    ok: true,
    expiresAt: result.expires_at,
    invitationVersion: result.invitation_version,
    invitationId: result.invitation_id,
  };
}

export async function validateEaBranchInvitationForEmailSend(
  supabase: SupabaseClient,
  invitationId: string,
  invitationToken: string
): Promise<
  | {
      ok: true;
      inviteEmail: string;
      expiresAt: string;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc(
    "validate_ea_branch_invitation_for_email_send",
    {
      p_invitation_id: invitationId,
      p_token: invitationToken,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as EaBranchValidationRpc | null;

  if (!result?.ok || !result.invite_email || !result.expires_at) {
    return {
      ok: false,
      error: result?.error ?? "invitation_not_active",
    };
  }

  return {
    ok: true,
    inviteEmail: result.invite_email,
    expiresAt: result.expires_at,
  };
}

export function buildIdempotentSendSuccess() {
  return {
    ok: true as const,
    sent: true as const,
    provider: "keynetic",
  };
}

export function buildRateLimitedSendFailure() {
  return {
    ok: false as const,
    sent: false as const,
    error: "rate_limited",
  };
}
