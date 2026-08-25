import type { User } from "@supabase/supabase-js";

/** True when Supabase reports a confirmed email address. */
export function isEmailVerified(user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }

  return Boolean(
    user.email_confirmed_at ?? user.confirmed_at
  );
}
