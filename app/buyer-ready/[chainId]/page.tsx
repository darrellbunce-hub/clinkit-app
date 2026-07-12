"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Navbar from "@/components/Navbar";
import OperationalContextStrip from "@/components/operational/OperationalContextStrip";
import OperationalManagerBanner from "@/components/operational/OperationalManagerBanner";
import WorkflowReadOnlyBanner from "@/components/WorkflowReadOnlyBanner";
import { useOperationalWorkspaceLabels } from "@/hooks/useOperationalWorkspaceLabels";
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
import { BUYER_READY_STAGES } from "@/data/buyerReadyStages";
import { supabase } from "@/lib/supabase";
import {
  findBuyerReadyNodeForChain,
  formatActivityUpdaterLabel,
  getBuyerReadyActionMessage,
  getBuyerReadyStatusDescription,
  resolveWorkflowAccess,
} from "@/lib/propertyPermissions";
import { mapToOperationalProperties } from "@/lib/operationalPosition";
import {
  getOperationalEditingModeLabelForViewer,
  getOperationalUpdateSuccessMessage,
  getOperationalWorkspaceSubtitle,
  getOperationalWorkspaceTitle,
} from "@/lib/operationalPresentation";
import {
  resolveOperationalSubject,
  pickEstateAgentAssignmentInChain,
  resolveSubjectOperationalPosition,
} from "@/lib/operationalSubject";
import { getEstateAgentManagementModeForOperationalAssignment } from "@/lib/estateAgent/managementModePresentation";
import { ROUTES } from "@/lib/auth/routes";
import { isEstateAgent } from "@/lib/accountType";
import {
  validateBuyerReadyStageTransition,
  COMPLETION_DATE_AGREED_REQUIRES_CONTRACTS_EXCHANGED_MESSAGE,
  isChainInCompletedCompletionMode,
  isChainInScheduledCompletionMode,
} from "@/lib/completionLifecycle";
import OperationalCompletionDatePanel from "@/components/OperationalCompletionDatePanel";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import {
  BTN_PRIMARY_CLASS,
  PAGE_BG_CLASS,
} from "@/lib/theme/themeTokens";
import { canShowOperationalCompletionDateEntry } from "@/lib/recordChainCompletionDate";
import { canAmendChainCompletionDate } from "@/lib/amendChainCompletionDate";
import { canConfirmChainCompletion } from "@/lib/confirmChainCompletion";
import {
  daysSinceLastActivity,
  getLatestDelayReport,
  hasActiveDelayReport,
  type OperationalActivity,
} from "@/lib/activityIntelligence";
import type { CompletionAmendmentReasonCode } from "@/lib/completionLifecycle";

type BuyerReadyActivity = {
  id: number;
  timestamp: string;
  update: string;
  updated_by?: string | null;
};

type BuyerReadyChainNode = {
  id: number;
  chain_id: number;
  linked_property_id?: number | null;
  stage?: string;
  status?: string;
  progress?: number;
  activities?: BuyerReadyActivity[];
};

