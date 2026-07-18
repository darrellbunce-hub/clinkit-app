"use client";

import { useState, useTransition } from "react";

import { verifyPlatformAdminMfaChallengeClient } from "@/lib/auth/platformAdminMfaClient";
import { CARD_CLASS } from "@/lib/theme/themeTokens";

export default function PlatformAdminMfaChallengePanel({
  factorId,
  nextPath,
}: {
  factorId: string;
  nextPath: string | null;
}) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    startTransition(async () => {
      const result = await verifyPlatformAdminMfaChallengeClient({
        factorId,
        code,
        nextPath,
      });

      if (!result.ok) {
        setMessage("Verification failed. Check your authenticator code and try again.");
        return;
      }

      window.location.href = result.redirectTo;
    });
  }

  return (
    <section className={CARD_CLASS}>
      <h1 className="text-2xl font-semibold text-slate-900">
        Authenticator verification required
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Enter the current code from your authenticator app to reach AAL2 for Privacy Admin.
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-slate-700">
          Authenticator code
        </label>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          className="min-h-11 w-full rounded-2xl border border-slate-200 px-4 py-3 text-center text-lg tracking-[0.3em]"
          placeholder="000000"
        />
        <button
          type="submit"
          disabled={isPending || code.length !== 6}
          className="min-h-11 w-full rounded-2xl bg-brand-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {isPending ? "Verifying…" : "Continue securely"}
        </button>
      </form>

      {message ? (
        <p className="mt-4 text-sm text-slate-700" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
