"use client";
import ChainNode from "@/components/ChainNode";
import { useState, useEffect } from "react";
import Navbar from "@/components/Navbar";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
  STAT_VALUE_CLASS,
  SECTION_TITLE_CLASS,
} from "@/components/mobileStandards";
import { MobilePanelHeader } from "@/components/mobile/MobileLayout";
import { MobileChainScrollRegion } from "@/components/mobile/MobileChainScrollRegion";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useChain } from "@/context/ChainContext";
import { supabase } from "@/lib/supabase";
import { STAGES } from "@/data/stages";
import {
  buildChainTopology,
  getLinkedPropertyGapState,
  isSearchingPlaceholder,
} from "@/lib/buildChainTopology";
import { computeChainIntelligence } from "@/lib/chainIntelligence";
import {
  CHAIN_TILE_LABEL,
  findSearchingPlaceholderLinkedFromSale,
  getChainTileDisplayTitle,
  mapToOperationalProperties,
  resolveOperationalPosition,
} from "@/lib/operationalPosition";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import {
  chainAwaitingBuyerConnectorClasses,
  chainConnectorClasses,
} from "@/lib/theme/chainViz";
import {
  BTN_PRIMARY_CLASS,
  CARD_CLASS_NO_PADDING,
  CHAIN_PROGRESS_FILL_CLASS,
  CHAIN_PROGRESS_TRACK_CLASS,
  CHAIN_VIZ_CANVAS_CLASS,
  PAGE_BG_CLASS,
} from "@/lib/theme/themeTokens";
import {
  type ChainNodesChainSummary,
} from "@/lib/chainNodesSummary";
import { convertSearchingPlaceholder } from "@/lib/searchingPlaceholder";
import CompletionScheduledBanner from "@/components/CompletionScheduledBanner";
import ChainCompletedBanner from "@/components/ChainCompletedBanner";
import PropertyEstateAgentAssignment from "@/components/estate-agents/PropertyEstateAgentAssignment";
import RecordCompletionDateForm from "@/components/RecordCompletionDateForm";
import { canShowCompletionSchedulingForm } from "@/lib/recordChainCompletionDate";
import { canAmendChainCompletionDate } from "@/lib/amendChainCompletionDate";
import { canConfirmChainCompletion } from "@/lib/confirmChainCompletion";
import type { CompletionAmendmentReasonCode } from "@/lib/completionLifecycle";
import {
  COMPLETION_SCHEDULED_CONFIDENCE_NOTE,
  isChainInCompletedCompletionMode,
  isChainInScheduledCompletionMode,
} from "@/lib/completionLifecycle";
import {
  findBuyerReadySummaryForAnchor,
  resolveUpstreamPurchaserState,
  shouldRenderUpstreamPurchaserBeforeProperty,
} from "@/lib/resolveUpstreamPurchaser";
import { BUYER_READY_STAGES } from "@/data/buyerReadyStages";
import type { OperationalPosition } from "@/lib/operationalPosition";

function resolveOwnerBuyerReadyChainNode(
  operationalPosition: OperationalPosition | null,
  chainNodes: {
    id: number;
    chain_id: number;
    node_type: string;
    linked_property_id?: number | null;
    stage?: string;
    status?: string;
    progress?: number;
  }[]
) {
  if (operationalPosition?.kind !== "buyer_ready") {
    return null;
  }

  return (
    chainNodes.find(
      (node) => node.id === operationalPosition.nodeId
    ) ?? null
  );
}

function resolveOwnerBuyerReadyStageLabel(
  node: { stage?: string } | null,
  summary: ChainNodesChainSummary | null
): string {
  if (summary?.public_stage_label) {
    return summary.public_stage_label;
  }

  const stageDefinition = BUYER_READY_STAGES.find(
    (stage) => stage.value === node?.stage
  );

  if (stageDefinition) {
    return stageDefinition.label;
  }

  if (node?.stage) {
    return node.stage
      .replaceAll("_", " ")
      .replace(/\b\w/g, (character) =>
        character.toUpperCase()
      );
  }

  return "Buyer Ready";
}

