-- P0: Prevent arbitrary-chain injection via create_ea_operational_property.
--
-- Root cause: the RPC checked branch membership and chain existence only.
-- Any EA branch member who knew/guessed another chain_id could insert an
-- operational property onto that chain.
--
-- Authorisation model (canonical):
--   EA chain authority for mutations comes from property_ea_assignments
--   (same foundation as is_ea_assigned_to_chain), scoped to p_branch_id.
--
-- Why is_ea_assigned_to_chain alone is insufficient:
--   1) Empty newly-created chains have no assignments yet (CASE 1 origination).
--   2) It is user-scoped, not branch-scoped (CASE 4 multi-branch weakness).
--   3) is_chain_operational_viewer includes homeowners — wrong for this mutate.
--
-- Authz for create_ea_operational_property:
--   A) p_branch_id has an active assignment on any property in p_chain_id, OR
--   B) p_chain_id is empty AND created_by_user_id = auth.uid()
--      (narrow first-property EA origination exception).
--
-- join_ea_operational_chain remains authorised by access-code resolution and
-- calls the internal core (not the public gated RPC), preserving access-code joins.
--
-- Does not change RLS, EXECUTE grants on public RPCs, billing, GDPR, or smoke.

-- ---------------------------------------------------------------------------
-- Internal core: validated insert + assignment (no chain-relationship gate)
-- ---------------------------------------------------------------------------

create or replace function public._create_ea_operational_property_core(
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
  v_email_gate jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

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

comment on function public._create_ea_operational_property_core(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) is
  'Internal EA operational property insert. Callers must establish chain authorisation (assignment, empty self-originated chain, or access-code join).';

revoke all on function public._create_ea_operational_property_core(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) from public, anon, authenticated;

grant execute on function public._create_ea_operational_property_core(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) to service_role;

-- ---------------------------------------------------------------------------
-- Public RPC: create_ea_operational_property (gated)
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
  v_branch_authorised boolean;
  v_empty_self_originated boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  if not exists (
    select 1
    from public.chains c
    where c.id = p_chain_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'chain_not_found');
  end if;

  -- Canonical mutate authority: this branch already operates on the chain.
  select exists (
    select 1
    from public.property_ea_assignments pea
    inner join public.properties p
      on p.id = pea.property_id
    where p.chain_id = p_chain_id
      and pea.branch_id = p_branch_id
      and pea.status = 'active'
  )
  into v_branch_authorised;

  -- Narrow origination exception: first property on an empty chain this user created.
  select
    exists (
      select 1
      from public.chains c
      where c.id = p_chain_id
        and c.created_by_user_id = auth.uid()
    )
    and not exists (
      select 1
      from public.properties p
      where p.chain_id = p_chain_id
    )
  into v_empty_self_originated;

  if not v_branch_authorised and not v_empty_self_originated then
    return jsonb_build_object('ok', false, 'error', 'not_authorised_for_chain');
  end if;

  return public._create_ea_operational_property_core(
    p_chain_id,
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

comment on function public.create_ea_operational_property(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) is
  'EA creates an operational property on a chain the branch is authorised to operate on (active assignment), or the first property on an empty chain created by the caller.';

-- ---------------------------------------------------------------------------
-- Public RPC: join_ea_operational_chain (access-code authz → core)
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

  if not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  select c.id
  into v_chain_id
  from public.chains c
  where c.access_code = nullif(trim(p_access_code), '');

  if v_chain_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  -- Access-code proof authorises operating on this chain for p_branch_id.
  return public._create_ea_operational_property_core(
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

comment on function public.join_ea_operational_chain(
  text, text, text, text, uuid, boolean, text, text, boolean
) is
  'EA joins an existing chain via access code and creates an operational property. Access-code resolution is the chain authorisation; insert goes through the internal core.';

-- Preserve existing public EXECUTE surface (no broadening).
revoke all on function public.create_ea_operational_property(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) from public;
revoke all on function public.join_ea_operational_chain(
  text, text, text, text, uuid, boolean, text, text, boolean
) from public;

grant execute on function public.create_ea_operational_property(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) to authenticated;
grant execute on function public.join_ea_operational_chain(
  text, text, text, text, uuid, boolean, text, text, boolean
) to authenticated;
