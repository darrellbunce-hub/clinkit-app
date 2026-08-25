import { LEGAL_LAST_UPDATED, PRIVACY_EMAIL } from "@/lib/legal/constants";
import { LEGAL_ROUTES } from "@/lib/legal/constants";
import type { LegalDocumentContent } from "@/lib/legal/documentTypes";

export const termsOfUseContent: LegalDocumentContent = {
  title: "Website & Platform Terms of Use",
  subtitle:
    "Terms governing use of the Keynetic website and platform by homeowners, buyers, sellers and other platform users.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "about",
      title: "About Keynetic",
      paragraphs: [
        "Keynetic is an information, visibility and coordination platform for residential property chains.",
        "Keynetic is not a conveyancing service, legal service, mortgage provider, estate agency, or substitute for professional confirmation. You remain responsible for your property transaction and for verifying information with your solicitor, lender, estate agent and other professionals.",
        "Keynetic does not independently verify all participant-entered information and does not guarantee transaction completion, accuracy of all participant data, completion estimates, or prevention of chain collapse.",
      ],
    },
    {
      id: "acceptance",
      title: "Acceptance of terms",
      paragraphs: [
        "By accessing or using Keynetic, you agree to these Terms of Use. If you do not agree, do not use the service.",
        `Our Privacy Policy (${LEGAL_ROUTES.privacy}) explains how we process personal information.`,
      ],
    },
    {
      id: "eligibility",
      title: "Eligibility",
      paragraphs: [
        "You must be at least 18 years old and have legal capacity to enter into these terms.",
        "You must provide accurate registration information and keep it up to date.",
      ],
    },
    {
      id: "accounts",
      title: "Accounts and security",
      bullets: [
        "You are responsible for maintaining the confidentiality of your login credentials.",
        "You must not share your account with others or allow unauthorised access.",
        "Notify us promptly if you suspect unauthorised access to your account.",
        "We may suspend or terminate accounts that violate these terms or pose a security risk.",
      ],
    },
    {
      id: "appropriate-use",
      title: "Appropriate use",
      bullets: [
        "Use Keynetic only for lawful property-chain coordination purposes.",
        "Provide information that is accurate to the best of your knowledge.",
        "Do not impersonate another person or misrepresent your role in a transaction.",
        "Do not attempt unauthorised access to chains, properties or accounts.",
        "Do not scrape, harvest or automate access to the platform except as we expressly permit.",
        "Do not interfere with or disrupt the service, including by introducing malware or excessive load.",
        "Do not use Keynetic to store or transmit unlawful, abusive or infringing content.",
      ],
    },
    {
      id: "chains",
      title: "Property chains, invitations and access codes",
      paragraphs: [
        "Chains are connected through access codes and matching property details provided by participants. You are responsible for how you share access codes and for ensuring only intended participants join.",
        "Information you enter may be visible to other authorised chain participants. See our Privacy Policy for details.",
      ],
    },
    {
      id: "leaving",
      title: "Leaving a transaction and disconnecting",
      paragraphs: [
        "You may leave a transaction or disconnect a property from a chain through in-app controls where available. Leaving ends your operational participation on Keynetic but does not automatically delete all personal data.",
        `To request deletion of personal data, contact ${PRIVACY_EMAIL}.`,
        "Disconnecting from a chain affects the Keynetic connection between properties, not the underlying real-world property transaction.",
      ],
    },
    {
      id: "ip",
      title: "Intellectual property",
      paragraphs: [
        "Keynetic and its branding, software, design and content are owned by us or our licensors. You receive a limited, non-exclusive licence to use the platform for its intended purpose.",
        "You retain ownership of information you submit. You grant us a licence to use that information to provide and improve the service.",
      ],
    },
    {
      id: "availability",
      title: "Service availability",
      paragraphs: [
        "We aim to provide a reliable service but do not guarantee uninterrupted or error-free operation. Maintenance, updates or circumstances beyond our control may affect availability.",
      ],
    },
    {
      id: "termination",
      title: "Suspension and termination",
      paragraphs: [
        "We may suspend or terminate access if you breach these terms, if required by law, or to protect the platform and other users.",
        "You may stop using Keynetic at any time. Some information may be retained as described in our Privacy Policy and Data Retention information.",
      ],
    },
    {
      id: "liability",
      title: "Limitation of liability",
      paragraphs: [
        "To the fullest extent permitted by applicable law, Keynetic is provided \"as is\". We exclude warranties to the extent permitted by law.",
        "We are not liable for losses arising from property transaction outcomes, reliance on participant-entered information, completion estimates, chain confidence indicators, or decisions made outside the platform.",
        "Our total liability to you for claims arising from use of the platform is limited to the amount you paid us in the twelve months before the claim, or £100 if you have not paid us, unless applicable law requires otherwise.",
        "Nothing in these terms excludes liability that cannot be excluded under applicable law.",
        "This section requires legal review before publication.",
      ],
    },
    {
      id: "law",
      title: "Governing law and jurisdiction",
      paragraphs: [
        "These terms are governed by the laws of England and Wales. Courts of England and Wales have exclusive jurisdiction, subject to legal confirmation.",
      ],
    },
    {
      id: "changes",
      title: "Changes",
      paragraphs: [
        "We may update these terms. Continued use after changes take effect constitutes acceptance of the updated terms where permitted by law.",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      paragraphs: [
        `Privacy and data protection: ${PRIVACY_EMAIL}`,
        "Estate agents with a branch subscription should also read our Estate Agent Terms of Service.",
      ],
    },
  ],
};
