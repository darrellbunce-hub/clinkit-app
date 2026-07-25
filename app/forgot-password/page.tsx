"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import AuthEmailField from "@/components/auth/AuthEmailField";
import AuthErrorAlert from "@/components/auth/AuthErrorAlert";
import AuthPageShell from "@/components/auth/AuthPageShell";
import AuthSuccessAlert from "@/components/auth/AuthSuccessAlert";
import {
  AUTH_FORM_CLASS,
  AUTH_INLINE_LINK_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SUBTITLE_CLASS,
  AUTH_TITLE_CLASS,
} from "@/components/auth/authStyles";
import {
  buildPasswordRecoveryConfirmUrl,
  PASSWORD_RESET_EMAIL_SENT_MESSAGE,
} from "@/lib/auth/passwordReset";
import { ROUTES } from "@/lib/auth/routes";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      const redirectTo = buildPasswordRecoveryConfirmUrl(
        window.location.origin
      );

      const { error } = await supabase.auth.resetPasswordForEmail(
        trimmedEmail,
        { redirectTo }
      );

      if (error) {
        setErrorMessage(
          "We could not send a reset email right now. Try again shortly."
        );

        return;
      }

      setSuccessMessage(PASSWORD_RESET_EMAIL_SENT_MESSAGE);
    } catch {
      setErrorMessage(
        "We could not send a reset email right now. Try again shortly."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPageShell>
      <h1 className={AUTH_TITLE_CLASS}>Forgot password</h1>

      <p className={AUTH_SUBTITLE_CLASS}>
        Enter your email and we&apos;ll send you a secure link to
        choose a new password.
      </p>

      <form
        onSubmit={handleSubmit}
        className={AUTH_FORM_CLASS}
        noValidate
      >
        <AuthEmailField
          id="forgot-email"
          label="Email"
          value={email}
          onChange={setEmail}
          disabled={isSubmitting}
        />

        {errorMessage ? (
          <AuthErrorAlert message={errorMessage} />
        ) : null}

        {successMessage ? (
          <AuthSuccessAlert message={successMessage} />
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className={AUTH_PRIMARY_BUTTON_CLASS}
        >
          {isSubmitting
            ? "Sending reset link..."
            : "Send reset link"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        <Link
          href={ROUTES.homeownerLogin}
          className={AUTH_INLINE_LINK_CLASS}
        >
          Back to Log in
        </Link>
      </p>
    </AuthPageShell>
  );
}
