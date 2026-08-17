import {
  DATA_CONTROLLER_PLACEHOLDER,
  LEGAL_LAST_UPDATED,
  PRIVACY_EMAIL,
} from "@/lib/legal/constants";
import type { LegalDocumentContent } from "@/lib/legal/documentTypes";

export const privacyPolicyContent: LegalDocumentContent = {
  title: "Privacy Policy",
  subtitle:
    "How Keynetic collects, uses, shares and protects personal information when you use our website and platform.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "who-we-are",
      title: "Who we are",
      paragraphs: [
        `${DATA_CONTROLLER_PLACEHOLDER} ("Keynetic", "we", "us") operates the Keynetic website and property-chain coordination platform.`,
        "Keynetic is an information, visibility and coordination platform. It is not a conveyancing service, legal service, mortgage provider, estate agency, or substitute for professional confirmation.",
        `For privacy-related enquiries, including requests to exercise your data protection rights, contact us at ${PRIVACY_EMAIL}.`,
      ],
    },
    {
      id: "scope",
      title: "Who this policy applies to",
      paragraphs: [
        "This policy applies to visitors to our website, homeowners and buyers participating in property chains, estate agent branch users, and other platform users whose personal information we process.",
      ],
    },
    {
      id: "categories",
      title: "Categories of personal information",
      bullets: [
        "Account information — such as name, email address, account type, verification status and security settings.",
        "Property address information — addresses and postcodes you enter for properties in a transaction.",
        "Property-chain participation information — chain membership, roles, stages, activities, connection status, access codes you use to join chains, and operational updates you provide.",
        "Estate agent account and branch information — company name, branch details, business email domain, staff membership and assignment data.",
        "Communications — emails we send (such as invitations, notifications and account messages) and records of delivery where retained.",
        "Technical and security information — authentication session data, device/browser information in server logs, and security events necessary to operate and protect the service.",
      ],
    },
    {
      id: "collection",
      title: "How we collect information",
      paragraphs: [
        "We collect information when you create an account, start or join a move, accept an invitation, update property progress, assign or manage estate agent participation, contact us, or otherwise use the platform.",
        "Some information is provided directly by you or by other participants in your chain (for example, when someone invites you to a property or shares chain access details).",
        "We also receive limited technical information automatically when you use the service, such as through authentication and hosting infrastructure.",
      ],
    },
    {
      id: "purposes",
      title: "Why we use personal information",
      bullets: [
        "To provide the Keynetic platform — including chain visibility, coordination, invitations, notifications and account access.",
        "To authenticate users and protect accounts.",
        "To support estate agent branch operations alongside existing CRM workflows.",
        "To maintain audit, lifecycle and operational records required for the service.",
        "To respond to support and privacy requests.",
        "To comply with legal obligations and protect our legitimate interests in operating a secure service.",
      ],
    },
    {
      id: "lawful-bases",
      title: "Lawful bases for processing",
      paragraphs: [
        "We process personal information under UK GDPR lawful bases including contract (to provide the service you request), legitimate interests (to operate and secure the platform), and legal obligation where applicable.",
        "Specific lawful bases for particular processing activities should be confirmed with legal counsel before publication. Where consent is required for a specific activity, we will obtain it separately and clearly.",
      ],
    },
    {
      id: "sharing-participants",
      title: "Sharing within property chains",
      paragraphs: [
        "Keynetic is designed to give authorised participants visibility of chain progress. Information you enter about a property may be visible to other authorised participants in that chain, subject to platform permissions and privacy controls.",
        "Property addresses and progress updates are shared to support coordination. Keynetic does not independently verify all participant-entered information.",
        "Estate agent branches assigned to a property may see operational information for properties they are authorised to manage.",
      ],
    },
    {
      id: "processors",
      title: "Service providers (processors)",
      paragraphs: [
        "We use trusted service providers to host and operate Keynetic. These may process personal information on our instructions:",
      ],
      bullets: [
        "Supabase — authentication, database and application infrastructure.",
        "Vercel — website and application hosting.",
        "Resend — transactional email delivery.",
        "Upstash — server-side caching or rate limiting where enabled in production.",
        "Stripe — payment processing for estate agent branch subscriptions (Checkout, Customer Portal, and related billing). Keynetic may use Stripe in test (Sandbox) mode during development and staging. This policy will be updated again if processor details change before or when Production charging is enabled.",
      ],
    },
    {
      id: "international",
      title: "International transfers and storage",
      paragraphs: [
        "Our service providers may process data in the United Kingdom, European Economic Area, United States or other countries. Transfer safeguards (such as UK IDTA/SCCs or equivalent) should be confirmed with legal counsel and each provider's documentation before publication.",
      ],
    },
    {
      id: "retention",
      title: "Retention",
      paragraphs: [
        "We retain personal information only for as long as necessary for the purposes described in this policy, including while your account is active, while you participate in a transaction, and for defined periods afterwards where required for audit, legal or operational reasons.",
        "Keynetic distinguishes identifiable (un-anonymised) operational data from genuinely anonymised data. Exact retention periods will follow an internal data-retention policy once approved.",
        "Retention varies by category. Some shared transaction records may be retained in anonymised or reduced form after a transaction ends. Backups may retain information for a limited period before expiry or overwrite.",
        "See our Data Retention information for a public summary. Formal erasure requests are handled separately — see Your rights below.",
      ],
    },
    {
      id: "rights",
      title: "Your rights",
      paragraphs: [
        "Under UK data protection law you may have rights including access, rectification, erasure, restriction, objection and data portability, subject to applicable exceptions.",
        `To request deletion of your personal data, email ${PRIVACY_EMAIL}. Requests are handled through Keynetic's privacy process. This is separate from leaving a transaction in the app, which ends your operational participation but does not automatically delete all personal data.`,
        "We aim to respond to rights requests within applicable statutory timeframes. Identity verification may be required.",
        "You may lodge a complaint with the Information Commissioner's Office (ICO) at ico.org.uk if you believe your data protection rights have been infringed.",
      ],
    },
    {
      id: "backups",
      title: "Backups and shared records",
      paragraphs: [
        "Information may persist in secure backups for a limited period after deletion from live systems. Where erasure is approved, we apply suppression and re-erasure principles on restore in line with our internal governance — without exposing operational security detail here.",
        "Because property chains involve multiple participants, erasing your personal data may not remove every shared transaction record immediately or in every context. We assess each request individually.",
      ],
    },
    {
      id: "analytics",
      title: "Analytics and benchmarking",
      paragraphs: [
        "Keynetic does not currently use non-essential analytics or marketing tracking cookies on the public website.",
        "Operational analytics snapshots may be created in anonymised form when a transaction is released. Any future regional benchmarking features will be described here before launch.",
      ],
    },
    {
      id: "cookies",
      title: "Cookies and browser storage",
      paragraphs: [
        "We use strictly necessary cookies for authentication and core platform operation. Limited browser storage may be used for functional features such as invitation workflows.",
        "See our Cookie Policy for details.",
      ],
    },
    {
      id: "security",
      title: "Security",
      paragraphs: [
        "We implement appropriate technical and organisational measures to protect personal information. No online service can guarantee absolute security.",
      ],
    },
    {
      id: "children",
      title: "Children",
      paragraphs: [
        "Keynetic is not intended for children under 18. We do not knowingly collect personal information from children.",
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      paragraphs: [
        "We may update this policy from time to time. The last updated date at the top of this page will change when we do. Material changes will be communicated where appropriate.",
      ],
    },
  ],
};
