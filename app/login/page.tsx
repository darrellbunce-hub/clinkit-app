"use client";

import {
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { AUTH_TITLE_CLASS } from "@/components/mobileStandards";
import { resolveLoginNextDestination } from "@/lib/auth/redirects";
import { ROUTES } from "@/lib/auth/routes";
import { getAccountType } from "@/lib/accountType";
import { fetchAuthenticatedProfileAccountFields } from "@/lib/currentUserContext";
import { ensureUserProfile } from "@/lib/profile/ensureUserProfile";
import PasswordRequirementsChecklist from "@/components/auth/PasswordRequirementsChecklist";
import CollectionPointNotice from "@/components/legal/CollectionPointNotice";
import {
  mapAuthSignInError,
  mapAuthSignUpError,
} from "@/lib/auth/authErrors";
import {
  validatePasswordForSignUp,
} from "@/lib/auth/passwordPolicy";
import { resolveHomeownerPostAuthDestination } from "@/lib/propertyClaim/resolveHomeownerPostAuthDestination";
import { useRouter } from "next/navigation";

function readCredentials(form: HTMLFormElement) {
  const formData = new FormData(form);

  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

export default function LoginPage() {
  const formRef =
    useRef<HTMLFormElement>(null);
  const router = useRouter();

  const [errorMessage, setErrorMessage] =
    useState("");
  const [isLoggingIn, setIsLoggingIn] =
    useState(false);
  const [isSigningUp, setIsSigningUp] =
    useState(false);
  const [passwordValue, setPasswordValue] =
    useState("");

  async function handleLogin(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setErrorMessage("");

    const { email, password } =
      readCredentials(event.currentTarget);

    if (!email || !password) {
      setErrorMessage(
        "Enter your email and password to continue."
      );

      return;
    }

    setIsLoggingIn(true);

    try {
      const result =
        await supabase.auth.signInWithPassword({
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

      const profileEnsure =
        await ensureUserProfile(supabase);

      if (!profileEnsure.ok) {
        setErrorMessage(
          "Your account is signed in but we could not finish profile setup. Try again or contact support."
        );

        return;
      }

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

    setErrorMessage("");

    const { email, password } =
      readCredentials(formRef.current);

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

    setIsSigningUp(true);

    try {
      const {
        data,
        error,
      } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setErrorMessage(
          mapAuthSignUpError(error.message)
        );

        return;
      }

      if (data.user) {
        if (!data.session) {
          router.push("/verify-email");

          return;
        }

        const profileEnsure =
          await ensureUserProfile(supabase);

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

  const isBusy =
    isLoggingIn || isSigningUp;

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-6">

      <div className="w-full max-w-md bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

        <h1 className={AUTH_TITLE_CLASS}>
          Login
        </h1>

        <p className="mt-2 text-slate-600">
          Access your property chain
        </p>

        <form
          ref={formRef}
          onSubmit={handleLogin}
          className="mt-8"
          noValidate
        >
          <div>

            <label
              htmlFor="login-email"
              className="block text-sm font-medium text-slate-700"
            >
              Email
            </label>

            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              enterKeyHint="next"
              disabled={isBusy}
              className="mt-2 w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-3 disabled:bg-slate-100"
            />

          </div>

          <div className="mt-6">

            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-slate-700"
              >
                Password
              </label>

              <Link
                href={ROUTES.forgotPassword}
                className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2"
              >
                Forgot password?
              </Link>
            </div>

            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              enterKeyHint="go"
              disabled={isBusy}
              value={passwordValue}
              onChange={(event) =>
                setPasswordValue(event.target.value)
              }
              className="mt-2 w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-3 disabled:bg-slate-100"
            />

            <PasswordRequirementsChecklist
              password={passwordValue}
              className="mt-3"
            />

          </div>

          {errorMessage && (
            <p
              role="alert"
              className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
            >
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={isBusy}
            className="mt-8 w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold disabled:bg-slate-400"
          >
            {isLoggingIn
              ? "Signing in..."
              : "Login"}
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={handleSignup}
            className="mt-4 w-full border border-slate-300 text-slate-900 rounded-2xl py-4 font-semibold disabled:bg-slate-100 disabled:text-slate-400"
          >
            {isSigningUp
              ? "Creating account..."
              : "Create Account"}
          </button>
        </form>

        <CollectionPointNotice className="mt-6" context="homeowner" />

      </div>

    </main>
  );
}
