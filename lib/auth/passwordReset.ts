import { ROUTES } from "@/lib/auth/routes";

/** Recovery email redirect — must match Supabase Auth redirect allow-list. */
export function buildPasswordRecoveryConfirmUrl(
  origin: string
): string {
  const url = new URL(
    ROUTES.authConfirm,
    origin
  );

  url.searchParams.set(
    "next",
    ROUTES.resetPassword
  );

  return url.toString();
}

/** Generic success copy — does not reveal whether the email exists. */
export const PASSWORD_RESET_EMAIL_SENT_MESSAGE =
  "If an account exists for that email address, we have sent a password reset link. Check your inbox and spam folder.";
