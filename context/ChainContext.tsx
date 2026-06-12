"use client";

import {
  createContext,
  useContext,
  useState,
useEffect,
  ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import {
  canEditProperty,
  canEditBuyerReady,
  OPERATIONAL_EDIT_DENIED_MESSAGE,
} from "@/lib/propertyPermissions";
import {
  validatePropertyStageTransition,
  COMPLETION_DATE_AGREED_REQUIRES_CONTRACTS_EXCHANGED_MESSAGE,
} from "@/lib/completionLifecycle";
import {
  mapToOperationalProperties,
  resolveOperationalPosition,
  type OperationalBuyerReadyNode,
  type OperationalProperty,
} from "@/lib/operationalPosition";
import {
  recordChainCompletionDate as persistChainCompletionDate,
  type RecordChainCompletionDateResult,
} from "@/lib/recordChainCompletionDate";
import {
  amendChainCompletionDate as persistChainCompletionDateAmendment,
  type AmendChainCompletionDateResult,
} from "@/lib/amendChainCompletionDate";
import {
  confirmChainCompletion as persistChainCompletionConfirmation,
  type ConfirmChainCompletionResult,
} from "@/lib/confirmChainCompletion";
import type { CompletionAmendmentReasonCode } from "@/lib/completionLifecycle";
import {
  daysSinceLastActivity,
  sortActivitiesNewestFirst,
  type OperationalActivity,
} from "@/lib/activityIntelligence";
type Activity = OperationalActivity;

type Property = {
  
  id: number;
  chainId: number;
  stage: string;
  status: string;
  currentUserRole: string | null;
  lastUpdatedDays: number;
  activities: Activity[];
  chainPosition: number;
  address: string | null;
postcode: string | null;
awaiting_buyer: boolean;

is_searching: boolean;
buyer_connected: boolean;

seller_connected: boolean;
relationship_type: string | null;

created_by_user_id: string | null;

linked_property_id: number | null;
members: {
  user_id: string;
  role: string;
}[];
};
type Chain = {
  id: number;
  accessCode: string;
  state: string;
  completionLifecycleStatus: string | null;
  completionScheduledDate: string | null;
  completionDateRecordedAt: string | null;
  completionDateRecordedByUserId: string | null;
  completionConfirmedAt: string | null;
  completionConfirmedByUserId: string | null;
  completedAt: string | null;
};
type ChainContextType = {
  properties: Property[];
  chainNodes: any[];
  chains: Chain[];
  currentUserId: string | null;

  updatePropertyStage: (
    propertyId: number,
    newStage: string
  ) => Promise<void>;

  addStructuredUpdate: (
    targetId: number,
    updateMessage: string,
    targetType?: "property" | "buyer_ready"
  ) => Promise<void>;
  
  breakChainConnection: (
    propertyId: number,
    breakReason: string
  ) => void;

  recordChainCompletionDate: (
    chainId: number,
    scheduledDate: string
  ) => Promise<RecordChainCompletionDateResult>;

  amendChainCompletionDate: (
    chainId: number,
    newScheduledDate: string,
    reasonCode: CompletionAmendmentReasonCode
  ) => Promise<AmendChainCompletionDateResult>;

  confirmChainCompletion: (
    chainId: number
  ) => Promise<ConfirmChainCompletionResult>;

};

const ChainContext =
  createContext<ChainContextType | null>(null);

export function ChainProvider({
  children,
}: {
  children: ReactNode;
}) {

  const [properties, setProperties] =
  useState<Property[]>([]);
  const [chainNodes, setChainNodes] =
  useState<any[]>([]);
const [chains, setChains] =
  useState<Chain[]>([]);
  const [currentUserId, setCurrentUserId] =
  useState<string | null>(null);
useEffect(() => {
  async function fetchUser() {

    const {
      data: { user },
    } = await supabase.auth.getUser();
  
    if (user) {
      setCurrentUserId(user.id);
    }
  }
  async function fetchProperties() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } =
  await supabase
    .from("properties")
    .select(`
      *,
      activities (
        id,
        timestamp,
        update,
        updated_by
      ),
      property_members (
        user_id,
        role
      )
    `);
    
    const {
      data: chainNodesData,
      error: chainNodesError,
    } = await supabase
      .from("chain_nodes")
      .select(`
        *,
        activities (
          id,
          timestamp,
          update,
          updated_by,
          chain_node_id
        )
      `);
    
      console.log(
        "CHAIN NODES QUERY",
        chainNodesData
      );
      
      console.log(
        "FIRST NODE ACTIVITIES",
        chainNodesData?.[0]?.activities
      );
    
    const formattedProperties =
      (data || []).map((property) => ({

        id: property.id,

        chainId:
          property.chain_id,
        
        chainPosition:
          property.chain_position,
          address:
          property.address,
        
        postcode:
          property.postcode,
          awaiting_buyer:
  property.awaiting_buyer ?? false,

is_searching:
  property.is_searching ?? false,
  buyer_connected:
  property.buyer_connected ?? false,

seller_connected:
  property.seller_connected ?? false,
relationship_type:
  property.relationship_type ?? null,

created_by_user_id:
  property.created_by_user_id ?? null,

linked_property_id:
  property.linked_property_id ?? null,
          members:
  property.property_members || [],
        stage: property.stage,

        status: property.status,
        currentUserRole:
        property.property_members?.find(
          (member: {
            user_id: string;
            role: string;
          }) =>
            member.user_id === user?.id
        )?.role || null,
        

          lastUpdatedDays:
            daysSinceLastActivity(
              property.activities
            ),
          activities:
            sortActivitiesNewestFirst(
              property.activities || []
            ),
        
        }));
        console.log("RAW DATA", data);

console.log(
  "FORMATTED",
  formattedProperties
);
    setProperties(formattedProperties);
    if (!chainNodesError && chainNodesData) {

      console.log(
        "SETTING CHAIN NODES",
        chainNodesData
      );
      console.log(
        "CHAIN NODE ACTIVITIES COUNT",
        chainNodesData?.[0]?.activities?.length
      );
      
      console.log(
        "CHAIN NODE FULL",
        JSON.stringify(
          chainNodesData?.[0],
          null,
          2
        )
      );
      setChainNodes(chainNodesData);
    
    }
    const {
      data: chainsData,
    } = await supabase
      .from("chains")
      .select("*");
    
      if (chainsData) {

        const formattedChains =
          chainsData.map((chain) => {
            
            const chainProperties =
              formattedProperties.filter(
                (property) =>
                  Number(property.chainId) === Number(chain.id)
              );
      
            const hasPendingConnection =
              chainProperties.some(
                (property) =>
                  property.status ===
                  "pending_connection"
              );

            const hasUnclaimedProperties =
              chainProperties.some(
                (property) =>
                  property.members.length === 0
              );

            const isIncomplete =
              chainProperties.length === 1 ||
              hasPendingConnection ||
              hasUnclaimedProperties;

            return {
              id: chain.id,
              accessCode: chain.access_code,
              state:
                chain.state ||
                (isIncomplete
                  ? "active_incomplete"
                  : "active_connected"),
              completionLifecycleStatus:
                chain.completion_lifecycle_status ??
                null,
              completionScheduledDate:
                chain.completion_scheduled_date ??
                null,
              completionDateRecordedAt:
                chain.completion_date_recorded_at ??
                null,
              completionDateRecordedByUserId:
                chain.completion_date_recorded_by_user_id ??
                null,
              completionConfirmedAt:
                chain.completion_confirmed_at ??
                null,
              completionConfirmedByUserId:
                chain.completion_confirmed_by_user_id ??
                null,
              completedAt:
                chain.completed_at ?? null,
            };
          });
      
        setChains(formattedChains);
      }
  }
  fetchUser();
  fetchProperties();

}, []);

