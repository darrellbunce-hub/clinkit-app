import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { privacyPolicyContent } from "@/lib/legal/content/privacyPolicy";

export const metadata: Metadata = {
  title: "Privacy Policy | Keynetic",
  description:
    "How Keynetic collects, uses and protects personal information.",
};

export default function PrivacyPolicyPage() {
  return <LegalDocumentPage content={privacyPolicyContent} />;
}
