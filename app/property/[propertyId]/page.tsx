"use client";

import { useParams } from "next/navigation";
import {
  useState,
  useEffect,
} from "react";
import Link from "next/link";
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
import Navbar from "@/components/Navbar";
import OperationalContextStrip from "@/components/operational/OperationalContextStrip";
import OperationalManagerBanner from "@/components/operational/OperationalManagerBanner";
import WorkflowReadOnlyBanner from "@/components/WorkflowReadOnlyBanner";
import { useOperationalWorkspaceLabels } from "@/hooks/useOperationalWorkspaceLabels";
import { useChain } from "@/context/ChainContext";
import { STAGES } from "@/data/stages";
import { ROUTES } from "@/lib/auth/routes";
import { isEstateAgent } from "@/lib/accountType";
import {
  resolveWorkflowAccess,
} from "@/lib/propertyPermissions";
import {
  getOperationalEditingModeLabelForViewer,
  getOperationalUpdateSuccessMessage,
  getOperationalWorkspaceSubtitle,
  getOperationalWorkspaceTitle,
} from "@/lib/operationalPresentation";
import {
  applyOperationalSubjectLens,
  pickEstateAgentAssignmentInChain,
  resolveOperationalSubject,
  resolveSubjectOperationalPosition,
} from "@/lib/operationalSubject";
import {
  getActionAlertBadgeLabel,
  getNextMilestoneHint,
  getShareUpdatesIntro,
} from "@/lib/customerFacingLabels";
import { getEstateAgentManagementModeForOperationalAssignment } from "@/lib/estateAgent/managementModePresentation";
import { computeScopeEstimatedCompletionWindow } from "@/lib/chainIntelligence/scopeEstimate";
import { resolvePropertyStageClock } from "@/lib/chainIntelligence/stageClock";
import { EstimatedCompletionWindowPanel } from "@/components/chainIntelligence/EstimatedCompletionWindowPanel";
import OperationalCompletionDatePanel from "@/components/OperationalCompletionDatePanel";
import PropertyEstateAgentAssignment from "@/components/estate-agents/PropertyEstateAgentAssignment";
import ParticipationDelinkPanel from "@/components/participation/ParticipationDelinkPanel";
import PropertyLifecycleDormancySection from "@/components/lifecycle/PropertyLifecycleDormancySection";
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
import type { CompletionAmendmentReasonCode } from "@/lib/completionLifecycle";
import {
  isChainInCompletedCompletionMode,
  isChainInScheduledCompletionMode,
} from "@/lib/completionLifecycle";
import {
  daysSinceLastActivity,
  getLatestDelayReport,
  hasActiveDelayReport,
  STALE_DAYS_PAGE_ALERT,
} from "@/lib/activityIntelligence";
export default function PropertyPage() {

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
    const [breakReason, setBreakReason] =
    useState("");
  const params = useParams();
  const propertyId = Number(
    Array.isArray(params.propertyId)
      ? params.propertyId[0]
      : params.propertyId
      
  );

  const {
    properties,
    chainNodes,
    chains,
    updatePropertyStage,
    addStructuredUpdate,
    breakChainConnection,
    currentUserId,
    accountType,
    refreshParticipantData,
    estateAgentOperationalAssignments,
    recordChainCompletionDate,
    amendChainCompletionDate,
    confirmChainCompletion,
  } = useChain();

  const currentProperty = properties.find(
    (property) => property.id === propertyId
  );

  const chainPropertiesForCompletion =
    mapToOperationalProperties(
      properties.filter(
        (property) =>
          currentProperty != null &&
          property.chainId === currentProperty.chainId
      )
    );

  const operationalSubject =
    currentProperty && currentUserId
      ? resolveOperationalSubject({
          viewerUserId: currentUserId,
          accountType,
          chainId: currentProperty.chainId,
          chainProperties: chainPropertiesForCompletion,
          estateAgentAssignments:
            estateAgentOperationalAssignments,
        })
      : null;

  const workspaceLabels = useOperationalWorkspaceLabels({
    assignedPropertyId:
      operationalSubject?.assignedPropertyId ?? null,
    subjectUserId:
      operationalSubject?.subjectUserId ?? null,
    accountType,
    currentUserId,
  });

  useEffect(() => {

    if (currentProperty) {
  
      setDraftStage(
        currentProperty.stage
      );
  
    }
  
  }, [currentProperty]);
  

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

  if (!currentProperty) {
    return (
      <div className="p-10 text-2xl">
        Property not found
      </div>
    );
  }

  const access = resolveWorkflowAccess(
    {
      kind: "property",
      chainId: currentProperty.chainId,
      propertyId: currentProperty.id,
    },
    {
      userId: currentUserId,
      chainProperties: chainPropertiesForCompletion,
      chainNodes,
      accountType,
      estateAgentAssignments:
        estateAgentOperationalAssignments,
    }
  );

  const mutationContext = {
    accountType,
    estateAgentAssignments:
      estateAgentOperationalAssignments,
  };

  const canEdit = access.canEdit;

  const subjectChainProperties =
    applyOperationalSubjectLens(
      chainPropertiesForCompletion,
      operationalSubject
    );

  const operationalDisplayPosition =
    resolveSubjectOperationalPosition({
      subject: operationalSubject,
      chainId: currentProperty.chainId,
      chainProperties: chainPropertiesForCompletion,
      chainNodes,
    }).position;

  const isOperationalDisplay =
    operationalDisplayPosition?.kind === "sale" &&
    operationalDisplayPosition.propertyId ===
      currentProperty.id;


  const homeHref = isEstateAgent({
    account_type: accountType ?? "homeowner",
  })
    ? ROUTES.agentHome
    : ROUTES.homeownerDashboard;

  const homeLabel = isEstateAgent({
    account_type: accountType ?? "homeowner",
  })
    ? "Agent Home"
    : "Dashboard";

  const currentChain = chains.find(
    (chain) =>
      chain.id === currentProperty.chainId
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

  const showOperationalCompletionEntry =
    access.canEdit &&
    canShowOperationalCompletionDateEntry({
      chainScheduledDate:
        currentChain?.completionScheduledDate,
      userId: currentUserId,
      chainId: currentProperty.chainId,
      chainProperties:
        chainPropertiesForCompletion,
      chainNodes: chainNodes,
      mutationContext,
    });

  const showOperationalCompletionPanel =
    isCompletedCompletionMode ||
    !!currentChain?.completionScheduledDate ||
    showOperationalCompletionEntry;

  const propertyChainId = currentProperty.chainId;

  const showAmendCompletionDate =
    access.canEdit &&
    canAmendChainCompletionDate({
      chainScheduledDate:
        currentChain?.completionScheduledDate,
      chainLifecycleStatus:
        currentChain?.completionLifecycleStatus,
      userId: currentUserId,
      chainId: propertyChainId,
      chainProperties:
        chainPropertiesForCompletion,
      chainNodes: chainNodes,
      mutationContext,
    });

  const showConfirmCompletion =
    access.canEdit &&
    canConfirmChainCompletion({
      completionLifecycleStatus:
        currentChain?.completionLifecycleStatus,
      completionScheduledDate:
        currentChain?.completionScheduledDate,
      userId: currentUserId,
      chainId: propertyChainId,
      chainProperties:
        chainPropertiesForCompletion,
      chainNodes: chainNodes,
      mutationContext,
    });

  async function handleRecordCompletionDate(
    scheduledDate: string
  ) {
    const result = await recordChainCompletionDate(
      propertyChainId,
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
      propertyChainId,
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
      propertyChainId
    );

    return {
      ok: result.ok,
      message: result.ok
        ? undefined
        : result.message,
    };
  }

  const currentStage =
  STAGES.find(
    (stage) =>
      stage.value === currentProperty.stage
  );

const latestDelay =
  getLatestDelayReport(
    currentProperty.activities
  );
const activeDelayReport =
  hasActiveDelayReport(
    currentProperty.activities
  );
const propertyLastUpdatedDays =
  daysSinceLastActivity(
    currentProperty.activities
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
  propertyLastUpdatedDays > STALE_DAYS_PAGE_ALERT
) {

  actionTitle =
    "Update Recommended";

  actionMessage =
    `No updates have been added for ${propertyLastUpdatedDays} days. Consider checking progress with your estate agent or conveyancer.`;

  actionColour =
    "bg-red-100 text-red-700";
}

const currentStageIndex =
  STAGES.findIndex(
    (stage) =>
      stage.value === currentProperty.stage
  );

const completedStages =
  STAGES.slice(
    0,
    currentStageIndex
  );
 

const propertyClock = resolvePropertyStageClock({
  stage: currentProperty.stage,
  persistedStageEnteredAt:
    (currentProperty as { stage_entered_at?: string | null })
      .stage_entered_at ?? null,
  activities: currentProperty.activities,
});

const estimatedCompletion = computeScopeEstimatedCompletionWindow({
  propertyStage: currentProperty.stage,
  propertyStageEnteredAt: propertyClock.stageEnteredAt,
  propertyClockQuality: propertyClock.clockQuality,
  propertyOperationalState: activeDelayReport
    ? "explicit_delay"
    : currentProperty.status === "blocked"
      ? "blocked"
      : currentProperty.status === "broken_connection"
        ? "broken_connection"
        : currentProperty.status === "pending_connection"
          ? "pending_connection"
          : "normal",
});
async function handleStructuredUpdate() {
      if (!updateType) {
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
    
      if (!currentProperty) {
        return;
      }
      const latestActivity =
  currentProperty.activities?.[0];

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
        currentProperty.id,
        updateMessage
      );
      setSuccessMessage(
        getOperationalUpdateSuccessMessage(
          accountType,
          "structured_update"
        )
      );
      
      setTimeout(() => {
      
        setSuccessMessage("");
      
      }, 4000);
      setUpdateType("");
      setDelayReason("");
    }
    async function handlePropertyStageUpdate() {

      if (!currentProperty) {
        return;
      }
    
      if (
        currentProperty.stage === draftStage
      ) {
    
        setWarningMessage(
          "This status has already been recorded."
        );
    
        setTimeout(() => {
    
          setWarningMessage("");
    
        }, 4000);
    
        return;
    
      }

      if (
        draftStage === "searching" &&
        (currentProperty.address ||
          currentProperty.postcode)
      ) {
        setWarningMessage(
          "An agreed purchase cannot be changed back to searching."
        );

        setTimeout(() => {
          setWarningMessage("");
        }, 4000);

        return;
      }
    
      await updatePropertyStage(
        currentProperty.id,
        draftStage
      );
    
      setSuccessMessage(
        getOperationalUpdateSuccessMessage(
          accountType,
          "property_stage"
        )
      );
    
      setTimeout(() => {
    
        setSuccessMessage("");
    
      }, 4000);
    
    }
  const workspaceTitle = getOperationalWorkspaceTitle({
    surface: "property",
    isOperationalDisplay,
    viewerRole: access.viewerRole,
  });

  const workspaceSubtitle = getOperationalWorkspaceSubtitle({
    surface: "property",
    isOperationalDisplay,
    viewerRole: access.viewerRole,
    canEdit,
  });

  const editingModeLabel =
    getOperationalEditingModeLabelForViewer({
      viewerRole: access.viewerRole,
      mode: access.mode,
    });

  const chainAssignment =
    access.viewerRole === "estate_agent"
      ? pickEstateAgentAssignmentInChain(
          estateAgentOperationalAssignments,
          currentProperty.chainId,
          chainPropertiesForCompletion
        )
      : null;

  const managementMode =
    getEstateAgentManagementModeForOperationalAssignment(
      chainAssignment
    );

  const showOperationalManager =
    access.viewerRole === "estate_agent" && canEdit;

  const showOperationalContextStrip =
    isOperationalDisplay ||
    access.viewerRole === "estate_agent";

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
              href: `/chain/${currentProperty.chainId}`,
              label: "← Back to Chain",
            },
            {
              href: homeHref,
              label: homeLabel,
            },
          ]}
        />

        <div
          className={`bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}
        >

<h1 className={PAGE_TITLE_CLASS}>

  {workspaceTitle}

</h1>

<p className="text-slate-600 mt-2 text-base">

  {workspaceSubtitle}

</p>

{showOperationalContextStrip && (
  <OperationalContextStrip
    labels={workspaceLabels}
    editingMode={editingModeLabel}
    showManager={
      access.viewerRole === "estate_agent"
    }
    managementMode={managementMode}
    viewerRole={access.viewerRole}
  />
)}

</div>

        {showOperationalManager && (
          <OperationalManagerBanner
            viewerRole={access.viewerRole}
          />
        )}

        {access.canView &&
          !access.canEdit &&
          access.bannerMessage && (
          <WorkflowReadOnlyBanner
            message={access.bannerMessage}
          />
        )}

        <PropertyLifecycleDormancySection
          propertyId={propertyId}
          currentUserId={currentUserId}
          onConfirmed={refreshParticipantData}
          onSuccessMessage={setSuccessMessage}
        />

        {!isCompletedCompletionMode && (
          <div
            className={`mt-8 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}
          >
            <MobilePanelHeader
              aside={
                <div
                  className={`${actionColour} px-5 py-3 rounded-2xl text-sm font-semibold whitespace-nowrap`}
                >
                  {getActionAlertBadgeLabel(access.viewerRole)}
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
  <EstimatedCompletionWindowPanel
    rawWindow={estimatedCompletion}
    title="Estimated Completion Window"
    titleClassName="text-blue-700"
  />
</div>
{/* Operational Info */}
<div className="grid md:grid-cols-2 gap-8 mt-10">

  <div className="bg-surface-inset rounded-2xl p-6">

    <p className="text-sm text-slate-500">
      Expected Next Step
    </p>

    <p className="mt-3 text-2xl font-bold text-slate-900">
      {currentStage?.nextStep}
    </p>

    <p className="mt-3 text-slate-600">
      {getNextMilestoneHint(access.viewerRole)}
    </p>

  </div>

  <div className="bg-surface-inset rounded-2xl p-6">

    <p className="text-sm text-slate-500">
      Typical Timeframe
    </p>

    <p className="mt-3 text-2xl font-bold text-slate-900">
      {currentStage?.expectedTimeframe}
    </p>

    <p className="mt-3 text-slate-600">
      Timeframes vary depending on chain complexity and third-party response times.
    </p>

  </div>

</div>
</>
)}

