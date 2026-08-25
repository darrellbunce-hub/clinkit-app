import { notFound } from "next/navigation";

import PrivacyRequestListPanel from "@/components/privacyAdmin/PrivacyRequestListPanel";
import { listPrivacyErasureRequests } from "@/lib/privacyAdmin/queries";

export default async function PrivacyAdminPage() {
  try {
    const requests = await listPrivacyErasureRequests();
    return <PrivacyRequestListPanel requests={requests} />;
  } catch {
    notFound();
  }
}