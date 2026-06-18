import { accountSectionClassName } from "@/components/account/accountStyles";

const PLACEHOLDER_POLICIES = [
  {
    title: "Terms of Service",
    description:
      "Platform terms governing use of Keynetic.",
  },
  {
    title: "Privacy Policy",
    description:
      "How we collect, use, and protect your data.",
  },
  {
    title: "Cookie Policy",
    description:
      "Information about cookies and similar technologies.",
  },
  {
    title: "Data Retention Policy",
    description:
      "How long we retain transaction and account data.",
  },
  {
    title: "Account Deletion Request",
    description:
      "Process for requesting permanent account removal.",
  },
] as const;

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
          Policy documents and account controls will be
          published here before launch.
        </p>

        <ul className="mt-6 space-y-4">
          {PLACEHOLDER_POLICIES.map((policy) => (
            <li
              key={policy.title}
              className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4"
            >
              <p className="font-medium text-slate-900">
                {policy.title}
              </p>

              <p className="mt-1 text-sm text-slate-600">
                {policy.description}
              </p>

              <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Coming soon
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
