import { NextResponse } from "next/server";

import { captureObservabilityException } from "@/lib/observability/sentryShared";
import {
  isSentryVerificationSurfaceAllowed,
  SENTRY_SERVER_VERIFICATION_MESSAGE,
} from "@/lib/observability/sentryVerification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fixed server-side Sentry verification trigger.
 * Non-Production only; returns 404 when blocked.
 */
export async function GET() {
  if (!isSentryVerificationSurfaceAllowed()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const error = new Error(SENTRY_SERVER_VERIFICATION_MESSAGE);

  captureObservabilityException(error, {
    operation: "sentry_verification_server",
    route: "/api/dev/sentry-verification",
    errorCode: "sentry_verification_server",
  });

  throw error;
}
