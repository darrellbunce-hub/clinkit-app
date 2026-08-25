-- Dormancy warning email notifications
--
-- Fixes premature dormancy_warning_notified_at writes, adds recipient resolution,
-- notification claim/sent/release RPCs, and resets notification cycle on confirmation.

-- ---------------------------------------------------------------------------
-- Notification claim column
-- ---------------------------------------------------------------------------

alter table public.property_lifecycle_states
  add column if not exists dormancy_warning_notification_claimed_at timestamptz null;

comment on column public.property_lifecycle_states.dormancy_warning_notification_claimed_at is
  'Short-lived worker claim while a dormancy warning email send is in flight. Cleared on success or retryable failure.';

-- ---------------------------------------------------------------------------
-- Connected dormancy warning (stop marking notified before email delivery)
-- ---------------------------------------------------------------------------

create or replace function public.execute_enter_dormancy_warning(
  p_property_id bigint,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_state text;
  v_peer_id bigint;
  v_result jsonb;
  v_peers_updated integer := 0;
  v_notified_at timestamptz;
begin
  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  select operational_state, dormancy_warning_notified_at
  into v_state, v_notified_at
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');

  if v_state = 'dormancy_warning' then
    update public.property_lifecycle_states
    set
      last_evaluated_at = now(),
      updated_at = now()
    where property_id = p_property_id;

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'idempotent', true,
      'operational_state', 'dormancy_warning',
      'notification_pending', v_notified_at is null
    );
  end if;

  if v_state <> 'active' then
    return jsonb_build_object('ok', true, 'skipped', true, 'operational_state', v_state);
  end if;

  v_result := public.record_property_lifecycle_transition_worker(
    p_property_id,
    'dormancy_warning',
    'worker',
    'connected_dormant',
    p_reason,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('action', 'enter_dormancy_warning')
  );

  if v_property.chain_id is not null then
    for v_peer_id in
      select cp.id
      from public.properties cp
      join public.property_lifecycle_states pls
        on pls.property_id = cp.id
      where cp.chain_id = v_property.chain_id
        and cp.id <> p_property_id
        and coalesce(pls.operational_state, 'active') = 'active'
    loop
      perform public.record_property_lifecycle_transition_worker(
        v_peer_id,
        'dormancy_warning',
        'worker',
        'connected_dormant',
        p_reason,
        coalesce(p_metadata, '{}'::jsonb)
          || jsonb_build_object('action', 'enter_dormancy_warning', 'source_property_id', p_property_id)
      );

      v_peers_updated := v_peers_updated + 1;
    end loop;
  end if;

  return v_result || jsonb_build_object(
    'peers_updated', v_peers_updated,
    'notification_pending', true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reset notification cycle on still-active confirmation
-- ---------------------------------------------------------------------------

create or replace function public.confirm_transaction_still_active(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_property public.properties%rowtype;
  v_state text;
  v_chain_id bigint;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if not exists (
    select 1
    from public.property_members pm
    where pm.property_id = p_property_id
      and pm.user_id = v_user_id
  )
  and not exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = v_user_id
      and poi.status = 'active'
  )
  and not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_a_participant');
  end if;

  select operational_state
  into v_state
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');
  v_chain_id := v_property.chain_id;

  if v_state not in ('dormancy_warning', 'active') then
    return jsonb_build_object('ok', false, 'error', 'invalid_state_for_confirmation');
  end if;

  insert into public.property_lifecycle_still_active_confirmations (
    property_id,
    chain_id,
    user_id,
    confirmation_code
  )
  values (
    p_property_id,
    v_chain_id,
    v_user_id,
    'still_active'
  );

  perform public.touch_property_operational_activity(p_property_id, true);

  insert into public.property_lifecycle_events (
    property_id,
    from_state,
    to_state,
    trigger,
    scenario,
    reason,
    metadata
  )
  select
    pls.property_id,
    pls.operational_state,
    'active',
    'still_active_confirmation',
    'connected_dormant',
    'Structured still-active confirmation reset dormancy clock.',
    jsonb_build_object('confirmation_code', 'still_active', 'confirmed_by', v_user_id)
  from public.property_lifecycle_states pls
  where pls.property_id = p_property_id
    and pls.operational_state = 'dormancy_warning';

  insert into public.property_lifecycle_events (
    property_id,
    from_state,
    to_state,
    trigger,
    scenario,
    reason,
    metadata
  )
  select
    pls.property_id,
    pls.operational_state,
    'active',
    'still_active_confirmation',
    'connected_dormant',
    'Structured still-active confirmation reset dormancy clock.',
    jsonb_build_object('confirmation_code', 'still_active', 'confirmed_by', v_user_id)
  from public.property_lifecycle_states pls
  join public.properties cp on cp.id = pls.property_id
  where v_chain_id is not null
    and cp.chain_id = v_chain_id
    and cp.id <> p_property_id
    and pls.operational_state = 'dormancy_warning';

  update public.property_lifecycle_states pls
  set
    operational_state = 'active',
    lifecycle_reason = 'still_active_confirmation',
    entered_state_at = now(),
    dormancy_warning_at = null,
    dormancy_confirmation_deadline_at = null,
    dormancy_warning_notified_at = null,
    dormancy_warning_notification_claimed_at = null,
    last_still_active_confirmed_at = now(),
    last_evaluated_at = now(),
    updated_at = now()
  from public.properties cp
  where cp.id = pls.property_id
    and (
      cp.id = p_property_id
      or (
        v_chain_id is not null
        and cp.chain_id = v_chain_id
        and pls.operational_state = 'dormancy_warning'
      )
    );

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'operational_state', 'active'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Dormancy warning notification targets (chain-wide, per property)
-- ---------------------------------------------------------------------------

create or replace function public.list_dormancy_warning_notification_targets(
  p_source_property_id bigint
)
returns table (
  property_id bigint,
  chain_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
begin
  select p.chain_id
  into v_chain_id
  from public.properties p
  where p.id = p_source_property_id;

  if v_chain_id is null then
    return query
    select pls.property_id, null::bigint
    from public.property_lifecycle_states pls
    where pls.property_id = p_source_property_id
      and pls.operational_state = 'dormancy_warning'
      and pls.dormancy_warning_notified_at is null;
    return;
  end if;

  return query
  select cp.id, cp.chain_id
  from public.properties cp
  join public.property_lifecycle_states pls
    on pls.property_id = cp.id
  where cp.chain_id = v_chain_id
    and pls.operational_state = 'dormancy_warning'
    and pls.dormancy_warning_notified_at is null
  order by cp.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recipient resolution (operational homeowner only)
-- ---------------------------------------------------------------------------

create or replace function public.get_dormancy_warning_email_recipient(
  p_property_id bigint
)
returns table (
  property_id bigint,
  chain_id bigint,
  homeowner_user_id uuid,
  recipient_email text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    poi.property_id,
    p.chain_id,
    poi.homeowner_user_id,
    lower(trim(u.email)) as recipient_email
  from public.property_operational_identities poi
  join public.properties p
    on p.id = poi.property_id
  join public.property_lifecycle_states pls
    on pls.property_id = poi.property_id
  join auth.users u
    on u.id = poi.homeowner_user_id
  where poi.property_id = p_property_id
    and poi.status = 'active'
    and pls.operational_state = 'dormancy_warning'
    and pls.dormancy_warning_notified_at is null
    and u.email is not null
    and trim(u.email) <> ''
    and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now())
  limit 1;
$$;

comment on function public.get_dormancy_warning_email_recipient(bigint) is
  'Resolves the active operational homeowner verified email for a property in dormancy_warning pending notification.';

-- ---------------------------------------------------------------------------
-- Notification claim / sent / release (service role)
-- ---------------------------------------------------------------------------

create or replace function public.try_claim_dormancy_warning_notification(
  p_property_id bigint,
  p_worker_run_id uuid default null,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.property_lifecycle_states pls
  set
    dormancy_warning_notification_claimed_at = now(),
    metadata = pls.metadata || jsonb_build_object(
      'dormancy_warning_notification_worker_run_id',
      coalesce(p_worker_run_id::text, '')
    ),
    updated_at = now()
  where pls.property_id = p_property_id
    and pls.operational_state = 'dormancy_warning'
    and pls.dormancy_warning_notified_at is null
    and (
      pls.dormancy_warning_notification_claimed_at is null
      or pls.dormancy_warning_notification_claimed_at
        < now() - make_interval(secs => greatest(p_lease_seconds, 60))
    );

  v_claimed := found;

  return jsonb_build_object(
    'ok', true,
    'claimed', v_claimed,
    'property_id', p_property_id
  );
end;
$$;

create or replace function public.mark_dormancy_warning_notification_sent(
  p_property_id bigint,
  p_email_event_id uuid default null,
  p_worker_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated boolean := false;
begin
  update public.property_lifecycle_states pls
  set
    dormancy_warning_notified_at = now(),
    dormancy_warning_notification_claimed_at = null,
    metadata = pls.metadata || jsonb_build_object(
      'dormancy_warning_email_event_id', coalesce(p_email_event_id::text, ''),
      'dormancy_warning_notified_worker_run_id',
      coalesce(p_worker_run_id::text, '')
    ),
    updated_at = now()
  where pls.property_id = p_property_id
    and pls.operational_state = 'dormancy_warning'
    and pls.dormancy_warning_notified_at is null;

  v_updated := found;

  return jsonb_build_object(
    'ok', true,
    'marked', v_updated,
    'property_id', p_property_id
  );
end;
$$;

create or replace function public.release_dormancy_warning_notification_claim(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released boolean := false;
begin
  update public.property_lifecycle_states pls
  set
    dormancy_warning_notification_claimed_at = null,
    updated_at = now()
  where pls.property_id = p_property_id
    and pls.operational_state = 'dormancy_warning'
    and pls.dormancy_warning_notified_at is null;

  v_released := found;

  return jsonb_build_object(
    'ok', true,
    'released', v_released,
    'property_id', p_property_id
  );
end;
$$;

revoke all on function public.list_dormancy_warning_notification_targets(bigint) from public;
revoke all on function public.get_dormancy_warning_email_recipient(bigint) from public;
revoke all on function public.try_claim_dormancy_warning_notification(bigint, uuid, integer) from public;
revoke all on function public.mark_dormancy_warning_notification_sent(bigint, uuid, uuid) from public;
revoke all on function public.release_dormancy_warning_notification_claim(bigint) from public;

grant execute on function public.list_dormancy_warning_notification_targets(bigint) to service_role;
grant execute on function public.get_dormancy_warning_email_recipient(bigint) to service_role;
grant execute on function public.try_claim_dormancy_warning_notification(bigint, uuid, integer) to service_role;
grant execute on function public.mark_dormancy_warning_notification_sent(bigint, uuid, uuid) to service_role;
grant execute on function public.release_dormancy_warning_notification_claim(bigint) to service_role;
