import { ROUTES } from "@/lib/auth/routes";

export const EMAIL_VERIFICATION_REQUIRED_ERROR =
  "email_verification_required";

export const EMAIL_VERIFICATION_TRANSACTION_MESSAGE =
  "Verify your email address before participating in a live property transaction.";

export const EMAIL_VERIFICATION_ACCOUNT_ACCESS_MESSAGE =
  "You can access your Keynetic account now. Verify your email to join or manage live property transactions.";

export function isEmailVerificationRequiredError(
  error: string | null | undefined
): boolean {
  if (!error) {
    return false;
  }

  return (
    error === EMAIL_VERIFICATION_REQUIRED_ERROR ||
    error.includes(EMAIL_VERIFICATION_REQUIRED_ERROR)
  );
}

export const TOO_MANY_ATTEMPTS_MESSAGE =
  "Too many attempts. Please wait a few minutes and try again.";

export function mapTransactionParticipationError(
  error: string | null | undefined
): string | null {
  if (!error) {
    return null;
  }

  if (isEmailVerificationRequiredError(error)) {
    return EMAIL_VERIFICATION_TRANSACTION_MESSAGE;
  }

  if (
    error === "too_many_attempts" ||
    error.includes("too_many_attempts") ||
    error.includes("rate_limited")
  ) {
    return TOO_MANY_ATTEMPTS_MESSAGE;
  }

  return null;
}

export function buildVerifyEmailRedirectPath(
  nextPath?: string | null,
  reason: "transaction_participation" = "transaction_participation"
): string {
  const url = new URL(
    ROUTES.verifyEmail,
    "http://local.invalid"
  );

  url.searchParams.set("reason", reason);

  if (nextPath?.trim()) {
    url.searchParams.set("next", nextPath.trim());
  }

  return `${url.pathname}${url.search}`;
}
