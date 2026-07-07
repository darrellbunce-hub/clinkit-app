import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  resolveAuthConfirmDestination,
  resolveAuthConfirmFailureCode,
  stripAuthConfirmQueryParams,
} from "@/lib/auth/authConfirm";
import { ROUTES } from "@/lib/auth/routes";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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

function redirectToAuthConfirmDestination(
  request: NextRequest,
  destinationPath: string
) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = destinationPath;
  stripAuthConfirmQueryParams(redirectUrl);

  return NextResponse.redirect(redirectUrl);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const providerErrorCode =
    searchParams.get("error_code");
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

  const supabase =
    await createServerSupabaseClient();

  const { error } =
    await supabase.auth.verifyOtp({
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

  return redirectToAuthConfirmDestination(
    request,
    destination
  );
}
