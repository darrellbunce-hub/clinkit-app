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
import {
  formatDelayReportedActivity,
  formatDelayResolvedActivity,
  isOperationalDelayReason,
  mapOperationalDelayRow,
  parseReportOperationalDelayResult,
  parseResolveOperationalDelayResult,
  type OperationalDelay,
  type OperationalDelayReason,
  type ReportOperationalDelayResult,
  type ResolveOperationalDelayResult,
} from "@/lib/operationalDelays";
import {
  getAccountType,
  type AccountType,
} from "@/lib/accountType";
import { fetchAuthenticatedProfileAccountFields } from "@/lib/currentUserContext";
import { loadEstateAgentOperationalAssignments } from "@/lib/estateAgent/assignments";
import type { EstateAgentOperationalAssignment } from "@/lib/operationalSubject";
import {
  resolveActivityUpdaterRole,
  resolveMutationOperationalPosition,
} from "@/lib/mutationPermission";
import { refreshOperationalSummary } from "@/lib/operationalSummary/refreshOperationalSummary";
import type { RefreshOperationalSummaryResult } from "@/lib/operationalSummary/refreshOperationalSummaryResult";
import { captureObservabilityException } from "@/lib/observability/sentryShared";
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
  /** Authoritative active delay when present. */
  activeDelay: OperationalDelay | null;
  hasActiveOperationalDelay: boolean;
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
  accountType: AccountType | null;
  estateAgentOperationalAssignments: EstateAgentOperationalAssignment[];
  authLoading: boolean;
  participantDataReady: boolean;
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

  reportOperationalDelay: (params: {
    reason: OperationalDelayReason;
    propertyId?: number;
    chainNodeId?: number;
  }) => Promise<ReportOperationalDelayResult>;

  resolveOperationalDelay: (
    delayId: number
  ) => Promise<ResolveOperationalDelayResult>;
  
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

  const participantChainIds = [
    ...new Set(
      (participantProperties || []).map(
        (property) => Number(property.chain_id)
      )
    ),
  ];

  const activeDelaysByPropertyId = new Map<
    number,
    OperationalDelay
  >();
  const activeDelaysByChainNodeId = new Map<
    number,
    OperationalDelay
  >();

  if (participantChainIds.length > 0) {
    const {
      data: delayRows,
      error: delaysError,
    } = await supabase
      .from("operational_delays")
      .select(
        "id, chain_id, property_id, chain_node_id, reason, status, created_at, resolved_at, created_by_user_id, resolved_by_user_id, created_by_role, resolved_by_role"
      )
      .in("chain_id", participantChainIds)
      .eq("status", "active");

    if (isStale()) {
      return null;
    }

    if (delaysError) {
      // Migration may be pending — continue without authoritative delays.
      console.error(delaysError);
    } else {
      for (const row of delayRows || []) {
        const mapped = mapOperationalDelayRow(row);
        if (!mapped) {
          continue;
        }
        if (mapped.propertyId != null) {
          activeDelaysByPropertyId.set(
            mapped.propertyId,
            mapped
          );
        }
        if (mapped.chainNodeId != null) {
          activeDelaysByChainNodeId.set(
            mapped.chainNodeId,
            mapped
          );
        }
      }
    }
  }

  const formattedProperties =
    (participantProperties || []).map((property) => {
      const activities =
        activitiesByPropertyId.get(property.id) || [];
      const activeDelay =
        activeDelaysByPropertyId.get(property.id) ??
        null;

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
        activeDelay,
        hasActiveOperationalDelay: activeDelay != null,
      };
    });

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
      ? chainNodesData.map((node) => {
          const activeDelay =
            activeDelaysByChainNodeId.get(
              Number(node.id)
            ) ?? null;

          return {
            ...node,
            activities: sortActivitiesNewestFirst(
              node.activities || []
            ),
            activeDelay,
            hasActiveOperationalDelay:
              activeDelay != null,
          };
        })
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
  setChains: (value: Chain[]) => void,
  setEstateAgentOperationalAssignments: (
    value: EstateAgentOperationalAssignment[]
  ) => void
) {
  setProperties([]);
  setChainNodes([]);
  setChains([]);
  setEstateAgentOperationalAssignments([]);
}

