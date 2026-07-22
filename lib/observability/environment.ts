export type KeyneticEnvironment =
  | "development"
  | "preview"
  | "production"
  | "test";

/**
 * Resolves the logical Keynetic deployment environment for observability tagging.
 */
export function resolveKeyneticEnvironment(): KeyneticEnvironment {
  if (process.env.NODE_ENV === "test") {
    return "test";
  }

  const vercelEnv = process.env.VERCEL_ENV?.trim();

  if (vercelEnv === "production") {
    return "production";
  }

  if (vercelEnv === "preview") {
    return "preview";
  }

  if (process.env.NODE_ENV === "production") {
    return "production";
  }

  return "development";
}

export function resolveSentryDsn(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() ||
    process.env.SENTRY_DSN?.trim() ||
    undefined
  );
}

/**
 * Sentry is opt-in: requires a DSN and must not be explicitly disabled.
 *
 * Production activates when a DSN is present unless SENTRY_ENABLED=false.
 * Non-production environments require SENTRY_ENABLED=true to avoid noise.
 */
export function isSentryEnabled(): boolean {
  const dsn = resolveSentryDsn();

  if (!dsn) {
    return false;
  }

  const explicit = process.env.SENTRY_ENABLED?.trim().toLowerCase();

  if (explicit === "false") {
    return false;
  }

  if (explicit === "true") {
    return true;
  }

  return resolveKeyneticEnvironment() === "production";
}

export function resolveTracesSampleRate(): number {
  const configured = process.env.SENTRY_TRACES_SAMPLE_RATE?.trim();

  if (!configured) {
    return 0;
  }

  const parsed = Number(configured);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return 0;
  }

  return parsed;
}
