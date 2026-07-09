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
  } = await supabase.auth.getUser();

  if (!user) {
    const guardResult =
      evaluateProtectedRouteAccess(
        null,
        request.nextUrl,
        pathname
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
    evaluateProtectedRouteAccess(
      context,
      request.nextUrl,
      pathname
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
