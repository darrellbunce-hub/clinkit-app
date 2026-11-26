import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LEGAL_DOCUMENT_VERSIONS,
  SIGNUP_LEGAL_ACCEPTANCE_EXPIRED_MESSAGE,
  SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE,
  type SignupTermsDocument,
} from "@/lib/legal/constants";
import {
  clearPendingSignupLegalAcceptance,
  discardInvalidPendingSignupLegalAcceptance,
  inspectPendingSignupLegalAcceptance,
  retainExpiredUnresolvedSignupLegalAcceptance,
  savePendingSignupLegalAcceptance,
  type PendingSignupLegalAcceptance,
} from "@/lib/legal/pendingLegalAcceptance";

export type RecordSignupLegalAcceptanceInput = {
  termsDocument: SignupTermsDocument;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt?: string;
};

type RecordSignupLegalAcceptanceRpc = {
  ok?: boolean;
  error?: string;
};

export type PersistSignupLegalAcceptanceResult = {
  ok: boolean;
  error: string | null;
  /** True when acceptance intent remains in browser storage for retry. */
  pendingQueued: boolean;
};

export type PendingSignupLegalFlushDisposition =
  | "absent"
  | "flushed"
  | "awaiting_session"
  | "persist_failed"
  | "expired";

export type FlushPendingSignupLegalAcceptanceResult = {
  ok: boolean;
  error: string | null;
  flushed: boolean;
  /** True when unresolved acceptance still blocks product entry. */
  pendingRemains: boolean;
  disposition: PendingSignupLegalFlushDisposition;
};

export type EnsurePendingSignupLegalAcceptanceResult = {
  ok: boolean;
  message: string | null;
  disposition: PendingSignupLegalFlushDisposition;
};

let inFlightFlush: Promise<FlushPendingSignupLegalAcceptanceResult> | null =
  null;

export function isSignupLegalAcceptanceComplete(
  termsAccepted: boolean,
  privacyAccepted: boolean
): boolean {
  return termsAccepted && privacyAccepted;
}

export async function recordSignupLegalAcceptance(
  supabase: SupabaseClient,
  input: RecordSignupLegalAcceptanceInput
): Promise<{ ok: boolean; error: string | null }> {
  const acceptedAt =
    input.acceptedAt ?? new Date().toISOString();

  const { data, error } = await supabase.rpc(
    "record_signup_legal_acceptances",
    {
      p_terms_document: input.termsDocument,
      p_terms_version: input.termsVersion,
      p_privacy_version: input.privacyVersion,
      p_accepted_at: acceptedAt,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as RecordSignupLegalAcceptanceRpc | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "legal_acceptance_record_failed",
    };
  }

  return { ok: true, error: null };
}

export function queueSignupLegalAcceptanceForSession(
  input: RecordSignupLegalAcceptanceInput
) {
  savePendingSignupLegalAcceptance({
    termsDocument: input.termsDocument,
    termsVersion: input.termsVersion,
    privacyVersion: input.privacyVersion,
    acceptedAt: input.acceptedAt ?? new Date().toISOString(),
  });
}

/**
 * Persist signup legal acceptance after Auth user creation.
 *
 * Always queues a pending browser record first so a later session can recover
 * if the durable RPC fails. Never reports success when the RPC fails while a
 * session exists.
 */
export async function persistSignupLegalAcceptanceAfterAuth(
  supabase: SupabaseClient,
  input: RecordSignupLegalAcceptanceInput
): Promise<PersistSignupLegalAcceptanceResult> {
  queueSignupLegalAcceptanceForSession(input);

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { ok: true, error: null, pendingQueued: true };
  }

  const result = await recordSignupLegalAcceptance(supabase, input);

  if (result.ok) {
    clearPendingSignupLegalAcceptance();
    return { ok: true, error: null, pendingQueued: false };
  }

  return {
    ok: false,
    error: result.error,
    pendingQueued: true,
  };
}

