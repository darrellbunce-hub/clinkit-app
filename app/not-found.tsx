import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-100">
      <Navbar />

      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <h1 className="text-5xl font-bold text-slate-900">
          Page not found
        </h1>

        <p className="mt-4 text-lg text-slate-600">
          The page you are looking for does not exist or you do not
          have access to it.
        </p>

        <Link
          href="/dashboard"
          className="inline-block mt-10 bg-slate-900 text-white px-6 py-4 rounded-xl font-semibold hover:bg-slate-700 transition"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
