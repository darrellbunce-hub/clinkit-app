import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(
  request: NextRequest
) {

  let response =
    NextResponse.next({
      request,
    });

  const supabase =
    createServerClient(
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
  } =
    await supabase.auth.getUser();

    const protectedRoutes: string[] = [];

  const isProtectedRoute =
    protectedRoutes.some((route) =>
      request.nextUrl.pathname.startsWith(route)
    );

  if (
    isProtectedRoute &&
    !user
  ) {

    return NextResponse.redirect(
      new URL("/login", request.url)
    );

  }

  return response;
}

export const config = {

  matcher: [
    "/dashboard/:path*",
    "/start-move/:path*",
    "/join-chain/:path*",
  ],

};