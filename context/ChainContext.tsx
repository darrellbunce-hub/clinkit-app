"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  resolveAuthEventDecision,
  resolveParticipantLoadTransition,
  requiresParticipantData,
  shouldApplyBootstrapAuthResult,
  nextAuthGenerationAfterMeaningfulEvent,
} from "@/lib/chainParticipantLoadPolicy";
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
isOwnProperty: boolean;
hasMembers: boolean;
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
  authLoading: boolean;
  isAuthenticated: boolean;
  refreshParticipantData: () => Promise<void>;

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

type ParticipantDataset = {
  properties: Property[];
  chainNodes: any[];
  chains: Chain[];
};

async function loadParticipantDataset(
  isStale: () => boolean
): Promise<ParticipantDataset | null> {
  const {
    data: participantProperties,
    error: propertiesError,
  } = await supabase
    .from("chain_properties_participant")
    .select("*")
    .order("chain_id")
    .order("chain_position");

  if (isStale()) {
    return null;
  }

  if (propertiesError) {
    console.error(propertiesError);
    return null;
  }

  const propertyIds =
    (participantProperties || []).map(
      (property) => property.id
    );

  const activitiesByPropertyId = new Map<
    number,
    Activity[]
  >();

  if (propertyIds.length > 0) {
    const {
      data: activitiesData,
      error: activitiesError,
    } = await supabase
      .from("activities")
      .select(
        "id, timestamp, update, updated_by, property_id"
      )
      .in("property_id", propertyIds);

    if (isStale()) {
      return null;
    }

    if (activitiesError) {
      console.error(activitiesError);
    } else {
      for (const activity of activitiesData || []) {
        if (!activity.property_id) {
          continue;
        }

        const existing =
          activitiesByPropertyId.get(
            activity.property_id
          ) || [];

        existing.push({
          id: activity.id,
          timestamp: activity.timestamp,
          update: activity.update,
          updated_by: activity.updated_by,
        });

        activitiesByPropertyId.set(
          activity.property_id,
          existing
        );
      }
    }
  }

  const formattedProperties =
    (participantProperties || []).map((property) => {
      const activities =
        activitiesByPropertyId.get(property.id) || [];

      return {
        id: property.id,
        chainId: property.chain_id,
        chainPosition: property.chain_position,
        address: property.address,
        postcode: property.postcode,
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
        isOwnProperty:
          property.is_own_property ?? false,
        hasMembers: property.has_members ?? false,
        members: [],
        stage: property.stage,
        status: property.status,
        currentUserRole:
          property.current_user_role ?? null,
        lastUpdatedDays: daysSinceLastActivity(
          activities
        ),
        activities: sortActivitiesNewestFirst(
          activities
        ),
      };
    });

  const participantChainIds = [
    ...new Set(
      formattedProperties.map(
        (property) => property.chainId
      )
    ),
  ];

  const chainNodesQuery = supabase
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

  const {
    data: chainNodesData,
    error: chainNodesError,
  } =
    participantChainIds.length > 0
      ? await chainNodesQuery.in(
          "chain_id",
          participantChainIds
        )
      : await chainNodesQuery.limit(0);

  if (isStale()) {
    return null;
  }

  const chainNodes =
    !chainNodesError && chainNodesData
      ? chainNodesData
      : [];

  if (chainNodesError) {
    console.error(chainNodesError);
  }

  const chainsQuery = supabase.from("chains").select("*");

  const { data: chainsData } =
    participantChainIds.length > 0
      ? await chainsQuery.in(
          "id",
          participantChainIds
        )
      : await chainsQuery.limit(0);

  if (isStale()) {
    return null;
  }

  const formattedChains = (chainsData || []).map(
    (chain) => {
      const chainProperties =
        formattedProperties.filter(
          (property) =>
            Number(property.chainId) ===
            Number(chain.id)
        );

      const hasPendingConnection =
        chainProperties.some(
          (property) =>
            property.status ===
            "pending_connection"
        );

      const hasUnclaimedProperties =
        chainProperties.some(
          (property) => !property.hasMembers
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
        completedAt: chain.completed_at ?? null,
      };
    }
  );

  return {
    properties: formattedProperties,
    chainNodes,
    chains: formattedChains,
  };
}

