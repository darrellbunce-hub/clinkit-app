"use client";

import {
  createContext,
  useContext,
  useState,
  ReactNode,
} from "react";

type Activity = {
  id: number;
  date: string;
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

  const [properties, setProperties] = useState<Property[]>([
    {
      id: 1,
      stage: "searches_started",
      status: "healthy",
      isCurrentUser: false,
      lastUpdatedDays: 2,

      activities: [
        {
          id: 1,
          date: "Today",
          update: "Searches Started",
        },
      ],
    },

    {
      id: 2,
      stage: "mortgage_offer_received",
      status: "healthy",
      isCurrentUser: false,
      lastUpdatedDays: 1,

      activities: [
        {
          id: 1,
          date: "Today",
          update: "Mortgage Offer Received",
        },
      ],
    },

    {
      id: 3,
      stage: "survey_booked",
      status: "delayed",
      isCurrentUser: true,
      lastUpdatedDays: 7,

      activities: [
        {
          id: 1,
          date: "Today",
          update: "Survey Booked",
        },
      ],
    },

    {
      id: 4,
      stage: "awaiting_searches",
      status: "blocked",
      isCurrentUser: false,
      lastUpdatedDays: 18,

      activities: [
        {
          id: 1,
          date: "Today",
          update: "Awaiting Searches",
        },
      ],
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

            activities: [
              {
                id: Date.now(),

                date: "Just now",

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