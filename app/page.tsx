import Navbar from "@/components/Navbar";
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-white">

      <Navbar />

      {/* Hero */}
      <section className="px-6 pt-20 pb-24">

        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">

          {/* Left Side */}
          <div>

            <h1 className="text-6xl font-bold text-slate-900 leading-tight">
              Property chain tracking made simple.
            </h1>

            <p className="mt-8 text-xl text-slate-600 leading-relaxed">
              Follow your property chain in real time with live updates,
              confidence indicators and clear progress tracking.
            </p>

            <div className="mt-10 flex gap-4">

              <Link
                href="/dashboard"
                className="bg-slate-900 text-white px-8 py-4 rounded-xl text-lg hover:bg-slate-700 transition"
              >
                Get Started
              </Link>

              <Link
                href="/login"
                className="border border-slate-300 px-8 py-4 rounded-xl text-lg hover:bg-slate-100 transition"
              >
                Login
              </Link>

            </div>

          </div>

          {/* Right Side Mock Dashboard */}
          <div className="relative">

            <div className="bg-white rounded-3xl shadow-2xl p-8 border border-slate-200">

              <div className="flex items-center justify-between">

                <div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    My Chains
                  </h2>

                  <p className="text-slate-500 mt-1">
                    Active property chains
                  </p>
                </div>

                <div className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full text-sm font-medium">
                  Live Updates
                </div>

              </div>

              {/* Chain Card */}
              <div className="mt-8 bg-slate-50 rounded-2xl p-6 border border-slate-200">

                <div className="flex items-center justify-between">

                  <div>
                    <h3 className="text-xl font-semibold text-slate-900">
                      Chain #CLK-102
                    </h3>

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

              </div>

              {/* Second Card */}
              <div className="mt-4 bg-slate-50 rounded-2xl p-6 border border-slate-200">

                <div className="flex items-center justify-between">

                  <div>
                    <h3 className="text-xl font-semibold text-slate-900">
                      Chain #CLK-245
                    </h3>

                    <p className="text-slate-500 mt-1">
                      Awaiting Survey
                    </p>
                  </div>

                  <div className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-sm font-medium">
                    Delayed
                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

      </section>

    </main>
  );
}