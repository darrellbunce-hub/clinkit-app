import LightShellHeader from "@/components/mobile/LightShellHeader";
import { ROUTES } from "@/lib/auth/routes";

const marketingNavLinks = [
  {
    href: ROUTES.estateAgentMarketing,
    label: "Estate Agents",
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
    <main className="min-h-screen bg-slate-100">
      <LightShellHeader
        logoHref={ROUTES.home}
        links={[...marketingNavLinks]}
      />

      {children}
    </main>
  );
}
