import Link from "next/link";

import { helpHref, type HelpSectionId } from "@/lib/help/helpContent";

type HelpLinkProps = {
  section?: HelpSectionId;
  /** Use where leaving the page would lose what the user has entered. */
  newTab?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export default function HelpLink({
  section,
  newTab = false,
  className = "font-medium text-slate-900 underline underline-offset-2 hover:text-slate-700",
  children = "Help & FAQs",
}: HelpLinkProps) {
  return (
    <Link
      href={helpHref(section)}
      className={className}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
      {newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </Link>
  );
}
