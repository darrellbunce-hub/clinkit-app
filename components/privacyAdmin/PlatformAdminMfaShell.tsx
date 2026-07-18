"use client";

import LightShellHeader from "@/components/mobile/LightShellHeader";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import { ROUTES } from "@/lib/auth/routes";
import { PAGE_BG_CLASS } from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

export default function PlatformAdminMfaShell({
  children,
}: {
  children: React.ReactNode;
}) {
  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = ROUTES.homeownerLogin;
  }

  return (
    <main className={PAGE_BG_CLASS}>
      <LightShellHeader
        logoHref={ROUTES.privacyAdmin}
        links={[
          { href: ROUTES.platformAdminMfa, label: "MFA Status" },
          { href: ROUTES.accountSettings, label: "Account" },
        ]}
        trailing={
          <span className="hidden px-2 text-slate-500 lg:inline">
            Keynetic Privacy Admin
          </span>
        }
        onLogout={handleLogout}
      />
      <PageHeaderBand />
      <div className="mx-auto max-w-lg px-4 py-6 md:px-6 md:py-8">{children}</div>
    </main>
  );
}
