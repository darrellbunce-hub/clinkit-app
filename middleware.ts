import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedRoutes = [
  "/dashboard",
  "/start-move",
  "/join-chain",
];

export function middleware(
  request: NextRequest
) {

  const token =
    request.cookies.get(
      "sb-access-token"
    );

  const isProtectedRoute =
    protectedRoutes.some((route) =>
      request.nextUrl.pathname.startsWith(route)
    );

  // if (
//   isProtectedRoute &&
//   !token
// ) {

//   return NextResponse.redirect(
//     new URL("/login", request.url)
//   );
// }

  return NextResponse.next();
}

export const config = {

  matcher: [
    "/dashboard/:path*",
    "/start-move/:path*",
    "/join-chain/:path*",
  ],

};