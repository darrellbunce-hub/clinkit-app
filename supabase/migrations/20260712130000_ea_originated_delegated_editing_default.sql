-- Phase A: EA-originated properties default to delegated operational editing.

-- ---------------------------------------------------------------------------
-- RPC: create_ea_operational_property (default delegated editing)
-- ---------------------------------------------------------------------------

create or replace function public.create_ea_operational_property(
  p_chain_id bigint,
  p_relationship_type text,
  p_address text,
  p_postcode text,
  p_branch_id uuid,
  p_homeowner_only_updates boolean default false,
  p_invite_email text default null,
  p_invite_display_name text default null,
  p_awaiting_buyer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id bigint;
  v_chain_position integer;
  v_claim_status text;
  v_address text;
  v_postcode text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  if p_relationship_type not in ('sale', 'purchase') then
    return jsonb_build_object('ok', false, 'error', 'invalid_relationship_type');
  end if;

  v_address := nullif(trim(p_address), '');
  v_postcode := nullif(trim(p_postcode), '');

  if v_address is null or v_postcode is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_address');
  end if;

  if not exists (
    select 1
    from public.chains c
    where c.id = p_chain_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'chain_not_found');
  end if;

  if exists (
    select 1
    from public.properties p
    where p.chain_id = p_chain_id
      and p.address = v_address
      and p.postcode = v_postcode
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_already_exists');
  end if;

  select coalesce(max(p.chain_position), 0) + 1
  into v_chain_position
  from public.properties p
  where p.chain_id = p_chain_id;

  v_claim_status := case
    when nullif(trim(p_invite_email), '') is not null then 'claim_invited'
    else 'unclaimed'
  end;

  insert into public.properties (
    chain_id,
    chain_position,
    address,
    postcode,
    stage,
    status,
    relationship_type,
    created_by_user_id,
    awaiting_buyer,
    buyer_connected,
    seller_connected,
    is_searching,
    is_current_user,
    last_updated_days
  )
  values (
    p_chain_id,
    v_chain_position,
    v_address,
    v_postcode,
    case
      when p_relationship_type = 'sale' then 'property_listed'
      else 'offer_accepted'
    end,
    'pending_connection',
    p_relationship_type,
    auth.uid(),
    case
      when p_relationship_type = 'sale' then coalesce(p_awaiting_buyer, false)
      else false
    end,
    false,
    case
      when p_relationship_type = 'sale' then true
      else false
    end,
    false,
    false,
    0
  )
  returning id into v_property_id;

  perform public._ea_assign_originated_property(
    v_property_id,
    p_branch_id,
    coalesce(p_homeowner_only_updates, false),
    p_invite_email,
    p_invite_display_name,
    v_claim_status
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property_id,
    'chain_id', p_chain_id,
    'claim_status', v_claim_status
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: join_ea_operational_chain (default delegated editing)
-- ---------------------------------------------------------------------------

create or replace function public.join_ea_operational_chain(
  p_access_code text,
  p_relationship_type text,
  p_address text,
  p_postcode text,
  p_branch_id uuid,
  p_homeowner_only_updates boolean default false,
  p_invite_email text default null,
  p_invite_display_name text default null,
  p_awaiting_buyer boolean default false
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

  select c.id
  into v_chain_id
  from public.chains c
  where c.access_code = nullif(trim(p_access_code), '');

  if v_chain_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  return public.create_ea_operational_property(
    v_chain_id,
    p_relationship_type,
    p_address,
    p_postcode,
    p_branch_id,
    p_homeowner_only_updates,
    p_invite_email,
    p_invite_display_name,
    p_awaiting_buyer
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: unclaimed EA-originated assignments still on view-only default
-- ---------------------------------------------------------------------------

update public.property_ea_assignments pea
set
  homeowner_only_updates = false,
  updated_at = now()
from public.property_claim_metadata pcm
where pcm.property_id = pea.property_id
  and pcm.origin_type = 'estate_agent'
  and pcm.claim_status in ('unclaimed', 'claim_invited')
  and pea.status = 'active'
  and pea.homeowner_only_updates = true;

comment on column public.property_ea_assignments.homeowner_only_updates is
  'When true, assigned agents may view but not post delegated updates. EA-originated properties default to false (delegated editing) until the homeowner revokes after claim.';
