import type { Metadata } from "next";
import Link from "next/link";

import Navbar from "@/components/Navbar";
import { LegalFooterLinks } from "@/components/legal/LegalDocumentPage";
import {
  HELP_SECTION_IDS,
  HELP_SECTIONS,
  HELP_STATUS_LABELS,
  type HelpFaqItem,
  type HelpLink,
} from "@/lib/help/helpContent";
import {
  FOOTER_BG_CLASS,
  HERO_BADGE_CLASS,
  HERO_GLOW_PRIMARY_CLASS,
  HERO_GLOW_SECONDARY_CLASS,
  HERO_GRADIENT_CLASS,
  HERO_TITLE_CLASS,
  PAGE_BG_CLASS,
} from "@/lib/theme/themeTokens";

export const metadata: Metadata = {
  title: "Help & FAQs | MoveLoop",
  description:
    "Answers to common questions about starting or joining a property chain on MoveLoop, access codes, chain labels and privacy.",
};

const LINK_CLASS =
  "font-medium text-brand-primary underline underline-offset-2 hover:text-brand-primary-hover";

function AnswerLink({ link }: { link: HelpLink }) {
  if (link.href.startsWith("mailto:")) {
    return (
      <a href={link.href} className={LINK_CLASS}>
        {link.label}
      </a>
    );
  }

  return (
    <Link href={link.href} className={LINK_CLASS}>
      {link.label}
    </Link>
  );
}

function FaqItem({ item }: { item: HelpFaqItem }) {
  return (
    <details
      id={item.id}
      className="group scroll-mt-24 rounded-2xl border border-surface-card-border bg-surface-card"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-4 rounded-2xl px-5 py-4 text-left text-base font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden">
        <span>{item.question}</span>
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-xl leading-none text-slate-500 transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>

      <div className="space-y-3 px-5 pb-5 text-slate-700 leading-relaxed">
        {item.answer.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}

        {item.links?.length ? (
          <ul className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm">
            {item.links.map((link) => (
              <li key={link.href}>
                <AnswerLink link={link} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function StatusLabelList() {
  return (
    <dl className="mb-6 divide-y divide-surface-divider overflow-hidden rounded-2xl border border-surface-card-border bg-surface-card">
      {HELP_STATUS_LABELS.map((status) => (
        <div
          key={status.label}
          className="px-5 py-4 sm:grid sm:grid-cols-3 sm:gap-4"
        >
          <dt className="font-semibold text-slate-900">{status.label}</dt>
          <dd className="mt-1 text-slate-700 leading-relaxed sm:col-span-2 sm:mt-0">
            {status.meaning}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function HelpPage() {
  return (
    <main className={PAGE_BG_CLASS}>
      <Navbar />

      <section className="relative overflow-hidden">
        <div className={`absolute inset-0 ${HERO_GRADIENT_CLASS}`} />
        <div className={HERO_GLOW_PRIMARY_CLASS} />
        <div className={HERO_GLOW_SECONDARY_CLASS} />

        <div className="relative mx-auto max-w-4xl px-6 py-16 md:py-20 text-center">
          <div className={`${HERO_BADGE_CLASS} mx-auto w-fit`}>
            Help &amp; FAQs
          </div>

          <h1 className={`mt-6 ${HERO_TITLE_CLASS}`}>
            How can we help?
          </h1>

          <p className="mt-4 text-lg text-white/90">
            Answers to common questions about using MoveLoop.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-6 py-12 md:py-16">
        <nav
          aria-label="Help topics"
          className="rounded-2xl border border-surface-card-border bg-surface-card px-5 py-5"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Topics
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {HELP_SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex min-h-11 items-center text-slate-800 underline underline-offset-2 hover:text-brand-primary"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {HELP_SECTIONS.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-title`}
            className="mt-14 scroll-mt-24"
          >
            <h2
              id={`${section.id}-title`}
              className="text-2xl md:text-3xl font-bold text-slate-900"
            >
              {section.title}
            </h2>

            <div className="mt-6">
              {section.id === HELP_SECTION_IDS.statuses ? (
                <StatusLabelList />
              ) : null}

              <div className="space-y-3">
                {section.items.map((item) => (
                  <FaqItem key={item.id} item={item} />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>

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
