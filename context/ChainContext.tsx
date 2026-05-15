"use client";

import {
  createContext,
  useContext,
  useState,
useEffect,
  ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
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
  isCurrentUser: boolean;
  lastUpdatedDays: number;
  activities: Activity[];
  chainPosition: number;
  address: string;
postcode: string;
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
  chains: Chain[];
  currentUserId: string | null;

  updatePropertyStage: (
    propertyId: number,
    newStage: string
  ) => Promise<void>;

  addStructuredUpdate: (
    propertyId: number,
    updateMessage: string
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
    `)

    if (error) {
      console.error(error);
      return;
    }

    const formattedProperties =
      data.map((property) => ({

        id: property.id,

        chainId:
          property.chain_id,
        
        chainPosition:
          property.chain_position,
          address:
          property.address,
        
        postcode:
          property.postcode,
          members:
  property.property_members || [],
        stage: property.stage,

        status: property.status,

        isCurrentUser:
          property.is_current_user,

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
    setProperties(formattedProperties);
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
                  property.chainId === chain.id
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

const canEdit =
  property?.members?.some(
    (member) =>
      member.user_id === currentUserId
  );

if (!canEdit) {

  alert(
    "You do not have permission to update this property"
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
  propertyId: number,
  updateMessage: string
) {
  const property =
  properties.find(
    (property) =>
      property.id === propertyId
  );

const canEdit =
  property?.members?.some(
    (member) =>
      member.user_id === currentUserId
  );

if (!canEdit) {

  alert(
    "You do not have permission to update this property"
  );

  return;
}
  await supabase
    .from("activities")
    .insert({

      property_id: propertyId,

      update: updateMessage,

      updated_by: "homeowner",

    });

  setProperties((previousProperties) =>
    previousProperties.map((property) => {

      if (property.id === propertyId) {

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

const canEdit =
  property?.members?.some(
    (member) =>
      member.user_id === currentUserId
  );

if (!canEdit) {

  alert(
    "You do not have permission to update this property"
  );

  return;
}
  const updateMessage =
    breakReason === "buyer_side"
      ? "Chain Connection Broken - Buyer Side"
      : "Chain Connection Broken - Seller Side";

  await supabase
    .from("properties")
    .update({

      status:
        "broken_connection",

    })
    .eq("id", propertyId);

  await supabase
    .from("activities")
    .insert({

      property_id: propertyId,

      update: updateMessage,

      updated_by: "homeowner",

    });

  setProperties((previousProperties) =>
    previousProperties.map((property) => {

      if (property.id === propertyId) {

        return {

          ...property,

          status:
            "broken_connection",

          activities: [

            {
              id: Date.now(),

              timestamp:
                new Date().toISOString(),

              update: updateMessage,

              updated_by:
                "homeowner",

            },

            ...property.activities,

          ],

        };
      }

      return property;

    })
  );
}

return (
  <ChainContext.Provider
      value={{
        properties,
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