function formatTimeAgo(timestamp: string) {
  const now = new Date();
  const activityTime = new Date(timestamp);
  const diffMs = now.getTime() - activityTime.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

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

function activityUpdaterBadgeClass(
  updatedBy: string | null | undefined
) {
  switch (updatedBy) {
    case "estate_agent":
      return "bg-purple-100 text-purple-700";
    case "solicitor":
    case "conveyancer":
      return "bg-emerald-100 text-emerald-700";
    case "system":
      return "bg-slate-200 text-slate-700";
    default:
      return "bg-blue-100 text-blue-700";
  }
}

export default function BuyerReadyPage() {
  const [updateType, setUpdateType] = useState("");
  const [delayReason, setDelayReason] = useState("");
  const [draftStage, setDraftStage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [warningMessage, setWarningMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const params = useParams();
  const chainId = Number(params.chainId);

  const {
    properties,
    chainNodes,
    chains,
    addStructuredUpdate,
    currentUserId,
    accountType,
    estateAgentOperationalAssignments,
    authLoading,
    refreshParticipantData,
    recordChainCompletionDate,
    amendChainCompletionDate,
    confirmChainCompletion,
  } = useChain();

  const buyerNode = findBuyerReadyNodeForChain(
    chainId,
    chainNodes
  ) as BuyerReadyChainNode | undefined;

  const chainPropertiesForAccess =
    mapToOperationalProperties(
      properties.filter(
        (property) =>
          Number(property.chainId) === Number(chainId)
      )
    );

  const mutationContext = {
    accountType,
    estateAgentAssignments:
      estateAgentOperationalAssignments,
  };

  const operationalSubject =
    buyerNode && currentUserId
      ? resolveOperationalSubject({
          viewerUserId: currentUserId,
          accountType,
          chainId,
          chainProperties: chainPropertiesForAccess,
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

  const access = buyerNode
    ? resolveWorkflowAccess(
        {
          kind: "buyer_ready",
          chainId,
          nodeId: buyerNode.id,
        },
        {
          userId: currentUserId,
          chainProperties: chainPropertiesForAccess,
          chainNodes,
          accountType,
          estateAgentAssignments:
            estateAgentOperationalAssignments,
        }
      )
    : {
        canView: false,
        canEdit: false,
        mode: "denied" as const,
        viewerRole: "none" as const,
        bannerMessage: null,
      };

  if (authLoading) {
    return (
      <div className="p-10 text-2xl">
        Loading workflow…
      </div>
    );
  }

  if (!buyerNode || !access.canView) {
    return (
      <div className="p-10 text-2xl">
        Buyer Ready workflow not found
      </div>
    );
  }

  const workflowNode = buyerNode;

  const operationalDisplayPosition =
    resolveSubjectOperationalPosition({
      subject: operationalSubject,
      chainId,
      chainProperties: chainPropertiesForAccess,
      chainNodes,
    }).position;

  const isOperationalDisplay =
    operationalDisplayPosition?.kind === "buyer_ready" &&
    operationalDisplayPosition.nodeId === workflowNode.id;

  const workspaceTitle = getOperationalWorkspaceTitle({
    surface: "buyer_ready",
    isOperationalDisplay,
    viewerRole: access.viewerRole,
  });

  const workspaceSubtitle = getOperationalWorkspaceSubtitle({
    surface: "buyer_ready",
    isOperationalDisplay,
    viewerRole: access.viewerRole,
    canEdit: access.canEdit,
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
          chainId,
          chainPropertiesForAccess
        )
      : null;

  const managementMode =
    getEstateAgentManagementModeForOperationalAssignment(
      chainAssignment
    );

  const showOperationalManager =
    access.viewerRole === "estate_agent" && access.canEdit;

  const showOperationalContextStrip =
    isOperationalDisplay ||
    access.viewerRole === "estate_agent";

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

  const showOperationalCompletionEntry =
    access.canEdit &&
    canShowOperationalCompletionDateEntry({
      chainScheduledDate:
        currentChain?.completionScheduledDate,
      userId: currentUserId,
      chainId,
      chainProperties: chainPropertiesForAccess,
      chainNodes,
      mutationContext,
    });

  const showOperationalCompletionPanel =
    isCompletedCompletionMode ||
    !!currentChain?.completionScheduledDate ||
    showOperationalCompletionEntry;

  const showAmendCompletionDate =
    access.canEdit &&
    canAmendChainCompletionDate({
      chainScheduledDate:
        currentChain?.completionScheduledDate,
      chainLifecycleStatus:
        currentChain?.completionLifecycleStatus,
      userId: currentUserId,
      chainId,
      chainProperties: chainPropertiesForAccess,
      chainNodes,
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
      chainId,
      chainProperties: chainPropertiesForAccess,
      chainNodes,
      mutationContext,
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
      message: result.ok ? undefined : result.message,
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
      message: result.ok ? undefined : result.message,
    };
  }

  async function handleConfirmCompletion() {
    const result = await confirmChainCompletion(chainId);

    return {
      ok: result.ok,
      message: result.ok ? undefined : result.message,
    };
  }

  const linkedProperty = properties.find(
    (property) =>
      property.id === workflowNode.linked_property_id
  );

  const timelineActivities = [
    ...(workflowNode.activities || []),
    ...(linkedProperty?.activities || []),
  ].sort(
    (a, b) =>
      new Date(b.timestamp).getTime() -
      new Date(a.timestamp).getTime()
  );

  const currentStage = BUYER_READY_STAGES.find(
    (stage) => stage.value === workflowNode.stage
  );

  async function updateBuyerStage() {
    if (isSaving || !access.canEdit) {
      return;
    }

    setIsSaving(true);

    const selectedStage = BUYER_READY_STAGES.find(
      (stage) => stage.value === draftStage
    );

    if (!selectedStage) {
      setIsSaving(false);
      return;
    }

    if (workflowNode.stage === selectedStage.value) {
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
        workflowNode.stage ?? "",
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

    const { error } = await supabase
      .from("chain_nodes")
      .update({
        stage: selectedStage.value,
        progress: selectedStage.progress,
        status:
          selectedStage.progress >= 95
            ? "healthy"
            : "pending_connection",
      })
      .eq("id", workflowNode.id);

    if (!error) {
      await addStructuredUpdate(
        workflowNode.id,
        selectedStage.label,
        "buyer_ready"
      );

      await refreshParticipantData();

      setDraftStage("");
      setSuccessMessage(
        getOperationalUpdateSuccessMessage(
          accountType,
          "buyer_ready_stage"
        )
      );

      setTimeout(() => {
        setSuccessMessage("");
      }, 4000);
    } else {
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

  const nodeActivities: OperationalActivity[] = (
    workflowNode.activities ?? []
  ).map((activity) => ({
    id: activity.id,
    timestamp: activity.timestamp,
    update: activity.update,
    updated_by: activity.updated_by ?? undefined,
  }));

  const latestDelay = getLatestDelayReport(nodeActivities);
  const activeDelayReport = hasActiveDelayReport(nodeActivities);
  const buyerLastUpdatedDays =
    daysSinceLastActivity(nodeActivities);

  const actionPanel = getBuyerReadyActionMessage({
    access,
    activeDelayReport,
    latestDelayUpdate: latestDelay?.update ?? null,
    buyerLastUpdatedDays,
    isCompletionLifecycleFrozen,
  });

  const currentStageIndex = BUYER_READY_STAGES.findIndex(
    (stage) => stage.value === workflowNode.stage
  );

  const completedStages =
    currentStageIndex >= 0
      ? BUYER_READY_STAGES.slice(0, currentStageIndex + 1)
      : [];

  let estimatedCompletion = "16–20 weeks remaining";
  const progress = currentStage?.progress || 0;

  if (progress >= 20) {
    estimatedCompletion = "12–16 weeks remaining";
  }

  if (progress >= 40) {
    estimatedCompletion = "8–12 weeks remaining";
  }

  if (progress >= 60) {
    estimatedCompletion = "4–8 weeks remaining";
  }

  if (progress >= 80) {
    estimatedCompletion = "1–3 weeks remaining";
  }

  if (activeDelayReport) {
    estimatedCompletion = `${estimatedCompletion} (delay detected)`;
  }

  if (
    !isCompletionLifecycleFrozen &&
    buyerLastUpdatedDays > 7
  ) {
    estimatedCompletion = `${estimatedCompletion} (stale activity)`;
  }

  async function handleStructuredUpdate() {
    if (!updateType || !access.canEdit) {
      return;
    }

    let updateMessage = "General Update";

    if (updateType === "delay" && delayReason) {
      updateMessage = `Delay Reported: ${delayReason}`;
    } else if (updateType === "documents") {
      updateMessage = "Awaiting Documents";
    } else if (updateType === "survey") {
      updateMessage = "Survey Update Added";
    } else if (updateType === "mortgage") {
      updateMessage = "Mortgage Update Added";
    } else if (updateType === "milestone") {
      updateMessage = "Milestone Reached";
    }

    const latestActivity = workflowNode.activities?.[0];

    if (latestActivity?.update === updateMessage) {
      setWarningMessage(
        "This update has already been recorded."
      );

      setTimeout(() => {
        setWarningMessage("");
      }, 4000);

      return;
    }

    await addStructuredUpdate(
      workflowNode.id,
      updateMessage,
      "buyer_ready"
    );

    setUpdateType("");
    setDelayReason("");
    setSuccessMessage(
      getOperationalUpdateSuccessMessage(
        accountType,
        "structured_update"
      )
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
              href: `/chain/${workflowNode.chain_id}`,
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
            />
          )}
        </div>

        {showOperationalManager && (
          <OperationalManagerBanner />
        )}

        {access.canView &&
          !access.canEdit &&
          access.bannerMessage && (
          <WorkflowReadOnlyBanner
            message={access.bannerMessage}
          />
        )}

        {!isCompletedCompletionMode && (
          <div
            className={`mt-8 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}
          >
            <MobilePanelHeader
              aside={
                <div
                  className={`${actionPanel.colour} px-5 py-3 rounded-2xl text-sm font-semibold whitespace-nowrap`}
                >
                  Operational Alert
                </div>
              }
            >
              <p className="text-sm font-medium text-slate-500">
                Next Recommended Action
              </p>

              <h2 className={`mt-3 ${SECTION_TITLE_CLASS}`}>
                {actionPanel.title}
              </h2>

              <p className="mt-4 text-slate-600 max-w-2xl">
                {actionPanel.message}
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
                {currentStage?.progress ?? workflowNode.progress ?? 0}%
                Complete
              </div>
            }
          >
            <p className="text-sm font-medium text-slate-500">
              Current Status
            </p>

            <h2 className={`mt-3 ${SECTION_TITLE_CLASS}`}>
              {currentStage?.label ?? "Buyer Ready"}
            </h2>

            <p className="mt-4 text-slate-600 max-w-2xl">
              {getBuyerReadyStatusDescription(access)}
            </p>
          </MobilePanelHeader>

          <div className="mt-10">
            <div className="w-full h-5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{
                  width: `${
                    currentStage?.progress ??
                    workflowNode.progress ??
                    0
                  }%`,
                }}
              />
            </div>
          </div>

          <div className="mt-10">
            <p className="text-sm font-medium text-slate-500">
              Completed Milestones
            </p>

            <div className="mt-5 grid gap-4">
              {completedStages.length === 0 && (
                <div className="bg-surface-inset rounded-2xl px-5 py-5 text-slate-500">
                  Milestones completed during this move will
                  appear here as the transaction progresses.
                </div>
              )}

              {completedStages.map((stage) => (
                <div
                  key={stage.value}
                  className="flex items-center gap-4 bg-surface-inset rounded-2xl px-5 py-4"
                >
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold">
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
              <div className="mt-10 bg-blue-50 border border-blue-200 rounded-3xl p-6">
                <p className="text-sm font-medium text-blue-700">
                  Estimated Completion Window
                </p>

                <h3 className="mt-3 text-3xl font-bold text-slate-900">
                  {estimatedCompletion}
                </h3>

                <p className="mt-3 text-slate-600">
                  Estimated timelines are based on current
                  transaction stage, reported delays and recent
                  chain activity.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-8 mt-10">
                <div className="bg-surface-inset rounded-2xl p-6">
                  <p className="text-sm text-slate-500">
                    Expected Next Step
                  </p>

                  <p className="mt-3 text-2xl font-bold text-slate-900">
                    {currentStage?.label
                      ? `Continue from ${currentStage.label}`
                      : "Continue progressing buyer readiness"}
                  </p>

                  <p className="mt-3 text-slate-600">
                    This is typically the next operational
                    milestone in the property transaction.
                  </p>
                </div>

                <div className="bg-surface-inset rounded-2xl p-6">
                  <p className="text-sm text-slate-500">
                    Typical Timeframe
                  </p>

                  <p className="mt-3 text-2xl font-bold text-slate-900">
                    Varies by transaction progress
                  </p>

                  <p className="mt-3 text-slate-600">
                    Timeframes vary depending on chain
                    complexity and third-party response times.
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
            showEntryForm={showOperationalCompletionEntry}
            showChangeButton={showAmendCompletionDate}
            showConfirmButton={showConfirmCompletion}
            onSubmit={handleRecordCompletionDate}
            onChangeDate={handleAmendCompletionDate}
            onConfirmCompletion={handleConfirmCompletion}
          />
        )}

        {access.canEdit && !isCompletedCompletionMode && (
          <>
            <div
              className={`mt-10 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}
            >
              <h2 className={SECTION_TITLE_CLASS}>
                Update Status
              </h2>

              <select
                value={draftStage}
                onChange={(event) =>
                  setDraftStage(event.target.value)
                }
                className="mt-6 w-full border border-slate-300 text-slate-900 rounded-xl px-4 py-4 text-lg"
              >
                <option value="">Select next stage</option>

                {BUYER_READY_STAGES.map((stage) => (
                  <option key={stage.value} value={stage.value}>
                    {stage.label}
                  </option>
                ))}
              </select>

              <button
                onClick={updateBuyerStage}
                disabled={isSaving}
                className={`mt-4 ${BTN_PRIMARY_CLASS} rounded-xl px-6 py-3 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed`}
              >
                Submit Status Update
              </button>
            </div>

            <div
              className={`mt-10 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}
            >
              <h2 className={SECTION_TITLE_CLASS}>
                Add Update
              </h2>

              <p className="text-slate-500 mt-2">
                Share operational updates with the chain.
              </p>

              <select
                value={updateType}
                onChange={(event) =>
                  setUpdateType(event.target.value)
                }
                className="mt-6 w-full border border-slate-300 text-slate-900 rounded-xl px-4 py-4"
              >
                <option value="">Select update type</option>
                <option value="delay">Delay</option>
                <option value="documents">Awaiting Documents</option>
                <option value="survey">Survey Update</option>
                <option value="mortgage">Mortgage Update</option>
                <option value="milestone">Milestone Reached</option>
              </select>

              {updateType === "delay" && (
                <select
                  value={delayReason}
                  onChange={(event) =>
                    setDelayReason(event.target.value)
                  }
                  className="mt-4 w-full border border-slate-300 text-slate-900 rounded-xl px-4 py-4"
                >
                  <option value="">Select delay reason</option>
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
          </>
        )}

        <div
          className={`mt-8 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}
        >
          <h2 className={SECTION_TITLE_CLASS}>
            Activity Timeline
          </h2>

          <p className="text-slate-500 mt-2">
            Structured updates and operational events recorded
            for this workflow.
          </p>

          <div className="mt-6">
            {timelineActivities.length === 0 && (
              <div className="bg-surface-inset rounded-2xl px-5 py-5 text-slate-500">
                Operational updates will appear here as this
                workflow progresses.
              </div>
            )}

            {timelineActivities.map((activity, index) => (
              <div
                key={`${activity.id}-${index}`}
                className="relative pl-10 pb-10"
              >
                {index !== timelineActivities.length - 1 && (
                  <div className="absolute left-[7px] top-4 w-[2px] h-full bg-slate-200" />
                )}

                <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-blue-500" />

                <div>
                  <p className="text-xl font-semibold text-slate-900">
                    {activity.update}
                  </p>

                  <div className="mt-3">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${activityUpdaterBadgeClass(activity.updated_by)}`}
                    >
                      {formatActivityUpdaterLabel(
                        activity.updated_by
                      )}
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
