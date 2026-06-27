import type { AccountType } from "@/lib/accountType";
import { isEstateAgent } from "@/lib/accountType";
import type { OperationalProperty } from "@/lib/operationalPosition";
import {
  resolveOperationalPosition,
  resolveOperationalSalePropertyId,
  type OperationalBuyerReadyNode,
  type ResolveOperationalPositionResult,
} from "@/lib/operationalPosition";

export type OperationalSubjectViewerRole =
  | "homeowner"
  | "estate_agent";

export type OperationalSubject = {
  subjectUserId: string;
  assignedPropertyId: number | null;
  viewerRole: OperationalSubjectViewerRole;
};

/** Active EA assignment row used for operational topology and delegation. */
export type EstateAgentOperationalAssignment = {
  propertyId: number;
  chainId: number;
  subjectUserId: string;
  homeownerOnlyUpdates: boolean;
};

export type ResolveOperationalSubjectParams = {
  viewerUserId: string | null | undefined;
  accountType: AccountType | null | undefined;
  chainId: number;
  chainProperties?: OperationalProperty[];
  estateAgentAssignments?: EstateAgentOperationalAssignment[];
};

export function pickEstateAgentAssignmentInChain(
  assignments: EstateAgentOperationalAssignment[],
  chainId: number,
  chainProperties: OperationalProperty[]
): EstateAgentOperationalAssignment | null {
  const inChain = assignments.filter(
    (assignment) =>
      Number(assignment.chainId) === Number(chainId)
  );

  if (inChain.length === 0) {
    return null;
  }

  if (inChain.length === 1) {
    return inChain[0];
  }

  const saleAssignments = inChain.filter((assignment) => {
    const property = chainProperties.find(
      (row) => row.id === assignment.propertyId
    );

    return property?.relationship_type === "sale";
  });

  if (saleAssignments.length === 1) {
    return saleAssignments[0];
  }

  if (saleAssignments.length > 1) {
    return [...saleAssignments].sort((left, right) => {
      const leftPosition =
        chainProperties.find(
          (row) => row.id === left.propertyId
        )?.chainPosition ??
        chainProperties.find(
          (row) => row.id === left.propertyId
        )?.chain_position ??
        0;
      const rightPosition =
        chainProperties.find(
          (row) => row.id === right.propertyId
        )?.chainPosition ??
        chainProperties.find(
          (row) => row.id === right.propertyId
        )?.chain_position ??
        0;

      return rightPosition - leftPosition;
    })[0];
  }

  return inChain[0];
}

/**
 * Resolves who owns the operational topology for the current viewer.
 *
 * Homeowners operate as themselves. Assigned estate agents inherit the
 * assigned homeowner's operational subject (future: solicitor, broker, etc.).
 */
export function resolveOperationalSubject(
  params: ResolveOperationalSubjectParams
): OperationalSubject | null {
  const {
    viewerUserId,
    accountType,
    chainId,
    chainProperties = [],
    estateAgentAssignments = [],
  } = params;

  if (!viewerUserId) {
    return null;
  }

  if (
    isEstateAgent({
      account_type: accountType ?? "homeowner",
    })
  ) {
    const assignment = pickEstateAgentAssignmentInChain(
      estateAgentAssignments,
      chainId,
      chainProperties
    );

    if (!assignment) {
      return null;
    }

    return {
      subjectUserId: assignment.subjectUserId,
      assignedPropertyId: assignment.propertyId,
      viewerRole: "estate_agent",
    };
  }

  return {
    subjectUserId: viewerUserId,
    assignedPropertyId: null,
    viewerRole: "homeowner",
  };
}

/**
 * Applies the operational subject's membership lens so the existing
 * participant-centric resolver sees seller/buyer hops as the subject would.
 */
export function applyOperationalSubjectLens(
  chainProperties: OperationalProperty[],
  subject: OperationalSubject | null
): OperationalProperty[] {
  if (
    !subject ||
    subject.viewerRole === "homeowner" ||
    subject.assignedPropertyId == null
  ) {
    return chainProperties;
  }

  const assignedProperty = chainProperties.find(
    (property) =>
      property.id === subject.assignedPropertyId
  );

  if (!assignedProperty) {
    return chainProperties;
  }

  const assignedRole =
    assignedProperty.relationship_type === "purchase"
      ? "buyer"
      : "seller";

  return chainProperties.map((property) => {
    if (property.id === subject.assignedPropertyId) {
      return {
        ...property,
        isOwnProperty: true,
        is_own_property: true,
        currentUserRole: assignedRole,
        current_user_role: assignedRole,
      };
    }

    if (
      assignedRole === "seller" &&
      property.relationship_type === "purchase" &&
      (property.linked_property_id ===
        subject.assignedPropertyId ||
        assignedProperty.linked_property_id ===
          property.id)
    ) {
      return {
        ...property,
        isOwnProperty: true,
        is_own_property: true,
        currentUserRole: "buyer",
        current_user_role: "buyer",
      };
    }

    if (
      assignedRole === "buyer" &&
      property.relationship_type === "sale" &&
      (property.linked_property_id ===
        subject.assignedPropertyId ||
        assignedProperty.linked_property_id ===
          property.id)
    ) {
      return {
        ...property,
        isOwnProperty: true,
        is_own_property: true,
        currentUserRole: "seller",
        current_user_role: "seller",
      };
    }

    return property;
  });
}

export type SubjectScopedOperationalParams = {
  subject: OperationalSubject | null;
  chainId: number;
  chainProperties: OperationalProperty[];
  chainNodes: OperationalBuyerReadyNode[];
};

/** Topology-only: resolve position via subject + lens, not the logged-in viewer. */
export function resolveSubjectOperationalPosition(
  params: SubjectScopedOperationalParams
): ResolveOperationalPositionResult {
  const { subject, chainId, chainProperties, chainNodes } =
    params;

  if (!subject) {
    return { position: null };
  }

  const scopedProperties = applyOperationalSubjectLens(
    chainProperties,
    subject
  );

  return resolveOperationalPosition(
    subject.subjectUserId,
    chainId,
    scopedProperties,
    chainNodes
  );
}

/** Topology-only sale anchor for upstream purchaser, placeholders, intelligence. */
export function resolveSubjectOperationalSalePropertyId(
  params: SubjectScopedOperationalParams
): number | null {
  const { subject, chainId, chainProperties } = params;

  if (!subject) {
    return null;
  }

  const scopedProperties = applyOperationalSubjectLens(
    chainProperties,
    subject
  );

  return resolveOperationalSalePropertyId(
    chainId,
    scopedProperties
  );
}

export function isPropertyOperationalSaleForSubject(
  propertyId: number,
  params: SubjectScopedOperationalParams
): boolean {
  return (
    resolveSubjectOperationalSalePropertyId(params) ===
    propertyId
  );
}
