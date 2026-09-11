import { permanentRedirect } from "next/navigation";

import { LEGACY_LEGAL_REDIRECTS } from "@/lib/legal/constants";

/** Legacy route — permanently redirects to Data Protection & Platform Terms. */
export default function DataRetentionLegacyPage() {
  permanentRedirect(LEGACY_LEGAL_REDIRECTS.dataRetention.to);
}
