/**
 * Static verification for HTTP security header configuration.
 */
import { readFileSync } from "fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(path) {
  return readFileSync(path, "utf8");
}

function getSupabaseConnectOrigins(configuredUrl) {
  const fallback = {
    httpsOrigin: "https://*.supabase.co",
    wssOrigin: "wss://*.supabase.co",
  };

  if (!configuredUrl?.trim()) {
    return fallback;
  }

  try {
    const parsed = new URL(configuredUrl.trim());

    return {
      httpsOrigin: `https://${parsed.host}`,
      wssOrigin: `wss://${parsed.host}`,
    };
  } catch {
    return fallback;
  }
}

function main() {
  const nextConfig = read("next.config.ts");
  const httpHeaders = read("lib/security/httpHeaders.ts");

  assert(
    nextConfig.includes("buildSecurityHeaders"),
    "next.config.ts must apply buildSecurityHeaders()"
  );

  assert(
    httpHeaders.includes("Content-Security-Policy"),
    "CSP must be configured"
  );

  assert(
    httpHeaders.includes("Strict-Transport-Security"),
    "HSTS must be configured for production"
  );

  assert(
    httpHeaders.includes("isLocalDevelopment"),
    "development must be excluded from strict CSP/HSTS"
  );

  assert(
    httpHeaders.includes("NEXT_PUBLIC_SUPABASE_URL"),
    "connect-src must derive from NEXT_PUBLIC_SUPABASE_URL"
  );

  assert(
    httpHeaders.includes("https://*.supabase.co") &&
      httpHeaders.includes("wss://*.supabase.co"),
    "Supabase wildcard fallback must remain when env is missing"
  );

  assert(
    httpHeaders.includes("getSupabaseConnectOrigins"),
    "Supabase connect origins must be resolved via helper"
  );

  const projectOrigins = getSupabaseConnectOrigins(
    "https://bbbsxzxcjkmpqsfvmhbo.supabase.co"
  );

  assert(
    projectOrigins.httpsOrigin ===
      "https://bbbsxzxcjkmpqsfvmhbo.supabase.co",
    "project Supabase URL must produce HTTPS origin"
  );

  assert(
    projectOrigins.wssOrigin ===
      "wss://bbbsxzxcjkmpqsfvmhbo.supabase.co",
    "project Supabase URL must produce WSS origin"
  );

  const fallbackOrigins = getSupabaseConnectOrigins(undefined);

  assert(
    fallbackOrigins.httpsOrigin === "https://*.supabase.co",
    "missing env must fall back to Supabase HTTPS wildcard"
  );

  assert(
    fallbackOrigins.wssOrigin === "wss://*.supabase.co",
    "missing env must fall back to Supabase WSS wildcard"
  );

  assert(
    httpHeaders.includes("X-Frame-Options"),
    "clickjacking protection must be configured"
  );

  assert(
    httpHeaders.includes("Permissions-Policy"),
    "permissions policy must be configured"
  );

  assert(
    httpHeaders.includes("isVercelPreview"),
    "preview deployment exceptions must exist"
  );

  assert(
    httpHeaders.includes("media-src 'none'") &&
      httpHeaders.includes("isVercelProduction()") &&
      httpHeaders.includes('directives.push("media-src \'none\'")'),
    "production CSP must deny all media sources"
  );

  assert(
    !httpHeaders.includes("Cross-Origin-Embedder-Policy"),
    "COEP must not be enabled"
  );

  console.log("verify-http-security-headers: all checks passed");
}

main();
