import { flushIfServerless } from "@sentry/core";
import * as Sentry from "@sentry/nextjs";

import {
  isSentryEnabled,
  resolveKeyneticEnvironment,
  resolveSentryDsn,
  resolveTracesSampleRate,
} from "@/lib/observability/environment";
import {
  scrubSentryEvent,
  sentryPrivacyDefaults,
} from "@/lib/observability/sentryPrivacy";

export function buildSentryOptions(
  runtime: "client" | "server" | "edge"
): Sentry.NodeOptions | Sentry.BrowserOptions | undefined {
  if (!isSentryEnabled()) {
    return undefined;
  }

  const dsn = resolveSentryDsn();

  if (!dsn) {
    return undefined;
  }

  return {
    dsn,
    enabled: true,
    environment: resolveKeyneticEnvironment(),
    sendDefaultPii: sentryPrivacyDefaults.sendDefaultPii,
    tracesSampleRate: resolveTracesSampleRate(),
    beforeSend: scrubSentryEvent,
    initialScope: {
      tags: {
        runtime,
      },
    },
  };
}

export function initializeSentry(
  runtime: "client" | "server" | "edge"
): void {
  const options = buildSentryOptions(runtime);

  if (!options) {
    return;
  }

  Sentry.init(options);
}

export function captureObservabilityException(
  error: unknown,
  context?: {
    operation?: string;
    route?: string;
    errorCode?: string;
  }
): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context?.operation) {
      scope.setTag("operation", context.operation);
    }

    if (context?.route) {
      scope.setTag("route", context.route);
    }

    if (context?.errorCode) {
      scope.setTag("error_code", context.errorCode);
    }

    Sentry.captureException(error);
  });
}

/**
 * Flush queued Sentry events before a serverless/background invocation ends.
 * Use at invocation boundaries (e.g. cron handlers) when errors are captured
 * without throwing through Next.js onRequestError.
 */
export async function flushObservabilityEvents(
  timeoutMs = 2000
): Promise<void> {
  if (!isSentryEnabled() || typeof window !== "undefined") {
    return;
  }

  await flushIfServerless({ timeout: timeoutMs });
}
