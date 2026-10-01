"use client";

import {
  Suspense,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import AuthEmailField from "@/components/auth/AuthEmailField";
import AuthErrorAlert from "@/components/auth/AuthErrorAlert";
import AuthPasswordFieldWithRequirements from "@/components/auth/AuthPasswordFieldWithRequirements";
import {
  AUTH_CARD_CLASS,
  AUTH_EA_SECTION_CLASS,
  AUTH_FORM_CLASS,
  AUTH_FOOTER_LINK_CLASS,
  AUTH_FOOTER_TEXT_CLASS,
  AUTH_INLINE_LINK_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SUBTITLE_CLASS,
  AUTH_TITLE_CLASS,
} from "@/components/auth/authStyles";
import EaMarketingShell from "@/components/estate-agents/EaMarketingShell";
import { mapAuthSignInError } from "@/lib/auth/authErrors";
import {
  resolveLoginNextDestination,
  resolvePostLoginRedirect,
} from "@/lib/auth/redirects";
import { ROUTES } from "@/lib/auth/routes";
import { fetchAuthenticatedProfileAccountFields } from "@/lib/currentUserContext";
import { bootstrapAuthenticatedEstateAgentProfile } from "@/lib/estateAgent/flushPendingEstateAgentProfile";
import { flushPendingSignupLegalAcceptance } from "@/lib/legal/recordSignupLegalAcceptance";
import { supabase } from "@/lib/supabase";

function AuthLoadingCard({
  message,
}: {
  message: string;
}) {
  return (
    <EaMarketingShell>
      <section className={AUTH_EA_SECTION_CLASS}>
        <div
          className={`${AUTH_CARD_CLASS} text-center text-slate-600`}
        >
          {message}
        </div>
      </section>
    </EaMarketingShell>
  );
}

export default function EstateAgentLoginPage() {
  return (
    <Suspense fallback={<AuthLoadingCard message="Loading…" />}>
      <EstateAgentLoginContent />
    </Suspense>
  );
}

function EstateAgentLoginContent() {
  const searchParams = useSearchParams();
  const nextDestination = searchParams.get("next");

  const [errorMessage, setErrorMessage] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isCheckingSession, setIsCheckingSession] =
    useState(true);
  const [passwordValue, setPasswordValue] = useState("");

  useEffect(() => {
    async function redirectIfAuthenticated() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsCheckingSession(false);

        return;
      }

      const profileBootstrap =
        await bootstrapAuthenticatedEstateAgentProfile(supabase);

      if (!profileBootstrap.ok) {
        setIsCheckingSession(false);
        setErrorMessage(
          "We could not finish profile setup for your account. Try again or contact support."
        );

        return;
      }

      await flushPendingSignupLegalAcceptance(supabase);

      const profile =
        await fetchAuthenticatedProfileAccountFields(
          supabase,
          user.id
        );

      if (!profile) {
        setIsCheckingSession(false);
        setErrorMessage(
          "We could not load your profile. Try again or contact support."
        );

        return;
      }

      window.location.href = resolveLoginNextDestination(
        nextDestination,
        resolvePostLoginRedirect(profile)
      );
    }

    redirectIfAuthenticated();
  }, [nextDestination]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const formData = new FormData(event.currentTarget);

    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setErrorMessage(
        "Enter your email and password to continue."
      );

      return;
    }

    setIsLoggingIn(true);

    try {
      const result = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (result.error) {
        setErrorMessage(
          mapAuthSignInError(result.error.message)
        );

        return;
      }

      if (!result.data.session) {
        setErrorMessage(
          "Sign in succeeded but no session was created. Check your email verification status."
        );

        return;
      }

      const profileBootstrap =
        await bootstrapAuthenticatedEstateAgentProfile(supabase);

      if (!profileBootstrap.ok) {
        setErrorMessage(
          "Your account is signed in but we could not finish profile setup. Try again or contact support."
        );

        return;
      }

      await flushPendingSignupLegalAcceptance(supabase);

      const profile =
        await fetchAuthenticatedProfileAccountFields(
          supabase,
          result.data.user.id
        );

      if (!profile) {
        setErrorMessage(
          "We could not load your profile. Try again or contact support."
        );

        return;
      }

      window.location.href = resolveLoginNextDestination(
        nextDestination,
        resolvePostLoginRedirect(profile)
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not sign in. Check your connection and try again."
      );
    } finally {
      setIsLoggingIn(false);
    }
  }

  if (isCheckingSession) {
    return <AuthLoadingCard message="Checking session…" />;
  }

  return (
    <EaMarketingShell>
      <section className={AUTH_EA_SECTION_CLASS}>
        <div className={AUTH_CARD_CLASS}>
          <h1 className={AUTH_TITLE_CLASS}>Log in</h1>

          <p className={AUTH_SUBTITLE_CLASS}>
            Access your agency account
          </p>

          <form
            onSubmit={handleSubmit}
            className={AUTH_FORM_CLASS}
            noValidate
          >
            <AuthEmailField
              id="ea-login-email"
              label="Work email"
              disabled={isLoggingIn}
            />

            <AuthPasswordFieldWithRequirements
              id="ea-login-password"
              name="password"
              label="Password"
              password={passwordValue}
              onPasswordChange={setPasswordValue}
              autoComplete="current-password"
              disabled={isLoggingIn}
              labelAccessory={
                <Link
                  href={ROUTES.forgotPassword}
                  className={AUTH_INLINE_LINK_CLASS}
                >
                  Forgot password?
                </Link>
              }
            />

            {errorMessage ? (
              <AuthErrorAlert message={errorMessage} />
            ) : null}

            <button
              type="submit"
              disabled={isLoggingIn}
              className={AUTH_PRIMARY_BUTTON_CLASS}
            >
              {isLoggingIn ? "Signing in..." : "Log in"}
            </button>
          </form>

          <p className={AUTH_FOOTER_TEXT_CLASS}>
            Need an account?{" "}
            <Link
              href={ROUTES.estateAgentSignup}
              className={AUTH_FOOTER_LINK_CLASS}
            >
              Create account
            </Link>
          </p>

          <p className="mt-3 text-sm text-slate-600">
            Homeowner?{" "}
            <Link
              href={ROUTES.homeownerLogin}
              className={AUTH_FOOTER_LINK_CLASS}
            >
              Log in here
            </Link>
          </p>
        </div>
      </section>
    </EaMarketingShell>
  );
}
