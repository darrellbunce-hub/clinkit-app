-- Billing P0: Stripe webhook event claim / retry integrity.
-- Development-first. Does NOT enable entitlement enforcement.
-- Does NOT change pricing, Portal, Checkout, or founding-slot behaviour.
--
-- Invariant: an event must never become permanently non-retryable until
-- its required business effects have successfully committed (processed/ignored).
-- failed and stale processing rows remain reclaimable for Stripe retries.

-- ---------------------------------------------------------------------------
-- 1) Claim lease timestamp
-- ---------------------------------------------------------------------------

alter table public.stripe_webhook_events
  add column if not exists processing_started_at timestamptz null;

comment on column public.stripe_webhook_events.processing_started_at is
  'Set when a worker claims the event for processing. Used to reclaim stale processing leases after crashes.';

comment on table public.stripe_webhook_events is
  'Stripe webhook idempotency ledger. processed/ignored = terminal success (safe duplicate 200). failed/stale processing = retryable. Stores event id/type/status only — not full payloads.';

-- ---------------------------------------------------------------------------
-- 2) Atomic claim / reclaim RPC (service_role only)
-- ---------------------------------------------------------------------------

create or replace function public.claim_stripe_webhook_event(
  p_stripe_event_id text,
  p_event_type text,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.stripe_webhook_events%rowtype;
  v_stale_secs integer;
begin
  if p_stripe_event_id is null or length(trim(p_stripe_event_id)) = 0 then
    return jsonb_build_object('ok', false, 'action', 'error', 'error', 'event_id_required');
  end if;

  if p_event_type is null or length(trim(p_event_type)) = 0 then
    return jsonb_build_object('ok', false, 'action', 'error', 'error', 'event_type_required');
  end if;

  v_stale_secs := greatest(coalesce(p_stale_after_seconds, 300), 30);
  v_stale_secs := least(v_stale_secs, 3600);

  -- Serialise concurrent deliveries of the same Stripe event id.
  perform pg_advisory_xact_lock(hashtext('stripe_webhook_event:' || p_stripe_event_id));

  insert into public.stripe_webhook_events (
    stripe_event_id,
    event_type,
    processing_status,
    processing_started_at,
    error_message,
    processed_at
  )
  values (
    p_stripe_event_id,
    p_event_type,
    'processing',
    now(),
    null,
    null
  )
  on conflict (stripe_event_id) do nothing
  returning * into v_row;

  if found then
    return jsonb_build_object(
      'ok', true,
      'action', 'process',
      'status', 'processing'
    );
  end if;

  select *
  into v_row
  from public.stripe_webhook_events
  where stripe_event_id = p_stripe_event_id
  for update;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'action', 'error', 'error', 'claim_race');
  end if;

  if v_row.processing_status in ('processed', 'ignored') then
    return jsonb_build_object(
      'ok', true,
      'action', 'already_succeeded',
      'status', v_row.processing_status
    );
  end if;

  if v_row.processing_status = 'processing' then
    if v_row.processing_started_at is not null
       and v_row.processing_started_at > now() - make_interval(secs => v_stale_secs)
    then
      return jsonb_build_object(
        'ok', true,
        'action', 'in_progress',
        'status', 'processing'
      );
    end if;
    -- Stale processing lease (crash / timeout) — reclaim below.
  end if;

  -- failed OR stale processing → reclaim for retry
  update public.stripe_webhook_events
  set
    processing_status = 'processing',
    processing_started_at = now(),
    event_type = p_event_type,
    error_message = null,
    processed_at = null,
    received_at = received_at
  where id = v_row.id
    and processing_status in ('failed', 'processing')
  returning * into v_row;

  if not found then
    -- Another worker moved it to terminal success between select and update.
    select *
    into v_row
    from public.stripe_webhook_events
    where stripe_event_id = p_stripe_event_id;

    if v_row.processing_status in ('processed', 'ignored') then
      return jsonb_build_object(
        'ok', true,
        'action', 'already_succeeded',
        'status', v_row.processing_status
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'action', 'error',
      'error', 'reclaim_failed',
      'status', v_row.processing_status
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'process',
    'status', 'processing',
    'reclaimed', true
  );
end;
$$;

comment on function public.claim_stripe_webhook_event(text, text, integer) is
  'Atomically claim a Stripe webhook event for processing. processed/ignored → already_succeeded (idempotent). failed or stale processing → reclaim (retryable). Fresh processing lease → in_progress.';

revoke all on function public.claim_stripe_webhook_event(text, text, integer) from public;
revoke all on function public.claim_stripe_webhook_event(text, text, integer) from anon;
revoke all on function public.claim_stripe_webhook_event(text, text, integer) from authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Mark terminal / failed outcome (service_role only)
-- ---------------------------------------------------------------------------

create or replace function public.finish_stripe_webhook_event(
  p_stripe_event_id text,
  p_status text,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.stripe_webhook_events%rowtype;
begin
  if p_stripe_event_id is null or length(trim(p_stripe_event_id)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'event_id_required');
  end if;

  if p_status not in ('processed', 'ignored', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  perform pg_advisory_xact_lock(hashtext('stripe_webhook_event:' || p_stripe_event_id));

  update public.stripe_webhook_events
  set
    processing_status = p_status,
    processed_at = case
      when p_status in ('processed', 'ignored') then now()
      else null
    end,
    error_message = case
      when p_status = 'failed' then left(coalesce(p_error_message, 'processing_failed'), 500)
      else null
    end
  where stripe_event_id = p_stripe_event_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.processing_status,
    'retryable', v_row.processing_status = 'failed'
  );
end;
$$;

comment on function public.finish_stripe_webhook_event(text, text, text) is
  'Mark webhook event terminal (processed/ignored) or failed (retryable). failed clears processed_at so Stripe retries can reclaim.';

revoke all on function public.finish_stripe_webhook_event(text, text, text) from public;
revoke all on function public.finish_stripe_webhook_event(text, text, text) from anon;
revoke all on function public.finish_stripe_webhook_event(text, text, text) from authenticated;
grant execute on function public.finish_stripe_webhook_event(text, text, text) to service_role;
