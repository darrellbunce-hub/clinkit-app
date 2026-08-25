-- Harden email event RPC permissions.
-- Email audit data must not be readable or mutable by authenticated users.
-- Trusted backend code uses the service_role key only.

revoke execute on function public.create_email_event(
  text, text, text, uuid, bigint, bigint, uuid
) from authenticated;

revoke execute on function public.mark_email_event_sent(uuid, text, text)
  from authenticated;

revoke execute on function public.mark_email_event_failed(uuid, text)
  from authenticated;

revoke execute on function public.append_email_event_provider_event(text, jsonb)
  from authenticated;

revoke execute on function public.list_recent_email_events(text, integer)
  from authenticated;

revoke execute on function public.create_email_event(
  text, text, text, uuid, bigint, bigint, uuid
) from anon;

revoke execute on function public.mark_email_event_sent(uuid, text, text)
  from anon;

revoke execute on function public.mark_email_event_failed(uuid, text)
  from anon;

revoke execute on function public.append_email_event_provider_event(text, jsonb)
  from anon;

revoke execute on function public.list_recent_email_events(text, integer)
  from anon;

grant execute on function public.create_email_event(
  text, text, text, uuid, bigint, bigint, uuid
) to service_role;

grant execute on function public.mark_email_event_sent(uuid, text, text)
  to service_role;

grant execute on function public.mark_email_event_failed(uuid, text)
  to service_role;

grant execute on function public.append_email_event_provider_event(text, jsonb)
  to service_role;

grant execute on function public.list_recent_email_events(text, integer)
  to service_role;
