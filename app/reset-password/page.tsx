"use client";

import { Suspense } from "react";

import ResetPasswordForm from "@/components/account/ResetPasswordForm";
import { AUTH_TITLE_CLASS, CARD_PADDING_CLASS } from "@/components/mobileStandards";

function ResetPasswordFallback() {
  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-6 py-12">
      <div className={`w-full max-w-md bg-white rounded-3xl shadow-sm border border-slate-200 ${CARD_PADDING_CLASS}`}>
        <h1 className={AUTH_TITLE_CLASS}>
          Choose a new password
        </h1>

        <p className="mt-4 text-slate-600">
          Verifying your reset link...
        </p>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
