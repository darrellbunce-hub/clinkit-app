type Header = {
  key: string;
  value: string;
};

const SUPABASE_CONNECT_FALLBACK = {
  httpsOrigin: "https://*.supabase.co",
  wssOrigin: "wss://*.supabase.co",
} as const;

function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

function isVercelProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function isVercelPreview(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

function getSupabaseConnectOrigins(): {
  httpsOrigin: string;
  wssOrigin: string;
} {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

  if (!configuredUrl) {
    return SUPABASE_CONNECT_FALLBACK;
  }

  try {
    const parsed = new URL(configuredUrl);

    return {
      httpsOrigin: `https://${parsed.host}`,
      wssOrigin: `wss://${parsed.host}`,
    };
  } catch {
    return SUPABASE_CONNECT_FALLBACK;
  }
}

function buildConnectSrcDirective(
  extraOrigins: string[] = []
): string {
  const { httpsOrigin, wssOrigin } = getSupabaseConnectOrigins();

  return [
    "connect-src 'self'",
    httpsOrigin,
    wssOrigin,
    ...extraOrigins,
  ].join(" ");
}

function buildContentSecurityPolicy(): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    buildConnectSrcDirective(),
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];

  if (isVercelPreview()) {
    directives[1] =
      "script-src 'self' 'unsafe-inline' https://vercel.live";
    directives[5] = buildConnectSrcDirective([
      "https://vercel.live",
      "wss://vercel.live",
    ]);
    directives[6] = "frame-src https://vercel.live";
  }

  if (isVercelProduction()) {
    directives.push("media-src 'none'");
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

/**
 * Production-ready HTTP security headers for Keynetic on Vercel.
 * CSP and HSTS are omitted during local development to preserve HMR usability.
 */
export function buildSecurityHeaders(): Header[] {
  const headers: Header[] = [
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "X-DNS-Prefetch-Control",
      value: "off",
    },
    {
      key: "Cross-Origin-Opener-Policy",
      value: "same-origin",
    },
    {
      key: "Permissions-Policy",
      value: [
        "accelerometer=()",
        "autoplay=()",
        "camera=()",
        "cross-origin-isolated=()",
        "display-capture=()",
        "encrypted-media=()",
        "fullscreen=(self)",
        "geolocation=()",
        "gyroscope=()",
        "magnetometer=()",
        "microphone=()",
        "midi=()",
        "payment=()",
        "picture-in-picture=()",
        "publickey-credentials-create=(self)",
        "publickey-credentials-get=(self)",
        "screen-wake-lock=()",
        "usb=()",
        "web-share=()",
        "xr-spatial-tracking=()",
      ].join(", "),
    },
  ];

  if (!isLocalDevelopment()) {
    headers.push({
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(),
    });
  }

  if (isVercelProduction()) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}

export function getSecurityHeaderSummary(): Record<string, string> {
  return Object.fromEntries(
    buildSecurityHeaders().map((header) => [header.key, header.value])
  );
}
