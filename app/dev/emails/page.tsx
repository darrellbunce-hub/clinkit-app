import { notFound } from "next/navigation";

import { isDeveloperEmailToolsEnabled, isEmailSendingEnabled } from "@/lib/communications/config";
import {
  getAvailableEmailTemplates,
  getFutureEmailTemplates,
} from "@/lib/communications/templateRegistry";
import EmailDevWorkspace from "@/components/dev/EmailDevWorkspace";

type EmailDevPageProps = {
  searchParams: Promise<{
    template?: string;
  }>;
};

export default async function EmailDevPage({
  searchParams,
}: EmailDevPageProps) {
  if (!isDeveloperEmailToolsEnabled()) {
    notFound();
  }

  const params = await searchParams;
  const availableTemplates = getAvailableEmailTemplates();
  const futureTemplates = getFutureEmailTemplates();

  return (
    <EmailDevWorkspace
      initialTemplateId={params.template ?? availableTemplates[0]?.id}
      availableTemplates={availableTemplates}
      futureTemplates={futureTemplates}
      emailSendingEnabled={isEmailSendingEnabled()}
    />
  );
}