async function updatePropertyStage(
  propertyId: number,
  newStage: string
) {
  const property =
properties.find(
  (property) =>
    property.id === propertyId
);

if (
  !canEditProperty(
    property,
    currentUserId,
    mapToOperationalProperties(properties),
    chainNodes
  )
) {
  alert(OPERATIONAL_EDIT_DENIED_MESSAGE);

  return;
}

if (
  newStage === "searching" &&
  (property?.address || property?.postcode)
) {
  alert(
    "An agreed purchase cannot be changed back to searching."
  );

  return;
}

const stageGateResult = validatePropertyStageTransition(
  property?.stage ?? "",
  newStage
);

if (!stageGateResult.ok) {
  alert(stageGateResult.message);

  return;
}
  const { error } =
    await supabase
      .from("properties")
      .update({
        stage: newStage,
      })
      .eq("id", propertyId);

  if (error) {
    console.error(error);

    if (
      typeof error.message === "string" &&
      error.message.includes(
        "completion_date_agreed_requires_contracts_exchanged"
      )
    ) {
      alert(
        COMPLETION_DATE_AGREED_REQUIRES_CONTRACTS_EXCHANGED_MESSAGE
      );
    }

    return;
  }

  const formattedUpdate =
    newStage
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) =>
        letter.toUpperCase()
      );

  await supabase
    .from("activities")
    .insert({

      property_id: propertyId,

      update: formattedUpdate,

      updated_by: "homeowner",

    });
    setProperties((previousProperties) =>
      previousProperties.map((property) => {
    
        if (property.id === propertyId) {
    
          return {
    
            ...property,
    
            stage: newStage,
    
            activities: [
    
              {
                id: Date.now(),
    
                timestamp:
                  new Date().toISOString(),
    
                update: formattedUpdate,
    
                updated_by: "homeowner",
    
              },
    
              ...property.activities,
    
            ],
    
          };
        }
    
        return property;
    
      })
    );
    
    }

