import type {
  DelegatePermission,
  PropertyAuthority,
} from "@/lib/ownership/types";

export type ResolvePropertyAuthorityInput = {
  propertyId: number;
  userId: string;
  operationalHomeownerUserId: string | null;
  counterpartyUserIds: string[];
  delegateUserId: string | null;
  delegatePermissions: DelegatePermission[];
  delegateStatus: "pending" | "active" | "revoked" | null;
  isEaAssigned: boolean;
  eaHomeownerOnlyUpdates: boolean;
};

/**
 * Pure authority resolution from identity records.
 * Phase 2 loads inputs from property_operational_identities + delegates + EA assignments.
 */
export function resolvePropertyAuthority(
  input: ResolvePropertyAuthorityInput
): PropertyAuthority {
  const isOperationalHomeowner =
    input.operationalHomeownerUserId !== null &&
    input.operationalHomeownerUserId === input.userId;

  const isCounterparty = input.counterpartyUserIds.includes(input.userId);

  const isDelegate =
    input.delegateUserId === input.userId &&
    input.delegateStatus === "active";

  const delegatePermissions = isDelegate ? input.delegatePermissions : [];

  const canMutate =
    isOperationalHomeowner ||
    (isDelegate && delegatePermissions.includes("update")) ||
    (input.isEaAssigned && !input.eaHomeownerOnlyUpdates);

  const canInviteDelegate =
    isOperationalHomeowner ||
    (isDelegate && delegatePermissions.includes("invite"));

  const canDelink = isOperationalHomeowner;

  return {
    propertyId: input.propertyId,
    userId: input.userId,
    isOperationalHomeowner,
    isCounterparty,
    isDelegate,
    isEaAssigned: input.isEaAssigned,
    delegatePermissions,
    canMutate,
    canInviteDelegate,
    canDelink,
  };
}
