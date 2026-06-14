"use client";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";

import EaMarketingShell from "@/components/estate-agents/EaMarketingShell";
import { resolvePostLoginRedirect } from "@/lib/auth/redirects";
import { ROUTES } from "@/lib/auth/routes";
import { fetchProfileAccountFields } from "@/lib/currentUserContext";
import { supabase } from "@/lib/supabase";

const inputClassName =
  "mt-2 w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-3 disabled:bg-slate-100";

export default function EstateAgentLoginPage() {
  const [errorMessage, setErrorMessage] =
    useState("");
  const [isLoggingIn, setIsLoggingIn] =
    useState(false);
  const [isCheckingSession, setIsCheckingSession] =
    useState(true);

  useEffect(() => {
    async function redirectIfAuthenticated() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsCheckingSession(false);

        return;
      }

      const profile =
        await fetchProfileAccountFields(
          supabase,
          user.id
        );

      window.location.href =
        resolvePostLoginRedirect(
          profile ?? {
            account_type: "homeowner",
            onboarding_completed_at: null,
          }
        );
    }

    redirectIfAuthenticated();
  }, []);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setErrorMessage("");

    const formData = new FormData(
      event.currentTarget
    );

    const email = String(
      formData.get("email") ?? ""
    ).trim();
    const password = String(
      formData.get("password") ?? ""
    );

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
        setErrorMessage(result.error.message);

        return;
      }

      if (!result.data.session) {
        setErrorMessage(
          "Sign in succeeded but no session was created. Check your email verification status."
        );

        return;
      }

      const profile =
        await fetchProfileAccountFields(
          supabase,
          result.data.user.id
        );

      window.location.href =
        resolvePostLoginRedirect(
          profile ?? {
            account_type: "homeowner",
            onboarding_completed_at: null,
          }
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
    return (
      <EaMarketingShell>
        <section className="max-w-xl mx-auto px-6 py-16">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center text-slate-600">
            Checking session...
          </div>
        </section>
      </EaMarketingShell>
    );
  }

  return (
    <EaMarketingShell>
      <section className="max-w-xl mx-auto px-6 py-16">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
          <h1 className="text-4xl font-bold text-slate-900">
            Estate Agent Login
          </h1>

          <p className="mt-2 text-slate-600">
            Access your agency account
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 space-y-6"
            noValidate
          >
            <div>
              <label
                htmlFor="ea-login-email"
                className="block text-sm font-medium text-slate-700"
              >
                Business email
              </label>

              <input
                id="ea-login-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                disabled={isLoggingIn}
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="ea-login-password"
                className="block text-sm font-medium text-slate-700"
              >
                Password
              </label>

              <input
                id="ea-login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                disabled={isLoggingIn}
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
              disabled={isLoggingIn}
              className="w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold disabled:bg-slate-400"
            >
              {isLoggingIn
                ? "Signing in..."
                : "Login"}
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-600">
            Need an account?{" "}
            <Link
              href={ROUTES.estateAgentSignup}
              className="font-semibold text-slate-900 underline"
            >
              Sign up
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
