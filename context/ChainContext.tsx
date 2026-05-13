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
};
type Chain = {
  id: number;
  accessCode: string;
  state: string;
};
type ChainContextType = {
  properties: Property[];
  chains: Chain[];
  updatePropertyStage: (
    propertyId: number,
    newStage: string
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
        update
      )
    `);

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
        stage: property.stage,

        status: property.status,

        isCurrentUser:
          property.is_current_user,

        lastUpdatedDays:
          property.last_updated_days,

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
      
            const isIncomplete =
              chainProperties.length === 1 ||
              hasPendingConnection;
      
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

    const { error } =
    await supabase
      .from("properties")
      .update({
        stage: newStage,
        last_updated_days: 0,
      })
      .eq("id", propertyId);
  
  if (error) {
    console.error(error);
    return;
  }
  await supabase
  .from("activities")
  .insert({
    property_id: propertyId,

    update: newStage
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) =>
        letter.toUpperCase()
      ),
  });
  setProperties((previousProperties) =>
    previousProperties.map((property) => {
  
      if (property.id === propertyId) {
  
        return {
          ...property,
  
          stage: newStage,
  
          lastUpdatedDays: 0,
  
          activities: [
            {
              id: Date.now(),
  
              timestamp:
                new Date().toISOString(),
  
              update: newStage
                .replaceAll("_", " ")
                .replace(/\b\w/g, (letter) =>
                  letter.toUpperCase()
                ),
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
        updatePropertyStage,
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