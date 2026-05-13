"use client";

import { useParams } from "next/navigation";

import Navbar from "@/components/Navbar";
import { useChain } from "@/context/ChainContext";
import { STAGES } from "@/data/stages";

export default function PropertyPage() {

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
          {
  STAGES.find(
    (stage) =>
      stage.value === currentProperty.stage
  )?.label
}
          </p>

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

        {/* Activity Timeline */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h2 className="text-3xl font-bold text-slate-900">
            Activity Timeline
          </h2>

          {/* Timeline */}
          <div className="space-y-6">

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