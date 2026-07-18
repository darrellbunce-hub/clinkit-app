"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  regeneratePlatformAdminMfaEnrollClient,
  restartPlatformAdminMfaEnrollClient,
  startPlatformAdminMfaEnrollClient,
  verifyPlatformAdminMfaEnrollClient,
} from "@/lib/auth/platformAdminMfaClient";
import { CARD_CLASS } from "@/lib/theme/themeTokens";

async function beginEnrolment(abandonedFactorCount: number) {
  if (abandonedFactorCount > 0) {
    const restarted = await restartPlatformAdminMfaEnrollClient();
    if (!restarted.ok) {
      return restarted;
    }
  }

  return startPlatformAdminMfaEnrollClient();
}

export default function PlatformAdminMfaEnrollPanel({
  nextPath,
  abandonedFactorCount,
}: {
  nextPath: string | null;
  abandonedFactorCount: number;
}) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCodeSrc, setQrCodeSrc] = useState<string | null>(null);
  const [manualSetupKey, setManualSetupKey] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const enrolStartedRef = useRef(false);

  function applyEnrolmentResult(
    started:
      | { ok: true; factorId: string; qrCode: string; secret: string }
      | { ok: false; error: string }
  ) {
    if (!started.ok) {
      setMessage("Could not start MFA enrolment. Try again or contact engineering.");
      return;
    }

    setFactorId(started.factorId);
    setQrCodeSrc(started.qrCode);
    setManualSetupKey(started.secret);
    setMessage("");
  }

  useEffect(() => {
    if (enrolStartedRef.current) {
      return;
    }
    enrolStartedRef.current = true;

    startTransition(async () => {
      const started = await beginEnrolment(abandonedFactorCount);
      applyEnrolmentResult(started);
    });
  }, [abandonedFactorCount]);

  function handleRegenerate() {
    setCode("");
    setMessage("Generating a new QR code…");
    startTransition(async () => {
      const started = await regeneratePlatformAdminMfaEnrollClient();
      applyEnrolmentResult(started);
    });
  }

  function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId) {
      return;
    }

    setMessage("");
    startTransition(async () => {
      const result = await verifyPlatformAdminMfaEnrollClient({
        factorId,
        code,
        nextPath,
      });

      if (!result.ok) {
        setMessage("Verification failed. Check the code and try again.");
        return;
      }

      window.location.href = result.redirectTo;
    });
  }

  return (
    <section className={CARD_CLASS}>
      <h1 className="text-2xl font-semibold text-slate-900">
        Set up authenticator MFA
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Platform-admin access requires a verified TOTP authenticator and an AAL2 session.
      </p>

      {qrCodeSrc ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl bg-white p-4">
          <img
            src={qrCodeSrc}
            alt="Scan this QR code with your authenticator app"
            width={256}
            height={256}
            className="size-64 max-w-[min(100%,16rem)] shrink-0 [image-rendering:crisp-edges]"
          />
          <p className="text-center text-sm text-slate-600">
            Scan with Microsoft Authenticator (Other account) or Google Authenticator.
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={handleRegenerate}
            className="min-h-11 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 disabled:opacity-60"
          >
            Generate a new QR code
          </button>
        </div>
      ) : (
        <p className="mt-6 text-sm text-slate-500">Preparing enrolment…</p>
      )}

      {manualSetupKey ? (
        <div className="mt-4 rounded-2xl bg-surface-inset px-4 py-3 text-sm">
          <p className="font-medium text-slate-900">Manual setup key</p>
          <p className="mt-2 break-all font-mono text-xs text-slate-700">{manualSetupKey}</p>
          <p className="mt-2 text-slate-500">
            If scanning fails, enter this key manually in your authenticator app instead of
            scanning the QR code.
          </p>
        </div>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={handleVerify}>
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
          disabled={isPending || !factorId || code.length !== 6}
          className="min-h-11 w-full rounded-2xl bg-brand-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {isPending ? "Verifying…" : "Verify and continue"}
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
