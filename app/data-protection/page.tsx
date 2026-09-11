import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { loadLegalMarkdown } from "@/lib/legal/legalSource";

export const metadata: Metadata = {
  title: "Data Protection & Platform Terms | Keynetic",
  description:
    "Roles and responsibilities for data protection on the Keynetic platform.",
};

export default function DataProtectionPlatformTermsPage() {
  return (
    <LegalDocumentPage
      markdown={loadLegalMarkdown("dataProtectionPlatformTerms")}
    />
  );
}