</div>

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

        {access.canEdit && !isCompletedCompletionMode && (
        <>
        {/* Update Status */}
        <div className={`mt-10 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}>

          <h2 className="text-3xl font-bold text-slate-900">
            Update Status
          </h2>

          <select
          value={draftStage}
          onChange={(event) =>
            setDraftStage(event.target.value)
          }
            className="mt-6 w-full border border-slate-300 text-slate-900 rounded-xl px-4 py-4 text-lg"
          >

            {STAGES.filter(
              (stage) =>
                !(
                  stage.value ===
                    "searching" &&
                  currentProperty.address
                )
            ).map((stage) => (

              <option
                key={stage.value}
                value={stage.value}
              >
                {stage.label}
              </option>

            ))}

          </select>
          <button
  onClick={handlePropertyStageUpdate}
  className={`mt-4 ${BTN_PRIMARY_CLASS} rounded-xl px-6 py-3`}
>
  Submit Status Update
</button>
        </div>

        {/* Structured Updates */}
        <div className={`mt-10 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}>

          <h2 className="text-3xl font-bold text-slate-900">
            Add Update
          </h2>

          <p className="text-slate-500 mt-2">
            {getShareUpdatesIntro(access.viewerRole)}
          </p>

          <select
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
  onClick={handleStructuredUpdate}
            className={`mt-6 ${BTN_PRIMARY_CLASS} px-6 py-4`}
          >
            Add Update
          </button>

        </div>
{/* Disconnect from chain */}
<div className={`mt-8 bg-white rounded-3xl shadow-sm border border-red-200 ${CARD_PADDING_CLASS}`}>

  <h2 className="text-3xl font-bold text-slate-900">
    Disconnect from chain
  </h2>

  <p className="mt-4 text-slate-600 max-w-2xl">
    Use this only after discussions with estate agents or solicitors. Disconnecting affects the Keynetic connection between properties, not your real-world property transaction. It may impact confidence scoring and overall chain progression.
  </p>

  <select
    value={breakReason}
    onChange={(event) =>
      setBreakReason(
        event.target.value
      )
    }
    className="mt-6 w-full border border-slate-300 text-slate-900 rounded-2xl px-4 py-4"
  >

    <option value="">
      Select disconnect reason
    </option>

    <option value="buyer_side">
  My buyer’s transaction ended
</option>

<option value="seller_side">
  My purchase transaction ended
</option>

  </select>

  <button
    onClick={() => {

      if (!breakReason || !canEdit) {
        return;
      }

      breakChainConnection(
        currentProperty.id,
        breakReason
      );
    }}
    className="mt-6 bg-red-600 hover:bg-red-700 text-white px-6 py-4 rounded-2xl font-semibold transition"
  >

    Disconnect from chain

  </button>

</div>
        </>
        )}

        {canEdit && (
          <div className="mt-8">
            <PropertyEstateAgentAssignment
              propertyId={currentProperty.id}
            />
          </div>
        )}

        <div className="mt-8">
          <ParticipationDelinkPanel
            propertyId={currentProperty.id}
            accountType={accountType}
            onCompleted={async () => {
              await refreshParticipantData();
            }}
          />
        </div>

        {/* Activity Timeline */}
        <div className={`mt-8 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}>

          <h2 className="text-3xl font-bold text-slate-900">
            Activity Timeline
          </h2>

          <div className="mt-6">

  {currentProperty.activities.map((activity, index) => (

    <div
      key={activity.id}
      className="relative pl-10 pb-10"
    >

      {/* Vertical Line */}
      {index !==
        currentProperty.activities.length - 1 && (

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