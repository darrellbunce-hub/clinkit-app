import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountType } from "@/lib/accountType";

type EnsureUserProfileRpc = {
  ok?: boolean;
  error?: string;
  created?: boolean;
  account_type?: AccountType;
};

export type EnsureUserProfileResult = {
  ok: boolean;
  error: string | null;
  created: boolean;
  accountType: AccountType | null;
};

export async function ensureUserProfile(
  supabase: SupabaseClient
): Promise<EnsureUserProfileResult> {
  const { data, error } = await supabase.rpc(
    "ensure_user_profile"
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
      created: false,
      accountType: null,
    };
  }

  const result = data as EnsureUserProfileRpc | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "profile_ensure_failed",
      created: false,
      accountType: null,
    };
  }

  return {
    ok: true,
    error: null,
    created: Boolean(result.created),
    accountType: result.account_type ?? "homeowner",
  };
}