async function loadAccountTypeForUser(
  userId: string
): Promise<AccountType> {
  const profile =
    await fetchAuthenticatedProfileAccountFields(
      supabase,
      userId
    );

  return getAccountType(profile);
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
  const [accountType, setAccountType] =
    useState<AccountType | null>(null);
  const [
    estateAgentOperationalAssignments,
    setEstateAgentOperationalAssignments,
  ] = useState<EstateAgentOperationalAssignment[]>([]);
  const [authLoading, setAuthLoading] =
    useState(true);
  const [participantDataReady, setParticipantDataReady] =
    useState(false);
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
      setParticipantDataReady(false);

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

      const eaAssignments =
        await loadEstateAgentOperationalAssignments(
          supabase
        );

      if (
        requestId !==
        participantRequestIdRef.current
      ) {
        return;
      }

      applyParticipantDataset(dataset);
      setEstateAgentOperationalAssignments(
        eaAssignments
      );
      participantLoadedUserIdRef.current =
        currentUserIdRef.current;
      setParticipantDataReady(true);
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
      setParticipantDataReady(false);

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
      setParticipantDataReady(false);

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

      if (userId) {
        const resolvedAccountType =
          await loadAccountTypeForUser(userId);

        if (!cancelled) {
          setAccountType(resolvedAccountType);
        }
      } else {
        setAccountType(null);
      }

      setAuthLoading(false);

      if (!userId) {
        invalidateParticipantRequests();
        participantLoadedUserIdRef.current = null;
        clearParticipantState(
          setProperties,
          setChainNodes,
          setChains,
          setEstateAgentOperationalAssignments
        );
        setParticipantDataReady(true);
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
            setAccountType(null);
            setIsAuthenticated(false);
            setAuthLoading(false);
            clearParticipantState(
              setProperties,
              setChainNodes,
              setChains,
              setEstateAgentOperationalAssignments
            );
            setParticipantDataReady(true);

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
              setChains,
              setEstateAgentOperationalAssignments
            );
          }

          currentUserIdRef.current =
            decision.userId;
          setCurrentUserId(decision.userId);
          setIsAuthenticated(true);
          setAuthLoading(false);

          void loadAccountTypeForUser(
            decision.userId
          ).then((resolvedAccountType) => {
            setAccountType(resolvedAccountType);
          });
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

    if (!shouldLoadParticipantData) {
      setParticipantDataReady(true);
    }
  }, [authLoading, shouldLoadParticipantData]);

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
        setChains,
        setEstateAgentOperationalAssignments
      );
      setParticipantDataReady(true);

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

  const getMutationContext = () => ({
    accountType,
    estateAgentAssignments:
      estateAgentOperationalAssignments,
  });

  const getActivityUpdaterRole = () =>
    resolveActivityUpdaterRole(accountType);

  function reportOperationalSummaryRefreshFailure(
    result: RefreshOperationalSummaryResult
  ) {
    if (result.ok) {
      return;
    }

    captureObservabilityException(
      new Error(
        result.error ?? "operational_summary_refresh_failed"
      ),
      {
        operation: "refresh_operational_summary",
        errorCode: result.errorCode ?? undefined,
      }
    );
  }

  async function refreshOperationalSummariesForChain(
    chainId: number
  ): Promise<RefreshOperationalSummaryResult> {
    const result = await refreshOperationalSummary(
      supabase,
      { chainId }
    );

    if (!result.ok) {
      reportOperationalSummaryRefreshFailure(result);
    }

    return result;
  }

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
    chainNodes,
    getMutationContext()
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

const stageChanged = property?.stage !== newStage;
const stageEnteredAt = stageChanged
  ? new Date().toISOString()
  : undefined;

  const { error } =
    await supabase
      .from("properties")
      .update({
        stage: newStage,
        ...(stageChanged
          ? { stage_entered_at: stageEnteredAt }
          : {}),
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

      updated_by: getActivityUpdaterRole(),

    });

    await refreshOperationalSummariesForChain(
      Number(property!.chainId)
    );

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
    
                updated_by: getActivityUpdaterRole(),
    
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
        chainNodes,
        getMutationContext()
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
          chainNodes,
          getMutationContext()
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
  
      updated_by: getActivityUpdaterRole(),
  
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
    
                  updated_by: getActivityUpdaterRole(),
    
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
    
                  updated_by: getActivityUpdaterRole(),
    
                },
    
                ...(node.activities || []),
    
              ],
    
            };
          }
    
          return node;
    
        })
      );
    
    }

  const refreshChainId =
    targetType === "property"
      ? properties.find(
          (entry) => entry.id === targetId
        )?.chainId
      : chainNodes.find(
          (node) => node.id === targetId
        )?.chain_id;

  if (refreshChainId != null) {
    await refreshOperationalSummariesForChain(
      Number(refreshChainId)
    );
  }
}