async function addStructuredUpdate(
  targetId: number,
  updateMessage: string,
  targetType: "property" | "buyer_ready" = "property"
) {
  console.log(
    "ADD STRUCTURED UPDATE",
    targetId,
    updateMessage,
    targetType
  );
  console.log(
    "TARGET TYPE RECEIVED",
    targetType
  );
  const property =
  targetType === "property"

    ? properties.find(
        (property) =>
          property.id === targetId
      )

    : null;

    if (
      targetType === "property" &&
      !canEditProperty(
        property,
        currentUserId,
        mapToOperationalProperties(properties),
        chainNodes
      )
    ) {
      alert(OPERATIONAL_EDIT_DENIED_MESSAGE);

      return;
    }

    if (targetType === "buyer_ready") {
      const buyerReadyNode = chainNodes.find(
        (node) => node.id === targetId
      );

      if (
        !buyerReadyNode ||
        !canEditBuyerReady(
          targetId,
          buyerReadyNode.chain_id,
          currentUserId,
          mapToOperationalProperties(properties),
          chainNodes
        )
      ) {
        alert(OPERATIONAL_EDIT_DENIED_MESSAGE);

        return;
      }
    }
    await supabase
    .from("activities")
    .insert({
  
      property_id:
        targetType === "property"
          ? targetId
          : null,
  
      chain_node_id:
        targetType === "buyer_ready"
          ? targetId
          : null,
  
      update: updateMessage,
  
      updated_by: "homeowner",
  
    });

    if (targetType === "property") {

      setProperties((previousProperties) =>
        previousProperties.map((property) => {
    
          if (property.id === targetId) {
    
            return {
    
              ...property,
    
              activities: [
    
                {
                  id: Date.now(),
    
                  timestamp:
                    new Date().toISOString(),
    
                  update: updateMessage,
    
                  updated_by: "homeowner",
    
                },
    
                ...property.activities,
    
              ],
    
            };
          }
    
          return property;
    
        })
      );
    
    } else {

      setChainNodes((previousNodes) =>
        previousNodes.map((node) => {
    
          if (node.id === targetId) {
    
            return {
    
              ...node,
    
              activities: [
    
                {
                  id: Date.now(),
    
                  timestamp:
                    new Date().toISOString(),
    
                  update: updateMessage,
    
                  updated_by: "homeowner",
    
                },
    
                ...(node.activities || []),
    
              ],
    
            };
          }
    
          return node;
    
        })
      );
    
    }

}

