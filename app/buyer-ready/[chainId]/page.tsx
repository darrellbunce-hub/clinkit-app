"use client";

import {
  useParams,
  useRouter,
} from "next/navigation";
import {
  useState,
  useEffect,
} from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useChain } from "@/context/ChainContext";
import {
    BUYER_READY_STAGES
  } from "@/data/buyerReadyStages";
import { supabase } from "@/lib/supabase";
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
  const [isBreaking, setIsBreaking] =
    useState(false);
    const [breakReason, setBreakReason] =
    useState("");
  const params = useParams();
  const router = useRouter();
  const chainId = Number(params.chainId);

  const {
    properties,
        addStructuredUpdate,
    breakChainConnection,
    currentUserId,
  } = useChain();
  console.log(
  "BUYER READY PROPERTIES",
  properties
);

  
  useEffect(() => {
    async function checkAuth() {
  
      const {
        data: { user },
      } = await supabase.auth.getUser();
  
      if (!user) {
  
        router.push("/login");
      }
    }
  
    checkAuth();
  
  }, []);
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
  const canEdit =
  buyerNode.user_id === currentUserId;

  const linkedProperty =
    properties.find(
      (property) =>
        property.id ===
        buyerNode.linked_property_id
    );

  const isConnectionBroken =
    linkedProperty?.status ===
    "broken_connection";

  const canBreakLinkedProperty =
    linkedProperty?.members?.some(
      (member) =>
        member.user_id === currentUserId
    ) ?? false;

  const isBreakDisabled =
    isConnectionBroken ||
    isBreaking ||
    !breakReason;

  const timelineActivities = [
    ...(buyerNode.activities || []),
    ...(linkedProperty?.activities || []),
  ].sort(
    (a, b) =>
      new Date(b.timestamp).getTime() -
      new Date(a.timestamp).getTime()
  );

  async function handleBreakChainConnection() {
    if (
      !breakReason ||
      isConnectionBroken ||
      isBreaking ||
      !buyerNode.linked_property_id
    ) {
      return;
    }

    if (!canBreakLinkedProperty) {
      setWarningMessage(
        "You do not have permission to break this chain connection."
      );

      setTimeout(() => {
        setWarningMessage("");
      }, 4000);

      return;
    }

    setIsBreaking(true);

    try {
      await breakChainConnection(
        buyerNode.linked_property_id,
        breakReason
      );

      setSuccessMessage(
        "Chain connection broken successfully."
      );

      setTimeout(() => {
        setSuccessMessage("");
      }, 4000);
    } finally {
      setIsBreaking(false);
    }
  }

  const currentStage =
  BUYER_READY_STAGES.find(
    (stage) =>
      stage.value === buyerNode?.stage
  );
  async function updateBuyerStage() {
    
      if (isSaving) {
        return;
      }
      
      setIsSaving(true);
    const selectedStage =
      BUYER_READY_STAGES.find(
        (stage) =>
          stage.value === draftStage
      );
    
    if (!selectedStage) {
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
      }
  
  }
  const latestDelay = null;

let actionTitle =
  "No Immediate Actions";

let actionMessage =
  "Your transaction appears to be progressing normally.";

let actionColour =
  "bg-green-100 text-green-700";

if (latestDelay) {

  actionTitle =
    "Delay Reported";

  actionMessage =
    "No active delays reported"

  actionColour =
    "bg-amber-100 text-amber-700";
}

