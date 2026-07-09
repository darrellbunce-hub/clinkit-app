import type { SupabaseClient } from "@supabase/supabase-js";

import { ROUTES } from "@/lib/auth/routes";
import type {
  GenerateInvitationResult,
  PropertyInvitationStatus,
  ResolveInvitationTokenResult,
  UpdateInviteEmailResult,
} from "@/lib/propertyClaim/invitationTypes";
import type { ClaimablePropertySummary } from "@/lib/propertyClaim/types";
import { refreshOperationalSummaryForProperty } from "@/lib/operationalSummary/refreshOperationalSummary";

type InvitationStatusRpc = {
  ok?: boolean;
  error?: string;
  state?: "none" | "active" | "expired" | "claimed" | "deferred";
  invite_email?: string | null;
  created_at?: string;
  email_sent_at?: string | null;
  email_sent?: boolean;
  claimed_at?: string | null;
  expires_at?: string;
  expired_at?: string;
  hours_remaining?: number;
  invitation_version?: number;
  has_invite_email?: boolean;
};

type GenerateInvitationRpc = {
  ok?: boolean;
  error?: string;
  token?: string;
  expires_at?: string;
  invitation_version?: number;
};

type ResolveTokenRpc = {
  ok?: boolean;
  error?: string;
  property?: ClaimablePropertySummary;
};

export function buildClaimInvitationUrl(
  token: string,
  origin = typeof window !== "undefined"
    ? window.location.origin
    : ""
): string {
  const url = new URL(ROUTES.claimProperty, origin || "http://localhost");
  url.searchParams.set("token", token);
  return url.toString();
}

