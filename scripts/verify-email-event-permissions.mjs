/**
 * Verifies email event RPCs are not executable by authenticated users
 * and remain callable via the service role.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required in .env.local."
  );
  process.exit(2);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPermissionDenied(error) {
  if (!error) {
    return false;
  }

  const message = String(error.message ?? error).toLowerCase();

  return (
    message.includes("permission denied") ||
    message.includes("not authorized") ||
    error.code === "42501"
  );
}

async function signInTestUser() {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = `email-event-perms-${Date.now()}@verify.test`;
  const password = "verify-email-event-perms-123";

  const signUp = await client.auth.signUp({ email, password });

  if (signUp.error) {
    throw signUp.error;
  }

  const signIn = await client.auth.signInWithPassword({ email, password });

  if (signIn.error) {
    throw signIn.error;
  }

  return client;
}

async function expectAuthenticatedDenied(client, rpcName, params) {
  const { error } = await client.rpc(rpcName, params);

  assert(
    isPermissionDenied(error),
    `${rpcName} should be denied for authenticated users (got: ${error?.message ?? "no error"})`
  );
}

async function main() {
  const authClient = await signInTestUser();
  const serviceClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await expectAuthenticatedDenied(authClient, "list_recent_email_events", {
    p_status: null,
    p_limit: 1,
  });

  await expectAuthenticatedDenied(authClient, "mark_email_event_sent", {
    p_event_id: "00000000-0000-0000-0000-000000000000",
    p_provider: "resend",
    p_provider_message_id: "test",
  });

  await expectAuthenticatedDenied(authClient, "mark_email_event_failed", {
    p_event_id: "00000000-0000-0000-0000-000000000000",
    p_error_message: "test",
  });

  await expectAuthenticatedDenied(
    authClient,
    "append_email_event_provider_event",
    {
      p_provider_message_id: "test",
      p_event: { type: "delivered", occurredAt: new Date().toISOString() },
    }
  );

  await expectAuthenticatedDenied(authClient, "create_email_event", {
    p_template: "verify-permissions",
    p_recipient_email: "blocked@verify.test",
    p_provider: "resend",
    p_sent_by: null,
    p_property_id: null,
    p_chain_id: null,
    p_invitation_id: null,
  });

  const { data: eventId, error: createError } = await serviceClient.rpc(
    "create_email_event",
    {
      p_template: "verify-permissions",
      p_recipient_email: "service-role@verify.test",
      p_provider: "resend",
      p_sent_by: null,
      p_property_id: null,
      p_chain_id: null,
      p_invitation_id: null,
    }
  );

  assert(!createError, `service role create_email_event failed: ${createError?.message}`);
  assert(typeof eventId === "string", "service role create_email_event should return uuid");

  const { error: sentError } = await serviceClient.rpc("mark_email_event_sent", {
    p_event_id: eventId,
    p_provider: "resend",
    p_provider_message_id: "verify-permissions-message",
  });

  assert(!sentError, `service role mark_email_event_sent failed: ${sentError?.message}`);

  const { data: listed, error: listError } = await serviceClient.rpc(
    "list_recent_email_events",
    {
      p_status: "sent",
      p_limit: 5,
    }
  );

  assert(!listError, `service role list_recent_email_events failed: ${listError?.message}`);
  assert(
    Array.isArray(listed) &&
      listed.some((row) => row.id === eventId),
    "service role should list the created email event"
  );

  const { error: appendError } = await serviceClient.rpc(
    "append_email_event_provider_event",
    {
      p_provider_message_id: "verify-permissions-message",
      p_event: {
        type: "delivered",
        occurredAt: new Date().toISOString(),
      },
    }
  );

  assert(
    !appendError,
    `service role append_email_event_provider_event failed: ${appendError?.message}`
  );

  console.log("verify-email-event-permissions: all checks passed");
}

main().catch((error) => {
  console.error("verify-email-event-permissions failed:", error.message ?? error);
  process.exit(1);
});
