"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  Eye,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import Logo from "@/components/Logo";
import { LegalFooterLinks } from "@/components/legal/LegalDocumentPage";
import { MARKETING_SECTION_TITLE_CLASS } from "@/components/mobileStandards";
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
  MARKETING_FEATURE_CARD_CLASS,
  MARKETING_FEATURE_ICON_CLASS,
  MARKETING_SECTION_GLOW_CLASS,
  MARKETING_STEP_ACCENT_BAR_CLASS,
  MARKETING_STEP_CARD_CLASS,
  MARKETING_STEP_NUMBER_CLASS,
  SECTION_BG_CLASS,
  SECTION_CONTENT_CLASS,
} from "@/lib/theme/themeTokens";
import type { EaFoundingPublicDisplay } from "@/lib/billing/eaFoundingAvailabilityShared";
import { EA_STANDARD_MONTHLY_LABEL } from "@/lib/billing/eaBranchPricing";

export type EaLandingPageProps = {
  foundingDisplay?: EaFoundingPublicDisplay | null;
};

const outcomes = [
  {
    icon: Users,
    title: "Collaboration from either side",
    text: "A homeowner may start their move and invite your branch — or your team may start and invite them. However the journey begins, connected participants share one chain view on Keynetic.",
  },
  {
    icon: Clock3,
    title: "Reduce chasing",
    text: "Designed to help reduce routine status calls. See what may need attention before the phone rings — whether your client started on Keynetic or your branch did.",
  },
  {
    icon: MessageSquare,
    title: "Improve communication",
    text: "Keep homeowners, negotiators and progressors aligned with one shared operational view of the transaction.",
  },
  {
    icon: Eye,
    title: "Shared operational visibility",
    text: "Everyone authorised on a transaction sees the same live picture of chain progress — no matter who initiated collaboration.",
  },
  {
    icon: Sparkles,
    title: "Better customer experience",
    text: "Give clients clarity and confidence. Homeowners can use Keynetic for free while your branch complements its existing CRM.",
  },
  {
    icon: Workflow,
    title: "Works alongside your CRM",
    text: "Keynetic is a collaborative coordination layer, not estate agency software. Your CRM stays your system of record.",
  },
];

const problems = [
  "Traditional tools assume the agency must adopt software before anyone else can benefit",
  "Homeowners wait for updates while agents chase progress across email and spreadsheets",
  "No single operational view when collaboration depends on one side signing up first",
  "CRM records the deal — but not live, shared chain coordination with the client",
  "Assuming the whole chain must connect before anyone benefits from visibility",
];

const solutions = [
  "Collaboration can begin from the homeowner or the estate agent",
  "Homeowners can use Keynetic independently and invite your branch when ready",
  "Your branch can create properties and invite clients — or join moves they started",
  "Connected participants share the same shared operational workspace, alongside your CRM",
  "Useful visibility begins with connected parts of the chain — and improves as more connects",
];

const entryPaths = [
  {
    number: "A",
    title: "Homeowner creates their move",
    text: "Your client sets up their property on Keynetic for free, tracks their transaction, and invites your branch to collaborate.",
  },
  {
    number: "B",
    title: "Estate agent creates the property",
    text: "Your branch originates the transaction, invites the homeowner, and works together from day one in the same workspace.",
  },
  {
    number: "→",
    title: "Shared chain view",
    text: "Whether a homeowner or your branch joins first, connected participants work from the same shared chain view — with clear communication and a full audit trail.",
  },
];

const pricingFeatures = [
  "Unlimited team members",
  "Unlimited properties",
  "Collaborate with homeowners already on Keynetic",
  "Command Centre & operational workspace",
  "Delegated updates with audit trail",
  "Founding price locked while subscription stays active",
];

const comingSoon = [
  {
    icon: BarChart3,
    title: "Branch analytics",
    text: "Operational health trends, stale-update alerts and branch-wide performance insight.",
  },
  {
    icon: Building2,
    title: "Regional operational insights",
    text: "Compare progression pace against regional operational insights — planned for a future release.",
  },
  {
    icon: ShieldCheck,
    title: "Enterprise reporting",
    text: "Exportable reporting packs for group leadership and compliance review.",
  },
  {
    icon: Users,
    title: "Multi-branch management",
    text: "Oversee several branches from one company-level operational view.",
  },
];

