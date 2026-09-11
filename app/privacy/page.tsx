import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { loadLegalMarkdown } from "@/lib/legal/legalSource";

export const metadata: Metadata = {
  title: "Privacy Policy | Keynetic",
  description:
    "How Keynetic collects, uses, shares and protects personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentPage markdown={loadLegalMarkdown("privacyPolicy")} />
  );
}