async function flushPendingSignupLegalAcceptanceOnce(
  supabase: SupabaseClient
): Promise<FlushPendingSignupLegalAcceptanceResult> {
  discardInvalidPendingSignupLegalAcceptance();

  const inspection = inspectPendingSignupLegalAcceptance();

  if (inspection.state === "absent") {
    return {
      ok: true,
      error: null,
      flushed: false,
      pendingRemains: false,
      disposition: "absent",
    };
  }

  if (inspection.state === "expired") {
    // Drop the stale payload. Do not send it to the RPC and do not mint a
    // replacement acceptedAt. The marker keeps this distinct from absence.
    retainExpiredUnresolvedSignupLegalAcceptance();

    return {
      ok: false,
      error: "pending_acceptance_expired",
      flushed: false,
      pendingRemains: true,
      disposition: "expired",
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return {
      ok: true,
      error: null,
      flushed: false,
      pendingRemains: true,
      disposition: "awaiting_session",
    };
  }

  const result = await recordSignupLegalAcceptance(
    supabase,
    inspection.record
  );

  if (result.ok) {
    clearPendingSignupLegalAcceptance();
    return {
      ok: true,
      error: null,
      flushed: true,
      pendingRemains: false,
      disposition: "flushed",
    };
  }

  return {
    ok: false,
    error: result.error,
    flushed: false,
    pendingRemains: true,
    disposition: "persist_failed",
  };
}

export async function flushPendingSignupLegalAcceptance(
  supabase: SupabaseClient
): Promise<FlushPendingSignupLegalAcceptanceResult> {
  if (!inFlightFlush) {
    inFlightFlush = flushPendingSignupLegalAcceptanceOnce(
      supabase
    ).finally(() => {
      inFlightFlush = null;
    });
  }

  return inFlightFlush;
}

/**
 * Gate for authenticated routes that must not proceed while a pending
 * signup acceptance remains unrecorded. Existing users with no pending
 * record are unaffected. Expired storage is not treated as absence.
 * Awaiting a session is not a failed persist — product routes still must
 * not render until a session can flush or the user re-accepts.
 */
export async function ensurePendingSignupLegalAcceptanceFlushed(
  supabase: SupabaseClient
): Promise<EnsurePendingSignupLegalAcceptanceResult> {
  const result = await flushPendingSignupLegalAcceptance(supabase);

  if (result.disposition === "persist_failed") {
    return {
      ok: false,
      message: SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE,
      disposition: "persist_failed",
    };
  }

  if (result.disposition === "expired") {
    return {
      ok: false,
      message: SIGNUP_LEGAL_ACCEPTANCE_EXPIRED_MESSAGE,
      disposition: "expired",
    };
  }

  return {
    ok: true,
    message: null,
    disposition: result.disposition,
  };
}

/**
 * Record a new explicit acceptance after the stored one expired.
 * Uses the current document versions and the time of this acceptance.
 * Does not copy or backdate the expired payload.
 */
export async function recordExplicitSignupLegalAcceptance(
  supabase: SupabaseClient
): Promise<{ ok: boolean; error: string | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return {
      ok: false,
      error: "Sign in to save your acceptance.",
    };
  }

  const acceptedAt = new Date().toISOString();
  const result = await recordSignupLegalAcceptance(supabase, {
    termsDocument: "terms_of_use",
    termsVersion: LEGAL_DOCUMENT_VERSIONS.termsOfService,
    privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacyPolicy,
    acceptedAt,
  });

  if (result.ok) {
    clearPendingSignupLegalAcceptance();
  }

  return result.ok
    ? { ok: true, error: null }
    : {
        ok: false,
        error: SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE,
      };
}

export function buildHomeownerSignupLegalAcceptance(
  termsVersion: string,
  privacyVersion: string,
  acceptedAt?: string
): PendingSignupLegalAcceptance {
  return {
    // Internal DB document id — public document is Terms of Service.
    termsDocument: "terms_of_use",
    termsVersion,
    privacyVersion,
    acceptedAt: acceptedAt ?? new Date().toISOString(),
  };
}

export function buildEstateAgentSignupLegalAcceptance(
  termsVersion: string,
  privacyVersion: string,
  acceptedAt?: string
): PendingSignupLegalAcceptance {
  return {
    // EA acceptance uses the same Terms of Service document as homeowners.
    // Retains existing RPC allowlist value `terms_of_use` (no migration).
    termsDocument: "terms_of_use",
    termsVersion,
    privacyVersion,
    acceptedAt: acceptedAt ?? new Date().toISOString(),
  };
}
