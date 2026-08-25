export const BLOCKED_CONSUMER_DOMAINS = [
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.co.uk",
  "yahoo.com",
] as const;

export type BlockedConsumerDomain =
  (typeof BLOCKED_CONSUMER_DOMAINS)[number];

export type BusinessEmailErrorCode =
  | "invalid_format"
  | "missing_domain"
  | "blocked_consumer_domain";

export type BusinessEmailValidationResult =
  | {
      valid: true;
      email: string;
      domain: string;
    }
  | {
      valid: false;
      email: string;
      domain: string | null;
      errorCode: BusinessEmailErrorCode;
      message: string;
    };

const BLOCKED_DOMAIN_SET: ReadonlySet<string> =
  new Set(
    BLOCKED_CONSUMER_DOMAINS.map((domain) =>
      domain.toLowerCase()
    )
  );

const EMAIL_FORMAT_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(
  email: string
): string {
  return email.trim().toLowerCase();
}

export function normalizeDomain(
  domain: string
): string {
  return domain.trim().toLowerCase();
}

export function extractDomain(
  email: string
): string | null {
  const normalizedEmail =
    normalizeEmail(email);

  if (!normalizedEmail.includes("@")) {
    return null;
  }

  const domain =
    normalizedEmail.split("@").pop();

  if (!domain) {
    return null;
  }

  const normalizedDomain =
    normalizeDomain(domain);

  return normalizedDomain.length > 0
    ? normalizedDomain
    : null;
}

export function isBlockedConsumerDomain(
  domain: string
): boolean {
  return BLOCKED_DOMAIN_SET.has(
    normalizeDomain(domain)
  );
}

export function isValidEmailFormat(
  email: string
): boolean {
  return EMAIL_FORMAT_PATTERN.test(
    normalizeEmail(email)
  );
}

export function validateBusinessEmail(
  email: string
): BusinessEmailValidationResult {
  const normalizedEmail =
    normalizeEmail(email);

  if (!normalizedEmail) {
    return {
      valid: false,
      email: normalizedEmail,
      domain: null,
      errorCode: "invalid_format",
      message:
        "Enter a valid business email address.",
    };
  }

  if (!isValidEmailFormat(normalizedEmail)) {
    return {
      valid: false,
      email: normalizedEmail,
      domain: null,
      errorCode: "invalid_format",
      message:
        "Enter a valid business email address.",
    };
  }

  const domain =
    extractDomain(normalizedEmail);

  if (!domain) {
    return {
      valid: false,
      email: normalizedEmail,
      domain: null,
      errorCode: "missing_domain",
      message:
        "The email address must include a business domain.",
    };
  }

  if (isBlockedConsumerDomain(domain)) {
    return {
      valid: false,
      email: normalizedEmail,
      domain,
      errorCode: "blocked_consumer_domain",
      message:
        "Use your agency business email address, not a personal email provider.",
    };
  }

  return {
    valid: true,
    email: normalizedEmail,
    domain,
  };
}
