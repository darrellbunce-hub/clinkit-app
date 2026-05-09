import Navbar from "@/components/Navbar";
import Link from "next/link";

/* Stage Configuration */
const STAGES = {
  searches_started: {
    label: "Searches Started",
    colour: "bg-slate-100 border-slate-300",
    text: "text-slate-500",
    progress: 30,
  },

  mortgage_approved: {
    label: "Mortgage Approved",
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

/* Property Data */
const properties = [
  {
    id: 1,
    stage: "searches_started",
    isCurrentUser: false,
    lastUpdatedDays: 2,
  },

  {
    id: 2,
    stage: "mortgage_approved",
    isCurrentUser: false,
    lastUpdatedDays: 1,
  },

  {
    id: 3,
    stage: "survey_booked",
    isCurrentUser: true,
    lastUpdatedDays: 3,
  },

  {
    id: 4,
    stage: "awaiting_searches",
    isCurrentUser: false,
    lastUpdatedDays: 18,
  },
];

/* Progress Calculation */
const totalProgress = properties.reduce((total, property) => {
  const stage =
    STAGES[property.stage as keyof typeof STAGES];

  return total + stage.progress;
}, 0);

const averageProgress =
  Math.round(totalProgress / properties.length);

/* Stale Detection */
const staleProperties = properties.filter(
  (property) => property.lastUpdatedDays > 14
);

/* Confidence Logic */
let confidenceLabel = "Low";
let confidenceColour = "text-red-600";
let confidenceBg = "bg-red-100";

if (averageProgress > 60) {
  confidenceLabel = "Healthy";
  confidenceColour = "text-green-700";
  confidenceBg = "bg-green-100";
} else if (averageProgress > 30) {
  confidenceLabel = "Moderate";
  confidenceColour = "text-amber-700";
  confidenceBg = "bg-amber-100";
}

export default function ChainPage() {
  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-6xl mx-auto px-6 py-12">

        {/* Header */}
        <div>

          <h1 className="text-5xl font-bold text-slate-900">
            Chain #CLK-102
          </h1>

          <p className="text-slate-600 mt-3 text-lg">
            Live property chain progress tracking
          </p>

        </div>

        {/* Progress Section */}
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

          {/* Progress Bar */}
          <div className="mt-8 w-full h-6 bg-slate-200 rounded-full overflow-hidden">

            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${averageProgress}%` }}
            ></div>

          </div>

        </div>

        {/* Confidence Section */}
        <div className="mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <div className="flex items-center justify-between">

            <div>

              <h2 className="text-3xl font-bold text-slate-900">
                Chain Confidence
              </h2>

              <p className="text-slate-600 mt-2">
                Estimated likelihood of successful completion
              </p>

            </div>

            <div
              className={`
                ${confidenceBg}
                px-6 py-4 rounded-2xl
              `}
            >

              <p className={`text-3xl font-bold ${confidenceColour}`}>
                {averageProgress}%
              </p>

              <p className={`text-sm font-medium mt-1 ${confidenceColour}`}>
                {confidenceLabel}
              </p>

            </div>

          </div>

        </div>

        {/* Stale Warning */}
        {staleProperties.length > 0 && (

          <div className="mt-10 bg-amber-100 border border-amber-300 rounded-3xl p-6">

            <div className="flex items-start gap-4">

              <div className="text-3xl">
                ⚠️
              </div>

              <div>

                <h2 className="text-2xl font-bold text-amber-800">
                  Chain Activity Warning
                </h2>

                <p className="mt-2 text-amber-700 text-lg">
                  Property {staleProperties[0].id} has not updated for{" "}
                  {staleProperties[0].lastUpdatedDays} days.
                </p>

              </div>

            </div>

          </div>

        )}

        {/* Chain Visual */}
        <div className="mt-12 bg-white rounded-3xl shadow-sm border border-slate-200 p-8 overflow-x-auto">

          <div className="flex items-center min-w-max">

            {properties.map((property, index) => {

              const stage =
                STAGES[property.stage as keyof typeof STAGES];

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
                        ${property.isCurrentUser
                          ? "w-28 h-28 rounded-3xl border-4 text-6xl"
                          : "w-24 h-24 rounded-2xl border-2 text-5xl"}
                        ${stage.colour}
                        flex items-center justify-center relative
                      `}
                    >

                      🏠

                      {property.isCurrentUser && (
                        <div className="absolute -top-3 bg-blue-500 text-white text-xs px-3 py-1 rounded-full">
                          YOU
                        </div>
                      )}

                    </div>

                    <p className="mt-4 font-semibold text-slate-900">
                      Property {property.id}
                    </p>

                    <p className={`text-sm mt-1 ${stage.text}`}>
                      {stage.label}
                    </p>

                  </Link>

                  {/* Connector */}
                  {index < properties.length - 1 && (
                    <div className="w-24 border-t-4 border-dashed border-slate-300 mx-4"></div>
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