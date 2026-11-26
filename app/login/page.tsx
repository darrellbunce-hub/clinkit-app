"use client";

import {
  Suspense,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import AuthEmailField from "@/components/auth/AuthEmailField";
import AuthErrorAlert from "@/components/auth/AuthErrorAlert";
import AuthPageShell from "@/components/auth/AuthPageShell";
import AuthPasswordFieldWithRequirements from "@/components/auth/AuthPasswordFieldWithRequirements";
import {
  AUTH_BUTTON_STACK_CLASS,
  AUTH_FORM_CLASS,
  AUTH_INLINE_LINK_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SECONDARY_BUTTON_CLASS,
  AUTH_SUBTITLE_CLASS,
  AUTH_TITLE_CLASS,
} from "@/components/auth/authStyles";
import CollectionPointNotice from "@/components/legal/CollectionPointNotice";
import LegalAcceptanceFields from "@/components/legal/LegalAcceptanceFields";
import SignupLegalAcceptanceRecoveryPanel from "@/components/legal/SignupLegalAcceptanceRecoveryPanel";
import { getAccountType, isEstateAgent } from "@/lib/accountType";
import {
  mapAuthSignInError,
  mapAuthSignUpError,
} from "@/lib/auth/authErrors";
import { validatePasswordForSignUp } from "@/lib/auth/passwordPolicy";
import {
  resolveLoginNextDestination,
  resolvePostLoginRedirect,
} from "@/lib/auth/redirects";
import {
  buildHomeownerLoginHref,
  isHomeownerCreateAccountMode,
  ROUTES,
} from "@/lib/auth/routes";
import {
  buildSignupConfirmUrl,
  buildVerifyEmailPathWithNext,
} from "@/lib/auth/signupConfirm";
import { fetchAuthenticatedProfileAccountFields } from "@/lib/currentUserContext";
import { bootstrapAuthenticatedEstateAgentProfile } from "@/lib/estateAgent/flushPendingEstateAgentProfile";
import {
  LEGAL_DOCUMENT_VERSIONS,
  SIGNUP_LEGAL_ACCEPTANCE_ERROR,
  SIGNUP_LEGAL_ACCEPTANCE_PERSIST_FAILED_MESSAGE,
} from "@/lib/legal/constants";
import {
  buildHomeownerSignupLegalAcceptance,
  ensurePendingSignupLegalAcceptanceFlushed,
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

function AuthLoadingCard({ message }: { message: string }) {
  return (
    <AuthPageShell>
      <p className="text-center text-slate-600">{message}</p>
    </AuthPageShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthLoadingCard message="Loading…" />}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const isCreateAccountMode = isHomeownerCreateAccountMode(
    searchParams.get("mode")
  );
  const nextParam = searchParams.get("next");

  const [errorMessage, setErrorMessage] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] =
    useState(false);
  const [showExpiredLegalRecovery, setShowExpiredLegalRecovery] =
    useState(false);

  async function redirectAfterHomeownerAuth(
    userId: string | undefined
  ) {
    let destination: string;

    if (nextParam) {
      destination = resolveLoginNextDestination(
        nextParam,
        ROUTES.homeownerDashboard
      );
    } else {
      destination = ROUTES.homeownerDashboard;

      if (userId) {
        const profile =
          await fetchAuthenticatedProfileAccountFields(
            supabase,
            userId
          );

        if (isEstateAgent(profile)) {
          destination = resolvePostLoginRedirect(
            profile ?? {
              account_type: "estate_agent",
              onboarding_completed_at: null,
            }
          );
        } else {
          destination =
            await resolveHomeownerPostAuthDestination(
              supabase,
              getAccountType(profile)
            );
        }
      }
    }

    window.location.href = destination;
  }

  function setAuthMode(mode: "login" | "create") {
    setErrorMessage("");
    router.replace(
      buildHomeownerLoginHref({
        mode,
        next: nextParam,
      }),
      { scroll: false }
    );
  }

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

      const profileBootstrap =
        await bootstrapAuthenticatedEstateAgentProfile(supabase);

      if (!profileBootstrap.ok) {
        setErrorMessage(
          "Your account is signed in but we could not finish profile setup. Please try signing in again."
        );

        return;
      }

      const legalFlush =
        await ensurePendingSignupLegalAcceptanceFlushed(
          supabase
        );

      if (!legalFlush.ok) {
        setShowExpiredLegalRecovery(
          legalFlush.disposition === "expired"
        );
        setErrorMessage(
          legalFlush.message ??
            "We could not save your Terms of Service and Privacy Policy acceptance. Please try again."
        );

        return;
      }

      setShowExpiredLegalRecovery(false);
      await redirectAfterHomeownerAuth(result.data.user?.id);
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

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formRef.current) {
      return;
    }

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
      LEGAL_DOCUMENT_VERSIONS.termsOfService,
      LEGAL_DOCUMENT_VERSIONS.privacyPolicy,
      acceptedAt
    );

    const safeNext = resolveLoginNextDestination(
      nextParam,
      ROUTES.homeownerDashboard
    );

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: buildSignupConfirmUrl(
            window.location.origin,
            safeNext
          ),
        },
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
            SIGNUP_LEGAL_ACCEPTANCE_PERSIST_FAILED_MESSAGE
          );

          return;
        }

        if (!data.session) {
          router.push(buildVerifyEmailPathWithNext(safeNext));

          return;
        }

        const profileEnsure = await ensureUserProfile(supabase);

        if (!profileEnsure.ok) {
          setErrorMessage(
            "Your account was created but profile setup failed. Try signing in again."
          );

          return;
        }

        if (nextParam) {
          router.push(safeNext);
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

      router.push(safeNext);
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
      <h1 className={AUTH_TITLE_CLASS}>
        {isCreateAccountMode ? "Create account" : "Log in"}
      </h1>

      <p className={AUTH_SUBTITLE_CLASS}>
        {isCreateAccountMode
          ? "Create your MoveLoop account"
          : "Access your property chain"}
      </p>

      <form
        ref={formRef}
        onSubmit={
          isCreateAccountMode ? handleSignup : handleLogin
        }
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
          autoComplete={
            isCreateAccountMode
              ? "new-password"
              : "current-password"
          }
          disabled={isBusy}
          showRequirements={isCreateAccountMode}
          labelAccessory={
            isCreateAccountMode ? null : (
              <Link
                href={ROUTES.forgotPassword}
                className={AUTH_INLINE_LINK_CLASS}
              >
                Forgot password?
              </Link>
            )
          }
        />

        {errorMessage ? (
          <AuthErrorAlert message={errorMessage} />
        ) : null}

        {showExpiredLegalRecovery ? (
          <SignupLegalAcceptanceRecoveryPanel
            mode="expired"
            message={null}
            onCleared={() => {
              void (async () => {
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                await redirectAfterHomeownerAuth(user?.id);
              })();
            }}
          />
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
          {isCreateAccountMode ? (
            <>
              <button
                type="submit"
                disabled={isBusy}
                className={AUTH_PRIMARY_BUTTON_CLASS}
              >
                {isSigningUp
                  ? "Creating account..."
                  : "Create account"}
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => setAuthMode("login")}
                className={AUTH_SECONDARY_BUTTON_CLASS}
              >
                Log in
              </button>
            </>
          ) : (
            <>
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
                onClick={() => setAuthMode("create")}
                className={AUTH_SECONDARY_BUTTON_CLASS}
              >
                Create account
              </button>
            </>
          )}
        </div>
      </form>

      <CollectionPointNotice className="mt-6" context="homeowner" />
    </AuthPageShell>
  );
}
