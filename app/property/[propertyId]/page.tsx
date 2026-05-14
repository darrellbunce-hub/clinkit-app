"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

import Navbar from "@/components/Navbar";
import { useChain } from "@/context/ChainContext";
import { STAGES } from "@/data/stages";

export default function PropertyPage() {

  const [updateType, setUpdateType] =
    useState("");

  const [delayReason, setDelayReason] =
    useState("");

  const params = useParams();

  const propertyId = Number(
    Array.isArray(params.propertyId)
      ? params.propertyId[0]
      : params.propertyId
  );

  const {
    properties,
    updatePropertyStage,
  } = useChain();

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

  const currentStage =
    STAGES.find(
      (stage) =>
        stage.value === currentProperty.stage
    );

  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-4xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h1 className="text-5xl font-bold text-slate-900">
            Property {currentProperty.id}
          </h1>

          <p className="text-slate-600 mt-3 text-lg">
            Chain position #{currentProperty.id}
          </p>

        </div>

        {/* Current Status */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h2 className="text-3xl font-bold text-slate-900">
            Current Status
          </h2>

          <p className="mt-6 text-xl font-medium text-slate-900">
            {currentStage?.label}
          </p>

          <div className="mt-8 bg-slate-50 rounded-2xl p-6">

            <p className="text-sm text-slate-500">
              Expected Next Step
            </p>

            <p className="text-lg font-semibold text-slate-900 mt-1">
              {currentStage?.nextStep}
            </p>

            <p className="text-sm text-slate-500 mt-5">
              Typical Timeframe
            </p>

            <p className="text-lg font-semibold text-slate-900 mt-1">
              {currentStage?.expectedTimeframe}
            </p>

          </div>

        </div>

        {/* Update Status */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h2 className="text-3xl font-bold text-slate-900">
            Update Status
          </h2>

          <select
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
            className="mt-6 bg-slate-900 text-white px-6 py-4 rounded-2xl font-semibold hover:bg-slate-700 transition"
          >
            Add Update
          </button>

        </div>

        {/* Activity Timeline */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h2 className="text-3xl font-bold text-slate-900">
            Activity Timeline
          </h2>

          <div className="mt-6 space-y-6">

            {currentProperty.activities.map((activity) => (

              <div
                key={activity.id}
                className="bg-slate-50 rounded-2xl p-5 flex items-start gap-4"
              >

                <div className="w-4 h-4 rounded-full bg-blue-500 mt-2"></div>

                <div>

                  <p className="font-semibold text-slate-900">
                    {activity.update}
                  </p>

                  <p className="text-sm text-slate-500 mt-1">
                    Updated by {
                      activity.updated_by || "system"
                    }
                  </p>

                  <p className="text-sm text-slate-400 mt-1">
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