export async function loadPropertyInvitationStatus(
  supabase: SupabaseClient,
  propertyId: number
): Promise<PropertyInvitationStatus> {
  const { data, error } = await supabase.rpc(
    "get_property_claim_invitation_status",
    {
      p_property_id: propertyId,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as InvitationStatusRpc | null;

  if (!result?.ok || !result.state) {
    return {
      ok: false,
      error: result?.error ?? "status_unavailable",
    };
  }

  const inviteEmail = result.invite_email ?? null;
  const hasInviteEmail =
    result.has_invite_email === true ||
    Boolean(inviteEmail?.trim());

  switch (result.state) {
    case "active":
      return {
        ok: true,
        state: "active",
        inviteEmail,
        createdAt: result.created_at ?? "",
        emailSentAt: result.email_sent_at ?? null,
        emailSent: result.email_sent === true,
        expiresAt: result.expires_at ?? "",
        hoursRemaining: result.hours_remaining ?? 0,
        invitationVersion:
          result.invitation_version ?? 1,
        hasInviteEmail,
      };
    case "expired":
      return {
        ok: true,
        state: "expired",
        inviteEmail,
        createdAt: result.created_at ?? "",
        emailSentAt: result.email_sent_at ?? null,
        emailSent: result.email_sent === true,
        expiredAt: result.expired_at ?? "",
        invitationVersion:
          result.invitation_version ?? 1,
        hasInviteEmail,
      };
    case "deferred":
      return {
        ok: true,
        state: "deferred",
        inviteEmail,
        hasInviteEmail,
      };
    case "claimed":
      return {
        ok: true,
        state: "claimed",
        inviteEmail,
        claimedAt: result.claimed_at ?? null,
        hasInviteEmail,
      };
    default:
      return {
        ok: true,
        state: "none",
        inviteEmail,
        hasInviteEmail,
      };
  }
}

export async function updatePropertyClaimInviteEmail(
  supabase: SupabaseClient,
  propertyId: number,
  inviteEmail: string
): Promise<UpdateInviteEmailResult> {
  const { data, error } = await supabase.rpc(
    "update_property_claim_invite_email",
    {
      p_property_id: propertyId,
      p_invite_email: inviteEmail,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as {
    ok?: boolean;
    error?: string;
    invite_email?: string | null;
  } | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "update_failed",
    };
  }

  return {
    ok: true,
    inviteEmail: result.invite_email ?? null,
  };
}

async function refreshSummaryAfterInvitationMutation(
  supabase: SupabaseClient,
  propertyId: number
): Promise<void> {
  const { data: property } = await supabase
    .from("properties")
    .select("chain_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (property?.chain_id == null) {
    return;
  }

  const refreshResult =
    await refreshOperationalSummaryForProperty(
      supabase,
      propertyId,
      property.chain_id
    );

  if (!refreshResult.ok) {
    console.error(
      "Operational summary refresh after invitation mutation failed:",
      refreshResult.error
    );
  }
}

export async function rotatePropertyClaimInvitationForDelivery(
  supabase: SupabaseClient,
  propertyId: number
): Promise<GenerateInvitationResult> {
  const { data, error } = await supabase.rpc(
    "rotate_active_property_claim_invitation_for_delivery",
    {
      p_property_id: propertyId,
    }
  );

  if (error) {
    return {
      ok: false,
      token: null,
      expiresAt: null,
      invitationVersion: null,
      error: error.message,
    };
  }

  const result = data as GenerateInvitationRpc | null;

  if (
    !result?.ok ||
    !result.token ||
    !result.expires_at
  ) {
    return {
      ok: false,
      token: null,
      expiresAt: null,
      invitationVersion: null,
      error: result?.error ?? "rotate_failed",
    };
  }

  await refreshSummaryAfterInvitationMutation(
    supabase,
    propertyId
  );

  return {
    ok: true,
    token: result.token,
    expiresAt: result.expires_at,
    invitationVersion:
      result.invitation_version ?? 1,
    error: null,
  };
}

export async function recordPropertyClaimInvitationSent(
  supabase: SupabaseClient,
  propertyId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc(
    "record_property_claim_invitation_sent",
    {
      p_property_id: propertyId,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as { ok?: boolean; error?: string } | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "record_sent_failed",
    };
  }

  return { ok: true };
}

export async function generatePropertyClaimInvitation(
  supabase: SupabaseClient,
  propertyId: number
): Promise<GenerateInvitationResult> {
  const { data, error } = await supabase.rpc(
    "generate_property_claim_invitation",
    {
      p_property_id: propertyId,
    }
  );

  if (error) {
    return {
      ok: false,
      token: null,
      expiresAt: null,
      invitationVersion: null,
      error: error.message,
    };
  }

  const result = data as GenerateInvitationRpc | null;

  if (
    !result?.ok ||
    !result.token ||
    !result.expires_at
  ) {
    return {
      ok: false,
      token: null,
      expiresAt: null,
      invitationVersion: null,
      error: result?.error ?? "generate_failed",
    };
  }

  await refreshSummaryAfterInvitationMutation(
    supabase,
    propertyId
  );

  return {
    ok: true,
    token: result.token,
    expiresAt: result.expires_at,
    invitationVersion:
      result.invitation_version ?? 1,
    error: null,
  };
}

export async function resendPropertyClaimInvitation(
  supabase: SupabaseClient,
  propertyId: number
): Promise<GenerateInvitationResult> {
  const { data, error } = await supabase.rpc(
    "resend_property_claim_invitation",
    {
      p_property_id: propertyId,
    }
  );

  if (error) {
    return {
      ok: false,
      token: null,
      expiresAt: null,
      invitationVersion: null,
      error: error.message,
    };
  }

  const result = data as GenerateInvitationRpc | null;

  if (
    !result?.ok ||
    !result.token ||
    !result.expires_at
  ) {
    return {
      ok: false,
      token: null,
      expiresAt: null,
      invitationVersion: null,
      error: result?.error ?? "resend_failed",
    };
  }

  await refreshSummaryAfterInvitationMutation(
    supabase,
    propertyId
  );

  return {
    ok: true,
    token: result.token,
    expiresAt: result.expires_at,
    invitationVersion:
      result.invitation_version ?? 1,
    error: null,
  };
}

export async function revokePropertyClaimInvitation(
  supabase: SupabaseClient,
  propertyId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc(
    "revoke_property_claim_invitation",
    {
      p_property_id: propertyId,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as { ok?: boolean; error?: string } | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "revoke_failed",
    };
  }

  await refreshSummaryAfterInvitationMutation(
    supabase,
    propertyId
  );

  return { ok: true };
}

export async function deferPropertyClaimInvitation(
  supabase: SupabaseClient,
  propertyId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc(
    "defer_property_claim_invitation",
    {
      p_property_id: propertyId,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as { ok?: boolean; error?: string } | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "defer_failed",
    };
  }

  await refreshSummaryAfterInvitationMutation(
    supabase,
    propertyId
  );

  return { ok: true };
}

export async function resumePropertyClaimInvitation(
  supabase: SupabaseClient,
  propertyId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc(
    "resume_property_claim_invitation",
    {
      p_property_id: propertyId,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as { ok?: boolean; error?: string } | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "resume_failed",
    };
  }

  await refreshSummaryAfterInvitationMutation(
    supabase,
    propertyId
  );

  return { ok: true };
}

export async function resolveClaimInvitationToken(
  supabase: SupabaseClient,
  token: string
): Promise<ResolveInvitationTokenResult> {
  const { data, error } = await supabase.rpc(
    "resolve_claim_invitation_token",
    {
      p_token: token,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
      property: null,
    };
  }

  const result = data as ResolveTokenRpc | null;

  if (!result?.ok || !result.property) {
    return {
      ok: false,
      error: result?.error ?? "invalid_token",
      property: null,
    };
  }

  return {
    ok: true,
    error: null,
    property: {
      property_id: result.property.property_id,
      address: result.property.address ?? null,
      postcode: result.property.postcode ?? null,
      branch_name:
        result.property.branch_name ??
        "Estate agent branch",
      in_chain: Boolean(result.property.in_chain),
      claim_status:
        result.property.claim_status ??
        "claim_invited",
    },
  };
}
