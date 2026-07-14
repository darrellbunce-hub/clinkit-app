/**
 * Property operational ownership — type foundation.
 *
 * See docs/PROPERTY_OWNERSHIP_MODEL.md for the full model, audit, and roadmap.
 */

/** The single operational homeowner for a property record. */
export const OPERATIONAL_IDENTITY_STATUS = {
  active: "active",
  delinked: "delinked",
  released: "released",
} as const;

export type OperationalIdentityStatus =
  (typeof OPERATIONAL_IDENTITY_STATUS)[keyof typeof OPERATIONAL_IDENTITY_STATUS];

/** Approved workflows that may grant operational homeowner identity. */
export const OPERATIONAL_IDENTITY_GRANT_VIA = {
  startMove: "start_move",
  claimOperationalProperty: "claim_operational_property",
  eaOriginationClaim: "ea_origination_claim",
  convertPlaceholder: "convert_placeholder",
} as const;

export type OperationalIdentityGrantVia =
  (typeof OPERATIONAL_IDENTITY_GRANT_VIA)[keyof typeof OPERATIONAL_IDENTITY_GRANT_VIA];

export type OperationalHomeownerRole = "seller" | "buyer";

export type PropertyOperationalIdentity = {
  propertyId: number;
  homeownerUserId: string;
  operationalRole: OperationalHomeownerRole;
  grantedVia: OperationalIdentityGrantVia;
  grantedAt: string;
  status: OperationalIdentityStatus;
};

export const DELEGATE_STATUS = {
  pending: "pending",
  active: "active",
  revoked: "revoked",
} as const;

export type DelegateStatus =
  (typeof DELEGATE_STATUS)[keyof typeof DELEGATE_STATUS];

export const DELEGATE_PERMISSION = {
  view: "view",
  update: "update",
  invite: "invite",
} as const;

export type DelegatePermission =
  (typeof DELEGATE_PERMISSION)[keyof typeof DELEGATE_PERMISSION];

export type PropertyDelegate = {
  propertyId: number;
  delegateUserId: string;
  invitedByUserId: string;
  permissions: DelegatePermission[];
  status: DelegateStatus;
  invitedAt: string;
  acceptedAt: string | null;
};

export const COUNTERPARTY_STATUS = {
  active: "active",
  delinked: "delinked",
} as const;

export type CounterpartyStatus =
  (typeof COUNTERPARTY_STATUS)[keyof typeof COUNTERPARTY_STATUS];

/** Chain counterparty on a property hop — not a homeowner identity. */
export type PropertyCounterpartyParticipant = {
  propertyId: number;
  userId: string;
  counterpartyRole: "buyer" | "seller";
  grantedVia: "join_chain_property";
  grantedAt: string;
  status: CounterpartyStatus;
};

export const DELINK_ACTOR_TYPE = {
  homeowner: "homeowner",
  estateAgent: "estate_agent",
  system: "system",
} as const;

export type DelinkActorType =
  (typeof DELINK_ACTOR_TYPE)[keyof typeof DELINK_ACTOR_TYPE];

export type PropertyDelinkEvent = {
  id: string;
  propertyId: number;
  chainId: number | null;
  actorUserId: string;
  actorType: DelinkActorType;
  reasonCode: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

/** Resolved authority for mutation and display gates. */
export type PropertyAuthority = {
  propertyId: number;
  userId: string;
  isOperationalHomeowner: boolean;
  isCounterparty: boolean;
  isDelegate: boolean;
  isEaAssigned: boolean;
  delegatePermissions: DelegatePermission[];
  canMutate: boolean;
  canInviteDelegate: boolean;
  canDelink: boolean;
};

/** Known pre-launch violation paths (audit registry). */
export const OWNERSHIP_VIOLATION_PATH = {
  ensurePropertyMembershipRpc: "ensure_property_membership",
  propertyMembersInsertOwnRls: "property_members_insert_own",
  claimSyncOnAnyMembership: "sync_property_claim_on_membership",
  clientEnsurePropertyMembership: "client_ensure_property_membership",
  earliestMemberOwnerResolution: "get_property_operational_owner_user_id",
} as const;

export type OwnershipViolationPath =
  (typeof OWNERSHIP_VIOLATION_PATH)[keyof typeof OWNERSHIP_VIOLATION_PATH];

export type OwnershipViolationDefinition = {
  id: OwnershipViolationPath;
  severity: "critical" | "high" | "medium";
  description: string;
  location: string;
  remediation: string;
};

export const OWNERSHIP_VIOLATION_REGISTRY: OwnershipViolationDefinition[] = [
  {
    id: OWNERSHIP_VIOLATION_PATH.ensurePropertyMembershipRpc,
    severity: "critical",
    description:
      "Any authenticated user can self-attach as seller/buyer on any property ID.",
    location:
      "supabase/migrations/20260610215000_property_members_deduplicate_and_unique.sql",
    remediation:
      "FIXED in 20260714150000 — revoked; replace with establish_operational_homeowner / grant_counterparty_participation.",
  },
  {
    id: OWNERSHIP_VIOLATION_PATH.propertyMembersInsertOwnRls,
    severity: "critical",
    description:
      "Direct INSERT into property_members bypasses workflow authorization.",
    location:
      "supabase/migrations/20260610220000_reconcile_phase5_homeowner_privacy_rls.sql",
    remediation:
      "FIXED in 20260714150000 — insert policy dropped; grants via SECURITY DEFINER RPCs only.",
  },
  {
    id: OWNERSHIP_VIOLATION_PATH.claimSyncOnAnyMembership,
    severity: "critical",
    description:
      "Claim metadata updated on any membership insert, including counterparty joins.",
    location:
      "supabase/migrations/20260612000000_phase7a_ea_originated_properties.sql",
    remediation:
      "FIXED in 20260714150000 — trigger removed; claim sync on homeowner establish only.",
  },
  {
    id: OWNERSHIP_VIOLATION_PATH.clientEnsurePropertyMembership,
    severity: "critical",
    description:
      "Client modules call ensure_property_membership directly after property creation.",
    location: "lib/ensurePropertyMembership.ts, app/start-move/page.tsx, lib/searchingPlaceholder.ts",
    remediation:
      "FIXED — client uses lib/ownership/grants establishOperationalHomeowner.",
  },
  {
    id: OWNERSHIP_VIOLATION_PATH.earliestMemberOwnerResolution,
    severity: "critical",
    description:
      "Operational owner resolved as earliest property_members row, not authoritative identity.",
    location:
      "get_property_operational_owner_user_id in 20260612000000_phase7a_ea_originated_properties.sql",
    remediation:
      "FIXED in 20260714150000 — resolves from property_operational_identities.",
  },
];
