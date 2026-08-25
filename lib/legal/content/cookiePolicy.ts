import { LEGAL_LAST_UPDATED } from "@/lib/legal/constants";
import { LEGAL_ROUTES } from "@/lib/legal/constants";
import type { LegalDocumentContent } from "@/lib/legal/documentTypes";

export const cookiePolicyContent: LegalDocumentContent = {
  title: "Cookie Policy",
  subtitle:
    "How Keynetic uses cookies and similar browser technologies.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "overview",
      title: "Overview",
      paragraphs: [
        "This policy explains cookies and similar technologies used when you visit keynetic.co.uk or use the Keynetic platform.",
        "Based on our current technical implementation, Keynetic does not use non-essential analytics or marketing tracking cookies.",
        "A cookie consent banner is not currently implemented because we do not identify non-essential tracking cookies in production — this position is subject to legal review.",
      ],
    },
    {
      id: "what-are-cookies",
      title: "What are cookies?",
      paragraphs: [
        "Cookies are small text files stored on your device when you visit a website. Similar technologies include local storage and session storage in your browser.",
      ],
    },
    {
      id: "strictly-necessary",
      title: "Strictly necessary cookies",
      paragraphs: [
        "These cookies are essential for the website and platform to function. They cannot be switched off in our systems.",
      ],
      bullets: [
        "Supabase authentication (SSR) — session and refresh cookies used to keep you signed in securely and protect your account.",
        "Supabase MFA cookies (platform administration) — used only for platform-administrator multi-factor authentication, not for ordinary user accounts.",
      ],
    },
    {
      id: "functional-storage",
      title: "Functional browser storage",
      paragraphs: [
        "Some features use browser localStorage or sessionStorage. These are not HTTP cookies but store information locally in your browser for functional purposes:",
      ],
      bullets: [
        "Agent invitation workflow — temporary storage of invitation tokens to support claim/resend flows (cleared when the workflow completes).",
        "Development theme preview — localStorage for brand theme preview in development environments only; not enabled for production end users.",
      ],
    },
    {
      id: "not-used",
      title: "What we do not currently use",
      bullets: [
        "Google Analytics, PostHog, Meta Pixel or similar marketing/analytics SDKs.",
        "Direct document.cookie manipulation in application code.",
        "Advertising or profiling cookies.",
      ],
    },
    {
      id: "server-side",
      title: "Server-side processing",
      paragraphs: [
        "Upstash Redis may be used server-side for caching or rate limiting. This does not place cookies on your device.",
      ],
    },
    {
      id: "managing",
      title: "Managing cookies and storage",
      paragraphs: [
        "You can control cookies through your browser settings. Blocking strictly necessary cookies may prevent you from signing in or using the platform.",
        "Clearing localStorage or sessionStorage may interrupt in-progress invitation workflows.",
      ],
    },
    {
      id: "changes",
      title: "Changes",
      paragraphs: [
        "If we introduce non-essential cookies or change our approach to consent, we will update this policy and implement appropriate controls before doing so.",
        `See also our Privacy Policy (${LEGAL_ROUTES.privacy}).`,
      ],
    },
  ],
};
