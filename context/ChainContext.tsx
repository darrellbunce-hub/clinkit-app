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
  stage: string;
  status: string;
  isCurrentUser: boolean;
  lastUpdatedDays: number;
  activities: Activity[];
};

type ChainContextType = {
  properties: Property[];

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

useEffect(() => {

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

  }

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