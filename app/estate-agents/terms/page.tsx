import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { estateAgentTermsContent } from "@/lib/legal/content/estateAgentTerms";

export const metadata: Metadata = {
  title: "Estate Agent Terms | Keynetic",
  description:
    "Business terms for estate agent branches using Keynetic.",
};

export default function EstateAgentTermsPage() {
  return (
    <LegalDocumentPage
      content={estateAgentTermsContent}
      showEstateAgentTerms
    />
  );
}
