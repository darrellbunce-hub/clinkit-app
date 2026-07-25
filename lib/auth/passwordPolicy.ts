/**
 * Keynetic password policy — single source of truth for UI validation.
 *
 * Authoritative enforcement also requires matching Supabase Auth dashboard settings
 * (see docs/SUPABASE_AUTH_DASHBOARD_CHECKLIST.md).
 */

export const PASSWORD_MIN_LENGTH = 10;

export const PASSWORD_POLICY = {
  minLength: PASSWORD_MIN_LENGTH,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
} as const;

export type PasswordRequirementId =
  | "min_length"
  | "uppercase"
  | "lowercase"
  | "number"
  | "special";

export type PasswordRequirementState = {
  id: PasswordRequirementId;
  label: string;
  met: boolean;
};

export type PasswordPolicyValidationResult =
  | { valid: true }
  | { valid: false; unmetRequirements: PasswordRequirementState[] };

export type PasswordValidationResult =
  | { valid: true }
  | { valid: false; message: string };

const UPPERCASE_PATTERN = /[A-Z]/;
const LOWERCASE_PATTERN = /[a-z]/;
const NUMBER_PATTERN = /[0-9]/;
const SPECIAL_PATTERN = /[^A-Za-z0-9]/;

export const PASSWORD_REQUIREMENT_DEFINITIONS: ReadonlyArray<{
  id: PasswordRequirementId;
  label: string;
  test: (password: string) => boolean;
}> = [
  {
    id: "min_length",
    label: `Minimum ${PASSWORD_MIN_LENGTH} characters`,
    test: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "uppercase",
    label: "Uppercase letter",
    test: (password) => UPPERCASE_PATTERN.test(password),
  },
  {
    id: "lowercase",
    label: "Lowercase letter",
    test: (password) => LOWERCASE_PATTERN.test(password),
  },
  {
    id: "number",
    label: "Number",
    test: (password) => NUMBER_PATTERN.test(password),
  },
  {
    id: "special",
    label: "Symbol",
    test: (password) => SPECIAL_PATTERN.test(password),
  },
];

export function getPasswordRequirementStates(
  password: string
): PasswordRequirementState[] {
  return PASSWORD_REQUIREMENT_DEFINITIONS.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    met: requirement.test(password),
  }));
}

export function validatePasswordPolicy(
  password: string
): PasswordPolicyValidationResult {
  const states = getPasswordRequirementStates(password);
  const unmetRequirements = states.filter((state) => !state.met);

  if (unmetRequirements.length === 0) {
    return { valid: true };
  }

  return { valid: false, unmetRequirements };
}

export function formatUnmetPasswordRequirements(
  unmetRequirements: PasswordRequirementState[]
): string {
  if (unmetRequirements.length === 0) {
    return "Password meets all requirements.";
  }

  return `Password must include: ${unmetRequirements
    .map((requirement) => requirement.label.toLowerCase())
    .join(", ")}.`;
}

export function validateNewPassword(
  password: string,
  confirmPassword: string,
  currentPassword?: string
): PasswordValidationResult {
  if (!password) {
    return {
      valid: false,
      message: "Enter a password.",
    };
  }

  const policyResult = validatePasswordPolicy(password);

  if (!policyResult.valid) {
    return {
      valid: false,
      message: formatUnmetPasswordRequirements(
        policyResult.unmetRequirements
      ),
    };
  }

  if (password !== confirmPassword) {
    return {
      valid: false,
      message: "Passwords do not match.",
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

/** Validate password only (sign-up without confirm field on same step). */
export function validatePasswordForSignUp(
  password: string
): PasswordValidationResult {
  if (!password) {
    return {
      valid: false,
      message: "Enter a password.",
    };
  }

  const policyResult = validatePasswordPolicy(password);

  if (!policyResult.valid) {
    return {
      valid: false,
      message: formatUnmetPasswordRequirements(
        policyResult.unmetRequirements
      ),
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

  if (
    normalized.includes("weak") ||
    normalized.includes("strength") ||
    normalized.includes("characters") ||
    normalized.includes("password should")
  ) {
    return `Password does not meet Keynetic requirements. ${PASSWORD_REQUIREMENT_DEFINITIONS.map(
      (requirement) => requirement.label.toLowerCase()
    ).join(", ")}.`;
  }

  if (
    normalized.includes("session") ||
    normalized.includes("jwt") ||
    normalized.includes("logged in")
  ) {
    return "Your session has expired. Sign in again and retry.";
  }

  return "We could not update your password. Check the requirements and try again.";
}

export function mapPasswordRecoveryError(
  code: string | null
): string {
  switch (code) {
    case "missing_token":
      return "This reset link is incomplete. Request a new link from the forgot password page.";
    case "unsupported_type":
      return "This link cannot be used for password recovery. Request a new reset link.";
    case "expired":
      return "This reset link has expired. Request a new link from the forgot password page.";
    case "invalid_or_expired":
      return "This reset link is invalid or has expired. Request a new link from the forgot password page.";
    case "reused":
      return "This reset link has already been used. Request a new link if you still need to change your password.";
    case "no_session":
      return "We could not verify your reset session. Request a new password reset link.";
    case "provider_error":
      return "We could not verify your reset link. Request a new link and try again.";
    default:
      return "We could not reset your password. Request a new link and try again.";
  }
}

export function mapAuthSignInError(_message: string): string {
  return "Invalid email or password.";
}

export function mapAuthSignUpError(message: string): string {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("already registered") ||
    normalized.includes("already exists") ||
    normalized.includes("user already")
  ) {
    return "An account with this email may already exist. Try signing in or resetting your password.";
  }

  if (
    normalized.includes("weak") ||
    normalized.includes("password") ||
    normalized.includes("characters")
  ) {
    return `Password does not meet Keynetic requirements. ${PASSWORD_REQUIREMENT_DEFINITIONS.map(
      (requirement) => requirement.label.toLowerCase()
    ).join(", ")}.`;
  }

  return "We could not create your account. Check your details and try again.";
}
