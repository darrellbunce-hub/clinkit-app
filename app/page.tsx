export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white p-10 rounded-2xl shadow-lg text-center">
        <h1 className="text-5xl font-bold text-slate-900">
          ClinkIt
        </h1>

        <p className="mt-4 text-slate-600 text-lg">
          Property chain tracking made simple.
        </p>

        <button className="mt-6 bg-slate-900 text-white px-6 py-3 rounded-xl hover:bg-slate-700 transition">
          Get Started
        </button>
      </div>
    </main>
  );
}