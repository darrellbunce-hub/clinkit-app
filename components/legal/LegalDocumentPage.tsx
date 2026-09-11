import Link from "next/link";

import { LegalMarkdown } from "@/components/legal/LegalMarkdown";
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
  markdown: string;
};

export function LegalDocumentPage({ markdown }: LegalDocumentPageProps) {
  return (
    <main className={PAGE_BG_CLASS}>
      <div className="mx-auto max-w-4xl px-6 py-12 md:py-16">
        <nav aria-label="Legal documents" className="mb-10">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {LEGAL_NAV_ITEMS.map((item) => (
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

        <p className="mb-8 text-sm text-slate-600">
          Privacy contact:{" "}
          <a
            href={PRIVACY_MAILTO}
            className="font-medium text-slate-900 underline underline-offset-2"
          >
            {PRIVACY_EMAIL}
          </a>
        </p>

        <LegalMarkdown markdown={markdown} />

        <LegalPageFooter />
      </div>
    </main>
  );
}

type LegalFooterLinksProps = {
  className?: string;
  showPrivacyEmail?: boolean;
};

export function LegalFooterLinks({
  className = "",
  showPrivacyEmail = true,
}: LegalFooterLinksProps) {
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {LEGAL_NAV_ITEMS.map((item) => (
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
      <LegalFooterLinks className="text-slate-400" />
    </footer>
  );
}
