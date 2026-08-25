-- Email event logging for the Keynetic communication platform.
-- Send attempt lifecycle: queued -> sent | failed
-- provider_events holds future Resend webhook data (delivered, opened, clicked, bounced).

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  template text not null,
  recipient_email text not null,
  provider text null,
  provider_message_id text null,
  status text not null default 'queued',
  error_message text null,
  sent_by uuid null
    references auth.users (id) on delete set null,
  property_id bigint null
    references public.properties (id) on delete set null,
  chain_id bigint null
    references public.chains (id) on delete set null,
  invitation_id uuid null
    references public.property_claim_invitations (id) on delete set null,
  provider_events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_events_status_check
    check (status in ('queued', 'sent', 'failed'))
);

create index if not exists email_events_created_at_idx
  on public.email_events (created_at desc);

create index if not exists email_events_status_idx
  on public.email_events (status);

create index if not exists email_events_template_idx
  on public.email_events (template);

create index if not exists email_events_provider_message_id_idx
  on public.email_events (provider_message_id)
  where provider_message_id is not null;

comment on table public.email_events is
  'Audit log for transactional email send attempts and future provider delivery events.';

comment on column public.email_events.provider_events is
  'Future Resend webhook events: delivered, opened, clicked, bounced.';

alter table public.email_events enable row level security;

revoke all on public.email_events from public;
revoke all on public.email_events from anon;

-- ---------------------------------------------------------------------------
-- RPC: create_email_event
-- ---------------------------------------------------------------------------

create or replace function public.create_email_event(
  p_template text,
  p_recipient_email text,
  p_provider text default null,
  p_sent_by uuid default null,
  p_property_id bigint default null,
  p_chain_id bigint default null,
  p_invitation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_chain_id bigint;
  v_invitation_id uuid;
begin
  if p_sent_by is not null and p_sent_by <> auth.uid() then
    raise exception 'sent_by must match the authenticated user';
  end if;

  v_chain_id := p_chain_id;

  if v_chain_id is null and p_property_id is not null then
    select p.chain_id
    into v_chain_id
    from public.properties p
    where p.id = p_property_id;
  end if;

  v_invitation_id := p_invitation_id;

  if v_invitation_id is null and p_property_id is not null then
    select active_invitation.id
    into v_invitation_id
    from public.get_active_property_claim_invitation(p_property_id) active_invitation;
  end if;

  insert into public.email_events (
    template,
    recipient_email,
    provider,
    status,
    sent_by,
    property_id,
    chain_id,
    invitation_id
  )
  values (
    trim(p_template),
    lower(trim(p_recipient_email)),
    nullif(trim(p_provider), ''),
    'queued',
    p_sent_by,
    p_property_id,
    v_chain_id,
    v_invitation_id
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

comment on function public.create_email_event(
  text, text, text, uuid, bigint, bigint, uuid
) is
  'Creates a queued email_events record before a provider send attempt.';

-- ---------------------------------------------------------------------------
-- RPC: mark_email_event_sent
-- ---------------------------------------------------------------------------

create or replace function public.mark_email_event_sent(
  p_event_id uuid,
  p_provider text,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_events
  set
    status = 'sent',
    provider = nullif(trim(p_provider), ''),
    provider_message_id = nullif(trim(p_provider_message_id), ''),
    error_message = null,
    updated_at = now()
  where id = p_event_id;
end;
$$;

comment on function public.mark_email_event_sent(uuid, text, text) is
  'Marks an email_events record as sent after provider acceptance.';

-- ---------------------------------------------------------------------------
-- RPC: mark_email_event_failed
-- ---------------------------------------------------------------------------

create or replace function public.mark_email_event_failed(
  p_event_id uuid,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_events
  set
    status = 'failed',
    error_message = nullif(trim(p_error_message), ''),
    updated_at = now()
  where id = p_event_id;
end;
$$;

comment on function public.mark_email_event_failed(uuid, text) is
  'Marks an email_events record as failed after a provider send error.';

-- ---------------------------------------------------------------------------
-- RPC: append_email_event_provider_event (future Resend webhooks)
-- ---------------------------------------------------------------------------

create or replace function public.append_email_event_provider_event(
  p_provider_message_id text,
  p_event jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  update public.email_events ee
  set
    provider_events = ee.provider_events || jsonb_build_array(p_event),
    updated_at = now()
  where ee.provider_message_id = nullif(trim(p_provider_message_id), '')
  returning ee.id into v_event_id;

  return v_event_id;
end;
$$;

comment on function public.append_email_event_provider_event(text, jsonb) is
  'Future hook for Resend webhooks to append delivered/opened/clicked/bounced events.';

-- ---------------------------------------------------------------------------
-- RPC: list_recent_email_events (developer tooling)
-- ---------------------------------------------------------------------------

create or replace function public.list_recent_email_events(
  p_status text default null,
  p_limit integer default 50
)
returns setof public.email_events
language sql
stable
security definer
set search_path = public
as $$
  select ee.*
  from public.email_events ee
  where
    p_status is null
    or ee.status = nullif(trim(p_status), '')
  order by ee.created_at desc
  limit greatest(coalesce(p_limit, 50), 1);
$$;

comment on function public.list_recent_email_events(text, integer) is
  'Lists recent email events for developer audit tooling.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.create_email_event(
  text, text, text, uuid, bigint, bigint, uuid
) from public;

revoke all on function public.mark_email_event_sent(uuid, text, text) from public;
revoke all on function public.mark_email_event_failed(uuid, text) from public;
revoke all on function public.append_email_event_provider_event(text, jsonb) from public;
revoke all on function public.list_recent_email_events(text, integer) from public;

grant execute on function public.create_email_event(
  text, text, text, uuid, bigint, bigint, uuid
) to authenticated;

grant execute on function public.mark_email_event_sent(uuid, text, text) to authenticated;
grant execute on function public.mark_email_event_failed(uuid, text) to authenticated;
grant execute on function public.append_email_event_provider_event(text, jsonb) to authenticated;
grant execute on function public.list_recent_email_events(text, integer) to authenticated;
