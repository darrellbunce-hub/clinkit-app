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
import { STAGES } from "@/data/stages";
import { supabase } from "@/lib/supabase";
export default function PropertyPage() {

  const [updateType, setUpdateType] =
    useState("");

  const [delayReason, setDelayReason] =
    useState("");
    const [breakReason, setBreakReason] =
    useState("");
  const params = useParams();
  const router = useRouter();
  const propertyId = Number(
    Array.isArray(params.propertyId)
      ? params.propertyId[0]
      : params.propertyId
  );

  const {
    properties,
    updatePropertyStage,
    addStructuredUpdate,
    breakChainConnection,
    currentUserId,
  } = useChain();
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
  const currentProperty = properties.find(
    (property) => property.id === propertyId
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

  if (!currentProperty) {
    return (
      <div className="p-10 text-2xl">
        Property not found
      </div>
    );
  }
  const canEdit =
  currentProperty.created_by_user_id === currentUserId;

  const currentStage =
  STAGES.find(
    (stage) =>
      stage.value === currentProperty.stage
  );

const latestDelay =
  currentProperty.activities.find(
    (activity) =>
      activity.update.includes(
        "Delay Reported"
      )
  );

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
    latestDelay.update;

  actionColour =
    "bg-amber-100 text-amber-700";
}

if (
  currentProperty.lastUpdatedDays > 14
) {

  actionTitle =
    "Update Recommended";

  actionMessage =
    `No updates have been added for ${currentProperty.lastUpdatedDays} days. Consider checking progress with your estate agent or conveyancer.`;

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
  currentProperty.lastUpdatedDays > 14
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
    
      if (!currentProperty) {
        return;
      }
      
      await addStructuredUpdate(
        currentProperty.id,
        updateMessage
      );
    
      setUpdateType("");
      setDelayReason("");
    }
  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-center gap-4 mb-6">

<Link
  href={`/chain/${currentProperty.chainId}`}
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

  {
    currentProperty.currentUserRole === "seller"
      ? "Your Sale"

      : currentProperty.currentUserRole === "buyer"
      ? "Your Purchase"

      : `Property ${currentProperty.chainPosition}`
  }

</h1>

<p className="text-slate-600 mt-3 text-lg">

  {
    currentProperty.currentUserRole === "seller"
      ? "Property you are selling"

      : currentProperty.currentUserRole === "buyer"
      ? "Property you are purchasing"

      : `Chain position #${currentProperty.chainPosition}`
  }

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
      {currentStage?.nextStep}
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
      {currentStage?.expectedTimeframe}
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
    You can view this property but only the property owner can make operational updates.
  </p>

</div>

)}
        {/* Update Status */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h2 className="text-3xl font-bold text-slate-900">
            Update Status
          </h2>

          <select
          disabled={!canEdit}
            value={currentProperty.stage}
            onChange={(event) =>
              updatePropertyStage(
                currentProperty.id,
                event.target.value
              )
            }
            className="mt-6 w-full border border-slate-300 rounded-xl px-4 py-4 text-lg"
          >

            {STAGES.map((stage) => (

              <option
                key={stage.value}
                value={stage.value}
              >
                {stage.label}
              </option>

            ))}

          </select>

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
          disabled={!canEdit}
            value={updateType}
            onChange={(event) =>
              setUpdateType(event.target.value)
            }
            className="mt-6 w-full border border-slate-300 rounded-xl px-4 py-4"
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
              className="mt-4 w-full border border-slate-300 rounded-xl px-4 py-4"
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

  <h2 className="text-3xl font-bold text-slate-900">
    Break Chain Connection
  </h2>

  <p className="mt-4 text-slate-600 max-w-2xl">
    This should only be used after discussions with estate agents or solicitors. Breaking a chain connection may impact confidence scoring and overall chain progression.
  </p>

  <select
  disabled={!canEdit}
    value={breakReason}
    onChange={(event) =>
      setBreakReason(
        event.target.value
      )
    }
    className="mt-6 w-full border border-slate-300 rounded-2xl px-4 py-4"
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
    onClick={() => {

      if (!breakReason) {
        return;
      }

      breakChainConnection(
        currentProperty.id,
        breakReason
      );
    }}
    className="mt-6 bg-red-600 hover:bg-red-700 text-white px-6 py-4 rounded-2xl font-semibold transition"
  >

    Break Chain Connection

  </button>

</div>
        {/* Activity Timeline */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

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