export default function ChainPage() {

  const params = useParams();
  const chainId =
    parseInt(
      params.chainId as string
    );

    const {
      properties,
      chains,
      chainNodes,
      currentUserId,
      recordChainCompletionDate,
      amendChainCompletionDate,
      confirmChainCompletion,
    } = useChain();
    const [
      buyerReadySummaries,
      setBuyerReadySummaries,
    ] = useState<ChainNodesChainSummary[]>(
      []
    );
    useEffect(() => {

      async function loadBuyerReadySummaries() {
    
        const {
          data: summaryData,
          error: summaryError,
        } = await supabase
        .from("chain_nodes_chain_summary")
        .select("*")
          .eq("chain_id", Number(chainId))
          .eq("node_type", "buyer_ready")
          .order("position");
    
        if (!summaryError && summaryData) {
    
          setBuyerReadySummaries(summaryData);
    
        } else {
    
          setBuyerReadySummaries([]);
    
        }
    
        console.log(
          "BUYER READY SUMMARIES",
          summaryData,
          summaryError
        );
      }
    
      loadBuyerReadySummaries();
    
    }, [chainId]);
    console.log("CHAIN ID", chainId);

    console.log(
      "PROPERTY CHAIN IDS",
      properties.map(
        (property) => property.chainId
      )
    );
    
    const chainProperties =

    properties
      .filter(
        (property) =>
          property.chainId === chainId
      )
      .sort(
        (a, b) =>
          a.chainPosition -
          b.chainPosition
      );

  const chainPropertiesLooseMatch =
    properties.filter(
      (property) =>
        Number(property.chainId) ===
        Number(chainId)
    );

  console.log("OPERATIONAL_POSITION_TIMING", {
    phase:
      chainProperties.length > 0
        ? "chainProperties_loaded"
        : "chainProperties_empty",
    propertiesCount: properties.length,
    chainPropertiesCount: chainProperties.length,
    chainPropertiesLooseMatchCount:
      chainPropertiesLooseMatch.length,
    chainIdStrictFilterMismatch:
      chainPropertiesLooseMatch.length > 0 &&
      chainProperties.length === 0,
    chainId,
    chainIdType: typeof chainId,
    currentUserId: currentUserId ?? null,
    buyerReadySummariesCount:
      buyerReadySummaries.length,
  });

  console.log(
    "CHAIN_PROPERTIES_COUNT",
    chainProperties.length
  );
  const topology = buildChainTopology(
    chainProperties,
    null
  );

  console.log(
    "CHAIN PAGE BUYER READY SUMMARIES",
    buyerReadySummaries
  );

      const recentActivities =

  chainProperties
    .flatMap((property) =>

      property.activities.map(
        (activity) => ({

          ...activity,


        })
      )
    )
    .sort(
      (a, b) =>

        new Date(
          b.timestamp || 0
        ).getTime()

        -

        new Date(
          a.timestamp || 0
        ).getTime()
    );
    console.log(
      "RECENT ACTIVITIES",
      recentActivities
    );

  const currentChain =
    chains.find(
      (chain) =>
        Number(chain.id) ===
        Number(chainId)
    );

  const isScheduledCompletionMode =
    isChainInScheduledCompletionMode({
      completionLifecycleStatus:
        currentChain?.completionLifecycleStatus,
      completionScheduledDate:
        currentChain?.completionScheduledDate,
    });

  const isCompletedCompletionMode =
    isChainInCompletedCompletionMode({
      completionLifecycleStatus:
        currentChain?.completionLifecycleStatus,
      completionScheduledDate:
        currentChain?.completionScheduledDate,
    });

  const isCompletionLifecycleFrozen =
    isScheduledCompletionMode ||
    isCompletedCompletionMode;

  const operationalPositionResult =
    resolveOperationalPosition(
      currentUserId,
      chainId,
      chainProperties,
      chainNodes
    );

  console.log(
    "OPERATIONAL_POSITION_RESULT",
    operationalPositionResult
  );

  if (operationalPositionResult.ambiguity) {
    console.warn(
      "Operational position ambiguity",
      operationalPositionResult.ambiguity,
      chainId,
      currentUserId
    );
  }

  const operationalPosition =
    operationalPositionResult.position;

  const ownerOperationalBuyerReadyNode =
    resolveOwnerBuyerReadyChainNode(
      operationalPosition,
      chainNodes
    );

  const ownerOperationalBuyerReadySummary =
    ownerOperationalBuyerReadyNode
      ? buyerReadySummaries.find(
          (summary) =>
            summary.id ===
            ownerOperationalBuyerReadyNode.id
        ) ?? null
      : null;

  const ownerBuyerReadyLinkedPropertyId =
    ownerOperationalBuyerReadyNode?.linked_property_id ??
    ownerOperationalBuyerReadySummary?.linked_property_id ??
    null;

  const showOwnerOperationalBuyerReady =
    operationalPosition?.kind === "buyer_ready" &&
    ownerOperationalBuyerReadyNode != null;

  const buyerReadyNode =
    ownerOperationalBuyerReadyNode ??
    chainNodes.find(
      (node) =>
        Number(node.chain_id) ===
          Number(chainId) &&
        node.node_type === "buyer_ready"
    );

  const buyerReadyActivities =
    buyerReadyNode?.activities ?? [];

  const saleOperationalPropertyId =
    operationalPosition?.kind === "sale"
      ? operationalPosition.propertyId
      : null;

  console.log(
    "SALE_OPERATIONAL_PROPERTY_ID",
    saleOperationalPropertyId
  );

  const buyerReadyForAnchor =
    findBuyerReadySummaryForAnchor(
      buyerReadySummaries,
      saleOperationalPropertyId
    );

  console.log("BUYER_READY_ANCHOR_DEBUG", {
    phase:
      chainProperties.length > 0
        ? "chainProperties_loaded"
        : "chainProperties_empty",
    propertiesCount: properties.length,
    chainPropertiesCount: chainProperties.length,
    currentUserId: currentUserId ?? null,
    insertedLinkedPropertyId:
      buyerReadySummaries[0]?.linked_property_id ?? null,
    insertedLinkedPropertyIdType:
      buyerReadySummaries[0]?.linked_property_id != null
        ? typeof buyerReadySummaries[0].linked_property_id
        : null,
    operationalSalePropertyId:
      saleOperationalPropertyId,
    operationalSalePropertyIdType:
      saleOperationalPropertyId != null
        ? typeof saleOperationalPropertyId
        : null,
    operationalPositionKind:
      operationalPosition?.kind ?? null,
    operationalPositionPropertyId:
      operationalPosition?.kind === "sale"
        ? operationalPosition.propertyId
        : null,
    summaryLinkedPropertyIds:
      buyerReadySummaries.map(
        (summary) => summary.linked_property_id
      ),
    strictComparisons:
      buyerReadySummaries.map((summary) => ({
        summaryLinkedPropertyId:
          summary.linked_property_id,
        operationalSalePropertyId:
          saleOperationalPropertyId,
        strictEquals:
          summary.linked_property_id ===
          saleOperationalPropertyId,
        numberEquals:
          Number(summary.linked_property_id) ===
          Number(saleOperationalPropertyId),
        typeofSummaryLinked:
          typeof summary.linked_property_id,
        typeofOperationalSale:
          typeof saleOperationalPropertyId,
      })),
    buyerReadyForAnchorId:
      buyerReadyForAnchor?.id ?? null,
    sellerHopProperties:
      chainProperties
        .filter(
          (property) =>
            property.currentUserRole ===
              "seller" &&
            property.isOwnProperty
        )
        .map((property) => ({
          id: property.id,
          idType: typeof property.id,
          relationship_type:
            property.relationship_type,
          chainPosition:
            property.chainPosition,
          buyer_connected:
            property.buyer_connected,
        })),
  });

  const buyerReadySummaryForIntelligence =
    buyerReadyForAnchor ??
    buyerReadySummaries[0] ??
    null;

  const upstreamPurchaser =
    resolveUpstreamPurchaserState({
      operationalSalePropertyId:
        saleOperationalPropertyId,
      chainProperties: chainProperties.map(
        (property) => ({
          id: property.id,
          buyer_connected:
            property.buyer_connected,
        })
      ),
      buyerReadyForAnchor,
    });

  const intelligence =
    computeChainIntelligence({
      chainProperties,
      buyerReadySummary:
        buyerReadySummaryForIntelligence,
      buyerReadyActivities,
      stages: STAGES,
      scheduledCompletionMode:
        isCompletionLifecycleFrozen,
    });

  const {
    staleProperties,
    chainHealth,
    chainHealthMessage,
    averageProgress,
    confidenceScore,
    confidenceLabel,
    confidenceColour,
    confidenceBg,
    estimatedChainCompletion,
    bottleneckProperty,
  } = intelligence;
  
  console.log(
    "CHAIN TOPOLOGY",
    topology
  );

  const searchingPlaceholderLinkedFromSale =
    saleOperationalPropertyId
      ? findSearchingPlaceholderLinkedFromSale(
          chainProperties,
          saleOperationalPropertyId
        )
      : null;

  const activeSearchingPlaceholder =
    searchingPlaceholderLinkedFromSale !== null;

  const chainPropertiesForCompletion =
    mapToOperationalProperties(
      chainProperties
    );

  const showCompletionScheduledBanner =
    isScheduledCompletionMode;

  const showCompletedBanner =
    isCompletedCompletionMode &&
    !!currentChain?.completionScheduledDate &&
    !!currentChain?.completionConfirmedAt;

  const showCompletionSchedulingForm =
    !isCompletedCompletionMode &&
    canShowCompletionSchedulingForm({
      chainScheduledDate:
        currentChain?.completionScheduledDate,
      userId: currentUserId,
      chainId,
      chainProperties:
        chainPropertiesForCompletion,
      chainNodes: chainNodes,
    });

  const showAmendCompletionDate =
    canAmendChainCompletionDate({
      chainScheduledDate:
        currentChain?.completionScheduledDate,
      chainLifecycleStatus:
        currentChain?.completionLifecycleStatus,
      userId: currentUserId,
      chainId,
      chainProperties:
        chainPropertiesForCompletion,
      chainNodes: chainNodes,
    });

  const showConfirmCompletion =
    canConfirmChainCompletion({
      completionLifecycleStatus:
        currentChain?.completionLifecycleStatus,
      completionScheduledDate:
        currentChain?.completionScheduledDate,
      userId: currentUserId,
      chainId,
      chainProperties:
        chainPropertiesForCompletion,
      chainNodes: chainNodes,
    });

  async function handleRecordCompletionDate(
    scheduledDate: string
  ) {
    const result = await recordChainCompletionDate(
      chainId,
      scheduledDate
    );

    return {
      ok: result.ok,
      message: result.ok
        ? undefined
        : result.message,
    };
  }

  async function handleAmendCompletionDate(
    newScheduledDate: string,
    reasonCode: CompletionAmendmentReasonCode
  ) {
    const result = await amendChainCompletionDate(
      chainId,
      newScheduledDate,
      reasonCode
    );

    return {
      ok: result.ok,
      message: result.ok
        ? undefined
        : result.message,
    };
  }

  async function handleConfirmCompletion() {
    const result = await confirmChainCompletion(
      chainId
    );

    return {
      ok: result.ok,
      message: result.ok
        ? undefined
        : result.message,
    };
  }

  const [newAddress, setNewAddress] =
    useState("");
    
  const [newPostcode, setNewPostcode] =
    useState("");

  async function handleAddProperty() {

    if (!newAddress || !newPostcode) {

      alert("Please complete fields");

      return;
    }

    if (!currentUserId) {

      alert(
        "Please log in to add your onward purchase."
      );

      return;
    }

    if (!saleOperationalPropertyId) {

      alert(
        "Only a participant at a Sale position can add an onward purchase."
      );

      return;
    }

    const result =
      await convertSearchingPlaceholder(
        supabase,
        {
          chainId,
          salePropertyId: saleOperationalPropertyId,
          address: newAddress,
          postcode: newPostcode,
        }
      );

    if (!result.ok) {

      if (
        result.reason ===
        "duplicate_address"
      ) {
        alert(
          "This property already exists within an active chain."
        );
      } else if (
        result.reason === "not_found"
      ) {
        alert(
          "No active searching placeholder found on this chain."
        );
      } else {
        alert(
          "Could not add your onward purchase. Please try again."
        );
        console.error(result.error);
      }

      return;
    }

    window.location.reload();
  }

  return (
    <main className={PAGE_BG_CLASS}>

      <Navbar />
      <PageHeaderBand />

      <div className="max-w-6xl mx-auto px-6 py-12">

        <div>

          <h1 className={PAGE_TITLE_CLASS}>
            Chain #{chainId}
          </h1>

        {showCompletedBanner &&
          currentChain?.completionScheduledDate &&
          currentChain?.completionConfirmedAt && (
            <ChainCompletedBanner
              scheduledDate={
                currentChain.completionScheduledDate
              }
              confirmedAt={
                currentChain.completionConfirmedAt
              }
              layout="primary"
            />
          )}

        {showCompletionScheduledBanner &&
          currentChain?.completionScheduledDate && (
            <CompletionScheduledBanner
              scheduledDate={
                currentChain.completionScheduledDate
              }
              layout="primary"
              showChangeButton={
                showAmendCompletionDate
              }
              showConfirmButton={
                showConfirmCompletion
              }
              onChangeDate={
                handleAmendCompletionDate
              }
              onConfirmCompletion={
                handleConfirmCompletion
              }
            />
          )}

          {!isCompletedCompletionMode && (
          <div className={`mt-8 ${CARD_CLASS_NO_PADDING} ${CARD_PADDING_CLASS}`}>

<div className="flex items-center gap-4">

  <div
    className={`
      px-4 py-2 rounded-full text-sm font-semibold

      ${
        chainHealth === "Stable"
          ? "bg-green-100 text-green-700"

        : chainHealth === "Active"
          ? "bg-amber-100 text-amber-700"

        : "bg-red-100 text-red-700"
      }
    `}
  >

    Chain Health: {chainHealth}

  </div>

</div>

<p className="mt-4 text-slate-600">
  {chainHealthMessage}
</p>

</div>
          )}

          <p className="text-slate-600 mt-3 text-lg">
            Live property chain progress tracking
          </p>

          <p className="mt-2 text-sm text-slate-500">
            Access Code:{" "}
            {currentChain?.accessCode || "Loading..."}
          </p>

          <p className="mt-2 text-slate-600">

            Status:{" "}

            {currentChain?.state
              ?.replaceAll("_", " ")
              .replace(/\b\w/g, (letter) =>
                letter.toUpperCase()
              )}

          </p>

        </div>

        {showCompletionSchedulingForm && (
          <RecordCompletionDateForm
            onSubmit={handleRecordCompletionDate}
          />
        )}

        {!isCompletedCompletionMode && (
        <>
        {/* Progress */}
        <div className={`mt-10 ${CARD_CLASS_NO_PADDING} ${CARD_PADDING_CLASS}`}>

          <MobilePanelHeader
            aside={
              <div className={STAT_VALUE_CLASS}>
                {averageProgress}%
              </div>
            }
          >
            <h2 className={SECTION_TITLE_CLASS}>
              Chain Progress
            </h2>

            <p className="text-slate-600 mt-2">
              Overall chain completion estimate
            </p>
          </MobilePanelHeader>

          <div className={`mt-8 ${CHAIN_PROGRESS_TRACK_CLASS}`}>

            <div
              className={CHAIN_PROGRESS_FILL_CLASS}
              style={{
                width: `${averageProgress}%`,
              }}
            ></div>

          </div>

        </div>

        {/* Confidence */}
        <div className={`mt-10 ${CARD_CLASS_NO_PADDING} ${CARD_PADDING_CLASS}`}>

          <MobilePanelHeader
            aside={
              <div
                className={`${confidenceBg} px-6 py-4 rounded-2xl`}
              >
                <p className={`text-2xl sm:text-3xl font-bold ${confidenceColour}`}>
                  {confidenceScore}%
                </p>

                <p className={`text-sm mt-1 ${confidenceColour}`}>
                  {confidenceLabel}
                </p>

                <p className="text-xs text-slate-500 mt-4 max-w-xs">
                  {isScheduledCompletionMode
                    ? COMPLETION_SCHEDULED_CONFIDENCE_NOTE
                    : "Confidence is calculated using chain progress, recent activity, delayed updates and blocked transactions."}
                </p>
              </div>
            }
          >
            <h2 className={SECTION_TITLE_CLASS}>
              Chain Confidence
            </h2>
          </MobilePanelHeader>

        </div>
{!isCompletionLifecycleFrozen && (
<>
{/* Estimated Chain Completion */}
<div className={`mt-10 ${CARD_CLASS_NO_PADDING} ${CARD_PADDING_CLASS}`}>

  <MobilePanelHeader
    aside={
      <div className="bg-blue-100 text-blue-700 px-5 py-3 rounded-2xl text-sm font-semibold whitespace-nowrap">
        Forecast Engine
      </div>
    }
  >
    <p className="text-sm font-medium text-slate-500">
      Estimated Chain Completion
    </p>

    <h2 className={`mt-3 ${SECTION_TITLE_CLASS}`}>
      {estimatedChainCompletion}
    </h2>

    <p className="mt-4 text-slate-600 max-w-2xl">
      Estimated completion is based on overall chain progression, delays, stale activity and blocked transactions.
    </p>
  </MobilePanelHeader>

</div>
{/* Chain Bottleneck */}
{bottleneckProperty && (

<div className={`mt-10 ${CARD_CLASS_NO_PADDING} ${CARD_PADDING_CLASS}`}>

  <MobilePanelHeader
    aside={
      <div className="bg-amber-100 text-amber-700 px-5 py-3 rounded-2xl text-sm font-semibold whitespace-nowrap">
        Bottleneck Detected
      </div>
    }
  >
    <p className="text-sm font-medium text-slate-500">
      Chain Bottleneck
    </p>

    <h2 className={`mt-3 ${SECTION_TITLE_CLASS}`}>
      Property {bottleneckProperty.chainPosition}
    </h2>

    <p className="mt-4 text-slate-600">
      This property currently appears to be slowing overall chain progression.
    </p>

    <div className="mt-6 space-y-2">
      <p className="text-slate-900 font-medium"></p>

      <p className="text-slate-500">
        Last updated {bottleneckProperty.lastUpdatedDays} days ago
      </p>
    </div>
  </MobilePanelHeader>

</div>

)}
</>
)}
        {/* Warning */}
        {!isCompletionLifecycleFrozen &&
        staleProperties.length > 0 && (

          <div className="mt-10 bg-amber-100 border border-amber-300 rounded-3xl p-6">

            <p className="text-amber-700 font-semibold">
              Property {staleProperties[0].id} has not updated for{" "}
              {staleProperties[0].lastUpdatedDays} days.
            </p>

          </div>

        )}

        </>
        )}

        {/* Chain */}
        <div
          className={`mt-12 ${CARD_CLASS_NO_PADDING} ${CARD_PADDING_CLASS}`}
        >
          <MobileChainScrollRegion>
            <div className={`${CHAIN_VIZ_CANVAS_CLASS} flex items-center min-w-max pr-4 md:pr-0`}>
  {showOwnerOperationalBuyerReady &&
    ownerOperationalBuyerReadyNode && (

    <div className="flex items-center">

      <Link
        href={`/buyer-ready/${chainId}`}
        className="hover:scale-105 transition"
      >

        <ChainNode
          propertyNumber={0}
          displayTitle={
            CHAIN_TILE_LABEL.buyerReady
          }
          stageLabel={resolveOwnerBuyerReadyStageLabel(
            ownerOperationalBuyerReadyNode,
            ownerOperationalBuyerReadySummary
          )}
          progress={
            ownerOperationalBuyerReadyNode.progress ??
            ownerOperationalBuyerReadySummary?.progress ??
            0
          }
          updatedDaysAgo={0}
          currentUserRole="buyer"
          status={
            ownerOperationalBuyerReadyNode.status ??
            ownerOperationalBuyerReadySummary?.status ??
            "healthy"
          }
          buyer_connected={true}
          seller_connected={true}
          isOperationalPosition={true}
          positionKind="buyer_ready"
        />

      </Link>

      <div className="flex items-center mx-5">

        <div
          className={chainConnectorClasses(
            "connected"
          )}
        />

      </div>

    </div>

  )}
  {topology.segments.map((segment, segmentIndex) => {

    const segmentGapState =
      segment.gapBefore;

    return (

      <div
        key={`segment-${segmentIndex}`}
        className="flex items-center"
      >

        {segmentGapState === "broken" && (

          <div
            className="flex flex-col items-center mx-10 shrink-0"
            aria-label="Chain break"
          >

            <div
              className="
                h-20
                border-l-4
                border-dashed
                border-red-400
              "
            />

            <p
              className="
                mt-2
                text-xs
                font-semibold
                text-red-600
                whitespace-nowrap
              "
            >
              Chain break
            </p>

          </div>

        )}

        {segmentGapState ===
          "awaiting_connection" && (

          <div
            className="flex flex-col items-center mx-10 shrink-0"
            aria-label="Awaiting connection"
          >

            <div
              className="
                h-20
                border-l-4
                border-dashed
                border-amber-400
              "
            />

            <p
              className="
                mt-2
                text-xs
                font-semibold
                text-amber-700
                whitespace-nowrap
              "
            >
              Awaiting connection
            </p>

          </div>

        )}

        {segmentGapState ===
          "connected" && (

          <div className="flex items-center mx-5">

            <div
              className={chainConnectorClasses("connected")}
            />

          </div>

        )}

        {segment.propertyNodes.map((property, propertyIndex) => {

    const stage = STAGES.find(
      (stage) =>
        stage.value === property.stage
    );

    const searchingPlaceholder =
      isSearchingPlaceholder(property);

    const isOperationalPosition =
      operationalPosition?.kind === "sale" &&
      operationalPosition.propertyId ===
        property.id;

    const showUpstreamPurchaserBeforeSale =
      shouldRenderUpstreamPurchaserBeforeProperty(
        upstreamPurchaser,
        property.id,
        isOperationalPosition
      );

    const displayTitle =
      ownerBuyerReadyLinkedPropertyId !=
        null &&
      Number(property.id) ===
        Number(ownerBuyerReadyLinkedPropertyId)
        ? CHAIN_TILE_LABEL.connectedPurchase
        : getChainTileDisplayTitle(
            property,
            isOperationalPosition
          );

    let displayStage = "In Progress";

    if (searchingPlaceholder) {

      displayStage =
        "Onward purchase not yet identified";

    } else if (property.awaiting_buyer) {

      displayStage = "Awaiting buyer";

    } else if (
      property.status === "pending_connection" &&
      property.relationship_type ===
        "purchase"
    ) {

      displayStage = "Awaiting seller connection";

    } else if (stage?.label) {

      displayStage = stage.label;

    }
    
    return (

      <div
        key={property.id}
        className="flex items-center"
      >

        {showUpstreamPurchaserBeforeSale &&
          upstreamPurchaser?.kind ===
            "awaiting_buyer" && (

          <div
            className="flex items-center"
            aria-label="Awaiting buyer, no purchaser connected yet"
          >

            <ChainNode
              propertyNumber={0}
              displayTitle={
                CHAIN_TILE_LABEL.awaitingBuyer
              }
              stageLabel="No purchaser connected yet"
              progress={0}
              updatedDaysAgo={0}
              currentUserRole={null}
              status="pending_connection"
              buyer_connected={false}
              seller_connected={false}
              positionKind="awaiting_buyer"
            />

            <div className="flex items-center mx-5">

              <div
                className={chainAwaitingBuyerConnectorClasses()}
              />

            </div>

          </div>

        )}

        {showUpstreamPurchaserBeforeSale &&
          upstreamPurchaser?.kind ===
            "buyer_ready" && (

          <div
            className="flex items-center"
            aria-label="Buyer ready, ready to proceed"
          >

            <ChainNode
              propertyNumber={0}
              displayTitle={
                CHAIN_TILE_LABEL.buyerReady
              }
              stageLabel="Ready to proceed"
              progress={
                upstreamPurchaser.summary.progress
              }
              updatedDaysAgo={0}
              currentUserRole={null}
              status={
                upstreamPurchaser.summary.status
              }
              buyer_connected={true}
              seller_connected={true}
              positionKind="buyer_ready"
            />

            <div className="flex items-center mx-5">

              <div
                className={chainConnectorClasses(
                  "connected"
                )}
              />

            </div>

          </div>

        )}

        {searchingPlaceholder ? (

          <ChainNode
            propertyNumber={
              property.chainPosition
            }
            displayTitle={displayTitle}
            stageLabel={displayStage}
            progress={stage?.progress || 0}
            updatedDaysAgo={
              property.lastUpdatedDays
            }
            currentUserRole={
              property.currentUserRole
            }
            status={property.status}
            buyer_connected={
              property.buyer_connected
            }
            seller_connected={
              property.seller_connected
            }
            isOperationalPosition={
              isOperationalPosition
            }
            positionKind={
              isOperationalPosition
                ? "sale"
                : undefined
            }
          />

        ) : (

        <Link
          href={`/property/${property.id}`}
          className="hover:scale-105 transition"
        >

          <ChainNode
            propertyNumber={
              property.chainPosition
            }
            displayTitle={displayTitle}
            stageLabel={
              property.status ===
              "pending_connection"
                ? "Awaiting seller connection"
                : property.status ===
                  "broken_connection"
                ? "Reconnect required"
                : displayStage
            }
            progress={stage?.progress || 0}
            updatedDaysAgo={
              property.lastUpdatedDays
            }
            currentUserRole={
              property.currentUserRole
            }
            status={property.status}
            buyer_connected={
              property.buyer_connected
            }
            seller_connected={
              property.seller_connected
            }
            isOperationalPosition={
              isOperationalPosition
            }
            positionKind={
              isOperationalPosition
                ? "sale"
                : undefined
            }
          />

        </Link>

        )}

        {propertyIndex < segment.propertyNodes.length - 1 && (() => {
          const nextProperty =
            segment.propertyNodes[
              propertyIndex + 1
            ];
          const linkGapState =
            getLinkedPropertyGapState(
              property,
              nextProperty
            );

          return (
          <div className="flex items-center mx-5">

            <div
              className={chainConnectorClasses(
                linkGapState === "connected"
                  ? "connected"
                  : linkGapState === "broken"
                  ? "broken"
                  : "awaiting"
              )}
            />

          </div>
          );
        })()}

      </div>

    );
  })}

      </div>

    );
  })}

  {topology.syntheticTerminus && (
  <div className="flex items-center">

    <div className="flex items-center mx-5">

      <div
        className="
          w-24
          border-t-4
          border-dashed
          border-slate-300
        "
      ></div>

    </div>

    <ChainNode
      propertyNumber={
        topology.syntheticTerminus.propertyNumber
      }
      displayTitle={
        topology.syntheticTerminus.terminus ===
        "end_of_chain"
          ? "End Of Chain"
          : CHAIN_TILE_LABEL.nextHomeSearch
      }
      stageLabel={
        topology.syntheticTerminus.terminus ===
        "end_of_chain"
          ? "No onward purchase"
          : "Searching for forever home"
      }
      progress={
        topology.syntheticTerminus.terminus ===
        "end_of_chain"
          ? 100
          : 0
      }
      updatedDaysAgo={0}
      currentUserRole={null}
      status={
        topology.syntheticTerminus.terminus ===
        "end_of_chain"
          ? "healthy"
          : "pending_connection"
      }
      buyer_connected={false}
      seller_connected={false}
    />

  </div>
  )}

            </div>
          </MobileChainScrollRegion>
        </div>
{/* Recent Activity Feed */}

<div className={`mt-10 bg-white border border-slate-200 rounded-3xl ${CARD_PADDING_CLASS}`}>

  <h2 className={SECTION_TITLE_CLASS}>
    Recent Chain Activity
  </h2>

  <div className="mt-6 space-y-4">
    {recentActivities.length === 0 && (

      <p className="text-slate-500">
        Updates from chain participants will appear here as progress is made.
      </p>

    )}

    {recentActivities.map((activity, index) => (

      <div
        key={`${activity.id}-${index}`}
        className="border border-slate-200 rounded-2xl p-5"
      >

        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">

          <div className="min-w-0">

            <p className="font-semibold text-slate-900">
              {activity.update}
            </p>

            <p className="text-xs text-slate-400 mt-2">
            Updated by {activity.updated_by || "homeowner"}
            </p>

          </div>

          <div className="text-xs text-slate-400 shrink-0">

            {new Date(
              activity.timestamp
            ).toLocaleDateString()}

          </div>

        </div>

      </div>

    ))}

  </div>

</div>
        {activeSearchingPlaceholder && (
        <div className={`mt-10 ${CARD_CLASS_NO_PADDING} ${CARD_PADDING_CLASS}`}>

          <h2 className="text-2xl font-bold text-slate-900">
            Add Onward Purchase
          </h2>

          <p className="mt-2 text-slate-600">
            Only add your onward purchase once your offer has been accepted.
          </p>

          <input
            type="text"
            value={newAddress}
            onChange={(event) =>
              setNewAddress(
                event.target.value
              )
            }
            placeholder="Property address"
            className="mt-6 w-full border border-slate-300 text-slate-900 rounded-2xl px-4 py-4"
          />

          <input
            type="text"
            value={newPostcode}
            onChange={(event) =>
              setNewPostcode(
                event.target.value
              )
            }
            placeholder="Postcode"
            className="mt-4 w-full border border-slate-300 text-slate-900 rounded-2xl px-4 py-4"
          />

          <button
            onClick={handleAddProperty}
            className={`mt-6 ${BTN_PRIMARY_CLASS} px-6 py-4`}
          >
            Add Property
          </button>

        </div>
        )}
          <div className="mt-8">
            {saleOperationalPropertyId ? (
              <PropertyEstateAgentAssignment
                propertyId={
                  saleOperationalPropertyId
                }
              />
            ) : (
              <div className={`${CARD_CLASS_NO_PADDING} ${CARD_PADDING_CLASS}`}>
                <h2 className="text-2xl font-bold text-slate-900">
                  Estate Agent
                </h2>

                <p className="text-slate-500 mt-2">
                  Assign an estate agent from your operational
                  sale property page when you have an editable
                  sale position in this chain.
                </p>
              </div>
            )}
          </div>

      </div>

    </main>
  );
}