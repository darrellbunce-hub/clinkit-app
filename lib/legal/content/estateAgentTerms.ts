import { PRIVACY_EMAIL } from "@/lib/legal/constants";
import { LEGAL_ROUTES } from "@/lib/legal/constants";
import type { LegalDocumentContent } from "@/lib/legal/documentTypes";

/**
 * Estate Agent Terms of Service — Phase 2B drafting pass.
 * Reflects locked founder decisions in docs/LAUNCH_LEGAL_FOUNDER_DECISIONS.md.
 * Not a substitute for solicitor review. OPEN items are flagged in place.
 */
export const estateAgentTermsContent: LegalDocumentContent = {
  title: "Estate Agent Terms of Service",
  subtitle:
    "Business terms for estate agent organisations and branches using Keynetic alongside existing CRM workflows.",
  lastUpdated: "August 2026",
  sections: [
    {
      id: "introduction",
      title: "1. Introduction",
      paragraphs: [
        "These Estate Agent Terms of Service (\"EA Terms\") apply when your organisation registers for, or uses, Keynetic as an estate agent. They supplement our Website & Platform Terms of Use and Privacy Policy. If there is a conflict about estate agent billing or branch subscriptions, these EA Terms take precedence for that subject.",
        "Keynetic provides information, visibility and operational coordination for residential property chains. It is designed to work alongside your existing CRM. Keynetic is not a CRM replacement, conveyancing service, legal service, or guarantee of transaction outcomes.",
        `Questions about privacy and data protection: ${PRIVACY_EMAIL}. Billing questions relating to your branch subscription can be raised through your account or to ${PRIVACY_EMAIL} until a dedicated billing contact is published.`,
      ],
    },
    {
      id: "definitions",
      title: "2. Definitions",
      bullets: [
        "\"Branch\" means an individual estate agent branch registered on Keynetic. Day 1 billing and subscriptions are per Branch.",
        "\"Company\" (or organisation) means the estate agent business entity that owns or operates one or more Branches on Keynetic.",
        "\"Founding offer\" means the limited first-20 Branch offer at the founding monthly price described below.",
        "\"Founding place\" means one of the 20 places in the founding offer. A founding place is secured when Keynetic successfully reserves and confirms founding status for a Branch under the product rules.",
        "\"Standard price\" means the then-current standard monthly Branch price (currently £129 per month at launch baseline).",
        "\"Subscription\" means the recurring monthly Branch subscription paid through Stripe.",
        "\"You\" / \"your organisation\" means the Company and Branch on whose behalf these EA Terms are accepted, including authorised users.",
      ],
    },
    {
      id: "eligibility-authority",
      title: "3. Eligibility and authority",
      paragraphs: [
        "You must be at least 18 and able to enter a binding agreement for your organisation.",
        "By accepting these EA Terms (including at signup), you represent that you have authority to bind your organisation and the relevant Branch. Keynetic does not independently verify every signatory's authority.",
        "Your organisation remains responsible for authorised users, account and Branch access, information supplied to Keynetic, use of the service, and payment obligations for Branch subscriptions.",
      ],
    },
    {
      id: "accounts-access",
      title: "4. Accounts, Branches and access",
      paragraphs: [
        "A Company may have one or more Branches. Each Branch may have its own users and, where subscribed, its own subscription.",
        "Only authorised Branch users may access Branch operational features. You must not share login credentials or allow unauthorised access.",
        "Branch subscription management (including Checkout and the Stripe customer portal for that Branch) is limited to users with the product authority Keynetic assigns for billing (typically the Branch Owner).",
        "One Branch's subscription does not automatically give another Branch paid access or billing cover.",
      ],
    },
    {
      id: "service",
      title: "5. The Keynetic service",
      paragraphs: [
        "Keynetic provides tools for chain visibility and operational coordination between authorised participants. You remain responsible for your professional obligations and for verifying information with solicitors, lenders and other professionals where required.",
        "Keynetic does not independently verify all participant-entered information and does not guarantee completion of any property transaction, timing estimates, or prevention of chain issues.",
        "Homeowners may use core chain functionality without a Branch subscription. Estate agent operational functionality is provided under these EA Terms and, where applicable, a paid Branch subscription.",
        "Future organisation-level products or tiers may be introduced later. They are not part of the current Day 1 Branch Professional offering unless separately agreed in writing.",
      ],
    },
    {
      id: "ea-responsibilities",
      title: "6. Estate agent responsibilities",
      bullets: [
        "Use Keynetic only for legitimate Branch operational coordination on property transactions.",
        "Enter and update information accurately and in line with your professional and regulatory obligations.",
        "Ensure your staff and authorised users comply with these EA Terms and applicable data protection law.",
        "Explain Keynetic's role to clients where appropriate and obtain any client consents required by your own policies and regulatory obligations.",
        "Do not use Keynetic for unlawful marketing, unrelated data storage, scraping, attempts to circumvent access controls, or other misuse of operational or property information.",
      ],
    },
    {
      id: "subscription-billing",
      title: "7. Subscription and billing",
      paragraphs: [
        "Day 1 billing unit: the Branch. The Company is the organisational entity; it is not the Day 1 Stripe billing customer for Branch subscriptions.",
        "Branch subscriptions are recurring monthly subscriptions. When you complete Checkout, you authorise recurring monthly charges to the payment method held by Stripe for that Branch until the subscription is cancelled under these EA Terms.",
        "Launch baseline prices (subject to the founding offer rules below): founding monthly price £99 per Branch; standard monthly price £129 per Branch. VAT treatment for display and invoicing remains OPEN and will be confirmed before final publication — these EA Terms do not state whether prices include or exclude VAT.",
        "The first charge occurs when Checkout completes successfully (subject to Stripe payment confirmation). Subsequent charges occur on each monthly renewal for that Branch subscription while it remains active.",
        "Payments are processed by Stripe. Each subscribed Branch has its own Stripe customer and subscription. The Stripe customer portal for a Branch is limited to that Branch's billing relationship.",
        "Keynetic may operate Checkout and related billing features in Stripe test (Sandbox) environments during development and staging. Production charging applies when Keynetic enables live Stripe mode for your environment. These commercial rules describe the intended live product.",
        "Paid-feature access may be introduced when Keynetic enables entitlement enforcement. Until then, commercial subscription status may be recorded and shown in your account even while some operational access still follows membership rules.",
      ],
    },
    {
      id: "founding-offer",
      title: "8. Founding offer",
      paragraphs: [
        "The founding offer provides up to 20 founding places at the founding monthly price of £99 per Branch. Founding places are allocated at Branch level.",
        "Founding members lock in the founding monthly price for the duration of their continuous subscription (subject to solicitor review of final price-lock wording). If the subscription ends, founding pricing ends with it.",
        "A founding place is permanently consumed when secured. If a founding Branch cancels, it permanently loses founding status. The founding place does not return to the pool and does not reopen £99 pricing for later customers.",
        "Founding status is non-transferable. It cannot be transferred between Branches, Companies, accounts, or customers.",
        "While founding places remain available, multiple Branches belonging to the same Company may each secure a founding place independently. There is no one-founding-place-per-Company restriction.",
        "Once all 20 founding places have been secured, the founding offer permanently closes for new subscriptions. A customer who joins after that point pays the then-current standard price. Cancellation by an earlier founder does not create a new £99 place.",
        "Public marketing may show a positive milestone when the 20 places are secured. Keynetic may later remove prominent founding messaging and focus on standard pricing. That messaging change does not reopen founding places.",
        "During Checkout, a founding place may be held for a short reservation window. If the reservation expires before payment completes, the place is not secured and may become available to others under the product rules. Public founding counts shown on marketing pages are informational only; Checkout uses live availability.",
      ],
    },
    {
      id: "payment-failure-grace",
      title: "9. Payment failure and grace period",
      paragraphs: [
        "If a recurring payment is attempted and fails, the Branch does not lose commercial access immediately. The subscription enters a grace period of seven (7) days during which you should update your payment method and restore successful payment.",
        "You will be notified of the payment problem through available channels, including your account subscription area. Dedicated payment-failure email notices are part of Keynetic's launch readiness backlog and may not yet be enabled in every environment.",
        "If payment is successfully recovered during the grace period, commercial entitlement can continue or be restored under the product rules.",
        "If the grace period expires without recovery, commercial entitlement for the paid Branch subscription ends. Outstanding amounts that were legitimately due under the subscription remain payable. Keynetic does not operate an aggressive debt-collection process in these Terms; any recovery of unpaid sums is subject to applicable law and solicitor review of final wording.",
      ],
    },
    {
      id: "cancellation-termination",
      title: "10. Cancellation and end of subscription",
      paragraphs: [
        "You may cancel a Branch subscription through the Stripe customer portal for that Branch (opened from your Keynetic account where available).",
        "Cancellation takes effect at the end of the then-current paid billing period. There is no ordinary mid-period cancellation and no ordinary prorated refund for unused time in that period.",
        "After you schedule cancellation: the subscription remains active until period end; no further renewal should occur for that subscription after the period ends; you retain applicable service access under the commercial rules until period end.",
        "If Stripe's customer portal allows you to reverse a scheduled cancellation before the period ends, you may do so there. Keynetic does not currently provide a separate in-app \"undo cancellation\" control.",
        "Keynetic may suspend or end Branch access for material breach of these EA Terms, to protect the platform or other users, or where required by law. Non-payment is handled primarily through the grace period and entitlement rules above once billing is enabled for your environment.",
        "Ending a subscription does not automatically delete shared chain or property records that other participants still need. Data handling after termination follows our Privacy Policy and Data Retention information. Formal erasure requests are handled separately.",
      ],
    },
    {
      id: "refunds",
      title: "11. Refunds",
      paragraphs: [
        "Ordinary voluntary cancellation does not generate a refund for unused time in the current paid billing period.",
        "Refunds relating to billing errors, reconciliation issues, or technical exceptions are exceptional and handled case-by-case. They are not an automatic or normal customer journey, and there is no automatic refund-and-rebill path for founding-offer edge cases.",
        "Nothing in these EA Terms excludes rights that cannot be excluded under applicable law. Detailed refund and dispute wording remains subject to solicitor review.",
      ],
    },
    {
      id: "acceptable-use",
      title: "12. Acceptable use",
      paragraphs: [
        "You must not misuse Keynetic, including by unlawful use, harassment, attempts to gain unauthorised access, interference with the service, scraping at scale without permission, circumventing billing or access controls, or misusing operational or property information obtained through the platform.",
      ],
    },
    {
      id: "data-protection",
      title: "13. Data protection and privacy",
      paragraphs: [
        `Our Privacy Policy (${LEGAL_ROUTES.privacy}) and Data Retention information (${LEGAL_ROUTES.dataRetention}) explain how Keynetic processes personal information.`,
        "Keynetic distinguishes identifiable (un-anonymised) operational data from genuinely anonymised data. Exact retention periods remain subject to an internal retention policy and legal approval and are not fixed by these EA Terms.",
        "Depending on context, your organisation may act as an independent controller for some client data, and Keynetic may act as a processor or separate controller for platform data. The precise controller/processor position and any need for a data processing agreement require solicitor confirmation and are not finally determined by this draft.",
        `Client erasure requests may need coordination between your organisation and Keynetic. Privacy requests about Keynetic platform data: ${PRIVACY_EMAIL}.`,
      ],
    },
    {
      id: "ip",
      title: "14. Intellectual property",
      paragraphs: [
        "Keynetic retains all rights in the platform, software, branding and related materials. These EA Terms grant a limited right to use the service for your organisation's authorised Branch operations; they do not transfer ownership.",
        "You retain rights in information you lawfully submit. You grant Keynetic a licence to host, process and display that information to provide and improve the service, including sharing with authorised chain participants as described in the Privacy Policy.",
      ],
    },
    {
      id: "confidentiality",
      title: "15. Confidentiality",
      paragraphs: [
        "You must treat chain and client information accessed through Keynetic as confidential, use it only for permitted purposes, and comply with your organisation's confidentiality and professional obligations.",
      ],
    },
    {
      id: "availability-changes",
      title: "16. Availability and service changes",
      paragraphs: [
        "We aim to provide a reliable service but do not guarantee uninterrupted availability. Planned maintenance will be communicated where practicable.",
        "Keynetic may improve the service, add functionality, modify or remove obsolete features, make technical or security changes, and adjust service structure, provided we act reasonably and do not treat these EA Terms as allowing arbitrary harmful change without regard to existing customers.",
        "We may update these EA Terms. For material changes affecting paid Branch subscriptions, we will give fair and practicable notice through appropriate channels (for example, account notice or email where available). Continued use after the effective date may constitute acceptance where permitted by law — final notice and acceptance mechanics require solicitor review.",
        "The founding monthly price for a qualifying continuous founding subscription is intended to remain fixed for that Branch while the subscription remains continuous. Keynetic may change standard prices for new customers and may introduce new products or tiers. Detailed price-change mechanisms for non-founding customers require solicitor review and are not fully specified here. These EA Terms do not allow Keynetic to arbitrarily increase a locked founding price during continuous founding subscription.",
      ],
    },
    {
      id: "liability",
      title: "17. Liability",
      paragraphs: [
        "To the fullest extent permitted by law, Keynetic is not liable for property transaction outcomes, CRM integration issues outside Keynetic's reasonable control, or losses arising solely from reliance on platform estimates or participant-entered data.",
        "Liability caps, exclusions, and any indemnity wording in the Platform Terms of Use apply to the extent relevant. The amount and structure of any liability cap, and related exclusions, require solicitor review before publication and are not finally settled by this draft.",
        "Nothing in these EA Terms excludes liability that cannot lawfully be excluded.",
      ],
    },
    {
      id: "governing-law",
      title: "18. Governing law",
      paragraphs: [
        "These EA Terms are intended to be governed by the laws of England and Wales. The courts of England and Wales are intended to have jurisdiction. Final governing-law and jurisdiction wording requires solicitor confirmation.",
      ],
    },
    {
      id: "contact",
      title: "19. Contact",
      paragraphs: [
        `Privacy and data protection: ${PRIVACY_EMAIL}`,
        `General enquiries relating to these EA Terms: ${PRIVACY_EMAIL}`,
      ],
    },
  ],
};
