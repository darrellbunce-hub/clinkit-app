import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function HomePage() {

  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-6 py-24">

        <div className="text-center">

          <div className="inline-block bg-blue-100 text-blue-700 px-4 py-2 rounded-full text-sm font-semibold">
            Live Property Chain Tracking
          </div>

          <h1 className="mt-8 text-6xl font-bold text-slate-900 leading-tight">
            Reduce Property Chain Anxiety
          </h1>

          <p className="mt-8 text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
            ClinkIt gives buyers, sellers and agents
            real-time visibility into property chain
            progress, delays and completion confidence.
          </p>

          <div className="mt-12 flex items-center justify-center gap-6">

            <Link
              href="/chain/clk-102"
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-2xl text-lg font-semibold transition"
            >
              Open Demo Chain
            </Link>

            <button
              className="bg-white border border-slate-300 hover:border-slate-400 text-slate-700 px-8 py-4 rounded-2xl text-lg font-semibold transition"
            >
              Learn More
            </button>

          </div>

        </div>

      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 pb-24">

        <div className="grid md:grid-cols-3 gap-8">

          <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">

            <div className="text-5xl">
              🏠
            </div>

            <h2 className="mt-6 text-2xl font-bold text-slate-900">
              Visual Chain Tracking
            </h2>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Instantly understand where every property
              sits within the chain and identify delays.
            </p>

          </div>

          <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">

            <div className="text-5xl">
              📈
            </div>

            <h2 className="mt-6 text-2xl font-bold text-slate-900">
              Confidence Scoring
            </h2>

            <p className="mt-4 text-slate-600 leading-relaxed">
              See real-time chain health indicators
              and completion confidence estimates.
            </p>

          </div>

          <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">

            <div className="text-5xl">
              ⚠️
            </div>

            <h2 className="mt-6 text-2xl font-bold text-slate-900">
              Delay Detection
            </h2>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Identify stalled transactions and risky
              chain dependencies before they escalate.
            </p>

          </div>

        </div>

      </section>

    </main>
  );
}