async function breakChainConnection(
  propertyId: number,
  breakReason: string
) {
  const property =
  properties.find(
    (property) =>
      property.id === propertyId
  );

if (
  !property ||
  !canEditProperty(
    property,
    currentUserId,
    mapToOperationalProperties(properties),
    chainNodes
  )
) {
  alert(OPERATIONAL_EDIT_DENIED_MESSAGE);

  return;
}
  const updateMessage =
    breakReason === "buyer_side"
      ? "Chain Connection Broken - Buyer Side"
      : "Chain Connection Broken - Seller Side";

  const propertyUpdates =
    new Map<
      number,
      {
        linked_property_id?: null;
        status?: string;
        buyer_connected?: boolean;
        seller_connected?: boolean;
      }
    >();

  if (breakReason === "seller_side") {

    const upstreamPropertyId =
      property.linked_property_id;

    propertyUpdates.set(propertyId, {
      status: "broken_connection",
      linked_property_id: null,
      seller_connected: false,
    });

    if (upstreamPropertyId) {

      propertyUpdates.set(
        upstreamPropertyId,
        {
          buyer_connected: false,
        }
      );
    }
  } else {

    propertyUpdates.set(propertyId, {
      status: "broken_connection",
      buyer_connected: false,
    });

    properties
      .filter(
        (chainProperty) =>
          chainProperty.linked_property_id ===
          propertyId
      )
      .forEach((inboundProperty) => {

        propertyUpdates.set(
          inboundProperty.id,
          {
            linked_property_id: null,
            seller_connected: false,
          }
        );
      });
  }

  for (const [
    updatedPropertyId,
    updates,
  ] of propertyUpdates) {

    await supabase
      .from("properties")
      .update(updates)
      .eq("id", updatedPropertyId);
  }

  await supabase
    .from("activities")
    .insert({

      property_id: propertyId,

      update: updateMessage,

      updated_by: "homeowner",

    });

  const newActivity = {
    id: Date.now(),

    timestamp:
      new Date().toISOString(),

    update: updateMessage,

    updated_by: "homeowner",
  };

  setProperties((previousProperties) =>
    previousProperties.map((chainProperty) => {

      const updates =
        propertyUpdates.get(
          chainProperty.id
        );

      if (
        !updates &&
        chainProperty.id !== propertyId
      ) {
        return chainProperty;
      }

      const updatedProperty = {
        ...chainProperty,
        ...updates,
      };

      if (chainProperty.id === propertyId) {

        return {
          ...updatedProperty,

          activities: [
            newActivity,
            ...chainProperty.activities,
          ],
        };
      }

      return updatedProperty;
    })
  );
}

async function recordChainCompletionDate(
  chainId: number,
  scheduledDate: string
): Promise<RecordChainCompletionDateResult> {
  if (!currentUserId) {
    return {
      ok: false,
      message:
        "Please log in to record the agreed completion date.",
    };
  }

  const result = await persistChainCompletionDate(
    supabase,
    {
      chainId,
      userId: currentUserId,
      scheduledDate,
      chainProperties:
        mapToOperationalProperties(properties),
      chainNodes: chainNodes as OperationalBuyerReadyNode[],
    }
  );

  if (!result.ok) {
    return result;
  }

  const { position } = resolveOperationalPosition(
    currentUserId,
    chainId,
    mapToOperationalProperties(properties),
    chainNodes as OperationalBuyerReadyNode[]
  );

  setChains((previousChains) =>
    previousChains.map((chain) =>
      chain.id === chainId
        ? {
            ...chain,
            completionLifecycleStatus:
              result.chain
                .completion_lifecycle_status,
            completionScheduledDate:
              result.chain
                .completion_scheduled_date,
            completionDateRecordedAt:
              result.chain
                .completion_date_recorded_at,
            completionDateRecordedByUserId:
              result.chain
                .completion_date_recorded_by_user_id,
          }
        : chain
    )
  );

  setProperties((previousProperties) =>
    previousProperties.map((property) =>
      position?.kind === "sale" &&
      property.id === position.propertyId
        ? {
            ...property,
            stage: "completion_date_agreed",
          }
        : property
    )
  );

  setChainNodes((previousNodes) =>
    previousNodes.map((node) =>
      position?.kind === "buyer_ready" &&
      node.id === position.nodeId
        ? {
            ...node,
            stage: "completion_date_agreed",
            progress: 100,
            status: "healthy",
          }
        : node
    )
  );

  return result;
}

