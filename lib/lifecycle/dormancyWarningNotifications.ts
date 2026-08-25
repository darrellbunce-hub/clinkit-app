import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDormancyWarningEmailParams,
  sendDormancyWarningEmail,
} from "@/lib/communications/email";
import type { SendEmailResult } from "@/lib/communications/types";

type DormancyWarningRecipient = {
  property_id: number;
  chain_id: number | null;
  homeowner_user_id: string;
  recipient_email: string;
};

type NotificationTarget = {
  property_id: number;
  chain_id: number | null;
};

export type DormancyWarningNotificationResult = {
  propertyId: number;
  recipientEmail: string | null;
  claimed: boolean;
  sent: boolean;
  skipped: boolean;
  error?: string;
  eventId?: string | null;
};

type SendDormancyWarningEmailFn = typeof sendDormancyWarningEmail;

async function loadNotificationTargets(
  supabase: SupabaseClient,
  sourcePropertyId: number
): Promise<NotificationTarget[]> {
  const { data, error } = await supabase.rpc(
    "list_dormancy_warning_notification_targets",
    { p_source_property_id: sourcePropertyId }
  );

  if (error) {
    throw new Error(
      `list_dormancy_warning_notification_targets failed: ${error.message}`
    );
  }

  return ((data ?? []) as NotificationTarget[]).filter(
    (row) => typeof row.property_id === "number"
  );
}

async function loadRecipient(
  supabase: SupabaseClient,
  propertyId: number
): Promise<DormancyWarningRecipient | null> {
  const { data, error } = await supabase.rpc(
    "get_dormancy_warning_email_recipient",
    { p_property_id: propertyId }
  );

  if (error) {
    throw new Error(
      `get_dormancy_warning_email_recipient failed: ${error.message}`
    );
  }

  const row = ((data ?? []) as DormancyWarningRecipient[])[0];

  if (!row?.recipient_email) {
    return null;
  }

  return row;
}

async function tryClaimNotification(
  supabase: SupabaseClient,
  propertyId: number,
  workerRunId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "try_claim_dormancy_warning_notification",
    {
      p_property_id: propertyId,
      p_worker_run_id: workerRunId,
    }
  );

  if (error) {
    throw new Error(
      `try_claim_dormancy_warning_notification failed: ${error.message}`
    );
  }

  return Boolean((data as { claimed?: boolean } | null)?.claimed);
}

async function markNotificationSent(
  supabase: SupabaseClient,
  propertyId: number,
  workerRunId: string,
  eventId?: string | null
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "mark_dormancy_warning_notification_sent",
    {
      p_property_id: propertyId,
      p_email_event_id: eventId ?? null,
      p_worker_run_id: workerRunId,
    }
  );

  if (error) {
    throw new Error(
      `mark_dormancy_warning_notification_sent failed: ${error.message}`
    );
  }

  return Boolean((data as { marked?: boolean } | null)?.marked);
}

async function releaseNotificationClaim(
  supabase: SupabaseClient,
  propertyId: number
): Promise<void> {
  const { error } = await supabase.rpc(
    "release_dormancy_warning_notification_claim",
    { p_property_id: propertyId }
  );

  if (error) {
    console.error(
      `[lifecycle] release_dormancy_warning_notification_claim failed for property ${propertyId}:`,
      error.message
    );
  }
}

export async function processDormancyWarningNotificationForProperty(params: {
  supabase: SupabaseClient;
  propertyId: number;
  workerRunId: string;
  sendEmail?: SendDormancyWarningEmailFn;
}): Promise<DormancyWarningNotificationResult> {
  const sendEmail = params.sendEmail ?? sendDormancyWarningEmail;
  const recipient = await loadRecipient(params.supabase, params.propertyId);

  if (!recipient) {
    return {
      propertyId: params.propertyId,
      recipientEmail: null,
      claimed: false,
      sent: false,
      skipped: true,
    };
  }

  const claimed = await tryClaimNotification(
    params.supabase,
    params.propertyId,
    params.workerRunId
  );

  if (!claimed) {
    return {
      propertyId: params.propertyId,
      recipientEmail: recipient.recipient_email,
      claimed: false,
      sent: false,
      skipped: true,
    };
  }

  let sendResult: SendEmailResult;

  try {
    sendResult = await sendEmail(
      buildDormancyWarningEmailParams({
        to: recipient.recipient_email,
        propertyId: params.propertyId,
      }),
      {
        propertyId: params.propertyId,
        chainId: recipient.chain_id,
      }
    );
  } catch (error) {
    await releaseNotificationClaim(params.supabase, params.propertyId);

    return {
      propertyId: params.propertyId,
      recipientEmail: recipient.recipient_email,
      claimed: true,
      sent: false,
      skipped: false,
      error: error instanceof Error ? error.message : "send_failed",
    };
  }

  if (sendResult.ok && sendResult.sent) {
    const marked = await markNotificationSent(
      params.supabase,
      params.propertyId,
      params.workerRunId,
      sendResult.eventId
    );

    if (!marked) {
      return {
        propertyId: params.propertyId,
        recipientEmail: recipient.recipient_email,
        claimed: true,
        sent: false,
        skipped: true,
        error: "notification_already_marked",
        eventId: sendResult.eventId,
      };
    }

    return {
      propertyId: params.propertyId,
      recipientEmail: recipient.recipient_email,
      claimed: true,
      sent: true,
      skipped: false,
      eventId: sendResult.eventId,
    };
  }

  await releaseNotificationClaim(params.supabase, params.propertyId);

  return {
    propertyId: params.propertyId,
    recipientEmail: recipient.recipient_email,
    claimed: true,
    sent: false,
    skipped: Boolean(sendResult.ok && !sendResult.sent),
    error:
      sendResult.ok && !sendResult.sent
        ? sendResult.reason
        : sendResult.ok
          ? undefined
          : sendResult.error,
    eventId: !sendResult.ok ? sendResult.eventId : undefined,
  };
}

/**
 * Sends dormancy warning emails for all pending chain notification targets.
 */
export async function processDormancyWarningNotifications(params: {
  supabase: SupabaseClient;
  sourcePropertyId: number;
  workerRunId: string;
  sendEmail?: SendDormancyWarningEmailFn;
}): Promise<DormancyWarningNotificationResult[]> {
  const targets = await loadNotificationTargets(
    params.supabase,
    params.sourcePropertyId
  );

  const results: DormancyWarningNotificationResult[] = [];

  for (const target of targets) {
    results.push(
      await processDormancyWarningNotificationForProperty({
        supabase: params.supabase,
        propertyId: target.property_id,
        workerRunId: params.workerRunId,
        sendEmail: params.sendEmail,
      })
    );
  }

  return results;
}
