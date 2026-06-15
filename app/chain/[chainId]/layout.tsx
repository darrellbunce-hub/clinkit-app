import { requireChainParticipantForRoute } from "@/lib/auth/chainAccess";

type ChainLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ chainId: string }>;
};

export default async function ChainLayout({
  children,
  params,
}: ChainLayoutProps) {
  const { chainId } = await params;

  await requireChainParticipantForRoute(
    chainId
  );

  return children;
}
