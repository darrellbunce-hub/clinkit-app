"use client";

import Link from "next/link";
import {
  Suspense,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";

import Navbar from "@/components/Navbar";
import { PAGE_TITLE_INVERTED_CLASS } from "@/components/mobileStandards";
import {
  EMAIL_VERIFICATION_TRANSACTION_MESSAGE,
} from "@/lib/auth/emailVerificationGate";
import { ROUTES } from "@/lib/auth/routes";
import {
  BTN_ACCENT_CLASS,
  HERO_GLOW_PRIMARY_CLASS,
  HERO_GLOW_SECONDARY_CLASS,
  HERO_GRADIENT_CLASS,
} from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const blockedForTransaction =
    searchParams.get("reason") ===
    "transaction_participation";
  const nextDestination =
    searchParams.get("next");

  const [email, setEmail] = useState("");
  const [statusMessage, setStatusMessage] =
    useState("");
  const [errorMessage, setErrorMessage] =
    useState("");
  const [isResending, setIsResending] =
    useState(false);

  useEffect(() => {
    async function loadPendingEmail() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.email) {
        setEmail(user.email);
      }
    }

    void loadPendingEmail();
  }, []);

  async function handleResend(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setStatusMessage("");
    setErrorMessage("");

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErrorMessage(
        "Enter the email address you used to sign up."
      );

      return;
    }

    setIsResending(true);

    try {
      const { error } =
        await supabase.auth.resend({
          type: "signup",
          email: trimmedEmail,
        });

      if (error) {
        setErrorMessage(
          "We could not resend the verification email right now. Try again shortly."
        );

        return;
      }

      setStatusMessage(
        "If your account is pending verification, we have sent another email. Check your inbox and spam folder."
      );
    } catch {
      setErrorMessage(
        "We could not resend the verification email right now. Try again shortly."
      );
    } finally {
      setIsResending(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 overflow-hidden">
      <Navbar />

      <div className={`absolute inset-0 ${HERO_GRADIENT_CLASS}`} />

      <div className={HERO_GLOW_PRIMARY_CLASS} />

      <div className={HERO_GLOW_SECONDARY_CLASS} />

      <section className="relative z-10 flex items-center justify-center px-6 py-24">
        <div
          className="
            w-full
            max-w-2xl
            bg-white/10
            backdrop-blur-xl
            border
            border-white/10
            rounded-3xl
            p-10
            text-center
          "
        >
          <div
            className="
              w-24
              h-24
              rounded-3xl
              bg-blue-500/20
              border
              border-blue-400/30
              flex
              items-center
              justify-center
              mx-auto
            "
          >
            <span className="text-5xl">✉️</span>
          </div>

          <h1
            className={`mt-10 ${PAGE_TITLE_INVERTED_CLASS} leading-tight`}
          >
            Verify Your Email
          </h1>

          <p className="mt-6 text-xl text-slate-300 leading-relaxed">
            We&apos;ve sent a verification email to your inbox.
            {blockedForTransaction
              ? " Verify your email before participating in a live property transaction."
              : " Verify your account to unlock live property transaction features."}
          </p>

          {blockedForTransaction && (
            <p
              role="status"
              className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-4 text-amber-100"
            >
              {EMAIL_VERIFICATION_TRANSACTION_MESSAGE}
            </p>
          )}

          <div
            className="
              mt-10
              bg-blue-500/10
              border
              border-blue-400/20
              rounded-2xl
              p-6
            "
          >
            <p className="text-blue-100 text-lg">
              Once verified, you&apos;ll be able to:
              <br />
              • Create property chains
              <br />
              • Join existing transactions
              <br />
              • Follow your move with live shared updates
            </p>
          </div>

          <form
            onSubmit={handleResend}
            className="mt-10 max-w-md mx-auto text-left"
            noValidate
          >
            <label
              htmlFor="verify-email"
              className="block text-sm font-medium text-slate-200"
            >
              Email address
            </label>

            <input
              id="verify-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              disabled={isResending}
              className="mt-2 w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder:text-slate-400 disabled:opacity-60"
            />

            {errorMessage && (
              <p
                role="alert"
                className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100"
              >
                {errorMessage}
              </p>
            )}

            {statusMessage && (
              <p
                role="status"
                className="mt-4 rounded-2xl border border-green-400/30 bg-green-500/10 px-4 py-3 text-sm text-green-100"
              >
                {statusMessage}
              </p>
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href={
                  nextDestination ?? ROUTES.homeownerLogin
                }
                className={`${BTN_ACCENT_CLASS} px-8 py-4 text-center`}
              >
                Return To Account
              </Link>

              <button
                type="submit"
                disabled={isResending}
                className="
                  border
                  border-white/20
                  bg-white/10
                  text-white
                  px-8
                  py-4
                  rounded-2xl
                  font-semibold
                  hover:bg-white/20
                  transition
                  disabled:opacity-60
                "
              >
                {isResending
                  ? "Sending..."
                  : "Resend Verification"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950" />
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
