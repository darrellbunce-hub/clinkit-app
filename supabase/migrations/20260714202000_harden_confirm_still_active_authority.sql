-- Restrict still-active confirmation to active operational homeowners and
-- make confirmation idempotent when lifecycle is already active.

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
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = v_user_id
      and poi.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorised');
  end if;

  select operational_state
  into v_state
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');
  v_chain_id := v_property.chain_id;

  if v_state = 'active' then
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operational_state', 'active',
      'idempotent', true
    );
  end if;

  if v_state <> 'dormancy_warning' then
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

revoke all on function public.confirm_transaction_still_active(bigint) from public;
grant execute on function public.confirm_transaction_still_active(bigint) to authenticated;

comment on function public.confirm_transaction_still_active(bigint) is
  'Structured still-active confirmation for active operational homeowners only. Idempotent when lifecycle is already active.';
