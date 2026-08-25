-- Phase 2: Participation de-link — unified service for controlled release of operational
-- participation. No deletes; audit + lifecycle + chain activities preserved.
-- See docs/PARTICIPATION_DELINK.md

-- ---------------------------------------------------------------------------
-- Helpers: invitation state and meaningful participation
-- ---------------------------------------------------------------------------

create or replace function public.property_invitation_is_pending(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_claim_metadata pcm
    where pcm.property_id = p_property_id
      and pcm.origin_type = 'estate_agent'
      and pcm.claim_status in ('unclaimed', 'claim_invited')
  )
  and not exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
  );
$$;

comment on function public.property_invitation_is_pending(bigint) is
  'True when an EA-originated property awaits homeowner claim (no active operational identity).';

create or replace function public.homeowner_has_meaningful_participation(
  p_property_id bigint
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_homeowner_activity_count integer := 0;
  v_meaningful_activity_days integer := coalesce(
    nullif(current_setting('app.lifecycle_meaningful_activity_days', true), '')::integer,
    14
  );
begin
  if not exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
  ) then
    return false;
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  select count(*)
  into v_homeowner_activity_count
  from public.activities a
  where a.property_id = p_property_id
    and a.updated_by = 'homeowner';

  if v_homeowner_activity_count > 0 then
    return true;
  end if;

  if v_property.stage is not null
    and v_property.stage not in ('property_listed', 'searching') then
    return true;
  end if;

  if exists (
    select 1
    from public.property_counterparty_participants pcp
    where pcp.property_id = p_property_id
      and pcp.status = 'active'
  ) then
    return true;
  end if;

  if v_property.buyer_connected
    and v_property.seller_connected then
    return true;
  end if;

  if exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
      and poi.granted_at < now() - make_interval(days => v_meaningful_activity_days)
  ) then
    return true;
  end if;

  return false;
end;
$$;

comment on function public.homeowner_has_meaningful_participation(bigint) is
  'True when the active operational homeowner has progressed beyond an initial unclaimed/invite-only state.';

revoke all on function public.property_invitation_is_pending(bigint) from public;
revoke all on function public.homeowner_has_meaningful_participation(bigint) from public;
grant execute on function public.property_invitation_is_pending(bigint) to authenticated;
grant execute on function public.homeowner_has_meaningful_participation(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Internal: chain-visible activity + participant notification
-- ---------------------------------------------------------------------------

create or replace function public._insert_participation_delink_activity(
  p_property_id bigint,
  p_message text,
  p_updated_by text default 'system'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activities (
    property_id,
    update,
    updated_by
  )
  values (
    p_property_id,
    p_message,
    coalesce(nullif(trim(p_updated_by), ''), 'system')
  );
end;
$$;

create or replace function public._notify_chain_participants_of_delink(
  p_property_id bigint,
  p_chain_id bigint,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._insert_participation_delink_activity(
    p_property_id,
    p_message,
    'system'
  );

  if p_chain_id is null then
    return;
  end if;

  insert into public.activities (
    property_id,
    update,
    updated_by
  )
  select
    p.id,
    p_message,
    'system'
  from public.properties p
  where p.chain_id = p_chain_id
    and p.id <> p_property_id
    and (
      exists (
        select 1
        from public.property_operational_identities poi
        where poi.property_id = p.id
          and poi.status = 'active'
      )
      or exists (
        select 1
        from public.property_counterparty_participants pcp
        where pcp.property_id = p.id
          and pcp.status = 'active'
      )
      or exists (
        select 1
        from public.property_ea_assignments pea
        where pea.property_id = p.id
          and pea.status = 'active'
      )
      or exists (
        select 1
        from public.property_members pm
        where pm.property_id = p.id
      )
    );
end;
$$;

revoke all on function public._insert_participation_delink_activity(bigint, text, text) from public;
revoke all on function public._notify_chain_participants_of_delink(bigint, bigint, text) from public;

-- ---------------------------------------------------------------------------
-- Internal: unified participation de-link service
-- ---------------------------------------------------------------------------

create or replace function public._execute_participation_delink(
  p_property_id bigint,
  p_operation text,
  p_branch_id uuid default null,
  p_reason text default null
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

  -- -------------------------------------------------------------------------
  -- homeowner_self
  -- -------------------------------------------------------------------------
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
      reason,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      auth.uid(),
      'homeowner',
      nullif(trim(p_reason), ''),
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
      coalesce(nullif(trim(p_reason), ''), 'homeowner_delink'),
      jsonb_build_object('operation', p_operation)
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
      'lifecycle_state', 'released'
    );
  end if;

  -- -------------------------------------------------------------------------
  -- homeowner_remove_ea
  -- -------------------------------------------------------------------------
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
      reason,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      auth.uid(),
      'homeowner',
      nullif(trim(p_reason), ''),
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
      'branch_id', v_branch_id
    );
  end if;

  -- -------------------------------------------------------------------------
  -- estate_agent_remove_branch
  -- -------------------------------------------------------------------------
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
      reason,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      auth.uid(),
      'estate_agent',
      nullif(trim(p_reason), ''),
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
      'branch_id', v_branch_id
    );
  end if;

  -- -------------------------------------------------------------------------
  -- estate_agent_remove_homeowner (restricted)
  -- -------------------------------------------------------------------------
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
      reason,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      auth.uid(),
      'estate_agent',
      nullif(trim(p_reason), ''),
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
      'branch_id', v_branch_id,
      'invitation_reset', true
    );
  end if;

  return jsonb_build_object('ok', false, 'error', 'unsupported_operation');
