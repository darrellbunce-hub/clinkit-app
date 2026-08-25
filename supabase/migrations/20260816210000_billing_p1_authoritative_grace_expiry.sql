-- Billing P1: Authoritative grace expiry (Development-first).
-- Does NOT enable entitlement enforcement.
-- Does NOT add cron/workers.
--
-- Invariant: entitlement_status=grace AND grace_ends_at <= now()
--   ⇒ effective entitlement is ended, even without a further Stripe webhook.
-- Physical row may be best-effort updated via conditional UPDATE that cannot
-- overwrite a concurrent recovery to entitled.

-- ---------------------------------------------------------------------------
-- 1) Pure effective-status helper (read-time authority)
-- ---------------------------------------------------------------------------

create or replace function public.ea_effective_entitlement_status(
  p_entitlement_status text,
  p_grace_ends_at timestamptz,
  p_now timestamptz default now()
)
returns text
language sql
stable
as $$
  select case
    when p_entitlement_status = 'grace'
      and p_grace_ends_at is not null
      and p_grace_ends_at <= p_now
    then 'ended'
    else p_entitlement_status
  end;
$$;

comment on function public.ea_effective_entitlement_status(text, timestamptz, timestamptz) is
  'Authoritative entitlement mapping: expired grace is treated as ended at read time.';

revoke all on function public.ea_effective_entitlement_status(text, timestamptz, timestamptz) from public;
revoke all on function public.ea_effective_entitlement_status(text, timestamptz, timestamptz) from anon;
grant execute on function public.ea_effective_entitlement_status(text, timestamptz, timestamptz) to authenticated;
grant execute on function public.ea_effective_entitlement_status(text, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2) Conditional persist — never overwrite recovery to entitled
-- ---------------------------------------------------------------------------

create or replace function public.apply_ea_branch_grace_expiry_if_due(
  p_subscription_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ea_branch_subscriptions%rowtype;
begin
  if p_subscription_id is null then
    return jsonb_build_object('ok', false, 'error', 'subscription_required');
  end if;

  update public.ea_branch_subscriptions
  set
    entitlement_status = 'ended',
    ended_at = coalesce(ended_at, now()),
    updated_at = now()
  where id = p_subscription_id
    and entitlement_status = 'grace'
    and grace_ends_at is not null
    and grace_ends_at <= now()
    and ended_at is null
  returning * into v_row;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'reason', 'not_due_or_state_changed'
    );
  end if;

  insert into public.ea_subscription_events (
    branch_id,
    subscription_id,
    event_type,
    actor_source,
    metadata
  )
  values (
    v_row.branch_id,
    v_row.id,
    'subscription_expired',
    'system',
    jsonb_build_object(
      'reason', 'grace_expired',
      'grace_ends_at', v_row.grace_ends_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'subscription_id', v_row.id,
    'branch_id', v_row.branch_id,
    'entitlement_status', 'ended'
  );
end;
$$;

comment on function public.apply_ea_branch_grace_expiry_if_due(uuid) is
  'Best-effort physical grace→ended transition. Conditional WHERE prevents overwriting entitled recovery. Does not delete chain/property data.';

revoke all on function public.apply_ea_branch_grace_expiry_if_due(uuid) from public;
revoke all on function public.apply_ea_branch_grace_expiry_if_due(uuid) from anon;
revoke all on function public.apply_ea_branch_grace_expiry_if_due(uuid) from authenticated;
grant execute on function public.apply_ea_branch_grace_expiry_if_due(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Commercial entitlement helper — effective status (no client mutation)
-- ---------------------------------------------------------------------------

create or replace function public.is_ea_branch_commercially_entitled(
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ea_branch_subscriptions s
    where s.branch_id = p_branch_id
      and s.ended_at is null
      and public.ea_effective_entitlement_status(
        s.entitlement_status,
        s.grace_ends_at,
        now()
      ) in ('entitled', 'grace')
  );
$$;

comment on function public.is_ea_branch_commercially_entitled(uuid) is
  'True when open subscription effective entitlement is entitled or (unexpired) grace. Expired grace is NOT entitled. Stage 3: NOT wired into route guards yet.';

-- ---------------------------------------------------------------------------
-- 4) Summary RPC — apply due expiry then return effective entitlement
-- ---------------------------------------------------------------------------

create or replace function public.get_ea_branch_subscription_summary(
  p_branch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.ea_branch_subscriptions%rowtype;
  v_effective text;
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

  -- Also consider open row that is still grace but already past grace_ends_at
  -- with ended_at still null (pre-persist). If none open, check latest grace-expired.
  if v_sub.id is null then
    select *
    into v_sub
    from public.ea_branch_subscriptions
    where branch_id = p_branch_id
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
  end if;

  -- Best-effort persist when due (cannot overwrite entitled recovery).
  if v_sub.entitlement_status = 'grace'
     and v_sub.grace_ends_at is not null
     and v_sub.grace_ends_at <= now()
     and v_sub.ended_at is null
  then
    perform public.apply_ea_branch_grace_expiry_if_due(v_sub.id);
    select *
    into v_sub
    from public.ea_branch_subscriptions
    where id = v_sub.id;
  end if;

  v_effective := public.ea_effective_entitlement_status(
    v_sub.entitlement_status,
    v_sub.grace_ends_at,
    now()
  );

  -- After persist, open-row query may need has_subscription semantics:
  -- ended subscriptions still report history for Account UI.
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
    'entitlement_status', v_effective,
    'persisted_entitlement_status', v_sub.entitlement_status,
    'current_period_start', v_sub.current_period_start,
    'current_period_end', v_sub.current_period_end,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'cancelled_at', v_sub.cancelled_at,
    'grace_ends_at', v_sub.grace_ends_at,
    'ended_at', case
      when v_effective = 'ended' then coalesce(v_sub.ended_at, now())
      else v_sub.ended_at
    end,
    'enforcement_enabled', false
  );
end;
$$;

comment on function public.get_ea_branch_subscription_summary(uuid) is
  'Branch-member subscription summary with authoritative grace expiry. entitlement_status is effective (expired grace → ended). enforcement_enabled=false until Stage 3.';
