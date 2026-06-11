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
  mapToOperationalProperties,
  type OperationalProperty,
} from "@/lib/operationalPosition";
type Activity = {
  id: number;
  timestamp: string;
  update: string;
  updated_by?: string;
};

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
        

          lastUpdatedDays: (() => {

            if (
              !property.activities ||
              property.activities.length === 0
            ) {
              return 0;
            }
          
            const latestActivity =
              property.activities[0];
          
            const updatedDate =
              new Date(
                latestActivity.timestamp
              );
          
            const now = new Date();
          
            const difference =
              now.getTime() -
              updatedDate.getTime();
          
            return Math.floor(
              difference /
              (1000 * 60 * 60 * 24)
            );
          
          })(),
          activities:
          property.activities || [],
        
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
              return {
                id: chain.id,
                accessCode: chain.access_code,
                state: chain.state,
              };
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
      
              accessCode:
                chain.access_code,
      
              state:
                isIncomplete
                  ? "active_incomplete"
                  : "active_connected",
      
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
  const { error } =
    await supabase
      .from("properties")
      .update({
        stage: newStage,
      })
      .eq("id", propertyId);

  if (error) {
    console.error(error);
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