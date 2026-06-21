"use client";

import { useParams } from "next/navigation";
import {
  useState,
  useEffect,
} from "react";
import Navbar from "@/components/Navbar";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
  SECTION_TITLE_CLASS,
} from "@/components/mobileStandards";
import {
  MobileAlert,
  MobileAlertStack,
  MobilePageNavRow,
  MobilePanelHeader,
} from "@/components/mobile/MobileLayout";
import { useChain } from "@/context/ChainContext";
import {
    BUYER_READY_STAGES
  } from "@/data/buyerReadyStages";
import { supabase } from "@/lib/supabase";
import {
  canEditBuyerReady,
  CHAIN_TILE_LABEL,
  CONNECTED_POSITION_MESSAGE,
  getOperationalBuyerReadyHeadline,
  OPERATIONAL_BUYER_READY_BANNER_MESSAGE,
} from "@/lib/propertyPermissions";
import {
  validateBuyerReadyStageTransition,
  COMPLETION_DATE_AGREED_REQUIRES_CONTRACTS_EXCHANGED_MESSAGE,
  isChainInCompletedCompletionMode,
  isChainInScheduledCompletionMode,
} from "@/lib/completionLifecycle";
import OperationalCompletionDatePanel from "@/components/OperationalCompletionDatePanel";
import {
  mapToOperationalProperties,
} from "@/lib/operationalPosition";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import {
  BTN_PRIMARY_CLASS,
  CARD_CLASS_NO_PADDING,
  PAGE_BG_CLASS,
  SURFACE_INSET_CLASS,
} from "@/lib/theme/themeTokens";
import {
  canShowOperationalCompletionDateEntry,
} from "@/lib/recordChainCompletionDate";
import {
  canAmendChainCompletionDate,
} from "@/lib/amendChainCompletionDate";
import {
  canConfirmChainCompletion,
} from "@/lib/confirmChainCompletion";
import {
  daysSinceLastActivity,
  getLatestDelayReport,
  hasActiveDelayReport,
  STALE_DAYS_PAGE_ALERT,
} from "@/lib/activityIntelligence";
import type { CompletionAmendmentReasonCode } from "@/lib/completionLifecycle";
export default function BuyerReadyPage() {

  const [updateType, setUpdateType] =
    useState("");

  const [delayReason, setDelayReason] =
    useState("");
    const [draftStage, setDraftStage] =
  useState("");
  const [successMessage, setSuccessMessage] =
  useState("");
  const [warningMessage, setWarningMessage] =
  useState("");
  const [isSaving, setIsSaving] =
  useState(false);
  const params = useParams();
  const chainId = Number(params.chainId);

  const {
    properties,
    chainNodes,
    chains,
    addStructuredUpdate,
    currentUserId,
    recordChainCompletionDate,
    amendChainCompletionDate,
    confirmChainCompletion,
  } = useChain();
  console.log(
  "BUYER READY PROPERTIES",
  properties
);

  
  useEffect(() => {

    async function loadBuyerNode() {
      const {
        data,
        error,
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
        `)
        .eq("chain_id", chainId)
        .eq("node_type", "buyer_ready")
        .single();
  
      if (!error && data) {
  
        setBuyerNode(data);
  
      }
    }
  
    loadBuyerNode();
  
  }, [chainId]);
  const [buyerNode, setBuyerNode] =
  useState<any>(null);
  console.log(
    "CURRENT USER",
    currentUserId
  );
  
  console.log(
    "PROPERTIES",
    properties
  );
  
  console.log(
    "BUYER NODE",
    buyerNode
  );
  function formatTimeAgo(
    timestamp: string
  ) {

    const now =
      new Date();

    const activityTime =
      new Date(timestamp);

    const diffMs =
      now.getTime() -
      activityTime.getTime();

    const minutes =
      Math.floor(diffMs / 60000);

    const hours =
      Math.floor(minutes / 60);

    const days =
      Math.floor(hours / 24);

    if (minutes < 1) {
      return "Just now";
    }

    if (minutes < 60) {
      return `${minutes} mins ago`;
    }

    if (hours < 24) {
      return `${hours} hours ago`;
    }

    return `${days} days ago`;
  }

  if (!buyerNode) {
    return (
      <div className="p-10 text-2xl">
        Property not found
      </div>
    );
  }
  const canEdit = canEditBuyerReady(
    buyerNode.id,
    chainId,
    currentUserId,
    properties,
    chainNodes
  );

  const currentChain = chains.find(
    (chain) => Number(chain.id) === Number(chainId)
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

  const chainPropertiesForCompletion =
    mapToOperationalProperties(
      properties.filter(
        (property) =>
          Number(property.chainId) ===
          Number(chainId)
      )
    );

  const showOperationalCompletionEntry =
    canShowOperationalCompletionDateEntry({
      chainScheduledDate:
        currentChain?.completionScheduledDate,
      userId: currentUserId,
      chainId,
      chainProperties:
        chainPropertiesForCompletion,
      chainNodes: chainNodes,
    });

  const showOperationalCompletionPanel =
    isCompletedCompletionMode ||
    !!currentChain?.completionScheduledDate ||
    showOperationalCompletionEntry;

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

  const linkedProperty =
    properties.find(
      (property) =>
        property.id ===
        buyerNode.linked_property_id
    );

  const timelineActivities = [
    ...(buyerNode.activities || []),
    ...(linkedProperty?.activities || []),
  ].sort(
    (a, b) =>
      new Date(b.timestamp).getTime() -
      new Date(a.timestamp).getTime()
  );

  const currentStage =
  BUYER_READY_STAGES.find(
    (stage) =>
      stage.value === buyerNode?.stage
  );
  async function updateBuyerStage() {
    
      if (isSaving || !canEdit) {
        return;
      }
      
      setIsSaving(true);
    const selectedStage =
      BUYER_READY_STAGES.find(
        (stage) =>
          stage.value === draftStage
      );
    
    if (!selectedStage) {
      setIsSaving(false);
      return;
    }
    if (
      buyerNode.stage === selectedStage.value
    ) {
    
      setWarningMessage(
        "This status has already been recorded."
      );
      
      setTimeout(() => {
      
        setWarningMessage("");
      
      }, 4000);
    
      setIsSaving(false);
      return;
    
    }

    const stageGateResult =
      validateBuyerReadyStageTransition(
        buyerNode.stage,
        selectedStage.value
      );

    if (!stageGateResult.ok) {
      setWarningMessage(stageGateResult.message);

      setTimeout(() => {
        setWarningMessage("");
      }, 4000);

      setIsSaving(false);

      return;
    }

    const {
      data,
      error,
    } = await supabase
      .from("chain_nodes")
      .update({
  
        stage: selectedStage.value,
  
        progress:
          selectedStage.progress,
  
        status:
          selectedStage.progress >= 95
            ? "healthy"
            : "pending_connection",
  
      })
      .eq("id", buyerNode.id)
      .select()
      .single();
  
      if (!error && data) {
      
        await addStructuredUpdate(

          buyerNode.id,
        
          selectedStage.label,
        
          "buyer_ready"
        
        );
      
        setBuyerNode(data);

setDraftStage("");

setSuccessMessage(
  "Buyer Ready status updated successfully."
);

setTimeout(() => {

  setSuccessMessage("");

}, 4000);
      } else if (error) {
        console.error(error);

        if (
          typeof error.message === "string" &&
          error.message.includes(
            "completion_date_agreed_requires_contracts_exchanged"
          )
        ) {
          setWarningMessage(
            COMPLETION_DATE_AGREED_REQUIRES_CONTRACTS_EXCHANGED_MESSAGE
          );
        } else {
          setWarningMessage(
            "Could not update Buyer Ready status."
          );
        }

        setTimeout(() => {
          setWarningMessage("");
        }, 4000);
      }

      setIsSaving(false);
  
  }
  const latestDelay =
    getLatestDelayReport(
      buyerNode.activities
    );
  const activeDelayReport =
    hasActiveDelayReport(
      buyerNode.activities
    );
  const buyerLastUpdatedDays =
    daysSinceLastActivity(
      buyerNode.activities
    );

let actionTitle =
  "No Immediate Actions";

let actionMessage =
  "Your transaction appears to be progressing normally.";

let actionColour =
  "bg-green-100 text-green-700";

if (activeDelayReport && latestDelay) {

  actionTitle =
    "Delay Reported";

  actionMessage =
    latestDelay.update;

  actionColour =
    "bg-amber-100 text-amber-700";
}

if (
  !isCompletionLifecycleFrozen &&
    buyerLastUpdatedDays > STALE_DAYS_PAGE_ALERT
) {

  actionTitle =
    "Update Recommended";

  actionMessage =
    `No updates have been added for ${buyerLastUpdatedDays} days. Consider checking progress with your estate agent or conveyancer.`;

  actionColour =
    "bg-red-100 text-red-700";
}

const currentStageIndex =
BUYER_READY_STAGES.findIndex(
    (stage) =>
      stage.value === buyerNode.stage
  );
  
  const completedStages =
  currentStageIndex >= 0
    ? BUYER_READY_STAGES.slice(
        0,
        currentStageIndex + 1
      )
    : [];
 

let estimatedCompletion =
  "16–20 weeks remaining";

const progress =
  currentStage?.progress || 0;

if (progress >= 20) {
  estimatedCompletion =
    "12–16 weeks remaining";
}

if (progress >= 40) {
  estimatedCompletion =
    "8–12 weeks remaining";
}

if (progress >= 60) {
  estimatedCompletion =
    "4–8 weeks remaining";
}

if (progress >= 80) {
  estimatedCompletion =
    "1–3 weeks remaining";
}

if (activeDelayReport) {

  estimatedCompletion =
    `${estimatedCompletion} (delay detected)`;
}

if (
  !isCompletionLifecycleFrozen &&
    buyerLastUpdatedDays > STALE_DAYS_PAGE_ALERT
) {

  estimatedCompletion =
    `${estimatedCompletion} (stale activity)`;
}
async function handleStructuredUpdate() {

  if (!updateType || !canEdit) {
    return;
  }
    
      let updateMessage =
        "General Update";
    
      if (
        updateType === "delay" &&
        delayReason
      ) {
    
        updateMessage =
          `Delay Reported: ${delayReason}`;
    
      }
      else if (
        updateType === "documents"
      ) {
    
        updateMessage =
          "Awaiting Documents";
    
      }
      else if (
        updateType === "survey"
      ) {
    
        updateMessage =
          "Survey Update Added";
    
      }
      else if (
        updateType === "mortgage"
      ) {
    
        updateMessage =
          "Mortgage Update Added";
    
      }
      else if (
        updateType === "milestone"
      ) {
    
        updateMessage =
          "Milestone Reached";
    
      }
    
      if (!buyerNode) {
        return;
      }
      
      const latestActivity =
        buyerNode.activities?.[0];
      
      if (
        latestActivity?.update ===
        updateMessage
      ) {
      
        setWarningMessage(
          "This update has already been recorded."
        );
        
        setTimeout(() => {
        
          setWarningMessage("");
        
        }, 4000);
      
        return;
      
      }
      
      await addStructuredUpdate(
        buyerNode.id,
        updateMessage,
        "buyer_ready"
      );
      
      setUpdateType("");
      setDelayReason("");
      
      setSuccessMessage(
        "Update shared with the chain."
      );
      
      setTimeout(() => {
      
        setSuccessMessage("");
      
      }, 4000);
}
  return (
    <main className={PAGE_BG_CLASS}>

      <Navbar />
      <PageHeaderBand />

      <div className="max-w-4xl mx-auto px-6 py-12">

        {(successMessage || warningMessage) && (
          <MobileAlertStack>
            {successMessage ? (
              <MobileAlert variant="success">
                ✓ {successMessage}
              </MobileAlert>
            ) : null}

            {warningMessage ? (
              <MobileAlert variant="warning">
                ⚠ {warningMessage}
              </MobileAlert>
            ) : null}
          </MobileAlertStack>
        )}

        <MobilePageNavRow
          links={[
            {
              href: `/chain/${buyerNode.chain_id}`,
              label: "← Back to Chain",
            },
            {
              href: "/dashboard",
              label: "Dashboard",
            },
          ]}
        />

        {/* Header */}
        <div
          className={`bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}
        >

<h1 className={PAGE_TITLE_CLASS}>

{CHAIN_TILE_LABEL.buyerReady}

</h1>

<p className="text-slate-600 mt-3 text-lg">

  Buyer transaction workflow

</p>

</div>

        {/* Current Status */}
        <div
          className={`mt-8 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}
        >
          <MobilePanelHeader
            aside={
              <div className="bg-green-100 text-green-700 px-5 py-3 rounded-2xl text-base sm:text-lg font-semibold whitespace-nowrap">
                {currentStage?.progress}% Complete
              </div>
            }
          >
            <p className="text-sm font-medium text-slate-500">
              Current Status
            </p>

            <h2 className={`mt-3 ${SECTION_TITLE_CLASS}`}>
              {currentStage?.label}
            </h2>

            <p className="mt-4 text-slate-600 max-w-2xl">
              Your property transaction is currently progressing through this stage of the chain process.
            </p>
          </MobilePanelHeader>

{/* Progress Bar */}
<div className="mt-10">

  <div className="w-full h-5 bg-slate-200 rounded-full overflow-hidden">

    <div
      className="h-full bg-green-500 rounded-full"
      style={{
        width: `${currentStage?.progress || 0}%`,
      }}
    ></div>

  </div>

</div>
{/* Completed Milestones */}
<div className="mt-10">

  <p className="text-sm font-medium text-slate-500">
    Completed Milestones
  </p>

  <div className="mt-5 grid gap-4">

  {completedStages.length === 0 && (

    <div
      className="
        bg-surface-inset rounded-2xl
        px-5 py-5
        text-slate-500
      "
    >

      Milestones completed during your move will appear here as your transaction progresses.

    </div>

  )}

{completedStages.map((stage) => (

      <div
        key={stage.value}
        className="
          flex items-center gap-4
          bg-surface-inset rounded-2xl
          px-5 py-4
        "
      >

        <div
          className="
            w-8 h-8 rounded-full
            bg-green-100
            flex items-center justify-center
            text-green-700 font-bold
          "
        >

          ✓

        </div>

        <p className="font-medium text-slate-900">
          {stage.label}
        </p>

      </div>

    ))}

  </div>

</div>
{!isCompletionLifecycleFrozen && (
<>
{/* Estimated Completion */}
<div className="mt-10 bg-blue-50 border border-blue-200 rounded-3xl p-6">

  <p className="text-sm font-medium text-blue-700">
    Estimated Completion Window
  </p>

  <h3 className="mt-3 text-3xl font-bold text-slate-900">
    {estimatedCompletion}
  </h3>

  <p className="mt-3 text-slate-600">
    Estimated timelines are based on current transaction stage, reported delays and recent chain activity.
  </p>

</div>
{/* Operational Info */}
<div className="grid md:grid-cols-2 gap-8 mt-10">

  <div className="bg-surface-inset rounded-2xl p-6">

    <p className="text-sm text-slate-500">
      Expected Next Step
    </p>

    <p className="mt-3 text-2xl font-bold text-slate-900">
    "Continue progressing buyer readiness"
    </p>

    <p className="mt-3 text-slate-600">
      This is typically the next operational milestone in the property transaction.
    </p>

  </div>

  <div className="bg-surface-inset rounded-2xl p-6">

    <p className="text-sm text-slate-500">
      Typical Timeframe
    </p>

    <p className="mt-3 text-2xl font-bold text-slate-900">
    "Varies by transaction progress"
    </p>

    <p className="mt-3 text-slate-600">
      Timeframes vary depending on chain complexity and third-party response times.
    </p>

  </div>

</div>
</>
)}

</div>


{/* Action Required */}
{!isCompletedCompletionMode && (
<div className={`mt-8 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}>

  <MobilePanelHeader
    aside={
      <div
        className={`${actionColour} px-5 py-3 rounded-2xl text-sm font-semibold whitespace-nowrap`}
      >
        Operational Alert
      </div>
    }
  >
    <p className="text-sm font-medium text-slate-500">
      Action Required
    </p>

    <h2 className={`mt-3 ${SECTION_TITLE_CLASS}`}>
      {actionTitle}
    </h2>

    <p className="mt-4 text-slate-600 max-w-2xl">
      {actionMessage}
    </p>
  </MobilePanelHeader>

</div>
)}

{canEdit && !isCompletedCompletionMode && (

<div className="mt-8 bg-blue-50 border border-blue-200 rounded-3xl p-6">

  <p className="text-blue-800 font-semibold">
    {getOperationalBuyerReadyHeadline()}
  </p>

  <p className="mt-2 text-blue-700">
    {OPERATIONAL_BUYER_READY_BANNER_MESSAGE}
  </p>

</div>

)}

{!canEdit && (

<div className="mt-8 bg-amber-50 border border-amber-200 rounded-3xl p-6">

  <p className="text-amber-700 font-semibold">
    {CONNECTED_POSITION_MESSAGE}
  </p>

</div>

)}

{showOperationalCompletionPanel && (
  <OperationalCompletionDatePanel
    chainScheduledDate={
      currentChain?.completionScheduledDate
    }
    chainLifecycleStatus={
      currentChain?.completionLifecycleStatus
    }
    completionConfirmedAt={
      currentChain?.completionConfirmedAt
    }
    showEntryForm={
      showOperationalCompletionEntry
    }
    showChangeButton={
      showAmendCompletionDate
    }
    showConfirmButton={
      showConfirmCompletion
    }
    onSubmit={handleRecordCompletionDate}
    onChangeDate={handleAmendCompletionDate}
    onConfirmCompletion={
      handleConfirmCompletion
    }
  />
)}

        {!isCompletedCompletionMode && (
        <>
        {/* Update Status */}
        <div className={`mt-8 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}>

          <h2 className={SECTION_TITLE_CLASS}>
            Update Status
          </h2>

          <select
          disabled={!canEdit}
          value={draftStage}
          onChange={(event) =>
            setDraftStage(event.target.value)
          }
            className="mt-6 w-full border border-slate-300 text-slate-900 rounded-xl px-4 py-4 text-lg"
          >
<option value="">
  Select next stage
</option>
{BUYER_READY_STAGES.map((stage) => (

              <option
                key={stage.value}
                value={stage.value}
              >
                {stage.label}
              </option>

            ))}

          </select>
          <button
  disabled={!canEdit}
  onClick={updateBuyerStage}
  className={`mt-4 ${BTN_PRIMARY_CLASS} rounded-xl px-6 py-3 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed`}
>
  Submit Status Update
</button>
        </div>

        {/* Structured Updates */}
        <div className={`mt-8 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}>

          <h2 className={SECTION_TITLE_CLASS}>
            Add Update
          </h2>

          <p className="text-slate-500 mt-2">
            Share operational updates with
            the chain.
          </p>

          <select
          disabled={!canEdit}
            value={updateType}
            onChange={(event) =>
              setUpdateType(event.target.value)
            }
            className="mt-6 w-full border border-slate-300 text-slate-900 rounded-xl px-4 py-4"
          >

            <option value="">
              Select update type
            </option>

            <option value="delay">
              Delay
            </option>

            <option value="documents">
              Awaiting Documents
            </option>

            <option value="survey">
              Survey Update
            </option>

            <option value="mortgage">
              Mortgage Update
            </option>

            <option value="milestone">
              Milestone Reached
            </option>

          </select>

          {updateType === "delay" && (

            <select
              disabled={!canEdit}
              value={delayReason}
              onChange={(event) =>
                setDelayReason(
                  event.target.value
                )
              }
              className="mt-4 w-full border border-slate-300 text-slate-900 rounded-xl px-4 py-4"
            >

              <option value="">
                Select delay reason
              </option>

              <option value="Awaiting Searches">
                Awaiting Searches
              </option>

              <option value="Awaiting Mortgage Offer">
                Awaiting Mortgage Offer
              </option>

              <option value="Awaiting Signed Documents">
                Awaiting Signed Documents
              </option>

              <option value="Awaiting Survey Results">
                Awaiting Survey Results
              </option>

              <option value="Awaiting Management Pack">
                Awaiting Management Pack
              </option>

            </select>

          )}

<button
  disabled={!canEdit}
  onClick={handleStructuredUpdate}
  className={`mt-6 ${BTN_PRIMARY_CLASS} px-6 py-4 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed`}
>
  Add Update
</button>

        </div>
        </>
        )}

        {/* Activity Timeline */}
        <div className={`mt-8 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}>

          <h2 className={SECTION_TITLE_CLASS}>
            Activity Timeline
          </h2>

          <div className="mt-6">

  {timelineActivities.map(
    (activity, index) => (

    <div
      key={`${activity.id}-${index}`}
      className="relative pl-10 pb-10"
    >

      {/* Vertical Line */}
      {index !==
        timelineActivities.length - 1 && (

        <div
          className="
            absolute
            left-[7px]
            top-4
            w-[2px]
            h-full
            bg-slate-200
          "
        ></div>

      )}

      {/* Timeline Dot */}
      <div
        className="
          absolute
          left-0
          top-1
          w-4
          h-4
          rounded-full
          bg-blue-500
        "
      ></div>

      {/* Content */}
      <div>

        <p className="text-xl font-semibold text-slate-900">
          {activity.update}
        </p>

        <div className="mt-3">

          <span
            className={`
              inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold

              ${
                activity.updated_by === "estate_agent"
                  ? "bg-purple-100 text-purple-700"

                : activity.updated_by === "solicitor"
                  ? "bg-emerald-100 text-emerald-700"

                : activity.updated_by === "system"
                  ? "bg-slate-200 text-slate-700"

                : "bg-blue-100 text-blue-700"
              }
            `}
          >

            {
              activity.updated_by === "estate_agent"
                ? "Estate Agent"

              : activity.updated_by === "solicitor"
                ? "Solicitor"

              : activity.updated_by === "system"
                ? "System"

              : "Homeowner"
            }

          </span>

        </div>

        <p className="text-sm text-slate-400 mt-3">
          {formatTimeAgo(activity.timestamp)}
        </p>

      </div>

    </div>

  ))}

</div>

        </div>

      </div>

    </main>
  );
}