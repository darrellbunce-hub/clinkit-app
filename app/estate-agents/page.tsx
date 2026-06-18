import Link from "next/link";

import EaMarketingShell from "@/components/estate-agents/EaMarketingShell";
import { MARKETING_SECTION_TITLE_CLASS } from "@/components/mobileStandards";
import { ROUTES } from "@/lib/auth/routes";

const benefits = [
  {
    title: "Transaction visibility",
    text: "See operational progress on properties your branch is assigned to, without replacing your CRM.",
  },
  {
    title: "Property-level coordination",
    text: "Assignments are scoped to individual properties, preserving homeowner privacy across the chain.",
  },
  {
    title: "Delegated updates with audit trail",
    text: "Support less-engaged clients while keeping every update clearly attributed.",
  },
];

export default function EstateAgentsPage() {
  return (
    <EaMarketingShell>
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            For estate agents
          </p>

          <h1 className={`mt-4 ${MARKETING_SECTION_TITLE_CLASS} leading-tight`}>
            Operational visibility across your property transactions
          </h1>

          <p className="mt-6 text-xl text-slate-600 leading-relaxed">
            Keynetic gives estate agents a calm, privacy-safe view of chain
            progress on the properties you serve — with full auditability when
            you update on a client&apos;s behalf.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              href={ROUTES.estateAgentSignup}
              className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-semibold text-center hover:bg-slate-800"
            >
              Sign Up
            </Link>

            <Link
              href={ROUTES.estateAgentLogin}
              className="border border-slate-300 bg-white text-slate-900 px-8 py-4 rounded-2xl font-semibold text-center hover:bg-slate-50"
            >
              Login
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {benefits.map((benefit) => (
            <div
              key={benefit.title}
              className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm"
            >
              <h2 className="text-xl font-bold text-slate-900">
                {benefit.title}
              </h2>

              <p className="mt-4 text-slate-600 leading-relaxed">
                {benefit.text}
              </p>
            </div>
          ))}
        </div>

        <div
          id="pricing"
          className="mt-16 bg-white rounded-3xl border border-slate-200 p-8 shadow-sm"
        >
          <h2 className="text-3xl font-bold text-slate-900">
            Pricing
          </h2>

          <p className="mt-4 text-slate-600 leading-relaxed max-w-2xl">
            Branch-based plans for independent agencies and multi-branch
            organisations. Billing is coming in a later release — register
            your agency now to set up your company and first branch.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              "Solo branch agencies",
              "Multi-branch regional firms",
              "Larger agency groups",
            ].map((tier) => (
              <div
                key={tier}
                className="rounded-2xl border border-dashed border-slate-300 px-6 py-5 text-slate-700"
              >
                {tier}
              </div>
            ))}
          </div>
        </div>
      </section>
    </EaMarketingShell>
  );
}
