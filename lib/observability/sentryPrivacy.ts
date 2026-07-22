import type { ErrorEvent } from "@sentry/nextjs";

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "invitation_token",
  "invitationtoken",
  "claim_token",
  "access_token",
  "refresh_token",
  "code",
  "password",
  "secret",
  "apikey",
  "api_key",
  "authorization",
]);

const SENSITIVE_URL_PATTERNS = [
  /\/claim(?:\/|\?|$)/i,
  /\/auth\/confirm(?:\/|\?|$)/i,
  /\/reset-password(?:\/|\?|$)/i,
  /\/forgot-password(?:\/|\?|$)/i,
  /\/verify-email(?:\/|\?|$)/i,
  /\/join-chain(?:\/|\?|$)/i,
  /\/estate-agents\/join(?:\/|\?|$)/i,
];

const REDACTED = "[Filtered]";

function scrubQueryString(search: string): string {
  if (!search || search === "?") {
    return search;
  }

  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      params.set(key, REDACTED);
    }
  }

  const next = params.toString();
  return next ? `?${next}` : "";
}

function scrubUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const url = new URL(rawUrl, "https://keynetic.local");

    url.search = scrubQueryString(url.search);

    for (const pattern of SENSITIVE_URL_PATTERNS) {
      if (pattern.test(`${url.pathname}${url.search}`)) {
        url.search = "";
      }
    }

    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
      return `${url.origin}${url.pathname}${url.search}`;
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return "[Invalid URL]";
  }
}

function scrubHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) {
    return headers;
  }

  const next: Record<string, string> = { ...headers };

  for (const key of Object.keys(next)) {
    const lower = key.toLowerCase();

    if (
      lower === "authorization" ||
      lower === "cookie" ||
      lower === "set-cookie" ||
      lower === "x-supabase-auth" ||
      lower.startsWith("x-api-key")
    ) {
      next[key] = REDACTED;
    }
  }

  return next;
}

function scrubRequestData(event: ErrorEvent): void {
  const request = event.request;

  if (!request) {
    return;
  }

  request.url = scrubUrl(request.url);
  request.headers = scrubHeaders(request.headers);
  request.cookies = undefined;
  request.data = undefined;
}

function scrubUser(event: ErrorEvent): void {
  if (!event.user) {
    return;
  }

  event.user = {
    id: event.user.id,
  };
}

/**
 * Removes sensitive query parameters, headers, cookies, and request bodies
 * before events leave the application.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  scrubRequestData(event);
  scrubUser(event);

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      data: undefined,
    }));
  }

  return event;
}

export const sentryPrivacyDefaults = {
  sendDefaultPii: false,
} as const;
