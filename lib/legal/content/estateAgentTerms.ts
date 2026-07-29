import { LEGAL_LAST_UPDATED, PRIVACY_EMAIL } from "@/lib/legal/constants";
import { LEGAL_ROUTES } from "@/lib/legal/constants";
import type { LegalDocumentContent } from "@/lib/legal/documentTypes";

export const estateAgentTermsContent: LegalDocumentContent = {
  title: "Estate Agent Terms of Service",
  subtitle:
    "Business terms for estate agent branches using Keynetic alongside existing CRM workflows.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "parties",
      title: "Agreement",
      paragraphs: [
        "These Estate Agent Terms of Service (\"EA Terms\") apply to estate agent branches that register for Keynetic. They supplement our Website & Platform Terms of Use and Privacy Policy.",
        "By registering a branch or using Keynetic as an estate agent user, you agree to these EA Terms on behalf of your branch and agency group where applicable.",
      ],
    },
    {
      id: "service",
      title: "The service",
      paragraphs: [
        "Keynetic provides information, visibility and coordination for property chains. It works alongside your existing CRM — Keynetic is not a CRM replacement.",
        "Keynetic does not independently verify all participant-entered information and does not guarantee transaction outcomes.",
      ],
    },
    {
      id: "subscription",
      title: "Branch subscription model",
      paragraphs: [
        "The subscription unit is an individual estate agent branch.",
        "Founding pricing: £99 per month per branch for the first 20 founding branches, retaining £99/month while the subscription remains active.",
        "Standard pricing: £129 per month per branch thereafter.",
        "Automated billing and payment collection are not yet live. Registering a branch today does not charge a subscription fee. Commercial billing mechanics, including cancellation, refunds and invoicing, are subject to final implementation and will be confirmed before automated billing begins.",
      ],
    },
    {
      id: "users",
      title: "Authorised branch users",
      bullets: [
        "Each branch is responsible for its staff accounts and ensuring users access only properties they are authorised to manage.",
        "You must ensure users comply with these terms and applicable data protection law.",
        "You must not share branch credentials or permit unauthorised access.",
      ],
    },
    {
      id: "homeowners",
      title: "Homeowner participation",
      paragraphs: [
        "Homeowners may join chains independently or through invitations from your branch. You are responsible for explaining Keynetic's role to clients and for obtaining any client consents required by your own policies and regulatory obligations.",
      ],
    },
    {
      id: "data-protection",
      title: "Data protection",
      paragraphs: [
        "Depending on context, your agency may act as an independent controller for some client data and Keynetic acts as a processor or separate controller for platform data. Responsibilities should be confirmed with legal counsel.",
        `Client erasure requests may need to be coordinated between your agency and Keynetic. Direct privacy requests about Keynetic platform data to ${PRIVACY_EMAIL}.`,
        `See our Privacy Policy (${LEGAL_ROUTES.privacy}) and Data Retention information (${LEGAL_ROUTES.dataRetention}).`,
      ],
    },
    {
      id: "use",
      title: "Permitted operational use",
      bullets: [
        "Use Keynetic for legitimate branch operational coordination on property transactions.",
        "Enter and update information accurately and in line with your professional obligations.",
        "Do not use Keynetic for unlawful marketing, unrelated data storage, or purposes outside property-chain coordination.",
      ],
    },
    {
      id: "confidentiality",
      title: "Confidentiality",
      paragraphs: [
        "You must treat chain and client information accessed through Keynetic as confidential, use it only for permitted purposes, and comply with your agency's confidentiality obligations.",
      ],
    },
    {
      id: "availability",
      title: "Service availability",
      paragraphs: [
        "We aim to provide reliable service but do not guarantee uninterrupted availability. Planned maintenance will be communicated where practicable.",
      ],
    },
    {
      id: "ip",
      title: "Intellectual property",
      paragraphs: [
        "Keynetic retains all rights in the platform. These terms do not grant ownership of Keynetic software or branding.",
      ],
    },
    {
      id: "suspension",
      title: "Suspension and termination",
      paragraphs: [
        "We may suspend or terminate branch access for breach of these terms, non-payment once billing is live, or to protect the platform.",
        "Termination mechanics and data export upon termination should be confirmed when billing is implemented.",
      ],
    },
    {
      id: "roadmap",
      title: "Future features",
      paragraphs: [
        "Enterprise tiers, multi-branch analytics dashboards and regional benchmarking are roadmap items only. They are not guaranteed and are not part of the current Professional branch offering unless separately agreed in writing.",
      ],
    },
    {
      id: "liability",
      title: "Limitation of liability",
      paragraphs: [
        "To the fullest extent permitted by law, Keynetic is not liable for transaction outcomes, CRM integration issues, or losses arising from reliance on platform estimates or participant data.",
        "Liability caps and exclusions in the Platform Terms of Use apply. This section requires legal review.",
      ],
    },
    {
      id: "changes",
      title: "Changes",
      paragraphs: [
        "We may update these EA Terms. Material changes affecting paid subscriptions will be communicated before automated billing begins.",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      paragraphs: [
        `Privacy and data protection: ${PRIVACY_EMAIL}`,
      ],
    },
  ],
};
