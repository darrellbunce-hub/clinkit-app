export type EmailEventStatus = "queued" | "sent" | "failed";

export type ProviderDeliveryEventType =
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced";

export type ProviderDeliveryEvent = {
  type: ProviderDeliveryEventType;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

export type EmailEventMetadata = {
  sentBy?: string | null;
  propertyId?: number | null;
  chainId?: number | null;
  invitationId?: string | null;
};

export type EmailEventRecord = {
  id: string;
  template: string;
  recipient_email: string;
  provider: string | null;
  provider_message_id: string | null;
  status: EmailEventStatus;
  error_message: string | null;
  sent_by: string | null;
  property_id: number | null;
  chain_id: number | null;
  invitation_id: string | null;
  provider_events: ProviderDeliveryEvent[];
  created_at: string;
  updated_at: string;
};

export type SendEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export type SendEmailResult =
  | {
      ok: true;
      sent: true;
      provider: string;
      messageId?: string;
    }
  | {
      ok: true;
      sent: false;
      skipped: true;
      reason: string;
    }
  | {
      ok: false;
      sent: false;
      error: string;
    };

export interface EmailProvider {
  readonly name: string;
  send(payload: SendEmailPayload): Promise<SendEmailResult>;
}

export type HomeownerInvitationEmailParams = {
  to: string;
  homeownerName: string;
  propertyAddress: string;
  branchName: string;
  companyName: string;
  invitationLink: string;
  expiresAt: string;
};

export type EstateAgentInvitationEmailParams = {
  to: string;
  agentName: string;
  branchName: string;
  companyName: string;
  invitationLink: string;
};

export type PasswordResetEmailParams = {
  to: string;
  recipientName: string;
  resetLink: string;
};

export type WelcomeEmailParams = {
  to: string;
  recipientName: string;
  dashboardLink: string;
};

export type ClaimSuccessfulEmailParams = {
  to: string;
  homeownerName: string;
  propertyAddress: string;
  branchName: string;
  companyName: string;
  dashboardLink: string;
};

export type EmailTemplateId =
  | "homeowner-invitation"
  | "estate-agent-invitation"
  | "password-reset"
  | "welcome"
  | "property-claimed";

export type FutureEmailTemplateId =
  | "chain-update"
  | "invitation-reminder"
  | "invitation-expired"
  | "completion-confirmed"
  | "marketing-emails"
  | "notification-emails";

export type EmailTemplateRegistryId =
  | EmailTemplateId
  | FutureEmailTemplateId;

export type EmailTemplateDefinition = {
  id: EmailTemplateRegistryId;
  title: string;
  description: string;
  category: "transactional" | "future";
  available: boolean;
};
