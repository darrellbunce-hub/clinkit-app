export default function DashboardPage() {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
  
        <div className="max-w-5xl mx-auto">
  
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-4xl font-bold text-slate-900">
                My Chains
              </h1>
  
              <p className="text-slate-600 mt-2">
                Track your active property chains.
              </p>
            </div>
  
            <button className="bg-slate-900 text-white px-5 py-3 rounded-xl hover:bg-slate-700 transition">
              + Create Chain
            </button>
          </div>
  
          <div className="grid gap-6 md:grid-cols-2">
  
            {/* Chain Card */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
  
              <div className="flex items-center justify-between">
  
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">
                    Chain #CLK-102
                  </h2>
  
                  <p className="text-slate-500 mt-1">
                    4 properties in chain
                  </p>
                </div>
  
                <div className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-medium">
                  Healthy
                </div>
  
              </div>
  
              <div className="mt-6">
  
                <p className="text-sm text-slate-500">
                  Latest Update
                </p>
  
                <p className="text-lg font-medium text-slate-900 mt-1">
                  Searches Returned
                </p>
  
              </div>
  
              <button className="mt-6 w-full border border-slate-300 py-3 rounded-xl hover:bg-slate-50 transition">
                View Chain
              </button>
  
            </div>
  
            {/* Second Chain */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
  
              <div className="flex items-center justify-between">
  
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">
                    Chain #CLK-245
                  </h2>
  
                  <p className="text-slate-500 mt-1">
                    2 properties in chain
                  </p>
                </div>
  
                <div className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-sm font-medium">
                  Delayed
                </div>
  
              </div>
  
              <div className="mt-6">
  
                <p className="text-sm text-slate-500">
                  Latest Update
                </p>
  
                <p className="text-lg font-medium text-slate-900 mt-1">
                  Awaiting Survey
                </p>
  
              </div>
  
              <button className="mt-6 w-full border border-slate-300 py-3 rounded-xl hover:bg-slate-50 transition">
                View Chain
              </button>
  
            </div>
  
          </div>
  
        </div>
  
      </main>
    );
  }