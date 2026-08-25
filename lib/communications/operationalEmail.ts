import "server-only";

import { isEmailSendingEnabled } from "@/lib/communications/config";
import {
  markEmailEventFailed,
  markEmailEventSent,
  queueEmailEvent,
} from "@/lib/communications/emailEvents";
import { createResendProvider } from "@/lib/communications/resend";
import type {
  EmailProvider,
  SendEmailPayload,
  SendEmailResult,
} from "@/lib/communications/types";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

/**
 * Thin operational email sender for founder/ops alerts.
 * Reuses Resend + email_events without requiring a React Email marketing template.
 */
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

export async function deliverOperationalEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: "billing-ops-alert";
}): Promise<SendEmailResult> {
  const provider = getEmailProvider();
  if (!provider) {
    return {
      ok: true,
      sent: false,
      skipped: true,
      reason: "email_sending_disabled",
    };
  }

  const payload: SendEmailPayload = {
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  };

  let eventId: string | null = null;
  try {
    const supabase = createServiceRoleSupabaseClient();
    eventId = await queueEmailEvent(supabase, {
      template: input.template,
      recipientEmail: payload.to,
      provider: provider.name,
    });
  } catch (error) {
    console.error("[communications] Ops email event queue exception:", error);
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
      console.error("[communications] Ops email event update exception:", error);
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
