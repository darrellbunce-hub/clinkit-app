import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { cookiePolicyContent } from "@/lib/legal/content/cookiePolicy";

export const metadata: Metadata = {
  title: "Cookie Policy | Keynetic",
  description:
    "How Keynetic uses cookies and similar browser technologies.",
};

export default function CookiePolicyPage() {
  return <LegalDocumentPage content={cookiePolicyContent} />;
}
