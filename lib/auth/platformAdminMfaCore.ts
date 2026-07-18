/** Pure MFA factor helpers — safe for tests and server/client code. */

export type TotpFactorLike = {
  id: string;
  factor_type: string;
  status: string;
};

export function partitionTotpFactors(factors: TotpFactorLike[] | null | undefined): {
  verifiedTotpFactorId: string | null;
  unverifiedTotpFactorIds: string[];
} {
  const totpFactors = (factors ?? []).filter((factor) => factor.factor_type === "totp");
  const verifiedTotp = totpFactors.find((factor) => factor.status === "verified");

  return {
    verifiedTotpFactorId: verifiedTotp?.id ?? null,
    unverifiedTotpFactorIds: totpFactors
      .filter((factor) => factor.status !== "verified")
      .map((factor) => factor.id),
  };
}

export function partitionTotpFactorsFromMfaList(data: {
  all: TotpFactorLike[];
} | null): {
  verifiedTotpFactorId: string | null;
  unverifiedTotpFactorIds: string[];
} {
  return partitionTotpFactors(data?.all);
}

/** Supabase auth-js prefixes raw SVG with this data URI for use as an image src. */
export function isTotpQrCodeDataUri(value: string): boolean {
  return value.startsWith("data:image/svg+xml");
}

export function manualSetupKeyMustNotExposeQrData(manualSetupKey: string): boolean {
  return !manualSetupKey.startsWith("data:image");
}

export type TotpEnrollPresentation = {
  qrCodeSrc: string;
  manualSetupKey: string;
};

/** Validates Supabase TOTP enrol fields before UI presentation. */
export function buildTotpEnrollPresentation(input: {
  qrCode: string;
  secret: string;
}): TotpEnrollPresentation {
  if (!isTotpQrCodeDataUri(input.qrCode)) {
    throw new Error("invalid_qr_code_format");
  }

  if (!input.secret.trim() || !manualSetupKeyMustNotExposeQrData(input.secret)) {
    throw new Error("invalid_manual_setup_key");
  }

  return {
    qrCodeSrc: input.qrCode,
    manualSetupKey: input.secret,
  };
}
