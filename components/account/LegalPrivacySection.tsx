import Link from "next/link";

import { accountSectionClassName } from "@/components/account/accountStyles";
import {
  LEGAL_NAV_ITEMS,
  LEGAL_ROUTES,
  PRIVACY_EMAIL,
  PRIVACY_MAILTO,
} from "@/lib/legal/constants";

const POLICY_LINKS = LEGAL_NAV_ITEMS.filter(
  (item) => item.href !== LEGAL_ROUTES.estateAgentTerms
);

export default function LegalPrivacySection() {
  return (
    <section
      id="legal"
      className={accountSectionClassName}
    >
      <div className="max-w-xl">
        <h2 className="text-xl font-bold text-slate-900">
          Legal &amp; Privacy
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Policy documents and privacy information for Keynetic
          users.
        </p>

        <ul className="mt-6 space-y-3">
          {POLICY_LINKS.map((policy) => (
            <li key={policy.href}>
              <Link
                href={policy.href}
                className="block rounded-2xl border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <p className="font-medium text-slate-900">
                  {policy.label}
                </p>
              </Link>
            </li>
          ))}

          <li>
            <Link
              href={LEGAL_ROUTES.estateAgentTerms}
              className="block rounded-2xl border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <p className="font-medium text-slate-900">
                Estate Agent Terms of Service
              </p>

              <p className="mt-1 text-sm text-slate-600">
                For estate agent branch subscriptions.
              </p>
            </Link>
          </li>
        </ul>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5">
          <h3 className="font-semibold text-slate-900">
            Request deletion of your personal data
          </h3>

          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            You can request deletion of your personal data under
            applicable data protection law. Requests are handled
            through Keynetic&apos;s privacy process — this is not
            instant self-service deletion.
          </p>

          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            Leaving a transaction in the app is separate from
            requesting erasure. See our{" "}
            <Link
              href={LEGAL_ROUTES.privacy}
              className="font-medium text-slate-900 underline underline-offset-2"
            >
              Privacy Policy
            </Link>{" "}
            for details.
          </p>

          <p className="mt-4">
            <a
              href={PRIVACY_MAILTO}
              className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Email {PRIVACY_EMAIL}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
