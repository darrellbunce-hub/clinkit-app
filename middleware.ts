import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { evaluateProtectedRouteAccess } from "@/lib/auth/routeGuards";
import {
  isAccountGatedRoute,
  normalizePathname,
} from "@/lib/auth/routes";
import {
  buildFallbackHomeownerContext,
  fetchCurrentUserContextFromUser,
} from "@/lib/currentUserContext";

const isAuthDebugEnabled =
  process.env.NODE_ENV === "development";

export async function middleware(
  request: NextRequest
) {
  let response = NextResponse.next({
    request,
  });

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

  const pathname = normalizePathname(
    request.nextUrl.pathname
  );

  if (!isAccountGatedRoute(pathname)) {
    return response;
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (isAuthDebugEnabled) {
    console.log("[middleware auth]", {
      pathname,
      hasUser: Boolean(user),
      authError: authError?.message ?? null,
      cookieCount: request.cookies.getAll().length,
    });
  }

  if (!user) {
    const guardResult =
      evaluateProtectedRouteAccess(
        null,
        request.nextUrl,
        pathname
      );

    if (isAuthDebugEnabled) {
      console.log("[middleware redirect]", {
        pathname,
        reason: guardResult.allowed
          ? null
          : guardResult.reason,
        redirectTo: guardResult.allowed
          ? null
          : guardResult.redirectTo,
      });
    }

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

  const resolvedContext =
    await fetchCurrentUserContextFromUser(
      supabase,
      user
    );

  const context =
    resolvedContext ??
    buildFallbackHomeownerContext(user);

  if (isAuthDebugEnabled) {
    console.log("[middleware profile]", {
      pathname,
      userId: user.id,
      profileLoaded: Boolean(resolvedContext),
      accountType: context.accountType,
    });
  }

  const guardResult =
    evaluateProtectedRouteAccess(
      context,
      request.nextUrl,
      pathname
    );

  if (isAuthDebugEnabled && !guardResult.allowed) {
    console.log("[middleware redirect]", {
      pathname,
      reason: guardResult.reason,
      redirectTo: guardResult.redirectTo,
      accountType: context.accountType,
    });
  }

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
    "/account/:path*",
    "/dashboard/:path*",
    "/start-move/:path*",
    "/join-chain/:path*",
    "/my-chains/:path*",
    "/claim/:path*",
    "/chain/:path*",
    "/property/:path*",
    "/buyer-ready/:path*",
    "/agent/:path*",
    "/estate-agents/onboarding/:path*",
  ],
};