if (
    buyerNode.lastUpdatedDays > 14
) {

  actionTitle =
    "Update Recommended";

  actionMessage =
    `No updates have been added for ${buyerNode.lastUpdatedDays} days. Consider checking progress with your estate agent or conveyancer.`;

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

if (latestDelay) {

  estimatedCompletion =
    `${estimatedCompletion} (delay detected)`;
}

if (
    buyerNode.lastUpdatedDays > 14
) {

  estimatedCompletion =
    `${estimatedCompletion} (stale activity)`;
}
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
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-4xl mx-auto px-6 py-12">

  {successMessage && (

    <div
      className="
        mb-6
        rounded-2xl
        border
        border-green-200
        bg-green-50
        px-5
        py-4
        text-green-700
        font-medium
      "
    >
      ✓ {successMessage}
    </div>

  )}
{warningMessage && (

<div
  className="
    mb-6
    rounded-2xl
    border
    border-amber-200
    bg-amber-50
    px-5
    py-4
    text-amber-700
    font-medium
  "
>
  ⚠ {warningMessage}
</div>

)}
  <div className="flex items-center gap-4 mb-6">

<Link
  href={`/chain/${buyerNode.chain_id}`}
  className="
    inline-flex items-center
    text-slate-600 hover:text-slate-900
  "
>
  ← Back to Chain
</Link>

<Link
  href="/dashboard"
  className="
    inline-flex items-center
    text-slate-600 hover:text-slate-900
  "
>
  Dashboard
</Link>

</div>
        {/* Header */}
<div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

<h1 className="text-5xl font-bold text-slate-900">

Buyer Ready

</h1>

<p className="text-slate-600 mt-3 text-lg">

  Buyer transaction workflow

</p>

</div>

        {/* Current Status */}
<div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

<div className="flex items-start justify-between gap-6">

  <div>

    <p className="text-sm font-medium text-slate-500">
      Current Status
    </p>

    <h2 className="mt-3 text-4xl font-bold text-slate-900">
      {currentStage?.label}
    </h2>

    <p className="mt-4 text-slate-600 max-w-2xl">
      Your property transaction is currently progressing through this stage of the chain process.
    </p>

  </div>

  <div className="bg-green-100 text-green-700 px-5 py-3 rounded-2xl text-lg font-semibold">

    {currentStage?.progress}% Complete

  </div>

</div>

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
        bg-slate-50 rounded-2xl
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
          bg-slate-50 rounded-2xl
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

  <div className="bg-slate-50 rounded-2xl p-6">

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

  <div className="bg-slate-50 rounded-2xl p-6">

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

</div>


{/* Action Required */}
<div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

  <div className="flex items-start justify-between gap-6">

    <div>

      <p className="text-sm font-medium text-slate-500">
        Action Required
      </p>

      <h2 className="mt-3 text-3xl font-bold text-slate-900">
        {actionTitle}
      </h2>

      <p className="mt-4 text-slate-600 max-w-2xl">
        {actionMessage}
      </p>

    </div>

    <div
      className={`
        ${actionColour}
        px-5 py-3 rounded-2xl text-sm font-semibold
      `}
    >

      Operational Alert

    </div>

  </div>

</div>
{!canEdit && (

<div className="mt-8 bg-amber-50 border border-amber-200 rounded-3xl p-6">

  <p className="text-amber-700 font-semibold">
    You can view this property but only the transaction participant can make operational updates.
  </p>

</div>

)}
        {/* Update Status */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

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
  
  onClick={updateBuyerStage}
  className="
    mt-4
    bg-slate-900
    text-white
    rounded-xl
    px-6
    py-3
    font-semibold
    hover:bg-slate-800
    transition
  "
>
  Submit Status Update
</button>
        </div>

        {/* Structured Updates */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h2 className="text-3xl font-bold text-slate-900">
            Add Update
          </h2>

          <p className="text-slate-500 mt-2">
            Share operational updates with
            the chain.
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
  className="mt-6 bg-slate-900 text-white px-6 py-4 rounded-2xl font-semibold hover:bg-slate-700 transition"
>
  Add Update
</button>

        </div>
{/* Break Chain Connection */}
<div className="mt-8 bg-white rounded-3xl shadow-sm border border-red-200 p-8">

  <div className="flex items-start justify-between gap-6">

    <h2 className="text-3xl font-bold text-slate-900">
      Break Chain Connection
    </h2>

    {linkedProperty && (
      <span
        className={`
          shrink-0 px-4 py-2 rounded-full text-sm font-semibold

          ${
            isConnectionBroken
              ? "bg-red-100 text-red-700"
              : "bg-green-100 text-green-700"
          }
        `}
      >
        {isConnectionBroken
          ? "Connection Broken"
          : "Connection Active"}
      </span>
    )}

  </div>

  <p className="mt-4 text-slate-600 max-w-2xl">
    This should only be used after discussions with estate agents or solicitors. Breaking a chain connection may impact confidence scoring and overall chain progression.
  </p>

  <select
    value={breakReason}
    onChange={(event) =>
      setBreakReason(
        event.target.value
      )
    }
    disabled={isConnectionBroken}
    className="mt-6 w-full border border-slate-300 text-slate-900 rounded-2xl px-4 py-4 disabled:bg-slate-100 disabled:text-slate-500"
  >

    <option value="">
      Select break reason
    </option>

    <option value="buyer_side">
  My buyer’s transaction ended
</option>

<option value="seller_side">
  My purchase transaction ended
</option>

  </select>

  <button
    onClick={handleBreakChainConnection}
    disabled={isBreakDisabled}
    className={`
      mt-6 px-6 py-4 rounded-2xl font-semibold transition

      ${
        isBreakDisabled
          ? "bg-slate-300 text-slate-500 cursor-not-allowed"
          : "bg-red-600 hover:bg-red-700 text-white"
      }
    `}
  >

    {isConnectionBroken
      ? "Connection Already Broken"
      : "Break Chain Connection"}

  </button>

</div>
        {/* Activity Timeline */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h2 className="text-3xl font-bold text-slate-900">
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