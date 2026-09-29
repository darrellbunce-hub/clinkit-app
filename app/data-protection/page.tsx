import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { loadLegalMarkdown } from "@/lib/legal/legalSource";

export const metadata: Metadata = {
  title: "Data Protection & Platform Terms | MoveLoop",
  description:
    "Roles and responsibilities for data protection on the MoveLoop platform.",
};

export default function DataProtectionPlatformTermsPage() {
  return (
    <LegalDocumentPage
      markdown={loadLegalMarkdown("dataProtectionPlatformTerms")}
    />
  );
}
