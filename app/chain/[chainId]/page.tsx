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
import {
  type ChainNodesChainSummary,
  summaryToBuyerReadyTopologyInput,
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
      buyerReadySummary,
      setBuyerReadySummary,
    ] = useState<ChainNodesChainSummary | null>(
      null
    );
    useEffect(() => {

      async function loadBuyerReadySummary() {
    
        const {
          data: summaryData,
          error: summaryError,
        } = await supabase
        .from("chain_nodes_chain_summary")
        .select("*")
          .eq("chain_id", Number(chainId))
          .eq("node_type", "buyer_ready")
          .order("position")
          .limit(1)
          .maybeSingle();
    
        if (!summaryError && summaryData) {
    
          setBuyerReadySummary(summaryData);
    
        } else {
    
          setBuyerReadySummary(null);
    
        }
    
        console.log(
          "BUYER READY SUMMARY",
          summaryData,
          summaryError
        );
      }
    
      loadBuyerReadySummary();
    
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
  const buyerReadyTopologyInput =
    buyerReadySummary
      ? summaryToBuyerReadyTopologyInput(
          buyerReadySummary
        )
      : null;

  const topology = buildChainTopology(
    chainProperties,
    buyerReadyTopologyInput
  );

  console.log(
    "CHAIN PAGE BUYER READY SUMMARY",
    buyerReadySummary
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

  const buyerReadyNode =
    chainNodes.find(
      (node) =>
        Number(node.chain_id) ===
          Number(chainId) &&
        node.node_type === "buyer_ready"
    );

  const buyerReadyActivities =
    buyerReadyNode?.activities ?? [];

  const intelligence =
    computeChainIntelligence({
      chainProperties,
      buyerReadySummary,
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

  const operationalPositionResult =
    resolveOperationalPosition(
      currentUserId,
      chainId,
      chainProperties,
      chainNodes
    );

  const operationalPosition =
    operationalPositionResult.position;

  if (operationalPositionResult.ambiguity) {
    console.warn(
      "Operational position ambiguity",
      operationalPositionResult.ambiguity,
      chainId,
      currentUserId
    );
  }

  const saleOperationalPropertyId =
    operationalPosition?.kind === "sale"
      ? operationalPosition.propertyId
      : null;

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
    <main className="min-h-screen bg-slate-100">

      <Navbar />

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
          <div className={`mt-8 bg-white rounded-3xl border border-slate-200 ${CARD_PADDING_CLASS}`}>

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
        <div className={`mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 ${CARD_PADDING_CLASS}`}>

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

          <div className="mt-8 w-full h-6 bg-slate-200 rounded-full overflow-hidden">

            <div
              className="h-full bg-green-500 rounded-full"
              style={{
                width: `${averageProgress}%`,
              }}
            ></div>

          </div>

        </div>

        {/* Confidence */}
        <div className={`mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 ${CARD_PADDING_CLASS}`}>

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
<div className={`mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 ${CARD_PADDING_CLASS}`}>

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

<div className={`mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 ${CARD_PADDING_CLASS}`}>

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
          className={`mt-12 bg-white rounded-3xl shadow-sm border border-slate-200 ${CARD_PADDING_CLASS}`}
        >
          <MobileChainScrollRegion>
            <div className="flex items-center min-w-max pr-4 md:pr-0">
{topology.buyerReadyPrefix && (

<div className="flex items-center">

<Link
  href={`/buyer-ready/${chainId}`}
  className="hover:scale-105 transition"
>

    <ChainNode
  propertyNumber={0}
  displayTitle={CHAIN_TILE_LABEL.buyerReady}
  stageLabel={
    topology.buyerReadyPrefix.stageLabel
  }
  progress={
    topology.buyerReadyPrefix.node.progress
  }
  updatedDaysAgo={0}
  currentUserRole="buyer"
  status={
    topology.buyerReadyPrefix.node.status
  }
  buyer_connected={true}
  seller_connected={true}
  isOperationalPosition={
    operationalPosition?.kind ===
    "buyer_ready"
  }
  positionKind="buyer_ready"
/>

</Link>

  <div className="flex items-center mx-5">

    <div
      className="
        w-24 h-1 rounded-full bg-green-400
      "
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
              className="
                w-24
                h-1
                rounded-full
                bg-green-400
              "
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

    const displayTitle = getChainTileDisplayTitle(
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
              className={`
                w-24 h-1 rounded-full

                ${
                  linkGapState === "connected"
                    ? "bg-green-400"

                    : linkGapState === "broken"
                    ? "bg-red-400"

                    : "bg-amber-400"
                }
              `}
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
        <div className={`mt-10 bg-white rounded-3xl border border-slate-200 ${CARD_PADDING_CLASS}`}>

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
            className="mt-6 bg-slate-900 text-white px-6 py-4 rounded-2xl font-semibold"
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
              <div className={`bg-white rounded-3xl shadow-sm border border-slate-200 ${CARD_PADDING_CLASS}`}>
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