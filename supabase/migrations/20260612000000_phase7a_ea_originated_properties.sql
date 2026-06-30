-- Phase 7A: Estate agent originated property creation
--
-- Normal properties + claim metadata. Origin does not affect workflow behaviour.
-- TypeScript owns business rules; RPCs persist records for EA branch members.

-- ---------------------------------------------------------------------------
-- property_claim_metadata
-- ---------------------------------------------------------------------------

create table if not exists public.property_claim_metadata (
  property_id bigint primary key
    references public.properties (id) on delete cascade,
  origin_type text not null default 'homeowner',
  claim_status text not null default 'claimed',
  invite_email text null,
  invite_display_name text null,
  originated_by_user_id uuid null references auth.users (id),
  claimed_at timestamptz null,
  claimed_by_user_id uuid null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint property_claim_metadata_origin_type_check
    check (origin_type in ('homeowner', 'estate_agent')),

  constraint property_claim_metadata_claim_status_check
    check (
      claim_status in (
        'unclaimed',
        'claim_invited',
        'claimed'
      )
    )
);

create index if not exists property_claim_metadata_claim_status_idx
  on public.property_claim_metadata (claim_status);

comment on table public.property_claim_metadata is
  'Operational claim metadata for properties. Not permission logic; ownership remains membership-based.';

comment on column public.property_claim_metadata.invite_display_name is
  'Optional EA-only display label for Phase 7B invitations. Never exposed on participant dashboards.';

-- Backfill: existing properties with members are treated as homeowner-claimed.

insert into public.property_claim_metadata (
  property_id,
  origin_type,
  claim_status,
  claimed_at,
  claimed_by_user_id
)
select
  p.id,
  'homeowner',
  'claimed',
  now(),
  (
    select pm.user_id
    from public.property_members pm
    where pm.property_id = p.id
    order by pm.created_at asc nulls last
    limit 1
  )
from public.properties p
where exists (
  select 1
  from public.property_members pm
  where pm.property_id = p.id
)
on conflict (property_id) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
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
  select pm.user_id
  from public.property_members pm
  where pm.property_id = p_property_id
  order by pm.created_at asc nulls last
  limit 1;
$$;

comment on function public.get_property_operational_owner_user_id(bigint) is
  'First property member user id for operational subject resolution; null when unclaimed.';

create or replace function public.is_ea_branch_member(
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
    from public.ea_branch_members bm
    where bm.branch_id = p_branch_id
      and bm.user_id = auth.uid()
  );
$$;

comment on function public.is_ea_branch_member(uuid) is
  'True when the current user belongs to the given estate agent branch.';

revoke all on function public.get_property_operational_owner_user_id(bigint) from public;
revoke all on function public.is_ea_branch_member(uuid) from public;

grant execute on function public.get_property_operational_owner_user_id(bigint) to authenticated;
grant execute on function public.is_ea_branch_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Claim sync on membership (convergence when homeowner claims)
-- ---------------------------------------------------------------------------

create or replace function public.sync_property_claim_on_membership()
returns trigger
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
    new.property_id,
    coalesce(
      (
        select pcm.origin_type
        from public.property_claim_metadata pcm
        where pcm.property_id = new.property_id
      ),
      'homeowner'
    ),
    'claimed',
    now(),
    new.user_id
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

  return new;
end;
$$;

drop trigger if exists property_members_sync_claim
  on public.property_members;

create trigger property_members_sync_claim
  after insert on public.property_members
  for each row
  execute function public.sync_property_claim_on_membership();

-- ---------------------------------------------------------------------------
-- Internal: assign branch + claim metadata for EA originated property
-- ---------------------------------------------------------------------------

