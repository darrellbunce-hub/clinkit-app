import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EmailEventMetadata,
  EmailEventRecord,
  EmailEventStatus,
  ProviderDeliveryEvent,
} from "@/lib/communications/types";

type QueueEmailEventParams = EmailEventMetadata & {
  template: string;
  recipientEmail: string;
  provider: string;
};

function normalizeProviderEvents(value: unknown): ProviderDeliveryEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is ProviderDeliveryEvent =>
      typeof entry === "object" &&
      entry !== null &&
      "type" in entry &&
      "occurredAt" in entry
  );
}

export async function queueEmailEvent(
  supabase: SupabaseClient,
  params: QueueEmailEventParams
): Promise<string | null> {
  const { data, error } = await supabase.rpc("create_email_event", {
    p_template: params.template,
    p_recipient_email: params.recipientEmail,
    p_provider: params.provider,
    p_sent_by: params.sentBy ?? null,
    p_property_id: params.propertyId ?? null,
    p_chain_id: params.chainId ?? null,
    p_invitation_id: params.invitationId ?? null,
  });

  if (error) {
    console.error(
      "[communications] Failed to queue email event:",
      error.message
    );
    return null;
  }

  return typeof data === "string" ? data : null;
}

export async function markEmailEventSent(
  supabase: SupabaseClient,
  eventId: string,
  provider: string,
  providerMessageId?: string
): Promise<void> {
  const { error } = await supabase.rpc("mark_email_event_sent", {
    p_event_id: eventId,
    p_provider: provider,
    p_provider_message_id: providerMessageId ?? null,
  });

  if (error) {
    console.error(
      "[communications] Failed to mark email event sent:",
      error.message
    );
  }
}

export async function markEmailEventFailed(
  supabase: SupabaseClient,
  eventId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase.rpc("mark_email_event_failed", {
    p_event_id: eventId,
    p_error_message: errorMessage,
  });

  if (error) {
    console.error(
      "[communications] Failed to mark email event failed:",
      error.message
    );
  }
}

export async function listRecentEmailEvents(
  supabase: SupabaseClient,
  options?: {
    status?: EmailEventStatus | null;
    limit?: number;
  }
): Promise<EmailEventRecord[]> {
  const { data, error } = await supabase.rpc("list_recent_email_events", {
    p_status: options?.status ?? null,
    p_limit: options?.limit ?? 50,
  });

  if (error) {
    console.error(
      "[communications] Failed to list email events:",
      error.message
    );
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) =>
    normalizeEmailEventRecord(row)
  );
}

function normalizeEmailEventRecord(row: Record<string, unknown>): EmailEventRecord {
  return {
    id: String(row.id),
    template: String(row.template),
    recipient_email: String(row.recipient_email),
    provider: row.provider ? String(row.provider) : null,
    provider_message_id: row.provider_message_id
      ? String(row.provider_message_id)
      : null,
    status: row.status as EmailEventStatus,
    error_message: row.error_message ? String(row.error_message) : null,
    sent_by: row.sent_by ? String(row.sent_by) : null,
    property_id:
      typeof row.property_id === "number" ? row.property_id : null,
    chain_id: typeof row.chain_id === "number" ? row.chain_id : null,
    invitation_id: row.invitation_id ? String(row.invitation_id) : null,
    provider_events: normalizeProviderEvents(row.provider_events),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/**
 * Future Resend webhook hook — appends delivery lifecycle events without
 * changing send-attempt status (queued/sent/failed).
 */
export async function appendProviderDeliveryEvent(
  supabase: SupabaseClient,
  providerMessageId: string,
  event: ProviderDeliveryEvent
): Promise<string | null> {
  const { data, error } = await supabase.rpc(
    "append_email_event_provider_event",
    {
      p_provider_message_id: providerMessageId,
      p_event: event,
    }
  );

  if (error) {
    console.error(
      "[communications] Failed to append provider delivery event:",
      error.message
    );
    return null;
  }

  return typeof data === "string" ? data : null;
}