const reportOperationalDelay = async (params: {
  reason: OperationalDelayReason;
  propertyId?: number;
  chainNodeId?: number;
}): Promise<ReportOperationalDelayResult> => {
  if (!isOperationalDelayReason(params.reason)) {
    return { ok: false, error: "invalid_reason" };
  }

  const targetType =
    params.propertyId != null
      ? "property"
      : params.chainNodeId != null
        ? "buyer_ready"
        : null;

  if (
    targetType === "property" &&
    params.propertyId != null
  ) {
    const property = properties.find(
      (entry) => entry.id === params.propertyId
    );

    if (
      !canEditProperty(
        property,
        currentUserId,
        mapToOperationalProperties(properties),
        chainNodes,
        getMutationContext()
      )
    ) {
      return { ok: false, error: "forbidden" };
    }
  } else if (
    targetType === "buyer_ready" &&
    params.chainNodeId != null
  ) {
    const buyerReadyNode = chainNodes.find(
      (node) => node.id === params.chainNodeId
    );

    if (
      !buyerReadyNode ||
      !canEditBuyerReady(
        params.chainNodeId,
        buyerReadyNode.chain_id,
        currentUserId,
        mapToOperationalProperties(properties),
        chainNodes,
        getMutationContext()
      )
    ) {
      return { ok: false, error: "forbidden" };
    }
  } else {
    return { ok: false, error: "invalid_target" };
  }

  const { data, error } = await supabase.rpc(
    "report_operational_delay",
    {
      p_reason: params.reason,
      p_property_id: params.propertyId ?? null,
      p_chain_node_id: params.chainNodeId ?? null,
      p_actor_role: getActivityUpdaterRole(),
    }
  );

  if (error) {
    console.error(error);
    return { ok: false, error: "rpc_failed" };
  }

  const parsed = parseReportOperationalDelayResult(data);

  if (!parsed.ok) {
    return parsed;
  }

  const activityMessage =
    parsed.activityMessage ||
    formatDelayReportedActivity(parsed.reason);

  const now = new Date().toISOString();
  const optimisticDelay: OperationalDelay = {
    id: parsed.delayId,
    chainId:
      params.propertyId != null
        ? (properties.find(
            (entry) => entry.id === params.propertyId
          )?.chainId ?? 0)
        : (chainNodes.find(
            (node) => node.id === params.chainNodeId
          )?.chain_id ?? 0),
    propertyId: params.propertyId ?? null,
    chainNodeId: params.chainNodeId ?? null,
    reason: parsed.reason,
    status: "active",
    createdAt: parsed.createdAt || now,
    resolvedAt: null,
    createdByRole: getActivityUpdaterRole(),
  };

  if (params.propertyId != null) {
    setProperties((previousProperties) =>
      previousProperties.map((property) => {
        if (property.id !== params.propertyId) {
          return property;
        }

        return {
          ...property,
          activeDelay: optimisticDelay,
          hasActiveOperationalDelay: true,
          activities: [
            {
              id: Date.now(),
              timestamp: now,
              update: activityMessage,
              updated_by: getActivityUpdaterRole(),
            },
            ...property.activities,
          ],
        };
      })
    );
  } else if (params.chainNodeId != null) {
    setChainNodes((previousNodes) =>
      previousNodes.map((node) => {
        if (node.id !== params.chainNodeId) {
          return node;
        }

        return {
          ...node,
          activeDelay: optimisticDelay,
          hasActiveOperationalDelay: true,
          activities: [
            {
              id: Date.now(),
              timestamp: now,
              update: activityMessage,
              updated_by: getActivityUpdaterRole(),
            },
            ...(node.activities || []),
          ],
        };
      })
    );
  }

  const refreshChainId = optimisticDelay.chainId;
  if (refreshChainId) {
    await refreshOperationalSummariesForChain(
      Number(refreshChainId)
    );
  }

  return parsed;
};

