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
import {
  MARKETING_SECTION_TITLE_CLASS,
  PAGE_TITLE_INVERTED_CLASS,
  SECTION_TITLE_CLASS,
} from "@/components/mobileStandards";
import {
  BTN_ACCENT_CLASS,
  BTN_GHOST_DARK_CLASS,
  BTN_PRIMARY_CLASS,
  BTN_SECONDARY_OUTLINE_CLASS,
  FOOTER_BG_CLASS,
  GLASS_CARD_CLASS,
  HERO_BADGE_CLASS,
  HERO_GLOW_PRIMARY_CLASS,
  HERO_GLOW_SECONDARY_CLASS,
  HERO_GRADIENT_CLASS,
  MARKETING_FEATURE_CARD_CLASS,
  MARKETING_FEATURE_ICON_CLASS,
  MARKETING_METRIC_CARD_CLASS,
  MARKETING_SECTION_GLOW_CLASS,
  MARKETING_STEP_ACCENT_BAR_CLASS,
  MARKETING_STEP_CARD_CLASS,
  MARKETING_STEP_NUMBER_CLASS,
  PAGE_BG_CLASS,
  SECTION_BG_CLASS,
  SECTION_CONTENT_CLASS,
} from "@/lib/theme/themeTokens";
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
    <main className={PAGE_BG_CLASS}>
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden">

        {/* Background */}
        <div className={`absolute inset-0 ${HERO_GRADIENT_CLASS}`}></div>

        <div className="absolute inset-0 opacity-20">
          <svg
            className="w-full h-full"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line x1="10%" y1="20%" x2="40%" y2="35%" stroke="var(--brand-accent-line)" strokeWidth="1" />
            <line x1="40%" y1="35%" x2="70%" y2="15%" stroke="var(--brand-accent-line)" strokeWidth="1" />
            <line x1="70%" y1="15%" x2="90%" y2="30%" stroke="var(--brand-accent-line)" strokeWidth="1" />

            <circle cx="10%" cy="20%" r="3" fill="var(--brand-accent-node)" />
            <circle cx="40%" cy="35%" r="3" fill="var(--brand-accent-node)" />
            <circle cx="70%" cy="15%" r="3" fill="var(--brand-accent-node)" />
            <circle cx="90%" cy="30%" r="3" fill="var(--brand-accent-node)" />
          </svg>
        </div>

        <div className={HERO_GLOW_PRIMARY_CLASS}></div>

        <div className={HERO_GLOW_SECONDARY_CLASS}></div>

        <div className="relative max-w-6xl mx-auto px-6 py-28">
          <div className="grid lg:grid-cols-2 gap-16 items-center">

            {/* LEFT */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
            >
              <div className={HERO_BADGE_CLASS}>
                Live Property Chain Tracking
              </div>

              <h1 className={`mt-8 ${PAGE_TITLE_INVERTED_CLASS} leading-tight`}>
                Track Your Property Chain In Real Time
              </h1>

              <p className="mt-8 text-xl text-slate-300 leading-relaxed">
                Reduce uncertainty, delays and endless chasing during your home move with shared live chain progress tracking.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <Link
                  href="/start-move"
                  className={`${BTN_ACCENT_CLASS} hover:scale-[1.02] px-8 py-5 text-lg text-center`}
                >
                  Start Your Move
                </Link>

                <Link
                  href="/join-chain"
                  className={`${BTN_GHOST_DARK_CLASS} px-8 py-5 text-lg text-center`}
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
              className={`${GLASS_CARD_CLASS} p-10`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-300">
                    Chain Health
                  </p>

                  <h2 className={`mt-2 ${SECTION_TITLE_CLASS} text-white`}>
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
      <section className={SECTION_BG_CLASS}>

        <div className={MARKETING_SECTION_GLOW_CLASS}></div>

        <div className={SECTION_CONTENT_CLASS}>

          <div className="text-center">
            <h2 className={MARKETING_SECTION_TITLE_CLASS}>
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
                className={MARKETING_STEP_CARD_CLASS}
              >
                <div className={MARKETING_STEP_ACCENT_BAR_CLASS}></div>

                <div className={MARKETING_STEP_NUMBER_CLASS}>
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
          <h2 className={MARKETING_SECTION_TITLE_CLASS}>
            Built For Modern Property Chains
          </h2>

          <p className="mt-6 text-xl text-slate-600 max-w-3xl mx-auto">
            Operational visibility and structured updates for everyone involved in the move.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mt-16">

          <div className={MARKETING_FEATURE_CARD_CLASS}>
            <TrendingUp className={MARKETING_FEATURE_ICON_CLASS} />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Live Chain Progress
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Understand exactly where every property sits within the chain.
            </p>
          </div>

          <div className={MARKETING_FEATURE_CARD_CLASS}>
            <AlertTriangle className="w-12 h-12 text-amber-500" />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Bottleneck Detection
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Identify delays and stalled transactions before they impact completion.
            </p>
          </div>

          <div className={MARKETING_FEATURE_CARD_CLASS}>
            <ShieldCheck className="w-12 h-12 text-emerald-600" />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Permission Controlled
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Participants can only update properties they are authorised to manage.
            </p>
          </div>

          <div className={MARKETING_FEATURE_CARD_CLASS}>
            <Home className="w-12 h-12 text-green-700" />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Shared Visibility
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Buyers and sellers see a shared operational view of the move.
            </p>
          </div>

          <div className={MARKETING_FEATURE_CARD_CLASS}>
            <Zap className="w-12 h-12 text-yellow-500" />

            <h3 className="mt-6 text-2xl font-bold text-slate-900">
              Faster Decisions
            </h3>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Reduce uncertainty with structured milestones and real-time updates.
            </p>
          </div>

          <div className={MARKETING_FEATURE_CARD_CLASS}>
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
      <section className={`${SECTION_BG_CLASS} border-t-0`}>

        <div className="max-w-6xl mx-auto px-6 py-14">
          <div className="grid md:grid-cols-4 gap-8 text-center">

            <div className={MARKETING_METRIC_CARD_CLASS}>
              <h3 className={MARKETING_SECTION_TITLE_CLASS}>
                24/7
              </h3>

              <p className="mt-3 text-slate-600">
                Live chain visibility
              </p>
            </div>

            <div className={MARKETING_METRIC_CARD_CLASS}>
              <h3 className={MARKETING_SECTION_TITLE_CLASS}>
                Real-Time
              </h3>

              <p className="mt-3 text-slate-600">
                Shared transaction updates
              </p>
            </div>

            <div className={MARKETING_METRIC_CARD_CLASS}>
              <h3 className={MARKETING_SECTION_TITLE_CLASS}>
                Secure
              </h3>

              <p className="mt-3 text-slate-600">
                Permission controlled access
              </p>
            </div>

            <div className={MARKETING_METRIC_CARD_CLASS}>
              <h3 className={MARKETING_SECTION_TITLE_CLASS}>
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
      <section className="bg-surface-muted border-t border-surface-section-border">

        <div className="max-w-5xl mx-auto px-6 py-24">

          <div className="text-center">
            <h2 className={MARKETING_SECTION_TITLE_CLASS}>
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
                className={`${MARKETING_FEATURE_CARD_CLASS} hover:-translate-y-1`}
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
      <section className="bg-surface-section border-t border-surface-section-border">

        <div className="max-w-5xl mx-auto px-6 py-24 text-center">

          <h2 className={`${MARKETING_SECTION_TITLE_CLASS} leading-tight`}>
            Ready To Reduce Property Chain Stress?
          </h2>

          <p className="mt-8 text-xl text-slate-600 leading-relaxed max-w-3xl mx-auto">
            Join a smarter, more transparent way to manage property transactions and chain progression.
          </p>

          <div className="mt-12 flex flex-col sm:flex-row justify-center gap-4">

            <Link
              href="/start-move"
              className={`${BTN_PRIMARY_CLASS} hover:scale-[1.02] transition-all duration-300 px-8 py-5 text-lg`}
            >
              Start Your Move
            </Link>

            <Link
              href="/join-chain"
              className={`${BTN_SECONDARY_OUTLINE_CLASS} px-8 py-5 text-lg`}
            >
              Join Existing Chain
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
<footer className={FOOTER_BG_CLASS}>

<div className="max-w-6xl mx-auto px-6 py-12">

  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">

    <div>

      <Logo variant="dark" />

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

