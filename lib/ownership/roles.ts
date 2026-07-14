import type { OperationalHomeownerRole } from "@/lib/ownership/types";

/**
 * Maps property relationship_type to the operational homeowner role.
 */
export function operationalHomeownerRoleForRelationship(
  relationshipType: string | null | undefined
): OperationalHomeownerRole | null {
  switch (relationshipType) {
    case "sale":
      return "seller";
    case "purchase":
      return "buyer";
    default:
      return null;
  }
}

/**
 * Maps property relationship_type to the counterparty role (join-chain).
 */
export function counterpartyRoleForRelationship(
  relationshipType: string | null | undefined
): "buyer" | "seller" | null {
  switch (relationshipType) {
    case "sale":
      return "buyer";
    case "purchase":
      return "seller";
    default:
      return null;
  }
}

/**
 * Whether a property_members role represents owner-class authority for the property type.
 */
export function isOwnerClassMembershipRole(
  relationshipType: string | null | undefined,
  memberRole: string | null | undefined
): boolean {
  const ownerRole = operationalHomeownerRoleForRelationship(relationshipType);

  return ownerRole !== null && memberRole === ownerRole;
}

/**
 * Detects anomaly: multiple distinct users with owner-class membership on one property.
 */
export function detectMultipleOperationalHomeowners(
  members: Array<{ userId: string; role: string }>,
  relationshipType: string | null | undefined
): boolean {
  const ownerRole = operationalHomeownerRoleForRelationship(relationshipType);

  if (!ownerRole) {
    return false;
  }

  const ownerUserIds = new Set(
    members
      .filter((member) => member.role === ownerRole)
      .map((member) => member.userId)
  );

  return ownerUserIds.size > 1;
}
