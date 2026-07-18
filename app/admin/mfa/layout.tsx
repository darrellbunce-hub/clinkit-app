import PlatformAdminMfaShell from "@/components/privacyAdmin/PlatformAdminMfaShell";

export default function PlatformAdminMfaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PlatformAdminMfaShell>{children}</PlatformAdminMfaShell>;
}
