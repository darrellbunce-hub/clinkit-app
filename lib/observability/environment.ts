export type KeyneticEnvironment =
  | "development"
  | "preview"
  | "production"
  | "test";

/**
 * Resolves the logical Keynetic deployment environment for observability tagging.
 *
 * Client bundles only receive NEXT_PUBLIC_* variables at build time. Prefer
 * NEXT_PUBLIC_VERCEL_ENV on Preview so browser events are not mis-tagged.
 */
export function resolveKeyneticEnvironment(): KeyneticEnvironment {
  if (process.env.NODE_ENV === "test") {
    return "test";
  }

  const vercelEnv = (
    process.env.VERCEL_ENV ??
    process.env.NEXT_PUBLIC_VERCEL_ENV
  )?.trim();

  if (vercelEnv === "production") {
    return "production";
  }

  if (vercelEnv === "preview") {
    return "preview";
  }

  if (typeof window === "undefined") {
    if (process.env.NODE_ENV === "production") {
      return "production";
    }
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

function resolveSentryEnabledExplicit(): string | undefined {
  const serverFlag = process.env.SENTRY_ENABLED?.trim().toLowerCase();
  const clientFlag =
    process.env.NEXT_PUBLIC_SENTRY_ENABLED?.trim().toLowerCase();

  if (serverFlag === "false" || clientFlag === "false") {
    return "false";
  }

  if (serverFlag === "true" || clientFlag === "true") {
    return "true";
  }

  return undefined;
}

/**
 * Sentry is opt-in: requires a DSN and must not be explicitly disabled.
 *
 * Production activates when a DSN is present unless SENTRY_ENABLED=false.
 * Non-production environments require SENTRY_ENABLED=true and/or
 * NEXT_PUBLIC_SENTRY_ENABLED=true (browser bundle only reads the public flag).
 */
export function isSentryEnabled(): boolean {
  const dsn = resolveSentryDsn();

  if (!dsn) {
    return false;
  }

  const explicit = resolveSentryEnabledExplicit();

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
