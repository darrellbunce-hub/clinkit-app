import { notFound } from "next/navigation";

import PrivacyRequestWorkspace from "@/components/privacyAdmin/PrivacyRequestWorkspace";
import { getPrivacyErasureRequestDetail } from "@/lib/privacyAdmin/queries";

type PrivacyRequestDetailPageProps = {
  params: Promise<{ requestId: string }>;
};

export default async function PrivacyRequestDetailPage({
  params,
}: PrivacyRequestDetailPageProps) {
  const { requestId } = await params;
  const detail = await getPrivacyErasureRequestDetail(requestId);

  if (!detail) {
    notFound();
  }

  return <PrivacyRequestWorkspace detail={detail} />;
}
