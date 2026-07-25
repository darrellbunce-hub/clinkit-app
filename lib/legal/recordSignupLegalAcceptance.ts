import type { SupabaseClient } from "@supabase/supabase-js";

import type { SignupTermsDocument } from "@/lib/legal/constants";
import {
  clearPendingSignupLegalAcceptance,
  readPendingSignupLegalAcceptance,
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

export async function persistSignupLegalAcceptanceAfterAuth(
  supabase: SupabaseClient,
  input: RecordSignupLegalAcceptanceInput
): Promise<{ ok: boolean; error: string | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    queueSignupLegalAcceptanceForSession(input);

    return { ok: true, error: null };
  }

  return recordSignupLegalAcceptance(supabase, input);
}

export async function flushPendingSignupLegalAcceptance(
  supabase: SupabaseClient
): Promise<{ ok: boolean; error: string | null; flushed: boolean }> {
  const pending = readPendingSignupLegalAcceptance();

  if (!pending) {
    return { ok: true, error: null, flushed: false };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { ok: true, error: null, flushed: false };
  }

  const result = await recordSignupLegalAcceptance(
    supabase,
    pending
  );

  if (result.ok) {
    clearPendingSignupLegalAcceptance();
  }

  return {
    ...result,
    flushed: result.ok,
  };
}

export function buildHomeownerSignupLegalAcceptance(
  termsVersion: string,
  privacyVersion: string,
  acceptedAt?: string
): PendingSignupLegalAcceptance {
  return {
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
    termsDocument: "estate_agent_terms",
    termsVersion,
    privacyVersion,
    acceptedAt: acceptedAt ?? new Date().toISOString(),
  };
}
