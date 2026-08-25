"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  EMAIL_VERIFICATION_ACCOUNT_ACCESS_MESSAGE,
} from "@/lib/auth/emailVerificationGate";
import { isEmailVerified } from "@/lib/auth/emailVerification";
import { ROUTES } from "@/lib/auth/routes";
import { supabase } from "@/lib/supabase";

type EmailVerificationBannerProps = {
  className?: string;
};

export default function EmailVerificationBanner({
  className = "",
}: EmailVerificationBannerProps) {
  const [showBanner, setShowBanner] =
    useState(false);

  useEffect(() => {
    async function loadVerificationState() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setShowBanner(
        Boolean(user) && !isEmailVerified(user)
      );
    }

    void loadVerificationState();
  }, []);

  if (!showBanner) {
    return null;
  }

  return (
    <div
      role="status"
      className={`rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950 ${className}`}
    >
      <p className="font-semibold">
        Verify your email to join live property transactions
      </p>

      <p className="mt-2 leading-relaxed">
        {EMAIL_VERIFICATION_ACCOUNT_ACCESS_MESSAGE}
      </p>

      <Link
        href={ROUTES.verifyEmail}
        className="mt-4 inline-flex font-semibold text-amber-950 underline underline-offset-2"
      >
        Verify email
      </Link>
    </div>
  );
}
