import { requirePropertyParticipantForRoute } from "@/lib/auth/propertyAccess";

type PropertyLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ propertyId: string }>;
};

export default async function PropertyLayout({
  children,
  params,
}: PropertyLayoutProps) {
  const { propertyId } = await params;

  await requirePropertyParticipantForRoute(
    propertyId
  );

  return children;
}
