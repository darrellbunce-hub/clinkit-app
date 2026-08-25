-- P0: Operational identity enforcement — single operational homeowner, typed grant RPCs,
-- legacy membership creation revoked. See docs/OPERATIONAL_IDENTITY_MIGRATION_AUDIT.md.

-- ---------------------------------------------------------------------------
-- Internal: sync property_members row (implementation detail only)
-- ---------------------------------------------------------------------------

create or replace function public._upsert_property_membership_row(
  p_property_id bigint,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.property_members (
    property_id,
    user_id,
    role
  )
  values (
    p_property_id,
    p_user_id,
    p_role
  )
  on conflict (property_id, user_id) do update
  set role = case
    when case public.property_members.role
      when 'seller' then 1
      when 'buyer' then 2
      when 'participant' then 3
      else 4
    end
    <= case excluded.role
      when 'seller' then 1
      when 'buyer' then 2
      when 'participant' then 3
      else 4
    end
    then public.property_members.role
    else excluded.role
  end;
end;
$$;

comment on function public._upsert_property_membership_row(bigint, uuid, text) is
  'Internal membership sync for approved grant workflows only. Not callable by clients.';

revoke all on function public._upsert_property_membership_row(bigint, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Internal: claim convergence on operational homeowner grant (replaces membership trigger)
-- ---------------------------------------------------------------------------

create or replace function public._sync_property_claim_on_homeowner_grant(
  p_property_id bigint,
  p_homeowner_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.property_claim_metadata (
    property_id,
    origin_type,
    claim_status,
    claimed_at,
    claimed_by_user_id
  )
  values (
    p_property_id,
    coalesce(
      (
        select pcm.origin_type
        from public.property_claim_metadata pcm
        where pcm.property_id = p_property_id
      ),
      'homeowner'
    ),
    'claimed',
    now(),
    p_homeowner_user_id
  )
  on conflict (property_id) do update
  set
    claim_status = 'claimed',
    claimed_at = coalesce(
      public.property_claim_metadata.claimed_at,
      now()
    ),
    claimed_by_user_id = coalesce(
      public.property_claim_metadata.claimed_by_user_id,
      excluded.claimed_by_user_id
    ),
    updated_at = now();
end;
$$;

revoke all on function public._sync_property_claim_on_homeowner_grant(bigint, uuid) from public;

drop trigger if exists property_members_sync_claim on public.property_members;

-- ---------------------------------------------------------------------------
-- Internal: establish operational homeowner (single active identity per property)
-- ---------------------------------------------------------------------------

create or replace function public._establish_operational_homeowner_core(
  p_property_id bigint,
  p_homeowner_user_id uuid,
  p_granted_via text,
  p_sync_claim boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_operational_role text;
  v_existing public.property_operational_identities%rowtype;
begin
  if p_homeowner_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'homeowner_required');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  v_operational_role := case
    when v_property.relationship_type = 'sale' then 'seller'
    when v_property.relationship_type = 'purchase' then 'buyer'
    else null
  end;

  if v_operational_role is null then
    return jsonb_build_object('ok', false, 'error', 'not_operational_property');
  end if;

  select *
  into v_existing
  from public.property_operational_identities poi
  where poi.property_id = p_property_id;

  if v_existing.property_id is not null then
    if v_existing.status = 'active' then
      if v_existing.homeowner_user_id = p_homeowner_user_id then
        perform public._upsert_property_membership_row(
          p_property_id,
          p_homeowner_user_id,
          v_operational_role
        );

        if p_sync_claim then
          perform public._sync_property_claim_on_homeowner_grant(
            p_property_id,
            p_homeowner_user_id
          );
        end if;

        return jsonb_build_object(
          'ok', true,
          'property_id', p_property_id,
          'idempotent', true
        );
      end if;

      return jsonb_build_object('ok', false, 'error', 'operational_homeowner_exists');
    end if;

    update public.property_operational_identities
    set
      homeowner_user_id = p_homeowner_user_id,
      operational_role = v_operational_role,
      granted_via = p_granted_via,
      status = 'active',
      granted_at = now(),
      delinked_at = null,
      updated_at = now()
    where property_id = p_property_id;
  else
    insert into public.property_operational_identities (
      property_id,
      homeowner_user_id,
      operational_role,
      granted_via,
      status,
      granted_at
    )
    values (
      p_property_id,
      p_homeowner_user_id,
      v_operational_role,
      p_granted_via,
      'active',
      now()
    );
  end if;

  perform public._upsert_property_membership_row(
    p_property_id,
    p_homeowner_user_id,
    v_operational_role
  );

  if p_sync_claim then
    perform public._sync_property_claim_on_homeowner_grant(
      p_property_id,
      p_homeowner_user_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id
  );
end;
$$;

revoke all on function public._establish_operational_homeowner_core(bigint, uuid, text, boolean) from public;

-- ---------------------------------------------------------------------------
-- RPC: establish_operational_homeowner (approved homeowner workflows)
-- ---------------------------------------------------------------------------

create or replace function public.establish_operational_homeowner(
  p_property_id bigint,
  p_granted_via text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sync_claim boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_granted_via not in (
    'start_move',
    'claim_operational_property',
    'ea_origination_claim',
    'convert_placeholder'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_granted_via');
  end if;

  v_sync_claim := p_granted_via in (
    'claim_operational_property',
    'ea_origination_claim'
  );

  return public._establish_operational_homeowner_core(
    p_property_id,
    auth.uid(),
    p_granted_via,
    v_sync_claim
  );
end;
$$;

comment on function public.establish_operational_homeowner(bigint, text) is
  'Approved workflow grant for the single operational homeowner identity on a property.';

revoke all on function public.establish_operational_homeowner(bigint, text) from public;
grant execute on function public.establish_operational_homeowner(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: grant_counterparty_participation (join chain)
-- ---------------------------------------------------------------------------

create or replace function public.grant_counterparty_participation(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_property public.properties%rowtype;
  v_counterparty_role text;
  v_is_homeowner boolean;
begin
  v_user_id := auth.uid();

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
      and poi.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'no_operational_homeowner');
  end if;

  select exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = v_user_id
      and poi.status = 'active'
  )
  into v_is_homeowner;

  if v_is_homeowner then
    return jsonb_build_object('ok', false, 'error', 'homeowner_cannot_be_counterparty');
  end if;

  v_counterparty_role := case
    when v_property.relationship_type = 'sale' then 'buyer'
    when v_property.relationship_type = 'purchase' then 'seller'
    else null
  end;

  if v_counterparty_role is null then
    return jsonb_build_object('ok', false, 'error', 'not_counterparty_property');
  end if;

  insert into public.property_counterparty_participants (
    property_id,
    user_id,
    counterparty_role,
    granted_via,
    status,
    granted_at
  )
  values (
    p_property_id,
    v_user_id,
    v_counterparty_role,
    'join_chain_property',
    'active',
    now()
  )
  on conflict (property_id, user_id) do update
  set
    counterparty_role = excluded.counterparty_role,
    status = 'active',
    delinked_at = null;

  perform public._upsert_property_membership_row(
    p_property_id,
    v_user_id,
    v_counterparty_role
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'counterparty_role', v_counterparty_role
  );
end;
$$;

comment on function public.grant_counterparty_participation(bigint) is
  'Join-chain workflow: grants counterparty participation when an operational homeowner already exists.';

revoke all on function public.grant_counterparty_participation(bigint) from public;
grant execute on function public.grant_counterparty_participation(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: invite_property_delegate (household)
-- ---------------------------------------------------------------------------

create or replace function public.invite_property_delegate(
  p_property_id bigint,
  p_delegate_user_id uuid,
  p_permissions text[] default array['view']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_delegate_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'delegate_required');
  end if;

  if p_delegate_user_id = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'cannot_delegate_self');
  end if;

  if not exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = auth.uid()
      and poi.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_operational_homeowner');
  end if;

  insert into public.property_delegates (
    property_id,
    delegate_user_id,
    invited_by_user_id,
    permissions,
    status,
    invited_at
  )
  values (
    p_property_id,
    p_delegate_user_id,
    auth.uid(),
    coalesce(p_permissions, array['view']::text[]),
    'pending',
    now()
  )
  on conflict (property_id, delegate_user_id) do update
  set
    permissions = excluded.permissions,
    status = case
      when public.property_delegates.status = 'revoked' then 'pending'
      else public.property_delegates.status
    end,
    invited_by_user_id = excluded.invited_by_user_id,
    invited_at = now(),
    updated_at = now()
  where public.property_delegates.status in ('pending', 'revoked');

  return jsonb_build_object('ok', true, 'property_id', p_property_id);
end;
$$;

revoke all on function public.invite_property_delegate(bigint, uuid, text[]) from public;
grant execute on function public.invite_property_delegate(bigint, uuid, text[]) to authenticated;

create or replace function public.accept_property_delegate(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  update public.property_delegates pd
  set
    status = 'active',
    accepted_at = now(),
    updated_at = now()
  where pd.property_id = p_property_id
    and pd.delegate_user_id = auth.uid()
    and pd.status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_pending_invite');
  end if;

  return jsonb_build_object('ok', true, 'property_id', p_property_id);
end;
$$;

revoke all on function public.accept_property_delegate(bigint) from public;
grant execute on function public.accept_property_delegate(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: delink_homeowner_from_property
-- ---------------------------------------------------------------------------

create or replace function public.delink_homeowner_from_property(
  p_property_id bigint,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = auth.uid()
      and poi.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_operational_homeowner');
  end if;

  select chain_id
  into v_chain_id
  from public.properties
  where id = p_property_id;

  insert into public.property_delink_events (
    property_id,
    chain_id,
    actor_user_id,
    actor_type,
    reason
  )
  values (
    p_property_id,
    v_chain_id,
    auth.uid(),
    'homeowner',
    nullif(trim(p_reason), '')
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
    status = 'released',
    updated_at = now()
  where property_id = p_property_id
    and status = 'active';

  perform public.record_property_lifecycle_transition(
    p_property_id,
    'released',
    'homeowner_delink',
    null,
    coalesce(nullif(trim(p_reason), ''), 'homeowner_delink'),
    '{}'::jsonb
  );

  return jsonb_build_object('ok', true, 'property_id', p_property_id);
end;
$$;

revoke all on function public.delink_homeowner_from_property(bigint, text) from public;
grant execute on function public.delink_homeowner_from_property(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: delink_estate_agent_from_property
-- ---------------------------------------------------------------------------

create or replace function public.delink_estate_agent_from_property(
  p_property_id bigint,
  p_branch_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
  v_homeowner_present boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.property_ea_assignments pea
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where pea.property_id = p_property_id
      and pea.branch_id = p_branch_id
      and pea.status = 'active'
      and bm.user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_assigned_ea');
  end if;

  select chain_id
  into v_chain_id
  from public.properties
  where id = p_property_id;

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
    jsonb_build_object('branch_id', p_branch_id)
  );

  update public.property_ea_assignments
  set
    status = 'released',
    updated_at = now()
  where property_id = p_property_id
    and branch_id = p_branch_id
    and status = 'active';

  select exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
  )
  into v_homeowner_present;

  if not v_homeowner_present then
    perform public.record_property_lifecycle_transition(
      p_property_id,
      'released',
      'ea_delink_no_homeowner',
      null,
      coalesce(nullif(trim(p_reason), ''), 'ea_delink'),
      jsonb_build_object('branch_id', p_branch_id)
    );
  end if;

  return jsonb_build_object('ok', true, 'property_id', p_property_id);
end;
$$;

revoke all on function public.delink_estate_agent_from_property(bigint, uuid, text) from public;
grant execute on function public.delink_estate_agent_from_property(bigint, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Authority helpers (operational identity as source of truth)
-- ---------------------------------------------------------------------------

create or replace function public.get_property_operational_owner_user_id(
  p_property_id bigint
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select poi.homeowner_user_id
  from public.property_operational_identities poi
  where poi.property_id = p_property_id
    and poi.status = 'active';
$$;

comment on function public.get_property_operational_owner_user_id(bigint) is
  'Active operational homeowner user id from property_operational_identities; null when unclaimed.';

create or replace function public.is_property_operational_homeowner(
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
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = auth.uid()
      and poi.status = 'active'
  );
$$;

comment on function public.is_property_operational_homeowner(bigint) is
  'True when the current user is the active operational homeowner for the property.';

create or replace function public.is_property_operational_participant(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_property_operational_homeowner(p_property_id)
    or exists (
      select 1
      from public.property_counterparty_participants pcp
      where pcp.property_id = p_property_id
        and pcp.user_id = auth.uid()
        and pcp.status = 'active'
    )
    or exists (
      select 1
      from public.property_delegates pd
      where pd.property_id = p_property_id
        and pd.delegate_user_id = auth.uid()
        and pd.status = 'active'
    )
    or public.is_property_member(p_property_id)
    or exists (
      select 1
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm
        on bm.branch_id = pea.branch_id
      where pea.property_id = p_property_id
        and pea.status = 'active'
        and bm.user_id = auth.uid()
    );
$$;

comment on function public.is_property_operational_participant(bigint) is
  'Broad operational access check: homeowner, counterparty, delegate, synced member, or assigned EA.';

revoke all on function public.is_property_operational_homeowner(bigint) from public;
revoke all on function public.is_property_operational_participant(bigint) from public;
grant execute on function public.is_property_operational_homeowner(bigint) to authenticated;
grant execute on function public.is_property_operational_participant(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Revoke legacy membership creation paths
-- ---------------------------------------------------------------------------

create or replace function public.ensure_property_membership(
  p_property_id bigint,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'deprecated_use_establish_operational_homeowner'
    using hint = 'Use establish_operational_homeowner or grant_counterparty_participation via approved workflows.';
end;
$$;

comment on function public.ensure_property_membership(bigint, text) is
  'DEPRECATED — revoked. Operational authority must use typed grant RPCs.';

revoke all on function public.ensure_property_membership(bigint, text) from public;
revoke all on function public.ensure_property_membership(bigint, text) from authenticated;

drop policy if exists property_members_insert_own on public.property_members;

revoke insert on public.property_members from authenticated;
grant select on public.property_members to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: join_chain_property (counterparty grant workflow)
-- ---------------------------------------------------------------------------

create or replace function public.join_chain_property(
  p_access_code text,
  p_address text,
  p_postcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_chain_id bigint;
  v_property public.properties%rowtype;
  v_counterparty_role text;
  v_grant jsonb;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select c.id
  into v_chain_id
  from public.chains c
  where c.access_code = p_access_code;

  if v_chain_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  select *
  into v_property
  from public.properties p
  where p.chain_id = v_chain_id
    and p.address = p_address
    and p.postcode = p_postcode;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  update public.properties
  set
    status = 'healthy',
    buyer_connected = case
      when v_property.relationship_type in ('sale', 'purchase') then true
      else buyer_connected
    end,
    seller_connected = case
      when v_property.relationship_type = 'purchase' then true
      else seller_connected
    end
  where id = v_property.id;

  v_grant := public.grant_counterparty_participation(v_property.id);

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    return v_grant;
  end if;

  v_counterparty_role := v_grant ->> 'counterparty_role';

  select *
  into v_property
  from public.properties
  where id = v_property.id;

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property.id,
    'chain_id', v_property.chain_id,
    'linked_property_id', v_property.linked_property_id,
    'relationship_type', v_property.relationship_type,
    'joining_role', v_counterparty_role
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: claim_operational_property (homeowner grant workflow)
-- ---------------------------------------------------------------------------

create or replace function public.claim_operational_property(
  p_property_id bigint,
  p_invitation_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_property public.properties%rowtype;
  v_claimable boolean;
  v_hash text;
  v_invitation public.property_claim_invitations%rowtype;
  v_grant jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.account_type = 'homeowner'
  ) then
    return jsonb_build_object('ok', false, 'error', 'homeowner_only');
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'error', 'email_required');
  end if;

  if nullif(trim(p_invitation_token), '') is not null then
    v_hash := public.hash_invitation_token(p_invitation_token);

    select *
    into v_invitation
    from public.property_claim_invitations pci
    where pci.property_id = p_property_id
      and pci.invitation_token_hash = v_hash
    order by pci.invitation_created_at desc
    limit 1;

    if v_invitation.id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_invitation.invitation_used_at is not null then
      return jsonb_build_object('ok', false, 'error', 'already_used');
    end if;

    if v_invitation.invitation_rejected_at is not null then
      return jsonb_build_object('ok', false, 'error', 'invitation_declined');
    end if;

    if v_invitation.invitation_revoked_at is not null then
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_invitation.invitation_expires_at <= now() then
      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
  end if;

  select exists (
    select 1
    from public.property_claim_metadata pcm
    where pcm.property_id = p_property_id
      and pcm.origin_type = 'estate_agent'
      and pcm.claim_status in ('unclaimed', 'claim_invited')
      and pcm.invite_email is not null
      and lower(trim(pcm.invite_email)) = v_email
  )
  into v_claimable;

  if not v_claimable then
    return jsonb_build_object('ok', false, 'error', 'not_claimable');
  end if;

  if exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  v_grant := public.establish_operational_homeowner(
    p_property_id,
    'claim_operational_property'
  );

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    return v_grant;
  end if;

  if v_invitation.id is not null then
    update public.property_claim_invitations
    set
      invitation_used_at = now(),
      updated_at = now()
    where id = v_invitation.id
      and invitation_used_at is null;
  else
    update public.property_claim_invitations
    set
      invitation_used_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and invitation_revoked_at is null
      and invitation_used_at is null
      and invitation_expires_at > now();
  end if;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'chain_id', v_property.chain_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: convert_searching_placeholder_for_sale (homeowner grant on converted hop)
-- ---------------------------------------------------------------------------

create or replace function public.convert_searching_placeholder_for_sale(
  p_sale_property_id bigint,
  p_address text,
  p_postcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.properties%rowtype;
  v_placeholder_id bigint;
  v_placeholder public.properties%rowtype;
  v_converted_id bigint;
  v_address text;
  v_postcode text;
  v_updated_by text;
  v_buyer_user_id uuid;
  v_address_exists boolean;
  v_is_homeowner_seller boolean;
  v_is_delegated_ea boolean;
  v_grant jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_address := nullif(trim(p_address), '');
  v_postcode := nullif(trim(p_postcode), '');

  if v_address is null or v_postcode is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_address');
  end if;

  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id;

  if v_sale.id is null then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;

  if v_sale.relationship_type is distinct from 'sale' then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  select public.is_property_operational_homeowner(p_sale_property_id)
  into v_is_homeowner_seller;

  if not v_is_homeowner_seller then
    select public.is_ea_delegated_editor_on_property(p_sale_property_id)
    into v_is_delegated_ea;

    if not coalesce(v_is_delegated_ea, false) then
      return jsonb_build_object('ok', false, 'error', 'not_authorized');
    end if;
  else
    v_is_delegated_ea := false;
  end if;

  v_placeholder_id := v_sale.linked_property_id;

  if v_placeholder_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_placeholder');
  end if;

  select *
  into v_placeholder
  from public.properties
  where id = v_placeholder_id;

  if v_placeholder.id is null then
    return jsonb_build_object('ok', false, 'error', 'placeholder_not_found');
  end if;

  if v_placeholder.stage is distinct from 'searching'
    or v_placeholder.address is not null
    or v_placeholder.postcode is not null
  then
    return jsonb_build_object('ok', false, 'error', 'not_searching_placeholder');
  end if;

  if v_placeholder.chain_id is distinct from v_sale.chain_id then
    return jsonb_build_object('ok', false, 'error', 'chain_mismatch');
  end if;

  select public.property_exists_for_onboarding(
    v_address,
    v_postcode,
    v_placeholder_id
  )
  into v_address_exists;

  if v_address_exists then
    return jsonb_build_object('ok', false, 'error', 'duplicate_address');
  end if;

  update public.properties
  set
    stage = 'offer_accepted',
    address = v_address,
    postcode = v_postcode,
    status = 'pending_connection',
    relationship_type = 'purchase',
    buyer_connected = true,
    seller_connected = false,
    is_searching = false,
    is_current_user = true,
    awaiting_buyer = false
  where id = v_placeholder_id
    and stage = 'searching'
    and address is null
    and postcode is null
  returning id
  into v_converted_id;

  if v_converted_id is null then
    return jsonb_build_object('ok', false, 'error', 'update_failed');
  end if;

  if v_is_delegated_ea and not v_is_homeowner_seller then
    v_buyer_user_id :=
      public.get_property_operational_owner_user_id(p_sale_property_id);

    if v_buyer_user_id is null then
      v_buyer_user_id := auth.uid();
    end if;
  else
    v_buyer_user_id := auth.uid();
  end if;

  v_grant := public._establish_operational_homeowner_core(
    v_converted_id,
    v_buyer_user_id,
    'convert_placeholder',
    false
  );

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    return v_grant;
  end if;

  select case
    when p.account_type = 'estate_agent' then 'estate_agent'
    else 'homeowner'
  end
  into v_updated_by
  from public.profiles p
  where p.id = auth.uid();

  v_updated_by := coalesce(v_updated_by, 'homeowner');

  insert into public.activities (
    property_id,
    update,
    updated_by
  )
  values (
    v_converted_id,
    'Onward purchase added',
    v_updated_by
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', v_converted_id,
    'chain_id', v_sale.chain_id
  );
end;
$$;

comment on function public.convert_searching_placeholder_for_sale(bigint, text, text) is
  'Converts the downstream searching placeholder. Authorised via operational seller identity or delegated EA editing.';

-- ---------------------------------------------------------------------------
-- establish_connected_hop: resolve topology via identity + counterparty tables
-- ---------------------------------------------------------------------------

create or replace function public.establish_connected_hop(
  p_purchase_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_purchase public.properties%rowtype;
  v_host_buyer_user_id uuid;
  v_host_sale public.properties%rowtype;
  v_previous_downstream_id bigint;
  v_downstream_after_purchase_id bigint;
  v_existing_downstream public.properties%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_purchase
  from public.properties
  where id = p_purchase_property_id;

  if v_purchase.id is null then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_found');
  end if;

  if v_purchase.relationship_type is distinct from 'purchase' then
    return jsonb_build_object('ok', false, 'error', 'not_purchase');
  end if;

  if not public.is_property_operational_participant(v_purchase.id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
    buyer_connected = true
  where id = v_purchase.id;

  select poi.homeowner_user_id
  into v_host_buyer_user_id
  from public.property_operational_identities poi
  where poi.property_id = v_purchase.id
    and poi.status = 'active'
    and poi.operational_role = 'buyer';

  if v_host_buyer_user_id is null then
    return jsonb_build_object('ok', true, 'linked', false);
  end if;

  select p.*
  into v_host_sale
  from public.properties p
  inner join public.property_operational_identities poi
    on poi.property_id = p.id
    and poi.status = 'active'
    and poi.operational_role = 'seller'
    and poi.homeowner_user_id = v_host_buyer_user_id
  where p.chain_id = v_purchase.chain_id
    and p.relationship_type = 'sale'
  limit 1;

  if v_host_sale.id is null then
    return jsonb_build_object('ok', true, 'linked', false);
  end if;

  v_previous_downstream_id := v_host_sale.linked_property_id;
  v_downstream_after_purchase_id := null;

  if v_previous_downstream_id is not null
    and v_previous_downstream_id <> v_purchase.id then
    select *
    into v_existing_downstream
    from public.properties
    where id = v_previous_downstream_id;

    if v_existing_downstream.id is not null
      and v_existing_downstream.stage = 'searching'
      and v_existing_downstream.address is null
      and v_existing_downstream.postcode is null then
      v_downstream_after_purchase_id := v_existing_downstream.id;
    end if;
  end if;

  if v_purchase.linked_property_id is not null
    and v_purchase.linked_property_id <> v_downstream_after_purchase_id then
    select *
    into v_existing_downstream
    from public.properties
    where id = v_purchase.linked_property_id;

    if v_existing_downstream.id is not null
      and v_existing_downstream.stage = 'searching'
      and v_existing_downstream.address is null
      and v_existing_downstream.postcode is null then
      v_downstream_after_purchase_id := v_existing_downstream.id;
    end if;
  end if;

  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
    buyer_connected = true,
    linked_property_id = v_purchase.id
  where id = v_host_sale.id;

  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
    buyer_connected = true,
    linked_property_id = v_downstream_after_purchase_id
  where id = v_purchase.id;

  return jsonb_build_object('ok', true, 'linked', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Anomaly report: use identity table
-- ---------------------------------------------------------------------------

create or replace function public.report_multiple_operational_homeowners()
returns table (
  property_id bigint,
  relationship_type text,
  owner_role text,
  user_count bigint,
  user_ids uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as property_id,
    p.relationship_type,
    case
      when p.relationship_type = 'sale' then 'seller'
      when p.relationship_type = 'purchase' then 'buyer'
      else null
    end as owner_role,
    count(distinct pm.user_id) as user_count,
    array_agg(distinct pm.user_id order by pm.user_id) as user_ids
  from public.properties p
  inner join public.property_members pm
    on pm.property_id = p.id
  where p.relationship_type in ('sale', 'purchase')
    and pm.role = case
      when p.relationship_type = 'sale' then 'seller'
      when p.relationship_type = 'purchase' then 'buyer'
    end
  group by p.id, p.relationship_type
  having count(distinct pm.user_id) > 1;
$$;
