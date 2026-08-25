"use client";

import {
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import AuthEmailField from "@/components/auth/AuthEmailField";
import AuthErrorAlert from "@/components/auth/AuthErrorAlert";
import AuthPageShell from "@/components/auth/AuthPageShell";
import AuthPasswordFieldWithRequirements from "@/components/auth/AuthPasswordFieldWithRequirements";
import {
  AUTH_BUTTON_STACK_CLASS,
  AUTH_FORM_CLASS,
  AUTH_FOOTER_LINK_CLASS,
  AUTH_INLINE_LINK_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SECONDARY_BUTTON_CLASS,
  AUTH_SUBTITLE_CLASS,
  AUTH_TITLE_CLASS,
} from "@/components/auth/authStyles";
import CollectionPointNotice from "@/components/legal/CollectionPointNotice";
import LegalAcceptanceFields from "@/components/legal/LegalAcceptanceFields";
import { getAccountType } from "@/lib/accountType";
import {
  mapAuthSignInError,
  mapAuthSignUpError,
} from "@/lib/auth/authErrors";
import { validatePasswordForSignUp } from "@/lib/auth/passwordPolicy";
import { resolveLoginNextDestination } from "@/lib/auth/redirects";
import { ROUTES } from "@/lib/auth/routes";
import { fetchAuthenticatedProfileAccountFields } from "@/lib/currentUserContext";
import {
  LEGAL_DOCUMENT_VERSIONS,
  SIGNUP_LEGAL_ACCEPTANCE_ERROR,
} from "@/lib/legal/constants";
import {
  buildHomeownerSignupLegalAcceptance,
  flushPendingSignupLegalAcceptance,
  isSignupLegalAcceptanceComplete,
  persistSignupLegalAcceptanceAfterAuth,
} from "@/lib/legal/recordSignupLegalAcceptance";
import { ensureUserProfile } from "@/lib/profile/ensureUserProfile";
import { resolveHomeownerPostAuthDestination } from "@/lib/propertyClaim/resolveHomeownerPostAuthDestination";
import { supabase } from "@/lib/supabase";

function readCredentials(form: HTMLFormElement) {
  const formData = new FormData(form);

  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

export default function LoginPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const [errorMessage, setErrorMessage] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [isCreateAccountMode, setIsCreateAccountMode] =
    useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] =
    useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const { email, password } = readCredentials(
      event.currentTarget
    );

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

      const profileEnsure = await ensureUserProfile(supabase);

      if (!profileEnsure.ok) {
        setErrorMessage(
          "Your account is signed in but we could not finish profile setup. Try again or contact support."
        );

        return;
      }

      await flushPendingSignupLegalAcceptance(supabase);

      const nextParam = new URLSearchParams(
        window.location.search
      ).get("next");

      let destination: string;

      if (nextParam) {
        destination = resolveLoginNextDestination(
          nextParam,
          ROUTES.homeownerDashboard
        );
      } else {
        const userId = result.data.user?.id;

        destination = ROUTES.homeownerDashboard;

        if (userId) {
          const profile =
            await fetchAuthenticatedProfileAccountFields(
              supabase,
              userId
            );

          destination =
            await resolveHomeownerPostAuthDestination(
              supabase,
              getAccountType(profile)
            );
        }
      }

      window.location.href = destination;
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

  async function handleSignup() {
    if (!formRef.current) {
      return;
    }

    setIsCreateAccountMode(true);
    setErrorMessage("");

    const { email, password } = readCredentials(formRef.current);

    if (!email || !password) {
      setErrorMessage(
        "Enter your email and password to create an account."
      );

      return;
    }

    const passwordValidation =
      validatePasswordForSignUp(password);

    if (!passwordValidation.valid) {
      setErrorMessage(passwordValidation.message);

      return;
    }

    if (
      !isSignupLegalAcceptanceComplete(
        termsAccepted,
        privacyAccepted
      )
    ) {
      setErrorMessage(SIGNUP_LEGAL_ACCEPTANCE_ERROR);

      return;
    }

    setIsSigningUp(true);

    const acceptedAt = new Date().toISOString();
    const legalAcceptance = buildHomeownerSignupLegalAcceptance(
      LEGAL_DOCUMENT_VERSIONS.termsOfUse,
      LEGAL_DOCUMENT_VERSIONS.privacyPolicy,
      acceptedAt
    );

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setErrorMessage(mapAuthSignUpError(error.message));

        return;
      }

      if (data.user) {
        const legalRecord =
          await persistSignupLegalAcceptanceAfterAuth(
            supabase,
            legalAcceptance
          );

        if (!legalRecord.ok) {
          setErrorMessage(
            "Your account was created but we could not record legal acceptance. Try signing in again."
          );

          return;
        }

        if (!data.session) {
          router.push("/verify-email");

          return;
        }

        const profileEnsure = await ensureUserProfile(supabase);

        if (!profileEnsure.ok) {
          setErrorMessage(
            "Your account was created but profile setup failed. Try signing in again."
          );

          return;
        }

        const destination =
          await resolveHomeownerPostAuthDestination(
            supabase,
            "homeowner"
          );

        router.push(destination);
        return;
      }

      router.push(ROUTES.homeownerDashboard);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not create your account. Check your connection and try again."
      );
    } finally {
      setIsSigningUp(false);
    }
  }

  const isBusy = isLoggingIn || isSigningUp;

  return (
    <AuthPageShell>
      <h1 className={AUTH_TITLE_CLASS}>Log in</h1>

      <p className={AUTH_SUBTITLE_CLASS}>
        Access your property chain
      </p>

      <form
        ref={formRef}
        onSubmit={handleLogin}
        className={AUTH_FORM_CLASS}
        noValidate
      >
        <AuthEmailField
          id="login-email"
          label="Email"
          disabled={isBusy}
        />

        <AuthPasswordFieldWithRequirements
          id="login-password"
          name="password"
          label="Password"
          password={passwordValue}
          onPasswordChange={setPasswordValue}
          autoComplete="current-password"
          disabled={isBusy}
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

        {isCreateAccountMode ? (
          <LegalAcceptanceFields
            variant="homeowner"
            termsAccepted={termsAccepted}
            privacyAccepted={privacyAccepted}
            onTermsAcceptedChange={setTermsAccepted}
            onPrivacyAcceptedChange={setPrivacyAccepted}
            disabled={isBusy}
          />
        ) : null}

        <div className={AUTH_BUTTON_STACK_CLASS}>
          <button
            type="submit"
            disabled={isBusy}
            className={AUTH_PRIMARY_BUTTON_CLASS}
          >
            {isLoggingIn ? "Signing in..." : "Log in"}
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={handleSignup}
            className={AUTH_SECONDARY_BUTTON_CLASS}
          >
            {isSigningUp
              ? "Creating account..."
              : "Create account"}
          </button>
        </div>
      </form>

      <CollectionPointNotice className="mt-6" context="homeowner" />
    </AuthPageShell>
  );
}
