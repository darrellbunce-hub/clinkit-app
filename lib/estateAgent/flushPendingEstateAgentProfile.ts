import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createEstateAgentProfile } from "@/lib/estateAgent/createEstateAgentProfile";
import {
  clearPendingEstateAgentProfile,
  readPendingEstateAgentProfile,
  savePendingEstateAgentProfile,
} from "@/lib/estateAgent/pendingEstateAgentProfile";
import {
  emailsMatchForPendingProfile,
  readEstateAgentSignupIntentFromUser,
} from "@/lib/estateAgent/signupAuthMetadata";
import { ensureUserProfile } from "@/lib/profile/ensureUserProfile";

export function queuePendingEstateAgentProfile(payload: {
  contactName: string;
  email: string;
}) {
  savePendingEstateAgentProfile(payload);
}

function resolveMatchingPendingContactName(
  user: User
): string | null {
  const pending = readPendingEstateAgentProfile();

  if (!pending) {
    return null;
  }

  if (
    !emailsMatchForPendingProfile(pending.email, user.email)
  ) {
    return null;
  }

  return pending.contactName;
}

/**
 * Creates an EA profile when Auth metadata (primary) or email-matched pending
 * storage (supplementary) indicates EA signup intent.
 *
 * Clears pending storage only after a successful profiles upsert.
 * Does not call ensure_user_profile — callers must not fall through to
 * homeowner defaults until this succeeds when EA intent is present.
 */
export async function flushPendingEstateAgentProfile(
  supabase: SupabaseClient
): Promise<{
  ok: boolean;
  error: string | null;
  flushed: boolean;
  usedMetadata: boolean;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: true,
      error: null,
      flushed: false,
      usedMetadata: false,
    };
  }

  const intent = readEstateAgentSignupIntentFromUser(user);
  const pendingContactName =
    resolveMatchingPendingContactName(user);
  const contactName =
    pendingContactName ?? intent.contactName;

  if (!intent.isEstateAgentSignup && !pendingContactName) {
    return {
      ok: true,
      error: null,
      flushed: false,
      usedMetadata: false,
    };
  }

  // EA signup intent must never fall through to ensure_user_profile as homeowner.
  if (!contactName || !user.email) {
    return {
      ok: false,
      error: "estate_agent_signup_details_unavailable",
      flushed: false,
      usedMetadata: intent.isEstateAgentSignup,
    };
  }

  const profileResult = await createEstateAgentProfile(supabase, {
    userId: user.id,
    contactName,
    email: user.email,
  });

  if (profileResult.error) {
    return {
      ok: false,
      error: profileResult.error,
      flushed: false,
      usedMetadata: intent.isEstateAgentSignup,
    };
  }

  clearPendingEstateAgentProfile();

  return {
    ok: true,
    error: null,
    flushed: true,
    usedMetadata: intent.isEstateAgentSignup,
  };
}

/**
 * Authenticated profile bootstrap.
 *
 * When Auth metadata (or email-matched pending state) marks estate_agent signup
 * intent, create the EA profile BEFORE ensure_user_profile so a homeowner
 * default is never inserted for an EA signup.
 */
export async function bootstrapAuthenticatedEstateAgentProfile(
  supabase: SupabaseClient
): Promise<{ ok: boolean; error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: "not_authenticated",
    };
  }

  const intent = readEstateAgentSignupIntentFromUser(user);
  const pendingContactName =
    resolveMatchingPendingContactName(user);
  const hasEaSignupIntent =
    intent.isEstateAgentSignup || pendingContactName != null;

  if (hasEaSignupIntent) {
    const eaFlush = await flushPendingEstateAgentProfile(supabase);

    if (!eaFlush.ok) {
      return {
        ok: false,
        error: eaFlush.error,
      };
    }

    // EA profile row now exists — ensure_user_profile is a no-op create.
    const profileEnsure = await ensureUserProfile(supabase);

    if (!profileEnsure.ok) {
      return {
        ok: false,
        error: profileEnsure.error,
      };
    }

    if (profileEnsure.accountType !== "estate_agent") {
      return {
        ok: false,
        error: "estate_agent_profile_not_established",
      };
    }

    return { ok: true, error: null };
  }

  const profileEnsure = await ensureUserProfile(supabase);

  if (!profileEnsure.ok) {
    return {
      ok: false,
      error: profileEnsure.error,
    };
  }

  return { ok: true, error: null };
}
