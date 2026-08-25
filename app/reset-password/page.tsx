"use client";

import { Suspense } from "react";

import AuthPageShell from "@/components/auth/AuthPageShell";
import {
  AUTH_SUBTITLE_CLASS,
  AUTH_TITLE_CLASS,
} from "@/components/auth/authStyles";
import ResetPasswordForm from "@/components/account/ResetPasswordForm";

function ResetPasswordFallback() {
  return (
    <AuthPageShell>
      <h1 className={AUTH_TITLE_CLASS}>Choose a new password</h1>

      <p className={AUTH_SUBTITLE_CLASS}>
        Verifying your reset link...
      </p>
    </AuthPageShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
