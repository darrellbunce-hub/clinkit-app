-- Phase 7B.1: Homeowner claim discovery and claim mutation

create or replace function public.get_auth_user_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(u.email))
  from auth.users u
  where u.id = auth.uid();
$$;

comment on function public.get_auth_user_email() is
  'Normalized email for the authenticated user; used by claim discovery.';

revoke all on function public.get_auth_user_email() from public;
grant execute on function public.get_auth_user_email() to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: discover_claimable_properties
-- ---------------------------------------------------------------------------

create or replace function public.discover_claimable_properties()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  v_results jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.account_type = 'homeowner'
  ) then
    return '[]'::jsonb;
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'property_id', rows.property_id,
        'address', rows.address,
        'postcode', rows.postcode,
        'branch_name', rows.branch_name,
        'in_chain', rows.in_chain,
        'claim_status', rows.claim_status
      )
      order by rows.property_id
    ),
    '[]'::jsonb
  )
  into v_results
  from (
    select
      pcm.property_id,
      p.address,
      p.postcode,
      coalesce(b.name, 'Estate agent branch') as branch_name,
      exists (
        select 1
        from public.properties p2
        where p2.chain_id = p.chain_id
          and p2.id <> p.id
      ) as in_chain,
      pcm.claim_status
    from public.property_claim_metadata pcm
    inner join public.properties p
      on p.id = pcm.property_id
    left join lateral (
      select pea.branch_id
      from public.property_ea_assignments pea
      where pea.property_id = pcm.property_id
        and pea.status = 'active'
      order by pea.assigned_at desc nulls last
      limit 1
    ) active_assignment
      on true
    left join public.ea_branches b
      on b.id = active_assignment.branch_id
    where pcm.origin_type = 'estate_agent'
      and pcm.claim_status in ('unclaimed', 'claim_invited')
      and pcm.invite_email is not null
      and lower(trim(pcm.invite_email)) = v_email
      and not exists (
        select 1
        from public.property_members pm
        where pm.property_id = pcm.property_id
          and pm.user_id = auth.uid()
      )
  ) as rows;

  return coalesce(v_results, '[]'::jsonb);
end;
$$;

comment on function public.discover_claimable_properties() is
  'Returns claimable EA-originated properties matching the authenticated homeowner email.';

revoke all on function public.discover_claimable_properties() from public;
grant execute on function public.discover_claimable_properties() to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: claim_operational_property
-- ---------------------------------------------------------------------------

create or replace function public.claim_operational_property(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_property public.properties%rowtype;
  v_role text;
  v_claimable boolean;
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
    from public.property_members pm
    where pm.property_id = p_property_id
      and pm.user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  v_role := case
    when v_property.relationship_type = 'purchase' then 'buyer'
    else 'seller'
  end;

  perform public.ensure_property_membership(
    p_property_id,
    v_role
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'chain_id', v_property.chain_id
  );
end;
$$;

comment on function public.claim_operational_property(bigint) is
  'Claims an EA-originated property for the authenticated homeowner via property_members.';

revoke all on function public.claim_operational_property(bigint) from public;
grant execute on function public.claim_operational_property(bigint) to authenticated;
