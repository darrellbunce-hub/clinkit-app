-- Participation de-link: predefined reason codes only (no free text).

-- ---------------------------------------------------------------------------
-- Schema: reason → reason_code (enum storage)
-- ---------------------------------------------------------------------------

alter table public.property_delink_events
  rename column reason to reason_code;

update public.property_delink_events
set reason_code = 'other'
where reason_code is null
   or trim(reason_code) = ''
   or reason_code not in (
     'no_longer_moving',
     'wrong_property',
     'prefer_not_to_use_keynetic',
     'no_longer_need_agent',
     'wrong_branch_assigned',
     'added_by_mistake',
     'branch_no_longer_instructed',
     'duplicate_property',
     'wrong_homeowner_invited',
     'duplicate_invitation',
     'invitation_no_longer_required',
     'other'
   );

alter table public.property_delink_events
  alter column reason_code set not null;

alter table public.property_delink_events
  drop constraint if exists property_delink_events_reason_code_check;

alter table public.property_delink_events
  add constraint property_delink_events_reason_code_check
  check (
    reason_code in (
      'no_longer_moving',
      'wrong_property',
      'prefer_not_to_use_keynetic',
      'no_longer_need_agent',
      'wrong_branch_assigned',
      'added_by_mistake',
      'branch_no_longer_instructed',
      'duplicate_property',
      'wrong_homeowner_invited',
      'duplicate_invitation',
      'invitation_no_longer_required',
      'other'
    )
  );

comment on column public.property_delink_events.reason_code is
  'Predefined de-link reason code only. No free-text user input.';

-- ---------------------------------------------------------------------------
-- Helpers: reason codes per operation
-- ---------------------------------------------------------------------------

create or replace function public.participation_delink_reason_codes_for_operation(
  p_operation text
)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_operation
    when 'homeowner_self' then array[
      'no_longer_moving',
      'wrong_property',
      'prefer_not_to_use_keynetic',
      'other'
    ]::text[]
    when 'homeowner_remove_ea' then array[
      'no_longer_need_agent',
      'wrong_branch_assigned',
      'other'
    ]::text[]
    when 'estate_agent_remove_branch' then array[
      'added_by_mistake',
      'branch_no_longer_instructed',
      'duplicate_property',
      'other'
    ]::text[]
    when 'estate_agent_remove_homeowner' then array[
      'wrong_homeowner_invited',
      'duplicate_invitation',
      'invitation_no_longer_required',
      'other'
    ]::text[]
    else array[]::text[]
  end;
$$;

