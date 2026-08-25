import "server-only";

/**
 * Server-only Stripe configuration for EA billing Stage 2.
 * Never import from client components. Never log secret values.
 */

export type StripeApiMode = "test" | "live";

export type StripeServerConfig = {
  secretKey: string;
  apiMode: StripeApiMode;
  foundingPriceId: string;
  standardPriceId: string;
  webhookSecret: string | null;
  webhookConfigured: boolean;
  appUrl: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function detectKeyMode(secretKey: string): StripeApiMode | null {
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  return null;
}

export function getStripeServerConfig(): StripeServerConfig {
  const secretKey = requireEnv("STRIPE_SECRET_KEY");
  const apiModeRaw = requireEnv("STRIPE_API_MODE").toLowerCase();
  if (apiModeRaw !== "test" && apiModeRaw !== "live") {
    throw new Error("STRIPE_API_MODE must be test or live");
  }
  const apiMode = apiModeRaw as StripeApiMode;

  const keyMode = detectKeyMode(secretKey);
  if (keyMode && keyMode !== apiMode) {
    throw new Error("STRIPE_API_MODE does not match STRIPE_SECRET_KEY mode");
  }

  // Development deployments must not use live keys.
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (apiMode === "live" && vercelEnv !== "production") {
    throw new Error("Live Stripe mode is only allowed in production deployments");
  }

  const foundingPriceId = requireEnv("STRIPE_EA_FOUNDING_PRICE_ID");
  const standardPriceId = requireEnv("STRIPE_EA_STANDARD_PRICE_ID");
  if (foundingPriceId === standardPriceId) {
    throw new Error("Founding and standard Stripe price IDs must differ");
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "http://localhost:3000";

  return {
    secretKey,
    apiMode,
    foundingPriceId,
    standardPriceId,
    webhookSecret,
    webhookConfigured: !!webhookSecret,
    appUrl: appUrl.replace(/\/$/, ""),
  };
}

export function getStripePriceIdForTier(
  tier: "founding" | "standard"
): string {
  const config = getStripeServerConfig();
  return tier === "founding"
    ? config.foundingPriceId
    : config.standardPriceId;
}
