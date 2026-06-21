import Link from "next/link";

import { PAGE_BG_CLASS } from "@/lib/theme/themeTokens";

import { BrandThemeScope } from "@/components/theme/BrandThemeScope";
import { BrandingReviewShowcase } from "@/components/theme/BrandingReviewShowcase";
import { BRAND_THEMES } from "@/lib/theme/themes";

export const metadata = {
  title: "Branding Review | Keynetic",
  description:
    "Side-by-side comparison of Keynetic brand theme explorations.",
};

export default function BrandingReviewPage() {
  return (
    <main className={PAGE_BG_CLASS}>
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-10">
        <div className="mb-10">
          <Link
            href="/"
            className="text-sm font-semibold text-brand-link hover:text-brand-link-hover"
          >
            ← Back to app
          </Link>

          <h1 className="mt-4 text-3xl md:text-4xl font-bold text-slate-900">
            Branding Review
          </h1>

          <p className="mt-3 text-slate-600 max-w-3xl">
            Compare three brand directions side-by-side. Use the floating
            theme switcher (development / preview only) to preview a single
            theme across the full application without rebuilding.
          </p>

          <div className="mt-6 flex flex-wrap gap-4">
            {Object.values(BRAND_THEMES).map((theme) => (
              <div
                key={theme.id}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
              >
                <span
                  className="h-5 w-5 rounded-full border border-slate-200"
                  style={{
                    background: `linear-gradient(135deg, ${theme.primary} 50%, ${theme.secondary} 50%)`,
                  }}
                  aria-hidden
                />
                <span className="font-semibold text-slate-900">
                  {theme.label}
                </span>
                <span className="text-slate-500">
                  {theme.primary} / {theme.secondary}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {Object.values(BRAND_THEMES).map((theme) => (
            <div key={theme.id} className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">
                  {theme.label}
                </h2>
                <code className="text-xs text-slate-500 hidden sm:inline">
                  {theme.id}
                </code>
              </div>

              <p className="text-sm text-slate-600 mb-4">
                {theme.description}
              </p>

              <BrandThemeScope themeId={theme.id}>
                <BrandingReviewShowcase />
              </BrandThemeScope>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
