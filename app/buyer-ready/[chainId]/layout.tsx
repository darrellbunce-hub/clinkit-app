import { requireChainParticipantForRoute } from "@/lib/auth/chainAccess";

type BuyerReadyLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ chainId: string }>;
};

export default async function BuyerReadyLayout({
  children,
  params,
}: BuyerReadyLayoutProps) {
  const { chainId } = await params;

  await requireChainParticipantForRoute(
    chainId
  );

  return children;
}
