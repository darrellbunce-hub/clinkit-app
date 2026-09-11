import { permanentRedirect } from "next/navigation";

import { LEGACY_LEGAL_REDIRECTS } from "@/lib/legal/constants";

/** Legacy route — permanently redirects to Terms of Service. */
export default function EstateAgentTermsLegacyPage() {
  permanentRedirect(LEGACY_LEGAL_REDIRECTS.estateAgentTerms.to);
}
