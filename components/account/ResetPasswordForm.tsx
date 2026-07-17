"use client";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AUTH_TITLE_CLASS, CARD_PADDING_CLASS } from "@/components/mobileStandards";
import PasswordRequirementsChecklist from "@/components/auth/PasswordRequirementsChecklist";
import {
  accountAlertErrorClassName,
  accountAlertSuccessClassName,
  accountButtonPrimaryClassName,
  accountInputClassName,
} from "@/components/account/accountStyles";
import {
  mapPasswordRecoveryError,
  mapPasswordUpdateError,
  validateNewPassword,
} from "@/lib/auth/passwordPolicy";
import { resolvePasswordRecoveryQueryError } from "@/lib/auth/authConfirm";
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
  const recoveryErrorCode =
    resolvePasswordRecoveryQueryError(
      searchParams.get("error"),
      searchParams.get("error_code")
    );

  const [state, setState] =
    useState<ResetState>("loading");
  const [newPassword, setNewPassword] =
    useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");
  const [errorMessage, setErrorMessage] =
    useState("");
  const [redirectPath, setRedirectPath] = useState<string>(
    ROUTES.homeownerDashboard
  );
  const [isSubmitting, setIsSubmitting] =
    useState(false);

  useEffect(() => {
    async function verifyRecoverySession() {
      if (recoveryErrorCode) {
        setErrorMessage(
          mapPasswordRecoveryError(
            recoveryErrorCode
          )
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

      const profileEnsure =
        await ensureUserProfile(supabase);

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
        setRedirectPath(
          resolvePostLoginRedirect(profile)
        );
      }

      setState("ready");
    }

    void verifyRecoverySession();
  }, [recoveryErrorCode]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
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
      const { error } =
        await supabase.auth.updateUser({
          password: newPassword,
        });

      if (error) {
        const message =
          mapPasswordUpdateError(
            error.message
          );

        if (
          message.toLowerCase().includes("expired") ||
          message.toLowerCase().includes("invalid")
        ) {
          setErrorMessage(
            mapPasswordRecoveryError(
              "invalid_or_expired"
            )
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
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-6 py-12">
      <div className={`w-full max-w-md bg-white rounded-3xl shadow-sm border border-slate-200 ${CARD_PADDING_CLASS}`}>
        <h1 className={AUTH_TITLE_CLASS}>
          Choose a new password
        </h1>

        {state === "loading" && (
          <p className="mt-4 text-slate-600">
            Verifying your reset link...
          </p>
        )}

        {state === "error" && (
          <div className="mt-6 space-y-4">
            <p
              role="alert"
              className={accountAlertErrorClassName}
            >
              {errorMessage}
            </p>

            <Link
              href={ROUTES.forgotPassword}
              className={`block text-center ${accountButtonPrimaryClassName}`}
            >
              Request a new reset link
            </Link>

            <p className="text-center text-sm text-slate-600">
              <Link
                href={ROUTES.homeownerLogin}
                className="font-medium text-slate-900 underline underline-offset-2"
              >
                Back to login
              </Link>
            </p>
          </div>
        )}

        {state === "ready" && (
          <>
            <p className="mt-2 text-slate-600">
              Enter a new password for your account.
            </p>

            <form
              onSubmit={handleSubmit}
              className="mt-8 space-y-5"
              noValidate
            >
              <div>
                <label
                  htmlFor="reset-new-password"
                  className="block text-sm font-medium text-slate-700"
                >
                  New password
                </label>

                <input
                  id="reset-new-password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) =>
                    setNewPassword(
                      event.target.value
                    )
                  }
                  disabled={isSubmitting}
                  className={accountInputClassName}
                />

                <PasswordRequirementsChecklist
                  password={newPassword}
                  className="mt-3"
                />
              </div>

              <div>
                <label
                  htmlFor="reset-confirm-password"
                  className="block text-sm font-medium text-slate-700"
                >
                  Confirm new password
                </label>

                <input
                  id="reset-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword(
                      event.target.value
                    )
                  }
                  disabled={isSubmitting}
                  className={accountInputClassName}
                />
              </div>

              {errorMessage && (
                <p
                  role="alert"
                  className={accountAlertErrorClassName}
                >
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className={accountButtonPrimaryClassName}
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
            <p
              role="status"
              className={accountAlertSuccessClassName}
            >
              Your password has been updated. You can
              now sign in with your new password.
            </p>

            <Link
              href={redirectPath}
              className={`block text-center ${accountButtonPrimaryClassName}`}
            >
              Continue
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
