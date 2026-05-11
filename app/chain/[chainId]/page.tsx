"use client";

import Navbar from "@/components/Navbar";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useChain } from "@/context/ChainContext";
import { STAGES } from "@/data/stages";
export default function ChainPage() {
  const params = useParams();

  const chainId =
    Number(params.chainId);
    const { properties } = useChain();

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
    

  const totalProgress = chainProperties.reduce(
    (total, property) => {
      const stage = STAGES.find(
        (stage) => stage.value === property.stage
      );

      if (!stage) {
        return total;
      }

      return total + (stage?.progress || 0);

    },
    0
  );

  const averageProgress =
    Math.round(totalProgress / chainProperties.length);

  const staleProperties = chainProperties.filter(
    (property) => property.lastUpdatedDays > 14
  );

  const blockedCount = chainProperties.filter(
    (property) => property.status === "blocked"
  ).length;

  const delayedCount = chainProperties.filter(
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
          Chain #{chainId}
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

            {chainProperties.map((property, index) => {
const stage = STAGES.find(
  (stage) => stage.value === property.stage
);

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
  Property {property.chainPosition}
</p>
                  

                    <p className="text-sm mt-1 text-slate-600">
                      {stage.label}
                    </p>

                  </Link>

                  {index < chainProperties.length - 1 && (

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