create or replace function public.is_valid_participation_delink_reason_code(
  p_operation text,
  p_reason_code text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_reason_code = any(
    public.participation_delink_reason_codes_for_operation(p_operation)
  );
$$;

revoke all on function public.participation_delink_reason_codes_for_operation(text) from public;
revoke all on function public.is_valid_participation_delink_reason_code(text, text) from public;
grant execute on function public.participation_delink_reason_codes_for_operation(text) to authenticated;
grant execute on function public.is_valid_participation_delink_reason_code(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Internal: unified service (reason_code required, validated)
-- ---------------------------------------------------------------------------

create or replace function public._execute_participation_delink(
  p_property_id bigint,
  p_operation text,
  p_reason_code text,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
  v_branch_id uuid;
  v_activity_message text;
  v_claim public.property_claim_metadata%rowtype;
  v_identity public.property_operational_identities%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_operation not in (
    'homeowner_self',
    'homeowner_remove_ea',
    'estate_agent_remove_branch',
    'estate_agent_remove_homeowner'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_operation');
  end if;

  if not public.is_valid_participation_delink_reason_code(
    p_operation,
    p_reason_code
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason_code');
  end if;

  if not exists (
    select 1
    from public.properties p
    where p.id = p_property_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  select chain_id
  into v_chain_id
  from public.properties
  where id = p_property_id;

  if p_operation = 'homeowner_self' then
    if not exists (
      select 1
      from public.property_operational_identities poi
      where poi.property_id = p_property_id
        and poi.homeowner_user_id = auth.uid()
        and poi.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'error', 'not_operational_homeowner');
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      auth.uid(),
      'homeowner',
      p_reason_code,
      jsonb_build_object('operation', p_operation)
    );

    update public.property_delegates
    set
      status = 'revoked',
      revoked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status in ('pending', 'active');

    update public.property_counterparty_participants
    set
      status = 'delinked',
      delinked_at = now()
    where property_id = p_property_id
      and status = 'active';

    update public.property_operational_identities
    set
      status = 'released',
      delinked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status = 'active';

    delete from public.property_members
    where property_id = p_property_id;

    update public.property_claim_metadata pcm
    set
      claim_status = case
        when pcm.origin_type = 'estate_agent' then 'unclaimed'
        else pcm.claim_status
      end,
      claimed_by_user_id = case
        when pcm.origin_type = 'estate_agent' then null
        else pcm.claimed_by_user_id
      end,
      claimed_at = case
        when pcm.origin_type = 'estate_agent' then null
        else pcm.claimed_at
      end,
      updated_at = now()
    where pcm.property_id = p_property_id;

    update public.property_ea_assignments
    set
      status = 'revoked',
      revoked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status = 'active';

    update public.properties
    set
      status = 'pending_connection',
      buyer_connected = false,
      seller_connected = false,
      updated_at = now()
    where id = p_property_id;

    perform public.record_property_lifecycle_transition(
      p_property_id,
      'released',
      'homeowner_delink',
      null,
      p_reason_code,
      jsonb_build_object('operation', p_operation, 'reason_code', p_reason_code)
    );

    v_activity_message :=
      'Homeowner left this transaction. The property has been released.';

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'lifecycle_state', 'released'
    );
  end if;

  if p_operation = 'homeowner_remove_ea' then
    if not exists (
      select 1
      from public.property_operational_identities poi
      where poi.property_id = p_property_id
        and poi.homeowner_user_id = auth.uid()
        and poi.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'error', 'not_operational_homeowner');
    end if;

    select pea.branch_id
    into v_branch_id
    from public.property_ea_assignments pea
    where pea.property_id = p_property_id
      and pea.status = 'active'
    limit 1;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'no_active_ea_assignment');
    end if;

    if p_branch_id is not null and p_branch_id is distinct from v_branch_id then
      return jsonb_build_object('ok', false, 'error', 'branch_mismatch');
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      auth.uid(),
      'homeowner',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'branch_id', v_branch_id
      )
    );

    update public.property_ea_assignments
    set
      status = 'revoked',
      revoked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and branch_id = v_branch_id
      and status = 'active';

    v_activity_message :=
      'Homeowner removed the estate agent branch from this property.';

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'branch_id', v_branch_id
    );
  end if;

  if p_operation = 'estate_agent_remove_branch' then
    if p_branch_id is null then
      select pea.branch_id
      into v_branch_id
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm
        on bm.branch_id = pea.branch_id
      where pea.property_id = p_property_id
        and pea.status = 'active'
        and bm.user_id = auth.uid()
      limit 1;
    else
      v_branch_id := p_branch_id;
    end if;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'branch_required');
    end if;

    if not exists (
      select 1
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm
        on bm.branch_id = pea.branch_id
      where pea.property_id = p_property_id
        and pea.branch_id = v_branch_id
        and pea.status = 'active'
        and bm.user_id = auth.uid()
    ) then
      return jsonb_build_object('ok', false, 'error', 'not_assigned_ea');
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      auth.uid(),
      'estate_agent',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'branch_id', v_branch_id
      )
    );

    update public.property_ea_assignments
    set
      status = 'revoked',
      revoked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and branch_id = v_branch_id
      and status = 'active';

    v_activity_message :=
      'Estate agent branch released operational management of this property.';

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'branch_id', v_branch_id
    );
  end if;

  if p_operation = 'estate_agent_remove_homeowner' then
    select pea.branch_id
    into v_branch_id
    from public.property_ea_assignments pea
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where pea.property_id = p_property_id
      and pea.status = 'active'
      and bm.user_id = auth.uid()
    limit 1;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_assigned_ea');
    end if;

    if p_branch_id is not null and p_branch_id is distinct from v_branch_id then
      return jsonb_build_object('ok', false, 'error', 'branch_mismatch');
    end if;

    select *
    into v_claim
    from public.property_claim_metadata pcm
    where pcm.property_id = p_property_id;

    if v_claim.origin_type is distinct from 'estate_agent' then
      return jsonb_build_object('ok', false, 'error', 'not_ea_originated');
    end if;

    if public.property_invitation_is_pending(p_property_id) then
      null;
    elsif public.homeowner_has_meaningful_participation(p_property_id) then
      return jsonb_build_object(
        'ok', false,
        'error', 'homeowner_actively_participating'
      );
    else
      select *
      into v_identity
      from public.property_operational_identities poi
      where poi.property_id = p_property_id
        and poi.status = 'active';

      if v_identity.property_id is null then
        return jsonb_build_object('ok', false, 'error', 'no_homeowner_to_remove');
      end if;
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      auth.uid(),
      'estate_agent',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'branch_id', v_branch_id,
        'invitation_pending',
        public.property_invitation_is_pending(p_property_id)
      )
    );

    update public.property_delegates
    set
      status = 'revoked',
      revoked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status in ('pending', 'active');

    select *
    into v_identity
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active';

    if v_identity.property_id is not null then
      delete from public.property_members
      where property_id = p_property_id
        and user_id = v_identity.homeowner_user_id;

      update public.property_operational_identities
      set
        status = 'released',
        delinked_at = now(),
        updated_at = now()
      where property_id = p_property_id
        and status = 'active';
    end if;

    update public.property_claim_invitations pci
    set
      invitation_revoked_at = coalesce(pci.invitation_revoked_at, now()),
      updated_at = now()
    where pci.property_id = p_property_id
      and pci.invitation_used_at is null
      and pci.invitation_revoked_at is null;

    update public.property_claim_metadata pcm
    set
      claim_status = 'claim_invited',
      claimed_by_user_id = null,
      claimed_at = null,
      updated_at = now()
    where pcm.property_id = p_property_id;

    v_activity_message :=
      'Estate agent withdrew the homeowner association for this property. The invitation can be re-sent.';

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'branch_id', v_branch_id,
      'invitation_reset', true
    );
  end if;

  return jsonb_build_object('ok', false, 'error', 'unsupported_operation');
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_participation_delink_options (includes reason_codes per operation)
-- ---------------------------------------------------------------------------

