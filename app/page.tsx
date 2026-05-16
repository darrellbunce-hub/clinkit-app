"use client";
import { motion } from "framer-motion";
import {
  Home,
  Search,
  Clock3,
  TrendingUp,
  AlertTriangle,
  ShieldCheck,
  Smartphone,
  Zap,
} from "lucide-react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Logo from "@/components/Logo";
const steps = [
  {
    number: 1,
    title: "Create Your Chain",
    text: "Start your move and add your onward purchase or sale.",
  },
  {
    number: 2,
    title: "Invite Participants",
    text: "Securely connect buyers, sellers and future homeowners.",
  },
  {
    number: 3,
    title: "Track Progress Together",
    text: "See updates, bottlenecks and milestones in real time.",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-100">
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden">

        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950"></div>

        <div className="absolute inset-0 opacity-20">
          <svg
            className="w-full h-full"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line x1="10%" y1="20%" x2="40%" y2="35%" stroke="#3382F6" strokeWidth="1" />
            <line x1="40%" y1="35%" x2="70%" y2="15%" stroke="#3382F6" strokeWidth="1" />
            <line x1="70%" y1="15%" x2="90%" y2="30%" stroke="#3382F6" strokeWidth="1" />

            <circle cx="10%" cy="20%" r="3" fill="#38B2F6" />
            <circle cx="40%" cy="35%" r="3" fill="#38B2F6" />
            <circle cx="70%" cy="15%" r="3" fill="#38B2F6" />
            <circle cx="90%" cy="30%" r="3" fill="#38B2F6" />
          </svg>
        </div>

        <div className="absolute top-[-200px] right-[-100px] w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-3xl"></div>

        <div className="absolute bottom-[-200px] left-[-100px] w-[400px] h-[400px] bg-cyan-400/10 rounded-full blur-3xl"></div>

        <div className="relative max-w-6xl mx-auto px-6 py-28">
          <div className="grid lg:grid-cols-2 gap-16 items-center">

            {/* LEFT */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
            >
              <div className="inline-flex items-center bg-blue-500/20 text-blue-200 border border-blue-400/30 px-4 py-2 rounded-full text-sm font-semibold">
                Live Property Chain Tracking
              </div>

              <h1 className="mt-8 text-6xl font-bold text-white leading-tight">
                Track Your Property Chain In Real Time
              </h1>

              <p className="mt-8 text-xl text-slate-300 leading-relaxed">
                Reduce uncertainty, delays and endless chasing during your home move with shared live chain progress tracking.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <Link
                  href="/start-move"
                  className="bg-blue-600 hover:bg-blue-500 hover:scale-[1.02] shadow-lg shadow-blue-500/30 text-white px-8 py-5 rounded-2xl font-semibold text-lg transition-all text-center"
                >
                  Start Your Move
                </Link>

                <Link
                  href="/join-chain"
                  className="border border-white/20 bg-white/10 backdrop-blur-xl text-white px-8 py-5 rounded-2xl font-semibold text-lg hover:bg-white/20 transition text-center"
                >
                  Join Existing Chain
                </Link>
              </div>
            </motion.div>

            {/* RIGHT */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="bg-white/10 backdrop-blur-xl rounded-3xl border border-white/10 p-10"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-300">
                    Chain Health
                  </p>

                  <h2 className="mt-2 text-4xl font-bold text-white">
                    Healthy
                  </h2>
                </div>

                <div className="bg-green-100 text-green-700 px-4 py-2 rounded-full font-semibold">
                  82%
                </div>
              </div>

              <div className="mt-10 space-y-6">

                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-green-100 border-2 border-green-500 flex items-center justify-center">
                    <Home className="w-7 h-7 text-green-700" />
                  </div>

                  <div className="flex-1 h-2 bg-green-400 rounded-full"></div>

                  <div className="w-14 h-14 rounded-2xl bg-green-100 border-2 border-green-500 flex items-center justify-center">
                    <Home className="w-7 h-7 text-green-700" />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-green-100 border-2 border-green-500 flex items-center justify-center">
                    <Home className="w-7 h-7 text-green-700" />
                  </div>

                  <div className="flex-1 h-2 bg-amber-400 rounded-full"></div>

                  <div className="w-14 h-14 rounded-2xl bg-amber-100 border-2 border-amber-500 flex items-center justify-center">
                    <Clock3 className="w-7 h-7 text-amber-700" />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 border-2 border-slate-300 flex items-center justify-center">
                    <Clock3 className="w-7 h-7 text-slate-500" />
                  </div>

                  <div className="flex-1 h-2 bg-slate-300 rounded-full"></div>

                  <div className="w-14 h-14 rounded-2xl bg-slate-100 border-2 border-slate-300 flex items-center justify-center">
                    <Search className="w-7 h-7 text-slate-500" />
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="relative overflow-hidden bg-white border-y border-slate-200">

        <div className="absolute top-[-150px] right-[-100px] w-[400px] h-[400px] bg-blue-100 rounded-full blur-3xl opacity-40"></div>

        <div className="max-w-6xl mx-auto px-6 py-24">

          <div className="text-center">
            <h2 className="text-5xl font-bold text-slate-900">
              How Keynetic Works
            </h2>

            <p className="mt-6 text-xl text-slate-600 max-w-3xl mx-auto">
              Shared operational visibility for everyone involved in the property chain.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mt-16">
            {steps.map((item) => (
              <motion.div
                key={item.number}
                whileHover={{ y: -8 }}
                transition={{ duration: 0.2 }}
                className="relative overflow-hidden bg-slate-50 rounded-3xl p-8 border border-slate-200 hover:shadow-2xl hover:shadow-blue-100 transition-all duration-300"
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-cyan-400"></div>

                <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center text-3xl font-bold">
                  {item.number}
                </div>

                <h3 className="mt-8 text-2xl font-bold text-slate-900">
                  {item.title}
                </h3>

                <p className="mt-4 text-slate-600 leading-relaxed">
                  {item.text}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="max-w-6xl mx-auto px-6 py-24">

        <div className="text-center">
          <h2 className="text-5xl font-bold text-slate-900">
            Built For Modern Property Chains
          </h2>

          <p className="mt-6 text-xl text-slate-600 max-w-3xl mx-auto">
            Operational visibility and structured updates for everyone involved in the move.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mt-16">

          <div className="bg-white rounded-3xl border border-slate-200 p-8 hover:-translate-y-2 hover:shadow-2xl hover:shadow-blue-100 transition-all duration-300">
            <TrendingUp className="w-12 h-12 text-blue-600" />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Live Chain Progress
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Understand exactly where every property sits within the chain.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-8 hover:-translate-y-2 hover:shadow-2xl hover:shadow-blue-100 transition-all duration-300">
            <AlertTriangle className="w-12 h-12 text-amber-500" />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Bottleneck Detection
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Identify delays and stalled transactions before they impact completion.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-8 hover:-translate-y-2 hover:shadow-2xl hover:shadow-blue-100 transition-all duration-300">
            <ShieldCheck className="w-12 h-12 text-emerald-600" />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Permission Controlled
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Participants can only update properties they are authorised to manage.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-8 hover:-translate-y-2 hover:shadow-2xl hover:shadow-blue-100 transition-all duration-300">
            <Home className="w-12 h-12 text-green-700" />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Shared Visibility
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Buyers and sellers see a shared operational view of the move.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-8 hover:-translate-y-2 hover:shadow-2xl hover:shadow-blue-100 transition-all duration-300">
            <Zap className="w-12 h-12 text-yellow-500" />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Faster Decisions
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Reduce uncertainty with structured milestones and real-time updates.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-8 hover:-translate-y-2 hover:shadow-2xl hover:shadow-blue-100 transition-all duration-300">
            <Smartphone className="w-12 h-12 text-slate-700" />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Mobile Friendly
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Designed for homeowners tracking their move on any device.
            </p>
          </div>
        </div>
      </section>

      {/* METRICS */}
      <section className="bg-white border-t border-slate-200">

        <div className="max-w-6xl mx-auto px-6 py-14">
          <div className="grid md:grid-cols-4 gap-8 text-center">

            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200">
              <h3 className="text-5xl font-bold text-slate-900">
                24/7
              </h3>

              <p className="mt-3 text-slate-600">
                Live chain visibility
              </p>
            </div>

            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200">
              <h3 className="text-5xl font-bold text-slate-900">
                Real-Time
              </h3>

              <p className="mt-3 text-slate-600">
                Shared transaction updates
              </p>
            </div>

            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200">
              <h3 className="text-5xl font-bold text-slate-900">
                Secure
              </h3>

              <p className="mt-3 text-slate-600">
                Permission controlled access
              </p>
            </div>

            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200">
              <h3 className="text-5xl font-bold text-slate-900">
                Chain-Wide
              </h3>

              <p className="mt-3 text-slate-600">
                Visibility across transactions
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-50 border-t border-slate-200">

        <div className="max-w-5xl mx-auto px-6 py-24">

          <div className="text-center">
            <h2 className="text-5xl font-bold text-slate-900">
              Frequently Asked Questions
            </h2>

            <p className="mt-6 text-xl text-slate-600">
              Common questions about Keynetic and property chain tracking.
            </p>
          </div>

          <div className="mt-16 space-y-6">

            {[
              {
                title: "What is Keynetic?",
                text: "Keynetic is a shared property chain tracking platform designed to improve visibility, communication and operational awareness during residential property transactions.",
              },
              {
                title: "Who can use Keynetic?",
                text: "Homeowners, buyers, sellers and eventually estate agents and conveyancers can participate within connected property chains.",
              },
              {
                title: "Can other users edit my property?",
                text: "No. Users can only manage and update properties they are authorised to access within the chain.",
              },
              {
                title: "How are chains connected?",
                text: "Chains are connected through secure access codes and matching property details provided by transaction participants.",
              },
              {
                title: "Is Keynetic available on mobile devices?",
                text: "Yes. Keynetic is designed to work across desktop, tablet and mobile devices.",
              },
            ].map((faq) => (
              <div
                key={faq.title}
                className="bg-white rounded-3xl border border-slate-200 p-8 hover:-translate-y-1 hover:shadow-xl transition-all duration-300"
              >
                <h3 className="text-2xl font-bold text-slate-900">
                  {faq.title}
                </h3>

                <p className="mt-4 text-slate-600 leading-relaxed">
                  {faq.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-white border-t border-slate-200">

        <div className="max-w-5xl mx-auto px-6 py-24 text-center">

          <h2 className="text-5xl font-bold text-slate-900 leading-tight">
            Ready To Reduce Property Chain Stress?
          </h2>

          <p className="mt-8 text-xl text-slate-600 leading-relaxed max-w-3xl mx-auto">
            Join a smarter, more transparent way to manage property transactions and chain progression.
          </p>

          <div className="mt-12 flex flex-col sm:flex-row justify-center gap-4">

            <Link
              href="/start-move"
              className="bg-slate-900 hover:bg-slate-800 hover:scale-[1.02] transition-all duration-300 text-white px-8 py-5 rounded-2xl font-semibold text-lg"
            >
              Start Your Move
            </Link>

            <Link
              href="/join-chain"
              className="border border-slate-300 bg-white text-slate-900 px-8 py-5 rounded-2xl font-semibold text-lg hover:bg-slate-50 transition"
            >
              Join Existing Chain
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
<footer className="bg-slate-950">

<div className="max-w-6xl mx-auto px-6 py-12">

  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">

    <div>

      <Logo />

      <p className="mt-3 text-slate-400 max-w-md">
        Shared operational visibility for modern residential property chains.
      </p>

    </div>

    <div className="flex flex-wrap gap-6 text-slate-400">

      <Link
        href="/"
        className="hover:text-white transition"
      >
        Home
      </Link>

      <Link
        href="/dashboard"
        className="hover:text-white transition"
      >
        Dashboard
      </Link>

      <Link
        href="/start-move"
        className="hover:text-white transition"
      >
        Start Move
      </Link>

      <Link
        href="/join-chain"
        className="hover:text-white transition"
      >
        Join Chain
      </Link>

    </div>

  </div>

  <div className="mt-10 pt-8 border-t border-slate-800 text-slate-500 text-sm">

    © 2026 Keynetic. All rights reserved.

  </div>

</div>

</footer>
    </main>
  );
}

