import { notFound } from "next/navigation";

import { isDeveloperEmailToolsEnabled } from "@/lib/communications/config";
import EmailEventsDevWorkspace from "@/components/dev/EmailEventsDevWorkspace";

type EmailEventsDevPageProps = {
  searchParams: Promise<{
    status?: string;
  }>;
};

export default async function EmailEventsDevPage({
  searchParams,
}: EmailEventsDevPageProps) {
  if (!isDeveloperEmailToolsEnabled()) {
    notFound();
  }

  const params = await searchParams;

  return (
    <EmailEventsDevWorkspace initialStatus={params.status ?? "all"} />
  );
}
