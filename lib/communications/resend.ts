import { Resend } from "resend";

import { getEmailFromAddress } from "@/lib/communications/config";
import type {
  EmailProvider,
  SendEmailPayload,
  SendEmailResult,
} from "@/lib/communications/types";

export function createResendProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const resend = new Resend(apiKey);

  return {
    name: "resend",

    async send(payload: SendEmailPayload): Promise<SendEmailResult> {
      try {
        const { data, error } = await resend.emails.send({
          from: getEmailFromAddress(),
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          replyTo: payload.replyTo,
        });

        if (error) {
          console.error("[communications] Resend send failed:", error);
          return {
            ok: false,
            sent: false,
            error: error.message,
          };
        }

        return {
          ok: true,
          sent: true,
          provider: "resend",
          messageId: data?.id,
        };
      } catch (error) {
        console.error("[communications] Resend send exception:", error);
        return {
          ok: false,
          sent: false,
          error:
            error instanceof Error
              ? error.message
              : "resend_send_failed",
        };
      }
    },
  };
}
