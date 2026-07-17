"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import EaMarketingShell from "@/components/estate-agents/EaMarketingShell";
import PasswordRequirementsChecklist from "@/components/auth/PasswordRequirementsChecklist";
import { AUTH_TITLE_CLASS } from "@/components/mobileStandards";
import { mapAuthSignUpError } from "@/lib/auth/authErrors";
import { validateNewPassword } from "@/lib/auth/passwordPolicy";
import { ROUTES } from "@/lib/auth/routes";
import { validateBusinessEmail } from "@/lib/businessEmail";
import {
  formatEaBranchInvitationError,
  previewEaBranchInvitation,
} from "@/lib/estateAgent/branchTeam";
import { createEstateAgentProfile } from "@/lib/estateAgent/createEstateAgentProfile";
import { supabase } from "@/lib/supabase";

const inputClassName =
  "mt-2 w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-3 disabled:bg-slate-100";

export default function EstateAgentSignupPage() {
  return (
    <Suspense
      fallback={
        <EaMarketingShell>
          <section className="max-w-xl mx-auto px-6 py-16">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center text-slate-600">
              Loading sign up...
            </div>
          </section>
        </EaMarketingShell>
      }
    >
      <EstateAgentSignupContent />
    </Suspense>
  );
}

function EstateAgentSignupContent() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token");

  const [errorMessage, setErrorMessage] =
    useState("");
  const [isSubmitting, setIsSubmitting] =
    useState(false);
  const [prefillEmail, setPrefillEmail] =
    useState("");
  const [inviteCompanyName, setInviteCompanyName] =
    useState<string | null>(null);
  const [passwordValue, setPasswordValue] =
    useState("");
  const [confirmPasswordValue, setConfirmPasswordValue] =
    useState("");

  useEffect(() => {
    async function loadInvitePreview() {
      if (!inviteToken) {
        return;
      }

      const previewResult =
        await previewEaBranchInvitation(
          supabase,
          inviteToken
        );

      if (!previewResult.ok) {
        setErrorMessage(
          formatEaBranchInvitationError(
            previewResult.error
          )
        );
        return;
      }

      setPrefillEmail(previewResult.preview.inviteEmail);
      setInviteCompanyName(
        previewResult.preview.companyName
      );
    }

    void loadInvitePreview();
  }, [inviteToken]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setErrorMessage("");

    const formData = new FormData(
      event.currentTarget
    );

    const contactName = String(
      formData.get("contactName") ?? ""
    ).trim();
    const email = String(
      formData.get("email") ?? ""
    ).trim();
    const password = String(
      formData.get("password") ?? ""
    );
    const confirmPassword = String(
      formData.get("confirmPassword") ?? ""
    );

    if (!contactName || !email || !password) {
      setErrorMessage(
        "Complete all required fields to create your account."
      );

      return;
    }

    if (contactName.length < 2) {
      setErrorMessage(
        "Enter your contact name to continue."
      );

      return;
    }

    const emailValidation =
      validateBusinessEmail(email);

    if (!emailValidation.valid) {
      setErrorMessage(emailValidation.message);

      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage(
        "Passwords do not match."
      );

      return;
    }

    const passwordValidation = validateNewPassword(
      password,
      confirmPassword
    );

    if (!passwordValidation.valid) {
      setErrorMessage(passwordValidation.message);

      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } =
        await supabase.auth.signUp({
          email: emailValidation.email,
          password,
        });

      if (error) {
        setErrorMessage(
          mapAuthSignUpError(error.message)
        );

        return;
      }

      if (!data.user) {
        setErrorMessage(
          "Could not create your account. Try again."
        );

        return;
      }

      const profileResult =
        await createEstateAgentProfile(
          supabase,
          {
            userId: data.user.id,
            contactName,
            email: emailValidation.email,
          }
        );

      if (profileResult.error) {
        setErrorMessage(profileResult.error);

        return;
      }

      if (!data.session) {
        window.location.href =
          inviteToken
            ? `${ROUTES.estateAgentJoin}?token=${encodeURIComponent(inviteToken)}`
            : "/verify-email";

        return;
      }

      window.location.href = inviteToken
        ? `${ROUTES.estateAgentJoin}?token=${encodeURIComponent(inviteToken)}`
        : ROUTES.estateAgentOnboarding;
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not create your account. Check your connection and try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <EaMarketingShell>
      <section className="max-w-xl mx-auto px-6 py-16">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
          <h1 className={AUTH_TITLE_CLASS}>
            Estate Agent Sign Up
          </h1>

          <p className="mt-2 text-slate-600">
            {inviteCompanyName
              ? `Create your account to join ${inviteCompanyName}.`
              : "Create your agency account using your business email address."}
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 space-y-6"
            noValidate
          >
            <div>
              <label
                htmlFor="ea-contact-name"
                className="block text-sm font-medium text-slate-700"
              >
                Contact name
              </label>

              <input
                id="ea-contact-name"
                name="contactName"
                type="text"
                autoComplete="name"
                disabled={isSubmitting}
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="ea-email"
                className="block text-sm font-medium text-slate-700"
              >
                Business email
              </label>

              <input
                id="ea-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                defaultValue={prefillEmail}
                readOnly={Boolean(prefillEmail)}
                disabled={isSubmitting}
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="ea-password"
                className="block text-sm font-medium text-slate-700"
              >
                Password
              </label>

              <input
                id="ea-password"
                name="password"
                type="password"
                autoComplete="new-password"
                disabled={isSubmitting}
                value={passwordValue}
                onChange={(event) =>
                  setPasswordValue(event.target.value)
                }
                className={inputClassName}
              />

              <PasswordRequirementsChecklist
                password={passwordValue}
                className="mt-3"
              />
            </div>

            <div>
              <label
                htmlFor="ea-confirm-password"
                className="block text-sm font-medium text-slate-700"
              >
                Confirm password
              </label>

              <input
                id="ea-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                disabled={isSubmitting}
                value={confirmPasswordValue}
                onChange={(event) =>
                  setConfirmPasswordValue(
                    event.target.value
                  )
                }
                className={inputClassName}
              />
            </div>

            {errorMessage && (
              <p
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
              >
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold disabled:bg-slate-400"
            >
              {isSubmitting
                ? "Creating account..."
                : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-600">
            Already registered?{" "}
            <Link
              href={
                inviteToken
                  ? `${ROUTES.estateAgentLogin}?next=${encodeURIComponent(`${ROUTES.estateAgentJoin}?token=${encodeURIComponent(inviteToken)}`)}`
                  : ROUTES.estateAgentLogin
              }
              className="font-semibold text-slate-900 underline"
            >
              Log in
            </Link>
          </p>

          <p className="mt-3 text-sm text-slate-600">
            Homeowner?{" "}
            <Link
              href={ROUTES.homeownerLogin}
              className="font-semibold text-slate-900 underline"
            >
              Sign in here
            </Link>
          </p>
        </div>
      </section>
    </EaMarketingShell>
  );
}
