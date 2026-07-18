import { notFound } from "next/navigation";

import { getPlatformAdminMembershipSession } from "@/lib/auth/platformAdmin";

export default async function PlatformAdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const membership = await getPlatformAdminMembershipSession();
  if (!membership) {
    notFound();
  }

  return children;
}
