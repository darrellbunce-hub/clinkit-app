import Link from "next/link";

import Navbar from "@/components/Navbar";
import EvidenceSection from "@/components/marketing/EvidenceSection";
import { LegalFooterLinks } from "@/components/legal/LegalDocumentPage";
import { MARKETING_SECTION_TITLE_CLASS } from "@/components/mobileStandards";
import {
  HOME_BUYING_REFORM_ROADMAP_TITLE,
  HOME_BUYING_REFORM_ROADMAP_URL,
} from "@/lib/marketing/homeBuyingEvidence";
import { ROUTES } from "@/lib/auth/routes";
import {
  BTN_ACCENT_CLASS,
  BTN_PRIMARY_CLASS,
  BTN_SECONDARY_OUTLINE_CLASS,
  FOOTER_BG_CLASS,
  HERO_BADGE_CLASS,
  HERO_GLOW_PRIMARY_CLASS,
  HERO_GLOW_SECONDARY_CLASS,
  HERO_GRADIENT_CLASS,
  HERO_TITLE_CLASS,
  MARKETING_FEATURE_CARD_CLASS,
  PAGE_BG_CLASS,
  SECTION_BG_CLASS,
  SECTION_CONTENT_CLASS,
} from "@/lib/theme/themeTokens";

const beliefs = [
  "We believe people should be able to understand the journey they're part of.",
  "We believe better visibility helps homeowners stay informed.",
  "We believe estate agents should spend more time helping clients and less time chasing information.",
  "We believe technology should support property professionals, not try to replace them.",
  "And we believe that even when certainty isn't possible, clarity should be.",
];

export default function AboutPage() {
  return (
    <main className={PAGE_BG_CLASS}>
      <Navbar />

      <section className="relative overflow-hidden">
        <div className={`absolute inset-0 ${HERO_GRADIENT_CLASS}`} />
        <div className={HERO_GLOW_PRIMARY_CLASS} />
        <div className={HERO_GLOW_SECONDARY_CLASS} />

        <div className="relative mx-auto max-w-4xl px-6 py-16 md:py-24 text-center">
          <div className={`${HERO_BADGE_CLASS} mx-auto w-fit`}>
            Why Keynetic?
          </div>

          <h1 className={`mt-6 ${HERO_TITLE_CLASS}`}>
            Moving home will always have uncertainty.
            <span className="mt-2 block">
              Being kept in the dark shouldn&apos;t be part of it.
            </span>
          </h1>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 md:py-20">
        <h2 className={MARKETING_SECTION_TITLE_CLASS}>Why we exist</h2>

        <p className="mt-6 text-lg text-slate-600 leading-relaxed">
          Keynetic exists to bring clarity to one of life&apos;s biggest moves.
        </p>

        <p className="mt-4 text-slate-600 leading-relaxed">
          Buying or selling a home involves buyers, sellers, estate agents,
          conveyancers, lenders and often interconnected transactions. Everyone
          works towards the same outcome, but information can be fragmented
          across businesses, systems, emails and phone calls.
        </p>

        <blockquote className="mt-8 rounded-3xl border border-surface-card-border bg-surface-muted px-6 py-6 text-lg font-semibold text-slate-900">
          &ldquo;The result isn&apos;t simply inconvenience. It&apos;s
          uncertainty.&rdquo;
        </blockquote>
      </section>

      <EvidenceSection showKeyInsight={false} />

      <section className={`${SECTION_BG_CLASS} border-t-0`}>
        <div className={SECTION_CONTENT_CLASS}>
          <div className="max-w-4xl mx-auto">
            <h2 className={MARKETING_SECTION_TITLE_CLASS}>The problem</h2>

            <p className="mt-6 text-slate-600 leading-relaxed">
              The UK Government&apos;s June 2026 home buying and selling reform
              roadmap identifies limited transparency and fragmented processes as
              part of a wider challenge in residential property moves. The
              evidence above validates the problem Keynetic is addressing — it
              does not mean Keynetic has been government endorsed.
            </p>

            <p className="mt-4 text-sm text-slate-500">
              Read the{" "}
              <Link
                href={HOME_BUYING_REFORM_ROADMAP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-primary underline underline-offset-2 hover:text-brand-primary-hover"
              >
                {HOME_BUYING_REFORM_ROADMAP_TITLE}
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 md:py-20">
        <h2 className={MARKETING_SECTION_TITLE_CLASS}>What we believe</h2>

        <ul className="mt-8 space-y-4">
          {beliefs.map((belief) => (
            <li
              key={belief}
              className={`${MARKETING_FEATURE_CARD_CLASS} py-5 text-slate-700 leading-relaxed`}
            >
              {belief}
            </li>
          ))}
        </ul>
      </section>

      <section className={`${SECTION_BG_CLASS} border-t-0`}>
        <div className={SECTION_CONTENT_CLASS}>
          <div className="max-w-4xl mx-auto">
            <h2 className={MARKETING_SECTION_TITLE_CLASS}>
              What Keynetic isn&apos;t
            </h2>

            <p className="mt-6 text-lg text-slate-600 leading-relaxed">
              Keynetic doesn&apos;t sell certainty.
            </p>

            <ul className="mt-6 space-y-3 text-slate-700 leading-relaxed">
              <li>We can&apos;t guarantee a completion date.</li>
              <li>We can&apos;t prevent every chain from breaking.</li>
              <li>We can&apos;t remove every delay.</li>
              <li>
                And we don&apos;t replace your estate agent or conveyancer.
              </li>
            </ul>

            <p className="mt-8 text-xl font-semibold text-slate-900">
              We make the journey easier to see.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link
                href="/start-move"
                className={`${BTN_ACCENT_CLASS} px-8 py-4 text-center text-lg`}
              >
                Start Your Move
              </Link>

              <Link
                href={ROUTES.estateAgentMarketing}
                className={`${BTN_PRIMARY_CLASS} px-8 py-4 text-center text-lg`}
              >
                Estate agent overview
              </Link>

              <Link
                href="/join-chain"
                className={`${BTN_SECONDARY_OUTLINE_CLASS} px-8 py-4 text-center text-lg`}
              >
                Join Existing Chain
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className={FOOTER_BG_CLASS}>
        <div className="max-w-6xl mx-auto px-6 py-12">
          <LegalFooterLinks className="text-slate-400" />

          <div className="mt-10 pt-8 border-t border-slate-800 text-slate-500 text-sm">
            © 2026 Keynetic. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}
