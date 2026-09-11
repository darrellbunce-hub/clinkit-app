/** Public privacy contact — not admin@. */
export const PRIVACY_EMAIL = "privacy@keynetic.co.uk";

export const PRIVACY_MAILTO = `mailto:${PRIVACY_EMAIL}`;

/**
 * Stable version identifiers for acceptance audit records.
 * Must match the approved public document versions.
 */
export const LEGAL_DOCUMENT_VERSIONS = {
  privacyPolicy: "1.1",
  termsOfService: "1.0",
} as const;

/**
 * Database document id for Terms acceptance records.
 * Kept as `terms_of_use` to preserve the existing RPC allowlist
 * without requiring a migration. Public title is Terms of Service.
 */
export type SignupTermsDocument = "terms_of_use";

export const SIGNUP_LEGAL_ACCEPTANCE_ERROR =
  "Accept the Terms of Service and Privacy Policy to create your account.";

export const LEGAL_ROUTES = {
  privacy: "/privacy",
  terms: "/terms",
  cookies: "/cookies",
  dataProtection: "/data-protection",
} as const;

/** Retired public paths retained only as permanent redirects. */
export const LEGACY_LEGAL_REDIRECTS = {
  dataRetention: {
    from: "/data-retention",
    to: LEGAL_ROUTES.dataProtection,
  },
  estateAgentTerms: {
    from: "/estate-agents/terms",
    to: LEGAL_ROUTES.terms,
  },
} as const;

export type LegalRouteKey = keyof typeof LEGAL_ROUTES;

export const LEGAL_NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
}> = [
  { href: LEGAL_ROUTES.privacy, label: "Privacy Policy" },
  { href: LEGAL_ROUTES.terms, label: "Terms of Service" },
  {
    href: LEGAL_ROUTES.dataProtection,
    label: "Data Protection & Platform Terms",
  },
  {
    href: LEGAL_ROUTES.cookies,
    label: "Cookies & Similar Technologies Policy",
  },
];

/** Routes that must remain publicly accessible without authentication. */
export const PUBLIC_LEGAL_PATHS = [
  LEGAL_ROUTES.privacy,
  LEGAL_ROUTES.terms,
  LEGAL_ROUTES.cookies,
  LEGAL_ROUTES.dataProtection,
  LEGACY_LEGAL_REDIRECTS.dataRetention.from,
  LEGACY_LEGAL_REDIRECTS.estateAgentTerms.from,
  "/estate-agents/pricing",
] as const;
