import Navbar from "@/components/Navbar";

type PropertyPageProps = {
  params: {
    propertyId: string;
  };
};

export default function PropertyPage({
  params,
}: PropertyPageProps) {
  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-4xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <div className="flex items-center justify-between">

            <div>

              <h1 className="text-5xl font-bold text-slate-900">
                Property {params.propertyId}
              </h1>

              <p className="text-slate-600 mt-3 text-lg">
                Chain position #{params.propertyId}
              </p>

            </div>

            <div className="bg-blue-100 text-blue-700 px-5 py-3 rounded-full text-sm font-semibold">
              Active
            </div>

          </div>

        </div>

        {/* Status Card */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h2 className="text-3xl font-bold text-slate-900">
            Current Status
          </h2>

          <div className="mt-6 flex items-center gap-4">

            <div className="w-5 h-5 rounded-full bg-green-500"></div>

            <p className="text-xl font-medium text-slate-900">
              Mortgage Approved
            </p>

          </div>

          <p className="mt-4 text-slate-600">
            Latest update received 2 hours ago.
          </p>

        </div>

        {/* Confidence */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h2 className="text-3xl font-bold text-slate-900">
            Confidence Indicator
          </h2>

          <div className="mt-6">

            <div className="w-full h-5 bg-slate-200 rounded-full overflow-hidden">

              <div className="w-[78%] h-full bg-green-500 rounded-full"></div>

            </div>

            <p className="mt-4 text-lg font-semibold text-green-700">
              High Confidence — 78%
            </p>

          </div>

        </div>

        {/* Activity */}
        <div className="mt-8 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <h2 className="text-3xl font-bold text-slate-900">
            Recent Activity
          </h2>

          <div className="mt-8 space-y-6">

            <div className="border-b border-slate-100 pb-4">

              <p className="font-semibold text-slate-900">
                Mortgage Approved
              </p>

              <p className="text-slate-500 mt-1">
                Updated 2 hours ago
              </p>

            </div>

            <div className="border-b border-slate-100 pb-4">

              <p className="font-semibold text-slate-900">
                Searches Started
              </p>

              <p className="text-slate-500 mt-1">
                Updated 4 days ago
              </p>

            </div>

            <div>

              <p className="font-semibold text-slate-900">
                Offer Accepted
              </p>

              <p className="text-slate-500 mt-1">
                Updated 12 days ago
              </p>

            </div>

          </div>

        </div>

      </div>

    </main>
  );
}