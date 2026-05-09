import Navbar from "@/components/Navbar";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-6xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">

          <div>
            <h1 className="text-5xl font-bold text-slate-900">
              My Chains
            </h1>

            <p className="text-slate-600 mt-3 text-lg">
              Track and manage your active property chains.
            </p>
          </div>

          <button className="bg-slate-900 text-white px-6 py-4 rounded-xl hover:bg-slate-700 transition">
            + Create Chain
          </button>

        </div>

        {/* Chain Cards */}
        <div className="grid gap-6 md:grid-cols-2 mt-12">

          {/* Card 1 */}
          <div className="bg-white rounded-3xl shadow-sm p-8 border border-slate-200">

            <div className="flex items-start justify-between">

              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  Chain #CLK-102
                </h2>

                <p className="text-slate-500 mt-2">
                  4 properties in chain
                </p>
              </div>

              <div className="bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium">
                Healthy
              </div>

            </div>

            <div className="mt-8">

              <p className="text-sm text-slate-500">
                Latest Update
              </p>

              <p className="text-xl font-semibold text-slate-900 mt-2">
                Searches Returned
              </p>

            </div>

            <button className="mt-8 w-full border border-slate-300 py-4 rounded-xl hover:bg-slate-50 transition">
              View Chain
            </button>

          </div>

          {/* Card 2 */}
          <div className="bg-white rounded-3xl shadow-sm p-8 border border-slate-200">

            <div className="flex items-start justify-between">

              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  Chain #CLK-245
                </h2>

                <p className="text-slate-500 mt-2">
                  2 properties in chain
                </p>
              </div>

              <div className="bg-amber-100 text-amber-700 px-4 py-2 rounded-full text-sm font-medium">
                Delayed
              </div>

            </div>

            <div className="mt-8">

              <p className="text-sm text-slate-500">
                Latest Update
              </p>

              <p className="text-xl font-semibold text-slate-900 mt-2">
                Awaiting Survey
              </p>

            </div>

            <button className="mt-8 w-full border border-slate-300 py-4 rounded-xl hover:bg-slate-50 transition">
              View Chain
            </button>

          </div>

        </div>

        {/* Recent Activity */}
        <div className="mt-12 bg-white rounded-3xl shadow-sm p-8 border border-slate-200">

          <h2 className="text-2xl font-bold text-slate-900">
            Recent Activity
          </h2>

          <div className="mt-6 space-y-4">

            <div className="flex items-center justify-between border-b border-slate-100 pb-4">

              <div>
                <p className="font-medium text-slate-900">
                  Searches Returned
                </p>

                <p className="text-slate-500 text-sm">
                  Chain #CLK-102
                </p>
              </div>

              <p className="text-sm text-slate-400">
                2 hours ago
              </p>

            </div>

            <div className="flex items-center justify-between border-b border-slate-100 pb-4">

              <div>
                <p className="font-medium text-slate-900">
                  Survey Booked
                </p>

                <p className="text-slate-500 text-sm">
                  Chain #CLK-245
                </p>
              </div>

              <p className="text-sm text-slate-400">
                Yesterday
              </p>

            </div>

          </div>

        </div>

      </div>

    </main>
  );
}