import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

import { buildSecurityHeaders } from "@/lib/security/httpHeaders";

const nextConfig: NextConfig = {
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy:
      "default-src 'self'; script-src 'none'; sandbox;",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();
const sourceMapsEnabled = Boolean(sentryAuthToken);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: sentryAuthToken,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: process.env.SENTRY_TUNNEL_ROUTE || "/monitoring",
  sourcemaps: {
    disable: !sourceMapsEnabled,
  },
});
