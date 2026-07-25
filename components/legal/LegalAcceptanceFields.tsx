import Link from "next/link";

import { LEGAL_ROUTES } from "@/lib/legal/constants";

type LegalAcceptanceFieldsProps = {
  variant: "homeowner" | "estate-agent";
  termsAccepted: boolean;
  privacyAccepted: boolean;
  onTermsAcceptedChange: (accepted: boolean) => void;
  onPrivacyAcceptedChange: (accepted: boolean) => void;
  disabled?: boolean;
};

const TERMS_LINK_CLASS =
  "font-semibold text-slate-900 underline underline-offset-2 hover:text-brand-primary";

export default function LegalAcceptanceFields({
  variant,
  termsAccepted,
  privacyAccepted,
  onTermsAcceptedChange,
  onPrivacyAcceptedChange,
  disabled = false,
}: LegalAcceptanceFieldsProps) {
  const termsHref =
    variant === "homeowner"
      ? LEGAL_ROUTES.terms
      : LEGAL_ROUTES.estateAgentTerms;

  const termsLabel =
    variant === "homeowner"
      ? "Terms of Use"
      : "Estate Agent Terms";

  return (
    <fieldset
      className="space-y-3 rounded-2xl border border-surface-card-border bg-slate-50 px-4 py-4"
      disabled={disabled}
    >
      <legend className="sr-only">
        Legal acceptance required to create an account
      </legend>

      <label className="flex items-start gap-3 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(event) =>
            onTermsAcceptedChange(event.target.checked)
          }
          disabled={disabled}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary/25"
        />

        <span>
          I agree to the{" "}
          <Link
            href={termsHref}
            target="_blank"
            rel="noopener noreferrer"
            className={TERMS_LINK_CLASS}
          >
            {termsLabel}
          </Link>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={privacyAccepted}
          onChange={(event) =>
            onPrivacyAcceptedChange(event.target.checked)
          }
          disabled={disabled}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary/25"
        />

        <span>
          I agree to the{" "}
          <Link
            href={LEGAL_ROUTES.privacy}
            target="_blank"
            rel="noopener noreferrer"
            className={TERMS_LINK_CLASS}
          >
            Privacy Policy
          </Link>
        </span>
      </label>
    </fieldset>
  );
}