const resolveOperationalDelay = async (
  delayId: number
): Promise<ResolveOperationalDelayResult> => {
  const propertyWithDelay = properties.find(
    (property) => property.activeDelay?.id === delayId
  );
  const nodeWithDelay = chainNodes.find(
    (node) => node.activeDelay?.id === delayId
  );

  if (propertyWithDelay) {
    if (
      !canEditProperty(
        propertyWithDelay,
        currentUserId,
        mapToOperationalProperties(properties),
        chainNodes,
        getMutationContext()
      )
    ) {
      return { ok: false, error: "forbidden" };
    }
  } else if (nodeWithDelay) {
    if (
      !canEditBuyerReady(
        nodeWithDelay.id,
        nodeWithDelay.chain_id,
        currentUserId,
        mapToOperationalProperties(properties),
        chainNodes,
        getMutationContext()
      )
    ) {
      return { ok: false, error: "forbidden" };
    }
  }

  const { data, error } = await supabase.rpc(
    "resolve_operational_delay",
    {
      p_delay_id: delayId,
      p_actor_role: getActivityUpdaterRole(),
    }
  );

  if (error) {
    console.error(error);
    return { ok: false, error: "rpc_failed" };
  }

  const parsed = parseResolveOperationalDelayResult(data);

  if (!parsed.ok) {
    return parsed;
  }

  const activityMessage =
    parsed.activityMessage ||
    formatDelayResolvedActivity(parsed.reason);
  const now = parsed.resolvedAt || new Date().toISOString();

  setProperties((previousProperties) =>
    previousProperties.map((property) => {
      if (property.activeDelay?.id !== delayId) {
        return property;
      }

      return {
        ...property,
        activeDelay: null,
        hasActiveOperationalDelay: false,
        activities: parsed.alreadyResolved
          ? property.activities
          : [
              {
                id: Date.now(),
                timestamp: now,
                update: activityMessage,
                updated_by: getActivityUpdaterRole(),
              },
              ...property.activities,
            ],
      };
    })
  );

  setChainNodes((previousNodes) =>
    previousNodes.map((node) => {
      if (node.activeDelay?.id !== delayId) {
        return node;
      }

      return {
        ...node,
        activeDelay: null,
        hasActiveOperationalDelay: false,
        activities: parsed.alreadyResolved
          ? node.activities || []
          : [
              {
                id: Date.now(),
                timestamp: now,
                update: activityMessage,
                updated_by: getActivityUpdaterRole(),
              },
              ...(node.activities || []),
            ],
      };
    })
  );

  const refreshChainId =
    propertyWithDelay?.chainId ??
    nodeWithDelay?.chain_id;

  if (refreshChainId != null) {
    await refreshOperationalSummariesForChain(
      Number(refreshChainId)
    );
  }

  return parsed;
};

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
    chainNodes,
    getMutationContext()
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

    updated_by: getActivityUpdaterRole(),
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

  await refreshOperationalSummariesForChain(
    property.chainId
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
      mutationContext: getMutationContext(),
    }
  );

  if (!result.ok) {
    return result;
  }

  const { position } = resolveMutationOperationalPosition({
    viewerUserId: currentUserId,
    chainId,
    chainProperties:
      mapToOperationalProperties(properties),
    chainNodes: chainNodes as OperationalBuyerReadyNode[],
    mutationContext: getMutationContext(),
  });

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

  await refreshOperationalSummariesForChain(
    chainId
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
        mutationContext: getMutationContext(),
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
        mutationContext: getMutationContext(),
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
        accountType,
        estateAgentOperationalAssignments,
        authLoading,
        participantDataReady,
        isAuthenticated,
        refreshParticipantData,
        updatePropertyStage,
        addStructuredUpdate,
        reportOperationalDelay,
        resolveOperationalDelay,
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

  if (
    typeof context.reportOperationalDelay !==
      "function" ||
    typeof context.resolveOperationalDelay !==
      "function"
  ) {
    throw new Error(
      "ChainProvider is missing operational delay actions. Perform a full page reload."
    );
  }

  return context;
}