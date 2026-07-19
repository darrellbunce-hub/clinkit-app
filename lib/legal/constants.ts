/** Public privacy contact — not admin@. */
export const PRIVACY_EMAIL = "privacy@keynetic.co.uk";

export const PRIVACY_MAILTO = `mailto:${PRIVACY_EMAIL}`;

/** Placeholder until company registration details are finalised. */
export const DATA_CONTROLLER_PLACEHOLDER =
  "Keynetic Ltd (company details to be confirmed)";

export const LEGAL_LAST_UPDATED = "June 2026";

export const LEGAL_ROUTES = {
  privacy: "/privacy",
  terms: "/terms",
  cookies: "/cookies",
  dataRetention: "/data-retention",
  estateAgentTerms: "/estate-agents/terms",
} as const;

export type LegalRouteKey = keyof typeof LEGAL_ROUTES;

export const LEGAL_NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  audience?: "estate-agent";
}> = [
  { href: LEGAL_ROUTES.privacy, label: "Privacy Policy" },
  { href: LEGAL_ROUTES.terms, label: "Terms of Use" },
  { href: LEGAL_ROUTES.cookies, label: "Cookie Policy" },
  { href: LEGAL_ROUTES.dataRetention, label: "Data Retention" },
  {
    href: LEGAL_ROUTES.estateAgentTerms,
    label: "Estate Agent Terms",
    audience: "estate-agent",
  },
];

/** Routes that must remain publicly accessible without authentication. */
export const PUBLIC_LEGAL_PATHS = [
  LEGAL_ROUTES.privacy,
  LEGAL_ROUTES.terms,
  LEGAL_ROUTES.cookies,
  LEGAL_ROUTES.dataRetention,
  LEGAL_ROUTES.estateAgentTerms,
  "/estate-agents/pricing",
] as const;