function clearParticipantState(
  setProperties: (value: Property[]) => void,
  setChainNodes: (value: any[]) => void,
  setChains: (value: Chain[]) => void
) {
  setProperties([]);
  setChainNodes([]);
  setChains([]);
}

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
  const [authLoading, setAuthLoading] =
    useState(true);
  const [isAuthenticated, setIsAuthenticated] =
    useState(false);

  const pathname = usePathname();
  const shouldLoadParticipantData =
    requiresParticipantData(pathname);

  const participantRequestIdRef =
    useRef(0);
  const authGenerationRef =
    useRef(0);
  const bootstrapCompleteRef =
    useRef(false);
  const currentUserIdRef =
    useRef<string | null>(null);
  const participantLoadedUserIdRef =
    useRef<string | null>(null);
  const prevShouldLoadRef =
    useRef(false);
  const prevUserIdForLoadRef =
    useRef<string | null>(null);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const applyParticipantDataset = useCallback(
    (dataset: ParticipantDataset) => {
      setProperties(dataset.properties);
      setChainNodes(dataset.chainNodes);
      setChains(dataset.chains);
    },
    []
  );

  const invalidateParticipantRequests =
    useCallback(() => {
      participantRequestIdRef.current += 1;
    }, []);

  const runParticipantLoad =
    useCallback(async () => {
      const requestId =
        ++participantRequestIdRef.current;

      const dataset =
        await loadParticipantDataset(() =>
          requestId !==
          participantRequestIdRef.current
        );

      if (
        !dataset ||
        requestId !==
          participantRequestIdRef.current
      ) {
        return;
      }

      applyParticipantDataset(dataset);
      participantLoadedUserIdRef.current =
        currentUserIdRef.current;
    }, [applyParticipantDataset]);

  const refreshParticipantData =
    useCallback(async () => {
      const userId =
        currentUserIdRef.current;

      if (
        !userId ||
        !requiresParticipantData(
          pathnameRef.current
        )
      ) {
        return;
      }

      participantLoadedUserIdRef.current = null;
      invalidateParticipantRequests();

      await runParticipantLoad();
    }, [
      invalidateParticipantRequests,
      runParticipantLoad,
    ]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSession() {
      const capturedAuthGeneration =
        authGenerationRef.current;

      setAuthLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) {
        return;
      }

      bootstrapCompleteRef.current = true;

      if (
        !shouldApplyBootstrapAuthResult(
          capturedAuthGeneration,
          authGenerationRef.current
        )
      ) {
        return;
      }

      const userId = user?.id ?? null;

      currentUserIdRef.current = userId;
      setCurrentUserId(userId);
      setIsAuthenticated(userId !== null);
      setAuthLoading(false);

      if (!userId) {
        invalidateParticipantRequests();
        participantLoadedUserIdRef.current = null;
        clearParticipantState(
          setProperties,
          setChainNodes,
          setChains
        );
      }
    }

    void bootstrapSession();

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (event, session) => {
          const nextUserId =
            session?.user?.id ?? null;

          const decision =
            resolveAuthEventDecision({
              event,
              bootstrapComplete:
                bootstrapCompleteRef.current,
              previousUserId:
                currentUserIdRef.current,
              nextUserId,
            });

          if (
            decision.action === "ignore"
          ) {
            return;
          }

          authGenerationRef.current =
            nextAuthGenerationAfterMeaningfulEvent(
              authGenerationRef.current
            );

          if (
            decision.action === "signed_out"
          ) {
            invalidateParticipantRequests();
            participantLoadedUserIdRef.current =
              null;
            currentUserIdRef.current = null;
            setCurrentUserId(null);
            setIsAuthenticated(false);
            setAuthLoading(false);
            clearParticipantState(
              setProperties,
              setChainNodes,
              setChains
            );

            return;
          }

          invalidateParticipantRequests();
          participantLoadedUserIdRef.current =
            null;

          if (
            decision.action ===
            "user_changed"
          ) {
            clearParticipantState(
              setProperties,
              setChainNodes,
              setChains
            );
          }

          currentUserIdRef.current =
            decision.userId;
          setCurrentUserId(decision.userId);
          setIsAuthenticated(true);
          setAuthLoading(false);
        }
      );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [invalidateParticipantRequests]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    const loadDecision =
      resolveParticipantLoadTransition({
        authLoading: false,
        userId: currentUserIdRef.current,
        shouldLoad: shouldLoadParticipantData,
        previousShouldLoad:
          prevShouldLoadRef.current,
        previousUserId:
          prevUserIdForLoadRef.current,
        participantDataLoadedForUserId:
          participantLoadedUserIdRef.current,
      });

    prevShouldLoadRef.current =
      shouldLoadParticipantData;
    prevUserIdForLoadRef.current =
      currentUserIdRef.current;

    if (loadDecision.action === "clear") {
      invalidateParticipantRequests();
      participantLoadedUserIdRef.current =
        null;
      clearParticipantState(
        setProperties,
        setChainNodes,
        setChains
      );

      return;
    }

    if (loadDecision.action === "load") {
      void runParticipantLoad();
    }
  }, [
    authLoading,
    shouldLoadParticipantData,
    currentUserId,
    invalidateParticipantRequests,
    runParticipantLoad,
  ]);

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
  const { error } = await supabase.rpc(
    "break_chain_connection",
    {
      p_property_id: propertyId,
      p_break_reason: breakReason,
    }
  );

  if (error) {
    console.error(error);
    alert("Could not break the chain connection.");
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
        authLoading,
        isAuthenticated,
        refreshParticipantData,
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