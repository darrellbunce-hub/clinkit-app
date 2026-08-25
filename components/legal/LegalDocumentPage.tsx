import Link from "next/link";

import type { LegalDocumentContent } from "@/lib/legal/documentTypes";
import {
  LEGAL_NAV_ITEMS,
  PRIVACY_EMAIL,
  PRIVACY_MAILTO,
} from "@/lib/legal/constants";
import {
  FOOTER_BG_CLASS,
  PAGE_BG_CLASS,
} from "@/lib/theme/themeTokens";

type LegalDocumentPageProps = {
  content: LegalDocumentContent;
  showEstateAgentTerms?: boolean;
};

export function LegalDocumentPage({
  content,
  showEstateAgentTerms = false,
}: LegalDocumentPageProps) {
  const navItems = LEGAL_NAV_ITEMS.filter(
    (item) =>
      showEstateAgentTerms || item.audience !== "estate-agent"
  );

  return (
    <main className={PAGE_BG_CLASS}>
      <div className="max-w-4xl mx-auto px-6 py-12 md:py-16">
        <nav aria-label="Legal documents" className="mb-10">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <header className="border-b border-slate-200 pb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900">
            {content.title}
          </h1>

          {content.subtitle ? (
            <p className="mt-4 text-lg text-slate-600 leading-relaxed">
              {content.subtitle}
            </p>
          ) : null}

          <p className="mt-4 text-sm text-slate-500">
            Last updated: {content.lastUpdated}
          </p>

          <p className="mt-2 text-sm text-slate-600">
            Privacy contact:{" "}
            <a
              href={PRIVACY_MAILTO}
              className="font-medium text-slate-900 underline underline-offset-2"
            >
              {PRIVACY_EMAIL}
            </a>
          </p>
        </header>

        <article className="mt-10 space-y-10">
          {content.sections.map((section) => (
            <section
              key={section.id ?? section.title}
              id={section.id}
              className="scroll-mt-8"
            >
              <h2 className="text-xl font-bold text-slate-900">
                {section.title}
              </h2>

              {section.paragraphs?.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 48)}
                  className="mt-4 text-slate-700 leading-relaxed"
                >
                  {paragraph}
                </p>
              ))}

              {section.bullets ? (
                <ul className="mt-4 list-disc space-y-2 pl-5 text-slate-700 leading-relaxed">
                  {section.bullets.map((bullet) => (
                    <li key={bullet.slice(0, 48)}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </article>

        <LegalPageFooter />
      </div>
    </main>
  );
}

type LegalFooterLinksProps = {
  className?: string;
  showEstateAgentTerms?: boolean;
  showPrivacyEmail?: boolean;
};

export function LegalFooterLinks({
  className = "",
  showEstateAgentTerms = false,
  showPrivacyEmail = true,
}: LegalFooterLinksProps) {
  const navItems = LEGAL_NAV_ITEMS.filter(
    (item) =>
      showEstateAgentTerms || item.audience !== "estate-agent"
  );

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="hover:text-white transition"
          >
            {item.label}
          </Link>
        ))}
      </div>

      {showPrivacyEmail ? (
        <p className="mt-4 text-sm">
          Privacy:{" "}
          <a
            href={PRIVACY_MAILTO}
            className="underline underline-offset-2 hover:text-white transition"
          >
            {PRIVACY_EMAIL}
          </a>
        </p>
      ) : null}
    </div>
  );
}

export function LegalPageFooter() {
  return (
    <footer className={`mt-16 rounded-3xl ${FOOTER_BG_CLASS} px-6 py-8`}>
      <LegalFooterLinks
        className="text-slate-400"
        showEstateAgentTerms
      />
    </footer>
  );
}
