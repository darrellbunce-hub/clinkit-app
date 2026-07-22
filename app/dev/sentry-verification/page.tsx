import { notFound } from "next/navigation";

import SentryVerificationPanel from "@/components/dev/SentryVerificationPanel";
import { isSentryVerificationSurfaceAllowed } from "@/lib/observability/sentryVerification";

export const dynamic = "force-dynamic";

export default function SentryVerificationPage() {
  if (!isSentryVerificationSurfaceAllowed()) {
    notFound();
  }

  return <SentryVerificationPanel />;
}