create or replace function public._ea_assign_originated_property(
  p_property_id bigint,
  p_branch_id uuid,
  p_homeowner_only_updates boolean,
  p_invite_email text,
  p_invite_display_name text,
  p_claim_status text
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
    invite_email,
    invite_display_name,
    originated_by_user_id
  )
  values (
    p_property_id,
    'estate_agent',
    p_claim_status,
    nullif(trim(p_invite_email), ''),
    nullif(trim(p_invite_display_name), ''),
    auth.uid()
  );

  insert into public.property_ea_assignments (
    property_id,
    branch_id,
    status,
    homeowner_only_updates,
    assigned_by_user_id
  )
  values (
    p_property_id,
    p_branch_id,
    'active',
    p_homeowner_only_updates,
    auth.uid()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create_ea_operational_chain
-- ---------------------------------------------------------------------------

create or replace function public.create_ea_operational_chain(
  p_name text,
  p_access_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_chain_id bigint;
  v_name text;
  v_access_code text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.ea_branch_members bm
    where bm.user_id = v_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  v_name := nullif(trim(p_name), '');

  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  v_access_code := nullif(trim(p_access_code), '');

  if v_access_code is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  begin
    insert into public.chains (name, access_code, created_by_user_id)
    values (v_name, v_access_code, v_user_id)
    returning id into v_chain_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'duplicate_access_code');
  end;

  return jsonb_build_object(
    'ok', true,
    'chain_id', v_chain_id,
    'access_code', v_access_code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create_ea_operational_property
-- ---------------------------------------------------------------------------

create or replace function public.create_ea_operational_property(
  p_chain_id bigint,
  p_relationship_type text,
  p_address text,
  p_postcode text,
  p_branch_id uuid,
  p_homeowner_only_updates boolean default true,
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
    coalesce(p_homeowner_only_updates, true),
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
-- RPC: join_ea_operational_chain
-- ---------------------------------------------------------------------------

create or replace function public.join_ea_operational_chain(
  p_access_code text,
  p_relationship_type text,
  p_address text,
  p_postcode text,
  p_branch_id uuid,
  p_homeowner_only_updates boolean default true,
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

revoke all on function public.create_ea_operational_chain(text, text) from public;
revoke all on function public.create_ea_operational_property(bigint, text, text, text, uuid, boolean, text, text, boolean) from public;
revoke all on function public.join_ea_operational_chain(text, text, text, text, uuid, boolean, text, text, boolean) from public;

grant execute on function public.create_ea_operational_chain(text, text) to authenticated;
grant execute on function public.create_ea_operational_property(bigint, text, text, text, uuid, boolean, text, text, boolean) to authenticated;
grant execute on function public.join_ea_operational_chain(text, text, text, text, uuid, boolean, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: property_claim_metadata
-- ---------------------------------------------------------------------------

alter table public.property_claim_metadata enable row level security;

drop policy if exists property_claim_metadata_select_scope
  on public.property_claim_metadata;

create policy property_claim_metadata_select_scope
  on public.property_claim_metadata
  for select
  to authenticated
  using (
    public.is_property_member(property_id)
    or public.is_ea_assigned_to_property(property_id)
  );

revoke all on public.property_claim_metadata from public;
revoke all on public.property_claim_metadata from anon;
grant select on public.property_claim_metadata to authenticated;

-- ---------------------------------------------------------------------------
-- View: ea_operational_assignments (subject user from membership)
-- ---------------------------------------------------------------------------

create or replace view public.ea_operational_assignments
with (security_invoker = false)
as
select
  pea.property_id,
  p.chain_id,
  pea.homeowner_only_updates,
  public.get_property_operational_owner_user_id(pea.property_id) as subject_user_id,
  coalesce(pcm.claim_status, 'claimed') as claim_status,
  pcm.origin_type
from public.property_ea_assignments pea
inner join public.properties p
  on p.id = pea.property_id
left join public.property_claim_metadata pcm
  on pcm.property_id = pea.property_id
where
  auth.uid() is not null
  and pea.status = 'active'
  and exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = pea.branch_id
      and bm.user_id = auth.uid()
  );

comment on view public.ea_operational_assignments is
  'Branch-scoped EA assignments with operational owner user id and claim status.';

revoke all on public.ea_operational_assignments from public;
revoke all on public.ea_operational_assignments from anon;
grant select on public.ea_operational_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- Extend agent_branch_property_summaries with claim_status (no PII)
-- ---------------------------------------------------------------------------

create or replace view public.agent_branch_property_summaries
with (security_invoker = false)
as
select
  pea.id as assignment_id,
  pea.property_id,
  pea.branch_id,
  pea.status as assignment_status,
  pea.homeowner_only_updates,
  pea.assigned_at,
  p.chain_id,
  p.address,
  p.postcode,
  p.stage,
  p.status as property_status,
  ch.completion_lifecycle_status,
  ch.completion_scheduled_date,
  ch.completed_at,
  pos.needs_attention,
  pos.stale_update,
  pos.days_since_last_update,
  pos.operational_alerts,
  pos.next_recommended_action,
  cos.confidence_score,
  cos.health_status,
  coalesce(pcm.claim_status, 'claimed') as claim_status,
  coalesce(pcm.origin_type, 'homeowner') as origin_type
from public.property_ea_assignments pea
inner join public.properties p
  on p.id = pea.property_id
inner join public.chains ch
  on ch.id = p.chain_id
left join public.property_operational_summary pos
  on pos.property_id = pea.property_id
left join public.chain_operational_summary cos
  on cos.chain_id = p.chain_id
left join public.property_claim_metadata pcm
  on pcm.property_id = pea.property_id
where
  auth.uid() is not null
  and exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = pea.branch_id
      and bm.user_id = auth.uid()
  )
  and pea.status in ('active', 'revoked');

revoke all on public.agent_branch_property_summaries from public;
revoke all on public.agent_branch_property_summaries from anon;
grant select on public.agent_branch_property_summaries to authenticated;
