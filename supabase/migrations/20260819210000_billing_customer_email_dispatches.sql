-- Billing customer email dispatch ledger (atomic claim-before-send).
-- Ensures the same billing lifecycle email is never sent twice across
-- webhook retries/reclaims or process restarts.

create table if not exists public.billing_customer_email_dispatches (
  dispatch_key text primary key,
  template text not null,
  branch_id uuid not null references public.ea_branches (id),
  subscription_id uuid null references public.ea_branch_subscriptions (id),
  recipient_email text not null,
  status text not null
    check (status in ('claimed', 'sent', 'failed')),
  email_event_id uuid null,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  claimed_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists billing_customer_email_dispatches_branch_idx
  on public.billing_customer_email_dispatches (branch_id, template);

create index if not exists billing_customer_email_dispatches_status_idx
  on public.billing_customer_email_dispatches (status, claimed_at);

comment on table public.billing_customer_email_dispatches is
  'Atomic claim ledger for EA billing customer lifecycle emails. Insert-before-send; unique dispatch_key prevents duplicates.';

revoke all on table public.billing_customer_email_dispatches from public;
revoke all on table public.billing_customer_email_dispatches from anon;
revoke all on table public.billing_customer_email_dispatches from authenticated;
grant select, insert, update on table public.billing_customer_email_dispatches to service_role;

-- Atomic claim: insert claimed row, or reclaim a failed row. Never reclaim sent/claimed.
create or replace function public.claim_billing_customer_email_dispatch(
  p_dispatch_key text,
  p_template text,
  p_branch_id uuid,
  p_subscription_id uuid,
  p_recipient_email text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_customer_email_dispatches%rowtype;
begin
  if nullif(trim(p_dispatch_key), '') is null
     or nullif(trim(p_template), '') is null
     or p_branch_id is null
     or nullif(trim(p_recipient_email), '') is null then
    return jsonb_build_object('ok', false, 'action', 'invalid_request');
  end if;

  insert into public.billing_customer_email_dispatches (
    dispatch_key,
    template,
    branch_id,
    subscription_id,
    recipient_email,
    status,
    metadata
  )
  values (
    trim(p_dispatch_key),
    trim(p_template),
    p_branch_id,
    p_subscription_id,
    lower(trim(p_recipient_email)),
    'claimed',
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (dispatch_key) do nothing
  returning * into v_row;

  if found then
    return jsonb_build_object(
      'ok', true,
      'action', 'claimed',
      'dispatch_key', v_row.dispatch_key,
      'status', v_row.status
    );
  end if;

  -- Reclaim only failed rows so a transient send failure can retry once claimed again.
  update public.billing_customer_email_dispatches
  set
    status = 'claimed',
    template = trim(p_template),
    branch_id = p_branch_id,
    subscription_id = p_subscription_id,
    recipient_email = lower(trim(p_recipient_email)),
    metadata = coalesce(p_metadata, '{}'::jsonb),
    error_message = null,
    email_event_id = null,
    claimed_at = timezone('utc', now()),
    completed_at = null,
    updated_at = timezone('utc', now())
  where dispatch_key = trim(p_dispatch_key)
    and status = 'failed'
  returning * into v_row;

  if found then
    return jsonb_build_object(
      'ok', true,
      'action', 'reclaimed',
      'dispatch_key', v_row.dispatch_key,
      'status', v_row.status
    );
  end if;

  select * into v_row
  from public.billing_customer_email_dispatches
  where dispatch_key = trim(p_dispatch_key);

  if not found then
    return jsonb_build_object('ok', false, 'action', 'claim_failed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'already_claimed',
    'dispatch_key', v_row.dispatch_key,
    'status', v_row.status
  );
end;
$$;

revoke all on function public.claim_billing_customer_email_dispatch(
  text, text, uuid, uuid, text, jsonb
) from public;
revoke all on function public.claim_billing_customer_email_dispatch(
  text, text, uuid, uuid, text, jsonb
) from anon;
revoke all on function public.claim_billing_customer_email_dispatch(
  text, text, uuid, uuid, text, jsonb
) from authenticated;
grant execute on function public.claim_billing_customer_email_dispatch(
  text, text, uuid, uuid, text, jsonb
) to service_role;

create or replace function public.complete_billing_customer_email_dispatch(
  p_dispatch_key text,
  p_status text,
  p_email_event_id uuid default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_customer_email_dispatches%rowtype;
begin
  if p_status not in ('sent', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  update public.billing_customer_email_dispatches
  set
    status = p_status,
    email_event_id = coalesce(p_email_event_id, email_event_id),
    error_message = case
      when p_status = 'failed' then left(coalesce(p_error_message, 'send_failed'), 500)
      else null
    end,
    completed_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where dispatch_key = trim(p_dispatch_key)
    and status = 'claimed'
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_claimed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'dispatch_key', v_row.dispatch_key,
    'status', v_row.status
  );
end;
$$;

revoke all on function public.complete_billing_customer_email_dispatch(
  text, text, uuid, text
) from public;
revoke all on function public.complete_billing_customer_email_dispatch(
  text, text, uuid, text
) from anon;
revoke all on function public.complete_billing_customer_email_dispatch(
  text, text, uuid, text
) from authenticated;
grant execute on function public.complete_billing_customer_email_dispatch(
  text, text, uuid, text
) to service_role;
