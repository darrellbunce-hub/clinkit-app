"use client";

import Link from "next/link";

import { ROUTES } from "@/lib/auth/routes";
import { isEstateAgent } from "@/lib/accountType";
import type { AccountType } from "@/lib/accountType";

type AccountNavProps = {
  accountType: AccountType;
};

export default function AccountNav({
  accountType,
}: AccountNavProps) {
  const homeHref = isEstateAgent({
    account_type: accountType,
  })
    ? ROUTES.agentHome
    : ROUTES.homeownerDashboard;

  const homeLabel = isEstateAgent({
    account_type: accountType,
  })
    ? "Agent Home"
    : "Dashboard";

  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-slate-600">
      <Link
        href={homeHref}
        className="hover:text-slate-900 transition"
      >
        {homeLabel}
      </Link>

      <span className="text-slate-300" aria-hidden>
        /
      </span>

      <span className="text-slate-900">
        Account Settings
      </span>
    </nav>
  );
}
