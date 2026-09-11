import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { loadLegalMarkdown } from "@/lib/legal/legalSource";

export const metadata: Metadata = {
  title: "Terms of Service | Keynetic",
  description: "Terms governing use of the Keynetic website and platform.",
};

export default function TermsOfServicePage() {
  return (
    <LegalDocumentPage markdown={loadLegalMarkdown("termsOfService")} />
  );
}