async function amendChainCompletionDate(
  chainId: number,
  newScheduledDate: string,
  reasonCode: CompletionAmendmentReasonCode
): Promise<AmendChainCompletionDateResult> {
  if (!currentUserId) {
    return {
      ok: false,
      message:
        "Please log in to change the agreed completion date.",
    };
  }

  const result =
    await persistChainCompletionDateAmendment(
      supabase,
      {
        chainId,
        userId: currentUserId,
        newScheduledDate,
        reasonCode,
        chainProperties:
          mapToOperationalProperties(properties),
        chainNodes:
          chainNodes as OperationalBuyerReadyNode[],
      }
    );

  if (!result.ok) {
    return result;
  }

  setChains((previousChains) =>
    previousChains.map((chain) =>
      chain.id === chainId
        ? {
            ...chain,
            completionLifecycleStatus:
              result.chain
                .completion_lifecycle_status,
            completionScheduledDate:
              result.chain
                .completion_scheduled_date,
            completionDateRecordedAt:
              result.chain
                .completion_date_recorded_at,
            completionDateRecordedByUserId:
              result.chain
                .completion_date_recorded_by_user_id,
          }
        : chain
    )
  );

  await addStructuredUpdate(
    result.activityTarget.kind === "sale"
      ? result.activityTarget.propertyId
      : result.activityTarget.nodeId,
    result.activityUpdate,
    result.activityTarget.kind === "sale"
      ? "property"
      : "buyer_ready"
  );

  return result;
}

async function confirmChainCompletion(
  chainId: number
): Promise<ConfirmChainCompletionResult> {
  if (!currentUserId) {
    return {
      ok: false,
      message:
        "Please log in to confirm completion.",
    };
  }

  const result =
    await persistChainCompletionConfirmation(
      supabase,
      {
        chainId,
        userId: currentUserId,
        chainProperties:
          mapToOperationalProperties(properties),
        chainNodes:
          chainNodes as OperationalBuyerReadyNode[],
      }
    );

  if (!result.ok) {
    return result;
  }

  setChains((previousChains) =>
    previousChains.map((chain) =>
      chain.id === chainId
        ? {
            ...chain,
            completionLifecycleStatus:
              result.chain
                .completion_lifecycle_status,
            completionScheduledDate:
              result.chain
                .completion_scheduled_date,
            completionConfirmedAt:
              result.chain
                .completion_confirmed_at,
            completionConfirmedByUserId:
              result.chain
                .completion_confirmed_by_user_id,
            completedAt:
              result.chain.completed_at,
          }
        : chain
    )
  );

  await addStructuredUpdate(
    result.activityTarget.kind === "sale"
      ? result.activityTarget.propertyId
      : result.activityTarget.nodeId,
    result.activityUpdate,
    result.activityTarget.kind === "sale"
      ? "property"
      : "buyer_ready"
  );

  return result;
}

return (
  <ChainContext.Provider
      value={{
        properties,
        chainNodes,
        chains,
        currentUserId,
        updatePropertyStage,
        addStructuredUpdate,
        breakChainConnection,
        recordChainCompletionDate,
        amendChainCompletionDate,
        confirmChainCompletion,
      }}
    >
      {children}
    </ChainContext.Provider>
  );
}

export function useChain() {

  const context =
    useContext(ChainContext);

  if (!context) {
    throw new Error(
      "useChain must be used inside ChainProvider"
    );
  }

  return context;
}