import Link from "next/link";
export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100">
      
      {/* Header */}
      <header className="flex items-center justify-between p-6 bg-white shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">
          ClinkIt
        </h1>

        <Link
  href="/login"
  className="bg-slate-900 text-white px-4 py-2 rounded-lg"
>
  Login
</Link>
      </header>

      {/* Hero Section */}
      <section className="px-6 py-16 text-center">
        <h2 className="text-5xl font-bold text-slate-900 leading-tight">
          Property chain tracking made simple.
        </h2>

        <p className="mt-6 text-lg text-slate-600 max-w-xl mx-auto">
          Follow your property chain in real time with clear updates,
          confidence indicators and progress tracking.
        </p>

        <Link
  href="/dashboard"
  className="inline-block mt-8 bg-slate-900 text-white px-8 py-4 rounded-xl text-lg hover:bg-slate-700 transition"
>
  Get Started
</Link>
      </section>

      {/* Features */}
      <section className="px-6 pb-20">
        <div className="grid gap-6 md:grid-cols-3">

          <div className="bg-white p-6 rounded-2xl shadow-sm">
            <h3 className="text-xl font-semibold">
              Live Chain Updates
            </h3>

            <p className="mt-3 text-slate-600">
              Track every stage of your buying and selling journey.
            </p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm">
            <h3 className="text-xl font-semibold">
              Confidence Indicators
            </h3>

            <p className="mt-3 text-slate-600">
              Understand how secure your chain feels in real time.
            </p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm">
            <h3 className="text-xl font-semibold">
              Private & Secure
            </h3>

            <p className="mt-3 text-slate-600">
              Only people involved in the chain can access updates.
            </p>
          </div>

        </div>
      </section>

    </main>
  );
}