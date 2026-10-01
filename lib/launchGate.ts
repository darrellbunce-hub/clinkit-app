import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { normalizePathname } from "@/lib/auth/routes";

/** Soft pre-launch access gate. Off unless LAUNCH_GATE_ENABLED=true. */
export const LAUNCH_GATE_COOKIE_NAME = "keynetic_launch_bypass";

/** Dedicated public holding page while the gate is enabled. */
export const LAUNCH_GATE_HOLDING_PATH = "/coming-soon";

const LAUNCH_GATE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Paths that must remain reachable without a bypass cookie while the gate
 * is enabled. Infrastructure, auth recovery, and the holding page itself.
 */
export function isLaunchGateExemptPath(pathname: string): boolean {
  const path = normalizePathname(pathname);

  if (path === LAUNCH_GATE_HOLDING_PATH) {
    return true;
  }

  // Auth email callbacks / recovery:
  // email → /auth/confirm → /reset-password (password recovery)
  // signup confirmation may land on /verify-email
  if (path === "/auth/confirm" || path.startsWith("/auth/confirm/")) {
    return true;
  }

  if (path === "/reset-password" || path === "/verify-email") {
    return true;
  }

  // All App Router API routes (Stripe webhooks, health, cron, communications)
  if (path === "/api" || path.startsWith("/api/")) {
    return true;
  }

  return false;
}

export function isLaunchGateEnabled(): boolean {
  return process.env.LAUNCH_GATE_ENABLED === "true";
}

/**
 * Returns a safe absolute-path bypass from env, or null if unset/unsafe.
 * Never logs the value.
 */
export function getLaunchGateBypassPath(): string | null {
  const raw = process.env.LAUNCH_GATE_BYPASS_PATH?.trim();

  if (!raw) {
    return null;
  }

  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const path = normalizePathname(withSlash);

  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("://") ||
    path.includes("?") ||
    path.includes("#") ||
    path === "/" ||
    path === LAUNCH_GATE_HOLDING_PATH
  ) {
    return null;
  }

  // Never treat infrastructure/auth exempt paths as the bypass entry.
  if (isLaunchGateExemptPath(path)) {
    return null;
  }

  return path;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Cookie payload derived from the configured bypass path (not the raw path). */
export async function buildLaunchGateBypassCookieValue(
  bypassPath: string
): Promise<string> {
  return sha256Hex(`keynetic-launch-gate-v1:${bypassPath}`);
}

export async function hasValidLaunchGateBypassCookie(
  request: NextRequest,
  bypassPath: string
): Promise<boolean> {
  const expected = await buildLaunchGateBypassCookieValue(bypassPath);
  const actual = request.cookies.get(LAUNCH_GATE_COOKIE_NAME)?.value;

  if (!actual || actual.length !== expected.length) {
    return false;
  }

  // Constant-time-ish compare for equal-length hex strings.
  let mismatch = 0;

  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }

  return mismatch === 0;
}

function launchGateCookieSecure(request: NextRequest): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    request.nextUrl.protocol === "https:"
  );
}

export async function createLaunchGateBypassResponse(
  request: NextRequest,
  bypassPath: string
): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/", request.url));
  const value = await buildLaunchGateBypassCookieValue(bypassPath);

  response.cookies.set({
    name: LAUNCH_GATE_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: launchGateCookieSecure(request),
    sameSite: "lax",
    path: "/",
    maxAge: LAUNCH_GATE_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}

export function createLaunchGateHoldingRedirect(
  request: NextRequest
): NextResponse {
  const holdingUrl = request.nextUrl.clone();
  holdingUrl.pathname = LAUNCH_GATE_HOLDING_PATH;
  holdingUrl.search = "";

  return NextResponse.redirect(holdingUrl);
}

/**
 * Soft launch gate. Returns a response when the request should stop here;
 * returns null to continue into the existing auth middleware.
 */
export async function maybeHandleLaunchGate(
  request: NextRequest,
  pathname: string
): Promise<NextResponse | null> {
  if (!isLaunchGateEnabled()) {
    return null;
  }

  const bypassPath = getLaunchGateBypassPath();

  if (bypassPath && pathname === bypassPath) {
    return createLaunchGateBypassResponse(request, bypassPath);
  }

  if (isLaunchGateExemptPath(pathname)) {
    return null;
  }

  if (
    bypassPath &&
    (await hasValidLaunchGateBypassCookie(request, bypassPath))
  ) {
    return null;
  }

  if (pathname === LAUNCH_GATE_HOLDING_PATH) {
    return null;
  }

  return createLaunchGateHoldingRedirect(request);
}
