"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Building2,
  Clock3,
  Home,
  Link2,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";

import Navbar from "@/components/Navbar";
import Logo from "@/components/Logo";
import { LegalFooterLinks } from "@/components/legal/LegalDocumentPage";
import EvidenceSection from "@/components/marketing/EvidenceSection";
import HeroChainIllustration from "@/components/marketing/HeroChainIllustration";
import { HomepageBenefitStrip } from "@/components/marketing/HomepageBenefitStrip";
import TrustPositioningSection from "@/components/marketing/TrustPositioningSection";
import { MARKETING_SECTION_TITLE_CLASS } from "@/components/mobileStandards";
import {
  EA_STANDARD_DAILY_LABEL,
  EA_STANDARD_MONTHLY_LABEL,
} from "@/lib/marketing/eaPricing";
import { ROUTES } from "@/lib/auth/routes";
import {
  BTN_ACCENT_CLASS,
  BTN_GHOST_DARK_CLASS,
  BTN_PRIMARY_CLASS,
  BTN_SECONDARY_OUTLINE_CLASS,
  FOOTER_BG_CLASS,
  HERO_BADGE_CLASS,
  HERO_GLOW_PRIMARY_CLASS,
  HERO_GLOW_SECONDARY_CLASS,
  HERO_GRADIENT_CLASS,
  HERO_TITLE_CLASS,
  MARKETING_FEATURE_CARD_CLASS,
  MARKETING_FEATURE_ICON_CLASS,
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
    title: "Start Your Move",
    text: "Add your sale, purchase, or both to begin building your property chain on Keynetic.",
  },
  {
    number: 2,
    title: "Invite Others to Connect",
    text: "Share invitations so buyers, sellers and estate agents can connect their part of the chain.",
  },
  {
    number: 3,
    title: "Follow Live Shared Updates",
    text: "See progress, milestones and where attention may be needed across connected parts of the chain.",
  },
];

const homeownerBenefits = [
  "See where your move stands across connected parts of the chain",
  "Understand what's changed as updates are shared",
  "Follow how the connected chain is progressing",
  "Know what may need attention next — without independent verification",
  "Use Keynetic free as a homeowner",
];

const faqs = [
  {
    title: "What is Keynetic?",
    text: "Keynetic is a shared property chain coordination platform. It gives people involved in a move a clearer view of progress — working alongside estate agents' existing CRM systems, not replacing them.",
  },
  {
    title: "Who can use Keynetic?",
    text: "Homeowners, buyers and sellers participate in connected property chains. Estate agents use Keynetic alongside their existing CRM for operational visibility and coordination — see our estate agent pages to register your branch.",
  },
  {
    title: "Is Keynetic free for homeowners?",
    text: "Yes. Homeowners can use Keynetic at no cost. Estate agents use Keynetic for branch-level operational visibility across the chains they manage.",
  },
  {
    title: "Does the whole chain need to be connected?",
    text: "No. Keynetic can provide useful visibility before every participant is connected. Connected parts of the chain can share progress from day one, and visibility improves as more of the chain connects. Keynetic only shows updates for properties and participants connected to the platform.",
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
    title: "Does Keynetic replace my estate agent or conveyancer?",
    text: "No. Keynetic does not provide legal advice, independently verify progress, or guarantee that a chain will complete. It is a shared coordination tool — estate agents and conveyancers remain responsible for their professional roles.",
  },
  {
    title: "Is Keynetic available on mobile devices?",
    text: "Yes. Keynetic is designed to work across desktop, tablet and mobile devices.",
  },
];

