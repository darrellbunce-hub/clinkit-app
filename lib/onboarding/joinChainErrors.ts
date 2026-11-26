import {
  EMAIL_VERIFICATION_TRANSACTION_MESSAGE,
  isEmailVerificationRequiredError,
  mapTransactionParticipationError,
} from "@/lib/auth/emailVerificationGate";
import { ROUTES } from "@/lib/auth/routes";

/**
 * User-facing join failure copy. Keeps the backend's
 * `join_details_not_matched` oracle intact — do not invent distinct messages
 * for already-claimed / wrong-role when the RPC collapses them.
 */
export function mapJoinChainFailureMessage(
  error: string | null | undefined
): string {
  if (!error) {
    return "Could not join this property. Check the access code, address, and postcode, then try again.";
  }

  const transactionMapped = mapTransactionParticipationError(error);
  if (transactionMapped) {
    return transactionMapped;
  }

  if (error === "not_authenticated") {
    return "Please log in to join a chain.";
  }

  if (error === "join_details_not_matched") {
    return "We could not match those details to a property. Check the access code, address, and postcode, then try again.";
  }

  if (isEmailVerificationRequiredError(error)) {
    return EMAIL_VERIFICATION_TRANSACTION_MESSAGE;
  }

  return "Could not join this property. Check the access code, address, and postcode, then try again.";
}

export type JoinChainFieldErrors = {
  accessCode?: string;
  address?: string;
  postcode?: string;
};

export function validateJoinChainInputs(input: {
  accessCode: string;
  address: string;
  postcode: string;
}): JoinChainFieldErrors | null {
  const errors: JoinChainFieldErrors = {};

  if (!input.accessCode.trim()) {
    errors.accessCode = "Enter the chain access code.";
  }

  if (!input.address.trim()) {
    errors.address = "Enter the property address.";
  }

  if (!input.postcode.trim()) {
    errors.postcode = "Enter the property postcode.";
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

export type JoinChainPartialSuccess = {
  chainId: number;
  propertyId: number;
  message: string;
};

export function buildJoinChainPartialSuccess(input: {
  chainId: number;
  propertyId: number;
  message: string;
}): JoinChainPartialSuccess {
  return {
    chainId: input.chainId,
    propertyId: input.propertyId,
    message: input.message,
  };
}

export function joinChainDashboardHref(): string {
  return `${ROUTES.homeownerDashboard}?refresh=${Date.now()}`;
}

export function joinChainViewHref(chainId: number): string {
  return `/chain/${chainId}`;
}

export function joinChainPropertyHref(propertyId: number): string {
  return `/property/${propertyId}`;
}
