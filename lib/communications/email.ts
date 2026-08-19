import { isEmailSendingEnabled } from "@/lib/communications/config";
import {
  markEmailEventFailed,
  markEmailEventSent,
  queueEmailEvent,
} from "@/lib/communications/emailEvents";
import { buildDormancyWarningPropertyUrl } from "@/lib/communications/dormancyWarningLinks";
import {
  renderClaimSuccessful,
  renderDormancyWarning,
  renderEaGraceFinalWarning,
  renderEaGraceReminder,
  renderEaPaymentFailed,
  renderEaSubscriptionCancelled,
  renderEaSubscriptionConfirmation,
  renderEstateAgentInvitation,
  renderHomeownerInvitation,
  renderPasswordReset,
  renderWelcomeEmail,
} from "@/lib/communications/render";
import { createResendProvider } from "@/lib/communications/resend";
import type {
  ClaimSuccessfulEmailParams,
  DormancyWarningEmailParams,
  EaGraceFinalWarningEmailParams,
  EaGraceReminderEmailParams,
  EaPaymentFailedEmailParams,
  EaSubscriptionCancelledEmailParams,
  EaSubscriptionConfirmationEmailParams,
  EmailEventMetadata,
  EmailProvider,
  EmailTemplateId,
  EstateAgentInvitationEmailParams,
  HomeownerInvitationEmailParams,
  PasswordResetEmailParams,
  SendEmailPayload,
  SendEmailResult,
  WelcomeEmailParams,
} from "@/lib/communications/types";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

let activeProvider: EmailProvider | null = null;

function getEmailProvider(): EmailProvider | null {
  if (!isEmailSendingEnabled()) {
    return null;
  }

  if (!activeProvider) {
    activeProvider = createResendProvider();
  }

  return activeProvider;
}

type DeliverEmailOptions = {
  template: EmailTemplateId;
  metadata?: EmailEventMetadata;
};

async function deliverEmail(
  payload: SendEmailPayload,
  options: DeliverEmailOptions
): Promise<SendEmailResult> {
  const provider = getEmailProvider();

  if (!provider) {
    return {
      ok: true,
      sent: false,
      skipped: true,
      reason: "email_sending_disabled",
    };
  }

  let eventId: string | null = null;

  try {
    const supabase = createServiceRoleSupabaseClient();
    eventId = await queueEmailEvent(supabase, {
      template: options.template,
      recipientEmail: payload.to,
      provider: provider.name,
      sentBy: options.metadata?.sentBy ?? null,
      propertyId: options.metadata?.propertyId ?? null,
      chainId: options.metadata?.chainId ?? null,
      invitationId: options.metadata?.invitationId ?? null,
    });
  } catch (error) {
    console.error("[communications] Email event queue exception:", error);
  }

  const result = await provider.send(payload);

  if (eventId) {
    try {
      const supabase = createServiceRoleSupabaseClient();

      if (result.ok && result.sent) {
        await markEmailEventSent(
          supabase,
          eventId,
          result.provider,
          result.messageId
        );
      } else if (!result.ok) {
        await markEmailEventFailed(supabase, eventId, result.error);
      }
    } catch (error) {
      console.error("[communications] Email event update exception:", error);
    }
  }

  if (result.ok && result.sent) {
    return { ...result, eventId };
  }

  if (!result.ok) {
    return { ...result, eventId };
  }

  return result;
}

export async function sendHomeownerInvitation(
  params: HomeownerInvitationEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderHomeownerInvitation(params);

  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    {
      template: "homeowner-invitation",
      metadata,
    }
  );
}

export async function sendEstateAgentInvitation(
  params: EstateAgentInvitationEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderEstateAgentInvitation(params);

  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    {
      template: "estate-agent-invitation",
      metadata,
    }
  );
}

export async function sendPasswordReset(
  params: PasswordResetEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderPasswordReset(params);

  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    {
      template: "password-reset",
      metadata,
    }
  );
}

export async function sendWelcomeEmail(
  params: WelcomeEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderWelcomeEmail(params);

  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    {
      template: "welcome",
      metadata,
    }
  );
}

export async function sendClaimSuccessful(
  params: ClaimSuccessfulEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderClaimSuccessful(params);

  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    {
      template: "property-claimed",
      metadata,
    }
  );
}

export function buildDormancyWarningEmailParams(params: {
  to: string;
  propertyId: number;
}): DormancyWarningEmailParams {
  return {
    to: params.to,
    confirmationLink: buildDormancyWarningPropertyUrl(params.propertyId),
  };
}

export async function sendDormancyWarningEmail(
  params: DormancyWarningEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderDormancyWarning(params);

  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    {
      template: "lifecycle-dormancy-warning",
      metadata,
    }
  );
}

export async function sendEaSubscriptionConfirmation(
  params: EaSubscriptionConfirmationEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderEaSubscriptionConfirmation(params);
  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    { template: "ea-subscription-confirmation", metadata }
  );
}

export async function sendEaPaymentFailed(
  params: EaPaymentFailedEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderEaPaymentFailed(params);
  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    { template: "ea-payment-failed", metadata }
  );
}

export async function sendEaGraceReminder(
  params: EaGraceReminderEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderEaGraceReminder(params);
  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    { template: "ea-grace-reminder", metadata }
  );
}

export async function sendEaGraceFinalWarning(
  params: EaGraceFinalWarningEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderEaGraceFinalWarning(params);
  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    { template: "ea-grace-final-warning", metadata }
  );
}

export async function sendEaSubscriptionCancelled(
  params: EaSubscriptionCancelledEmailParams,
  metadata?: EmailEventMetadata
): Promise<SendEmailResult> {
  const rendered = await renderEaSubscriptionCancelled(params);
  return deliverEmail(
    {
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    { template: "ea-subscription-cancelled", metadata }
  );
}
