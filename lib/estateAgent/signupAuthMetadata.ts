import type { User } from "@supabase/supabase-js";

/**
 * Auth user_metadata written at EA signup for durable cross-tab recovery.
 * Matches profiles column names; no passwords, tokens, or profile ids.
 */
export const EA_SIGNUP_AUTH_METADATA_ACCOUNT_TYPE =
  "estate_agent" as const;

export type EstateAgentSignupAuthMetadata = {
  account_type: typeof EA_SIGNUP_AUTH_METADATA_ACCOUNT_TYPE;
  contact_name: string;
};

export function buildEstateAgentSignupAuthMetadata(
  contactName: string
): EstateAgentSignupAuthMetadata {
  return {
    account_type: EA_SIGNUP_AUTH_METADATA_ACCOUNT_TYPE,
    contact_name: contactName.trim(),
  };
}

export function readEstateAgentSignupIntentFromUser(
  user: User | null | undefined
): {
  isEstateAgentSignup: boolean;
  contactName: string | null;
} {
  if (!user) {
    return {
      isEstateAgentSignup: false,
      contactName: null,
    };
  }

  const meta = (user.user_metadata ?? {}) as Record<
    string,
    unknown
  >;
  const accountType = meta.account_type;
  const rawContactName = meta.contact_name;
  const contactName =
    typeof rawContactName === "string"
      ? rawContactName.trim()
      : "";

  return {
    isEstateAgentSignup:
      accountType === EA_SIGNUP_AUTH_METADATA_ACCOUNT_TYPE,
    contactName:
      contactName.length >= 2 ? contactName : null,
  };
}

export function emailsMatchForPendingProfile(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (!left?.trim() || !right?.trim()) {
    return false;
  }

  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
