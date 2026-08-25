-- Billing Stage 2 additive foundation (Development-first).
-- Extends Stage 1 with checkout session tracking, grace deadline,
-- founding confirmation helper, and richer subscription summary.
-- Does NOT enable paid entitlement enforcement.
-- Idempotent / forward-safe.

-- ---------------------------------------------------------------------------
-- 1) Additive columns on ea_branch_subscriptions
-- ---------------------------------------------------------------------------

alter table public.ea_branch_subscriptions
  add column if not exists stripe_checkout_session_id text null;

alter table public.ea_branch_subscriptions
  add column if not exists grace_ends_at timestamptz null;

alter table public.ea_branch_subscriptions
  add column if not exists stripe_object_updated_at timestamptz null;

comment on column public.ea_branch_subscriptions.stripe_checkout_session_id is
  'Stripe Checkout Session id while checkout_pending; cleared after subscription attaches.';

comment on column public.ea_branch_subscriptions.grace_ends_at is
  'Keynetic payment-failure grace deadline (7 days from failure by Stage 2 policy).';

comment on column public.ea_branch_subscriptions.stripe_object_updated_at is
  'Stripe object updated timestamp used to ignore stale out-of-order webhook events.';

create unique index if not exists ea_branch_subscriptions_checkout_session_uidx
  on public.ea_branch_subscriptions (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Webhook processing lifecycle: allow explicit processing state
-- ---------------------------------------------------------------------------

alter table public.stripe_webhook_events
  drop constraint if exists stripe_webhook_events_processing_status_check;

alter table public.stripe_webhook_events
  add constraint stripe_webhook_events_processing_status_check
  check (
    processing_status in (
      'received',
      'processing',
      'processed',
      'ignored',
      'failed'
    )
  );

-- ---------------------------------------------------------------------------
-- 3) confirm_ea_founding_slot — webhook / service-role path only
-- ---------------------------------------------------------------------------

create or replace function public.confirm_ea_founding_slot(
  p_branch_id uuid,
  p_subscription_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ea_founding_slot_ledger%rowtype;
begin
  if p_branch_id is null or p_subscription_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;

  perform pg_advisory_xact_lock(hashtext('ea_founding_slot_ledger'));
  perform public._release_expired_ea_founding_reservations();

  select *
  into v_row
  from public.ea_founding_slot_ledger
  where branch_id = p_branch_id
    and state in ('reserved', 'confirmed')
  order by
    case when state = 'confirmed' then 0 else 1 end,
    reserved_at desc
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_active_reservation');
  end if;

  if v_row.state = 'confirmed' then
    return jsonb_build_object(
      'ok', true,
      'slot_number', v_row.slot_number,
      'state', 'confirmed',
      'already_confirmed', true
    );
  end if;

  update public.ea_founding_slot_ledger
  set
    state = 'confirmed',
    subscription_id = p_subscription_id,
    confirmed_at = now(),
    updated_at = now()
  where id = v_row.id
    and state = 'reserved';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'confirm_race');
  end if;

  update public.ea_branch_subscriptions
  set
    founding_slot_number = v_row.slot_number,
    pricing_tier = 'founding',
    amount_gbp_minor = 9900,
    updated_at = now()
  where id = p_subscription_id
    and branch_id = p_branch_id
    and ended_at is null;

  insert into public.ea_subscription_events (
    branch_id,
    subscription_id,
    event_type,
    actor_source,
    metadata
  )
  values (
    p_branch_id,
    p_subscription_id,
    'founding_slot_confirmed',
    'webhook',
    jsonb_build_object('slot_number', v_row.slot_number)
  );

  return jsonb_build_object(
    'ok', true,
    'slot_number', v_row.slot_number,
    'state', 'confirmed',
    'already_confirmed', false
  );
end;
$$;

comment on function public.confirm_ea_founding_slot(uuid, uuid) is
  'Confirm a reserved founding slot after successful paid subscription. Idempotent. Intended for service-role / webhook processors only.';

revoke all on function public.confirm_ea_founding_slot(uuid, uuid) from public;
revoke all on function public.confirm_ea_founding_slot(uuid, uuid) from anon;
revoke all on function public.confirm_ea_founding_slot(uuid, uuid) from authenticated;
grant execute on function public.confirm_ea_founding_slot(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4) Refresh subscription summary with Stage 2 fields
-- ---------------------------------------------------------------------------

create or replace function public.get_ea_branch_subscription_summary(
  p_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sub public.ea_branch_subscriptions%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_branch_id is null then
    return jsonb_build_object('ok', false, 'error', 'branch_required');
  end if;

  if not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_member');
  end if;

  select *
  into v_sub
  from public.ea_branch_subscriptions
  where branch_id = p_branch_id
    and ended_at is null
  order by created_at desc
  limit 1;

  if v_sub.id is null then
    return jsonb_build_object(
      'ok', true,
      'branch_id', p_branch_id,
      'has_subscription', false,
      'entitlement_status', 'none',
      'stripe_status', 'not_started',
      'enforcement_enabled', false
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'branch_id', p_branch_id,
    'has_subscription', true,
    'subscription_id', v_sub.id,
    'pricing_tier', v_sub.pricing_tier,
    'amount_gbp_minor', v_sub.amount_gbp_minor,
    'currency', v_sub.currency,
    'founding_slot_number', v_sub.founding_slot_number,
    'stripe_status', v_sub.stripe_status,
    'entitlement_status', v_sub.entitlement_status,
    'current_period_start', v_sub.current_period_start,
    'current_period_end', v_sub.current_period_end,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'cancelled_at', v_sub.cancelled_at,
    'grace_ends_at', v_sub.grace_ends_at,
    'ended_at', v_sub.ended_at,
    'enforcement_enabled', false
  );
end;
$$;

comment on function public.get_ea_branch_subscription_summary(uuid) is
  'Branch-member-readable subscription summary. enforcement_enabled=false until Stage 3.';
