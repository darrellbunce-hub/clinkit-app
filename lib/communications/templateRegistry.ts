import type {
  EmailTemplateDefinition,
  EmailTemplateId,
} from "@/lib/communications/types";

export const EMAIL_TEMPLATE_REGISTRY: EmailTemplateDefinition[] = [
  {
    id: "homeowner-invitation",
    title: "Homeowner Invitation",
    description:
      "Sent when an estate agent invites a homeowner to connect their property.",
    category: "transactional",
    available: true,
  },
  {
    id: "estate-agent-invitation",
    title: "Estate Agent Invitation",
    description:
      "Sent when a team member is invited to join an estate agent branch.",
    category: "transactional",
    available: true,
  },
  {
    id: "password-reset",
    title: "Password Reset",
    description:
      "Sent when a user requests to reset their Keynetic account password.",
    category: "transactional",
    available: true,
  },
  {
    id: "welcome",
    title: "Welcome Email",
    description:
      "Sent when a new Keynetic account is ready to use.",
    category: "transactional",
    available: true,
  },
  {
    id: "property-claimed",
    title: "Property Claimed",
    description:
      "Sent when a homeowner successfully connects their property on Keynetic.",
    category: "transactional",
    available: true,
  },
  {
    id: "lifecycle-dormancy-warning",
    title: "Dormancy Warning",
    description:
      "Sent when a connected property transaction enters dormancy warning and needs still-active confirmation.",
    category: "transactional",
    available: true,
  },
  {
    id: "chain-update",
    title: "Chain Update",
    description: "Future template — chain progress updates.",
    category: "future",
    available: false,
  },
  {
    id: "invitation-reminder",
    title: "Invitation Reminder",
    description: "Future template — reminder before an invitation expires.",
    category: "future",
    available: false,
  },
  {
    id: "invitation-expired",
    title: "Invitation Expired",
    description: "Future template — notification when an invitation expires.",
    category: "future",
    available: false,
  },
  {
    id: "completion-confirmed",
    title: "Completion Confirmed",
    description: "Future template — completion confirmation.",
    category: "future",
    available: false,
  },
  {
    id: "marketing-emails",
    title: "Marketing Emails",
    description: "Future category — product and onboarding campaigns.",
    category: "future",
    available: false,
  },
  {
    id: "notification-emails",
    title: "Notification Emails",
    description: "Future category — operational notifications.",
    category: "future",
    available: false,
  },
];

export function getAvailableEmailTemplates(): EmailTemplateDefinition[] {
  return EMAIL_TEMPLATE_REGISTRY.filter((template) => template.available);
}

export function isEmailTemplateId(
  value: string | null | undefined
): value is EmailTemplateId {
  return getAvailableEmailTemplates().some(
    (template) => template.id === value
  );
}

export function getEmailTemplateDefinition(
  templateId: EmailTemplateId
): EmailTemplateDefinition | undefined {
  return getAvailableEmailTemplates().find(
    (template) => template.id === templateId
  );
}

export function getFutureEmailTemplates(): EmailTemplateDefinition[] {
  return EMAIL_TEMPLATE_REGISTRY.filter((template) => !template.available);
}
