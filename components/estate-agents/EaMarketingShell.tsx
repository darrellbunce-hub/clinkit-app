import LightShellHeader from "@/components/mobile/LightShellHeader";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import { ROUTES } from "@/lib/auth/routes";
import { PAGE_BG_CLASS } from "@/lib/theme/themeTokens";

const marketingNavLinks = [
  {
    href: `${ROUTES.estateAgentMarketing}#how-it-works`,
    label: "How it works",
  },
  {
    href: `${ROUTES.estateAgentMarketing}#pricing`,
    label: "Pricing",
  },
  {
    href: `${ROUTES.estateAgentMarketing}#faq`,
    label: "FAQ",
  },
  {
    href: ROUTES.estateAgentLogin,
    label: "Login",
  },
  {
    href: ROUTES.estateAgentSignup,
    label: "Sign Up",
    primary: true,
  },
] as const;

export default function EaMarketingShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className={PAGE_BG_CLASS}>
      <LightShellHeader
        logoHref={ROUTES.home}
        links={[...marketingNavLinks]}
        showBrandTagline
      />

      <PageHeaderBand />

      {children}
    </main>
  );
}
