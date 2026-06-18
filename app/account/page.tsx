"use client";

import { useEffect, useState } from "react";

import AccountNav from "@/components/account/AccountNav";
import { PAGE_TITLE_CLASS } from "@/components/mobileStandards";
import LegalPrivacySection from "@/components/account/LegalPrivacySection";
import ProfileSection from "@/components/account/ProfileSection";
import SecuritySection from "@/components/account/SecuritySection";
import Navbar from "@/components/Navbar";
import AgentShell from "@/components/agent/AgentShell";
import { getAccountType } from "@/lib/accountType";
import { isEstateAgent } from "@/lib/accountType";
import { fetchProfileAccountFields } from "@/lib/currentUserContext";
import { supabase } from "@/lib/supabase";

const SECTION_LINKS = [
  { href: "#profile", label: "Profile" },
  { href: "#security", label: "Security" },
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

      const profile =
        await fetchProfileAccountFields(
          supabase,
          user.id
        );

      if (profile) {
        setContactName(profile.contact_name);
        setAccountType(
          getAccountType(profile)
        );
      }

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
        {SECTION_LINKS.map((link) => (
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

          <LegalPrivacySection />
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-100">
        <Navbar />
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
    <main className="min-h-screen bg-slate-100">
      <Navbar />
      {content}
    </main>
  );
}
