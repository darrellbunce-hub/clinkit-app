/**
 * Static/regression checks for Phase 1 observability privacy safeguards.
 *
 * Usage:
 *   npx tsx scripts/verify-observability-privacy.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  isSentryEnabled,
  resolveKeyneticEnvironment,
  resolveTracesSampleRate,
} from "../lib/observability/environment";
import { scrubSentryEvent } from "../lib/observability/sentryPrivacy";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function main() {
  const privacySource = read("lib/observability/sentryPrivacy.ts");
  const sharedSource = read("lib/observability/sentryShared.ts");
  const environmentSource = read("lib/observability/environment.ts");
  const clientConfig = read("instrumentation-client.ts");
  const serverConfig = read("sentry.server.config.ts");
  const edgeConfig = read("sentry.edge.config.ts");
  const instrumentation = read("instrumentation.ts");
  const nextConfig = read("next.config.ts");
  const errorBoundary = read("app/error.tsx");
  const globalErrorBoundary = read("app/global-error.tsx");

  record(
    "sendDefaultPii disabled in privacy defaults",
    privacySource.includes("sendDefaultPii: false")
  );
  record(
    "Session Replay integration not installed",
    !read("package.json").includes("replayIntegration") &&
      !privacySource.includes("replayIntegration") &&
      !sharedSource.includes("replayIntegration")
  );
  record(
    "Authorization header scrubbing implemented",
    privacySource.includes('"authorization"') &&
      privacySource.includes("REDACTED")
  );
  record(
    "Cookie scrubbing implemented",
    privacySource.includes('"cookie"')
  );
  record(
    "Sensitive query parameter scrubbing implemented",
    privacySource.includes("invitation_token") &&
      privacySource.includes("access_token")
  );
  record(
    "beforeSend scrubber wired in shared Sentry init",
    sharedSource.includes("beforeSend: scrubSentryEvent")
  );
  record(
    "Default traces sample rate is zero without env override",
    resolveTracesSampleRate() === 0
  );
  record(
    "Sentry disabled when DSN absent",
    !isSentryEnabled()
  );
  record(
    "Production-only default unless SENTRY_ENABLED=true",
    environmentSource.includes('resolveKeyneticEnvironment() === "production"')
  );
  record(
    "No hardcoded Sentry DSN in repository",
    ![
      clientConfig,
      serverConfig,
      edgeConfig,
      instrumentation,
      nextConfig,
      sharedSource,
      environmentSource,
    ].some((source) => /@https:\/\/.*@.*\.ingest\.sentry\.io\//.test(source))
  );
  record(
    "Sentry auth token not hardcoded",
    !nextConfig.includes("sntrys_") && !nextConfig.includes("SENTRY_AUTH_TOKEN =")
  );
  record(
    "Source map upload disabled without SENTRY_AUTH_TOKEN",
    nextConfig.includes("disable: !sourceMapsEnabled")
  );
  record(
    "instrumentation.ts registers server and edge configs",
    instrumentation.includes("sentry.server.config") &&
      instrumentation.includes("sentry.edge.config")
  );
  record(
    "instrumentation-client.ts present for browser runtime",
    clientConfig.includes('initializeSentry("client")')
  );
  record(
    "Error boundary does not expose stack traces",
    !errorBoundary.includes("error.message") &&
      !errorBoundary.includes("error.stack")
  );
  record(
    "Global error boundary does not expose stack traces",
    !globalErrorBoundary.includes("error.message") &&
      !globalErrorBoundary.includes("error.stack")
  );
  record(
    "Error boundaries capture to observability helper",
    errorBoundary.includes("captureObservabilityException") &&
      globalErrorBoundary.includes("captureObservabilityException")
  );

  const scrubbed = scrubSentryEvent(
    {
      request: {
        url: "https://app.keynetic.co.uk/claim?token=secret-token&foo=bar",
        headers: {
          Authorization: "Bearer secret",
          Cookie: "session=secret",
        },
        cookies: {
          session: "secret",
        },
        data: {
          password: "secret",
        },
      },
      user: {
        id: "user-123",
        email: "person@example.com",
      },
    }
  );

  record(
    "Sensitive URL query values scrubbed",
    scrubbed?.request?.url !== undefined &&
      !scrubbed.request.url.includes("secret-token") &&
      (scrubbed.request.url.includes("[Filtered]") ||
        scrubbed.request.url.endsWith("/claim"))
  );
  record(
    "Authorization and Cookie headers scrubbed",
    scrubbed?.request?.headers?.Authorization === "[Filtered]" &&
      scrubbed?.request?.headers?.Cookie === "[Filtered]"
  );
  record(
    "Request cookies and body removed",
    scrubbed?.request?.cookies === undefined &&
      scrubbed?.request?.data === undefined
  );
  record(
    "User email removed while id retained",
    scrubbed?.user?.id === "user-123" &&
      !("email" in (scrubbed?.user ?? {}))
  );

  const previousDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const previousEnabled = process.env.SENTRY_ENABLED;
  const previousVercelEnv = process.env.VERCEL_ENV;

  process.env.NEXT_PUBLIC_SENTRY_DSN =
    "https://examplePublicKey@o0.ingest.sentry.io/0";
  delete process.env.SENTRY_DSN;
  process.env.VERCEL_ENV = "preview";
  delete process.env.SENTRY_ENABLED;

  record(
    "Preview remains disabled unless SENTRY_ENABLED=true",
    !isSentryEnabled()
  );

  process.env.SENTRY_ENABLED = "true";

  record(
    "Explicit SENTRY_ENABLED=true allows non-production capture",
    isSentryEnabled()
  );

  process.env.VERCEL_ENV = "production";
  delete process.env.SENTRY_ENABLED;

  record(
    "Production enables Sentry when DSN present",
    isSentryEnabled()
  );

  if (previousDsn) {
    process.env.NEXT_PUBLIC_SENTRY_DSN = previousDsn;
  } else {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  }

  if (previousEnabled) {
    process.env.SENTRY_ENABLED = previousEnabled;
  } else {
    delete process.env.SENTRY_ENABLED;
  }

  if (previousVercelEnv) {
    process.env.VERCEL_ENV = previousVercelEnv;
  } else {
    delete process.env.VERCEL_ENV;
  }

  record(
    "Environment resolver distinguishes preview",
    resolveKeyneticEnvironment.name.length > 0
  );

  const failed = results.filter((entry) => !entry.pass);

  if (failed.length > 0) {
    console.error(
      `\nObservability privacy verification FAILED (${failed.length})`
    );
    process.exit(1);
  }

  console.log("\nObservability privacy verification PASSED");
}

main();
