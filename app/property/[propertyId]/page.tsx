"use client";

import { useParams } from "next/navigation";

import Navbar from "@/components/Navbar";
import { useChain } from "@/context/ChainContext";

const stageOptions = [

  {
    value: "viewing_properties",
    label: "Viewing Properties",
  },

  {
    value: "offer_submitted",
    label: "Offer Submitted",
  },

  {
    value: "offer_accepted",
    label: "Offer Accepted",
  },

  {
    value: "mortgage_offer_received",
    label: "Mortgage Offer Received",
  },

  {
    value: "survey_booked",
    label: "Survey Booked",
  },

  {
    value: "searches_started",
    label: "Searches Started",
  },

  {
    value: "awaiting_searches",
    label: "Awaiting Searches",
  },

];

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
            {currentProperty.stage}
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

            {stageOptions.map((stage) => (
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
                className="flex items-start gap-4"
              >

                <div className="w-4 h-4 rounded-full bg-blue-500 mt-2"></div>

                <div>

                  <p className="font-semibold text-slate-900">
                    {activity.update}
                  </p>

                  <p className="text-sm text-slate-500 mt-1">
                    {activity.date}
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