export default function HomePage() {
  return (
    <main className={PAGE_BG_CLASS}>
      <Navbar />

      {/* 1. WHY / Hero */}
      <section className="relative overflow-hidden">
        <div className={`absolute inset-0 ${HERO_GRADIENT_CLASS}`} />

        <div className="absolute inset-0 opacity-20">
          <svg
            className="h-full w-full"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <line
              x1="10%"
              y1="20%"
              x2="40%"
              y2="35%"
              stroke="rgb(255 255 255 / 0.35)"
              strokeWidth="1"
            />
            <line
              x1="40%"
              y1="35%"
              x2="70%"
              y2="15%"
              stroke="rgb(255 255 255 / 0.35)"
              strokeWidth="1"
            />
            <line
              x1="70%"
              y1="15%"
              x2="90%"
              y2="30%"
              stroke="rgb(255 255 255 / 0.35)"
              strokeWidth="1"
            />

            <circle cx="10%" cy="20%" r="3" fill="var(--brand-accent-node)" />
            <circle cx="40%" cy="35%" r="3" fill="var(--brand-accent-node)" />
            <circle cx="70%" cy="15%" r="3" fill="var(--brand-accent-node)" />
            <circle cx="90%" cy="30%" r="3" fill="var(--brand-accent-node)" />
          </svg>
        </div>

        <div className={HERO_GLOW_PRIMARY_CLASS} />
        <div className={HERO_GLOW_SECONDARY_CLASS} />

        <div className="relative mx-auto max-w-6xl px-6 py-16 md:py-24 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
            >
              <div className={HERO_BADGE_CLASS}>
                Clarity through every move
              </div>

              <h1 className={`mt-6 md:mt-8 ${HERO_TITLE_CLASS}`}>
                Moving home will always have uncertainty.
                <span className="mt-2 block">
                  Being kept in the dark shouldn&apos;t be part of it.
                </span>
              </h1>

              <p className="mt-6 text-lg md:text-xl text-slate-200 leading-relaxed">
                Buying or selling a home is one of life&apos;s biggest moves. Yet
                once an offer is accepted, understanding what&apos;s happening
                across the property chain can become surprisingly difficult.
              </p>

              <p className="mt-4 text-base md:text-lg text-slate-300 leading-relaxed">
                Keynetic gives the people involved a clearer view of the journey
                they&apos;re already part of — without claiming to remove every
                delay or replace property professionals.
              </p>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <Link
                  href="/start-move"
                  className={`${BTN_ACCENT_CLASS} px-8 py-4 text-lg text-center hover:scale-[1.02]`}
                >
                  Start Your Move
                </Link>

                <Link
                  href="/join-chain"
                  className={`${BTN_GHOST_DARK_CLASS} px-8 py-4 text-lg text-center`}
                >
                  Join Existing Chain
                </Link>
              </div>

              <p className="mt-5 text-sm font-medium text-brand-accent">
                Free for homeowners.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <HeroChainIllustration />
            </motion.div>
          </div>
        </div>
      </section>

      {/* 2–3. Evidence + key insight */}
      <EvidenceSection />

      {/* 4. WHAT Keynetic does */}
      <section className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className={MARKETING_SECTION_TITLE_CLASS}>
            Your Property Chain.
            <span className="block">One Shared View.</span>
          </h2>

          <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed">
            Estate agents, conveyancers, buyers and sellers are working towards
            the same move, but information can be spread across different people,
            businesses and systems.
          </p>

          <p className="mt-4 text-lg md:text-xl text-slate-600 leading-relaxed">
            Keynetic gives connected participants a clearer shared view of
            progress.
          </p>

          <p className="mt-8 text-xl md:text-2xl font-semibold text-slate-900 leading-snug">
            Everyone is working towards the same outcome.
            <span className="block text-brand-primary">
              Why can&apos;t everyone see the progress?
            </span>
          </p>
        </div>
      </section>

      {/* 5. HOW Keynetic works */}
      <section className={SECTION_BG_CLASS}>
        <div className={MARKETING_SECTION_GLOW_CLASS} />

        <div className={SECTION_CONTENT_CLASS}>
          <div className="text-center">
            <h2 className={MARKETING_SECTION_TITLE_CLASS}>
              How Keynetic Works
            </h2>

            <p className="mt-6 text-lg md:text-xl text-slate-600 max-w-3xl mx-auto">
              A shared platform for property chains — giving connected
              participants an up-to-date picture of progress as updates are
              shared.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3 md:gap-8">
            {steps.map((item) => (
              <motion.div
                key={item.number}
                whileHover={{ y: -8 }}
                transition={{ duration: 0.2 }}
                className={MARKETING_STEP_CARD_CLASS}
              >
                <div className={MARKETING_STEP_ACCENT_BAR_CLASS} />

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

      {/* Partial chain — adapted existing section */}
      <section className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-primary/10 text-brand-primary mb-6">
            <Link2 className="w-7 h-7" aria-hidden="true" />
          </div>

          <h2 className={MARKETING_SECTION_TITLE_CLASS}>
            Useful visibility before everyone is connected
          </h2>

          <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed">
            A property chain does not need to be fully connected before Keynetic
            becomes useful. Connected parts can share progress from day one —
            and visibility improves as more of the chain connects.
          </p>

          <p className="mt-4 text-base md:text-lg text-slate-500 leading-relaxed">
            Keynetic cannot show updates for participants or properties that are
            not connected to the platform. That is normal — and connecting more
            of the chain over time strengthens the shared view.
          </p>
        </div>
      </section>

      {/* Features — now answers the problem established above */}
      <section className={`${SECTION_BG_CLASS} border-t-0`}>
        <div className={SECTION_CONTENT_CLASS}>
          <div className="text-center">
            <h2 className={MARKETING_SECTION_TITLE_CLASS}>
              Built For Modern Property Chains
            </h2>

            <p className="mt-6 text-lg md:text-xl text-slate-600 max-w-3xl mx-auto">
              Clear visibility and structured updates for connected participants
              in the move — based on information shared on the platform.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3 md:gap-8">
            <div className={MARKETING_FEATURE_CARD_CLASS}>
              <TrendingUp className={MARKETING_FEATURE_ICON_CLASS} />

              <h3 className="mt-6 text-2xl font-bold text-slate-900">
                Chain Progress
              </h3>

              <p className="mt-4 text-slate-600 leading-relaxed">
                See how far connected parts of your chain have moved through
                tracked stages — separate from Chain Confidence and Estimated
                Completion.
              </p>
            </div>

            <div className={MARKETING_FEATURE_CARD_CLASS}>
              <AlertTriangle className="w-12 h-12 text-amber-500" />

              <h3 className="mt-6 text-2xl font-bold text-slate-900">
                Surface Delays Early
              </h3>

              <p className="mt-4 text-slate-600 leading-relaxed">
                Helps identify where progress may have stalled — so attention can
                be focused sooner, not after completion is already at risk.
              </p>
            </div>

            <div className={MARKETING_FEATURE_CARD_CLASS}>
              <ShieldCheck className={MARKETING_FEATURE_ICON_CLASS} />

              <h3 className="mt-6 text-2xl font-bold text-slate-900">
                Permission Controlled
              </h3>

              <p className="mt-4 text-slate-600 leading-relaxed">
                Participants can only update properties they are authorised to
                manage.
              </p>
            </div>

            <div className={MARKETING_FEATURE_CARD_CLASS}>
              <Home className={MARKETING_FEATURE_ICON_CLASS} />

              <h3 className="mt-6 text-2xl font-bold text-slate-900">
                Shared Visibility
              </h3>

              <p className="mt-4 text-slate-600 leading-relaxed">
                Buyers and sellers see a shared view of connected parts of the
                move.
              </p>
            </div>

            <div className={MARKETING_FEATURE_CARD_CLASS}>
              <Clock3 className="w-12 h-12 text-yellow-600" />

              <h3 className="mt-6 text-2xl font-bold text-slate-900">
                Live Shared Updates
              </h3>

              <p className="mt-4 text-slate-600 leading-relaxed">
                Reduce uncertainty with structured milestones and live updates as
                connected participants share progress.
              </p>
            </div>

            <div className={MARKETING_FEATURE_CARD_CLASS}>
              <Smartphone className="w-12 h-12 text-slate-700" />

              <h3 className="mt-6 text-2xl font-bold text-slate-900">
                Mobile Friendly
              </h3>

              <p className="mt-4 text-slate-600 leading-relaxed">
                Designed for homeowners following their move on any device.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Homeowner value */}
      <section className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="grid gap-12 items-center lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-primary">
              For homeowners
            </p>

            <h2 className={`mt-4 ${MARKETING_SECTION_TITLE_CLASS} leading-tight`}>
              Your home.
              <span className="block">Your money.</span>
              <span className="block">Your move.</span>
            </h2>

            <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed">
              You deserve to understand what&apos;s happening.
            </p>

            <p className="mt-4 text-slate-600 leading-relaxed">
              Moving home contains dependencies and delays outside any one
              person&apos;s control. Keynetic does not promise to eliminate those
              things — it provides greater visibility into where the move stands,
              what&apos;s changed, and how the connected chain is progressing.
            </p>

            <p className="mt-6 text-lg font-semibold text-brand-primary">
              More visibility. Less uncertainty.
            </p>

            <p className="mt-4 text-sm font-medium text-slate-700">
              Free for homeowners.
            </p>
          </div>

          <ul className="space-y-4">
            {homeownerBenefits.map((benefit) => (
              <li
                key={benefit}
                className={`${MARKETING_FEATURE_CARD_CLASS} flex items-start gap-4 py-5`}
              >
                <Home
                  className="mt-0.5 h-6 w-6 shrink-0 text-brand-primary"
                  aria-hidden="true"
                />
                <span className="text-slate-700 leading-relaxed">{benefit}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 7. Estate agent value */}
      <section className={`${SECTION_BG_CLASS} border-t-0`}>
        <div className={SECTION_CONTENT_CLASS}>
          <div className="grid gap-12 items-start lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-brand-primary">
                For estate agents
              </p>

              <h2 className={`mt-4 ${MARKETING_SECTION_TITLE_CLASS} leading-tight`}>
                Your clients want answers.
                <span className="block">You want to give them answers.</span>
              </h2>

              <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed">
                When information sits across buyers, sellers, other agents and
                conveyancers, keeping everyone informed can mean calls, emails and
                repeated chasing.
              </p>

              <p className="mt-4 text-slate-600 leading-relaxed">
                Keynetic gives the branch a shared operational view of the chains
                it is already progressing.
              </p>

              <p className="mt-6 text-lg font-semibold text-brand-primary">
                Less chasing. More knowing.
              </p>
            </div>

            <div className={`${MARKETING_FEATURE_CARD_CLASS} p-8 md:p-10`}>
              <Building2 className={MARKETING_FEATURE_ICON_CLASS} />

              <p className="mt-6 text-xl md:text-2xl font-semibold text-slate-900 leading-snug">
                A clearer view of every chain.
                <span className="mt-2 block text-brand-primary">
                  {EA_STANDARD_DAILY_LABEL}.
                </span>
              </p>

              <p className="mt-4 text-2xl font-bold text-slate-900">
                {EA_STANDARD_MONTHLY_LABEL}
              </p>

              <p className="mt-4 text-slate-600 leading-relaxed">
                If Keynetic saves your branch one unnecessary chase a day, what
                could that time be worth?
              </p>

              <ul className="mt-8 space-y-3 text-slate-700">
                <li className="flex items-start gap-3">
                  <Users
                    className="mt-1 h-5 w-5 shrink-0 text-brand-primary"
                    aria-hidden="true"
                  />
                  <span>Shared operational visibility across your branch</span>
                </li>
                <li className="flex items-start gap-3">
                  <TrendingUp
                    className="mt-1 h-5 w-5 shrink-0 text-brand-primary"
                    aria-hidden="true"
                  />
                  <span>Works alongside your existing CRM</span>
                </li>
                <li className="flex items-start gap-3">
                  <ShieldCheck
                    className="mt-1 h-5 w-5 shrink-0 text-brand-primary"
                    aria-hidden="true"
                  />
                  <span>Homeowners use Keynetic free when you collaborate</span>
                </li>
              </ul>

              <Link
                href={ROUTES.estateAgentMarketing}
                className={`${BTN_PRIMARY_CLASS} mt-8 inline-block px-6 py-4 text-center`}
              >
                Estate agent overview
              </Link>

              <p className="mt-4 text-sm text-slate-500">
                Founding branch pricing is available on our estate agent pages.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 8. Trust / positioning */}
      <TrustPositioningSection />

      <HomepageBenefitStrip />

      {/* FAQ */}
      <section className="bg-surface-muted border-t border-surface-section-border">
        <div className="max-w-5xl mx-auto px-6 py-20 md:py-24">
          <div className="text-center">
            <h2 className={MARKETING_SECTION_TITLE_CLASS}>
              Frequently Asked Questions
            </h2>

            <p className="mt-6 text-lg md:text-xl text-slate-600">
              Common questions about Keynetic and property chain coordination.
            </p>
          </div>

          <div className="mt-12 space-y-6">
            {faqs.map((faq) => (
              <div
                key={faq.title}
                className={`${MARKETING_FEATURE_CARD_CLASS} hover:-translate-y-1`}
              >
                <h3 className="text-xl md:text-2xl font-bold text-slate-900">
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

      {/* 9. Final CTA */}
      <section className="bg-surface-section border-t border-surface-section-border">
        <div className="max-w-5xl mx-auto px-6 py-20 md:py-24 text-center">
          <h2 className={`${MARKETING_SECTION_TITLE_CLASS} leading-tight`}>
            Ready For A Clearer View Of Your Move?
          </h2>

          <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-3xl mx-auto">
            Start your move for free — or join an existing chain — and get a
            shared view of progress across connected parts of your property
            chain.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href="/start-move"
              className={`${BTN_PRIMARY_CLASS} px-8 py-4 text-lg hover:scale-[1.02] transition-all duration-300`}
            >
              Start Your Move
            </Link>

            <Link
              href="/join-chain"
              className={`${BTN_SECONDARY_OUTLINE_CLASS} px-8 py-4 text-lg`}
            >
              Join Existing Chain
            </Link>
          </div>
        </div>
      </section>

      <footer className={FOOTER_BG_CLASS}>
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
            <div>
              <Logo variant="dark" showTagline />

              <p className="mt-3 text-slate-400 max-w-md">
                Property chain coordination for modern residential moves.
              </p>
            </div>

            <div className="flex flex-wrap gap-6 text-slate-400">
              <Link href="/" className="hover:text-white transition">
                Home
              </Link>

              <Link href="/about" className="hover:text-white transition">
                Why Keynetic?
              </Link>

              <Link href="/dashboard" className="hover:text-white transition">
                Dashboard
              </Link>

              <Link href="/start-move" className="hover:text-white transition">
                Start Move
              </Link>

              <Link href="/join-chain" className="hover:text-white transition">
                Join Chain
              </Link>

              <Link
                href={ROUTES.estateAgentMarketing}
                className="hover:text-white transition"
              >
                Estate Agents
              </Link>
            </div>
          </div>

          <LegalFooterLinks className="mt-8 text-slate-400" />

          <div className="mt-10 pt-8 border-t border-slate-800 text-slate-500 text-sm">
            © 2026 Keynetic. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}
