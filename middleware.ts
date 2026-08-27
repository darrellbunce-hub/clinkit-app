import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { evaluateProtectedRouteAccess } from "@/lib/auth/routeGuards";
import {
  isAccountGatedRoute,
  normalizePathname,
  ROUTES,
} from "@/lib/auth/routes";
import { fetchCurrentUserContextFromUser } from "@/lib/currentUserContext";
import { maybeHandleLaunchGate } from "@/lib/launchGate";

export async function middleware(
  request: NextRequest
) {
  const pathname = normalizePathname(
    request.nextUrl.pathname
  );

  const launchGateResponse = await maybeHandleLaunchGate(
    request,
    pathname
  );

  if (launchGateResponse) {
    return launchGateResponse;
  }

  const response = NextResponse.next({
    request,
  });

  // Public / exempt routes: skip auth client work (unchanged behaviour when
  // the launch gate is off, and for gated testers on public pages).
  if (!isAccountGatedRoute(pathname)) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value;
        },

        set(name, value, options) {
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },

        remove(name, options) {
          response.cookies.set({
            name,
            value: "",
            ...options,
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const guardResult =
      await evaluateProtectedRouteAccess(
        null,
        request.nextUrl,
        pathname,
        supabase
      );

    if (!guardResult.allowed) {
      return NextResponse.redirect(
        new URL(
          guardResult.redirectTo,
          request.url
        )
      );
    }

    return response;
  }

  const context =
    await fetchCurrentUserContextFromUser(
      supabase,
      user
    );

  if (!context) {
    const loginUrl = new URL(
      ROUTES.homeownerLogin,
      request.url
    );
    loginUrl.searchParams.set(
      "error",
      "profile_setup_failed"
    );

    return NextResponse.redirect(loginUrl);
  }

  const guardResult =
    await evaluateProtectedRouteAccess(
      context,
      request.nextUrl,
      pathname,
      supabase
    );

  if (!guardResult.allowed) {
    return NextResponse.redirect(
      new URL(
        guardResult.redirectTo,
        request.url
      )
    );
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except Next internals and common static assets.
     * Launch-gate exemptions (API, auth confirm, etc.) are enforced in code.
     */
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff|woff2)$).*)",
  ],
};