end;
$$;

revoke all on function public._execute_participation_delink(bigint, text, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- RPC: get_participation_delink_options
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
        'branch_id', null
      )
    );

    if v_has_ea then
      v_options := v_options || jsonb_build_array(
        jsonb_build_object(
          'operation', 'homeowner_remove_ea',
          'label', 'Remove estate agent',
          'requires_confirmation', true,
          'branch_id', v_branch_id
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
        'branch_id', v_branch_id
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
          'invitation_pending', v_invitation_pending
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

comment on function public.get_participation_delink_options(bigint) is
  'Returns de-link operations permitted for the current user on a property.';

revoke all on function public.get_participation_delink_options(bigint) from public;
grant execute on function public.get_participation_delink_options(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: execute_participation_delink (public unified entry point)
-- ---------------------------------------------------------------------------

create or replace function public.execute_participation_delink(
  p_property_id bigint,
  p_operation text,
  p_branch_id uuid default null,
  p_reason text default null
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
    p_branch_id,
    nullif(trim(p_reason), '')
  );
end;
$$;

comment on function public.execute_participation_delink(bigint, text, uuid, text) is
  'Unified participation de-link service. Permission-checked by operation type.';

revoke all on function public.execute_participation_delink(bigint, text, uuid, text) from public;
grant execute on function public.execute_participation_delink(bigint, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Legacy RPC wrappers (delegate to unified service)
-- ---------------------------------------------------------------------------

create or replace function public.delink_homeowner_from_property(
  p_property_id bigint,
  p_reason text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.execute_participation_delink(
    p_property_id,
    'homeowner_self',
    null,
    p_reason
  );
$$;

create or replace function public.delink_estate_agent_from_property(
  p_property_id bigint,
  p_branch_id uuid,
  p_reason text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.execute_participation_delink(
    p_property_id,
    'estate_agent_remove_branch',
    p_branch_id,
    p_reason
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: de-link audit readable by involved participants
-- ---------------------------------------------------------------------------

create policy property_delink_events_select_involved
  on public.property_delink_events
  for select
  to authenticated
  using (
    actor_user_id = auth.uid()
    or exists (
      select 1
      from public.property_operational_identities poi
      where poi.property_id = property_delink_events.property_id
        and poi.homeowner_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm
        on bm.branch_id = pea.branch_id
      where pea.property_id = property_delink_events.property_id
        and bm.user_id = auth.uid()
    )
  );

grant select on public.property_delink_events to authenticated;

-- ---------------------------------------------------------------------------
-- Lifecycle states: participants may read their property lifecycle row
-- ---------------------------------------------------------------------------

create policy property_lifecycle_states_select_participant
  on public.property_lifecycle_states
  for select
  to authenticated
  using (
    public.is_property_operational_participant(property_id)
    or exists (
      select 1
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm
        on bm.branch_id = pea.branch_id
      where pea.property_id = property_lifecycle_states.property_id
        and bm.user_id = auth.uid()
    )
  );

grant select on public.property_lifecycle_states to authenticated;
