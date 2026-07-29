"use client";

import { useEffect, useState } from "react";

import AccountNav from "@/components/account/AccountNav";
import { PAGE_TITLE_CLASS } from "@/components/mobileStandards";
import { PAGE_BG_CLASS } from "@/lib/theme/themeTokens";
import LegalPrivacySection from "@/components/account/LegalPrivacySection";
import ProfileSection from "@/components/account/ProfileSection";
import SecuritySection from "@/components/account/SecuritySection";
import SubscriptionSection from "@/components/account/SubscriptionSection";
import TeamMembersSection from "@/components/account/TeamMembersSection";
import Navbar from "@/components/Navbar";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import AgentShell from "@/components/agent/AgentShell";
import { getAccountType } from "@/lib/accountType";
import { isEstateAgent } from "@/lib/accountType";
import { fetchAuthenticatedProfileAccountFields } from "@/lib/currentUserContext";
import { supabase } from "@/lib/supabase";

const SECTION_LINKS = [
  { href: "#profile", label: "Profile" },
  { href: "#security", label: "Security" },
  { href: "#subscription", label: "Subscription" },
  { href: "#team", label: "Team Members" },
  { href: "#legal", label: "Legal & Privacy" },
] as const;

export default function AccountSettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(
    null
  );
  const [contactName, setContactName] = useState<
    string | null
  >(null);
  const [accountType, setAccountType] = useState<
    ReturnType<typeof getAccountType>
  >("homeowner");
  const [userId, setUserId] = useState<string | null>(
    null
  );

  useEffect(() => {
    async function loadAccount() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login?next=/account";

        return;
      }

      setEmail(user.email ?? null);
      setUserId(user.id);

      const profile =
        await fetchAuthenticatedProfileAccountFields(
          supabase,
          user.id
        );

      if (!profile) {
        window.location.href =
          "/login?error=profile_setup_failed&next=/account";

        return;
      }

      setContactName(profile.contact_name);
      setAccountType(
        getAccountType(profile)
      );

      setIsLoading(false);
    }

    void loadAccount();
  }, []);

  const content = (
    <div className="max-w-3xl mx-auto px-6 py-10 md:py-12">
      <AccountNav accountType={accountType} />

      <div className="mt-6">
        <h1 className={PAGE_TITLE_CLASS}>
          Account Settings
        </h1>

        <p className="mt-2 text-slate-600">
          Manage your profile, security, and privacy
          preferences.
        </p>
      </div>

      <nav
        aria-label="Account sections"
        className="mt-8 flex flex-wrap gap-2"
      >
        {(
          isEstateAgent({
            account_type: accountType,
          })
            ? SECTION_LINKS
            : SECTION_LINKS.filter(
                (link) =>
                  link.href !== "#team" &&
                  link.href !== "#subscription"
              )
        ).map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-full border border-slate-200 bg-white px-4 py-2.5 min-h-11 inline-flex items-center text-sm font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900 transition"
          >
            {link.label}
          </a>
        ))}
      </nav>

      {isLoading ? (
        <p className="mt-10 text-slate-600">
          Loading account details...
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          <ProfileSection
            accountType={accountType}
            contactName={contactName}
            email={email}
          />

          {email && (
            <SecuritySection email={email} />
          )}

          {isEstateAgent({
            account_type: accountType,
          }) &&
            userId && (
              <SubscriptionSection userId={userId} />
            )}

          {isEstateAgent({
            account_type: accountType,
          }) &&
            userId && (
              <TeamMembersSection userId={userId} />
            )}

          <LegalPrivacySection />
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <main className={PAGE_BG_CLASS}>
        <Navbar />
        <PageHeaderBand />
        <div className="max-w-3xl mx-auto px-6 py-12 text-slate-600">
          Loading account details...
        </div>
      </main>
    );
  }

  if (
    isEstateAgent({ account_type: accountType })
  ) {
    return <AgentShell>{content}</AgentShell>;
  }

  return (
    <main className={PAGE_BG_CLASS}>
      <Navbar />
      <PageHeaderBand />
      {content}
    </main>
  );
}