create or replace function public.get_participation_delink_options(
  p_property_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_options jsonb := '[]'::jsonb;
  v_branch_id uuid;
  v_is_homeowner boolean;
  v_has_ea boolean;
  v_invitation_pending boolean;
  v_meaningful boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1 from public.properties p where p.id = p_property_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  select exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = auth.uid()
      and poi.status = 'active'
  )
  into v_is_homeowner;

  select exists (
    select 1
    from public.property_ea_assignments pea
    where pea.property_id = p_property_id
      and pea.status = 'active'
  )
  into v_has_ea;

  select pea.branch_id
  into v_branch_id
  from public.property_ea_assignments pea
  where pea.property_id = p_property_id
    and pea.status = 'active'
  limit 1;

  v_invitation_pending :=
    public.property_invitation_is_pending(p_property_id);

  v_meaningful :=
    public.homeowner_has_meaningful_participation(p_property_id);

  if v_is_homeowner then
    v_options := v_options || jsonb_build_array(
      jsonb_build_object(
        'operation', 'homeowner_self',
        'label', 'Leave this transaction',
        'requires_confirmation', true,
        'branch_id', null,
        'reason_codes', to_jsonb(
          public.participation_delink_reason_codes_for_operation('homeowner_self')
        )
      )
    );

    if v_has_ea then
      v_options := v_options || jsonb_build_array(
        jsonb_build_object(
          'operation', 'homeowner_remove_ea',
          'label', 'Remove estate agent',
          'requires_confirmation', true,
          'branch_id', v_branch_id,
          'reason_codes', to_jsonb(
            public.participation_delink_reason_codes_for_operation('homeowner_remove_ea')
          )
        )
      );
    end if;
  end if;

  if exists (
    select 1
    from public.property_ea_assignments pea
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where pea.property_id = p_property_id
      and pea.status = 'active'
      and bm.user_id = auth.uid()
  ) then
    v_options := v_options || jsonb_build_array(
      jsonb_build_object(
        'operation', 'estate_agent_remove_branch',
        'label', 'Release branch management',
        'requires_confirmation', true,
        'branch_id', v_branch_id,
        'reason_codes', to_jsonb(
          public.participation_delink_reason_codes_for_operation('estate_agent_remove_branch')
        )
      )
    );

    if exists (
      select 1
      from public.property_claim_metadata pcm
      where pcm.property_id = p_property_id
        and pcm.origin_type = 'estate_agent'
    )
    and (
      v_invitation_pending
      or (
        exists (
          select 1
          from public.property_operational_identities poi
          where poi.property_id = p_property_id
            and poi.status = 'active'
        )
        and not v_meaningful
      )
    ) then
      v_options := v_options || jsonb_build_array(
        jsonb_build_object(
          'operation', 'estate_agent_remove_homeowner',
          'label', 'Withdraw homeowner association',
          'requires_confirmation', true,
          'branch_id', v_branch_id,
          'invitation_pending', v_invitation_pending,
          'reason_codes', to_jsonb(
            public.participation_delink_reason_codes_for_operation('estate_agent_remove_homeowner')
          )
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'options', v_options,
    'signals', jsonb_build_object(
      'invitation_pending', v_invitation_pending,
      'meaningful_participation', v_meaningful,
      'is_operational_homeowner', v_is_homeowner
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: execute_participation_delink (reason_code required)
-- ---------------------------------------------------------------------------

create or replace function public.execute_participation_delink(
  p_property_id bigint,
  p_operation text,
  p_reason_code text,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._execute_participation_delink(
    p_property_id,
    p_operation,
    p_reason_code,
    p_branch_id
  );
end;
$$;

comment on function public.execute_participation_delink(bigint, text, text, uuid) is
  'Unified participation de-link. Requires a predefined reason_code; no free text.';

revoke all on function public.execute_participation_delink(bigint, text, uuid, text) from public;
revoke all on function public.execute_participation_delink(bigint, text, uuid, text) from authenticated;

drop function if exists public.execute_participation_delink(bigint, text, uuid, text);

grant execute on function public.execute_participation_delink(bigint, text, text, uuid) to authenticated;

-- Legacy wrappers (DROP required: PostgreSQL cannot rename parameters via CREATE OR REPLACE)

drop function if exists public.delink_homeowner_from_property(bigint, text);

drop function if exists public.delink_estate_agent_from_property(bigint, uuid, text);

create or replace function public.delink_homeowner_from_property(
  p_property_id bigint,
  p_reason_code text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.execute_participation_delink(
    p_property_id,
    'homeowner_self',
    p_reason_code,
    null
  );
$$;

create or replace function public.delink_estate_agent_from_property(
  p_property_id bigint,
  p_branch_id uuid,
  p_reason_code text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.execute_participation_delink(
    p_property_id,
    'estate_agent_remove_branch',
    p_reason_code,
    p_branch_id
  );
$$;

revoke all on function public.delink_homeowner_from_property(bigint, text) from public;
grant execute on function public.delink_homeowner_from_property(bigint, text) to authenticated;

revoke all on function public.delink_estate_agent_from_property(bigint, uuid, text) from public;
grant execute on function public.delink_estate_agent_from_property(bigint, uuid, text) to authenticated;
