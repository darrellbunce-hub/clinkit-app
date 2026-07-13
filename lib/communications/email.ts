import { isEmailSendingEnabled } from "@/lib/communications/config";
import {
  markEmailEventFailed,
  markEmailEventSent,
  queueEmailEvent,
} from "@/lib/communications/emailEvents";
import {
  renderClaimSuccessful,
  renderEstateAgentInvitation,
  renderHomeownerInvitation,
  renderPasswordReset,
  renderWelcomeEmail,
} from "@/lib/communications/render";
import { createResendProvider } from "@/lib/communications/resend";
import type {
  ClaimSuccessfulEmailParams,
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