const faqs = [
  {
    title: "Can homeowners use Keynetic if my branch hasn't signed up?",
    text: "Yes. Homeowners can use Keynetic independently — creating their property for free, tracking their transaction, and inviting their estate agent to collaborate. Likewise, estate agents can create properties and invite homeowners. Keynetic is designed so collaboration can begin from either side.",
  },
  {
    title: "Does Keynetic replace our CRM?",
    text: "No. Keynetic is a collaborative operational layer for property transactions and chains — not estate agency software. Your CRM remains your system of record for contacts, listings and pipeline.",
  },
  {
    title: "What if a client invites us before we've registered?",
    text: "That's expected. Homeowners can start on Keynetic and invite your branch when they're ready. Register your branch so you're prepared to accept invitations and collaborate from the same shared workspace.",
  },
  {
    title: "Who can see transaction information?",
    text: "Access is property-scoped and permission-controlled. Homeowners see their transaction. Your branch sees properties you are assigned to or invited to. Updates are attributed and auditable.",
  },
  {
    title: "Can multiple staff work from one branch?",
    text: "Yes. Unlimited team members are included. Owners invite negotiators and progressors to share the same Command Centre and operational workspace.",
  },
  {
    title: "What does the founding branch offer include?",
    text: "The Professional founding offer is £99/month (normally £129/month), limited to the first 20 paying branches. Founding branches lock in £99/month for the duration of that branch's continuous subscription. A founding place is permanently consumed when secured and is not returned if the subscription later ends. Founding status is not transferable.",
  },
  {
    title: "Do homeowners need to pay?",
    text: "No. Homeowners can use Keynetic for free. When your branch collaborates on a transaction, homeowner access is included — whether they started the move or your team did.",
  },
  {
    title: "When does billing start?",
    text: "After your branch is registered, an authorised branch owner can start a monthly subscription through Stripe Checkout from the account subscription section. Keynetic may use Stripe test (Sandbox) mode during development and staging before Production charging is enabled. Founding rates apply only while founding places remain available under the first-20 offer.",
  },
  {
    title: "Does the whole chain need to be connected?",
    text: "No. Keynetic can provide useful operational visibility before every participant is connected. Connected parts of a chain can share progress from day one, and visibility improves as more of the chain connects. Keynetic only shows information for properties and participants connected to the platform.",
  },
];

function SectionIntro({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow?: string;
  title: string;
  description: string;
  align?: "center" | "left";
}) {
  const alignment =
    align === "center" ? "text-center mx-auto" : "text-left";

  return (
    <div className={`max-w-3xl ${alignment}`}>
      {eyebrow ? (
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-primary">
          {eyebrow}
        </p>
      ) : null}

      <h2
        className={`${eyebrow ? "mt-4" : ""} ${MARKETING_SECTION_TITLE_CLASS} leading-tight`}
      >
        {title}
      </h2>

      <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed">
        {description}
      </p>
    </div>
  );
}

