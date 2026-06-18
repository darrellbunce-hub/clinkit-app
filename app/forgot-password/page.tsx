"use client";

import {
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";

import { AUTH_TITLE_CLASS, CARD_PADDING_CLASS } from "@/components/mobileStandards";
import {
  accountAlertErrorClassName,
  accountAlertSuccessClassName,
  accountButtonPrimaryClassName,
  accountInputClassName,
} from "@/components/account/accountStyles";
import {
  buildPasswordRecoveryConfirmUrl,
  PASSWORD_RESET_EMAIL_SENT_MESSAGE,
} from "@/lib/auth/passwordReset";
import { ROUTES } from "@/lib/auth/routes";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] =
    useState("");
  const [successMessage, setSuccessMessage] =
    useState("");
  const [isSubmitting, setIsSubmitting] =
    useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErrorMessage(
        "Enter the email address for your account."
      );

      return;
    }

    setIsSubmitting(true);

    try {
      const redirectTo =
        buildPasswordRecoveryConfirmUrl(
          window.location.origin
        );

      const { error } =
        await supabase.auth.resetPasswordForEmail(
          trimmedEmail,
          { redirectTo }
        );

      if (error) {
        setErrorMessage(
          "We could not send a reset email right now. Try again shortly."
        );

        return;
      }

      setSuccessMessage(
        PASSWORD_RESET_EMAIL_SENT_MESSAGE
      );
    } catch {
      setErrorMessage(
        "We could not send a reset email right now. Try again shortly."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-6 py-12">
      <div className={`w-full max-w-md bg-white rounded-3xl shadow-sm border border-slate-200 ${CARD_PADDING_CLASS}`}>
        <h1 className={AUTH_TITLE_CLASS}>
          Forgot password
        </h1>

        <p className="mt-2 text-slate-600">
          Enter your email and we&apos;ll send you a
          secure link to choose a new password.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8"
          noValidate
        >
          <div>
            <label
              htmlFor="forgot-email"
              className="block text-sm font-medium text-slate-700"
            >
              Email
            </label>

            <input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              disabled={isSubmitting}
              className={accountInputClassName}
            />
          </div>

          {errorMessage && (
            <p
              role="alert"
              className={`mt-6 ${accountAlertErrorClassName}`}
            >
              {errorMessage}
            </p>
          )}

          {successMessage && (
            <p
              role="status"
              className={`mt-6 ${accountAlertSuccessClassName}`}
            >
              {successMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={`mt-8 ${accountButtonPrimaryClassName}`}
          >
            {isSubmitting
              ? "Sending reset link..."
              : "Send reset link"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          <Link
            href={ROUTES.homeownerLogin}
            className="font-medium text-slate-900 underline underline-offset-2"
          >
            Back to login
          </Link>
        </p>
      </div>
    </main>
  );
}
