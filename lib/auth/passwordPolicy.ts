export const PASSWORD_MIN_LENGTH = 8;

export type PasswordValidationResult =
  | { valid: true }
  | { valid: false; message: string };

export function validateNewPassword(
  password: string,
  confirmPassword: string,
  currentPassword?: string
): PasswordValidationResult {
  if (!password) {
    return {
      valid: false,
      message: "Enter a new password.",
    };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }

  if (password !== confirmPassword) {
    return {
      valid: false,
      message: "New passwords do not match.",
    };
  }

  if (
    currentPassword !== undefined &&
    currentPassword.length > 0 &&
    password === currentPassword
  ) {
    return {
      valid: false,
      message:
        "New password must be different from your current password.",
    };
  }

  return { valid: true };
}

export function mapPasswordUpdateError(
  message: string
): string {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("same") ||
    normalized.includes("different")
  ) {
    return "Choose a password that is different from your current one.";
  }

  if (normalized.includes("weak")) {
    return "Choose a stronger password and try again.";
  }

  if (
    normalized.includes("session") ||
    normalized.includes("jwt") ||
    normalized.includes("logged in")
  ) {
    return "Your session has expired. Sign in again and retry.";
  }

  return message;
}

export function mapPasswordRecoveryError(
  code: string | null
): string {
  switch (code) {
    case "invalid_or_expired":
      return "This reset link is invalid or has expired. Request a new link from the forgot password page.";
    case "reused":
      return "This reset link has already been used. Request a new link if you still need to change your password.";
    case "no_session":
      return "We could not verify your reset session. Request a new password reset link.";
    default:
      return "We could not reset your password. Request a new link and try again.";
  }
}
