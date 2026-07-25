"use client";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import AuthErrorAlert from "@/components/auth/AuthErrorAlert";
import AuthPageShell from "@/components/auth/AuthPageShell";
import AuthPasswordFieldWithRequirements from "@/components/auth/AuthPasswordFieldWithRequirements";
import AuthSuccessAlert from "@/components/auth/AuthSuccessAlert";
import AuthTextField from "@/components/auth/AuthTextField";
import {
  AUTH_FORM_CLASS,
  AUTH_INLINE_LINK_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SUBTITLE_CLASS,
  AUTH_TITLE_CLASS,
} from "@/components/auth/authStyles";
import { resolvePasswordRecoveryQueryError } from "@/lib/auth/authConfirm";
import {
  mapPasswordRecoveryError,
  mapPasswordUpdateError,
  validateNewPassword,
} from "@/lib/auth/passwordPolicy";
import { resolvePostLoginRedirect } from "@/lib/auth/redirects";
import { ROUTES } from "@/lib/auth/routes";
import { fetchAuthenticatedProfileAccountFields } from "@/lib/currentUserContext";
import { ensureUserProfile } from "@/lib/profile/ensureUserProfile";
import { supabase } from "@/lib/supabase";

type ResetState =
  | "loading"
  | "ready"
  | "success"
  | "error";

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const recoveryErrorCode = resolvePasswordRecoveryQueryError(
    searchParams.get("error"),
    searchParams.get("error_code")
  );

  const [state, setState] = useState<ResetState>("loading");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [redirectPath, setRedirectPath] = useState<string>(
    ROUTES.homeownerDashboard
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function verifyRecoverySession() {
      if (recoveryErrorCode) {
        setErrorMessage(
          mapPasswordRecoveryError(recoveryErrorCode)
        );
        setState("error");

        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setErrorMessage(
          mapPasswordRecoveryError("no_session")
        );
        setState("error");

        return;
      }

      const profileEnsure = await ensureUserProfile(supabase);

      if (!profileEnsure.ok) {
        setErrorMessage(
          "We could not finish profile setup for your account. Try signing in again."
        );
        setState("error");

        return;
      }

      const profile =
        await fetchAuthenticatedProfileAccountFields(
          supabase,
          user.id
        );

      if (profile) {
        setRedirectPath(resolvePostLoginRedirect(profile));
      }

      setState("ready");
    }

    void verifyRecoverySession();
  }, [recoveryErrorCode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const validation = validateNewPassword(
      newPassword,
      confirmPassword
    );

    if (!validation.valid) {
      setErrorMessage(validation.message);

      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        const message = mapPasswordUpdateError(error.message);

        if (
          message.toLowerCase().includes("expired") ||
          message.toLowerCase().includes("invalid")
        ) {
          setErrorMessage(
            mapPasswordRecoveryError("invalid_or_expired")
          );
          setState("error");
        } else {
          setErrorMessage(message);
        }

        return;
      }

      setState("success");
    } catch {
      setErrorMessage(
        "We could not update your password. Try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPageShell>
      <h1 className={AUTH_TITLE_CLASS}>Choose a new password</h1>

      {state === "loading" && (
        <p className="mt-4 text-slate-600">
          Verifying your reset link...
        </p>
      )}

      {state === "error" && (
        <div className="mt-6 space-y-4">
          <AuthErrorAlert message={errorMessage} />

          <Link
            href={ROUTES.forgotPassword}
            className={`block text-center ${AUTH_PRIMARY_BUTTON_CLASS}`}
          >
            Request a new reset link
          </Link>

          <p className="text-center text-sm text-slate-600">
            <Link
              href={ROUTES.homeownerLogin}
              className={AUTH_INLINE_LINK_CLASS}
            >
              Back to Log in
            </Link>
          </p>
        </div>
      )}

      {state === "ready" && (
        <>
          <p className={AUTH_SUBTITLE_CLASS}>
            Enter a new password for your account.
          </p>

          <form
            onSubmit={handleSubmit}
            className={AUTH_FORM_CLASS}
            noValidate
          >
            <AuthPasswordFieldWithRequirements
              id="reset-new-password"
              name="newPassword"
              label="New password"
              password={newPassword}
              onPasswordChange={setNewPassword}
              autoComplete="new-password"
              disabled={isSubmitting}
            />

            <AuthTextField
              id="reset-confirm-password"
              name="confirmPassword"
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              disabled={isSubmitting}
            />

            {errorMessage ? (
              <AuthErrorAlert message={errorMessage} />
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className={AUTH_PRIMARY_BUTTON_CLASS}
            >
              {isSubmitting
                ? "Updating password..."
                : "Update password"}
            </button>
          </form>
        </>
      )}

      {state === "success" && (
        <div className="mt-6 space-y-4">
          <AuthSuccessAlert message="Your password has been updated. You can now sign in with your new password." />

          <Link
            href={redirectPath}
            className={`block text-center ${AUTH_PRIMARY_BUTTON_CLASS}`}
          >
            Continue
          </Link>
        </div>
      )}
    </AuthPageShell>
  );
}
