"use client";

import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useChain } from "@/context/ChainContext";

const STAGES = {

  searches_started: {
    label: "Searches Started",
    colour: "bg-slate-100 border-slate-300",
    text: "text-slate-500",
    progress: 30,
  },

  mortgage_offer_received: {
    label: "Mortgage Offer Received",
    colour: "bg-green-100 border-green-500",
    text: "text-green-700",
    progress: 55,
  },

  survey_booked: {
    label: "Survey Booked",
    colour: "bg-blue-100 border-blue-500",
    text: "text-blue-600",
    progress: 45,
  },

  awaiting_searches: {
    label: "Awaiting Searches",
    colour: "bg-amber-100 border-amber-500",
    text: "text-amber-700",
    progress: 20,
  },

};

export default function ChainPage() {

  const { properties } = useChain();

  const totalProgress = properties.reduce(
    (total, property) => {

      const stage =
        STAGES[property.stage as keyof typeof STAGES];

      if (!stage) {
        return total;
      }

      return total + stage.progress;

    },
    0
  );

  const averageProgress =
    Math.round(totalProgress / properties.length);

  const staleProperties = properties.filter(
    (property) => property.lastUpdatedDays > 14
  );

  const blockedCount = properties.filter(
    (property) => property.status === "blocked"
  ).length;

  const delayedCount = properties.filter(
    (property) => property.status === "delayed"
  ).length;

  let confidenceScore = averageProgress;

  confidenceScore -= blockedCount * 25;
  confidenceScore -= delayedCount * 10;
  confidenceScore -= staleProperties.length * 5;

  if (confidenceScore < 0) {
    confidenceScore = 0;
  }

  let confidenceLabel = "High Risk";
  let confidenceColour = "text-red-700";
  let confidenceBg = "bg-red-100";

  if (confidenceScore >= 70) {
    confidenceLabel = "Healthy";
    confidenceColour = "text-green-700";
    confidenceBg = "bg-green-100";
  }
  else if (confidenceScore >= 40) {
    confidenceLabel = "Moderate";
    confidenceColour = "text-amber-700";
    confidenceBg = "bg-amber-100";
  }

  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-6xl mx-auto px-6 py-12">

        <div>

          <h1 className="text-5xl font-bold text-slate-900">
            Chain #CLK-102
          </h1>

          <p className="text-slate-600 mt-3 text-lg">
            Live property chain progress tracking
          </p>

        </div>

        {/* Progress */}
        <div className="mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <div className="flex items-center justify-between">

            <div>

              <h2 className="text-3xl font-bold text-slate-900">
                Chain Progress
              </h2>

              <p className="text-slate-600 mt-2">
                Overall chain completion estimate
              </p>

            </div>

            <div className="text-4xl font-bold text-slate-900">
              {averageProgress}%
            </div>

          </div>

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
        <div className="mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <div className="flex items-center justify-between">

            <div>

              <h2 className="text-3xl font-bold text-slate-900">
                Chain Confidence
              </h2>

            </div>

            <div
              className={`
                ${confidenceBg}
                px-6 py-4 rounded-2xl
              `}
            >

              <p className={`text-3xl font-bold ${confidenceColour}`}>
                {confidenceScore}%
              </p>

              <p className={`text-sm mt-1 ${confidenceColour}`}>
                {confidenceLabel}
              </p>

            </div>

          </div>

        </div>

        {/* Warning */}
        {staleProperties.length > 0 && (

          <div className="mt-10 bg-amber-100 border border-amber-300 rounded-3xl p-6">

            <p className="text-amber-700 font-semibold">
              Property {staleProperties[0].id} has not updated for{" "}
              {staleProperties[0].lastUpdatedDays} days.
            </p>

          </div>

        )}

        {/* Chain */}
        <div className="mt-12 bg-white rounded-3xl shadow-sm border border-slate-200 p-8 overflow-x-auto">

          <div className="flex items-center min-w-max">

            {properties.map((property, index) => {

              const stage =
                STAGES[property.stage as keyof typeof STAGES];

              if (!stage) {
                return null;
              }

              return (
                <div
                  key={property.id}
                  className="flex items-center"
                >

                  <Link
                    href={`/property/${property.id}`}
                    className="flex flex-col items-center text-center hover:scale-105 transition"
                  >

                    <div
                      className={`
                        relative
                        flex
                        items-center
                        justify-center

                        ${
                          property.isCurrentUser
                            ? "w-28 h-28 rounded-3xl border-4 text-6xl"
                            : "w-24 h-24 rounded-2xl border-2 text-5xl"
                        }

                        ${
                          property.status === "healthy"
                            ? "bg-green-100 border-green-500"
                            : property.status === "delayed"
                            ? "bg-amber-100 border-amber-500"
                            : "bg-red-100 border-red-500"
                        }
                      `}
                    >

                      🏠

                    </div>

                    <p className="mt-4 font-semibold text-slate-900">
                      Property {property.id}
                    </p>

                    <p className={`text-sm mt-1 ${stage.text}`}>
                      {stage.label}
                    </p>

                  </Link>

                  {index < properties.length - 1 && (

                    <div
                      className={`
                        w-24
                        border-t-4
                        border-dashed
                        mx-4

                        ${
                          property.status === "healthy"
                            ? "border-green-400"
                            : property.status === "delayed"
                            ? "border-amber-400"
                            : "border-red-400"
                        }
                      `}
                    ></div>

                  )}

                </div>
              );
            })}

          </div>

        </div>

      </div>

    </main>
  );
}