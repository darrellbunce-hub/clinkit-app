import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  isAuthConfirmRecoveryType,
  isAuthConfirmSignupType,
  resolveAuthConfirmCodeFlow,
  resolveAuthConfirmDestination,
  resolveAuthConfirmFailureCode,
  resolveSignupConfirmDestination,
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

function redirectToSignupConfirmError(
  request: NextRequest,
  errorCode: string
) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = ROUTES.verifyEmail;
  redirectUrl.search = "";
  redirectUrl.searchParams.set("error", errorCode);

  return NextResponse.redirect(redirectUrl);
}

/**
 * Create a server client that writes the auth session onto the redirect
 * response. Required so verifyOtp / exchangeCodeForSession cookies survive
 * the 307 to the post-confirm destination.
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

function buildSuccessRedirect(
  request: NextRequest,
  pathnameAndSearch: string
) {
  // Build a clean destination URL so confirm query params (token_hash, type,
  // code, next) are not carried forward. Destination may itself include a
  // sanitised `next` (signup → /verify-email?verified=1&next=…).
  const successUrl = new URL(
    pathnameAndSearch,
    request.nextUrl.origin
  );

  return NextResponse.redirect(successUrl);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const providerErrorCode = searchParams.get("error_code");
  const nextParam = searchParams.get("next");
  const codeFlow = resolveAuthConfirmCodeFlow(nextParam);

  if (providerErrorCode) {
    const failureCode = resolveAuthConfirmFailureCode({
      tokenHash,
      type,
      providerErrorCode,
    });

    if (
      isAuthConfirmSignupType(type) ||
      (!type && codeFlow === "signup")
    ) {
      return redirectToSignupConfirmError(request, failureCode);
    }

    return redirectToPasswordRecoveryError(request, failureCode);
  }

  // PKCE / default ConfirmationURL redirects land with ?code= (no token_hash).
  if (code) {
    const destinationPath =
      codeFlow === "signup"
        ? resolveSignupConfirmDestination(nextParam)
        : resolveAuthConfirmDestination(nextParam);
    const redirectResponse = buildSuccessRedirect(
      request,
      destinationPath
    );
    const supabase = createConfirmRedirectClient(
      request,
      redirectResponse
    );

    const { error } =
      await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      const failureCode = resolveAuthConfirmFailureCode({
        tokenHash,
        type,
        verifyError: error,
      });

      if (codeFlow === "signup") {
        return redirectToSignupConfirmError(request, failureCode);
      }

      return redirectToPasswordRecoveryError(request, failureCode);
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

  if (isAuthConfirmSignupType(type)) {
    const destinationPath =
      resolveSignupConfirmDestination(nextParam);
    const redirectResponse = buildSuccessRedirect(
      request,
      destinationPath
    );
    const supabase = createConfirmRedirectClient(
      request,
      redirectResponse
    );

    const { error } = await supabase.auth.verifyOtp({
      type: "signup",
      token_hash: tokenHash,
    });

    if (error) {
      return redirectToSignupConfirmError(
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

  if (!isAuthConfirmRecoveryType(type)) {
    return redirectToPasswordRecoveryError(
      request,
      resolveAuthConfirmFailureCode({
        tokenHash,
        type,
      })
    );
  }

  const recoveryDestination =
    resolveAuthConfirmDestination(nextParam);
  const redirectResponse = buildSuccessRedirect(
    request,
    recoveryDestination
  );
  const supabase = createConfirmRedirectClient(
    request,
    redirectResponse
  );

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
