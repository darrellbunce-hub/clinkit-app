import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { dataRetentionContent } from "@/lib/legal/content/dataRetention";

export const metadata: Metadata = {
  title: "Data Retention | Keynetic",
  description:
    "How long Keynetic retains different categories of information.",
};

export default function DataRetentionPage() {
  return <LegalDocumentPage content={dataRetentionContent} />;
}
