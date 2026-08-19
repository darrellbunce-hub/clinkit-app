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
      "Reference template — production password reset is sent by Supabase Auth (see docs/AUTH_ARCHITECTURE.md).",
    category: "transactional",
    available: true,
  },
  {
    id: "welcome",
    title: "Welcome Email",
    description:
      "Sent when a new Keynetic account is ready to use (send path not yet wired in production).",
    category: "transactional",
    available: true,
  },
  {
    id: "property-claimed",
    title: "Property connected",
    description:
      "Sent when a homeowner successfully connects their property on Keynetic (send path not yet wired in production).",
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
    id: "ea-subscription-confirmation",
    title: "EA Subscription Confirmation",
    description:
      "Transactional — sent when an Estate Agent branch subscription first becomes active/entitled.",
    category: "transactional",
    available: true,
  },
  {
    id: "ea-payment-failed",
    title: "EA Payment Failed",
    description:
      "Transactional — sent when recurring payment fails and the branch enters the 7-day grace period (BL-01).",
    category: "transactional",
    available: true,
  },
  {
    id: "ea-grace-reminder",
    title: "EA Grace Reminder",
    description:
      "Transactional — mid-grace reminder to update payment details during payment recovery.",
    category: "transactional",
    available: true,
  },
  {
    id: "ea-grace-final-warning",
    title: "EA Grace Final Warning",
    description:
      "Transactional — final warning before payment-recovery grace expiry.",
    category: "transactional",
    available: true,
  },
  {
    id: "ea-subscription-cancelled",
    title: "EA Subscription Cancelled",
    description:
      "Transactional — sent when cancellation is first scheduled for period end.",
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