export default function EaLandingPage({
  foundingDisplay = null,
}: EaLandingPageProps) {
  const display =
    foundingDisplay ??
    ({
      mode: "founding_available",
      priceLabel: "founding",
      placesRemaining: 20,
      headline: "£99/month — Founding Member Price",
      detail:
        "Founding places are limited to the first 20 branches. Your place is secured when you start Checkout — not by viewing this page.",
    } satisfies EaFoundingPublicDisplay);

  const isSecured = display.mode === "founding_secured";
  const showFoundingPrice = display.priceLabel === "founding";
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className={`absolute inset-0 ${HERO_GRADIENT_CLASS}`} />

        <div className="absolute inset-0 opacity-20">
          <svg
            className="w-full h-full"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line
              x1="8%"
              y1="24%"
              x2="34%"
              y2="40%"
              stroke="var(--brand-accent-line)"
              strokeWidth="1"
            />
            <line
              x1="34%"
              y1="40%"
              x2="62%"
              y2="18%"
              stroke="var(--brand-accent-line)"
              strokeWidth="1"
            />
            <line
              x1="62%"
              y1="18%"
              x2="88%"
              y2="36%"
              stroke="var(--brand-accent-line)"
              strokeWidth="1"
            />
            <circle
              cx="8%"
              cy="24%"
              r="3"
              fill="var(--brand-accent-node)"
            />
            <circle
              cx="34%"
              cy="40%"
              r="3"
              fill="var(--brand-accent-node)"
            />
            <circle
              cx="62%"
              cy="18%"
              r="3"
              fill="var(--brand-accent-node)"
            />
            <circle
              cx="88%"
              cy="36%"
              r="3"
              fill="var(--brand-accent-node)"
            />
          </svg>
        </div>

        <div className={HERO_GLOW_PRIMARY_CLASS} />
        <div className={HERO_GLOW_SECONDARY_CLASS} />

        <div className="relative max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className={HERO_BADGE_CLASS}>
                Collaborative property transactions
              </div>

              <h1 className="mt-8 text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight">
                One shared chain view —
                <span className="block text-brand-accent">
                  whether a homeowner or your branch joins first.
                </span>
              </h1>

              <p className="mt-8 text-lg md:text-xl text-slate-300 leading-relaxed max-w-xl">
                Keynetic is a collaborative platform — not estate agency
                software. Whether your client starts their move or your
                branch introduces a property, connected participants work
                from the same shared chain model — without replacing your CRM.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <Link
                  href={ROUTES.estateAgentSignup}
                  className={`${BTN_ACCENT_CLASS} hover:scale-[1.02] px-8 py-5 text-lg text-center inline-flex items-center justify-center gap-2`}
                >
                  Start your founding branch
                  <ArrowRight className="h-5 w-5" />
                </Link>

                <Link
                  href="#how-it-works"
                  className={`${BTN_GHOST_DARK_CLASS} px-8 py-5 text-lg text-center`}
                >
                  See how it works
                </Link>
              </div>

              <p className="mt-6 text-sm text-slate-400">
                Homeowners can start for free · Your branch complements
                your CRM · Collaboration begins from either side
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="bg-white/10 backdrop-blur-xl rounded-3xl border border-white/15 p-8 shadow-2xl"
            >
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                However a property journey begins
              </p>

              <ul className="mt-6 space-y-4">
                {outcomes.slice(0, 4).map((item) => (
                  <li
                    key={item.title}
                    className="flex items-start gap-3 text-slate-100"
                  >
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-accent" />
                    <span className="leading-relaxed">
                      <span className="font-semibold text-white">
                        {item.title}.
                      </span>{" "}
                      {item.text}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Problem vs solution */}
      <section className={SECTION_BG_CLASS}>
        <div className={SECTION_CONTENT_CLASS}>
          <SectionIntro
            eyebrow="Why Keynetic is different"
            title="Traditional tools wait for the agency. Keynetic meets everyone where the move starts."
            description="Most estate agency software assumes your branch must adopt first before homeowners benefit. Keynetic is a collaborative platform — homeowners and estate agents can each begin the journey, and connected participants converge on the same shared operational workspace."
            align="center"
          />

          <div className="mt-16 grid gap-8 lg:grid-cols-2">
            <div className="rounded-3xl border border-status-critical/20 bg-status-critical-soft/40 p-8 md:p-10">
              <div className="flex items-center gap-3">
                <XCircle className="h-8 w-8 text-status-critical" />
                <h3 className="text-2xl font-bold text-slate-900">
                  The old assumption
                </h3>
              </div>

              <ul className="mt-8 space-y-4">
                {problems.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-slate-700"
                  >
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-status-critical" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-status-success/20 bg-status-success-soft/50 p-8 md:p-10">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-status-success" />
                <h3 className="text-2xl font-bold text-slate-900">
                  The Keynetic model
                </h3>
              </div>

              <ul className="mt-8 space-y-4">
                {solutions.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-slate-700"
                  >
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-status-success" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="relative overflow-hidden">
        <div className={MARKETING_SECTION_GLOW_CLASS} />

        <div className={`${SECTION_CONTENT_CLASS} relative`}>
          <SectionIntro
            eyebrow="How it works"
            title="Collaboration starts wherever the move starts"
            description="Whether your client starts with Keynetic or your branch does, connected participants work from the same shared operational view — without replacing your CRM."
          />

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {entryPaths.map((step) => (
              <div
                key={step.title}
                className={MARKETING_STEP_CARD_CLASS}
              >
                <div className={MARKETING_STEP_ACCENT_BAR_CLASS} />

                <div className={MARKETING_STEP_NUMBER_CLASS}>
                  {step.number}
                </div>

                <h3 className="mt-6 text-2xl font-bold text-slate-900">
                  {step.title}
                </h3>

                <p className="mt-4 text-slate-600 leading-relaxed">
                  {step.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Partial chain value */}
      <section className="relative overflow-hidden">
        <div className={SECTION_CONTENT_CLASS}>
          <SectionIntro
            eyebrow="Partial chains"
            title="Operational visibility before the full chain is connected"
            description="Your branch can see progress across connected parts of a chain from day one. As more participants connect, the shared operational picture becomes more complete — without waiting for full-chain adoption."
          />

          <p className="mt-8 max-w-3xl mx-auto text-center text-lg text-slate-500 leading-relaxed">
            Keynetic cannot show updates for participants or properties that are not
            connected. That is normal — and connecting more of the chain over time
            strengthens branch-level visibility.
          </p>
        </div>
      </section>

      {/* Key benefits */}
      <section className="bg-surface-muted border-y border-surface-section-border">
        <div className={SECTION_CONTENT_CLASS}>
          <SectionIntro
            eyebrow="Outcomes that matter"
            title="A collaborative platform your branch and your clients both benefit from"
            description="Keynetic reduces chasing and improves communication — whether adoption begins with a homeowner inviting your branch or your team inviting a client."
          />

          <div className="mt-16 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {outcomes.map((benefit) => {
              const Icon = benefit.icon;

              return (
                <div
                  key={benefit.title}
                  className={MARKETING_FEATURE_CARD_CLASS}
                >
                  <Icon className={MARKETING_FEATURE_ICON_CLASS} />

                  <h3 className="mt-6 text-xl font-bold text-slate-900">
                    {benefit.title}
                  </h3>

                  <p className="mt-4 text-slate-600 leading-relaxed">
                    {benefit.text}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className={SECTION_BG_CLASS}>
        <div className={SECTION_CONTENT_CLASS}>
          <SectionIntro
            eyebrow="Pricing"
            title={
              isSecured
                ? "Professional — Branch Subscription"
                : "Professional — Founding Branch Offer"
            }
            description={
              isSecured
                ? "Collaborate on moves you start or moves your clients invite you to — with clear per-branch pricing."
                : "Register your branch to collaborate on moves you start or moves your clients invite you to — with founding pricing locked while your subscription stays active."
            }
          />

          <div className="mt-16 max-w-3xl mx-auto">
            <div className="relative overflow-hidden rounded-3xl border-2 border-brand-primary bg-surface-card p-8 md:p-10 shadow-xl shadow-brand-primary/10">
              <div className="absolute top-0 right-0 rounded-bl-2xl bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-on-primary">
                {isSecured
                  ? "Founding places secured"
                  : display.mode === "founding_securing"
                    ? "Being secured"
                    : "First 20 branches"}
              </div>

              <p className="text-sm font-semibold uppercase tracking-wide text-brand-primary">
                Professional
              </p>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <p className="text-5xl md:text-6xl font-bold text-slate-900">
                  {showFoundingPrice ? "£99" : "£129"}
                </p>
                <p className="pb-2 text-lg text-slate-500">/ month</p>
              </div>

              {showFoundingPrice ? (
                <p className="mt-2 text-slate-500">
                  <span className="line-through">{EA_STANDARD_MONTHLY_LABEL}</span>{" "}
                  founding branch rate
                </p>
              ) : (
                <p className="mt-2 text-slate-500">
                  Per branch · billed monthly
                </p>
              )}

              <p className="mt-4 text-base font-semibold text-slate-900">
                {display.headline}
              </p>

              <p className="mt-3 text-slate-600 leading-relaxed">
                {display.detail}
              </p>

              {display.mode === "founding_available" ? (
                <p className="mt-4 text-sm font-medium text-brand-primary">
                  {display.placesRemaining === 1
                    ? "1 founding place remaining"
                    : `${display.placesRemaining} founding places remaining`}
                </p>
              ) : null}

              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {pricingFeatures.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 text-slate-700"
                  >
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-status-success" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <Link
                  href={ROUTES.estateAgentSignup}
                  className={`${BTN_PRIMARY_CLASS} px-8 py-4 text-center text-lg`}
                >
                  Register your branch
                </Link>

                <Link
                  href={ROUTES.estateAgentLogin}
                  className={`${BTN_SECONDARY_OUTLINE_CLASS} px-8 py-4 text-center text-lg`}
                >
                  Agency login
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Coming soon */}
      <section className="relative overflow-hidden">
        <div className={SECTION_CONTENT_CLASS}>
          <SectionIntro
            eyebrow="Roadmap"
            title="Coming soon for growing agency groups"
            description="The founding branch offer unlocks today's operational workspace. These capabilities are on the roadmap for agencies scaling beyond a single branch."
          />

          <div className="mt-16 grid gap-6 md:grid-cols-2">
            {comingSoon.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.title}
                  className={`${MARKETING_FEATURE_CARD_CLASS} border-dashed`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-8 w-8 text-brand-primary" />
                    <span className="rounded-full bg-surface-mist px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Coming soon
                    </span>
                  </div>

                  <h3 className="mt-5 text-xl font-bold text-slate-900">
                    {item.title}
                  </h3>

                  <p className="mt-3 text-slate-600 leading-relaxed">
                    {item.text}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section
        id="faq"
        className="bg-surface-muted border-t border-surface-section-border"
      >
        <div className="max-w-5xl mx-auto px-6 py-24">
          <SectionIntro
            eyebrow="FAQ"
            title="Questions estate agents ask before they start"
            description="Straight answers on how Keynetic's two-sided collaboration model fits alongside your CRM and your clients."
          />

          <div className="mt-16 space-y-6">
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

      {/* Final CTA */}
      <section className="bg-surface-section border-t border-surface-section-border">
        <div className="max-w-5xl mx-auto px-6 py-24 text-center">
          <h2
            className={`${MARKETING_SECTION_TITLE_CLASS} leading-tight`}
          >
            Be ready to collaborate — however the invitation arrives
          </h2>

          <p className="mt-8 text-xl text-slate-600 leading-relaxed max-w-3xl mx-auto">
            Join Keynetic as a founding branch and be prepared whether your
            team introduces a property or a client invites you in. Connected
            participants share one chain view on Keynetic.
          </p>

          <div className="mt-12 flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href={ROUTES.estateAgentSignup}
              className={`${BTN_PRIMARY_CLASS} hover:scale-[1.02] transition-all duration-300 px-8 py-5 text-lg`}
            >
              Start your founding branch
            </Link>

            <Link
              href={ROUTES.estateAgentLogin}
              className={`${BTN_SECONDARY_OUTLINE_CLASS} px-8 py-5 text-lg`}
            >
              Log in to your agency
            </Link>
          </div>

          <p className="mt-6 text-sm text-slate-500">
            £99/month founding offer (first 20 branches) · Homeowners start
            free · Your CRM stays in place
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className={FOOTER_BG_CLASS}>
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
            <div>
              <Logo variant="dark" showTagline />

              <p className="mt-3 text-slate-400 max-w-md">
                A collaborative platform for property transactions.
                One shared chain view as participants connect.
              </p>
            </div>

            <div className="flex flex-wrap gap-6 text-slate-400 text-sm">
              <Link
                href="#how-it-works"
                className="hover:text-white transition"
              >
                How it works
              </Link>

              <Link
                href="#pricing"
                className="hover:text-white transition"
              >
                Pricing
              </Link>

              <Link
                href="#faq"
                className="hover:text-white transition"
              >
                FAQ
              </Link>

              <Link
                href={ROUTES.estateAgentLogin}
                className="hover:text-white transition"
              >
                Log in
              </Link>

              <Link
                href={ROUTES.estateAgentSignup}
                className="hover:text-white transition"
              >
                Sign up
              </Link>
            </div>
          </div>

          <LegalFooterLinks
            className="mt-10 text-slate-400"
            showEstateAgentTerms
          />

          <p className="mt-10 text-sm text-slate-500">
            © {new Date().getFullYear()} Keynetic. Collaboration that
            begins from either side.
          </p>
        </div>
      </footer>
    </>
  );
}
