"use client";

import {
  createContext,
  useContext,
  useState,
  ReactNode,
} from "react";

type Property = {
  id: number;
  stage: string;
  status: string;
  isCurrentUser: boolean;
  lastUpdatedDays: number;
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

  const [properties, setProperties] = useState([
    {
      id: 1,
      stage: "searches_started",
      status: "healthy",
      isCurrentUser: false,
      lastUpdatedDays: 2,
    },

    {
      id: 2,
      stage: "mortgage_offer_received",
      status: "healthy",
      isCurrentUser: false,
      lastUpdatedDays: 1,
    },

    {
      id: 3,
      stage: "survey_booked",
      status: "delayed",
      isCurrentUser: true,
      lastUpdatedDays: 7,
    },

    {
      id: 4,
      stage: "awaiting_searches",
      status: "blocked",
      isCurrentUser: false,
      lastUpdatedDays: 18,
    },
  ]);

  function updatePropertyStage(
    propertyId: number,
    newStage: string
  ) {

    setProperties((previousProperties) =>
      previousProperties.map((property) => {

        if (property.id === propertyId) {
          return {
            ...property,
            stage: newStage,
            lastUpdatedDays: 0,
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