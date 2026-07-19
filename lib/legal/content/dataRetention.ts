import { LEGAL_LAST_UPDATED, PRIVACY_EMAIL } from "@/lib/legal/constants";
import type { LegalDocumentContent } from "@/lib/legal/documentTypes";

export const dataRetentionContent: LegalDocumentContent = {
  title: "Data Retention Information",
  subtitle:
    "How long Keynetic keeps different categories of information and what happens when a transaction ends or you request erasure.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "principles",
      title: "Retention principles",
      paragraphs: [
        "We retain personal information only for as long as necessary for the purposes for which it was collected, including providing the service, maintaining audit records, and meeting legal obligations.",
        "Retention periods vary by data category. Some operational or shared records may need different treatment because property chains involve multiple participants.",
        "The periods below reflect our proposed internal schedule. They are not legally final until approved by the founder and/or legal counsel.",
      ],
    },
    {
      id: "active",
      title: "While your account and transaction are active",
      bullets: [
        "Account and profile information — retained while your account exists.",
        "Property addresses and chain participation data — retained while you participate in an active transaction.",
        "Activities and operational updates — retained while the transaction is active.",
        "Estate agent branch assignments — retained while the assignment is active.",
      ],
    },
    {
      id: "after-transaction",
      title: "After a transaction ends",
      paragraphs: [
        "When you leave a transaction, disconnect from a chain, or a property is released through lifecycle processes, some information may be retained in reduced, anonymised or audit form.",
        "Leaving a transaction is separate from requesting deletion of personal data.",
        "Lifecycle release or anonymisation does not necessarily mean immediate destruction of every shared transaction record.",
      ],
    },
    {
      id: "categories",
      title: "Summary by category (proposed)",
      bullets: [
        "Authentication records — deleted when your account is deleted, subject to fraud/abuse investigation holds (legal review required).",
        "Property addresses — contextual treatment on erasure; shared chain records may be redacted rather than deleted in every context.",
        "Operational identities and memberships — removed or unlinked when you leave or on approved erasure.",
        "Audit and de-link events — may be retained in permanent audit form with personal identifiers removed where appropriate.",
        "Email delivery records — retained per communications policy; subject to legal review.",
        "Analytics snapshots — may be retained permanently only where verified as genuinely non-identifiable.",
        "Erasure request records — proposed retention of approximately 24 months after case closure for audit (proposed, not final).",
      ],
    },
    {
      id: "backups",
      title: "Backups",
      paragraphs: [
        "Secure backups may retain information for a defined period before expiry or overwrite. When erasure is approved, we apply re-erasure principles when backups are restored.",
        "Backup retention windows should be confirmed with infrastructure providers before publication.",
      ],
    },
    {
      id: "erasure",
      title: "Formal erasure requests",
      paragraphs: [
        `To request deletion of your personal data, email ${PRIVACY_EMAIL}. We assess each request individually, including impact on other participants and shared records.`,
        "Erasure does not always mean immediate destruction of every copy in every system. We explain the outcome of each request as part of our privacy process.",
      ],
    },
    {
      id: "anonymised",
      title: "Anonymised information",
      paragraphs: [
        "We may retain genuinely anonymised information that can no longer identify you, for example aggregated operational statistics. Anonymisation is assessed before retention.",
      ],
    },
    {
      id: "changes",
      title: "Changes",
      paragraphs: [
        "We will update this information when retention periods are approved or our practices change materially.",
      ],
    },
  ],
};
