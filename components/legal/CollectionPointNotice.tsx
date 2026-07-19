import Link from "next/link";

import { LEGAL_ROUTES } from "@/lib/legal/constants";

type CollectionPointNoticeProps = {
  className?: string;
  context?: "homeowner" | "estate-agent" | "property-address";
};

const CONTEXT_COPY: Record<
  NonNullable<CollectionPointNoticeProps["context"]>,
  string
> = {
  homeowner:
    "We process the information you provide to create your account and provide the Keynetic service.",
  "estate-agent":
    "We process business and branch information you provide to register your agency and provide the Keynetic service.",
  "property-address":
    "We process property addresses and transaction details you enter to coordinate your chain on Keynetic. Other authorised chain participants may see relevant information.",
};

export default function CollectionPointNotice({
  className = "",
  context = "homeowner",
}: CollectionPointNoticeProps) {
  return (
    <p className={`text-sm text-slate-600 leading-relaxed ${className}`}>
      {CONTEXT_COPY[context]}{" "}
      <Link
        href={LEGAL_ROUTES.privacy}
        className="font-medium text-slate-900 underline underline-offset-2"
      >
        Privacy Policy
      </Link>
      .
    </p>
  );
}
