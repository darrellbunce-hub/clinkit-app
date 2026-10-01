import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  resolveAuthConfirmDestination,
  resolveAuthConfirmFailureCode,
  stripAuthConfirmQueryParams,
} from "@/lib/auth/authConfirm";
import { ROUTES } from "@/lib/auth/routes";

function redirectToPasswordRecoveryError(
  request: NextRequest,
  errorCode: string
) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = ROUTES.resetPassword;
  redirectUrl.search = "";
  redirectUrl.searchParams.set("error", errorCode);

  return NextResponse.redirect(redirectUrl);
}

/**
 * Create a server client that writes the auth session onto the redirect
 * response. Required so verifyOtp / exchangeCodeForSession cookies survive
 * the 307 to /reset-password.
 */
function createConfirmRedirectClient(
  request: NextRequest,
  redirectResponse: NextResponse
) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            redirectResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const providerErrorCode = searchParams.get("error_code");
  const destination = resolveAuthConfirmDestination(
    searchParams.get("next")
  );

  if (providerErrorCode) {
    return redirectToPasswordRecoveryError(
      request,
      resolveAuthConfirmFailureCode({
        tokenHash,
        type,
        providerErrorCode,
      })
    );
  }

  const successUrl = request.nextUrl.clone();
  successUrl.pathname = destination;
  stripAuthConfirmQueryParams(successUrl);
  const redirectResponse = NextResponse.redirect(successUrl);
  const supabase = createConfirmRedirectClient(
    request,
    redirectResponse
  );

  // PKCE / default ConfirmationURL redirects land with ?code= (no token_hash).
  if (code) {
    const { error } =
      await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return redirectToPasswordRecoveryError(
        request,
        resolveAuthConfirmFailureCode({
          tokenHash,
          type,
          verifyError: error,
        })
      );
    }

    return redirectResponse;
  }

  if (!tokenHash || !type) {
    return redirectToPasswordRecoveryError(
      request,
      resolveAuthConfirmFailureCode({
        tokenHash,
        type,
      })
    );
  }

  if (type !== "recovery") {
    return redirectToPasswordRecoveryError(
      request,
      resolveAuthConfirmFailureCode({
        tokenHash,
        type,
      })
    );
  }

  const { error } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: tokenHash,
  });

  if (error) {
    return redirectToPasswordRecoveryError(
      request,
      resolveAuthConfirmFailureCode({
        tokenHash,
        type,
        verifyError: error,
      })
    );
  }

  return redirectResponse;
}
