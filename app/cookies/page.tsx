import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { loadLegalMarkdown } from "@/lib/legal/legalSource";

export const metadata: Metadata = {
  title: "Cookies & Similar Technologies Policy | MoveLoop",
  description:
    "How MoveLoop uses cookies and similar browser technologies.",
};

export default function CookiesPolicyPage() {
  return (
    <LegalDocumentPage markdown={loadLegalMarkdown("cookiesPolicy")} />
  );
}
