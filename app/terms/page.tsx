import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { termsOfUseContent } from "@/lib/legal/content/termsOfUse";

export const metadata: Metadata = {
  title: "Terms of Use | Keynetic",
  description:
    "Terms governing use of the Keynetic website and platform.",
};

export default function TermsOfUsePage() {
  return <LegalDocumentPage content={termsOfUseContent} />;
}
